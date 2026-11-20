import type { Season, Shooter, ShotMap } from "../../../server/schema.ts";
import { escapeHtml as e } from "../format.ts";

const [WIDTH, HEIGHT] = [500, 500];
/** ESPN's feet to the drawing: x across the floor, y out from the basket, which sits near the bottom. */
const px = (x: number) => (x / 50) * WIDTH;
const py = (y: number) => ((42 - y) / 50) * HEIGHT;

/** Baseline to half court, the lane, and the three-point line. */
function courtPath(): string {
  const [baseline, halfCourt, freeThrow, threeRadius] = [-5.25, 41.75, 13.75, 23.75];
  // Where the straight corner three meets the arc.
  const corner = Math.sqrt(threeRadius ** 2 - 22 ** 2);
  const [from, to] = [Math.atan2(corner, -22), Math.atan2(corner, 22)];
  const arc: string[] = [];
  for (let i = 0; i <= 40; i++) {
    const angle = from + (to - from) * (i / 40);
    arc.push(
      `${i ? "L" : "M"}${px(25 + threeRadius * Math.cos(angle)).toFixed(1)},${py(threeRadius * Math.sin(angle)).toFixed(1)}`,
    );
  }
  return [
    `M${px(0)},${py(baseline)} H${px(50)} V${py(halfCourt)} H${px(0)} Z`,
    `M${px(17)},${py(baseline)} V${py(freeThrow)} H${px(33)} V${py(baseline)}`,
    `M${px(3)},${py(baseline)} V${py(corner)}`,
    `M${px(47)},${py(baseline)} V${py(corner)}`,
    arc.join(" "),
  ].join(" ");
}

const COURT = courtPath();

/** "Brunson: 120 made, 140 missed, 46.2% of 260" */
function tally(who: string, makes: number, attempts: number): string {
  if (attempts === 0) return `${who}: no shots.`;
  return `${who}: ${makes} made, ${attempts - makes} missed, ${((100 * makes) / attempts).toFixed(1)}% of ${attempts}.`;
}

/**
 * One season's map. A data-shooter button shows only that player's shots (an
 * empty value shows everyone's) and writes its data-tally into the readout;
 * a data-show button limits the dots to makes or misses.
 */
export function shotMap(map: ShotMap | undefined, selected: string | null): string {
  if (!map || map.attempts === 0) return `<p class="note">No shot locations stored for this season.</p>`;
  const chosen = map.players.find((p) => String(p.id) === selected) ?? null;
  const chip = (id: string, label: string, text: string, on: boolean) =>
    `<button type="button" data-shooter="${id}" data-tally="${e(text)}" class="${on ? "on" : ""}">${e(label)}</button>`;
  const everyone = tally("All shots", map.makes, map.attempts);
  const of = (p: Shooter) => tally(p.last, p.makes, p.attempts);
  const names = new Map(map.players.map((p) => [p.id, p.last]));
  const period = (n: number) => (n <= 4 ? `Q${n}` : n === 5 ? "OT" : `OT${n - 4}`);
  const dots = map.shots
    .map((s) => {
      const title = `${names.get(s.p) ?? ""}, ${s.made ? "made" : "missed"} ${s.value}, ${period(s.period)}`;
      const hidden = chosen && s.p !== chosen.id ? " hidden" : "";
      return `<circle class="${s.made ? "make" : "miss"}" data-p="${s.p}"${hidden} cx="${px(s.x).toFixed(1)}" cy="${py(s.y).toFixed(1)}" r="3.2"><title>${e(title)}</title></circle>`;
    })
    .join("");
  return `<div class="shots">
  <div class="switch">${chip("", "All", everyone, !chosen)}${map.players.map((p) => chip(String(p.id), p.last, of(p), p === chosen)).join("")}</div>
  <div class="switch"><button type="button" data-show="" class="on">Makes and misses</button><button type="button" data-show="make">Makes</button><button type="button" data-show="miss">Misses</button></div>
  <p class="readout">${e(chosen ? of(chosen) : everyone)}</p>
  <svg viewBox="0 0 ${WIDTH} ${HEIGHT}" role="img" aria-label="Shot map"><path d="${COURT}" fill="none" stroke="#2a2a2a" stroke-width="1.5"/>${dots}</svg>
</div>`;
}

/** The season to open on: the most recent one where the player has shots, else the current season. */
export function shotSeason(
  maps: ShotMap[],
  seasons: Season[],
  selected: string | null,
  current: string | null,
): string | null {
  if (!selected) return current;
  const has = (key: string) => maps.find((m) => m.key === key)?.players.some((p) => String(p.id) === selected) ?? false;
  if (current && has(current)) return current;
  return seasons.find((s) => has(s.key))?.key ?? current;
}

/** Makes the player and make-or-miss buttons of every shot map on the page work. */
export function wireShots(): void {
  document.querySelectorAll(".shots").forEach((map) => {
    const pick = (attribute: string, button: Element) =>
      map.querySelectorAll(`[${attribute}]`).forEach((item) => item.classList.toggle("on", item === button));
    map.querySelectorAll("[data-shooter]").forEach((button) => {
      button.addEventListener("click", () => {
        const id = button.getAttribute("data-shooter");
        pick("data-shooter", button);
        map
          .querySelectorAll("circle")
          .forEach((dot) => dot.toggleAttribute("hidden", id !== "" && dot.getAttribute("data-p") !== id));
        const readout = map.querySelector(".readout");
        if (readout) readout.textContent = button.getAttribute("data-tally") || "";
      });
    });
    map.querySelectorAll("[data-show]").forEach((button) => {
      button.addEventListener("click", () => {
        pick("data-show", button);
        map.querySelector("svg")?.setAttribute("data-only", button.getAttribute("data-show") || "");
      });
    });
  });
}
