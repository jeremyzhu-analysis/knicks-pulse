import type { Metadata } from "next";
import { ShotChart, type ShotDot } from "@/components/shot-chart";
import { readStore } from "@/lib/store";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Shot map · Knicks game to game",
  description: "Every Knicks field-goal attempt, plotted on the court.",
};

export default async function ShotsPage({ searchParams }: { searchParams: Promise<{ player?: string }> }) {
  const { player } = await searchParams;
  const store = readStore();
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

  return (
    <main className="mx-auto max-w-[1080px] px-5 py-10">
      <p className="text-[11px] uppercase tracking-[0.18em] text-knicks">Shot map</p>
      <h1 className="mt-3 max-w-[16em] text-[32px] font-bold leading-[1.12] md:text-[44px]">Where the shots come from</h1>
      <p className="mt-4 max-w-[36ch] text-[16px] text-muted">Each dot is a field-goal attempt. Orange is a make. Blue ring is a miss.</p>
      <div className="mt-8">
        <ShotChart shots={shots} initialPlayer={player ?? ""} />
      </div>
    </main>
  );
}
