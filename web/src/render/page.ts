import type { Factor } from "../api/Factor.ts";
import type { Game } from "../api/Game.ts";
import type { Headline } from "../api/Headline.ts";
import type { LatestGame } from "../api/LatestGame.ts";
import type { PlayerRow } from "../api/PlayerRow.ts";
import type { Report } from "../api/Report.ts";
import type { Season } from "../api/Season.ts";
import type { ShotMap } from "../api/ShotMap.ts";
import { dateTime, escapeHtml as e, fixed, lastName, longDate, percent, record, shortDate, signed } from "../format.ts";
import { heat, marginChart, quarterChart, ROLLING_DEFAULT } from "./charts.ts";
import { knicksMark, liberty } from "./brand.ts";
import { hosted, margin, site, won } from "./game.ts";
import { impactLabel, impactTitle } from "./impact.ts";
import { shotMap, shotSeason } from "./shots.ts";
import { LAYERS, type ReportView } from "../route.ts";
import { syncControl } from "../sync.ts";

const TEAM = "Knicks";
const SMALL_SAMPLE = 20;

/** The report with its current and last regular seasons looked up. */
type PageData = Report & { current: Season | null; lastRegular: Season | null };

const cell = (value: number, scale: number, text: string, extra = "") => {
  const { bg, fg } = heat(value, scale);
  return `<span class="cell${extra}" style="background:${bg};color:${fg}">${text}</span>`;
};

/** Season switch plus one panel per season; the current season starts visible unless `open` names another. */
function seasonPanels(report: PageData, body: (season: Season) => string, open: string | null = null): string {
  const panels = [...report.seasons].reverse();
  const on = open ?? report.current?.key;
  const buttons = panels
    .map((s) => `<button type="button" data-pick="${s.key}" class="${s.key === on ? "on" : ""}">${e(s.label)}</button>`)
    .join("");
  return (
    `<div class="switch">${buttons}</div>` +
    panels.map((s) => `<div data-panel="${s.key}"${s.key === on ? "" : " hidden"}>${body(s)}</div>`).join("")
  );
}

export function table(head: string[], rows: string[][], className = ""): string {
  return (
    `<div class="scroll${className ? ` ${className}` : ""}"><table><thead><tr>${head.map((h) => `<th>${h}</th>`).join("")}</tr></thead>` +
    `<tbody>${rows.map((r) => `<tr>${r.map((c) => (c.startsWith("<td") ? c : `<td>${c}</td>`)).join("")}</tr>`).join("")}</tbody></table></div>`
  );
}

// ---------------------------------------------------------------- sections

function headlineText(headline: Headline | null): string {
  switch (headline?.kind) {
    case "offense":
      return `Offense ${Math.abs(headline.change).toFixed(1)} points ${headline.change < 0 ? "behind" : "ahead"}`;
    case "defense":
      return `Defense ${Math.abs(headline.change).toFixed(1)} points ${headline.change < 0 ? "better" : "worse"}`;
    case "quarter":
      return `Q${headline.quarter} ${signed(headline.margin)}, was ${signed(headline.was)}`;
    case "net":
      return `Net ${signed(headline.net)}, was ${signed(headline.was)}`;
    case "games":
      return `${headline.games} game${headline.games === 1 ? "" : "s"} played`;
    default:
      return "";
  }
}

function hero(report: PageData): string {
  const now = report.current;
  if (!now) return `<section><h1>No games stored yet</h1><p class="note">Run <code>cargo run -- sync</code> to load games from ESPN.</p></section>`;
  const r = now.ratings;
  const last = report.lastRegular?.ratings ?? null;

  const headline = headlineText(report.headline);
  const notes = [`${r.games} game${r.games === 1 ? "" : "s"}.`];
  if (r.games < SMALL_SAMPLE) notes.push("One night still moves the rate.");
  if (report.champion) {
    const c = report.champion;
    notes.push(`Finals ${record(c.wins, c.losses)} vs ${e(c.opponent)}.`);
  } else if (report.lastSeries) {
    const s = report.lastSeries;
    notes.push(`${e(s.round)} ${record(s.wins, s.losses)}, ${e(s.opponent)}.`);
  }
  const tile = (label: string, value: string, was: string | null) =>
    `<div class="tile"><p class="kicker">${label}</p><p class="big">${value}</p>${was === null ? "" : `<p class="note">Last year ${was}</p>`}</div>`;
  return `<section>
  <p class="kicker accent">${e(now.label)} · ${record(r.wins, r.losses)}</p>
  <h1>${headline}</h1>
  <p class="note">${notes.join(" ")}</p>
  <div class="tiles">${[
    tile("Record", record(r.wins, r.losses), last && record(last.wins, last.losses)),
    tile("Net", signed(r.net), last && signed(last.net)),
    tile("Offense", fixed(r.offense), last && fixed(last.offense)),
    tile("Defense", fixed(r.defense), last && fixed(last.defense)),
  ].join("")}</div>
</section>`;
}

