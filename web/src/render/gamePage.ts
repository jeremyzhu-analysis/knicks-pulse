import type { GameDetail } from "../api/GameDetail.ts";
import type { GameMoment } from "../api/GameMoment.ts";
import type { Stint } from "../api/Stint.ts";
import { escapeHtml as e, percent, signed } from "../format.ts";
import { gameWhere, layerNav, pageHeader, scoreTable, table } from "./page.ts";

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

export function renderGame(game: GameDetail): string {
  const rows = game.players.map((p) => [
    `${e(p.name)}${p.position ? ` <span class="pos">${e(p.position)}</span>` : ""}`,
    String(p.minutes), String(p.pts), String(p.reb), String(p.ast), String(p.stl), String(p.blk), String(p.tov),
    p.ts === null ? "—" : percent(p.ts),
    signed(p.plusMinus, 0),
    p.stints.map(stintLine).join("") || "—",
  ]);
  const replayNote = game.replayed
    ? `Stints come from the play-by-play, with the Knicks' score first. Their +/− can differ from the box score by up to ${game.replayTolerance} points.`
    : `The play-by-play doesn't match the box score closely enough to show stints for this game.`;
  return page(`<section>
  <p class="kicker">${gameWhere(game)}</p>
  <h1>Knicks ${game.pts}, ${e(game.opponent.name)} ${game.oppPts}</h1>
  ${scoreTable(game)}
</section>
<section>
  <h2>Player by player</h2>
  <p class="note">Starters first, then by minutes. ${replayNote}</p>
  ${table(["Player", "Min", "Pts", "Reb", "Ast", "Stl", "Blk", "TO", "TS%", "+/−", "Stints"], rows)}
</section>`);
}

export function renderGameNotFound(): string {
  return page(`<section><h1>Game not found</h1></section>`);
}
