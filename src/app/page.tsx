import Link from "next/link";
import { QuarterBars } from "@/components/charts";
import { heatStyle } from "@/components/heat";
import { MarginChart } from "@/components/margin-chart";
import { PairHeatmap } from "@/components/pair-heatmap";
import { PlayerTable, type PlayerTableRow } from "@/components/player-table";
import { QuarterHeatmap } from "@/components/quarter-heatmap";
import { Section } from "@/components/site-frame";
import { buildReport, type FactorRow, type Ratings, type SeasonView, type Situation } from "@/lib/analytics";
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
        <p className="mt-5 max-w-[36ch] text-[16px] leading-snug text-muted">{report.hero.body}</p>
        {current ? <SeasonTiles current={current} previous={previous} /> : null}
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
          <p className="mt-4 text-[16px]">{report.latest.note}</p>
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
      >
        <SeasonCompare current={current} previous={previous} playoffs={playoffs} />
      </Section>

      <Section
        id="games"
        index="02  /  Game to game"
        title="The margin, one night at a time"
        lede="Dot is the final margin. Line is the running average."
      >
        <MarginChart views={views} initialId={initialId} />
      </Section>

      <Section
        id="quarters"
        index="03  /  Quarters"
        title="Where the game is won or lost"
        lede={report.notes.quarters}
        source="Overtime stays in the grid, not the four-quarter average."
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
      >
        <FactorBoard rows={report.factors.filter((row) => row.group !== "Scoring")} />
      </Section>

      <Section
        id="situations"
        index="05  /  Situations"
        title="Home, road, and the night after"
        lede={report.notes.situations}
        source="Rest uses the Eastern Time calendar."
      >
        <SituationTable current={current} previous={previous} />
      </Section>

      <Section
        id="players"
        index="06  /  Players"
        title="What kind of impact"
        lede={report.notes.players}
        source="On−off is margin on the floor minus margin on the bench."
      >
        <PlayerTable rows={playerRows} compareLabel={previous ? `${prettySeason(previous.season)} on−off` : undefined} />
        <p className="mt-4 text-[14px]">
          <Link href="/players" className="text-ink">
            All players, both seasons
          </Link>
        </p>
      </Section>

      <Section id="pairs" index="07  /  Pairings" title="Who helps whom" lede={report.notes.pairs} source="Blank under 8 shared minutes. Diagonal is that player on the floor.">
        <PairHeatmap boards={report.pairs} initialId={initialId} />
      </Section>
    </main>
  );
}

