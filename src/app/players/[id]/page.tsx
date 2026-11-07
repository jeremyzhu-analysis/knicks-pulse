import Link from "next/link";
import { notFound } from "next/navigation";
import { buildReport, playerGames, type PlayerRollup } from "@/lib/analytics";
import { etDate, fixed, lastName, pct, place, record, signed } from "@/lib/format";
import { hrefFor } from "@/lib/nav";
import { gameScore } from "@/lib/metrics";
import { readStore } from "@/lib/store";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const player = buildReport(readStore()).players.find((row) => row.id === id);
  return { title: player ? `${player.name} · Knicks game to game` : "Player · Knicks game to game" };
}

export default async function PlayerPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const store = readStore();
  const report = buildReport(store);
  const lines = report.players.filter((player) => player.id === id);
  if (lines.length === 0) notFound();
  const name = lines[0]?.name ?? "Player";
  const lead = lines.slice().sort((a, b) => {
    if (a.season !== b.season) return b.season.localeCompare(a.season);
    if (a.phase === b.phase) return 0;
    return a.phase === "regular" ? -1 : 1;
  })[0];
  const games = playerGames(store, id);

  return (
    <main className="mx-auto max-w-[1080px] px-5 py-10">
      <p className="text-[11px] uppercase tracking-[0.18em] text-muted">
        <Link href={hrefFor("players", "impact")} className="text-muted">
          Players
        </Link>
        {"  /  "}
        {lead?.position}
      </p>
      <h1 className="mt-2 text-[36px] font-bold leading-none md:text-[44px]">{name}</h1>
      <p className="mt-3 text-[14px]">
        <Link href={hrefFor("players", "shots", id)} className="text-ink">
          Shot map
        </Link>
      </p>
      <p className="mt-3 text-[13px] uppercase tracking-[0.14em] text-knicks">{lead?.impact.title}</p>
      <p className="mt-4 max-w-[68ch] text-[18px] leading-[1.55]">{lead?.impact.sentence}</p>

      <section className="mt-10 border-t border-rule pt-8">
        <h2 className="text-[22px] font-bold">Season lines</h2>
        <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[760px] border-collapse text-left">
            <thead>
              <tr className="border-b border-rule text-[11px] uppercase tracking-[0.12em] text-muted">
                {["Season", "GP", "Min", "Pts", "Reb", "Ast", "TS%", "USG%", "+/−", "On net/48", "Off net/48", "Opp/48"].map((label) => (
                  <th key={label} className="px-2 py-2 text-right font-normal first:pl-0 first:text-left">
                    {label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="tabular text-[14px]">
              {lines.map((line) => (
                <tr key={line.season + line.phase} className="border-b border-rule">
                  <td className="py-2 pr-3">{line.season} {line.phase === "playoffs" ? "playoffs" : "regular"}</td>
                  <td className="px-2 py-2 text-right">{line.games}</td>
                  <td className="px-2 py-2 text-right">{fixed(line.mpg)}</td>
                  <td className="px-2 py-2 text-right">{fixed(line.pts)}</td>
                  <td className="px-2 py-2 text-right">{fixed(line.reb)}</td>
                  <td className="px-2 py-2 text-right">{fixed(line.ast)}</td>
                  <td className="px-2 py-2 text-right">{pct(line.ts)}</td>
                  <td className="px-2 py-2 text-right">{fixed(line.usg)}</td>
                  <td className="px-2 py-2 text-right">{signed(line.pmPerGame)}</td>
                  <td className="px-2 py-2 text-right">{line.onNet48 == null ? "—" : signed(line.onNet48)}</td>
                  <td className="px-2 py-2 text-right">{line.offNet48 == null ? "—" : signed(line.offNet48)}</td>
                  <td className="px-2 py-2 text-right">{line.oppPts48On == null ? "—" : fixed(line.oppPts48On)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="mt-10 border-t border-rule pt-8">
        <h2 className="text-[22px] font-bold">By quarter</h2>
        <p className="mt-3 max-w-[42ch] text-[15px] text-muted">
          Average points, and the Knicks&apos; margin with {lastName(name)} on the floor.
        </p>
        <div className="mt-5 overflow-x-auto">
          <QuarterSplit lines={lines} />
        </div>
      </section>

      <section className="mt-10 grid gap-8 border-t border-rule pt-8 md:grid-cols-2">
        {lines.slice(0, 2).map((line) => (
          <div key={line.season + line.phase}>
            <h2 className="text-[18px] font-bold">
              On the floor · {line.season} {line.phase === "playoffs" ? "playoffs" : "regular"}
            </h2>
            <dl className="mt-4 grid grid-cols-2 gap-px bg-rule">
              <Stat label="Knicks pts / 48, on" value={line.teamPts48On == null ? "—" : fixed(line.teamPts48On)} />
              <Stat label="Knicks pts / 48, off" value={line.teamPts48Off == null ? "—" : fixed(line.teamPts48Off)} />
              <Stat label="Opponent pts / 48, on" value={line.oppPts48On == null ? "—" : fixed(line.oppPts48On)} />
              <Stat label="Opponent pts / 48, off" value={line.oppPts48Off == null ? "—" : fixed(line.oppPts48Off)} />
            </dl>
          </div>
        ))}
      </section>

      <section className="mt-10 border-t border-rule pt-8">
        <h2 className="text-[22px] font-bold">Game log</h2>
        <div className="mt-4 max-h-[640px] overflow-auto">
          <table className="w-full min-w-[760px] border-collapse text-left">
            <thead className="sticky top-0 bg-black">
              <tr className="border-b border-rule text-[11px] uppercase tracking-[0.12em] text-muted">
                {["Date", "Opp", "Result", "Min", "Pts", "Reb", "Ast", "+/−", "Q1", "Q2", "Q3", "Q4"].map((label) => (
                  <th key={label} className="px-2 py-2 text-right font-normal first:text-left">
                    {label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="tabular text-[13px]">
              {games.map((game) => {
                const player = game.players.find((row) => row.id === id);
                if (!player) return null;
                const quarterPts = (period: number) => player.quarters.find((quarter) => quarter.period === period)?.pts ?? 0;
                return (
                  <tr key={game.id} className="border-b border-rule">
                    <td className="py-2 pr-2">
                      <Link href={`/games/${game.id}`} className="text-ink">
                        {etDate(game.date, false)}
                      </Link>
                    </td>
                    <td className="px-2 py-2 text-right">
                      {place(game.home, game.neutral)} {game.opponentAbbr}
                    </td>
                    <td className="px-2 py-2 text-right">
                      {game.win ? "W" : "L"} {game.knicksScore}–{game.opponentScore}
                    </td>
                    <td className="px-2 py-2 text-right">{Math.round(player.minutes)}</td>
                    <td className="px-2 py-2 text-right">{player.pts}</td>
                    <td className="px-2 py-2 text-right">{player.reb}</td>
                    <td className="px-2 py-2 text-right">{player.ast}</td>
                    <td className="px-2 py-2 text-right">{signed(player.plusMinus, 0)}</td>
                    {[1, 2, 3, 4].map((period) => (
                      <td key={period} className="px-2 py-2 text-right text-muted">
                        {quarterPts(period)}
                      </td>
                    ))}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="mt-3 text-[13px] text-muted">
          Last game score {latestScore(games, id)}. Knicks {record(games.filter((game) => game.win).length, games.filter((game) => !game.win).length)} in these games.
        </p>
      </section>
    </main>
  );
}

function latestScore(games: ReturnType<typeof playerGames>, id: string): string {
  const player = games[0]?.players.find((row) => row.id === id);
  return player ? fixed(gameScore(player)) : "—";
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-black px-3 py-3">
      <dt className="text-[11px] uppercase tracking-[0.12em] text-muted">{label}</dt>
      <dd className="tabular mt-1 text-[22px]">{value}</dd>
    </div>
  );
}

function QuarterSplit({ lines }: { lines: PlayerRollup[] }) {
  const periods = [1, 2, 3, 4];
  return (
    <table className="w-full min-w-[720px] border-collapse text-left">
      <thead>
        <tr className="border-b border-rule text-[11px] uppercase tracking-[0.12em] text-muted">
          <th className="py-2 pr-3 font-normal">Quarter</th>
          {lines.map((line) => (
            <th key={line.season + line.phase} className="px-2 py-2 text-right font-normal" colSpan={3}>
              {line.season} {line.phase === "playoffs" ? "PO" : ""}
            </th>
          ))}
        </tr>
        <tr className="border-b border-rule text-[11px] uppercase tracking-[0.12em] text-faint">
          <th className="py-2 pr-3 font-normal"> </th>
          {lines.map((line) => (
            ["Pts", "+/−", "Opp/48"].map((label) => (
              <th key={line.season + line.phase + label} className="px-2 py-2 text-right font-normal">
                {label}
              </th>
            ))
          ))}
        </tr>
      </thead>
      <tbody className="tabular text-[14px]">
        {periods.map((period) => (
          <tr key={period} className="border-b border-rule">
            <td className="py-2 pr-3">Q{period}</td>
            {lines.flatMap((line) => {
              const quarter = line.quarters.find((item) => item.period === period);
              const key = `${line.season}-${line.phase}-${period}`;
              return [
                <td key={`${key}-pts`} className="px-2 py-2 text-right">
                  {quarter ? fixed(quarter.pts) : "—"}
                </td>,
                <td key={`${key}-pm`} className="px-2 py-2 text-right">
                  {quarter ? signed(quarter.plusMinus) : "—"}
                </td>,
                <td key={`${key}-opp`} className="px-2 py-2 text-right">
                  {quarter?.oppPts48 == null ? "—" : fixed(quarter.oppPts48)}
                </td>,
              ];
            })}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
