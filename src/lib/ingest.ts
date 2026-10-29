import { existsSync, mkdirSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import { buildSummaryFromCore } from "@/lib/core-summary";
import { parseSummary } from "@/lib/parse-summary";
import { readStore, writeStore } from "@/lib/store";
import { KNICKS_TEAM_ID, type Game, type Phase, type Store } from "@/lib/types";

const LOCK_PATH = path.join(process.cwd(), "data", "ingest.lock");

export interface IngestResult {
  added: { id: string; label: string }[];
  updated: { id: string; label: string }[];
  skipped: number;
  errors: { id: string; message: string }[];
  checkedAt: string;
  updatedAt: string;
  games: number;
  busy?: boolean;
}

interface ScheduleTarget {
  year: number;
  type: number;
  phase: Phase;
}

const TARGETS: ScheduleTarget[] = [
  { year: 2026, type: 2, phase: "regular" },
  { year: 2026, type: 3, phase: "playoffs" },
  { year: 2027, type: 2, phase: "regular" },
  { year: 2027, type: 3, phase: "playoffs" },
];

interface ScheduledGame {
  id: string;
  season: string;
  seasonYear: number;
  phase: Phase;
  series: string | null;
  date: string;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function getJson(url: string): Promise<unknown> {
  let last: Error | null = null;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    try {
      const response = await fetch(url, {
        headers: {
          Accept: "application/json",
          "User-Agent": "knicks-game-to-game/1.0",
        },
        cache: "no-store",
      });
      if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
      return await response.json();
    } catch (error) {
      last = error instanceof Error ? error : new Error(String(error));
      await sleep(350 * (attempt + 1));
    }
  }
  throw last ?? new Error(`Failed to fetch ${url}`);
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function seasonLabel(year: number, displayName: string): string {
  if (displayName) return displayName;
  const end = String(year).slice(2);
  return `${year - 1}-${end}`;
}

async function loadSchedule(target: ScheduleTarget): Promise<ScheduledGame[]> {
  const params = target.type === 2 ? "" : `&seasontype=${target.type}`;
  const url = `https://site.api.espn.com/apis/site/v2/sports/basketball/nba/teams/${KNICKS_TEAM_ID}/schedule?season=${target.year}${params}`;
  const payload = asRecord(await getJson(url));
  const events = Array.isArray(payload.events) ? payload.events : [];
  const games: ScheduledGame[] = [];
  for (const event of events) {
    const row = asRecord(event);
    const season = asRecord(row.season);
    const seasonType = asRecord(row.seasonType);
    const year = Number(season.year);
    const type = Number(seasonType.type);
    if (Number.isFinite(year) && Number.isFinite(type) && (year !== target.year || type !== target.type)) {
      continue;
    }
    const competition = asRecord((Array.isArray(row.competitions) ? row.competitions : [])[0]);
    const status = asRecord(asRecord(competition.status).type);
    if (!status.completed) continue;
    const name = String(status.name ?? "");
    if (name.includes("POSTPONED") || name.includes("CANCELED") || name.includes("CANCELLED")) continue;
    const notes = Array.isArray(competition.notes) ? competition.notes : [];
    const headline = notes.length ? String(asRecord(notes[0]).headline ?? "") : "";
    const id = String(row.id ?? "");
    if (!id) continue;
    games.push({
      id,
      season: seasonLabel(target.year, String(season.displayName ?? "")),
      seasonYear: Number.isFinite(year) ? year : target.year,
      phase: target.phase,
      series: headline || null,
      date: String(row.date ?? ""),
    });
  }
  return games;
}

async function pool<T>(items: T[], size: number, worker: (item: T, index: number) => Promise<void>): Promise<void> {
  let cursor = 0;
  async function run(): Promise<void> {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      await worker(items[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(size, items.length) }, () => run()));
}

async function fetchSummary(eventId: string): Promise<unknown> {
  const url = `https://site.api.espn.com/apis/site/v2/sports/basketball/nba/summary?event=${eventId}`;
  try {
    const response = await fetch(url, {
      headers: { Accept: "application/json", "User-Agent": "knicks-game-to-game/1.0" },
      cache: "no-store",
    });
    if (response.status === 404) return buildSummaryFromCore(eventId);
    if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
    return await response.json();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes("404")) return buildSummaryFromCore(eventId);
    throw error;
  }
}

function labelFor(game: Game): string {
  const place = game.home ? "vs" : "at";
  return `${game.season} ${place} ${game.opponentAbbr} ${game.knicksScore}-${game.opponentScore}`;
}

function acquireLock(): boolean {
  try {
    if (existsSync(LOCK_PATH)) {
      const age = Date.now() - statSync(LOCK_PATH).mtimeMs;
      if (age < 15 * 60 * 1000) return false;
    }
  } catch {
    // A stale or unreadable lock should not block a new ingest.
  }
  try {
    mkdirSync(path.dirname(LOCK_PATH), { recursive: true });
    writeFileSync(LOCK_PATH, String(Date.now()));
    return true;
  } catch {
    return false;
  }
}

function releaseLock(): void {
  try {
    if (existsSync(LOCK_PATH)) unlinkSync(LOCK_PATH);
  } catch {
    // The next run treats a lock older than 15 minutes as stale.
  }
}

export async function ingest(options?: { refreshRecentHours?: number }): Promise<IngestResult> {
  const refreshRecentHours = options?.refreshRecentHours ?? 36;
  const existing = readStore();
  const base: IngestResult = {
    added: [],
    updated: [],
    skipped: 0,
    errors: [],
    checkedAt: existing.checkedAt,
    updatedAt: existing.updatedAt,
    games: existing.games.length,
  };
  if (!acquireLock()) {
    return { ...base, busy: true };
  }

  try {
    const scheduled: ScheduledGame[] = [];
    for (const target of TARGETS) {
      try {
        const rows = await loadSchedule(target);
        console.log(`schedule ${target.year} ${target.phase}: ${rows.length} final games`);
        scheduled.push(...rows);
      } catch (error) {
        base.errors.push({
          id: `schedule-${target.year}-${target.phase}`,
          message: error instanceof Error ? error.message : String(error),
        });
      }
    }

    const byId = new Map<string, ScheduledGame>();
    for (const game of scheduled) byId.set(game.id, game);
    const known = new Map(existing.games.map((game) => [game.id, game]));
    const now = Date.now();
    console.log(`scheduled ${byId.size} unique games`);
    const queue: ScheduledGame[] = [];
    for (const game of byId.values()) {
      const prior = known.get(game.id);
      const ageHours = game.date ? (now - new Date(game.date).getTime()) / 36e5 : 999;
      if (!prior || ageHours <= refreshRecentHours) queue.push(game);
      else base.skipped += 1;
    }

    const store: Store = {
      ...existing,
      games: existing.games.slice(),
    };
    let sinceWrite = 0;

    await pool(queue, 5, async (item) => {
      try {
        const summary = await fetchSummary(item.id);
        const game = parseSummary(summary, {
          season: item.season,
          seasonYear: item.seasonYear,
          phase: item.phase,
          series: item.series,
        });
        if (!game.id) game.id = item.id;
        if (!game.date) game.date = item.date;
        const index = store.games.findIndex((row) => row.id === game.id);
        const entry = { id: game.id, label: labelFor(game) };
        if (index >= 0) {
          store.games[index] = game;
          base.updated.push(entry);
        } else {
          store.games.push(game);
          base.added.push(entry);
        }
        sinceWrite += 1;
        if (sinceWrite % 12 === 0) {
          store.games.sort((a, b) => a.date.localeCompare(b.date));
          store.checkedAt = new Date().toISOString();
          store.updatedAt = store.checkedAt;
          writeStore(store);
        }
        const done = base.added.length + base.updated.length;
        if (done % 10 === 0 || done === queue.length) {
          console.log(`ingested ${done}/${queue.length}`);
        }
      } catch (error) {
        base.errors.push({
          id: item.id,
          message: error instanceof Error ? error.message : String(error),
        });
      }
    });

    store.games.sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
    const stamp = new Date().toISOString();
    store.checkedAt = stamp;
    if (base.added.length || base.updated.length || !existing.games.length) store.updatedAt = stamp;
    writeStore(store);
    return {
      ...base,
      checkedAt: store.checkedAt,
      updatedAt: store.updatedAt,
      games: store.games.length,
    };
  } finally {
    releaseLock();
  }
}
