"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import type { GameStub } from "@/lib/analytics";
import { etDate, place, signed } from "@/lib/format";

export function MarginChart({
  views,
  initialId,
}: {
  views: { id: string; label: string; games: GameStub[] }[];
  initialId: string;
}) {
  const [viewId, setViewId] = useState(initialId);
  const view = views.find((item) => item.id === viewId) ?? views[0];
  const games = useMemo(() => view?.games ?? [], [view]);
  const [windowSize, setWindowSize] = useState(games.length >= 12 ? 10 : 5);
  const [active, setActive] = useState(Math.max(0, games.length - 1));

  const width = 860;
  const height = 300;
  const pad = { l: 40, r: 12, t: 16, b: 32 };
  const peak = Math.max(8, ...games.map((game) => Math.abs(game.margin)), 1);
  const innerW = width - pad.l - pad.r;
  const innerH = height - pad.t - pad.b;
  const x = (index: number) => (games.length <= 1 ? pad.l + innerW / 2 : pad.l + (index / (games.length - 1)) * innerW);
  const y = (margin: number) => pad.t + ((peak - margin) / (peak * 2)) * innerH;
  const rolling = useMemo(() => {
    return games.map((_, index) => {
      const start = Math.max(0, index - windowSize + 1);
      const slice = games.slice(start, index + 1).map((game) => game.margin);
      if (slice.length < Math.min(3, windowSize)) return null;
      return slice.reduce((sum, value) => sum + value, 0) / slice.length;
    });
  }, [games, windowSize]);

  if (!view || games.length === 0) {
    return <p className="text-muted">No completed games in this season yet.</p>;
  }

  const selected = games[Math.min(active, games.length - 1)];
  const runs: { index: number; value: number }[][] = [];
  let run: { index: number; value: number }[] = [];
  rolling.forEach((value, index) => {
    if (value == null) {
      if (run.length) runs.push(run);
      run = [];
      return;
    }
    run.push({ index, value });
  });
  if (run.length) runs.push(run);
  const path = runs
    .map((points) => points.map((point, index) => `${index === 0 ? "M" : "L"}${x(point.index).toFixed(1)},${y(point.value).toFixed(1)}`).join(" "))
    .join(" ");
  const areaParts = runs
    .filter((points) => points.length > 1)
    .map((points) => {
      const line = points.map((point, index) => `${index === 0 ? "M" : "L"}${x(point.index).toFixed(1)},${y(point.value).toFixed(1)}`).join(" ");
      const last = points[points.length - 1];
      const first = points[0];
      return `${line} L${x(last.index).toFixed(1)},${y(0).toFixed(1)} L${x(first.index).toFixed(1)},${y(0).toFixed(1)} Z`;
    });

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-x-5 gap-y-2 text-[13px]">
        {views.map((item) => (
          <button
            key={item.id}
            type="button"
            className={item.id === view.id ? "text-ink underline underline-offset-4" : "text-muted"}
            onClick={() => {
              setViewId(item.id);
              setActive(Math.max(0, item.games.length - 1));
            }}
          >
            {item.label}
          </button>
        ))}
        <span className="text-faint">|</span>
        {[5, 10].map((size) => (
          <button
            key={size}
            type="button"
            className={size === windowSize ? "text-ink underline underline-offset-4" : "text-muted"}
            onClick={() => setWindowSize(size)}
          >
            {size}-game average
          </button>
        ))}
      </div>
      <svg viewBox={`0 0 ${width} ${height}`} className="h-auto w-full" role="img" aria-label="Game margin and rolling average">
        <line x1={pad.l} x2={width - pad.r} y1={y(0)} y2={y(0)} stroke="#2a2a2a" />
        {[peak, 0, -peak].map((tick) => (
          <text key={tick} x={0} y={y(tick) + 4} fill="#a39e94" fontSize="11" fontFamily="Arial, Helvetica, sans-serif">
            {tick > 0 ? `+${tick}` : tick}
          </text>
        ))}
        {areaParts.map((part, index) => (
          <path key={index} d={part} fill="#f4f1ea" opacity="0.08" />
        ))}
        <path d={path} fill="none" stroke="#f4f1ea" strokeWidth="2.2" />
        {games.map((game, index) => (
          <a key={game.id} href={`/games/${game.id}`}>
            <circle
              cx={x(index)}
              cy={y(game.margin)}
              r={active === index ? 7 : 4.5}
              fill={game.win ? "#e07a3d" : "#7eadd4"}
              stroke={active === index ? "#f4f1ea" : "none"}
              strokeWidth="1.5"
              onMouseEnter={() => setActive(index)}
              onFocus={() => setActive(index)}
            >
              <title>
                {etDate(game.date)} {game.opponentAbbr} {game.margin > 0 ? `+${game.margin}` : game.margin}
              </title>
            </circle>
          </a>
        ))}
      </svg>
      <div className="mt-4 flex flex-wrap items-end gap-6 border-t border-rule pt-4">
        <div>
          <p className="text-[11px] uppercase tracking-[0.14em] text-muted">Margin</p>
          <p className={`tabular text-[42px] font-bold leading-none ${selected.margin >= 0 ? "text-knicks" : "text-opp"}`}>
            {signed(selected.margin, 0)}
          </p>
        </div>
        <div className="pb-1 text-[14px]">
          <Link href={`/games/${selected.id}`} className="text-ink">
            {etDate(selected.date)} · {place(selected.home, selected.neutral)} {selected.opponentAbbr}
          </Link>
          <p className="text-muted">
            {selected.knicksScore}–{selected.opponentScore} · Off {selected.ortg.toFixed(1)} · Def {selected.drtg.toFixed(1)}
          </p>
        </div>
      </div>
      <p className="mt-3 text-[12px] text-muted">Orange win. Blue loss. White line, {windowSize}-game average.</p>
    </div>
  );
}
