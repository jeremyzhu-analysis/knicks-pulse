// Client for ESPN's public site API (no key, undocumented). Only the fields
// this site stores are typed; everything arrives as strings or may be missing.

const BASE = "https://site.api.espn.com/apis/site/v2/sports/basketball/nba";

export const SeasonType = { regular: 2, playoffs: 3 } as const;

export class EspnHttpError extends Error {
  status: number;
  constructor(status: number, url: string) {
    super(`ESPN ${status} for ${url}`);
    this.status = status;
  }
}

async function getJson(url: string): Promise<unknown> {
  for (let attempt = 1; ; attempt++) {
    const res = await fetch(url, { headers: { accept: "application/json" } });
    if (res.ok) return res.json();
    if (attempt >= 3 || res.status < 500) throw new EspnHttpError(res.status, url);
    await new Promise((resolve) => setTimeout(resolve, 1000 * attempt));
  }
}

interface ScheduleJson {
  requestedSeason?: { year: number };
  events?: { id: string; competitions?: { status?: { type?: { completed?: boolean } } }[] }[];
}

export interface Schedule {
  seasonYear: number;
  completedGameIds: string[];
}

/** Without a season ESPN answers with the current one. */
export async function fetchSchedule(teamSlug: string, seasonYear: number | null, seasonType: number): Promise<Schedule> {
  const params = new URLSearchParams({ seasontype: String(seasonType) });
  if (seasonYear !== null) params.set("season", String(seasonYear));
  const json = (await getJson(`${BASE}/teams/${teamSlug}/schedule?${params}`)) as ScheduleJson;
  // A season type that hasn't started (playoffs during the regular season)
  // comes back without requestedSeason and with no events.
  const year = json.requestedSeason?.year ?? seasonYear;
  if (!year) throw new Error("ESPN schedule has no requestedSeason");
  return {
    seasonYear: year,
    completedGameIds: (json.events ?? [])
      .filter((event) => event.competitions?.[0]?.status?.type?.completed)
      .map((event) => event.id),
  };
}

interface SummaryJson {
  header: {
    season: { year: number; type: number };
    gameNote?: string;
    competitions: {
      date: string;
      status: { type: { completed: boolean } };
      competitors: {
        id: string;
        homeAway: "home" | "away";
        score: string;
        linescores?: { displayValue: string }[];
        team: { id: string; abbreviation: string; displayName: string; name: string };
      }[];
    }[];
  };
  gameInfo?: { venue?: { fullName?: string } };
  boxscore: {
    teams: { team: { id: string }; statistics: { name: string; displayValue: string }[] }[];
    players?: {
      team: { id: string };
      statistics: {
        names: string[];
        athletes: {
          athlete: { id: string; displayName: string; position?: { abbreviation?: string } };
          starter: boolean;
          didNotPlay?: boolean;
          stats: string[];
        }[];
      }[];
    }[];
  };
  plays?: {
    type: { text: string };
    text?: string;
    period: { number: number };
    clock: { displayValue: string };
    team?: { id: string };
    homeScore: number;
    awayScore: number;
    participants?: { athlete: { id: string } }[];
  }[];
}

export interface Team {
  id: number;
  abbreviation: string;
  displayName: string;
  shortName: string;
}

export interface TeamBox {
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
}

export interface PlayerBox {
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
}

export interface Play {
  period: number;
  clockSeconds: number;
  typeText: string;
  teamId: number | null;
  homeScore: number;
  awayScore: number;
  text: string;
  players: (number | null)[];
}

export interface GameSummary {
  id: string;
  completed: boolean;
  seasonYear: number;
  seasonType: number;
  startsAt: Date;
  home: Team;
  away: Team;
  homeScore: number;
  awayScore: number;
  periods: { teamId: number; period: number; pts: number }[];
  venue: string | null;
  note: string | null;
  teamBoxes: TeamBox[];
  playerBoxes: PlayerBox[];
  plays: Play[];
}

function int(value: string | undefined): number {
  const n = Number.parseInt(value ?? "", 10);
  return Number.isFinite(n) ? n : 0;
}

/** "37-75" -> [37, 75] */
function madeAttempted(value: string | undefined): [number, number] {
  const [made, attempted] = (value ?? "").split("-");
  return [int(made), int(attempted)];
}

