"use client";

import Link from "next/link";
import { useState } from "react";
import type { GameStub } from "@/lib/analytics";
import { etDate, signed } from "@/lib/format";

function mix(from: string, to: string, amount: number): string {
  const parse = (hex: string) => [1, 3, 5].map((index) => parseInt(hex.slice(index, index + 2), 16));
  const a = parse(from);
  const b = parse(to);
  const channels = a.map((channel, index) => Math.round(channel + (b[index] - channel) * amount));
  return `#${channels.map((channel) => channel.toString(16).padStart(2, "0")).join("")}`;
}

function heat(margin: number): { background: string; color: string } {
  const t = Math.max(-1, Math.min(1, margin / 16));
  const background = t >= 0 ? mix("#141414", "#e07a3d", t) : mix("#141414", "#7eadd4", -t);
  return { background, color: Math.abs(t) > 0.55 ? "#140e0a" : "#f4f1ea" };
}

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
                  const tone = heat(quarter.margin);
                  return (
                    <td key={period} className="p-0.5">
                      <div className="tabular px-1 py-1 text-center text-[12px]" style={tone}>
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
      <p className="mt-3 text-[12px] text-muted">
        Each cell is the Knicks&apos; point margin in that quarter. Orange means the Knicks outscored the opponent. Blue
        means they were outscored. Newest game at the top.
      </p>
    </div>
  );
}
