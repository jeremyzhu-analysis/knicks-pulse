import Link from "next/link";
import { QuarterBars } from "@/components/charts";
import { heatStyle } from "@/components/heat";
import { MarginChart } from "@/components/margin-chart";
import { PairHeatmap } from "@/components/pair-heatmap";
import { PlayerTable, type PlayerTableRow } from "@/components/player-table";
import { QuarterHeatmap } from "@/components/quarter-heatmap";
import { ShotChart, type ShotDot } from "@/components/shot-chart";
import { Section } from "@/components/site-frame";
import { buildReport, type FactorRow, type LatestView, type Ratings, type SeasonView, type Situation } from "@/lib/analytics";
import { etDate, fixed, place, prettySeason, record, signed } from "@/lib/format";
import { parseView } from "@/lib/nav";
import { readStore } from "@/lib/store";
import type { Store } from "@/lib/types";

export default async function HomePage({
  searchParams,
}: {
  searchParams: Promise<{ layer?: string; tab?: string; player?: string }>;
}) {
  const query = await searchParams;
  const view = parseView(query.layer, query.tab);
  const store = readStore();
  const report = buildReport(store);
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

  const shots = view.layer === "players" && view.tab === "shots" ? shotDots(store) : [];

  return (
    <main className="mx-auto max-w-[1080px] px-5">
      <article className="border-b border-rule py-8 md:py-10">
        <p className="text-[11px] uppercase tracking-[0.18em] text-knicks">{report.hero.kicker}</p>
        <h1 className="mt-3 max-w-[18em] text-[32px] font-bold leading-[1.12] md:text-[44px]">{report.hero.title}</h1>
        <p className="mt-4 max-w-[36ch] text-[16px] leading-snug text-muted">{report.hero.body}</p>
        {current ? <SeasonTiles current={current} previous={previous} /> : null}
      </article>

      {view.layer === "team" && view.tab === "season" ? (
        <Section id="season" index="Team  /  Season" title="Last year against this year" lede={report.notes.season}>
          <SeasonCompare current={current} previous={previous} playoffs={playoffs} />
        </Section>
      ) : null}

      {view.layer === "team" && view.tab === "games" ? (
        <Section
          id="games"
          index="Team  /  Games"
          title="One night at a time"
          lede={report.latest?.note ?? "Final margin, then the running average."}
          source="Dot is the final margin. Line is the running average."
        >
          {report.latest ? <LatestGame latest={report.latest} /> : null}
          <div className={report.latest ? "mt-10" : ""}>
            <MarginChart views={views} initialId={initialId} />
          </div>
        </Section>
      ) : null}

      {view.layer === "team" && view.tab === "quarters" ? (
        <Section
          id="quarters"
          index="Team  /  Quarters"
          title="Margin by quarter"
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
      ) : null}

      {view.layer === "team" && view.tab === "factors" ? (
        <Section
          id="factors"
          index="Team  /  Offense and defense"
          title="Four factors, both ends"
          lede={report.notes.factors}
          source="Bar is the change from last regular season."
        >
          <FactorBoard rows={report.factors.filter((row) => row.group !== "Scoring")} />
        </Section>
      ) : null}

      {view.layer === "team" && view.tab === "situations" ? (
        <Section
          id="situations"
          index="Team  /  Situations"
          title="Home, road, and rest"
          lede={report.notes.situations}
          source="Rest uses the Eastern Time calendar."
        >
          <SituationTable current={current} previous={previous} />
        </Section>
      ) : null}

      {view.layer === "players" && view.tab === "impact" ? (
        <Section
          id="impact"
          index="Players  /  Impact"
          title="On-court swing"
          lede={report.notes.players}
          source="On−off is on-court margin minus the bench."
        >
          <PlayerTable rows={playerRows} compareLabel={previous ? `${prettySeason(previous.season)} on−off` : undefined} />
          {report.seasons
            .filter((season) => season.ratings.games > 0 && !(current && season.season === current.season && season.phase === current.phase))
            .map((season) => {
              const rows: PlayerTableRow[] = report.players
                .filter((player) => player.season === season.season && player.phase === season.phase)
                .map((player) => ({ ...player, previousOnOff: null }));
              return (
                <div key={season.label} className="mt-12 border-t border-rule pt-8">
                  <h3 className="text-[18px] font-bold">{season.label}</h3>
                  <p className="mt-2 text-[14px] text-muted">{season.ratings.games} games, sorted by minutes.</p>
                  <div className="mt-5">
                    <PlayerTable rows={rows} />
                  </div>
                </div>
              );
            })}
        </Section>
      ) : null}

      {view.layer === "players" && view.tab === "pairs" ? (
        <Section
          id="pairs"
          index="Players  /  Pairings"
          title="Who shares the floor"
          lede={report.notes.pairs}
          source="Blank under 8 shared minutes. Diagonal is that player alone."
        >
          <PairHeatmap boards={report.pairs} initialId={initialId} />
        </Section>
      ) : null}

      {view.layer === "players" && view.tab === "shots" ? (
        <Section
          id="shots"
          index="Players  /  Shots"
          title="Field-goal map"
          lede={shotLede(shots, current)}
          source="Free throws are off the court."
        >
          <ShotChart shots={shots} initialPlayer={query.player ?? ""} />
        </Section>
      ) : null}
    </main>
  );
}

