/**
 * A game from ESPN's core API, for the finished games whose site summary
 * answers 404. The core API spreads a game over many small documents linked
 * by `$ref` URLs; this reads the ones that make up a `GameSummary`.
 *
 * These documents are read leniently: a field that is missing or of another
 * type counts as absent.
 */

import { courtPosition, int, parseClock, parseEspnDate, truncate } from "./espn.ts";
import type { GameSummary, Period, Play, PlayerBox, Team, TeamBox } from "./espn.ts";

const HOST = "https://sports.core.api.espn.com/";
const EVENTS = "https://sports.core.api.espn.com/v2/sports/basketball/leagues/nba/events";

/** The documents of one game, as fetched. */
export type Documents = {
  competition: unknown;
  plays: unknown[];
  sides: Side[];
};

export type Side = {
  competitor: unknown;
  team: unknown;
  statistics: unknown;
  linescores: unknown;
  score: unknown;
  players: RosterPlayer[];
};

/** A roster entry of a player who played. */
export type RosterPlayer = {
  entry: unknown;
  athlete: unknown;
  statistics: unknown;
};

/** Fetches a URL and returns its JSON; `Espn.getJson`. */
export type GetJson = (url: string) => Promise<unknown>;

/** Requests go out one at a time: about 65 for a game. */
export async function coreGameSummary(
  getJson: GetJson,
  gameId: string,
  seasonYear: number,
  seasonType: number,
  note: string | null,
): Promise<GameSummary> {
  const base = `${EVENTS}/${gameId}/competitions/${gameId}`;
  const competition = await getJson(`${base}?lang=en`);

  const plays: unknown[] = [];
  for (let page = 1; ; page++) {
    const json = await getJson(`${base}/plays?limit=1000&page=${page}&lang=en`);
    plays.push(...items(at(json, "items")));
    if (page >= (wholeNumber(at(json, "pageCount")) ?? 1)) break;
  }

  /**
   * Follows a `{"$ref": url}` link. ESPN writes these with http; they are
   * fetched over https, and only from the core API's own host.
   */
  const getRef = (link: unknown): Promise<unknown> => {
    const ref = at(link, "$ref");
    if (typeof ref !== "string") throw new Error("ESPN core document has no $ref");
    const url = ref.replace("http://", "https://");
    if (!url.startsWith(HOST)) throw new Error(`ESPN core $ref points elsewhere: ${url}`);
    return getJson(url);
  };

  const sides: Side[] = [];
  for (const competitor of items(at(competition, "competitors"))) {
    const ofSide = `${base}/competitors/${text(at(competitor, "id"))}`;
    const team = await getRef(at(competitor, "team"));
    const roster = await getJson(`${ofSide}/roster?lang=en`);
    const statistics = await getJson(`${ofSide}/statistics?lang=en`);
    const linescores = await getJson(`${ofSide}/linescores?lang=en`);
    const score = await getJson(`${ofSide}/score?lang=en`);
    const players: RosterPlayer[] = [];
    for (const entry of items(at(roster, "entries"))) {
      if (at(entry, "didNotPlay") === true) continue;
      const playerId = number(at(entry, "playerId"));
      players.push({
        athlete: await getRef(at(entry, "athlete")),
        statistics: await getJson(`${ofSide}/roster/${playerId}/statistics/0?lang=en`),
        entry,
      });
    }
    sides.push({ competitor, team, statistics, linescores, score, players });
  }

  return build(gameId, seasonYear, seasonType, note, { competition, plays, sides });
}

/**
 * The game was listed as completed by the schedule that led here, so it is
 * reported as completed.
 */
