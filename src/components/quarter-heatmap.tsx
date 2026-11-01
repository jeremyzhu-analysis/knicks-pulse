"use client";

import Link from "next/link";
import { useState } from "react";
import { heatStyle } from "@/components/heat";
import type { GameStub } from "@/lib/analytics";
import { etDate, signed } from "@/lib/format";

export function QuarterHeatmap({
  views,
  initialId,
}: {
  views: { id: string; label: string; games: GameStub[] }[];
  initialId: string;
}) {
  const [viewId, setViewId] = useState(initialId);
  const view = views.find((item) => item.id === viewId) ?? views[0];
  const games = (view?.games ?? []).slice().reverse();
  const periods = [1, 2, 3, 4];
  const hasOt = games.some((game) => game.quarters.some((quarter) => quarter.period > 4));
  const columns = hasOt ? [...periods, 5] : periods;

  if (!view || games.length === 0) return <p className="text-muted">No games to chart.</p>;

  return (
    <div>
      <div className="mb-4 flex flex-wrap gap-x-5 gap-y-2 text-[13px]">
        {views.map((item) => (
          <button
            key={item.id}
            type="button"
            className={item.id === view.id ? "text-ink underline underline-offset-4" : "text-muted"}
            onClick={() => setViewId(item.id)}
          >
            {item.label}
          </button>
        ))}
      </div>
      <div className="max-h-[560px] overflow-auto border-t border-rule">
        <table className="w-full min-w-[640px] border-collapse text-left">
          <thead className="sticky top-0 bg-black">
            <tr className="border-b border-rule text-[11px] uppercase tracking-[0.14em] text-muted">
              <th className="py-2 pr-3 font-normal">Game</th>
              <th className="px-2 py-2 text-right font-normal">Final</th>
              {columns.map((period) => (
                <th key={period} className="px-2 py-2 text-center font-normal">
                  {period <= 4 ? `Q${period}` : "OT"}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {games.map((game) => (
              <tr key={game.id} className="border-b border-rule">
                <td className="py-1.5 pr-3 text-[13px]">
                  <Link href={`/games/${game.id}`} className="text-ink">
                    {etDate(game.date, false)} {game.home ? "vs" : "@"} {game.opponentAbbr}
                  </Link>
                </td>
                <td className={`tabular px-2 py-1.5 text-right text-[13px] ${game.win ? "text-ink" : "text-opp"}`}>
                  {game.knicksScore}–{game.opponentScore}
                </td>
                {columns.map((period) => {
                  const quarter = game.quarters.find((item) => item.period === period);
                  if (!quarter) {
                    return (
                      <td key={period} className="px-2 py-1.5 text-center text-[12px] text-faint">
                        —
                      </td>
                    );
                  }
                  const tone = heatStyle(quarter.margin);
                  return (
                    <td key={period} className="p-0.5">
                      <div className="tabular flex h-9 min-w-12 items-center justify-center text-[13px] font-bold" style={tone}>
                        {signed(quarter.margin, 0)}
                      </div>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="mt-3 flex flex-wrap items-center justify-between gap-3 text-[12px] text-muted">
        <p>Newest on top. Orange ahead, blue behind.</p>
        <div className="flex items-center gap-2 text-[11px] uppercase tracking-[0.12em]">
          <span>−16</span>
          <span className="h-2 w-24" style={{ background: "linear-gradient(90deg, #7eadd4, #141414, #e07a3d)" }} />
          <span>+16</span>
        </div>
      </div>
    </div>
  );
}
