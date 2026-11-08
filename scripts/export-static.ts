import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { heatStyle } from "../src/components/heat";
import { LIBERTY_PIXEL, LIBERTY_ROWS } from "../src/components/marks";
import { buildReport, type FactorRow, type GameStub, type PairBoard, type PlayerRollup, type SeasonView } from "../src/lib/analytics";
import { etDate, etDateTime, fixed, place, record, signed } from "../src/lib/format";
import { readStore } from "../src/lib/store";

function esc(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function styleAttr(style: { background: string; color: string }): string {
  return `style="background:${style.background};color:${style.color}"`;
}

const MARK = `<svg class="mark" viewBox="0 0 64 64" role="img" aria-label="New York Knicks"><circle cx="32" cy="32" r="30" fill="#006BB6"/><circle cx="32" cy="32" r="27" fill="none" stroke="#F58426" stroke-width="2.5"/><path d="M32 8c2 6 2 10 0 16M32 40c-2 6-2 10 0 16M8 32c6-2 10-2 16 0M40 32c6 2 10 2 16 0" fill="none" stroke="#F58426" stroke-width="1.2" opacity="0.7"/><text x="32" y="39" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-weight="700" font-size="20" fill="#F58426">NY</text></svg>`;

function liberty(): string {
  const size = 4;
  const cols = LIBERTY_ROWS[0]?.length ?? 0;
  const rects = LIBERTY_ROWS.flatMap((row, y) =>
    [...row].flatMap((cell, x) => {
      const fill = LIBERTY_PIXEL[cell];
      return fill ? [`<rect x="${x * size}" y="${y * size}" width="${size}" height="${size}" fill="${fill}"/>`] : [];
    }),
  ).join("");
  return `<svg class="liberty" viewBox="0 0 ${cols * size} ${LIBERTY_ROWS.length * size}" role="img" aria-label="Pixel Statue of Liberty" shape-rendering="crispEdges">${rects}</svg>`;
}

function marginSvg(games: GameStub[]): string {
  const width = 860;
  const height = 260;
  const pad = { l: 36, r: 8, t: 12, b: 24 };
  const peak = Math.max(8, ...games.map((game) => Math.abs(game.margin)), 1);
  const innerW = width - pad.l - pad.r;
  const innerH = height - pad.t - pad.b;
  const x = (index: number) => (games.length <= 1 ? pad.l + innerW / 2 : pad.l + (index / (games.length - 1)) * innerW);
  const y = (margin: number) => pad.t + ((peak - margin) / (peak * 2)) * innerH;
  const windowSize = games.length >= 12 ? 10 : 5;
  const rolling = games.map((_, index) => {
    const slice = games.slice(Math.max(0, index - windowSize + 1), index + 1).map((game) => game.margin);
    if (slice.length < Math.min(3, windowSize)) return null;
    return slice.reduce((sum, value) => sum + value, 0) / slice.length;
  });
  let path = "";
  let pen = false;
  rolling.forEach((value, index) => {
    if (value == null) {
      pen = false;
      return;
    }
    path += `${pen ? "L" : "M"}${x(index).toFixed(1)},${y(value).toFixed(1)} `;
    pen = true;
  });
  const dots = games
    .map((game, index) => {
      const fill = game.win ? "#e07a3d" : "#7eadd4";
      const label = `${etDate(game.date)} ${game.opponentAbbr} ${signed(game.margin, 0)}`;
      return `<circle cx="${x(index).toFixed(1)}" cy="${y(game.margin).toFixed(1)}" r="4.5" fill="${fill}"><title>${esc(label)}</title></circle>`;
    })
    .join("");
  const ticks = [peak, 0, -peak]
    .map((tick) => `<text x="0" y="${(y(tick) + 4).toFixed(1)}" fill="#a39e94" font-size="11" font-family="Arial">${tick > 0 ? `+${tick}` : tick}</text>`)
    .join("");
  return `<svg viewBox="0 0 ${width} ${height}" role="img" aria-label="Game margin"><line x1="${pad.l}" x2="${width - pad.r}" y1="${y(0)}" y2="${y(0)}" stroke="#2a2a2a"/>${ticks}<path d="${path.trim()}" fill="none" stroke="#f4f1ea" stroke-width="2.2"/>${dots}</svg><p class="note">Orange win. Blue loss. White line, ${windowSize}-game average.</p>`;
}

function quarterBars(current: SeasonView, previous: SeasonView | null): string {
  const width = 860;
  const height = 240;
  const pad = { l: 36, r: 12, t: 28, b: 32 };
  const periods = [1, 2, 3, 4];
  const values = periods.flatMap((period) => {
    const now = current.quarters.find((quarter) => quarter.period === period)?.margin ?? 0;
    const then = previous?.quarters.find((quarter) => quarter.period === period)?.margin ?? 0;
    return [now, then];
  });
  const peak = Math.max(4, ...values.map((value) => Math.abs(value)));
  const zero = pad.t + (height - pad.t - pad.b) / 2;
  const unit = (height - pad.t - pad.b) / 2 / peak;
  const groupW = (width - pad.l - pad.r) / periods.length;
  const groups = periods
    .map((period, index) => {
      const now = current.quarters.find((quarter) => quarter.period === period);
      const then = previous?.quarters.find((quarter) => quarter.period === period);
      const cx = pad.l + groupW * index + groupW / 2;
      const bars = [
        { value: now?.margin ?? 0, fill: "#e07a3d", dx: previous ? -16 : 0 },
        previous ? { value: then?.margin ?? 0, fill: "#5c5852", dx: 16 } : null,
      ].filter((bar): bar is { value: number; fill: string; dx: number } => Boolean(bar));
      const rects = bars
        .map((bar) => {
          const h = Math.max(Math.abs(bar.value) * unit, 1);
          const y = bar.value >= 0 ? zero - h : zero;
          return `<rect x="${(cx + bar.dx - 12).toFixed(1)}" y="${y.toFixed(1)}" width="24" height="${h.toFixed(1)}" fill="${bar.fill}"/>`;
        })
        .join("");
      return `<g>${rects}<text x="${cx}" y="${height - 10}" text-anchor="middle" fill="#a39e94" font-size="12" font-family="Arial">Q${period}</text><text x="${cx}" y="16" text-anchor="middle" fill="#f4f1ea" font-size="12" font-family="Arial">${now ? esc(signed(now.margin)) : ""}</text></g>`;
    })
    .join("");
  return `<svg viewBox="0 0 ${width} ${height}" role="img" aria-label="Quarter margin">${groups}<line x1="${pad.l}" x2="${width - pad.r}" y1="${zero}" y2="${zero}" stroke="#2a2a2a"/></svg>`;
}

function heatGrid(games: GameStub[]): string {
  const rows = games.slice().reverse();
  const hasOt = rows.some((game) => game.quarters.some((quarter) => quarter.period > 4));
  const periods = hasOt ? [1, 2, 3, 4, 5] : [1, 2, 3, 4];
  const head = periods.map((period) => `<th>${period <= 4 ? `Q${period}` : "OT"}</th>`).join("");
  const body = rows
    .map((game) => {
      const cells = periods
        .map((period) => {
          const quarter = game.quarters.find((item) => item.period === period);
          if (!quarter) return `<td class="empty">—</td>`;
          const tone = heatStyle(quarter.margin);
          return `<td><span class="cell" ${styleAttr(tone)}>${esc(signed(quarter.margin, 0))}</span></td>`;
        })
        .join("");
      return `<tr><td class="name">${esc(etDate(game.date, false))} ${game.home ? "vs" : "@"} ${esc(game.opponentAbbr)}</td><td class="${game.win ? "" : "loss"}">${game.knicksScore}–${game.opponentScore}</td>${cells}</tr>`;
    })
    .join("");
  return `<div class="scroll heat"><table><thead><tr><th>Game</th><th>Final</th>${head}</tr></thead><tbody>${body}</tbody></table></div>`;
}

function pairGrid(board: PairBoard): string {
  const head = board.players
    .map((player) => `<th class="up"><span>${esc(player.name)}</span></th>`)
    .join("");
  const body = board.players
    .map((row) => {
      const cells = board.players
        .map((column) => {
          if (row.id === column.id) {
            if (row.net48 == null) return `<td class="empty">—</td>`;
            return `<td><span class="cell sq" ${styleAttr(heatStyle(row.net48, 12))}>${esc(signed(row.net48, 0))}</span></td>`;
          }
          const cell = board.cells.find(
            (item) => (item.a === row.id && item.b === column.id) || (item.a === column.id && item.b === row.id),
          );
          if (!cell) return `<td class="empty">—</td>`;
          const tip = `${row.name} + ${column.name}, ${signed(cell.net48)} per 48, ${Math.round(cell.minutes)} min`;
          return `<td><button type="button" class="cell sq" ${styleAttr(heatStyle(cell.net48, 12))} data-tip="${esc(tip)}">${esc(signed(cell.net48, 0))}</button></td>`;
        })
        .join("");
      return `<tr><th>${esc(row.name)}</th>${cells}</tr>`;
    })
    .join("");
  const best = board.cells.slice().sort((a, b) => b.net48 - a.net48)[0];
  const name = (id: string) => board.players.find((player) => player.id === id)?.name ?? id;
  const readout = best
    ? `${name(best.a)}–${name(best.b)} ${signed(best.net48)}. ${Math.round(best.minutes)} shared minutes.`
    : "Diagonal is each player on the floor.";
  return `<div class="scroll"><table class="pairs"><thead><tr><th></th>${head}</tr></thead><tbody>${body}</tbody></table></div><p class="readout">${esc(readout)}</p>`;
}

function playerTable(rows: PlayerRollup[]): string {
  const sorted = rows.slice().sort((a, b) => b.minutes - a.minutes);
  const body = sorted
    .map((player) => {
      const chip = player.impact.kind === "drag" ? "drag" : player.impact.kind === "lift" || player.impact.kind === "twoway" ? "lift" : player.impact.kind === "scoring" || player.impact.kind === "creation" ? "score" : "muted";
      return `<tr><td>${esc(player.name)} <span class="pos">${esc(player.position)}</span></td><td>${player.games}</td><td>${fixed(player.mpg)}</td><td>${fixed(player.pts)}</td><td>${fixed(player.reb)}</td><td>${fixed(player.ast)}</td><td>${player.ts ? `${(player.ts * 100).toFixed(1)}%` : "—"}</td><td>${esc(signed(player.pmPerGame))}</td><td>${player.onOff == null ? "—" : esc(signed(player.onOff))}</td><td>${player.oppPts48On == null ? "—" : fixed(player.oppPts48On)}</td><td><span class="chip ${chip}" title="${esc(player.impact.sentence)}">${esc(player.impact.title)}</span></td></tr>`;
    })
    .join("");
  return `<div class="scroll"><table><thead><tr><th>Player</th><th>GP</th><th>Min</th><th>Pts</th><th>Reb</th><th>Ast</th><th>TS%</th><th>+/−</th><th>On−off</th><th>Opp/48</th><th>Impact</th></tr></thead><tbody>${body}</tbody></table></div>`;
}

function factorBoard(rows: FactorRow[]): string {
  const peak = Math.max(1, ...rows.map((row) => Math.abs(row.shift ?? 0)));
  let last = "";
  return rows
    .map((row) => {
      const show = row.group !== last;
      last = row.group;
      const shift = row.shift ?? 0;
      const width = (Math.abs(shift) / peak) * 50;
      const color = row.tone === "good" ? "#b7c98a" : row.tone === "bad" ? "#e09a94" : "#8a847c";
      const left = shift >= 0 ? 50 : 50 - width;
      return `${show ? `<p class="kicker faint">${esc(row.group)}</p>` : ""}<div class="factor"><div><p>${esc(row.label)}</p><p class="note">${esc(row.current)} <span class="faint">was ${esc(row.previous)}</span></p></div><div class="track"><i style="left:${left}%;width:${width}%;background:${color}"></i></div><b style="color:${color}">${esc(row.delta)}</b></div>`;
    })
    .join("");
}

function switches(seasons: { id: string; label: string }[], active: string): string {
  return `<div class="switch">${seasons
    .map((season) => `<button type="button" data-pick="${esc(season.id)}" class="${season.id === active ? "on" : ""}">${esc(season.label)}</button>`)
    .join("")}</div>`;
}

function panels(seasons: { id: string }[], active: string, render: (id: string) => string): string {
  return seasons
    .map((season) => `<div data-panel="${esc(season.id)}" ${season.id === active ? "" : "hidden"}>${render(season.id)}</div>`)
    .join("");
}

function page(): string {
  const report = buildReport(readStore());
  const seasons = report.seasons.filter((season) => season.ratings.games > 0);
  const views = seasons.map((season) => ({ id: `${season.season}:${season.phase}`, label: season.label, season }));
  const active = report.current ? `${report.current.season}:${report.current.phase}` : (views[0]?.id ?? "");
  const { current, previous, playoffs, latest } = report;
  const columns = [current, previous, playoffs].filter((column): column is SeasonView => Boolean(column));
  const seasonCards = columns
    .map((column) => {
      const lines = [
        ["Margin", signed(column.ratings.margin)],
        ["Offense", fixed(column.ratings.ortg)],
        ["Defense", fixed(column.ratings.drtg)],
        ["Net", signed(column.ratings.net)],
        ["Pace", fixed(column.ratings.pace)],
        ["Scored", fixed(column.ratings.ptsFor)],
        ["Allowed", fixed(column.ratings.ptsAgainst)],
      ];
      return `<article class="card"><p class="kicker">${esc(column.label)}</p><p class="big">${esc(record(column.ratings.wins, column.ratings.losses))}</p><dl>${lines.map(([label, value]) => `<div><dt>${label}</dt><dd>${esc(value)}</dd></div>`).join("")}</dl></article>`;
    })
    .join("");
  const tiles = current
    ? [
        ["Record", record(current.ratings.wins, current.ratings.losses), previous ? record(previous.ratings.wins, previous.ratings.losses) : ""],
        ["Net", signed(current.ratings.net), previous ? signed(previous.ratings.net) : ""],
        ["Offense", fixed(current.ratings.ortg), previous ? fixed(previous.ratings.ortg) : ""],
        ["Defense", fixed(current.ratings.drtg), previous ? fixed(previous.ratings.drtg) : ""],
      ]
        .map(
          ([label, value, prior]) =>
            `<div class="tile"><p class="kicker">${label}</p><p class="big">${esc(value)}</p>${prior ? `<p class="note">Last year ${esc(prior)}</p>` : ""}</div>`,
        )
        .join("")
    : "";
  const latestBlock = latest
    ? `<section><p class="kicker">Latest game</p><h2>Knicks ${latest.knicksScore}, ${esc(latest.opponentName)} ${latest.opponentScore}</h2><p class="note">${esc(etDate(latest.date))} · ${esc(place(latest.home, latest.neutral))} ${esc(latest.opponentAbbr)} · ${esc(latest.venue)}</p><p>${esc(latest.note)}</p><div class="scroll"><table><thead><tr><th>Team</th>${latest.quarters.map((quarter) => `<th>${esc(quarter.label)}</th>`).join("")}<th>Final</th></tr></thead><tbody><tr><td>Knicks</td>${latest.quarters.map((quarter) => `<td>${quarter.knicks}</td>`).join("")}<td><b>${latest.knicksScore}</b></td></tr><tr><td>${esc(latest.opponentAbbr)}</td>${latest.quarters.map((quarter) => `<td>${quarter.opponent}</td>`).join("")}<td>${latest.opponentScore}</td></tr><tr><td>Margin</td>${latest.quarters.map((quarter) => `<td>${esc(signed(quarter.margin, 0))}</td>`).join("")}<td>${esc(signed(latest.knicksScore - latest.opponentScore, 0))}</td></tr></tbody></table></div></section>`
    : "";
  const situations = current
    ? `<div class="cards">${current.situations
        .map((row) => {
          const then = previous?.situations.find((item) => item.id === row.id);
          return `<article class="card"><p class="kicker">${esc(row.label)}</p><p class="big ${row.margin >= 0 ? "good" : "bad"}">${esc(signed(row.margin))}</p><p class="note">${esc(record(row.wins, row.losses))} · ${row.games} g · net ${esc(signed(row.net))}</p>${then ? `<p class="note">Last year ${esc(signed(then.margin))}</p>` : ""}</article>`;
        })
        .join("")}</div>`
    : "";
  const quarterTable = current
    ? `<div class="scroll"><table><thead><tr><th>Quarter</th><th>Scored</th><th>Allowed</th><th>Margin</th><th>A–B–T</th>${previous ? "<th>Last year</th><th>Change</th>" : ""}</tr></thead><tbody>${[1, 2, 3, 4]
        .map((period) => {
          const now = current.quarters.find((quarter) => quarter.period === period);
          const then = previous?.quarters.find((quarter) => quarter.period === period);
          if (!now) return "";
          return `<tr><td>${esc(now.label)}</td><td>${fixed(now.knicks)}</td><td>${fixed(now.opponent)}</td><td><span class="cell" ${styleAttr(heatStyle(now.margin, 6))}>${esc(signed(now.margin))}</span></td><td>${now.won}–${now.lost}–${now.tied}</td>${previous ? `<td>${then ? esc(signed(then.margin)) : "—"}</td><td>${then ? esc(signed(now.margin - then.margin)) : "—"}</td>` : ""}</tr>`;
        })
        .join("")}</tbody></table></div>`
    : "";

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>Knicks game to game</title>
<style>
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  html, body { margin: 0; background: #000; color: #f4f1ea; font-family: Arial, Helvetica, sans-serif; }
  body { font-size: 16px; line-height: 1.5; }
  a { color: inherit; }
  main, header, footer { width: min(1080px, calc(100% - 32px)); margin: 0 auto; }
  header { display: flex; justify-content: space-between; gap: 16px; align-items: flex-end; border-bottom: 1px solid #2a2a2a; padding: 20px 0 12px; }
  .brand { display: flex; gap: 12px; align-items: center; }
  .mark { width: 48px; height: 48px; }
  .liberty { height: 112px; width: auto; }
  nav { display: flex; flex-wrap: wrap; gap: 8px 18px; padding: 12px 0 4px; }
  nav a { color: #f4f1ea; font-size: 13px; text-decoration: none; }
  h1 { font-size: 40px; line-height: 1.12; margin: 8px 0 0; max-width: 16em; }
  h2 { font-size: 28px; line-height: 1.15; margin: 6px 0 0; }
  section { border-bottom: 1px solid #2a2a2a; padding: 36px 0; }
  .kicker { font-size: 11px; letter-spacing: 0.16em; text-transform: uppercase; color: #a39e94; margin: 0; }
  .kicker.accent { color: #e07a3d; }
  .faint { color: #8a847c; }
  .note { color: #a39e94; font-size: 13px; }
  .tiles, .cards { display: grid; grid-template-columns: repeat(4, 1fr); gap: 1px; background: #2a2a2a; margin-top: 24px; }
  .cards { grid-template-columns: repeat(3, 1fr); }
  .tile, .card { background: #000; padding: 16px 16px 16px 0; }
  .card { padding: 16px; }
  .big { font-size: 32px; font-weight: 700; line-height: 1; margin: 8px 0; font-variant-numeric: tabular-nums; }
  .good { color: #e07a3d; } .bad { color: #7eadd4; }
  table { width: 100%; border-collapse: collapse; font-variant-numeric: tabular-nums; }
  th, td { text-align: right; padding: 6px 8px; border-bottom: 1px solid #2a2a2a; font-weight: 400; font-size: 14px; }
  th { color: #a39e94; font-size: 11px; letter-spacing: 0.12em; text-transform: uppercase; }
  td:first-child, th:first-child { text-align: left; }
  .scroll { overflow-x: auto; }
  .heat { max-height: 560px; }
  .heat thead th { position: sticky; top: 0; background: #000; }
  .cell, button.cell { display: inline-flex; min-width: 44px; min-height: 32px; align-items: center; justify-content: center; border: 0; font: inherit; font-weight: 700; cursor: pointer; }
  .sq { width: 48px; height: 48px; }
  .empty { color: #8a847c; text-align: center; }
  .loss { color: #7eadd4; }
  .pairs th.up { height: 92px; vertical-align: bottom; }
  .pairs th.up span { writing-mode: vertical-rl; transform: rotate(180deg); display: inline-block; }
  .switch { display: flex; flex-wrap: wrap; gap: 8px 16px; margin: 12px 0; }
  button.on, .switch button { background: none; border: 0; color: #a39e94; font: inherit; cursor: pointer; padding: 0; }
  button.on { color: #f4f1ea; text-decoration: underline; text-underline-offset: 4px; }
  .factor { display: grid; grid-template-columns: minmax(0, 1.1fr) minmax(120px, 1fr) 3.5rem; gap: 12px; align-items: center; margin: 10px 0; }
  .track { position: relative; height: 8px; background: #1a1a1a; }
  .track i { position: absolute; top: 0; height: 100%; }
  .chip { padding: 2px 8px; font-size: 11px; letter-spacing: 0.12em; text-transform: uppercase; }
  .chip.score { background: #3a2618; color: #e07a3d; }
  .chip.lift { background: #243024; color: #b7c98a; }
  .chip.drag { background: #3a2422; color: #e09a94; }
  .chip.muted { background: #1c1c1c; color: #a39e94; }
  .pos { color: #a39e94; font-size: 12px; }
  .legend { display: flex; gap: 8px; align-items: center; font-size: 11px; letter-spacing: 0.12em; text-transform: uppercase; color: #a39e94; }
  .bar { width: 96px; height: 8px; background: linear-gradient(90deg, #7eadd4, #141414, #e07a3d); }
  footer { padding: 28px 0 48px; color: #a39e94; font-size: 12px; }
  dl { margin: 0; }
  dl div { display: flex; justify-content: space-between; gap: 12px; font-size: 14px; padding: 3px 0; }
  dt { color: #a39e94; }
  dd { margin: 0; }
  @media (max-width: 720px) {
    h1 { font-size: 32px; }
    .tiles, .cards, .factor { grid-template-columns: 1fr 1fr; }
    .factor { grid-template-columns: 1fr; }
  }
</style>
</head>
<body>
<header>
  <div class="brand">${MARK}<div><p class="kicker">New York Knicks</p><strong>Game to game</strong><p class="note">Static snapshot</p></div></div>
  ${liberty()}
</header>
<main>
<nav>
  <a href="#season">Season</a><a href="#games">Game to game</a><a href="#quarters">Quarters</a>
  <a href="#factors">Offense and defense</a><a href="#situations">Situations</a><a href="#pairs">Pairings</a><a href="#players">Players</a>
</nav>
<section>
  <p class="kicker accent">${esc(report.hero.kicker)}</p>
  <h1>${esc(report.hero.title)}</h1>
  <p class="note">${esc(report.hero.body)}</p>
  <div class="tiles">${tiles}</div>
</section>
${latestBlock}
<section id="season">
  <p class="kicker">01 / Season</p>
  <h2>Last year against this year</h2>
  <p>${esc(report.notes.season)}</p>
  <div class="cards">${seasonCards}</div>
</section>
<section id="games">
  <p class="kicker">02 / Game to game</p>
  <h2>The margin, one night at a time</h2>
  <p>Dot is the final margin. Line is the running average.</p>
  ${switches(views, active)}
  ${panels(views, active, (id) => marginSvg(views.find((view) => view.id === id)?.season.games ?? []))}
</section>
<section id="quarters">
  <p class="kicker">03 / Quarters</p>
  <h2>Where the game is won or lost</h2>
  <p>${esc(report.notes.quarters)}</p>
  ${current ? quarterBars(current, previous) : ""}
  ${quarterTable}
  ${switches(views, active)}
  ${panels(views, active, (id) => heatGrid(views.find((view) => view.id === id)?.season.games ?? []))}
  <p class="legend"><span>Behind</span><span class="bar"></span><span>Ahead</span></p>
</section>
<section id="factors">
  <p class="kicker">04 / Offense and defense</p>
  <h2>Four factors, both ends</h2>
  <p>${esc(report.notes.factors)}</p>
  ${factorBoard(report.factors.filter((row) => row.group !== "Scoring"))}
</section>
<section id="situations">
  <p class="kicker">05 / Situations</p>
  <h2>Home, road, and the night after</h2>
  <p>${esc(report.notes.situations)}</p>
  ${situations}
</section>
<section id="pairs">
  <p class="kicker">07 / Pairings</p>
  <h2>Who helps whom</h2>
  <p>${esc(report.notes.pairs)}</p>
  ${switches(views, active)}
  ${panels(views, active, (id) => {
    const board = report.pairs.find((item) => item.id === id);
    return board ? pairGrid(board) : "<p class='note'>No pairings.</p>";
  })}
  <p class="note">Blank under 8 shared minutes. Diagonal is that player on the floor.</p>
</section>
<section id="players">
  <p class="kicker">06 / Players</p>
  <h2>What kind of impact</h2>
  <p>${esc(report.notes.players)}</p>
  ${switches(views, active)}
  ${panels(views, active, (id) => {
    const view = views.find((item) => item.id === id);
    if (!view) return "";
    const rows = report.players.filter((player) => player.season === view.season.season && player.phase === view.season.phase);
    return playerTable(rows);
  })}
</section>
</main>
<footer>
  <p>Static HTML export of the Knicks report. No server required. Snapshot updated ${esc(etDateTime(report.updatedAt))}. ${report.gameCount} games. ESPN box scores and play-by-play. On-court splits keep a game when the lineup replay is within 8 points of the box plus-minus.</p>
</footer>
<script>
document.querySelectorAll("[data-pick]").forEach((button) => {
  button.addEventListener("click", () => {
    const id = button.getAttribute("data-pick");
    document.querySelectorAll("[data-pick]").forEach((item) => item.classList.toggle("on", item.getAttribute("data-pick") === id));
    document.querySelectorAll("[data-panel]").forEach((panel) => { panel.hidden = panel.getAttribute("data-panel") !== id; });
  });
});
document.querySelectorAll("[data-tip]").forEach((button) => {
  button.addEventListener("click", () => {
    const readout = button.closest("[data-panel]")?.querySelector(".readout");
    if (readout) readout.textContent = button.getAttribute("data-tip") || "";
  });
});
</script>
</body>
</html>`;
}

const html = page();
const targets = [path.join("export", "index.html"), path.join("public", "knicks.html")];
for (const target of targets) {
  mkdirSync(path.dirname(target), { recursive: true });
  writeFileSync(target, html);
  console.log(`${target} ${html.length} bytes`);
}
