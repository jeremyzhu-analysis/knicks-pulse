import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import { KNICKS_TEAM_ID, type Store } from "@/lib/types";

export const DATA_PATH = path.join(process.cwd(), "data", "knicks.json");

export function emptyStore(): Store {
  const now = new Date().toISOString();
  return {
    version: 1,
    updatedAt: now,
    checkedAt: now,
    source: "ESPN",
    teamId: KNICKS_TEAM_ID,
    games: [],
  };
}

export function readStore(): Store {
  try {
    const raw = readFileSync(DATA_PATH, "utf8");
    const parsed = JSON.parse(raw) as Store;
    if (!parsed || parsed.version !== 1 || !Array.isArray(parsed.games)) return emptyStore();
    return parsed;
  } catch {
    return emptyStore();
  }
}

export function writeStore(store: Store): void {
  mkdirSync(path.dirname(DATA_PATH), { recursive: true });
  const tmp = `${DATA_PATH}.tmp`;
  writeFileSync(tmp, JSON.stringify(store));
  renameSync(tmp, DATA_PATH);
}
