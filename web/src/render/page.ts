import type { Factor } from "../api/Factor.ts";
import type { LatestGame } from "../api/LatestGame.ts";
import type { PlayerRow } from "../api/PlayerRow.ts";
import type { Report } from "../api/Report.ts";
import type { Season } from "../api/Season.ts";
import { dateTime, escapeHtml as e, fixed, lastName, longDate, percent, record, shortDate, signed } from "../format.ts";
import { heat, marginChart, quarterChart } from "./charts.ts";
import { knicksMark, liberty } from "./brand.ts";
import { margin, won } from "./game.ts";
import { impactLabel, impactTitle } from "./impact.ts";

const TEAM = "Knicks";
const SMALL_SAMPLE = 20;

/** The report with its current and last regular seasons looked up. */
type PageData = Report & { current: Season | null; lastRegular: Season | null };

const cell = (value: number, scale: number, text: string, extra = "") => {
  const { bg, fg } = heat(value, scale);
  return `<span class="cell${extra}" style="background:${bg};color:${fg}">${text}</span>`;
};

/** Season switch plus one panel per season; the current season starts visible. */
function seasonPanels(report: PageData, body: (season: Season) => string): string {
  const panels = [...report.seasons].reverse();
  const on = report.current?.key;
  const buttons = panels
    .map((s) => `<button type="button" data-pick="${s.key}" class="${s.key === on ? "on" : ""}">${e(s.label)}</button>`)
    .join("");
  return (
    `<div class="switch">${buttons}</div>` +
    panels.map((s) => `<div data-panel="${s.key}"${s.key === on ? "" : " hidden"}>${body(s)}</div>`).join("")
  );
}

function table(head: string[], rows: string[][], className = ""): string {
  return (
    `<div class="scroll${className ? ` ${className}` : ""}"><table><thead><tr>${head.map((h) => `<th>${h}</th>`).join("")}</tr></thead>` +
    `<tbody>${rows.map((r) => `<tr>${r.map((c) => (c.startsWith("<td") ? c : `<td>${c}</td>`)).join("")}</tr>`).join("")}</tbody></table></div>`
  );
}

// ---------------------------------------------------------------- sections

