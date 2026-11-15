import type { SyncOutcome } from "./api/SyncOutcome.ts";
import type { SyncStatus } from "./api/SyncStatus.ts";
import { dateTime } from "./format.ts";
import { snapshot } from "./snapshot.ts";

let checkedAt: string | null = snapshot?.checkedAt ?? null;
let state: "idle" | "checking" | "failed" = "idle";
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
  const text = state === "checking" ? "Checking for new games…" : state === "failed" ? `Check failed. ${last}` : `${outcome} ${last}`.trim();
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

async function check(): Promise<void> {
  if (state === "checking") return;
  state = "checking";
  paint();
  try {
    const res = await fetch("/api/sync", { method: "POST" });
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
 * Shows when the data was last checked, then checks once. Call once per page
 * load; `added` runs after a check that stored a new game.
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
  await check();
}
