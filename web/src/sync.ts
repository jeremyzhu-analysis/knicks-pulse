import type { SyncOutcome } from "./api/SyncOutcome.ts";
import type { SyncStatus } from "./api/SyncStatus.ts";
import { dateTime } from "./format.ts";

let checkedAt: string | null = null;
let state: "idle" | "checking" | "failed" = "idle";
let onAdded: () => void = () => {};

function inner(): string {
  const last = checkedAt ? `Checked ${dateTime(checkedAt)}` : "Not checked yet";
  const text = state === "checking" ? "Checking for new games…" : state === "failed" ? `Check failed. ${last}` : last;
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
    const outcome = (await res.json()) as SyncOutcome;
    checkedAt = outcome.checkedAt;
    state = "idle";
    if (outcome.added > 0) onAdded();
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
