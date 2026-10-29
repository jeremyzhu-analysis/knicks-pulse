import Link from "next/link";
import { QuarterBars } from "@/components/charts";
import { MarginChart } from "@/components/margin-chart";
import { PlayerTable, type PlayerTableRow } from "@/components/player-table";
import { QuarterHeatmap } from "@/components/quarter-heatmap";
import { Section } from "@/components/site-frame";
import { buildReport, type Ratings, type SeasonView, type Situation } from "@/lib/analytics";
import { etDate, fixed, place, prettySeason, record, signed } from "@/lib/format";
import { readStore } from "@/lib/store";

export default function HomePage() {
  const report = buildReport(readStore());
  const { current, previous, playoffs } = report;
  const views = report.seasons
    .filter((season) => season.ratings.games > 0)
    .map((season) => ({
      id: `${season.season}:${season.phase}`,
      label: season.label,
      games: season.games,
    }));
  const initialId = current ? `${current.season}:${current.phase}` : (views[0]?.id ?? "");
  const previousPlayers = new Map(
    report.players
      .filter((player) => previous && player.season === previous.season && player.phase === "regular")
      .map((player) => [player.id, player]),
  );
  const playerRows: PlayerTableRow[] = report.players
    .filter((player) => current && player.season === current.season && player.phase === "regular")
    .map((player) => ({
      ...player,
      previousOnOff: previousPlayers.get(player.id)?.onOff ?? null,
    }));

  return (
    <main className="mx-auto max-w-[1080px] px-5">
      <article className="border-b border-rule py-10 md:py-14">
        <p className="text-[11px] uppercase tracking-[0.18em] text-knicks">{report.hero.kicker}</p>
        <h1 className="mt-3 max-w-[22em] text-[32px] font-bold leading-[1.12] md:text-[44px]">{report.hero.title}</h1>
        <p className="mt-5 max-w-[68ch] text-[18px] leading-[1.55]">{report.hero.body}</p>
      </article>

      {report.latest ? (
        <section className="border-b border-rule py-10">
          <p className="text-[11px] uppercase tracking-[0.18em] text-muted">Latest game</p>
          <h2 className="mt-2 text-[26px] font-bold leading-tight">
            <Link href={`/games/${report.latest.id}`} className="text-ink">
              Knicks {report.latest.knicksScore}, {report.latest.opponentName} {report.latest.opponentScore}
            </Link>
          </h2>
          <p className="mt-2 text-[14px] text-muted">
            {etDate(report.latest.date)} · {place(report.latest.home, report.latest.neutral)} {report.latest.opponentAbbr} ·{" "}
            {report.latest.venue}
            {report.latest.series ? ` · ${report.latest.series}` : ""}
          </p>
          <p className="mt-4 max-w-[68ch] text-[16px] leading-relaxed">{report.latest.note}</p>
          <div className="mt-6 overflow-x-auto">
            <table className="w-full min-w-[520px] border-collapse text-left">
              <thead>
                <tr className="border-b border-rule text-[11px] uppercase tracking-[0.14em] text-muted">
                  <th className="py-2 pr-3 font-normal">Team</th>
                  {report.latest.quarters.map((quarter) => (
                    <th key={quarter.period} className="px-2 py-2 text-right font-normal">
                      {quarter.label}
                    </th>
                  ))}
                  <th className="px-2 py-2 text-right font-normal">Final</th>
                </tr>
              </thead>
              <tbody className="tabular text-[15px]">
                <tr className="border-b border-rule">
                  <td className="py-2 pr-3">Knicks</td>
                  {report.latest.quarters.map((quarter) => (
                    <td key={quarter.period} className="px-2 py-2 text-right">
                      {quarter.knicks}
                    </td>
                  ))}
                  <td className="px-2 py-2 text-right font-bold">{report.latest.knicksScore}</td>
                </tr>
                <tr className="border-b border-rule">
                  <td className="py-2 pr-3">{report.latest.opponentAbbr}</td>
                  {report.latest.quarters.map((quarter) => (
                    <td key={quarter.period} className="px-2 py-2 text-right">
                      {quarter.opponent}
                    </td>
                  ))}
                  <td className="px-2 py-2 text-right">{report.latest.opponentScore}</td>
                </tr>
                <tr>
                  <td className="py-2 pr-3 text-muted">Margin</td>
                  {report.latest.quarters.map((quarter) => (
                    <td key={quarter.period} className="px-2 py-2 text-right text-muted">
                      {signed(quarter.margin, 0)}
                    </td>
                  ))}
                  <td className="px-2 py-2 text-right text-muted">
                    {signed(report.latest.knicksScore - report.latest.opponentScore, 0)}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
          <div className="mt-6 overflow-x-auto">
            <table className="w-full min-w-[640px] border-collapse text-left">
              <thead>
                <tr className="border-b border-rule text-[11px] uppercase tracking-[0.14em] text-muted">
                  <th className="py-2 pr-3 font-normal">Knicks, by game score</th>
                  <th className="px-2 py-2 text-right font-normal">Min</th>
                  <th className="px-2 py-2 text-right font-normal">Pts</th>
                  <th className="px-2 py-2 text-right font-normal">Reb</th>
                  <th className="px-2 py-2 text-right font-normal">Ast</th>
                  <th className="px-2 py-2 text-right font-normal">+/−</th>
                  <th className="px-2 py-2 text-right font-normal">Game score</th>
                </tr>
              </thead>
              <tbody className="tabular text-[14px]">
                {report.latest.players.map((player) => (
                  <tr key={player.id} className="border-b border-rule">
                    <td className="py-2 pr-3">
                      <Link href={`/players/${player.id}`} className="text-ink">
                        {player.name}
                      </Link>
                    </td>
                    <td className="px-2 py-2 text-right">{Math.round(player.minutes)}</td>
                    <td className="px-2 py-2 text-right">{player.pts}</td>
                    <td className="px-2 py-2 text-right">{player.reb}</td>
                    <td className="px-2 py-2 text-right">{player.ast}</td>
                    <td className="px-2 py-2 text-right">{signed(player.plusMinus, 0)}</td>
                    <td className="px-2 py-2 text-right">{fixed(player.gameScore)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

      <Section
        id="season"
        index="01  /  Season"
        title="Last year against this year"
        lede={report.notes.season}
        source="Regular season unless a column says otherwise. Net rating is offensive rating minus defensive rating."
      >
        <SeasonCompare current={current} previous={previous} playoffs={playoffs} />
      </Section>

      <Section
        id="games"
        index="02  /  Game to game"
        title="The margin, one night at a time"
        lede="Each dot is a final margin. The line smooths the last few games so a single blowout does not hide the run."
        source="Click a point for that game's quarter breakdown."
      >
        <MarginChart views={views} initialId={initialId} />
      </Section>

      <Section
        id="quarters"
        index="03  /  Quarters"
        title="Where the game is won or lost"
        lede={report.notes.quarters}
        source="Overtime is included in the game grid when a game reached it, and is left out of the four-quarter average."
      >
        {current ? (
          <QuarterBars
            current={current.quarters}
            previous={previous?.quarters ?? null}
            currentLabel={current.label}
            previousLabel={previous?.label ?? null}
          />
        ) : (
          <p className="text-muted">Quarter averages appear after a game is ingested.</p>
        )}
        <div className="mt-8 overflow-x-auto">
          <QuarterTable current={current} previous={previous} />
        </div>
        <div className="mt-10">
          <QuarterHeatmap views={views} initialId={initialId} />
        </div>
      </Section>

      <Section
        id="factors"
        index="04  /  Offense and defense"
        title="Four factors, both ends"
        lede={report.notes.factors}
        source="Olive means the change favors the Knicks. Rose means it does not. Pace is not marked, because playing faster is not itself better or worse."
      >
        <FactorTable rows={report.factors.filter((row) => row.group !== "Scoring")} previousLabel={previous?.label ?? "Last season"} currentLabel={current?.label ?? "This season"} />
      </Section>

      <Section
        id="situations"
        index="05  /  Situations"
        title="Home, road, and the night after"
        lede={report.notes.situations}
        source="Rest is measured on the Eastern Time calendar. A back-to-back is a game on the next calendar day."
      >
        <SituationTable current={current} previous={previous} />
      </Section>

      <Section
        id="players"
        index="06  /  Players"
        title="What kind of impact"
        lede={report.notes.players}
        source="On−off is the Knicks' margin per 48 minutes with the player on the floor, minus the same figure with that player on the bench. Opp pts/48 is what opponents score during those minutes. The full roster, including last season, is on the players page."
      >
        <PlayerTable rows={playerRows} compareLabel={previous ? `${prettySeason(previous.season)} on−off` : undefined} />
        <p className="mt-4 text-[14px]">
          <Link href="/players" className="text-ink">
            All players, both seasons
          </Link>
        </p>
      </Section>
    </main>
  );
}

function SeasonCompare({
  current,
  previous,
  playoffs,
}: {
  current: SeasonView | null;
  previous: SeasonView | null;
  playoffs: SeasonView | null;
}) {
  const columns = [current, previous, playoffs].filter((column): column is SeasonView => Boolean(column));
  if (columns.length === 0) return <p className="text-muted">No season is in the snapshot yet.</p>;
  const lines: { label: string; value: (ratings: Ratings) => string }[] = [
    { label: "Record", value: (ratings) => record(ratings.wins, ratings.losses) },
    { label: "Margin", value: (ratings) => signed(ratings.margin) },
    { label: "Offensive rating", value: (ratings) => fixed(ratings.ortg) },
    { label: "Defensive rating", value: (ratings) => fixed(ratings.drtg) },
    { label: "Net rating", value: (ratings) => signed(ratings.net) },
    { label: "Pace", value: (ratings) => fixed(ratings.pace) },
    { label: "Points scored", value: (ratings) => fixed(ratings.ptsFor) },
    { label: "Points allowed", value: (ratings) => fixed(ratings.ptsAgainst) },
  ];
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[560px] border-collapse text-left">
        <thead>
          <tr className="border-b border-rule text-[11px] uppercase tracking-[0.14em] text-muted">
            <th className="py-2 pr-3 font-normal"> </th>
            {columns.map((column) => (
              <th key={column.label} className="px-3 py-2 text-right font-normal">
                {column.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="tabular text-[15px]">
          {lines.map((line) => (
            <tr key={line.label} className="border-b border-rule">
              <td className="py-2 pr-3">{line.label}</td>
              {columns.map((column) => (
                <td key={column.label} className="px-3 py-2 text-right">
                  {line.value(column.ratings)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function QuarterTable({ current, previous }: { current: SeasonView | null; previous: SeasonView | null }) {
  const periods = [1, 2, 3, 4];
  if (!current) return null;
  return (
    <table className="w-full min-w-[720px] border-collapse text-left">
      <thead>
        <tr className="border-b border-rule text-[11px] uppercase tracking-[0.14em] text-muted">
          <th className="py-2 pr-3 font-normal">Quarter</th>
          <th className="px-2 py-2 text-right font-normal">Scored</th>
          <th className="px-2 py-2 text-right font-normal">Allowed</th>
          <th className="px-2 py-2 text-right font-normal">Margin</th>
          <th className="px-2 py-2 text-right font-normal" title="Games ahead, behind, and tied">
            A–B–T
          </th>
          {previous ? <th className="px-2 py-2 text-right font-normal">Last year</th> : null}
          {previous ? <th className="px-2 py-2 text-right font-normal">Change</th> : null}
        </tr>
      </thead>
      <tbody className="tabular text-[14px]">
        {periods.map((period) => {
          const now = current.quarters.find((quarter) => quarter.period === period);
          const then = previous?.quarters.find((quarter) => quarter.period === period);
          if (!now) return null;
          return (
            <tr key={period} className="border-b border-rule">
              <td className="py-2 pr-3">{now.label}</td>
              <td className="px-2 py-2 text-right">{fixed(now.knicks)}</td>
              <td className="px-2 py-2 text-right">{fixed(now.opponent)}</td>
              <td className="px-2 py-2 text-right">{signed(now.margin)}</td>
              <td
                className="px-2 py-2 text-right"
                title={`${now.won} ahead, ${now.lost} behind${now.tied ? `, ${now.tied} tied` : ""}`}
              >
                {now.won}–{now.lost}–{now.tied}
              </td>
              {previous ? <td className="px-2 py-2 text-right text-muted">{then ? signed(then.margin) : "—"}</td> : null}
              {previous ? (
                <td className="px-2 py-2 text-right">{then ? signed(now.margin - then.margin) : "—"}</td>
              ) : null}
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function FactorTable({
  rows,
  currentLabel,
  previousLabel,
}: {
  rows: { group: string; label: string; current: string; previous: string; delta: string; tone: string }[];
  currentLabel: string;
  previousLabel: string;
}) {
  let lastGroup = "";
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[640px] border-collapse text-left">
        <thead>
          <tr className="border-b border-rule text-[11px] uppercase tracking-[0.14em] text-muted">
            <th className="py-2 pr-3 font-normal"> </th>
            <th className="px-3 py-2 text-right font-normal">{currentLabel}</th>
            <th className="px-3 py-2 text-right font-normal">{previousLabel}</th>
            <th className="px-3 py-2 text-right font-normal">Change</th>
          </tr>
        </thead>
        <tbody className="text-[14px]">
          {rows.map((row) => {
            const showGroup = row.group !== lastGroup;
            lastGroup = row.group;
            const tone = row.tone === "good" ? "text-gain" : row.tone === "bad" ? "text-loss" : "text-muted";
            return (
              <tr key={row.label} className="border-b border-rule">
                <td className="py-2 pr-3">
                  {showGroup ? <span className="mr-3 text-[11px] uppercase tracking-[0.14em] text-faint">{row.group}</span> : null}
                  {row.label}
                </td>
                <td className="tabular px-3 py-2 text-right">{row.current}</td>
                <td className="tabular px-3 py-2 text-right text-muted">{row.previous}</td>
                <td className={`tabular px-3 py-2 text-right ${tone}`}>{row.delta}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function SituationTable({ current, previous }: { current: SeasonView | null; previous: SeasonView | null }) {
  if (!current) return <p className="text-muted">Situation splits appear after a game is ingested.</p>;
  const ids = Array.from(new Set([...current.situations.map((row) => row.id), ...(previous?.situations.map((row) => row.id) ?? [])]));
  const find = (season: SeasonView | null, id: string): Situation | undefined => season?.situations.find((row) => row.id === id);
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[760px] border-collapse text-left">
        <thead>
          <tr className="border-b border-rule text-[11px] uppercase tracking-[0.14em] text-muted">
            <th className="py-2 pr-3 font-normal">Split</th>
            <th className="px-2 py-2 text-right font-normal">Games</th>
            <th className="px-2 py-2 text-right font-normal">Record</th>
            <th className="px-2 py-2 text-right font-normal">Margin</th>
            <th className="px-2 py-2 text-right font-normal">Net</th>
            {previous ? <th className="px-2 py-2 text-right font-normal">Last year margin</th> : null}
            {previous ? <th className="px-2 py-2 text-right font-normal">Last year net</th> : null}
          </tr>
        </thead>
        <tbody className="tabular text-[14px]">
          {ids.map((id) => {
            const now = find(current, id);
            const then = find(previous, id);
            const label = now?.label ?? then?.label ?? id;
            return (
              <tr key={id} className="border-b border-rule">
                <td className="py-2 pr-3">{label}</td>
                <td className="px-2 py-2 text-right">{now?.games ?? "—"}</td>
                <td className="px-2 py-2 text-right">{now ? record(now.wins, now.losses) : "—"}</td>
                <td className="px-2 py-2 text-right">{now ? signed(now.margin) : "—"}</td>
                <td className="px-2 py-2 text-right">{now ? signed(now.net) : "—"}</td>
                {previous ? <td className="px-2 py-2 text-right text-muted">{then ? signed(then.margin) : "—"}</td> : null}
                {previous ? <td className="px-2 py-2 text-right text-muted">{then ? signed(then.net) : "—"}</td> : null}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
