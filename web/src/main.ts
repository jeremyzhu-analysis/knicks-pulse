import "./styles.css";
import type { Report } from "./api/Report.ts";
import type { GameDetail } from "./api/GameDetail.ts";
import { renderGame, renderGameNotFound } from "./render/gamePage.ts";
import { renderBody } from "./render/page.ts";

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

const gameInHash = () => /^#game\/([^/]+)$/.exec(location.hash)?.[1] ?? null;

/** Which view is on screen: a game id, "report", or null before the first render. */
let showing: string | null = null;

async function show(): Promise<void> {
  const hash = location.hash;
  const id = gameInHash();
  const wanted = id ?? "report";
  // Moving between the report's own sections is the browser's normal scrolling.
  if (wanted === showing) return;
  try {
    const url = id ? `/api/games/${id}` : "/api/report";
    const res = await fetch(url);
    if (!res.ok && !(id && res.status === 404)) throw new Error(`${url} answered ${res.status}`);
    const html = !id
      ? renderBody((await res.json()) as Report)
      : res.ok
        ? renderGame((await res.json()) as GameDetail)
        : renderGameNotFound();
    // The reader may have moved on while this was loading.
    if (location.hash !== hash) return;
    document.body.innerHTML = html;
    showing = wanted;
    wire();
    const anchor = id ? null : document.getElementById(hash.slice(1));
    if (anchor) anchor.scrollIntoView();
    else window.scrollTo(0, 0);
  } catch (error) {
    console.error(error);
    showing = null;
    document.body.textContent = "Something went wrong.";
  }
}

window.addEventListener("hashchange", () => void show());
void show();
