import "./styles.css";
import type { Report } from "./api/Report.ts";
import type { GameDetail } from "./api/GameDetail.ts";
import { renderGame, renderGameNotFound } from "./render/gamePage.ts";
import { renderBody } from "./render/page.ts";
import { parseHash, type View } from "./route.ts";
import { startSync } from "./sync.ts";

/** Season switch and the pairing readout. */
function wire(): void {
  document.querySelectorAll("[data-pick]").forEach((button) => {
    button.addEventListener("click", () => {
      const id = button.getAttribute("data-pick");
      document.querySelectorAll("[data-pick]").forEach((item) => item.classList.toggle("on", item.getAttribute("data-pick") === id));
      document.querySelectorAll<HTMLElement>("[data-panel]").forEach((panel) => { panel.hidden = panel.getAttribute("data-panel") !== id; });
    });
  });
  document.querySelectorAll("[data-tip]").forEach((button) => {
    button.addEventListener("click", () => {
      const readout = button.closest("[data-panel]")?.querySelector(".readout");
      if (readout) readout.textContent = button.getAttribute("data-tip") || "";
    });
  });
}

/** The API's JSON by URL, kept while the page is open; null for a 404. */
const loaded = new Map<string, unknown>();

async function load<T>(url: string): Promise<T | null> {
  if (!loaded.has(url)) {
    const res = await fetch(url);
    if (!res.ok && res.status !== 404) throw new Error(`${url} answered ${res.status}`);
    loaded.set(url, res.ok ? await res.json() : null);
  }
  return loaded.get(url) as T | null;
}

async function html(view: View): Promise<string> {
  if (view.page === "game") {
    const game = await load<GameDetail>(`/api/games/${view.id}`);
    return game ? renderGame(game) : renderGameNotFound();
  }
  const report = await load<Report>("/api/report");
  if (!report) throw new Error("/api/report answered 404");
  return renderBody(report, view);
}

/** The page on screen, to tell a change of tab from a change of page. */
let showing: View["page"] | null = null;

async function show(): Promise<void> {
  const hash = location.hash;
  const view = parseHash(hash);
  try {
    const body = await html(view);
    // The reader may have moved on while this was loading.
    if (location.hash !== hash) return;
    // The tabs share the hero above them, so a change of tab keeps the scroll position.
    const keepScroll = view.page === "report" && showing === "report";
    document.body.innerHTML = body;
    showing = view.page;
    wire();
    if (!keepScroll) window.scrollTo(0, 0);
  } catch (error) {
    console.error(error);
    showing = null;
    document.body.textContent = "Something went wrong.";
  }
}

window.addEventListener("hashchange", () => void show());
void show().then(() =>
  startSync(() => {
    loaded.clear();
    void show();
  }),
);