function hero(report: PageData): string {
  const now = report.current;
  if (!now) return `<section><h1>No games stored yet</h1><p class="note">Run <code>npm run sync</code> to load games from ESPN.</p></section>`;
  const r = now.ratings;
  const last = report.lastRegular?.ratings ?? null;

  let headline = `${r.games} games played`;
  if (last) {
    const off = r.offense - last.offense;
    const def = r.defense - last.defense;
    headline =
      Math.abs(off) >= Math.abs(def)
        ? `Offense ${Math.abs(off).toFixed(1)} points ${off < 0 ? "behind" : "ahead"}`
        : `Defense ${Math.abs(def).toFixed(1)} points ${def < 0 ? "better" : "worse"}`;
  }
  const notes = [`${r.games} game${r.games === 1 ? "" : "s"}.`];
  if (r.games < SMALL_SAMPLE) notes.push("One night still moves the rate.");
  if (report.lastSeries) {
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

function latestGame(game: LatestGame | null): string {
  if (!game) return "";
  const quartersPlayed = game.usByPeriod.map((p, i) => p - (game.themByPeriod[i] ?? 0));
  const swing = quartersPlayed.reduce((best, d, i) => (Math.abs(d) > Math.abs(quartersPlayed[best]!) ? i : best), 0);
  const top = game.topScorer;
  const periodName = (i: number) => (i < 4 ? `Q${i + 1}` : i === 4 ? "OT" : `OT${i - 3}`);
  const summary = [
    `${game.home ? "Home" : "Road"} ${won(game) ? "win" : "loss"}.`,
    `${periodName(swing)} ${signed(quartersPlayed[swing] ?? 0, 0)}.`,
    top ? `${e(lastName(top.fullName))} ${top.pts} pts.` : "",
  ].join(" ");
  const head = ["Team", ...game.usByPeriod.map((_, i) => periodName(i)), "Final"];
  const rows = [
    [TEAM, ...game.usByPeriod.map(String), `<b>${game.pts}</b>`],
    [e(game.opponent.abbreviation), ...game.themByPeriod.map(String), String(game.oppPts)],
    ["Margin", ...quartersPlayed.map((d) => signed(d, 0)), signed(margin(game), 0)],
  ];
  const where = [longDate(game.startsAt), `${game.home ? "vs" : "at"} ${game.opponent.abbreviation}`, game.venue].filter(Boolean);
  return `<section><p class="kicker">Latest game</p><h2>${TEAM} ${game.pts}, ${e(game.opponent.name)} ${game.oppPts}</h2>` +
    `<p class="note">${where.map((w) => e(w!)).join(" · ")}</p><p>${summary}</p>${table(head, rows)}</section>`;
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
  return `<section id="season">
  <p class="kicker">01 / Season</p>
  <h2>Last year against this year</h2>
  <p>${lede}</p>
  <div class="cards">${report.seasons.map(card).join("")}</div>
</section>`;
}

function gamesSection(report: PageData): string {
  return `<section id="games">
  <p class="kicker">02 / Game to game</p>
  <h2>The margin, one night at a time</h2>
  <p>Dot is the final margin. Line is the running average.</p>
  ${seasonPanels(report, (s) => `${marginChart(s.games)}<p class="note">Orange win. Blue loss. White line, 5-game average.</p>`)}
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
          `<td class="name">${shortDate(g.startsAt)} ${g.home ? "vs" : "@"} ${e(g.opponent.abbreviation)}</td>`,
          `<td class="${won(g) ? "" : "loss"}">${g.pts}–${g.oppPts}</td>`,
          ...[0, 1, 2, 3].map((i) => cell(q(i), 15, signed(q(i), 0))),
          g.periods > 4 ? cell(ot, 15, signed(ot, 0)) : `<td class="empty">—</td>`,
        ];
      }),
      "heat",
    );
  return `<section id="quarters">
  <p class="kicker">03 / Quarters</p>
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
  return `<section id="factors">
  <p class="kicker">04 / Offense and defense</p>
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
  return `<section id="situations">
  <p class="kicker">05 / Situations</p>
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
  return `<section id="pairs">
  <p class="kicker">06 / Pairings</p>
  <h2>Who helps whom</h2>
  <p>${lede}</p>
  ${seasonPanels(report, matrix)}
  <p class="note">Net points per 48 minutes with both on the floor. Blank under ${report.pairMinSeconds / 60} shared minutes. Diagonal is that player on the floor.</p>
</section>`;
}

function playersSection(report: PageData): string {
  const onOff = (p: PlayerRow) => (p.on48 === null || p.off48 === null ? null : p.on48 - p.off48);
  const leader = report.current?.playerReport.players
    .filter((p) => p.impact.kind !== "lowMinutes" && onOff(p) !== null)
    .sort((a, b) => onOff(b)! - onOff(a)!)[0];
  const rows = (s: Season) =>
    table(
      ["Player", "GP", "Min", "Pts", "Reb", "Ast", "TS%", "+/−", "On−off", "Opp/48", "Impact"],
      s.playerReport.players.map((p) => {
        const diff = onOff(p);
        return [
          `${e(p.name)}${p.position ? ` <span class="pos">${e(p.position)}</span>` : ""}`,
          String(p.gp), fixed(p.mpg), fixed(p.ppg), fixed(p.rpg), fixed(p.apg), percent(p.ts), signed(p.plusMinus),
          diff === null ? "—" : signed(diff),
          p.opp48 === null ? "—" : fixed(p.opp48),
          `<span class="chip ${p.impact.tone}" title="${e(impactTitle(p))}">${impactLabel(p)}</span>`,
        ];
      }),
    );
  return `<section id="players">
  <p class="kicker">07 / Players</p>
  <h2>What kind of impact</h2>
  <p>${leader ? `${e(leader.last)} ${signed(onOff(leader)!)} on/off.` : ""}</p>
  ${seasonPanels(report, rows)}
</section>`;
}

/** Everything inside <body>: header, main and footer. */
export function renderBody(api: Report): string {
  const season = (key: string | null) => api.seasons.find((s) => s.key === key) ?? null;
  const report: PageData = { ...api, current: season(api.currentKey), lastRegular: season(api.lastRegularKey) };
  const updated = report.syncedAt ? `Updated ${dateTime(report.syncedAt)}` : "No data yet";
  return `<header>
  <div class="brand">${knicksMark}<div><p class="kicker">New York Knicks</p><strong>Game to game</strong><p class="note">${updated}</p></div></div>
  ${liberty}
</header>
<main>
<nav>
  <a href="#season">Season</a><a href="#games">Game to game</a><a href="#quarters">Quarters</a>
  <a href="#factors">Offense and defense</a><a href="#situations">Situations</a><a href="#pairs">Pairings</a><a href="#players">Players</a>
</nav>
${hero(report)}
${latestGame(report.latestGame)}
${report.current ? [seasonCards(report), gamesSection(report), quartersSection(report), factorsSection(report), situationsSection(report), pairsSection(report), playersSection(report)].join("\n") : ""}
</main>
<footer>
  <p>ESPN box scores and play-by-play. ${updated}. ${report.gameCount} games. On-court splits keep a game when the lineup replay is within ${report.replayTolerance} points of the box plus-minus (${report.replayedGames} of ${report.gameCount} kept).</p>
</footer>`;
}
