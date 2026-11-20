import type { GameDetail, GameMoment, GamePlayer, GameSide, Stint } from "../../../server/schema.ts";
import { escapeHtml as e, fixed, percent, signed } from "../format.ts";
import { flowChart } from "./charts.ts";
import { margin, won } from "./game.ts";
import { gameWhere, layerNav, pageHeader, periodName, scoreTable, table } from "./page.ts";

function when(m: GameMoment): string {
  const seconds = Math.floor(m.clockSeconds);
  const clock = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
  const period = m.period <= 4 ? `Q${m.period}` : m.period === 5 ? "OT" : `OT${m.period - 4}`;
  return `${period} ${clock}`;
}

function stintLine({ from, to }: Stint): string {
  const net = to.us - to.them - (from.us - from.them);
  return `<div class="stints">${when(from)}–${when(to)} · ${from.us}-${from.them} to ${to.us}-${to.them} · ${signed(net, 0)}</div>`;
}

const page = (body: string) =>
  `${pageHeader()}
<main>
${layerNav("team", "games")}
${body}
</main>`;

const playerName = (p: GamePlayer) => `${e(p.name)}${p.position ? ` <span class="pos">${e(p.position)}</span>` : ""}`;

/** The four factors and scoring sources of both teams, side by side. */
function bothEnds(game: GameDetail): string {
  const { us, them } = game;
  const row = (label: string, show: (side: GameSide) => string) => [label, show(us), show(them)];
  return table(
    ["", "Knicks", e(game.opponent.abbreviation)],
    [
      row("Effective field-goal %", (s) => percent(s.efg)),
      row("Turnover rate", (s) => percent(s.tov)),
      row("Offensive rebound rate", (s) => percent(s.orb)),
      row("Free-throw rate", (s) => percent(s.ftr)),
      row("Points in the paint", (s) => String(s.paint)),
      row("Fast-break points", (s) => String(s.fastBreak)),
      row("Points off turnovers", (s) => String(s.offTov)),
      row("Largest lead", (s) => String(s.largestLead)),
    ],
  );
}

export function renderGame(game: GameDetail): string {
  const periods = game.usByPeriod.map((_, i) => periodName(i));
  const byPeriod = (p: GamePlayer) =>
    periods.map((_, i) => (p.pointsByPeriod ? String(p.pointsByPeriod[i] ?? 0) : "—"));
  const rows = game.players.map((p) => [
    `<a href="#player/${p.id}">${e(p.name)}</a>${p.position ? ` <span class="pos">${e(p.position)}</span>` : ""}`,
    String(p.minutes),
    String(p.pts),
    String(p.reb),
    String(p.ast),
    String(p.stl),
    String(p.blk),
    String(p.tov),
    p.ts === null ? "—" : percent(p.ts),
    signed(p.plusMinus, 0),
    ...byPeriod(p),
    fixed(p.gameScore),
    p.stints.map(stintLine).join("") || "—",
  ]);
  const opponents = game.opponents.map((p) => [
    `${playerName(p)}${p.starter ? ` <span class="pos">S</span>` : ""}`,
    String(p.minutes),
    String(p.pts),
    String(p.reb),
    String(p.ast),
    String(p.stl),
    String(p.blk),
    String(p.tov),
    signed(p.plusMinus, 0),
    ...byPeriod(p),
  ]);
  const replayNote = game.replayed
    ? `Stints come from the play-by-play, with the Knicks' score first. Their +/− can differ from the box score by up to ${game.replayTolerance} points.`
    : `The play-by-play doesn't match the box score closely enough to show stints for this game.`;
  const diffs = game.usByPeriod.map((p, i) => p - (game.themByPeriod[i] ?? 0));
  const swing = diffs.reduce((best, d, i) => (Math.abs(d) > Math.abs(diffs[best]!) ? i : best), 0);
  const by = Math.abs(margin(game));
  const summary =
    `${won(game) ? "Win" : "Loss"} by ${by}. Offense ${fixed(game.offense)}, defense ${fixed(game.defense)} per 100 possessions.` +
    (diffs.length ? ` ${periodName(swing)} ${signed(diffs[swing]!, 0)}.` : "");
  return page(`<section>
  <p class="kicker">${gameWhere(game)}</p>
  <h1>Knicks ${game.pts}, ${e(game.opponent.name)} ${game.oppPts}</h1>
  <p>${summary}</p>
  ${scoreTable(game)}
</section>
<section>
  <h2>How the margin moved</h2>
  <p class="note">Above the line the Knicks lead.</p>
  ${flowChart(game.flow, game.periods)}
</section>
<section>
  <h2>Both ends of the floor</h2>
  ${bothEnds(game)}
</section>
<section>
  <h2>Player by player</h2>
  <p class="note">Starters first, then by minutes. Points by period come from the play-by-play. GmSc is game score, the box-score line as one number. ${replayNote}</p>
  ${table(["Player", "Min", "Pts", "Reb", "Ast", "Stl", "Blk", "TO", "TS%", "+/−", ...periods, "GmSc", "Stints"], rows)}
</section>
<section>
  <h2>${e(game.opponent.name)}</h2>
  <p class="note">S marks a starter.</p>
  ${table(["Player", "Min", "Pts", "Reb", "Ast", "Stl", "Blk", "TO", "+/−", ...periods], opponents)}
</section>`);
}

export function renderGameNotFound(): string {
  return page(`<section><h1>Game not found</h1></section>`);
}
