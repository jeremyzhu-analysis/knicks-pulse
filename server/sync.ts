import type { Pool, PoolConnection, RowDataPacket } from "mysql2/promise";

import { TEAM_SLUG } from "./config.ts";
import { EspnHttpError, PLAYOFFS, REGULAR_SEASON, type Espn, type GameSummary } from "./espn.ts";
import { NEW_YORK } from "./report/dates.ts";

/**
 * Version of what `storeGame` writes for a game. Raise it when a stored game
 * gains data that only ESPN can supply.
 */
const STORE_FORMAT = 2;

export type SyncResult = {
  completed: number;
  /** Games stored for the first time. */
  added: number;
  /** Games that were stored before and written again. */
  updated: number;
};

/**
 * ESPN corrects box scores and play-by-play for a while after the final
 * buzzer, so a game is fetched again on every sync until this long after its
 * start.
 */
const SETTLE_HOURS = 36;

/** A completed game as a schedule lists it. */
type Listed = { id: string; seasonYear: number; seasonType: number; note: string | null };

type Value = string | number | boolean | null;

/**
 * Stores every completed game of the current and previous season (regular
 * season and playoffs) that isn't in the database in the current
 * STORE_FORMAT, or that started within SETTLE_HOURS. Callers must not run two
 * syncs at once.
 */
export async function syncGames(pool: Pool, espn: Espn, log: (line: string) => void): Promise<SyncResult> {
  const current = await espn.schedule(TEAM_SLUG, null, REGULAR_SEASON);
  const year = current.seasonYear;
  const schedules = [
    [REGULAR_SEASON, current],
    [PLAYOFFS, await espn.schedule(TEAM_SLUG, year, PLAYOFFS)],
    [REGULAR_SEASON, await espn.schedule(TEAM_SLUG, year - 1, REGULAR_SEASON)],
    [PLAYOFFS, await espn.schedule(TEAM_SLUG, year - 1, PLAYOFFS)],
  ] as const;
  const seen = new Set<string>();
  const listed: Listed[] = [];
  for (const [seasonType, schedule] of schedules) {
    for (const game of schedule.completedGames) {
      if (seen.has(game.id)) continue;
      seen.add(game.id);
      listed.push({ id: game.id, seasonYear: schedule.seasonYear, seasonType, note: game.note });
    }
  }

  // id -> whether the stored game can be left as it is.
  const [rows] = await pool.execute<RowDataPacket[]>(
    "SELECT id, store_format = ? AND starts_at <= UTC_TIMESTAMP() - INTERVAL ? HOUR settled FROM games",
    [STORE_FORMAT, SETTLE_HOURS],
  );
  const stored = new Map(rows.map((row) => [String(row.id), Number(row.settled) !== 0]));
  const toFetch = listed.filter((game) => stored.get(game.id) !== true);
  log(`${listed.length} completed games, ${toFetch.length} to fetch.`);

  let added = 0;
  let updated = 0;
  for (const { id, seasonYear, seasonType, note } of toFetch) {
    let game: GameSummary;
    try {
      game = await espn.gameSummary(id);
    } catch (error) {
      if (!isNotFound(error)) throw error;
      // ESPN lists some finished games whose summary answers 404; its core
      // API still has them.
      try {
        game = await espn.coreGameSummary(id, seasonYear, seasonType, note);
      } catch (error) {
        if (!isNotFound(error)) throw error;
        // With neither source the game stays unstored, so every later sync
        // asks for it again.
        log(`Skipped game ${id}: ESPN has no data for it.`);
        continue;
      }
    }
    if (!game.completed) continue;
    await storeGame(pool, game);
    let verb: string;
    if (stored.has(id)) {
      updated++;
      verb = "Updated";
    } else {
      added++;
      verb = "Stored";
    }
    const day = game.startsAt.toZonedDateTimeISO(NEW_YORK).toPlainDate().toString();
    log(`${verb} ${day} ${game.away.abbreviation} ${game.awayScore} at ${game.home.abbreviation} ${game.homeScore}`);
  }
  await pool.execute(
    `INSERT INTO sync_status (id, checked_at) VALUES (1, UTC_TIMESTAMP())
     ON DUPLICATE KEY UPDATE checked_at = VALUES(checked_at)`,
  );
  return { completed: listed.length, added, updated };
}

/** When a sync last ran to the end, ISO 8601 in UTC. */
export async function checkedAt(pool: Pool): Promise<string | null> {
  const [rows] = await pool.execute<RowDataPacket[]>(
    "SELECT DATE_FORMAT(checked_at, '%Y-%m-%dT%H:%i:%sZ') checked_at FROM sync_status WHERE id = 1",
  );
  return rows[0]?.checked_at ?? null;
}

const isNotFound = (error: unknown) => error instanceof EspnHttpError && error.status === 404;

