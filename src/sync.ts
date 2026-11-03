import type { PoolConnection } from "mysql2/promise";
import { config } from "./config.ts";
import { pool, select } from "./db.ts";
import { EspnHttpError, fetchGameSummary, fetchSchedule, SeasonType, type GameSummary } from "./espn.ts";

export interface SyncResult {
  completed: number;
  added: number;
}

let running: Promise<SyncResult> | null = null;

/**
 * Stores every completed game of the current and previous season (regular
 * season and playoffs) that isn't in the database yet. Finished games don't
 * change, so a stored game is never fetched again.
 */
export function syncGames(log: (line: string) => void = () => {}): Promise<SyncResult> {
  running ??= run(log).finally(() => {
    running = null;
  });
  return running;
}

async function run(log: (line: string) => void): Promise<SyncResult> {
  const current = await fetchSchedule(config.team.slug, null, SeasonType.regular);
  const year = current.seasonYear;
  const schedules = [
    current,
    await fetchSchedule(config.team.slug, year, SeasonType.playoffs),
    await fetchSchedule(config.team.slug, year - 1, SeasonType.regular),
    await fetchSchedule(config.team.slug, year - 1, SeasonType.playoffs),
  ];
  const ids = [...new Set(schedules.flatMap((s) => s.completedGameIds))];
  const stored = ids.length
    ? new Set((await select<{ id: string }>("SELECT id FROM games WHERE id IN (?)", [ids])).map((r) => r.id))
    : new Set<string>();
  const missing = ids.filter((id) => !stored.has(id));
  log(`${ids.length} completed games, ${missing.length} to fetch.`);

  let added = 0;
  for (const id of missing) {
    let game: GameSummary;
    try {
      game = await fetchGameSummary(id);
    } catch (error) {
      // ESPN lists some finished games whose summary answers 404. Skipping
      // leaves them unstored, so every later sync asks for them again.
      if (error instanceof EspnHttpError && error.status === 404) {
        log(`Skipped game ${id}: ESPN has no summary for it.`);
        continue;
      }
      throw error;
    }
    if (!game.completed) continue;
    await storeGame(game);
    added++;
    log(`Stored ${game.startsAt.toISOString().slice(0, 10)} ${game.away.abbreviation} ${game.awayScore} at ${game.home.abbreviation} ${game.homeScore}`);
  }
  return { completed: ids.length, added };
}

async function insert(conn: PoolConnection, table: string, columns: string[], rows: unknown[][]): Promise<void> {
  if (rows.length === 0) return;
  await conn.query(`INSERT INTO ${table} (${columns.join(", ")}) VALUES ?`, [rows]);
}

async function storeGame(game: GameSummary): Promise<void> {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    for (const team of [game.home, game.away]) {
      await conn.query(
        `INSERT INTO teams (id, abbreviation, display_name, short_name) VALUES (?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE abbreviation = VALUES(abbreviation), display_name = VALUES(display_name), short_name = VALUES(short_name)`,
        [team.id, team.abbreviation, team.displayName, team.shortName],
      );
    }
    if (game.playerBoxes.length) {
      await conn.query(
        `INSERT INTO players (id, full_name, position) VALUES ?
         ON DUPLICATE KEY UPDATE full_name = VALUES(full_name), position = VALUES(position)`,
        [game.playerBoxes.map((p) => [p.playerId, p.fullName, p.position])],
      );
    }
    await conn.query("DELETE FROM games WHERE id = ?", [game.id]);
    const periodCount = Math.max(4, ...game.periods.map((p) => p.period));
    await conn.query(
      `INSERT INTO games (id, season_year, season_type, starts_at, home_team_id, away_team_id, home_score, away_score, periods, venue, note, synced_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, UTC_TIMESTAMP())`,
      [game.id, game.seasonYear, game.seasonType, game.startsAt, game.home.id, game.away.id, game.homeScore, game.awayScore, periodCount, game.venue, game.note],
    );
    await insert(
      conn,
      "game_team_stats",
      ["game_id", "team_id", "pts", "fgm", "fga", "fg3m", "fg3a", "ftm", "fta", "oreb", "dreb", "ast", "stl", "blk", "tov", "paint_pts", "fast_break_pts", "pts_off_tov"],
      game.teamBoxes.map((t) => [game.id, t.teamId, t.pts, t.fgm, t.fga, t.fg3m, t.fg3a, t.ftm, t.fta, t.oreb, t.dreb, t.ast, t.stl, t.blk, t.tov, t.paintPts, t.fastBreakPts, t.ptsOffTov]),
    );
    await insert(conn, "game_periods", ["game_id", "team_id", "period", "pts"], game.periods.map((p) => [game.id, p.teamId, p.period, p.pts]));
    await insert(
      conn,
      "game_players",
      ["game_id", "player_id", "team_id", "starter", "minutes", "pts", "fgm", "fga", "fg3m", "fg3a", "ftm", "fta", "oreb", "dreb", "ast", "stl", "blk", "tov", "pf", "plus_minus"],
      game.playerBoxes.map((p) => [game.id, p.playerId, p.teamId, p.starter, p.minutes, p.pts, p.fgm, p.fga, p.fg3m, p.fg3a, p.ftm, p.fta, p.oreb, p.dreb, p.ast, p.stl, p.blk, p.tov, p.pf, p.plusMinus]),
    );
    await insert(
      conn,
      "plays",
      ["game_id", "ord", "period", "clock_s", "type_text", "team_id", "home_score", "away_score", "text", "player1_id", "player2_id", "player3_id"],
      game.plays.map((p, i) => [game.id, i, p.period, p.clockSeconds, p.typeText, p.teamId, p.homeScore, p.awayScore, p.text, ...p.players]),
    );
    await conn.commit();
  } catch (error) {
    await conn.rollback();
    throw error;
  } finally {
    conn.release();
  }
}