function SeasonTiles({ current, previous }: { current: SeasonView; previous: SeasonView | null }) {
  const items = [
    { k: "Record", v: record(current.ratings.wins, current.ratings.losses), s: previous ? record(previous.ratings.wins, previous.ratings.losses) : null },
    { k: "Net", v: signed(current.ratings.net), s: previous ? signed(previous.ratings.net) : null },
    { k: "Offense", v: fixed(current.ratings.ortg), s: previous ? fixed(previous.ratings.ortg) : null },
    { k: "Defense", v: fixed(current.ratings.drtg), s: previous ? fixed(previous.ratings.drtg) : null },
  ];
  return (
    <dl className="mt-8 grid grid-cols-2 gap-px bg-rule sm:grid-cols-4">
      {items.map((item) => (
        <div key={item.k} className="bg-black py-4 pr-3">
          <dt className="text-[11px] uppercase tracking-[0.14em] text-muted">{item.k}</dt>
          <dd className="tabular mt-1 text-[32px] font-bold leading-none">{item.v}</dd>
          {item.s ? <dd className="mt-2 text-[12px] text-faint">Last year {item.s}</dd> : null}
        </div>
      ))}
    </dl>
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
    { label: "Margin", value: (ratings) => signed(ratings.margin) },
    { label: "Offense", value: (ratings) => fixed(ratings.ortg) },
    { label: "Defense", value: (ratings) => fixed(ratings.drtg) },
    { label: "Net", value: (ratings) => signed(ratings.net) },
    { label: "Pace", value: (ratings) => fixed(ratings.pace) },
    { label: "Scored", value: (ratings) => fixed(ratings.ptsFor) },
    { label: "Allowed", value: (ratings) => fixed(ratings.ptsAgainst) },
  ];
  return (
    <div className="grid gap-px bg-rule md:grid-cols-3">
      {columns.map((column) => (
        <div key={column.label} className="bg-black p-4">
          <p className="text-[11px] uppercase tracking-[0.14em] text-muted">{column.label}</p>
          <p className="tabular mt-2 text-[36px] font-bold leading-none">{record(column.ratings.wins, column.ratings.losses)}</p>
          <dl className="mt-5 space-y-2">
            {lines.map((line) => (
              <div key={line.label} className="flex items-baseline justify-between gap-4 text-[14px]">
                <dt className="text-muted">{line.label}</dt>
                <dd className="tabular">{line.value(column.ratings)}</dd>
              </div>
            ))}
          </dl>
        </div>
      ))}
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
              <td className="p-1 text-right">
                <span className="tabular inline-flex min-w-14 justify-center px-2 py-1 font-bold" style={heatStyle(now.margin, 6)}>
                  {signed(now.margin)}
                </span>
              </td>
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

function FactorBoard({ rows }: { rows: FactorRow[] }) {
  const peak = Math.max(1, ...rows.map((row) => Math.abs(row.shift ?? 0)));
  let lastGroup = "";
  return (
    <div>
      {rows.map((row) => {
        const showGroup = row.group !== lastGroup;
        lastGroup = row.group;
        const shift = row.shift ?? 0;
        const width = (Math.abs(shift) / peak) * 50;
        const color = row.tone === "good" ? "#b7c98a" : row.tone === "bad" ? "#e09a94" : "#8a847c";
        return (
          <div key={row.label} className={showGroup ? "mt-6 first:mt-0" : "mt-3"}>
            {showGroup ? <p className="mb-3 text-[11px] uppercase tracking-[0.14em] text-faint">{row.group}</p> : null}
            <div className="grid items-center gap-3 sm:grid-cols-[minmax(0,1.1fr)_minmax(120px,1fr)_3.5rem]">
              <div>
                <p className="text-[14px] leading-tight">{row.label}</p>
                <p className="tabular text-[12px] text-muted">
                  {row.current} <span className="text-faint">was {row.previous}</span>
                </p>
              </div>
              <div className="relative h-2 bg-[#1a1a1a]">
                <span className="absolute left-1/2 top-0 h-full w-px bg-[#3a3a3a]" />
                <span
                  className="absolute top-0 h-full"
                  style={{
                    width: `${width}%`,
                    left: shift >= 0 ? "50%" : `${50 - width}%`,
                    background: color,
                  }}
                />
              </div>
              <p className="tabular text-right text-[14px]" style={{ color }}>
                {row.delta}
              </p>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function SituationTable({ current, previous }: { current: SeasonView | null; previous: SeasonView | null }) {
  if (!current) return <p className="text-muted">Situation splits appear after a game is ingested.</p>;
  const ids = Array.from(new Set([...current.situations.map((row) => row.id), ...(previous?.situations.map((row) => row.id) ?? [])]));
  const find = (season: SeasonView | null, id: string): Situation | undefined => season?.situations.find((row) => row.id === id);
  return (
    <div className="grid grid-cols-2 gap-px bg-rule md:grid-cols-3">
      {ids.map((id) => {
        const now = find(current, id);
        const then = find(previous, id);
        const label = now?.label ?? then?.label ?? id;
        const margin = now?.margin ?? 0;
        return (
          <div key={id} className="bg-black p-4">
            <p className="text-[11px] uppercase tracking-[0.14em] text-muted">{label}</p>
            <p className={`tabular mt-2 text-[32px] font-bold leading-none ${now && margin >= 0 ? "text-knicks" : "text-opp"}`}>
              {now ? signed(margin) : "—"}
            </p>
            <p className="mt-2 text-[13px] text-muted">
              {now ? `${record(now.wins, now.losses)} · ${now.games} g · net ${signed(now.net)}` : "—"}
            </p>
            {then ? <p className="mt-1 text-[12px] text-faint">Last year {signed(then.margin)}</p> : null}
          </div>
        );
      })}
    </div>
  );
}