export function build(
  gameId: string,
  seasonYear: number,
  seasonType: number,
  note: string | null,
  docs: Documents,
): GameSummary {
  const side = (name: string) => docs.sides.find((s) => at(s.competitor, "homeAway") === name);
  const home = side("home");
  const away = side("away");
  if (!home || !away) throw new Error(`Game ${gameId} is missing a team`);
  const teamId = (s: Side) => number(at(s.team, "id"));
  const team = (s: Side): Team => ({
    id: teamId(s),
    abbreviation: text(at(s.team, "abbreviation")),
    displayName: text(at(s.team, "displayName")),
    shortName: text(at(s.team, "name")),
  });

  const teamBoxes: TeamBox[] = [];
  const playerBoxes: PlayerBox[] = [];
  const periods: Period[] = [];
  for (const s of [home, away]) {
    const teamStat = (name: string) => stat(s.statistics, name);
    teamBoxes.push({
      teamId: teamId(s),
      pts: number(at(s.score, "value")),
      fgm: teamStat("fieldGoalsMade"),
      fga: teamStat("fieldGoalsAttempted"),
      fg3m: teamStat("threePointFieldGoalsMade"),
      fg3a: teamStat("threePointFieldGoalsAttempted"),
      ftm: teamStat("freeThrowsMade"),
      fta: teamStat("freeThrowsAttempted"),
      oreb: teamStat("offensiveRebounds"),
      dreb: teamStat("defensiveRebounds"),
      ast: teamStat("assists"),
      stl: teamStat("steals"),
      blk: teamStat("blocks"),
      tov: teamStat("totalTurnovers") || teamStat("turnovers"),
      paintPts: teamStat("pointsInPaint"),
      fastBreakPts: teamStat("fastBreakPoints"),
      ptsOffTov: teamStat("turnoverPoints"),
    });
    for (const p of s.players) {
      const playerStat = (name: string) => stat(p.statistics, name);
      const fullName = [at(p.athlete, "displayName"), at(p.entry, "displayName")].find((v) => typeof v === "string");
      if (typeof fullName !== "string") throw new Error(`Game ${gameId}: a player who played has no name`);
      const position = at(at(p.athlete, "position"), "abbreviation");
      playerBoxes.push({
        playerId: number(at(p.entry, "playerId")),
        fullName,
        position: typeof position === "string" ? position : null,
        teamId: teamId(s),
        starter: at(p.entry, "starter") === true,
        minutes: playerStat("minutes"),
        pts: playerStat("points"),
        fgm: playerStat("fieldGoalsMade"),
        fga: playerStat("fieldGoalsAttempted"),
        fg3m: playerStat("threePointFieldGoalsMade"),
        fg3a: playerStat("threePointFieldGoalsAttempted"),
        ftm: playerStat("freeThrowsMade"),
        fta: playerStat("freeThrowsAttempted"),
        oreb: playerStat("offensiveRebounds"),
        dreb: playerStat("defensiveRebounds"),
        ast: playerStat("assists"),
        stl: playerStat("steals"),
        blk: playerStat("blocks"),
        tov: playerStat("turnovers"),
        pf: playerStat("fouls"),
        plusMinus: playerStat("plusMinus"),
      });
    }
    items(at(s.linescores, "items")).forEach((line, i) => {
      periods.push({ teamId: teamId(s), period: i + 1, pts: number(at(line, "value")) });
    });
  }

  const plays = docs.plays.map((p): Play => {
    // The sort is stable: participants with the same order keep ESPN's.
    const participants = [...items(at(p, "participants"))].sort(
      (a, b) => number(at(a, "order")) - number(at(b, "order")),
    );
    const participant = (i: number) => (i < participants.length ? idInRef(at(participants[i], "athlete"), "/athletes/") : null);
    const coordinate = at(p, "coordinate");
    return {
      period: number(at(at(p, "period"), "number")),
      clockSeconds: parseClock(textOr(at(at(p, "clock"), "displayValue"), "")),
      typeText: truncate(textOr(at(at(p, "type"), "text"), ""), 64),
      teamId: idInRef(at(p, "team"), "/teams/"),
      homeScore: number(at(p, "homeScore")),
      awayScore: number(at(p, "awayScore")),
      text: truncate(textOr(at(p, "text"), ""), 255),
      players: [participant(0), participant(1), participant(2)],
      shooting: at(p, "shootingPlay") === true,
      scoreValue: number(at(p, "scoreValue")),
      pointsAttempted: number(at(p, "pointsAttempted")),
      position: courtPosition(float(at(coordinate, "x")), float(at(coordinate, "y"))),
    };
  });

  const date = at(docs.competition, "date");
  if (typeof date !== "string") throw new Error(`Game ${gameId} has no date`);
  const venue = at(at(docs.competition, "venue"), "fullName");
  const attendance = wholeNumber(at(docs.competition, "attendance"));
  return {
    id: gameId,
    completed: true,
    seasonYear,
    seasonType,
    startsAt: parseEspnDate(date),
    home: team(home),
    away: team(away),
    homeScore: number(at(home.score, "value")),
    awayScore: number(at(away.score, "value")),
    periods,
    venue: typeof venue === "string" ? venue : null,
    note,
    neutral: at(docs.competition, "neutralSite") === true,
    attendance: attendance !== null && attendance > 0 ? attendance : null,
    teamBoxes,
    playerBoxes,
    plays,
  };
}

/** A field of a JSON object; null when `value` isn't an object or lacks it. */
function at(value: unknown, key: string): unknown {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  return Object.hasOwn(value, key) ? (value as Record<string, unknown>)[key] : null;
}

/** The elements of a JSON array; none for anything else. */
function items(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function textOr(value: unknown, fallback: string): string {
  return typeof value === "string" ? value : fallback;
}

function float(value: unknown): number | null {
  return typeof value === "number" ? value : null;
}

function wholeNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) ? value : null;
}

/** A count that ESPN writes as a number (often with ".0") or as a string. */
function number(value: unknown): number {
  // Adding 0 turns the -0 that truncating -0.5 gives into 0.
  if (typeof value === "number") return Math.trunc(value) + 0;
  if (typeof value === "string") return int(value);
  return 0;
}

function text(value: unknown): string {
  if (typeof value === "string") return value;
  if (typeof value === "number") return String(value);
  return "";
}

/**
 * A named stat of a statistics document, whichever category holds it; 0 when
 * it is absent.
 */
function stat(statistics: unknown, name: string): number {
  for (const category of items(at(at(statistics, "splits"), "categories"))) {
    for (const s of items(at(category, "stats"))) {
      if (at(s, "name") === name) return number(at(s, "value"));
    }
  }
  return 0;
}

/** The id after `marker` in a `$ref` URL: ".../athletes/3934672?lang=en". */
function idInRef(link: unknown, marker: string): number | null {
  const url = at(link, "$ref");
  if (typeof url !== "string") return null;
  const found = url.indexOf(marker);
  if (found === -1) return null;
  const digits = /^\d*/.exec(url.slice(found + marker.length))?.[0] ?? "";
  if (digits === "" || BigInt(digits) > 9223372036854775807n) return null;
  return Number(digits);
}
