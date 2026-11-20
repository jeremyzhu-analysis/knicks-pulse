import type { SyncOutcome, SyncStatus } from "../../server/schema.ts";
import { dateTime } from "./format.ts";
import { snapshot } from "./snapshot.ts";

let checkedAt: string | null = snapshot?.checkedAt ?? null;
let state: "idle" | "checking" | "failed" | "refused" = "idle";
/** What the last check of this page load did; empty before one finishes. */
let outcome = "";
let onAdded: () => void = () => {};

const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

function told(result: SyncOutcome): string {
  if (result.busy) return "A check is already running.";
  if (result.added > 0) return `Stored ${count(result.added, "new game", "new games")}.`;
  if (result.updated > 0) return `No new game. Refreshed ${count(result.updated, "recent game", "recent games")}.`;
  return "No new game.";
}

function inner(): string {
  // An exported page has no server to ask.
  if (snapshot) return checkedAt ? `Snapshot checked ${dateTime(checkedAt)}` : "Snapshot";
  const last = checkedAt ? `Checked ${dateTime(checkedAt)}` : "Not checked yet";
  const text =
    state === "checking"
      ? "Checking for new games…"
      : state === "failed"
        ? `Check failed. ${last}`
        : state === "refused"
          ? `The server refused the sync secret. ${last}`
          : `${outcome} ${last}`.trim();
  return `${text} <button type="button" data-sync${state === "checking" ? " disabled" : ""}>Check for new games</button>`;
}

/** The header's line about the last check, with the button that starts one. */
export function syncControl(): string {
  return `<span id="sync">${inner()}</span>`;
}

function paint(): void {
  const control = document.getElementById("sync");
  if (control) control.innerHTML = inner();
}

/** Where the browser keeps the sync secret once the reader has typed it. */
const SECRET_KEY = "knicks.syncSecret";

/** The secret `POST /api/sync` asks for: the stored one, or the reader's answer to a prompt. */
function syncSecret(): string | null {
  const stored = localStorage.getItem(SECRET_KEY);
  if (stored) return stored;
  const typed = window.prompt("Sync secret (SYNC_SECRET in the server's .env)")?.trim();
  if (!typed) return null;
  localStorage.setItem(SECRET_KEY, typed);
  return typed;
}

async function check(): Promise<void> {
  if (state === "checking") return;
  const secret = syncSecret();
  if (!secret) return;
  state = "checking";
  paint();
  try {
    const res = await fetch("/api/sync", { method: "POST", headers: { authorization: `Bearer ${secret}` } });
    if (res.status === 401 || res.status === 403) {
      // The next click asks for the secret again.
      localStorage.removeItem(SECRET_KEY);
      state = "refused";
      paint();
      return;
    }
    if (!res.ok) throw new Error(`/api/sync answered ${res.status}`);
    const result = (await res.json()) as SyncOutcome;
    checkedAt = result.checkedAt;
    outcome = told(result);
    state = "idle";
    if (result.added > 0) onAdded();
  } catch (error) {
    console.error(error);
    state = "failed";
  }
  paint();
}

/**
 * Shows when the data was last checked and wires the button that starts a
 * check. Call once per page load; `added` runs after a check that stored a
 * new game.
 */
export async function startSync(added: () => void): Promise<void> {
  if (snapshot) return;
  onAdded = added;
  document.addEventListener("click", (event) => {
    if (event.target instanceof Element && event.target.closest("[data-sync]")) void check();
  });
  try {
    const res = await fetch("/api/sync");
    if (res.ok) checkedAt = ((await res.json()) as SyncStatus).checkedAt;
    paint();
  } catch (error) {
    console.error(error);
  }
}
