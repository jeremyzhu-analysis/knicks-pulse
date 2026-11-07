"use client";

import { useState } from "react";
import { lastName, prettySeason } from "@/lib/format";

export interface ShotDot {
  playerId: string;
  name: string;
  season: string;
  phase: "regular" | "playoffs";
  period: number;
  x: number;
  y: number;
  made: boolean;
  value: 2 | 3;
}

const WIDTH = 500;
const HEIGHT = 500;

function px(x: number): number {
  return (x / 50) * WIDTH;
}

function py(y: number): number {
  return ((42 - y) / 50) * HEIGHT;
}

function courtPath(): string {
  const base = -5.25;
  const half = 41.75;
  const ft = 13.75;
  const r3 = 23.75;
  const yBreak = Math.sqrt(r3 * r3 - 22 * 22);
  const a0 = Math.atan2(yBreak, -22);
  const a1 = Math.atan2(yBreak, 22);
  const arc: string[] = [];
  const steps = 40;
  for (let i = 0; i <= steps; i += 1) {
    const angle = a0 + (a1 - a0) * (i / steps);
    const x = 25 + r3 * Math.cos(angle);
    const y = r3 * Math.sin(angle);
    arc.push(`${i === 0 ? "M" : "L"}${px(x).toFixed(1)},${py(y).toFixed(1)}`);
  }
  return [
    `M${px(0)},${py(base)} H${px(50)} V${py(half)} H${px(0)} Z`,
    `M${px(17)},${py(base)} V${py(ft)} H${px(33)} V${py(base)}`,
    `M${px(3)},${py(base)} V${py(yBreak)}`,
    `M${px(47)},${py(base)} V${py(yBreak)}`,
    arc.join(" "),
  ].join(" ");
}

const COURT = courtPath();

