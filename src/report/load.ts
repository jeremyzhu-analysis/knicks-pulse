import { select } from "../db.ts";

export interface Box {
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

export interface PlayerGame {
  playerId: number;
  fullName: string;
  position: string | null;
  starter: boolean;
  minutes: number;
  pts: number;
  fgm: number;
  fga: number;
  fg3m: number;
  fta: number;
  reb: number;
  ast: number;
  stl: number;
  blk: number;
  tov: number;
  plusMinus: number;
}

export interface PlayRow {
  period: number;
  clockSeconds: number;
  typeText: string;
  homeScore: number;
  awayScore: number;
  players: (number | null)[];
}

export interface Opponent {
  id: number;
  abbreviation: string;
  name: string;
}

/** One game seen from the report team's side. */
export interface Game {
  id: string;
  seasonYear: number;
  seasonType: number;
  startsAt: Date;
  home: boolean;
  opponent: Opponent;
  venue: string | null;
  note: string | null;
  periods: number;
  pts: number;
  oppPts: number;
  us: Box;
  them: Box;
  /** Points by period, index 0 is Q1. */
  usByPeriod: number[];
  themByPeriod: number[];
  players: PlayerGame[];
  plays: PlayRow[];
}

export interface Dataset {
  games: Game[];
  syncedAt: Date | null;
}

interface GameDb {
  id: string;
  season_year: number;
  season_type: number;
  starts_at: Date;
  home_team_id: number;
  away_team_id: number;
  home_score: number;
  away_score: number;
  periods: number;
  venue: string | null;
  note: string | null;
  synced_at: Date;
}

interface TeamStatsDb {
  game_id: string;
  team_id: number;
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
  paint_pts: number;
  fast_break_pts: number;
  pts_off_tov: number;
}

function toBox(row: TeamStatsDb | undefined): Box {
  if (!row) throw new Error("Game is missing team stats");
  return {
    pts: row.pts, fgm: row.fgm, fga: row.fga, fg3m: row.fg3m, fg3a: row.fg3a, ftm: row.ftm, fta: row.fta,
    oreb: row.oreb, dreb: row.dreb, ast: row.ast, stl: row.stl, blk: row.blk, tov: row.tov,
    paintPts: row.paint_pts, fastBreakPts: row.fast_break_pts, ptsOffTov: row.pts_off_tov,
  };
}

function groupBy<T>(rows: T[], key: (row: T) => string): Map<string, T[]> {
  const map = new Map<string, T[]>();
  for (const row of rows) {
    const k = key(row);
    let list = map.get(k);
    if (!list) map.set(k, (list = []));
    list.push(row);
  }
  return map;
}

export async function loadDataset(teamId: number): Promise<Dataset> {
  const gameRows = await select<GameDb>(
    `SELECT id, season_year, season_type, starts_at, home_team_id, away_team_id,
            home_score, away_score, periods, venue, note, synced_at
       FROM games WHERE home_team_id = ? OR away_team_id = ? ORDER BY starts_at`,
    [teamId, teamId],
  );
  if (gameRows.length === 0) return { games: [], syncedAt: null };
  const ids = gameRows.map((g) => g.id);

  const [teams, stats, periods, players, plays] = await Promise.all([
    select<{ id: number; abbreviation: string; display_name: string }>("SELECT id, abbreviation, display_name FROM teams"),
    select<TeamStatsDb>("SELECT * FROM game_team_stats s WHERE game_id IN (?)", [ids]),
    select<{ game_id: string; team_id: number; period: number; pts: number }>(
      "SELECT game_id, team_id, period, pts FROM game_periods WHERE game_id IN (?)",
      [ids],
    ),
    select<{
      game_id: string; player_id: number; full_name: string; position: string | null; starter: number; minutes: number;
      pts: number; fgm: number; fga: number; fg3m: number; fta: number; oreb: number; dreb: number;
      ast: number; stl: number; blk: number; tov: number; plus_minus: number;
    }>(
      `SELECT gp.game_id, gp.player_id, p.full_name, p.position, gp.starter, gp.minutes,
              gp.pts, gp.fgm, gp.fga, gp.fg3m, gp.fta, gp.oreb, gp.dreb, gp.ast, gp.stl, gp.blk, gp.tov, gp.plus_minus
         FROM game_players gp JOIN players p ON p.id = gp.player_id
        WHERE gp.team_id = ? AND gp.game_id IN (?)`,
      [teamId, ids],
    ),
    select<{
      game_id: string; period: number; clock_s: number; type_text: string; home_score: number; away_score: number;
      player1_id: number | null; player2_id: number | null; player3_id: number | null;
    }>(
      `SELECT game_id, period, clock_s, type_text, home_score, away_score, player1_id, player2_id, player3_id
         FROM plays WHERE game_id IN (?) ORDER BY game_id, ord`,
      [ids],
    ),
  ]);

  const teamById = new Map(teams.map((t) => [t.id, t]));
  const statsByGame = groupBy(stats, (r) => r.game_id);
  const periodsByGame = groupBy(periods, (r) => r.game_id);
  const playersByGame = groupBy(players, (r) => r.game_id);
  const playsByGame = groupBy(plays, (r) => r.game_id);

  const games = gameRows.map((g): Game => {
    const home = g.home_team_id === teamId;
    const oppId = home ? g.away_team_id : g.home_team_id;
    const opp = teamById.get(oppId);
    const gameStats = statsByGame.get(g.id) ?? [];
    const byPeriod = (team: number) => {
      const list = new Array<number>(g.periods).fill(0);
      for (const p of periodsByGame.get(g.id) ?? []) if (p.team_id === team) list[p.period - 1] = p.pts;
      return list;
    };
    return {
      id: g.id,
      seasonYear: g.season_year,
      seasonType: g.season_type,
      startsAt: g.starts_at,
      home,
      opponent: { id: oppId, abbreviation: opp?.abbreviation ?? "?", name: opp?.display_name ?? "Opponent" },
      venue: g.venue,
      note: g.note,
      periods: g.periods,
      pts: home ? g.home_score : g.away_score,
      oppPts: home ? g.away_score : g.home_score,
      us: toBox(gameStats.find((s) => s.team_id === teamId)),
      them: toBox(gameStats.find((s) => s.team_id === oppId)),
      usByPeriod: byPeriod(teamId),
      themByPeriod: byPeriod(oppId),
      players: (playersByGame.get(g.id) ?? []).map((p) => ({
        playerId: p.player_id, fullName: p.full_name, position: p.position, starter: Boolean(p.starter),
        minutes: p.minutes, pts: p.pts, fgm: p.fgm, fga: p.fga, fg3m: p.fg3m, fta: p.fta,
        reb: p.oreb + p.dreb, ast: p.ast, stl: p.stl, blk: p.blk, tov: p.tov, plusMinus: p.plus_minus,
      })),
      plays: (playsByGame.get(g.id) ?? []).map((p) => ({
        period: p.period,
        clockSeconds: p.clock_s,
        typeText: p.type_text,
        homeScore: p.home_score,
        awayScore: p.away_score,
        players: [p.player1_id, p.player2_id, p.player3_id],
      })),
    };
  });

  const syncedAt = gameRows.reduce<Date | null>((max, g) => (!max || g.synced_at > max ? g.synced_at : max), null);
  return { games, syncedAt };
}