export const periodName = (i: number) => (i < 4 ? `Q${i + 1}` : i === 4 ? "OT" : `OT${i - 3}`);

/** Score by period for both teams, with the margin. */
export function scoreTable(game: Game): string {
  const quartersPlayed = game.usByPeriod.map((p, i) => p - (game.themByPeriod[i] ?? 0));
  const head = ["Team", ...game.usByPeriod.map((_, i) => periodName(i)), "Final"];
  const rows = [
    [TEAM, ...game.usByPeriod.map(String), `<b>${game.pts}</b>`],
    [e(game.opponent.abbreviation), ...game.themByPeriod.map(String), String(game.oppPts)],
    ["Margin", ...quartersPlayed.map((d) => signed(d, 0)), signed(margin(game), 0)],
  ];
  return table(head, rows);
}

/** Date, opponent and venue. */
export function gameWhere(game: Game): string {
  const attendance = game.attendance === null ? null : `Attendance ${game.attendance.toLocaleString("en-US")}`;
  return [longDate(game.startsAt), `${hosted(game) ? "vs" : "at"} ${game.opponent.abbreviation}`, game.venue, attendance, game.note]
    .filter(Boolean)
    .map((w) => e(w!))
    .join(" · ");
}

export function pageHeader(): string {
  return `<header>
  <div class="brand">${knicksMark}<div><p class="kicker">New York Knicks</p><strong>Game to game</strong><p class="note">${syncControl()}</p></div></div>
  ${liberty}
</header>`;
}

/** Both rows of navigation: the layers, then the tabs of the layer in view. */
export function layerNav(layer: string, tab: string): string {
  const current = LAYERS.find((l) => l.id === layer) ?? LAYERS[0];
  const link = (href: string, label: string, on: boolean) => `<a href="#${href}"${on ? ` class="on"` : ""}>${label}</a>`;
  return (
    `<nav class="layers">${LAYERS.map((l) => link(`${l.id}/${l.tabs[0].id}`, l.label, l === current)).join("")}</nav>` +
    `<nav>${current.tabs.map((t) => link(`${current.id}/${t.id}`, t.label, t.id === tab)).join("")}</nav>`
  );
}

function latestGame(game: LatestGame | null): string {
  if (!game) return "";
  const quartersPlayed = game.usByPeriod.map((p, i) => p - (game.themByPeriod[i] ?? 0));
  const swing = quartersPlayed.reduce((best, d, i) => (Math.abs(d) > Math.abs(quartersPlayed[best]!) ? i : best), 0);
  const top = game.topScorer;
  const summary = [
    `${site(game)} ${won(game) ? "win" : "loss"}.`,
    `${periodName(swing)} ${signed(quartersPlayed[swing] ?? 0, 0)}.`,
    top ? `${e(lastName(top.fullName))} ${top.pts} pts.` : "",
  ].join(" ");
  return `<section><p class="kicker">Latest game</p><h2>${TEAM} ${game.pts}, ${e(game.opponent.name)} ${game.oppPts}</h2>` +
    `<p class="note">${gameWhere(game)}</p><p>${summary} <a href="#game/${e(game.id)}">Player by player</a></p>${scoreTable(game)}</section>`;
}

function seasonCards(report: PageData): string {
  const card = (s: Season) => {
    const r = s.ratings;
    const rows: [string, string][] = [
      ["Margin", signed(r.margin)], ["Offense", fixed(r.offense)], ["Defense", fixed(r.defense)], ["Net", signed(r.net)],
      ["Pace", fixed(r.pace)], ["Scored", fixed(r.scored)], ["Allowed", fixed(r.allowed)],
    ];
    return `<article class="card"><p class="kicker">${e(s.label)}</p><p class="big">${record(r.wins, r.losses)}</p>` +
      `<dl>${rows.map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`).join("")}</dl></article>`;
  };
  const now = report.current?.ratings;
  const last = report.lastRegular?.ratings;
  const lede = now ? `Net ${signed(now.net)}.${last ? ` Last year ${signed(last.net)}.` : ""}` : "";
  // This season, the one it's compared with, then the rest, most recent first.
  const compared = [report.current, report.lastRegular].filter((s) => s !== null);
  const ordered = [...compared, ...report.seasons.filter((s) => !compared.includes(s))];
  return `<section>
  <p class="kicker">Team / Season</p>
  <h2>Last year against this year</h2>
  <p>${lede}</p>
  <div class="cards">${ordered.map(card).join("")}</div>