/** One transaction per game; a failure leaves nothing of the game behind. */
async function storeGame(pool: Pool, game: GameSummary): Promise<void> {
  if (!/^[0-9]+$/.test(game.id)) throw new Error(`game id ${JSON.stringify(game.id)} is not a number`);
  const gameId = game.id;
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    for (const team of [game.home, game.away]) {
      await connection.execute(
        `INSERT INTO teams (id, abbreviation, display_name, short_name) VALUES (?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE abbreviation = VALUES(abbreviation), display_name = VALUES(display_name), short_name = VALUES(short_name)`,
        [team.id, team.abbreviation, team.displayName, team.shortName],
      );
    }
    await insert(
      connection,
      "players (id, full_name, position)",
      game.playerBoxes.map((p) => [p.playerId, p.fullName, p.position]),
      " ON DUPLICATE KEY UPDATE full_name = VALUES(full_name), position = VALUES(position)",
    );
    await connection.execute("DELETE FROM games WHERE id = ?", [gameId]);
    const periodCount = Math.max(4, ...game.periods.map((p) => p.period));
    // "2026-11-03T00:30:00Z" -> "2026-11-03 00:30:00"
    const startsAt = game.startsAt.toString({ smallestUnit: "second" }).replace("T", " ").replace("Z", "");
    await connection.execute(
      `INSERT INTO games (id, season_year, season_type, starts_at, home_team_id, away_team_id, home_score, away_score, periods, venue, note, synced_at, neutral, attendance, store_format)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, UTC_TIMESTAMP(), ?, ?, ?)`,
      [
        gameId,
        game.seasonYear,
        game.seasonType,
        startsAt,
        game.home.id,
        game.away.id,
        game.homeScore,
        game.awayScore,
        periodCount,
        game.venue,
        game.note,
        game.neutral,
        game.attendance,
        STORE_FORMAT,
      ],
    );

    await insert(
      connection,
      "game_team_stats (game_id, team_id, pts, fgm, fga, fg3m, fg3a, ftm, fta, oreb, dreb, ast, stl, blk, tov, paint_pts, fast_break_pts, pts_off_tov)",
      game.teamBoxes.map((t) => [
        gameId,
        t.teamId,
        t.pts,
        t.fgm,
        t.fga,
        t.fg3m,
        t.fg3a,
        t.ftm,
        t.fta,
        t.oreb,
        t.dreb,
        t.ast,
        t.stl,
        t.blk,
        t.tov,
        t.paintPts,
        t.fastBreakPts,
        t.ptsOffTov,
      ]),
    );
    await insert(
      connection,
      "game_periods (game_id, team_id, period, pts)",
      game.periods.map((p) => [gameId, p.teamId, p.period, p.pts]),
    );
    await insert(
      connection,
      "game_players (game_id, player_id, team_id, starter, minutes, pts, fgm, fga, fg3m, fg3a, ftm, fta, oreb, dreb, ast, stl, blk, tov, pf, plus_minus)",
      game.playerBoxes.map((p) => [
        gameId,
        p.playerId,
        p.teamId,
        p.starter,
        p.minutes,
        p.pts,
        p.fgm,
        p.fga,
        p.fg3m,
        p.fg3a,
        p.ftm,
        p.fta,
        p.oreb,
        p.dreb,
        p.ast,
        p.stl,
        p.blk,
        p.tov,
        p.pf,
        p.plusMinus,
      ]),
    );
    await insert(
      connection,
      "plays (game_id, ord, period, clock_s, type_text, team_id, home_score, away_score, text, player1_id, player2_id, player3_id, shooting, score_value, points_attempted, x, y)",
      game.plays.map((p, i) => [
        gameId,
        i,
        p.period,
        p.clockSeconds,
        p.typeText,
        p.teamId,
        p.homeScore,
        p.awayScore,
        p.text,
        p.players[0],
        p.players[1],
        p.players[2],
        p.shooting,
        p.scoreValue,
        p.pointsAttempted,
        p.position ? p.position.x : null,
        p.position ? p.position.y : null,
      ]),
    );
    await connection.commit();
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

/** One INSERT for all `rows`, every value bound as a parameter. */
async function insert(
  connection: PoolConnection,
  tableAndColumns: string,
  rows: Value[][],
  suffix = "",
): Promise<void> {
  const first = rows[0];
  if (!first) return;
  const row = `(${first.map(() => "?").join(", ")})`;
  const sql = `INSERT INTO ${tableAndColumns} VALUES ${rows.map(() => row).join(", ")}${suffix}`;
  await connection.execute(sql, rows.flat());
  // The statement's text depends on the row count, so keeping it prepared
  // would leave one on the server for every count that ever occurs.
  connection.unprepare(sql);
}
