/**
 * Client for ESPN's public site API (no key, undocumented). Only the fields
 * this site stores are read. Numbers arrive as strings and may be missing;
 * `int` reads them leniently, so a missing or malformed value counts as 0.
 */

import { setTimeout as sleep } from "node:timers/promises";

import { coreGameSummary } from "./espnCore.ts";

const BASE = "https://site.api.espn.com/apis/site/v2/sports/basketball/nba";

/** ESPN's id of a game, as the schedule writes it. */
const GAME_ID = /^[1-9][0-9]{0,19}$/;

export const REGULAR_SEASON = 2;
export const PLAYOFFS = 3;

export class EspnHttpError extends Error {
  status: number;

  constructor(status: number, url: string) {
    super(`ESPN ${status} for ${url}`);
    this.name = "EspnHttpError";
    this.status = status;
  }
}

export type Schedule = {
  seasonYear: number;
  completedGames: ScheduleGame[];
};

export type ScheduleGame = {
  id: string;
  /** The playoff series and game, as in "East 1st Round - Game 7". */
  note: string | null;
};

export type Team = {
  id: number;
  abbreviation: string;
  displayName: string;
  shortName: string;
};

export type TeamBox = {
  teamId: number;
  pts: number;
  fgm: number;
  fga: number;
  fg3m: number;
  fg3a: number;
  ftm: number;
  fta: number;
  oreb: number;
  dreb: number;
  ast: number;
  stl: number;
  blk: number;
  tov: number;
  paintPts: number;
  fastBreakPts: number;
  ptsOffTov: number;
};

export type PlayerBox = {
  playerId: number;
  fullName: string;
  position: string | null;
  teamId: number;
  starter: boolean;
  minutes: number;
  pts: number;
  fgm: number;
  fga: number;
  fg3m: number;
  fg3a: number;
  ftm: number;
  fta: number;
  oreb: number;
  dreb: number;
  ast: number;
  stl: number;
  blk: number;
  tov: number;
  pf: number;
  plusMinus: number;
};

export type CourtPosition = { x: number; y: number };

export type Play = {
  period: number;
  clockSeconds: number;
  typeText: string;
  teamId: number | null;
  homeScore: number;
  awayScore: number;
  text: string;
  players: [number | null, number | null, number | null];
  /** A shot, free throws included. */
  shooting: boolean;
  /** Points the play scored. */
  scoreValue: number;
  /** 2 or 3 on a field-goal attempt. */
  pointsAttempted: number;
  /** ESPN's court position; null where ESPN gives none. */
  position: CourtPosition | null;
};

export type Period = {
  teamId: number;
  period: number;
  pts: number;
};

export type GameSummary = {
  id: string;
  completed: boolean;
  seasonYear: number;
  seasonType: number;
  startsAt: Temporal.Instant;
  home: Team;
  away: Team;
  homeScore: number;
  awayScore: number;
  periods: Period[];
  venue: string | null;
  note: string | null;
  neutral: boolean;
  attendance: number | null;
  teamBoxes: TeamBox[];
  playerBoxes: PlayerBox[];
  plays: Play[];
};

/** One request, headers to the end of the body. A game summary arrives in a second or two. */
const REQUEST_TIMEOUT_MS = 30_000;
/** The largest answer that is read. A game summary is about 1 MiB. */
const MAX_RESPONSE_BYTES = 16 * 1024 * 1024;

/**
 * The body of `res` as JSON, read no further than `maxBytes`: what ESPN sends
 * decides how much memory the server uses otherwise. `url` names the document
 * in error messages.
 */
export async function jsonWithin(res: Response, maxBytes: number, url: string): Promise<unknown> {
  const tooLarge = () => new Error(`${url} is larger than ${maxBytes} bytes`);
  if (Number(res.headers.get("content-length")) > maxBytes) {
    await res.body?.cancel();
    throw tooLarge();
  }
  const chunks: Uint8Array[] = [];
  let size = 0;
  if (res.body) {
    const reader = res.body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) {
        await reader.cancel();
        throw tooLarge();
      }
      chunks.push(value);
    }
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch (cause) {
    throw new Error(`parsing ${url}`, { cause });
  }
}

