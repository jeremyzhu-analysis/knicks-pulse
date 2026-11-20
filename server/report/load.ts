import type { Pool, RowDataPacket } from "mysql2/promise";

export type BoxScore = {
  fgm: number;
  fga: number;
  fg3m: number;
  fta: number;
  oreb: number;
  dreb: number;
  tov: number;
  paintPts: number;
  fastBreakPts: number;
  ptsOffTov: number;
};

export type PlayerGame = {
  playerId: number;
  fullName: string;
  position: string | null;
  starter: boolean;
  minutes: number;
  pts: number;
  fgm: number;
  fga: number;
  ftm: number;
  fta: number;
  oreb: number;
  dreb: number;
  reb: number;
  ast: number;
  stl: number;
  blk: number;
  tov: number;
  pf: number;
  plusMinus: number;
};

export type PlayRow = {
  period: number;
  clockSeconds: number;
  typeText: string;
  homeScore: number;
  awayScore: number;
  /** The player the play is credited to comes first: the shooter of a shot. */
  players: [number | null, number | null, number | null];
  /** Points the play scored. */
  scoreValue: number;
  /** A shot, free throws included. */
  shooting: boolean;
  /** 2 or 3 on a field-goal attempt. */
  pointsAttempted: number;
  /**
   * ESPN's court position (x across the floor, y out from the basket, in
   * feet); null where ESPN gives none.
   */
  position: { x: number; y: number } | null;
};

export type Opponent = { id: number; abbreviation: string; name: string };

/** One game seen from the report team's side. */
export type Game = {
  id: string;
  seasonYear: number;
  seasonType: number;
  /** ISO 8601 in UTC. */
  startsAt: string;
  /** True for the designated home team, also at a neutral site. */
  home: boolean;
  neutral: boolean;
  opponent: Opponent;
  venue: string | null;
  attendance: number | null;
  note: string | null;
  periods: number;
  pts: number;
  oppPts: number;
  us: BoxScore;
  them: BoxScore;
  /** Points by period, index 0 is Q1. */
  usByPeriod: number[];
  themByPeriod: number[];
  /** The report team's players. */
  players: PlayerGame[];
  opponentPlayers: PlayerGame[];
  plays: PlayRow[];
};

export type Dataset = {
  games: Game[];
  /** ISO 8601 in UTC. */
  syncedAt: string | null;
};

// DATETIME columns hold UTC; they're read as ISO strings of one fixed shape,
// so comparing two of them as text compares the times.
const UTC_ISO = "'%Y-%m-%dT%H:%i:%sZ'";
const ISO_SHAPE = /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/;

function utc(value: unknown): string {
  if (typeof value !== "string" || !ISO_SHAPE.test(value)) {
    throw new Error(`stored DATETIME ${JSON.stringify(value)}`);
  }
  return value;
}

type Row = RowDataPacket;

function groupBy(rows: Row[]): Map<number, Row[]> {
  const map = new Map<number, Row[]>();
  for (const row of rows) {
    const list = map.get(row.game_id);
    if (list) list.push(row);
    else map.set(row.game_id, [row]);
  }
  return map;
}

const boxScore = (r: Row): BoxScore => ({
  fgm: r.fgm,
  fga: r.fga,
  fg3m: r.fg3m,
  fta: r.fta,
  oreb: r.oreb,
  dreb: r.dreb,
  tov: r.tov,
  paintPts: r.paint_pts,
  fastBreakPts: r.fast_break_pts,
  ptsOffTov: r.pts_off_tov,
});

const playerGame = (p: Row): PlayerGame => ({
  playerId: p.player_id,
  fullName: p.full_name,
  position: p.position,
  starter: p.starter !== 0,
  minutes: p.minutes,
  pts: p.pts,
  fgm: p.fgm,
  fga: p.fga,
  ftm: p.ftm,
  fta: p.fta,
  oreb: p.oreb,
  dreb: p.dreb,
  reb: p.oreb + p.dreb,
  ast: p.ast,
  stl: p.stl,
  blk: p.blk,
  tov: p.tov,
  pf: p.pf,
  plusMinus: p.plus_minus,
});

function playRow(p: Row): PlayRow {
  // clock_s is DECIMAL; read as text, Number() gives the nearest double.
  const clockSeconds = Number(p.clock_s);
  if (typeof p.clock_s !== "string" || !Number.isFinite(clockSeconds)) {
    throw new Error(`clock_s ${JSON.stringify(p.clock_s)}`);
  }
  return {
    period: p.period,
    clockSeconds,
    typeText: p.type_text,
    homeScore: p.home_score,
    awayScore: p.away_score,
    players: [p.player1_id, p.player2_id, p.player3_id],
    scoreValue: p.score_value,
    shooting: p.shooting !== 0,
    pointsAttempted: p.points_attempted,
    position: p.x !== null && p.y !== null ? { x: p.x, y: p.y } : null,
  };
}

