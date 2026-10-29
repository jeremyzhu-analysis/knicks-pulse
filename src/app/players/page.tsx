import Link from "next/link";
import { PlayerTable, type PlayerTableRow } from "@/components/player-table";
import { buildReport } from "@/lib/analytics";
import { prettySeason } from "@/lib/format";
import { readStore } from "@/lib/store";

export const metadata = {
  title: "Players · Knicks game to game",
};

export default function PlayersPage() {
  const report = buildReport(readStore());
  const groups = report.seasons.filter((season) => season.ratings.games > 0);

  return (
    <main className="mx-auto max-w-[1080px] px-5 py-10">
      <p className="text-[11px] uppercase tracking-[0.18em] text-muted">Players</p>
      <h1 className="mt-2 max-w-[20ch] text-[34px] font-bold leading-[1.12]">Who is moving the game</h1>
      <p className="mt-4 max-w-[68ch] text-[17px] leading-[1.55]">
        Impact is not a single rating. Scoring, creation, rebounding, rim protection and disruption are read off the
        box score. The on/off column is the change in the Knicks&apos; margin per 48 minutes when that player sits.
        Defensive impact is the opponent scoring rate during those minutes.
      </p>
      {groups.length === 0 ? <p className="mt-8 text-muted">Ingest a game to fill the roster.</p> : null}
      {groups.map((season) => {
        const rows: PlayerTableRow[] = report.players
          .filter((player) => player.season === season.season && player.phase === season.phase)
          .map((player) => ({ ...player, previousOnOff: null }));
        return (
          <section key={season.label} className="mt-12 border-t border-rule pt-8">
            <h2 className="text-[22px] font-bold">{season.label}</h2>
            <p className="mt-2 text-[14px] text-muted">
              {prettySeason(season.season)} · {season.ratings.games} games · sorted by minutes. Open a name for the
              quarter split.
            </p>
            <div className="mt-5">
              <PlayerTable rows={rows} />
            </div>
          </section>
        );
      })}
      <p className="mt-10 text-[14px]">
        <Link href="/" className="text-ink">
          Back to the team report
        </Link>
      </p>
    </main>
  );
}
