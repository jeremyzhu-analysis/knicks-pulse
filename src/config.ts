import { existsSync } from "node:fs";

const envFile = new URL("../.env", import.meta.url);
if (existsSync(envFile)) process.loadEnvFile(envFile);

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing environment variable ${name}. See .env.example.`);
  return value;
}

export const config = {
  databaseUrl: required("DATABASE_URL"),
  /** 127.0.0.1 keeps the server off the network; `tailscale serve` forwards to it. */
  host: process.env.HOST ?? "127.0.0.1",
  port: Number(process.env.PORT ?? 3000),
  syncIntervalMinutes: Number(process.env.SYNC_INTERVAL_MINUTES ?? 60),
  /** ESPN's team slug and id for the New York Knicks. */
  team: { slug: "ny", id: 18 },
};