function LatestGame({ latest }: { latest: LatestView }) {
  return (
    <div>
      <p className="text-[11px] uppercase tracking-[0.14em] text-muted">Latest game</p>
      <h3 className="mt-2 text-[22px] font-bold leading-tight">
        <Link href={`/games/${latest.id}`} className="text-ink">
          Knicks {latest.knicksScore}, {latest.opponentName} {latest.opponentScore}
        </Link>
      </h3>
      <p className="mt-2 text-[14px] text-muted">
        {etDate(latest.date)} · {place(latest.home, latest.neutral)} {latest.opponentAbbr} · {latest.venue}
        {latest.series ? ` · ${latest.series}` : ""}
      </p>
      <div className="mt-6 overflow-x-auto">
        <table className="w-full min-w-[520px] border-collapse text-left">
          <thead>
            <tr className="border-b border-rule text-[11px] uppercase tracking-[0.14em] text-muted">
              <th className="py-2 pr-3 font-normal">Team</th>
              {latest.quarters.map((quarter) => (
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
              {latest.quarters.map((quarter) => (
                <td key={quarter.period} className="px-2 py-2 text-right">
                  {quarter.knicks}
                </td>
              ))}
              <td className="px-2 py-2 text-right font-bold">{latest.knicksScore}</td>
            </tr>
            <tr className="border-b border-rule">
              <td className="py-2 pr-3">{latest.opponentAbbr}</td>
              {latest.quarters.map((quarter) => (
                <td key={quarter.period} className="px-2 py-2 text-right">
                  {quarter.opponent}
                </td>
              ))}
              <td className="px-2 py-2 text-right">{latest.opponentScore}</td>
            </tr>
            <tr>
              <td className="py-2 pr-3 text-muted">Margin</td>
              {latest.quarters.map((quarter) => (
                <td key={quarter.period} className="px-2 py-2 text-right text-muted">
                  {signed(quarter.margin, 0)}
                </td>
              ))}
              <td className="px-2 py-2 text-right text-muted">{signed(latest.knicksScore - latest.opponentScore, 0)}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}

function shotLede(shots: ShotDot[], current: SeasonView | null): string {
  const slice = current
    ? shots.filter((shot) => shot.season === current.season && shot.phase === current.phase)
    : shots;
  const makes = slice.filter((shot) => shot.made).length;
  const misses = slice.length - makes;
  if (slice.length === 0) return "Each dot is an attempt. Orange is a make. A ring is a miss.";
  const scope = current ? "this season" : "in the snapshot";
  return `${record(makes, misses)} ${scope}, ${((100 * makes) / slice.length).toFixed(1)}%. Each dot is an attempt.`;
}

function shotDots(store: Store): ShotDot[] {
  const names = new Map<string, string>();
  for (const game of store.games) {
    for (const row of game.players) names.set(row.id, row.name);
  }
  const shots: ShotDot[] = [];
  for (const game of store.games) {
    for (const shot of game.shots ?? []) {
      shots.push({
        ...shot,
        name: names.get(shot.playerId) ?? "Knick",
        season: game.season,
        phase: game.phase,
      });
    }
  }
  return shots;
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
