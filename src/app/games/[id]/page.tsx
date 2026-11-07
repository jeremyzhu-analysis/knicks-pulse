import Link from "next/link";
import { notFound } from "next/navigation";
import { FlowChart } from "@/components/charts";
import { rateGames } from "@/lib/analytics";
import { etDate, fixed, pct, place, signed } from "@/lib/format";
import { hrefFor } from "@/lib/nav";
import { gameScore } from "@/lib/metrics";
import { readStore } from "@/lib/store";
import type { PlayerGame } from "@/lib/types";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const game = readStore().games.find((row) => row.id === id);
  if (!game) return { title: "Game · Knicks game to game" };
  return { title: `Knicks ${game.knicksScore}, ${game.opponentAbbr} ${game.opponentScore} · Knicks game to game` };
}

export default async function GamePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const game = readStore().games.find((row) => row.id === id);
  if (!game) notFound();
  const ratings = rateGames([game]);
  const quarters = game.quarters.map((quarter) => ({ ...quarter, margin: quarter.knicks - quarter.opponent }));
  const swing = quarters.slice().sort((a, b) => Math.abs(b.margin) - Math.abs(a.margin))[0];
  const knicks = game.players
    .filter((player) => !player.didNotPlay && player.minutes > 0)
    .map((player) => ({ ...player, score: gameScore(player) }))
    .sort((a, b) => b.score - a.score);
  const opponents = (game.opponentPlayers ?? [])
    .filter((player) => !player.didNotPlay && player.minutes > 0)
    .slice()
    .sort((a, b) => b.pts - a.pts);

  return (
    <main className="mx-auto max-w-[1080px] px-5 py-10">
      <p className="text-[11px] uppercase tracking-[0.18em] text-muted">
        <Link href={hrefFor("team", "games")} className="text-muted">
          Games
        </Link>
        {"  /  "}
        {game.season} {game.phase === "playoffs" ? "playoffs" : "regular season"}
      </p>
      <h1 className="mt-2 text-[34px] font-bold leading-[1.1] md:text-[44px]">
        Knicks {game.knicksScore}, {game.opponentName} {game.opponentScore}
      </h1>
      <p className="mt-3 text-[14px] text-muted">
        {etDate(game.date)} · {place(game.home, game.neutral)} {game.opponentAbbr} · {game.venue}
        {game.attendance ? ` · ${game.attendance.toLocaleString("en-US")} attendance` : ""}
        {game.series ? ` · ${game.series}` : ""}
      </p>
      <p className="mt-4 max-w-[42ch] text-[17px] leading-snug">
        {game.win ? "Win" : "Loss"} by {Math.abs(game.knicksScore - game.opponentScore)}. Offense {fixed(ratings.ortg)}, defense{" "}
        {fixed(ratings.drtg)}.{swing ? ` ${swing.label} ${signed(swing.margin, 0)}.` : ""}
      </p>

      <div className="mt-8 overflow-x-auto">
        <table className="w-full min-w-[520px] border-collapse">
          <thead>
            <tr className="border-b border-rule text-[11px] uppercase tracking-[0.14em] text-muted">
              <th className="py-2 pr-3 text-left font-normal"> </th>
              {quarters.map((quarter) => (
                <th key={quarter.period} className="px-2 py-2 text-right font-normal">
                  {quarter.label}
                </th>
              ))}
              <th className="px-2 py-2 text-right font-normal">Final</th>
            </tr>
          </thead>
          <tbody className="tabular text-[15px]">
            <tr className="border-b border-rule">
              <td className="py-2">Knicks</td>
              {quarters.map((quarter) => (
                <td key={quarter.period} className="px-2 py-2 text-right">
                  {quarter.knicks}
                </td>
              ))}
              <td className="px-2 py-2 text-right font-bold">{game.knicksScore}</td>
            </tr>
            <tr className="border-b border-rule">
              <td className="py-2">{game.opponentAbbr}</td>
              {quarters.map((quarter) => (
                <td key={quarter.period} className="px-2 py-2 text-right">
                  {quarter.opponent}
                </td>
              ))}
              <td className="px-2 py-2 text-right">{game.opponentScore}</td>
            </tr>
            <tr>
              <td className="py-2 text-muted">Margin</td>
              {quarters.map((quarter) => (
                <td key={quarter.period} className="px-2 py-2 text-right text-muted">
                  {signed(quarter.margin, 0)}
                </td>
              ))}
              <td className="px-2 py-2 text-right text-muted">{signed(game.knicksScore - game.opponentScore, 0)}</td>
            </tr>
          </tbody>
        </table>
      </div>

      <section className="mt-10 border-t border-rule pt-8">
        <h2 className="text-[22px] font-bold">Margin through the game</h2>
        <p className="mt-3 text-[15px] text-muted">The line moves when the score changes. Above zero, the Knicks lead.</p>
        <div className="mt-4">
          <FlowChart flow={game.flow} />
        </div>
      </section>

      <section className="mt-10 border-t border-rule pt-8">
        <h2 className="text-[22px] font-bold">Both ends of the floor</h2>
        <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[560px] border-collapse text-left">
            <thead>
              <tr className="border-b border-rule text-[11px] uppercase tracking-[0.14em] text-muted">
                <th className="py-2 font-normal"> </th>
                <th className="px-3 py-2 text-right font-normal">Knicks</th>
                <th className="px-3 py-2 text-right font-normal">{game.opponentAbbr}</th>
              </tr>
            </thead>
            <tbody className="tabular text-[14px]">
              {[
                ["Effective field-goal %", pct(ratings.efg), pct(ratings.oppEfg)],
                ["Turnover rate", pct(ratings.tovPct), pct(ratings.oppTovPct)],
                ["Offensive rebound rate", pct(ratings.orbPct), pct(ratings.oppOrbPct)],
                ["Free-throw rate", pct(ratings.ftRate), pct(ratings.oppFtRate)],
                ["Points in the paint", String(game.team.paint), String(game.opponent.paint)],
                ["Fast-break points", String(game.team.fastBreak), String(game.opponent.fastBreak)],
                ["Points off turnovers", String(game.team.pointsOffTurnovers), String(game.opponent.pointsOffTurnovers)],
                ["Largest lead", String(game.team.largestLead), String(game.opponent.largestLead)],
              ].map((row) => (
                <tr key={row[0]} className="border-b border-rule">
                  <td className="py-2">{row[0]}</td>
                  <td className="px-3 py-2 text-right">{row[1]}</td>
                  <td className="px-3 py-2 text-right">{row[2]}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="mt-10 border-t border-rule pt-8">
        <h2 className="text-[22px] font-bold">Knicks, and the quarter the points came from</h2>
        {game.lineupError > 1 ? (
          <p className="mt-3 text-[13px] text-loss">
            Lineup replay missed the box plus-minus by {game.lineupError}, so this game is out of the season on-court splits.
          </p>
        ) : null}
        <div className="mt-4 overflow-x-auto">
          <PlayerLines players={knicks} />
        </div>
      </section>

      <section className="mt-10 border-t border-rule pt-8">
        <h2 className="text-[22px] font-bold">The other side</h2>
        <p className="mt-3 text-[15px] text-muted">Box score only. Quarter points are tracked for Knicks players.</p>
        <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[640px] border-collapse text-left">
            <thead>
              <tr className="border-b border-rule text-[11px] uppercase tracking-[0.12em] text-muted">
                {["Player", "Min", "Pts", "Reb", "Ast", "Stl", "Blk", "+/−"].map((label) => (
                  <th key={label} className="px-2 py-2 text-right font-normal first:text-left">
                    {label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="tabular text-[14px]">
              {opponents.map((player) => (
                <tr key={player.id} className="border-b border-rule">
                  <td className="py-2">
                    {player.name}
                    {player.starter ? <span className="ml-2 text-[11px] uppercase tracking-[0.12em] text-faint">S</span> : null}
                  </td>
                  <td className="px-2 py-2 text-right">{Math.round(player.minutes)}</td>
                  <td className="px-2 py-2 text-right">{player.pts}</td>
                  <td className="px-2 py-2 text-right">{player.reb}</td>
                  <td className="px-2 py-2 text-right">{player.ast}</td>
                  <td className="px-2 py-2 text-right">{player.stl}</td>
                  <td className="px-2 py-2 text-right">{player.blk}</td>
                  <td className="px-2 py-2 text-right">{signed(player.plusMinus, 0)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  );
}

function PlayerLines({ players }: { players: (PlayerGame & { score: number })[] }) {
  return (
    <table className="w-full min-w-[860px] border-collapse text-left">
      <thead>
        <tr className="border-b border-rule text-[11px] uppercase tracking-[0.12em] text-muted">
          {["Player", "Min", "Pts", "Reb", "Ast", "+/−", "Q1", "Q2", "Q3", "Q4", "Game score"].map((label) => (
            <th key={label} className="px-2 py-2 text-right font-normal first:pl-0 first:text-left">
              {label}
            </th>
          ))}
        </tr>
      </thead>
      <tbody className="tabular text-[14px]">
        {players.map((player) => (
          <tr key={player.id} className="border-b border-rule">
            <td className="py-2">
              <Link href={`/players/${player.id}`} className="text-ink">
                {player.name}
              </Link>
            </td>
            <td className="px-2 py-2 text-right">{Math.round(player.minutes)}</td>
            <td className="px-2 py-2 text-right">{player.pts}</td>
            <td className="px-2 py-2 text-right">{player.reb}</td>
            <td className="px-2 py-2 text-right">{player.ast}</td>
            <td className="px-2 py-2 text-right">{signed(player.plusMinus, 0)}</td>
            {[1, 2, 3, 4].map((period) => (
              <td key={period} className="px-2 py-2 text-right text-muted">
                {player.quarters.find((quarter) => quarter.period === period)?.pts ?? 0}
              </td>
            ))}
            <td className="px-2 py-2 text-right">{fixed(player.score)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