export class Espn {
  /**
   * Up to 3 attempts; only 5xx answers are retried, after 1 s and then 2 s.
   * A redirect is an error: the URLs asked for are ESPN's own, and following
   * one would take the request to a host nobody checked.
   */
  async getJson(url: string): Promise<unknown> {
    for (let attempt = 1; ; attempt++) {
      const res = await fetch(url, {
        headers: { accept: "application/json" },
        redirect: "error",
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      if (res.ok) return jsonWithin(res, MAX_RESPONSE_BYTES, url);
      // An unread body keeps its connection open.
      await res.body?.cancel();
      if (attempt >= 3 || res.status < 500) throw new EspnHttpError(res.status, url);
      await sleep(1000 * attempt);
    }
  }

  /** Without a season ESPN answers with the current one. */
  async schedule(teamSlug: string, seasonYear: number | null, seasonType: number): Promise<Schedule> {
    let url = `${BASE}/teams/${teamSlug}/schedule?seasontype=${seasonType}`;
    if (seasonYear !== null) url += `&season=${seasonYear}`;
    return parseSchedule(await this.getJson(url), seasonYear, url);
  }

  async gameSummary(gameId: string): Promise<GameSummary> {
    const url = `${BASE}/summary?event=${gameId}`;
    return parseSummary(gameId, await this.getJson(url), url);
  }

  /**
   * The same game from ESPN's core API, for a game whose summary answers 404.
   * The core API has no season or series note on a game, so the caller passes
   * the ones from the schedule that listed it.
   */
  coreGameSummary(gameId: string, seasonYear: number, seasonType: number, note: string | null): Promise<GameSummary> {
    return coreGameSummary((url) => this.getJson(url), gameId, seasonYear, seasonType, note);
  }
}

/**
 * `source` names the document in error messages. `seasonYear` is the season
 * that was asked for, null when none was.
 */
export function parseSchedule(document: unknown, seasonYear: number | null, source = "ESPN schedule"): Schedule {
  const json = shaped(source, () => readSchedule(document));
  // A season type that hasn't started (playoffs during the regular season)
  // comes back without requestedSeason and with no events.
  const year = json.requestedSeason?.year ?? seasonYear;
  if (year === null || year === 0) throw new Error("ESPN schedule has no requestedSeason");
  const completedGames = (json.events ?? [])
    .filter((event) => event.competitions?.[0]?.status?.type?.completed === true)
    .map((event) => {
      // The id goes into the URLs of the game's documents and into log lines.
      if (!GAME_ID.test(event.id))
        throw new Error(`ESPN schedule has a game id that is not a number: ${JSON.stringify(event.id)}`);
      return { note: event.competitions?.[0]?.notes?.[0]?.headline || null, id: event.id };
    });
  return { seasonYear: year, completedGames };
}

/** `source` names the document in error messages. */
export function parseSummary(gameId: string, document: unknown, source = "ESPN summary"): GameSummary {
  const json = shaped(source, () => readSummary(document));
  const competition = json.header.competitions[0];
  if (!competition) throw new Error(`Game ${gameId} has no competition`);
  const side = (name: string) => competition.competitors.find((c) => c.homeAway === name);
  const home = side("home");
  const away = side("away");
  if (!home || !away) throw new Error(`Game ${gameId} is missing a team`);
  const team = (c: CompetitorJson): Team => ({
    id: int(c.team.id),
    abbreviation: c.team.abbreviation,
    displayName: c.team.displayName,
    shortName: c.team.name,
  });

  const teamBoxes = json.boxscore.teams.map((t): TeamBox => {
    const stat = (name: string) => t.statistics.find((s) => s.name === name)?.displayValue ?? null;
    const [fgm, fga] = madeAttempted(stat("fieldGoalsMade-fieldGoalsAttempted"));
    const [fg3m, fg3a] = madeAttempted(stat("threePointFieldGoalsMade-threePointFieldGoalsAttempted"));
    const [ftm, fta] = madeAttempted(stat("freeThrowsMade-freeThrowsAttempted"));
    const teamId = int(t.team.id);
    const score = teamId === int(home.id) ? home.score : away.score;
    return {
      teamId,
      pts: int(score),
      fgm,
      fga,
      fg3m,
      fg3a,
      ftm,
      fta,
      oreb: int(stat("offensiveRebounds")),
      dreb: int(stat("defensiveRebounds")),
      ast: int(stat("assists")),
      stl: int(stat("steals")),
      blk: int(stat("blocks")),
      tov: int(stat("totalTurnovers") ?? stat("turnovers")),
      paintPts: int(stat("pointsInPaint")),
      fastBreakPts: int(stat("fastBreakPoints")),
      ptsOffTov: int(stat("turnoverPoints")),
    };
  });
  // The report needs the stats of both teams for every stored game.
  const boxed = teamBoxes.map((box) => box.teamId).sort();
  const playing = [int(home.team.id), int(away.team.id)].sort();
  if (boxed.length !== 2 || boxed[0] !== playing[0] || boxed[1] !== playing[1]) {
    throw new Error(`Game ${gameId} doesn't have the team stats of both teams`);
  }

  const playerBoxes: PlayerBox[] = [];
  for (const boxSide of json.boxscore.players ?? []) {
    const group = boxSide.statistics[0];
    if (!group) continue;
    for (const a of group.athletes) {
      // Players who didn't play can come without an id or a name.
      if (a.didNotPlay === true) continue;
      const missing = (field: string) => new Error(`Game ${gameId}: a player who played has no ${field}`);
      const stats = a.stats;
      if (stats === null) throw missing("stats");
      if (stats.length === 0) continue;
      const athlete = a.athlete;
      if (athlete === null) throw missing("athlete");
      const names = group.names;
      if (names === null) throw missing("stat names");
      const col = (name: string) => {
        const i = names.indexOf(name);
        return i === -1 ? null : (stats[i] ?? null);
      };
      const [fgm, fga] = madeAttempted(col("FG"));
      const [fg3m, fg3a] = madeAttempted(col("3PT"));
      const [ftm, fta] = madeAttempted(col("FT"));
      if (athlete.displayName === null) throw missing("displayName");
      if (a.starter === null) throw missing("starter");
      playerBoxes.push({
        playerId: int(athlete.id),
        fullName: athlete.displayName,
        position: athlete.position?.abbreviation ?? null,
        teamId: int(boxSide.team.id),
        starter: a.starter,
        minutes: int(col("MIN")),
        pts: int(col("PTS")),
        fgm,
        fga,
        fg3m,
        fg3a,
        ftm,
        fta,
        oreb: int(col("OREB")),
        dreb: int(col("DREB")),
        ast: int(col("AST")),
        stl: int(col("STL")),
        blk: int(col("BLK")),
        tov: int(col("TO")),
        pf: int(col("PF")),
        plusMinus: int(col("+/-")),
      });
    }
  }

  const periods = [home, away].flatMap((c) => {
    const teamId = int(c.team.id);
    return (c.linescores ?? []).map((l, i): Period => ({ teamId, period: i + 1, pts: int(l.displayValue) }));
  });

  const plays = (json.plays ?? []).map((p): Play => {
    const participant = (i: number) => {
      const id = p.participants?.[i]?.athlete.id;
      return id ? int(id) : null;
    };
    return {
      period: p.period.number,
      clockSeconds: parseClock(p.clock.displayValue),
      typeText: truncate(p.type.text, 64),
      teamId: p.team ? int(p.team.id) : null,
      homeScore: p.homeScore,
      awayScore: p.awayScore,
      text: truncate(p.text ?? "", 255),
      players: [participant(0), participant(1), participant(2)],
      shooting: p.shootingPlay ?? false,
      scoreValue: p.scoreValue ?? 0,
      pointsAttempted: p.pointsAttempted ?? 0,
      position: p.coordinate ? courtPosition(p.coordinate.x, p.coordinate.y) : null,
    };
  });

  const attendance = json.gameInfo?.attendance ?? null;
  return {
    id: gameId,
    completed: competition.status.type.completed,
    seasonYear: json.header.season.year,
    seasonType: json.header.season.type,
    startsAt: parseEspnDate(competition.date),
    home: team(home),
    away: team(away),
    homeScore: int(home.score),
    awayScore: int(away.score),
    periods,
    venue: json.gameInfo?.venue?.fullName ?? null,
    note: json.header.gameNote,
    neutral: competition.neutralSite ?? false,
    attendance: attendance !== null && attendance > 0 ? attendance : null,
    teamBoxes,
    playerBoxes,
    plays,
  };
}

/**
 * ESPN puts a huge negative number in both coordinates of a play that has no
 * place on the court (free throws, timeouts); real ones fit well within ±200.
 */
export function courtPosition(x: number | null, y: number | null): CourtPosition | null {
  // Halves round away from zero; adding 0 turns -0 into 0.
  const onCourt = (v: number) => (Math.abs(v) <= 200 ? Math.sign(v) * Math.round(Math.abs(v)) + 0 : null);
  if (x === null || y === null) return null;
  const cx = onCourt(x);
  const cy = onCourt(y);
  return cx === null || cy === null ? null : { x: cx, y: cy };
}

/** ESPN's dates often have no seconds: "2026-11-03T00:30Z". */
export function parseEspnDate(value: string): Temporal.Instant {
  try {
    return Temporal.Instant.from(value);
  } catch (cause) {
    throw new Error(`ESPN date ${JSON.stringify(value)}`, { cause });
  }
}

const I64_MAX = 9223372036854775807n;

/**
 * Like `parseInt(value, 10)`: leading whitespace, an optional sign, then
 * digits; anything unparsable is 0. Unlike parseInt it never returns NaN, and
 * digits beyond a signed 64-bit integer count as unparsable.
 */
export function int(value: string | null): number {
  const digits = /^[+-]?(\d*)/.exec((value ?? "").trimStart())?.[1] ?? "";
  if (digits === "" || BigInt(digits) > I64_MAX) return 0;
  const n = Number(digits);
  return (value ?? "").trimStart().startsWith("-") ? -n + 0 : n;
}

/**
 * A decimal number as ESPN sends it, 0 for anything else. `Number()` alone
 * would also read hexadecimal, binary and octal literals.
 */
function number(value: string): number {
  const text = value.trim();
  if (!/^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/.test(text)) return 0;
  const n = Number(text);
  return Number.isFinite(n) ? n : 0;
}

/** "37-75" -> [37, 75] */
export function madeAttempted(value: string | null): [number, number] {
  const parts = (value ?? "").split("-");
  return [int(parts[0] ?? null), int(parts[1] ?? null)];
}

/** "11:24" or "45.2" -> seconds left in the period. */
export function parseClock(value: string): number {
  const [a = "", b] = value.split(":");
  return b === undefined ? number(a) : int(a) * 60 + number(b);
}

/** MySQL VARCHAR lengths count characters, not UTF-16 units. */
export function truncate(text: string, max: number): string {
  return Array.from(text).slice(0, max).join("");
}

// ---------------------------------------------------------------- ESPN JSON
//
// A document is read in full before anything is taken from it: a required
// field that is missing or has the wrong type rejects the whole document, also
// in a part that would have been skipped.

type ScheduleJson = {
  requestedSeason: { year: number | null } | null;
  events: EventJson[] | null;
};

type EventJson = {
  id: string;
  competitions: EventCompetitionJson[] | null;
};

type EventCompetitionJson = {
  status: { type: { completed: boolean | null } | null } | null;
  notes: { headline: string | null }[] | null;
};

type SummaryJson = {
  header: HeaderJson;
  gameInfo: { venue: { fullName: string | null } | null; attendance: number | null } | null;
  boxscore: BoxscoreJson;
  plays: PlayJson[] | null;
};

type HeaderJson = {
  season: { year: number; type: number };
  gameNote: string | null;
  competitions: CompetitionJson[];
};

type CompetitionJson = {
  date: string;
  neutralSite: boolean | null;
  status: { type: { completed: boolean } };
  competitors: CompetitorJson[];
};

type CompetitorJson = {
  id: string | null;
  homeAway: string;
  score: string | null;
  linescores: { displayValue: string | null }[] | null;
  team: { id: string | null; abbreviation: string; displayName: string; name: string };
};

type IdJson = { id: string | null };

type BoxscoreJson = {
  teams: { team: IdJson; statistics: { name: string | null; displayValue: string | null }[] }[];
  players: { team: IdJson; statistics: PlayerGroupJson[] }[] | null;
};

type PlayerGroupJson = {
  names: string[] | null;
  athletes: AthleteLineJson[];
};

type AthleteLineJson = {
  athlete: { id: string | null; displayName: string | null; position: { abbreviation: string | null } | null } | null;
  starter: boolean | null;
  didNotPlay: boolean | null;
  stats: string[] | null;
};

type PlayJson = {
  type: { text: string };
  text: string | null;
  period: { number: number };
  clock: { displayValue: string };
  team: IdJson | null;
  homeScore: number;
  awayScore: number;
  participants: { athlete: IdJson }[] | null;
  shootingPlay: boolean | null;
  scoreValue: number | null;
  pointsAttempted: number | null;
  coordinate: { x: number | null; y: number | null } | null;
};

class ShapeError extends Error {}

function shaped<T>(source: string, read: () => T): T {
  try {
    return read();
  } catch (cause) {
    if (cause instanceof ShapeError) throw new Error(`parsing ${source}: ${cause.message}`);
    throw cause;
  }
}

type Fields = Record<string, unknown>;
type Read<T> = (value: unknown, path: string) => T;

function wrong(path: string, expected: string): never {
  throw new ShapeError(`${path} should be ${expected}`);
}

const fields: Read<Fields> = (value, path) =>
  typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Fields) : wrong(path, "an object");
const string: Read<string> = (value, path) => (typeof value === "string" ? value : wrong(path, "a string"));
const boolean: Read<boolean> = (value, path) => (typeof value === "boolean" ? value : wrong(path, "a boolean"));
const integer: Read<number> = (value, path) =>
  typeof value === "number" && Number.isInteger(value) ? value : wrong(path, "a whole number");
const float: Read<number> = (value, path) => (typeof value === "number" ? value : wrong(path, "a number"));

function list<T>(read: Read<T>): Read<T[]> {
  return (value, path) =>
    Array.isArray(value) ? value.map((item, i) => read(item, `${path}[${i}]`)) : wrong(path, "an array");
}

/** A field that must be there and not null. */
function req<T>(of: Fields, key: string, path: string, read: Read<T>): T {
  const value = of[key];
  if (value === undefined) throw new ShapeError(`${path}.${key} is missing`);
  return read(value, `${path}.${key}`);
}

/** A field that may be missing or null. */
function opt<T>(of: Fields, key: string, path: string, read: Read<T>): T | null {
  const value = of[key];
  return value === undefined || value === null ? null : read(value, `${path}.${key}`);
}

const idJson: Read<IdJson> = (value, path) => ({ id: opt(fields(value, path), "id", path, string) });

function readSchedule(document: unknown): ScheduleJson {
  const o = fields(document, "schedule");
  return {
    requestedSeason: opt(o, "requestedSeason", "schedule", (value, path) => ({
      year: opt(fields(value, path), "year", path, integer),
    })),
    events: opt(
      o,
      "events",
      "schedule",
      list((value, path) => {
        const event = fields(value, path);
        return {
          id: req(event, "id", path, string),
          competitions: opt(
            event,
            "competitions",
            path,
            list((value, path) => {
              const competition = fields(value, path);
              return {
                status: opt(competition, "status", path, (value, path) => ({
                  type: opt(fields(value, path), "type", path, (value, path) => ({
                    completed: opt(fields(value, path), "completed", path, boolean),
                  })),
                })),
                notes: opt(
                  competition,
                  "notes",
                  path,
                  list((value, path) => ({ headline: opt(fields(value, path), "headline", path, string) })),
                ),
              };
            }),
          ),
        };
      }),
    ),
  };
}

const competitorJson: Read<CompetitorJson> = (value, path) => {
  const o = fields(value, path);
  return {
    id: opt(o, "id", path, string),
    homeAway: req(o, "homeAway", path, string),
    score: opt(o, "score", path, string),
    linescores: opt(
      o,
      "linescores",
      path,
      list((value, path) => ({ displayValue: opt(fields(value, path), "displayValue", path, string) })),
    ),
    team: req(o, "team", path, (value, path) => {
      const team = fields(value, path);
      return {
        id: opt(team, "id", path, string),
        abbreviation: req(team, "abbreviation", path, string),
        displayName: req(team, "displayName", path, string),
        name: req(team, "name", path, string),
      };
    }),
  };
};

const competitionJson: Read<CompetitionJson> = (value, path) => {
  const o = fields(value, path);
  return {
    date: req(o, "date", path, string),
    neutralSite: opt(o, "neutralSite", path, boolean),
    status: req(o, "status", path, (value, path) => ({
      type: req(fields(value, path), "type", path, (value, path) => ({
        completed: req(fields(value, path), "completed", path, boolean),
      })),
    })),
    competitors: req(o, "competitors", path, list(competitorJson)),
  };
};

const athleteLineJson: Read<AthleteLineJson> = (value, path) => {
  const o = fields(value, path);
  return {
    athlete: opt(o, "athlete", path, (value, path) => {
      const athlete = fields(value, path);
      return {
        id: opt(athlete, "id", path, string),
        displayName: opt(athlete, "displayName", path, string),
        position: opt(athlete, "position", path, (value, path) => ({
          abbreviation: opt(fields(value, path), "abbreviation", path, string),
        })),
      };
    }),
    starter: opt(o, "starter", path, boolean),
    didNotPlay: opt(o, "didNotPlay", path, boolean),
    stats: opt(o, "stats", path, list(string)),
  };
};

const playJson: Read<PlayJson> = (value, path) => {
  const o = fields(value, path);
  return {
    type: req(o, "type", path, (value, path) => ({ text: req(fields(value, path), "text", path, string) })),
    text: opt(o, "text", path, string),
    period: req(o, "period", path, (value, path) => ({ number: req(fields(value, path), "number", path, integer) })),
    clock: req(o, "clock", path, (value, path) => ({
      displayValue: req(fields(value, path), "displayValue", path, string),
    })),
    team: opt(o, "team", path, idJson),
    homeScore: req(o, "homeScore", path, integer),
    awayScore: req(o, "awayScore", path, integer),
    participants: opt(
      o,
      "participants",
      path,
      list((value, path) => ({ athlete: req(fields(value, path), "athlete", path, idJson) })),
    ),
    shootingPlay: opt(o, "shootingPlay", path, boolean),
    scoreValue: opt(o, "scoreValue", path, integer),
    pointsAttempted: opt(o, "pointsAttempted", path, integer),
    coordinate: opt(o, "coordinate", path, (value, path) => {
      const coordinate = fields(value, path);
      return { x: opt(coordinate, "x", path, float), y: opt(coordinate, "y", path, float) };
    }),
  };
};

function readSummary(document: unknown): SummaryJson {
  const o = fields(document, "summary");
  return {
    header: req(o, "header", "summary", (value, path) => {
      const header = fields(value, path);
      return {
        season: req(header, "season", path, (value, path) => {
          const season = fields(value, path);
          return { year: req(season, "year", path, integer), type: req(season, "type", path, integer) };
        }),
        gameNote: opt(header, "gameNote", path, string),
        competitions: req(header, "competitions", path, list(competitionJson)),
      };
    }),
    gameInfo: opt(o, "gameInfo", "summary", (value, path) => {
      const info = fields(value, path);
      return {
        venue: opt(info, "venue", path, (value, path) => ({
          fullName: opt(fields(value, path), "fullName", path, string),
        })),
        attendance: opt(info, "attendance", path, integer),
      };
    }),
    boxscore: req(o, "boxscore", "summary", (value, path) => {
      const boxscore = fields(value, path);
      return {
        teams: req(
          boxscore,
          "teams",
          path,
          list((value, path) => {
            const team = fields(value, path);
            return {
              team: req(team, "team", path, idJson),
              statistics: req(
                team,
                "statistics",
                path,
                list((value, path) => {
                  const stat = fields(value, path);
                  return {
                    name: opt(stat, "name", path, string),
                    displayValue: opt(stat, "displayValue", path, string),
                  };
                }),
              ),
            };
          }),
        ),
        players: opt(
          boxscore,
          "players",
          path,
          list((value, path) => {
            const side = fields(value, path);
            return {
              team: req(side, "team", path, idJson),
              statistics: req(
                side,
                "statistics",
                path,
                list((value, path) => {
                  const group = fields(value, path);
                  return {
                    names: opt(group, "names", path, list(string)),
                    athletes: req(group, "athletes", path, list(athleteLineJson)),
                  };
                }),
              ),
            };
          }),
        ),
      };
    }),
    plays: opt(o, "plays", "summary", list(playJson)),
  };
}