</section>`;
}

function gameLinks(games: Game[]): string {
  const links = [...games].reverse().map((g) =>
    `<a href="#game/${e(g.id)}">${shortDate(g.startsAt)} ${e(g.opponent.abbreviation)} <span class="${won(g) ? "good" : "bad"}">${signed(margin(g), 0)}</span></a>`);
  return `<div class="gamelinks">${links.join("")}</div>`;
}

function gamesSection(report: PageData): string {
  const windows = report.current?.rolling.map((r) => r.window) ?? [];
  const windowSwitch = windows
    .map((w) => `<button type="button" data-group="window" data-pick="${w}" class="${w === ROLLING_DEFAULT ? "on" : ""}">${w}-game average</button>`)
    .join("");
  const latest = (s: Season) => {
    const g = s.games.at(-1);
    return g ? `Latest: ${shortDate(g.startsAt)} ${e(g.opponent.abbreviation)} ${signed(margin(g), 0)}.` : "";
  };
  return `${latestGame(report.latestGame)}<section>
  <p class="kicker">Team / Games</p>
  <h2>The margin, one night at a time</h2>
  <p>Dot is the final margin. Line is the running average.</p>
  <div class="switch">${windowSwitch}</div>
  ${seasonPanels(report, (s) => `${marginChart(s)}<p class="readout">${latest(s)}</p><p class="note">Orange win. Blue loss. White line, running average. Point at a game for its numbers; pick it to see it player by player.</p>${gameLinks(s.games)}`)}
</section>`;
}

function quartersSection(report: PageData): string {
  const rows = report.quarters;
  if (!rows) return "";
  const best = rows.reduce((a, b) => (b.margin > a.margin ? b : a));
  const worst = rows.reduce((a, b) => (b.margin < a.margin ? b : a));
  const summary = table(
    ["Quarter", "Scored", "Allowed", "Margin", "A–B–T", "Last year", "Change"],
    rows.map((r) => [
      `Q${r.quarter}`, fixed(r.scored), fixed(r.allowed), cell(r.margin, 6, signed(r.margin)),
      `${r.ahead}–${r.behind}–${r.tied}`,
      r.lastMargin === null ? "—" : signed(r.lastMargin),
      r.lastMargin === null ? "—" : signed(r.margin - r.lastMargin),
    ]),
  );
  const perGame = (s: Season) =>
    table(
      ["Game", "Final", "Q1", "Q2", "Q3", "Q4", "OT"],
      [...s.games].reverse().map((g) => {
        const q = (i: number) => (g.usByPeriod[i] ?? 0) - (g.themByPeriod[i] ?? 0);
        const ot = g.usByPeriod.slice(4).reduce((a, p, i) => a + p - (g.themByPeriod[i + 4] ?? 0), 0);
        return [
          `<td class="name">${shortDate(g.startsAt)} ${hosted(g) ? "vs" : "@"} ${e(g.opponent.abbreviation)}</td>`,
          `<td class="${won(g) ? "" : "loss"}">${g.pts}–${g.oppPts}</td>`,
          ...[0, 1, 2, 3].map((i) => cell(q(i), 15, signed(q(i), 0))),
          g.periods > 4 ? cell(ot, 15, signed(ot, 0)) : `<td class="empty">—</td>`,
        ];
      }),
      "heat",
    );
  return `<section>
  <p class="kicker">Team / Quarters</p>
  <h2>Where the game is won or lost</h2>
  <p>Best Q${best.quarter} ${signed(best.margin)}. Softest Q${worst.quarter} ${signed(worst.margin)}.</p>
  ${quarterChart(rows)}
  ${summary}
  ${seasonPanels(report, perGame)}
  <p class="legend"><span>Behind</span><span class="bar"></span><span>Ahead</span></p>