export async function loadDataset(pool: Pool, teamId: number): Promise<Dataset> {
  const team = [teamId, teamId];
  const [gameRows] = await pool.execute<Row[]>(
    `SELECT id, season_year, season_type, DATE_FORMAT(starts_at, ${UTC_ISO}) starts_at, home_team_id, away_team_id,
            home_score, away_score, periods, venue, note, DATE_FORMAT(synced_at, ${UTC_ISO}) synced_at,
            neutral, attendance
       FROM games WHERE home_team_id = ? OR away_team_id = ? ORDER BY games.starts_at`,
    team,
  );
  if (gameRows.length === 0) return { games: [], syncedAt: null };

  // The same games as above, so these queries never need an id list.
  const TEAM_GAMES = "(SELECT id FROM games WHERE home_team_id = ? OR away_team_id = ?)";
  const [[teams], [stats], [periods], [players], [plays]] = await Promise.all([
    pool.execute<Row[]>("SELECT id, abbreviation, display_name FROM teams"),
    pool.execute<Row[]>(
      `SELECT game_id, team_id, fgm, fga, fg3m, fta, oreb, dreb, tov, paint_pts, fast_break_pts, pts_off_tov
         FROM game_team_stats WHERE game_id IN ${TEAM_GAMES}`,
      team,
    ),
    pool.execute<Row[]>(`SELECT game_id, team_id, period, pts FROM game_periods WHERE game_id IN ${TEAM_GAMES}`, team),
    // Player order decides ties later (sorting by minutes, the top scorer), so
    // the query fixes it instead of leaving it to the query plan.
    pool.execute<Row[]>(
      `SELECT gp.game_id, gp.player_id, gp.team_id, p.full_name, p.position, gp.starter, gp.minutes,
              gp.pts, gp.fgm, gp.fga, gp.ftm, gp.fta, gp.oreb, gp.dreb, gp.ast, gp.stl, gp.blk,
              gp.tov, gp.pf, gp.plus_minus
         FROM game_players gp JOIN players p ON p.id = gp.player_id
        WHERE gp.game_id IN ${TEAM_GAMES}
        ORDER BY gp.game_id, gp.player_id`,
      team,
    ),
    pool.execute<Row[]>(
      `SELECT game_id, period, CAST(clock_s AS CHAR) clock_s, type_text, home_score, away_score,
              player1_id, player2_id, player3_id, score_value, shooting, points_attempted, x, y
         FROM plays WHERE game_id IN ${TEAM_GAMES} ORDER BY game_id, ord`,
      team,
    ),
  ]);

  const teamById = new Map(teams.map((t) => [t.id as number, t]));
  const statsByGame = groupBy(stats);
  const periodsByGame = groupBy(periods);
  const playersByGame = groupBy(players);
  const playsByGame = groupBy(plays);

  let syncedAt: string | null = null;
  const games: Game[] = [];
  for (const g of gameRows) {
    const synced = utc(g.synced_at);
    if (syncedAt === null || synced > syncedAt) syncedAt = synced;
    const home = g.home_team_id === teamId;
    const oppId: number = home ? g.away_team_id : g.home_team_id;
    const opp = teamById.get(oppId);
    const gameStats = statsByGame.get(g.id) ?? [];
    const boxFor = (id: number): BoxScore => {
      const row = gameStats.find((s) => s.team_id === id);
      if (!row) throw new Error("Game is missing team stats");
      return boxScore(row);
    };
    const gamePeriods = periodsByGame.get(g.id) ?? [];
    const byPeriod = (id: number): number[] => {
      const list: number[] = new Array(g.periods).fill(0);
      for (const p of gamePeriods) {
        if (p.team_id !== id) continue;
        const i = Math.max(p.period - 1, 0);
        while (list.length <= i) list.push(0);
        list[i] = p.pts;
      }
      return list;
    };
    const lines = playersByGame.get(g.id) ?? [];
    games.push({
      id: String(g.id),
      seasonYear: g.season_year,
      seasonType: g.season_type,
      startsAt: utc(g.starts_at),
      home,
      neutral: g.neutral !== 0,
      opponent: {
        id: oppId,
        abbreviation: opp ? opp.abbreviation : "?",
        name: opp ? opp.display_name : "Opponent",
      },
      venue: g.venue,
      attendance: g.attendance,
      note: g.note,
      periods: g.periods,
      pts: home ? g.home_score : g.away_score,
      oppPts: home ? g.away_score : g.home_score,
      us: boxFor(teamId),
      them: boxFor(oppId),
      usByPeriod: byPeriod(teamId),
      themByPeriod: byPeriod(oppId),
      players: lines.filter((p) => p.team_id === teamId).map(playerGame),
      opponentPlayers: lines.filter((p) => p.team_id !== teamId).map(playerGame),
      plays: (playsByGame.get(g.id) ?? []).map(playRow),
    });
  }
  return { games, syncedAt };
}
