import type { GameMoment, QuarterRow, Season } from "../../../server/schema.ts";
import { escapeHtml, fixed, longDate, signed } from "../format.ts";
import { hosted, margin, won } from "./game.ts";

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

/** The running average shown until the reader picks another: the longer one once the season has enough games for it to differ. */
export const rollingDefault = (season: Season | null) => (season && season.games.length >= 12 ? 10 : 5);

/**
 * Dot per game for the final margin, line for the running average: one line
 * per window length, switched by the "window" group, `shown` at first. A
 * dot's data-tip is its readout.
 */
export function marginChart(season: Season, shown: number): string {
  const games = season.games;
  if (games.length === 0) return `<p class="note">No games yet.</p>`;
  const margins = games.map(margin);
  const top = Math.max(5, ...margins.map(Math.abs));
  const [left, right, mid, half] = [36, 852, 124, 112];
  const x = (i: number) => (games.length === 1 ? left : left + ((right - left) * i) / (games.length - 1));
  const y = (v: number) => mid - (v / top) * half;

  const lines = season.rolling
    .map((rolling) => {
      const points: string[] = [];
      rolling.values.forEach((avg, i) => {
        if (avg !== null) points.push(`${points.length ? "L" : "M"}${x(i).toFixed(1)},${y(avg).toFixed(1)}`);
      });
      if (points.length < 2) return "";
      const hidden = rolling.window === shown ? "" : " hidden";
      return `<path data-group="window" data-panel="${rolling.window}"${hidden} d="${points.join(" ")}" fill="none" stroke="#f4f1ea" stroke-width="2.2"/>`;
    })
    .join("");
  const label = (text: string, ty: number) =>
    `<text x="0" y="${ty.toFixed(1)}" fill="#a39e94" font-size="11" font-family="Arial">${text}</text>`;
  const dots = games
    .map((g, i) => {
      const tip =
        `${longDate(g.startsAt)} ${hosted(g) ? "vs" : "at"} ${g.opponent.abbreviation} · ${signed(margins[i]!, 0)} · ` +
        `${g.pts}–${g.oppPts} · Offense ${fixed(g.offense)}, defense ${fixed(g.defense)}`;
      return `<a href="#game/${escapeHtml(g.id)}" data-tip="${escapeHtml(tip)}"><circle cx="${x(i).toFixed(1)}" cy="${y(margins[i]!).toFixed(1)}" r="4.5" fill="${won(g) ? ORANGE : BLUE}"/></a>`;
    })
    .join("");
  return (
    `<svg viewBox="0 0 860 260" role="img" aria-label="Game margin">` +
    `<line x1="${left}" x2="${right}" y1="${mid}" y2="${mid}" stroke="#2a2a2a"/>` +
    label(`+${top}`, mid - half + 4) + label("0", mid + 4) + label(`-${top}`, mid + half + 4) +
    lines +
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

/** Seconds of play before a moment: 12-minute quarters, then 5-minute overtimes. */
function elapsed(m: GameMoment): number {
  const before = m.period <= 4 ? (m.period - 1) * 720 : 2880 + (m.period - 5) * 300;
  return before + (m.period <= 4 ? 720 : 300) - m.clockSeconds;
}

/** The margin through a game as a stepped line: up when the Knicks lead. */
export function flowChart(flow: GameMoment[], periods: number): string {
  const total = 2880 + 300 * Math.max(0, periods - 4);
  const margins = flow.map((m) => m.us - m.them);
  const top = Math.max(5, ...margins.map(Math.abs));
  const [left, right, mid, half] = [36, 852, 110, 92];
  const x = (seconds: number) => left + ((right - left) * Math.min(total, seconds)) / total;
  const y = (v: number) => mid - (v / top) * half;
  const steps = flow.map((m, i) => `${i ? "H" : "M"}${x(elapsed(m)).toFixed(1)}${i ? "V" : ","}${y(margins[i]!).toFixed(1)}`);
  const text = (tx: number, ty: number, label: string, anchor = "start") =>
    `<text x="${tx.toFixed(1)}" y="${ty.toFixed(1)}" text-anchor="${anchor}" fill="#a39e94" font-size="11" font-family="Arial">${label}</text>`;
  let grid = "";
  for (let period = 1; period <= Math.max(4, periods); period++) {
    const start = period <= 4 ? (period - 1) * 720 : 2880 + (period - 5) * 300;
    const end = start + (period <= 4 ? 720 : 300);
    if (period > 1) grid += `<line x1="${x(start).toFixed(1)}" x2="${x(start).toFixed(1)}" y1="${mid - half}" y2="${mid + half}" stroke="#2a2a2a"/>`;
    grid += text(x((start + end) / 2), mid + half + 18, period <= 4 ? `Q${period}` : period === 5 ? "OT" : `OT${period - 4}`, "middle");
  }
  return (
    `<svg viewBox="0 0 860 236" role="img" aria-label="Margin through the game">` +
    grid +
    `<line x1="${left}" x2="${right}" y1="${mid}" y2="${mid}" stroke="#2a2a2a"/>` +
    text(0, mid - half + 4, `+${top}`) + text(0, mid + 4, "0") + text(0, mid + half + 4, `-${top}`) +
    `<path d="${steps.join("")}H${right}" fill="none" stroke="#f4f1ea" stroke-width="2"/>` +
    `</svg>`
  );
}