</section>`;
}

function factorsSection(report: PageData): string {
  if (!report.factors) return "";
  const { offense, defense } = report.factors;
  const scale = (f: Factor) => (f.now - f.was) * (f.isPercent ? 100 : 1);
  const top = Math.max(0.1, ...[...offense, ...defense].map((f) => Math.abs(scale(f))));
  const row = (f: Factor) => {
    const d = scale(f);
    const color = d === 0 ? "#a39e94" : (d > 0) === f.higherHelps ? "#b7c98a" : "#e09a94";
    const width = (Math.abs(d) / top) * 50;
    const show = (v: number) => (f.isPercent ? percent(v) : fixed(v));
    return `<div class="factor"><div><p>${f.label}</p><p class="note">${show(f.now)} <span class="faint">was ${show(f.was)}</span></p></div>` +
      `<div class="track"><i style="left:${d < 0 ? 50 - width : 50}%;width:${width}%;background:${color}"></i></div>` +
      `<b style="color:${color}">${signed(d)}</b></div>`;
  };
  return `<section>
  <p class="kicker">Team / Offense and defense</p>
  <h2>Four factors, both ends</h2>
  <p>This season against last. Olive helps. Rose hurts.</p>
  <p class="kicker faint">Offense</p>${offense.map(row).join("")}<p class="kicker faint">Defense</p>${defense.map(row).join("")}
</section>`;
}

function situationsSection(report: PageData): string {
  const list = report.situations;
  if (!list) return "";
  const lede = list
    .slice(0, 3)
    .filter((s) => s.now)
    .map((s) => `${s.label} ${signed(s.now!.margin)}.`)
    .join(" ");
  const card = (s: (typeof list)[number]) => {
    const now = s.now;
    const big = now ? `<p class="big ${now.margin >= 0 ? "good" : "bad"}">${signed(now.margin)}</p>` : `<p class="big faint">—</p>`;
    const detail = now ? `<p class="note">${record(now.wins, now.losses)} · ${now.games} g · net ${signed(now.net)}</p>` : `<p class="note">No games</p>`;
    const last = s.last ? `<p class="note">Last year ${signed(s.last.margin)}</p>` : "";
    return `<article class="card"><p class="kicker">${s.label}</p>${big}${detail}${last}</article>`;
  };
  return `<section>
  <p class="kicker">Team / Situations</p>
  <h2>Home, road, and the night after</h2>
  <p>${lede}</p>
  <div class="cards">${list.map(card).join("")}</div>
</section>`;
}

function pairsSection(report: PageData): string {
  const best = report.current?.playerReport.pairs.best;
  const worst = report.current?.playerReport.pairs.worst;
  const lede = [
    best ? `Best ${e(best.a)}–${e(best.b)} ${signed(best.cell.net48)}.` : "",
    worst ? `Softest ${e(worst.a)}–${e(worst.b)} ${signed(worst.cell.net48)}.` : "",
  ].join(" ");
  const matrix = (s: Season) => {
    const { players, cells, best: top } = s.playerReport.pairs;
    if (players.length === 0) return `<p class="note">No play-by-play replay for this season.</p>`;
    const head = `<tr><th></th>${players.map((p) => `<th class="up"><span>${e(p.last)}</span></th>`).join("")}</tr>`;
    const body = players
      .map((a, i) => {
        const tds = players.map((b, j) => {
          const c = cells[i]![j];
          if (!c) return `<td class="empty"></td>`;
          const { bg, fg } = heat(c.net48, 12);
          const text = signed(c.net48, 0);
          if (i === j) return `<td><span class="cell sq" style="background:${bg};color:${fg}">${text}</span></td>`;
          const tip = `${a.last} + ${b.last}, ${signed(c.net48)} per 48, ${Math.round(c.seconds / 60)} min`;
          return `<td><button type="button" class="cell sq" style="background:${bg};color:${fg}" data-tip="${e(tip)}">${text}</button></td>`;
        });
        return `<tr><th>${e(a.last)}</th>${tds.join("")}</tr>`;
      })
      .join("");
    const readout = top ? `${top.a}–${top.b} ${signed(top.cell.net48)}. ${Math.round(top.cell.seconds / 60)} shared minutes.` : "";
    return `<div class="scroll"><table class="pairs"><thead>${head}</thead><tbody>${body}</tbody></table></div><p class="readout">${e(readout)}</p>`;
  };
  return `<section>
  <p class="kicker">Players / Pairings</p>
  <h2>Who helps whom</h2>
  <p>${lede}</p>
  ${seasonPanels(report, matrix)}
  <p class="note">Net points per 48 minutes with both on the floor. Blank under ${report.pairMinSeconds / 60} shared minutes. Diagonal is that player on the floor.</p>
