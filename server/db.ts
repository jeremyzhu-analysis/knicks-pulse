import { readFileSync } from "node:fs";

import mysql, { type Pool, type RowDataPacket } from "mysql2/promise";

export const SCHEMA = readFileSync(new URL("../db/schema.sql", import.meta.url), "utf8");

/**
 * Columns that databases created from an earlier schema.sql may lack:
 * [table, column, definition]. CREATE TABLE IF NOT EXISTS leaves an existing
 * table alone, so `migrate` adds these itself. Each must also be in
 * schema.sql, written as "column definition".
 */
export const ADDED_COLUMNS: readonly (readonly [string, string, string])[] = [
  ["games", "neutral", "BOOLEAN NOT NULL DEFAULT FALSE"],
  ["games", "attendance", "INT UNSIGNED NULL"],
  ["games", "store_format", "TINYINT UNSIGNED NOT NULL DEFAULT 1"],
  ["plays", "shooting", "BOOLEAN NOT NULL DEFAULT FALSE"],
  ["plays", "score_value", "TINYINT UNSIGNED NOT NULL DEFAULT 0"],
  ["plays", "points_attempted", "TINYINT UNSIGNED NOT NULL DEFAULT 0"],
  ["plays", "x", "SMALLINT NULL"],
  ["plays", "y", "SMALLINT NULL"],
];

/** Sessions run in UTC, and DATETIME values are read as text, never as local-time Date objects. */
export function createPool(databaseUrl: string): Pool {
  const pool = mysql.createPool({ uri: databaseUrl, connectionLimit: 5, timezone: "Z", dateStrings: true });
  pool.on("connection", (connection) => connection.query("SET time_zone = '+00:00'"));
  return pool;
}

/**
 * Creates the database named in the URL if needed, then the tables, then any
 * column of ADDED_COLUMNS an existing table lacks.
 */
export async function migrate(databaseUrl: string): Promise<void> {
  const [serverUrl, database] = splitDatabase(databaseUrl);
  // schema.sql holds several statements; only this connection may send more than one at a time.
  const admin = await mysql.createConnection({ uri: serverUrl, multipleStatements: true });
  try {
    // Identifiers can't be bound as parameters; escapeId quotes the name.
    const id = escapeId(database);
    await admin.query(`CREATE DATABASE IF NOT EXISTS ${id} CHARACTER SET utf8mb4; USE ${id};`);
    try {
      await admin.query(SCHEMA);
    } catch (error) {
      throw new Error("creating tables", { cause: error });
    }
    for (const [table, column, definition] of ADDED_COLUMNS) {
      const [rows] = await admin.execute<RowDataPacket[]>(
        `SELECT COUNT(*) present FROM information_schema.columns
          WHERE table_schema = DATABASE() AND table_name = ? AND column_name = ?`,
        [table, column],
      );
      if (Number(rows[0]?.present) === 0) {
        try {
          await admin.query(`ALTER TABLE ${escapeId(table)} ADD COLUMN ${escapeId(column)} ${definition}`);
        } catch (error) {
          throw new Error(`adding ${table}.${column}`, { cause: error });
        }
      }
    }
  } finally {
    await admin.end();
  }
}

/** "mysql://u:p@host:3307/knicks?x=1" -> ["mysql://u:p@host:3307/?x=1", "knicks"] */
export function splitDatabase(url: string): [string, string] {
  const scheme = url.indexOf("://");
  if (scheme < 0) throw new Error("DATABASE_URL has no scheme");
  const pathStart = url.indexOf("/", scheme + 3);
  if (pathStart < 0) throw new Error("DATABASE_URL names no database");
  const query = url.indexOf("?", pathStart);
  const pathEnd = query < 0 ? url.length : query;
  let database: string;
  try {
    database = decodeURIComponent(url.slice(pathStart + 1, pathEnd));
  } catch (error) {
    throw new Error("bad escape in database name", { cause: error });
  }
  if (database === "") throw new Error("DATABASE_URL names no database");
  return [`${url.slice(0, pathStart)}/${url.slice(pathEnd)}`, database];
}

/** MySQL identifier quoting: backticks, with any backtick inside doubled. */
export function escapeId(name: string): string {
  return `\`${name.replaceAll("`", "``")}\``;
}
