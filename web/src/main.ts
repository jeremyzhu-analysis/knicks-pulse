import "./styles.css";
import type { Report } from "./api/Report.ts";
import type { ShotMap } from "./api/ShotMap.ts";
import type { GameDetail } from "./api/GameDetail.ts";
import type { PlayerDetail } from "./api/PlayerDetail.ts";
import { renderGame, renderGameNotFound } from "./render/gamePage.ts";
import { renderBody } from "./render/page.ts";
import { renderPlayer, renderPlayerNotFound } from "./render/playerPage.ts";
import { wireShots } from "./render/shots.ts";
import { parseHash, type View } from "./route.ts";
import { snapshot } from "./snapshot.ts";
import { startSync } from "./sync.ts";

/**
 * Switches, readouts and sortable columns of the page on screen.
 *
 * A data-pick button shows the data-panel elements with its value and hides
 * the others, within its data-group; the season switch has no group.
 * A data-tip element writes its tip into the readout of the panel around it.
 * A data-sort button in a column heading orders the table's rows by the
 * data-v of that column's cells, largest first; cells without a value stay
 * last.
 */
function wire(): void {
  const group = (element: Element) => element.getAttribute("data-group") ?? "";
  document.querySelectorAll("[data-pick]").forEach((button) => {
    button.addEventListener("click", () => {
      const id = button.getAttribute("data-pick");
      const same = (element: Element) => group(element) === group(button);
      document.querySelectorAll("[data-pick]").forEach((item) => {
        if (same(item)) item.classList.toggle("on", item.getAttribute("data-pick") === id);
      });
      document.querySelectorAll("[data-panel]").forEach((panel) => {
        if (same(panel)) panel.toggleAttribute("hidden", panel.getAttribute("data-panel") !== id);
      });
    });
  });
  document.querySelectorAll("[data-tip]").forEach((source) => {
    const tell = () => {
      const readout = source.closest("[data-panel]:not([data-group])")?.querySelector(".readout");
      if (readout) readout.textContent = source.getAttribute("data-tip") || "";
    };
    for (const event of ["click", "mouseenter", "focus"]) source.addEventListener(event, tell);
  });
  document.querySelectorAll("[data-sort]").forEach((button) => {
    button.addEventListener("click", () => {
      const heading = button.closest("th");
      const body = button.closest("table")?.querySelector("tbody");
      if (!heading || !body) return;
      const column = [...heading.parentElement!.children].indexOf(heading);
      const descending = !(button.classList.contains("on") && button.getAttribute("data-order") === "desc");
      heading.parentElement!.querySelectorAll("[data-sort]").forEach((other) => other.classList.remove("on"));
      button.classList.add("on");
      button.setAttribute("data-order", descending ? "desc" : "asc");
      const value = (row: Element) => {
        const v = row.children[column]?.getAttribute("data-v");
        return v ? Number(v) : null;
      };
      const rows = [...body.children].sort((a, b) => {
        const [x, y] = [value(a), value(b)];
        if (x === null || y === null) return x === null ? (y === null ? 0 : 1) : -1;
        return descending ? y - x : x - y;
      });
      body.append(...rows);
    });
  });
}

/** The API's JSON by URL, kept while the page is open; null for a 404. */
const loaded = new Map<string, unknown>();

async function load<T>(url: string): Promise<T | null> {
  if (snapshot) return (snapshot.documents[url] as T | undefined) ?? null;
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
  if (view.page === "player") {
    const player = await load<PlayerDetail>(`/api/players/${view.id}`);
    return player ? renderPlayer(player) : renderPlayerNotFound();
  }
  const report = await load<Report>("/api/report");
  if (!report) throw new Error("/api/report answered 404");
  const shots = view.tab === "shots" ? await load<ShotMap[]>("/api/shots") : null;
  return renderBody(report, view, shots);
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
    wireShots();
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