</section>`;
}

/** A header cell that sorts its table by this column, and a body cell carrying the value it sorts by. */
const sortHead = (label: string) => `<button type="button" data-sort>${label}</button>`;
const sortCell = (value: number | null, text: string) => `<td data-v="${value ?? ""}">${text}</td>`;

/** On−off as a number with a bar from the middle, full at this many points. */
const SWING_FULL = 20;
function swing(diff: number | null): string {
  if (diff === null) return sortCell(null, "—");
  const width = (Math.min(SWING_FULL, Math.abs(diff)) / SWING_FULL) * 50;
  const bar = `<span class="track swing"><i style="left:${diff < 0 ? 50 - width : 50}%;width:${width}%;background:${diff < 0 ? "#7eadd4" : "#e07a3d"}"></i></span>`;
  return sortCell(diff, `${signed(diff)}${bar}`);
}

function playersSection(report: PageData): string {
  const leader = report.current?.playerReport.players
    .filter((p) => p.impact.kind !== "lowMinutes" && p.onOff !== null)
    .sort((a, b) => b.onOff! - a.onOff!)[0];
  const rows = (s: Season) => {
    // Only the current season is compared with the one before.
    const compared = s.key === report.currentKey && report.lastRegular !== null;
    const head = ["Player", "GP", ...["Min", "Pts", "Reb", "Ast", "TS%", "+/−", "On−off"].map(sortHead)];
    if (compared) head.push("Last year");
    head.push(sortHead("Opp/48"), "Impact");
    return table(
      head,
      s.playerReport.players.map((p: PlayerRow) => [
        `<a href="#player/${p.id}">${e(p.name)}</a>${p.position ? ` <span class="pos">${e(p.position)}</span>` : ""}`,
        String(p.gp),
        sortCell(p.mpg, fixed(p.mpg)), sortCell(p.ppg, fixed(p.ppg)), sortCell(p.rpg, fixed(p.rpg)), sortCell(p.apg, fixed(p.apg)),
        sortCell(p.ts, percent(p.ts)), sortCell(p.plusMinus, signed(p.plusMinus)),
        swing(p.onOff),
        ...(compared ? [p.previousOnOff === null ? "—" : signed(p.previousOnOff)] : []),
        sortCell(p.opp48, p.opp48 === null ? "—" : fixed(p.opp48)),
        `<span class="chip ${p.impact.tone}" title="${e(impactTitle(p))}">${impactLabel(p)}</span>`,
      ]),
    );
  };
  return `<section>
  <p class="kicker">Players / Impact</p>
  <h2>What kind of impact</h2>
  <p>${leader ? `${e(leader.last)} ${signed(leader.onOff!)} on/off.` : ""}</p>
  ${seasonPanels(report, rows)}
  <p class="note">Most minutes first. Pick a column heading to sort by it; pick it again to turn the order around.</p>
</section>`;
}

function shotsSection(report: PageData, maps: ShotMap[], player: string | null): string {
  const open = shotSeason(maps, report.seasons, player, report.currentKey);
  return `<section>
  <p class="kicker">Players / Shots</p>
  <h2>Where the shots come from</h2>
  <p>Every Knicks field-goal attempt inside half court. Orange dot made, blue ring missed.</p>
  ${seasonPanels(report, (s) => shotMap(maps.find((m) => m.key === s.key), s.key === open ? player : null), open)}
</section>`;
}

/** By "layer/tab", as in route.ts. */
const SECTIONS: Record<string, (report: PageData) => string> = {
  "team/season": seasonCards,
  "team/games": gamesSection,
  "team/quarters": quartersSection,
  "team/factors": factorsSection,
  "team/situations": situationsSection,
  "players/impact": playersSection,
  "players/pairs": pairsSection,
};

/**
 * Everything inside <body>: header, navigation, the hero, the tab in view, and
 * the footer. `shots` is needed for the Shots tab only.
 */
export function renderBody(api: Report, view: ReportView, shots: ShotMap[] | null): string {
  const season = (key: string | null) => api.seasons.find((s) => s.key === key) ?? null;
  const report: PageData = { ...api, current: season(api.currentKey), lastRegular: season(api.lastRegularKey) };
  const updated = report.syncedAt ? `Updated ${dateTime(report.syncedAt)}` : "No data yet";
  return `${pageHeader()}
<main>
${layerNav(view.layer, view.tab)}
${hero(report)}
${!report.current ? "" : shots && view.tab === "shots" ? shotsSection(report, shots, view.arg) : (SECTIONS[`${view.layer}/${view.tab}`]?.(report) ?? "")}
</main>
<footer>
  <p>ESPN box scores and play-by-play. ${updated}. ${report.gameCount} games. On-court splits keep a game when the lineup replay is within ${report.replayTolerance} points of the box plus-minus (${report.replayedGames} of ${report.gameCount} kept).</p>
</footer>`;
}
