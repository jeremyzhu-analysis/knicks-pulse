import type { Game } from "../api/Game.ts";
import type { QuarterRow } from "../api/QuarterRow.ts";
import { escapeHtml, longDate, signed } from "../format.ts";
import { margin, won } from "./game.ts";

const ORANGE = "#e07a3d";
const BLUE = "#7eadd4";
const BASE = [0x14, 0x14, 0x14];

const hex = (rgb: number[]) => `#${rgb.map((c) => Math.round(c).toString(16).padStart(2, "0")).join("")}`;
const rgbOf = (color: string) => [1, 3, 5].map((i) => Number.parseInt(color.slice(i, i + 2), 16));

/** Background and text colour for a value on the blue (behind) to orange (ahead) scale. */
export function heat(value: number, scale: number): { bg: string; fg: string } {
  const t = Math.min(1, Math.abs(value) / scale);
  const target = rgbOf(value >= 0 ? ORANGE : BLUE);
  const bg = hex(BASE.map((c, i) => c + (target[i]! - c) * t));
  return { bg, fg: t > 0.5 ? "#140e0a" : "#f4f1ea" };
}

const ROLLING = 5;
const ROLLING_MIN = 3;

/** Dot per game for the final margin, line for the rolling average. */
export function marginChart(games: Game[]): string {
  if (games.length === 0) return `<p class="note">No games yet.</p>`;
  const margins = games.map(margin);
  const top = Math.max(5, ...margins.map(Math.abs));
  const [left, right, mid, half] = [36, 852, 124, 112];
  const x = (i: number) => (games.length === 1 ? left : left + ((right - left) * i) / (games.length - 1));
  const y = (v: number) => mid - (v / top) * half;

  const points: string[] = [];
  margins.forEach((_, i) => {
    if (i + 1 < ROLLING_MIN) return;
    const window = margins.slice(Math.max(0, i + 1 - ROLLING), i + 1);
    const avg = window.reduce((a, b) => a + b, 0) / window.length;
    points.push(`${points.length ? "L" : "M"}${x(i).toFixed(1)},${y(avg).toFixed(1)}`);
  });
  const label = (text: string, ty: number) =>
    `<text x="0" y="${ty.toFixed(1)}" fill="#a39e94" font-size="11" font-family="Arial">${text}</text>`;
  const dots = games
    .map((g, i) => {
      const title = `${longDate(g.startsAt)} ${g.opponent.abbreviation} ${signed(margins[i]!, 0)}`;
      return `<a href="#game/${escapeHtml(g.id)}"><circle cx="${x(i).toFixed(1)}" cy="${y(margins[i]!).toFixed(1)}" r="4.5" fill="${won(g) ? ORANGE : BLUE}"><title>${escapeHtml(title)}</title></circle></a>`;
    })
    .join("");
  return (
    `<svg viewBox="0 0 860 260" role="img" aria-label="Game margin">` +
    `<line x1="${left}" x2="${right}" y1="${mid}" y2="${mid}" stroke="#2a2a2a"/>` +
    label(`+${top}`, mid - half + 4) + label("0", mid + 4) + label(`-${top}`, mid + half + 4) +
    (points.length > 1 ? `<path d="${points.join(" ")}" fill="none" stroke="#f4f1ea" stroke-width="2.2"/>` : "") +
    dots +
    `</svg>`
  );
}

/** Orange bar this season, grey bar last season, per quarter. */
export function quarterChart(rows: QuarterRow[]): string {
  const values = rows.flatMap((r) => [r.margin, r.lastMargin ?? 0]);
  const top = Math.max(1, ...values.map(Math.abs));
  const [mid, height, width] = [118, 70, 24];
  const bar = (bx: number, v: number, fill: string) => {
    const h = (Math.abs(v) / top) * height;
    return `<rect x="${bx}" y="${(v >= 0 ? mid - h : mid).toFixed(1)}" width="${width}" height="${h.toFixed(1)}" fill="${fill}"/>`;
  };
  const groups = rows
    .map((r, i) => {
      const cx = 137.5 + 203 * i;
      return (
        `<g>${bar(cx - 28, r.margin, ORANGE)}${r.lastMargin === null ? "" : bar(cx + 4, r.lastMargin, "#5c5852")}` +
        `<text x="${cx}" y="230" text-anchor="middle" fill="#a39e94" font-size="12" font-family="Arial">Q${r.quarter}</text>` +
        `<text x="${cx}" y="16" text-anchor="middle" fill="#f4f1ea" font-size="12" font-family="Arial">${signed(r.margin)}</text></g>`
      );
    })
    .join("");
  return `<svg viewBox="0 0 860 240" role="img" aria-label="Quarter margin">${groups}<line x1="36" x2="848" y1="${mid}" y2="${mid}" stroke="#2a2a2a"/></svg>`;
}
