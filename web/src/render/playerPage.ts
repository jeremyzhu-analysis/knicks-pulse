import type { PlayerDetail } from "../api/PlayerDetail.ts";
import type { PlayerSeason } from "../api/PlayerSeason.ts";
import { escapeHtml as e, fixed, percent, record, shortDate, signed } from "../format.ts";
import { hosted, won } from "./game.ts";
import { impactLabel, impactTitle } from "./impact.ts";
import { layerNav, pageHeader, table } from "./page.ts";

const page = (body: string) =>
  `${pageHeader()}
<main>
${layerNav("players", "impact")}
${body}
</main>`;

const orDash = (value: number | null, show: (n: number) => string = fixed) => (value === null ? "—" : show(value));

/** Scoring per 48 minutes with the player on and off the floor, the quarter splits, and the game log. */
function seasonPanel(s: PlayerSeason): string {
  const r = s.row;
  const tile = (label: string, value: number | null, note: string) =>
    `<div class="tile"><p class="kicker">${label}</p><p class="big">${orDash(value)}</p><p class="note">${note}</p></div>`;
  const quarters = table(
    ["Quarter", "Pts", "+/−", "Opp/48"],
    r.quarters.map((q) => [`Q${q.quarter}`, orDash(q.pts), orDash(q.plusMinus, signed), orDash(q.opp48)]),
  );
  const log = table(
    ["Game", "Result", "Min", "Pts", "Reb", "Ast", "+/−", "Q1", "Q2", "Q3", "Q4", "GmSc"],
    [...s.games].reverse().map((g) => [
      `<a href="#game/${e(g.id)}">${shortDate(g.startsAt)} ${hosted(g) ? "vs" : "@"} ${e(g.opponent.abbreviation)}</a>`,
      `<span class="${won(g) ? "" : "loss"}">${won(g) ? "W" : "L"} ${g.pts}–${g.oppPts}</span>`,
      String(g.line.minutes), String(g.line.pts), String(g.line.reb), String(g.line.ast), signed(g.line.plusMinus, 0),
      ...[0, 1, 2, 3].map((i) => (g.line.pointsByPeriod ? String(g.line.pointsByPeriod[i] ?? 0) : "—")),
      fixed(g.line.gameScore),
    ]),
  );
  return `<div class="tiles">${[
    tile("Knicks per 48, on", r.team48On, "Points scored with the player on the floor"),
    tile("Knicks per 48, off", r.team48Off, "With the player on the bench"),
    tile("Opponent per 48, on", r.opp48, "Points allowed with the player on the floor"),
    tile("Opponent per 48, off", r.opp48Off, "With the player on the bench"),
  ].join("")}</div>
  <h2>By quarter</h2>
  <p class="note">Points per game, net points per game while on the floor, and the opponent's points per 48 minutes then.</p>
  ${quarters}
  <h2>Game log</h2>
  <p class="note">Knicks ${record(s.wins, s.losses)} in these ${s.games.length} game${s.games.length === 1 ? "" : "s"}. Latest first. GmSc is game score.</p>
  ${log}`;
}

export function renderPlayer(player: PlayerDetail): string {
  const latest = player.seasons[0];
  if (!latest) return renderPlayerNotFound();
  const lines = table(
    ["Season", "GP", "Min", "Pts", "Reb", "Ast", "TS%", "Usage", "+/−", "On /48", "Off /48", "Opp/48"],
    player.seasons.map(({ label, row: r }) => [
      e(label), String(r.gp), fixed(r.mpg), fixed(r.ppg), fixed(r.rpg), fixed(r.apg), percent(r.ts), `${fixed(r.usg)}%`,
      signed(r.plusMinus), orDash(r.on48, signed), orDash(r.off48, signed), orDash(r.opp48),
    ]),
  );
  const panels = [...player.seasons].reverse();
  const buttons = panels
    .map((s) => `<button type="button" data-pick="${s.key}" class="${s === latest ? "on" : ""}">${e(s.label)}</button>`)
    .join("");
  return page(`<section>
  <p class="kicker">${player.position ? e(player.position) : "Player"}</p>
  <h1>${e(player.name)}</h1>
  <p><span class="chip ${latest.row.impact.tone}">${impactLabel(latest.row)}</span> ${e(impactTitle(latest.row))} <a href="#players/shots/${player.id}">Shot map</a></p>
  ${lines}
  <p class="note">Per game, except: usage is the share of Knicks possessions the player ended while on the floor; On and Off are the Knicks' net points per 48 minutes with the player on the floor and on the bench; Opp/48 is what opponents scored with the player on.</p>
</section>
<section>
  <div class="switch">${buttons}</div>
  ${panels.map((s) => `<div data-panel="${s.key}"${s === latest ? "" : " hidden"}>${seasonPanel(s)}</div>`).join("")}
</section>`);
}

export function renderPlayerNotFound(): string {
  return page(`<section><h1>Player not found</h1></section>`);
}
