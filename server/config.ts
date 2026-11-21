import { existsSync } from "node:fs";

/** ESPN's team slug and id for the New York Knicks. */
export const TEAM_SLUG = "ny";
export const TEAM_ID = 18;

export type Config = {
  databaseUrl: string;
  /** 127.0.0.1 keeps the server off the network. */
  host: string;
  port: number;
  syncIntervalMinutes: number;
  /** What `POST /api/sync` must present; null turns that route off. */
  syncSecret: string | null;
};

/** Whether `host` names this machine only. */
export const isLoopback = (host: string) => host === "localhost" || host === "::1" || /^127(\.\d{1,3}){3}$/.test(host);

/**
 * Reads the environment, falling back to `.env` in the current directory.
 * A variable that is already set wins over the file, and an empty one counts
 * as unset.
 */
export function loadConfig(): Config {
  if (existsSync(".env")) process.loadEnvFile(".env");
  return configFrom(process.env);
}

export function configFrom(env: Record<string, string | undefined>): Config {
  const get = (name: string) => env[name] || null;
  const databaseUrl = get("DATABASE_URL");
  if (!databaseUrl) throw new Error("Missing environment variable DATABASE_URL. See .env.example.");
  return {
    databaseUrl,
    host: get("HOST") ?? "127.0.0.1",
    port: wholeNumber("PORT", get("PORT"), 3000, 65_535),
    syncIntervalMinutes: wholeNumber(
      "SYNC_INTERVAL_MINUTES",
      get("SYNC_INTERVAL_MINUTES"),
      60,
      Number.MAX_SAFE_INTEGER,
    ),
    syncSecret: syncSecret(get("SYNC_SECRET")),
  };
}

/** Shorter than this, the 5 tries a minute an address gets are all that keeps a guesser out. */
const MIN_SECRET_LENGTH = 16;

function syncSecret(text: string | null): string | null {
  if (text !== null && text.length < MIN_SECRET_LENGTH) {
    throw new Error(
      `SYNC_SECRET must be at least ${MIN_SECRET_LENGTH} characters. See .env.example for a way to generate one.`,
    );
  }
  return text;
}

function wholeNumber(name: string, text: string | null, fallback: number, max: number): number {
  if (text === null) return fallback;
  const value = /^\+?[0-9]+$/.test(text.trim()) ? Number(text.trim()) : NaN;
  if (!(value <= max)) throw new Error(`${name} must be a whole number, got ${JSON.stringify(text)}`);
  return value;
}
