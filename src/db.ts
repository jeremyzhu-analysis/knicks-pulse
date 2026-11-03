import { readFile } from "node:fs/promises";
import mysql from "mysql2/promise";
import { config } from "./config.ts";

export const pool = mysql.createPool({
  uri: config.databaseUrl,
  timezone: "Z",
  connectionLimit: 5,
  decimalNumbers: true,
  // Game ids are BIGINT; read them as strings like ESPN sends them.
  supportBigNumbers: true,
  bigNumberStrings: true,
});

export async function select<T>(sql: string, params: unknown[] = []): Promise<T[]> {
  const [rows] = await pool.query(sql, params);
  return rows as T[];
}

/** Creates the database named in DATABASE_URL if needed, then the tables. */
export async function migrate(): Promise<void> {
  const url = new URL(config.databaseUrl);
  const database = decodeURIComponent(url.pathname.slice(1));
  url.pathname = "/";
  const admin = await mysql.createConnection({ uri: url.toString(), multipleStatements: true });
  try {
    await admin.query(`CREATE DATABASE IF NOT EXISTS ${mysql.escapeId(database)} CHARACTER SET utf8mb4`);
    await admin.query(`USE ${mysql.escapeId(database)}`);
    await admin.query(await readFile(new URL("../db/schema.sql", import.meta.url), "utf8"));
  } finally {
    await admin.end();
  }
}