export function ShotChart({ shots, initialPlayer = "" }: { shots: ShotDot[]; initialPlayer?: string }) {
  const seasons = (() => {
    const map = new Map<string, string>();
    for (const shot of shots) {
      const id = `${shot.season}:${shot.phase}`;
      if (!map.has(id)) {
        const label = `${prettySeason(shot.season)} ${shot.phase === "playoffs" ? "playoffs" : "regular season"}`;
        map.set(id, label);
      }
    }
    return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  })();
  const latest = seasons.at(-1)?.[0] ?? "";
  const [seasonId, setSeasonId] = useState(() => {
    if (!initialPlayer) return latest;
    if (shots.some((shot) => shot.playerId === initialPlayer && `${shot.season}:${shot.phase}` === latest)) return latest;
    const earlier = shots.find((shot) => shot.playerId === initialPlayer);
    return earlier ? `${earlier.season}:${earlier.phase}` : latest;
  });
  const [playerId, setPlayerId] = useState(initialPlayer);
  const [show, setShow] = useState<"all" | "make" | "miss">("all");

  const inSeason = shots.filter((shot) => `${shot.season}:${shot.phase}` === seasonId);
  const players = (() => {
    const counts = new Map<string, { name: string; attempts: number }>();
    for (const shot of inSeason) {
      const row = counts.get(shot.playerId) ?? { name: shot.name, attempts: 0 };
      row.attempts += 1;
      counts.set(shot.playerId, row);
    }
    return [...counts.entries()].sort((a, b) => b[1].attempts - a[1].attempts);
  })();

  const visible = inSeason.filter((shot) => {
    if (playerId && shot.playerId !== playerId) return false;
    if (show === "make") return shot.made;
    if (show === "miss") return !shot.made;
    return true;
  });
  const makes = visible.filter((shot) => shot.made).length;
  const attempts = visible.length;
  const pct = attempts ? (100 * makes) / attempts : 0;
  const selected = players.find((player) => player[0] === playerId)?.[1].name;

  if (shots.length === 0) {
    return <p className="text-muted">Shot locations appear after the next full ingest.</p>;
  }

  return (
    <div>
      <div className="mb-4 flex flex-wrap gap-x-5 gap-y-2 text-[13px]">
        {seasons.map(([id, label]) => (
          <button
            key={id}
            type="button"
            className={id === seasonId ? "text-ink underline underline-offset-4" : "text-muted"}
            onClick={() => {
              setSeasonId(id);
              setPlayerId("");
            }}
          >
            {label}
          </button>
        ))}
      </div>
      <div className="mb-4 flex flex-wrap gap-2 text-[13px]">
        <button
          type="button"
          className={!playerId ? "bg-ink px-2 py-1 text-black" : "px-2 py-1 text-muted"}
          onClick={() => setPlayerId("")}
        >
          All
        </button>
        {players.map(([id, player]) => (
          <button
            key={id}
            type="button"
            className={id === playerId ? "bg-ink px-2 py-1 text-black" : "px-2 py-1 text-muted"}
            onClick={() => setPlayerId(id)}
          >
            {lastName(player.name)}
          </button>
        ))}
      </div>
      <div className="mb-3 flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-[11px] uppercase tracking-[0.14em] text-muted">{selected ? lastName(selected) : "Knicks"}</p>
          <p className="tabular text-[36px] font-bold leading-none">
            {makes}–{attempts - makes}
            <span className="ml-3 text-[18px] text-muted">{attempts ? `${pct.toFixed(1)}%` : "—"}</span>
          </p>
          <p className="mt-1 text-[13px] text-muted">{attempts} field-goal attempts.</p>
        </div>
        <div className="flex gap-4 text-[13px]">
          {(
            [
              ["all", "All"],
              ["make", "Makes"],
              ["miss", "Misses"],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              className={show === id ? "text-ink underline underline-offset-4" : "text-muted"}
              onClick={() => setShow(id)}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
      <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} className="mx-auto h-auto w-full max-w-[520px]" role="img" aria-label="Knicks shot chart">
        <rect width={WIDTH} height={HEIGHT} fill="#000" />
        <path d={COURT} fill="none" stroke="#3a3a3a" strokeWidth="1.6" />
        <circle cx={px(25)} cy={py(13.75)} r={px(6)} fill="none" stroke="#3a3a3a" strokeWidth="1.6" />
        <path
          d={`M${px(19)},${py(13.75)} A${px(6)},${px(6)} 0 0 0 ${px(31)},${py(13.75)}`}
          fill="none"
          stroke="#3a3a3a"
          strokeWidth="1.6"
        />
        <circle cx={px(25)} cy={py(0)} r={px(4)} fill="none" stroke="#3a3a3a" strokeWidth="1.6" />
        <circle cx={px(25)} cy={py(0)} r={px(0.75)} fill="none" stroke="#a39e94" strokeWidth="1.4" />
        <line x1={px(22)} x2={px(28)} y1={py(-4)} y2={py(-4)} stroke="#a39e94" strokeWidth="1.6" />
        {visible
          .filter((shot) => !shot.made)
          .map((shot, index) => (
            <circle
              key={`m-${index}`}
              cx={px(shot.x)}
              cy={py(shot.y)}
              r="3.2"
              fill="#000"
              stroke="#7eadd4"
              strokeWidth="1.3"
            >
              <title>{`${lastName(shot.name)} miss, ${shot.value} pts, Q${shot.period}`}</title>
            </circle>
          ))}
        {visible
          .filter((shot) => shot.made)
          .map((shot, index) => (
            <circle key={`k-${index}`} cx={px(shot.x)} cy={py(shot.y)} r="3.4" fill="#e07a3d" stroke="#e07a3d" strokeWidth="0.6">
              <title>{`${lastName(shot.name)} make, ${shot.value} pts, Q${shot.period}`}</title>
            </circle>
          ))}
      </svg>
      <p className="mt-3 flex flex-wrap gap-x-5 text-[12px] text-muted">
        <span>
          <span className="mr-2 inline-block h-2.5 w-2.5 bg-knicks" />
          Make
        </span>
        <span>
          <span className="mr-2 inline-block h-2.5 w-2.5 border border-opp" />
          Miss
        </span>
        <span>Each dot is one field-goal attempt. Free throws are left off the court.</span>
      </p>
    </div>
  );
}