/** "11:24" or "45.2" -> seconds left in the period. */
export function parseClock(value: string): number {
  const [a, b] = value.split(":");
  return b === undefined ? Number(a) || 0 : int(a) * 60 + (Number(b) || 0);
}

export async function fetchGameSummary(gameId: string): Promise<GameSummary> {
  const json = (await getJson(`${BASE}/summary?event=${gameId}`)) as SummaryJson;
  const competition = json.header.competitions[0];
  if (!competition) throw new Error(`Game ${gameId} has no competition`);
  const home = competition.competitors.find((c) => c.homeAway === "home");
  const away = competition.competitors.find((c) => c.homeAway === "away");
  if (!home || !away) throw new Error(`Game ${gameId} is missing a team`);
  const team = (c: typeof home): Team => ({
    id: int(c.team.id),
    abbreviation: c.team.abbreviation,
    displayName: c.team.displayName,
    shortName: c.team.name,
  });

  const teamBoxes = json.boxscore.teams.map((t): TeamBox => {
    const stat = (name: string) => t.statistics.find((s) => s.name === name)?.displayValue;
    const [fgm, fga] = madeAttempted(stat("fieldGoalsMade-fieldGoalsAttempted"));
    const [fg3m, fg3a] = madeAttempted(stat("threePointFieldGoalsMade-threePointFieldGoalsAttempted"));
    const [ftm, fta] = madeAttempted(stat("freeThrowsMade-freeThrowsAttempted"));
    const teamId = int(t.team.id);
    return {
      teamId,
      pts: int(teamId === int(home.id) ? home.score : away.score),
      fgm, fga, fg3m, fg3a, ftm, fta,
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

  const playerBoxes: PlayerBox[] = [];
  for (const side of json.boxscore.players ?? []) {
    const group = side.statistics[0];
    if (!group) continue;
    const col = (row: string[], name: string) => row[group.names.indexOf(name)];
    for (const a of group.athletes) {
      if (a.didNotPlay || a.stats.length === 0) continue;
      const [fgm, fga] = madeAttempted(col(a.stats, "FG"));
      const [fg3m, fg3a] = madeAttempted(col(a.stats, "3PT"));
      const [ftm, fta] = madeAttempted(col(a.stats, "FT"));
      playerBoxes.push({
        playerId: int(a.athlete.id),
        fullName: a.athlete.displayName,
        position: a.athlete.position?.abbreviation ?? null,
        teamId: int(side.team.id),
        starter: a.starter,
        minutes: int(col(a.stats, "MIN")),
        pts: int(col(a.stats, "PTS")),
        fgm, fga, fg3m, fg3a, ftm, fta,
        oreb: int(col(a.stats, "OREB")),
        dreb: int(col(a.stats, "DREB")),
        ast: int(col(a.stats, "AST")),
        stl: int(col(a.stats, "STL")),
        blk: int(col(a.stats, "BLK")),
        tov: int(col(a.stats, "TO")),
        pf: int(col(a.stats, "PF")),
        plusMinus: int(col(a.stats, "+/-")),
      });
    }
  }

  const periods = [home, away].flatMap((c) =>
    (c.linescores ?? []).map((l, i) => ({ teamId: int(c.team.id), period: i + 1, pts: int(l.displayValue) })),
  );

  return {
    id: gameId,
    completed: competition.status.type.completed,
    seasonYear: json.header.season.year,
    seasonType: json.header.season.type,
    startsAt: new Date(competition.date),
    home: team(home),
    away: team(away),
    homeScore: int(home.score),
    awayScore: int(away.score),
    periods,
    venue: json.gameInfo?.venue?.fullName ?? null,
    note: json.header.gameNote ?? null,
    teamBoxes,
    playerBoxes,
    plays: (json.plays ?? []).map((p) => ({
      period: p.period.number,
      clockSeconds: parseClock(p.clock.displayValue),
      typeText: p.type.text.slice(0, 64),
      teamId: p.team ? int(p.team.id) : null,
      homeScore: p.homeScore,
      awayScore: p.awayScore,
      text: (p.text ?? "").slice(0, 255),
      players: [0, 1, 2].map((i) => {
        const id = p.participants?.[i]?.athlete.id;
        return id ? int(id) : null;
      }),
    })),
  };
}
