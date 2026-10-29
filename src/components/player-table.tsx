"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import type { PlayerRollup } from "@/lib/analytics";
import { fixed, pct, signed } from "@/lib/format";

type Key = "mpg" | "pts" | "reb" | "ast" | "ts" | "pmPerGame" | "onOff" | "oppPts48On";

const COLUMNS: { key: Key; label: string; digits?: number; signed?: boolean; percent?: boolean }[] = [
  { key: "mpg", label: "Min" },
  { key: "pts", label: "Pts" },
  { key: "reb", label: "Reb" },
  { key: "ast", label: "Ast" },
  { key: "ts", label: "TS%", percent: true },
  { key: "pmPerGame", label: "+/−", signed: true },
  { key: "onOff", label: "On−off", signed: true },
  { key: "oppPts48On", label: "Opp pts/48" },
];

export interface PlayerTableRow extends PlayerRollup {
  previousOnOff: number | null;
}

export function PlayerTable({ rows, compareLabel }: { rows: PlayerTableRow[]; compareLabel?: string }) {
  const [key, setKey] = useState<Key>("mpg");
  const [dir, setDir] = useState<"desc" | "asc">("desc");
  const sorted = useMemo(() => {
    const copy = rows.slice();
    copy.sort((a, b) => {
      const av = a[key];
      const bv = b[key];
      const an = av == null ? -Infinity : av;
      const bn = bv == null ? -Infinity : bv;
      return dir === "desc" ? bn - an : an - bn;
    });
    return copy;
  }, [rows, key, dir]);

  if (rows.length === 0) return <p className="text-muted">No players have logged minutes in this slice.</p>;

  function sortBy(next: Key) {
    if (next === key) setDir((value) => (value === "desc" ? "asc" : "desc"));
    else {
      setKey(next);
      setDir("desc");
    }
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[860px] border-collapse text-left">
        <thead>
          <tr className="border-b border-rule text-[11px] uppercase tracking-[0.12em] text-muted">
            <th className="py-2 pr-3 font-normal">Player</th>
            <th className="px-2 py-2 text-right font-normal">GP</th>
            {COLUMNS.map((column) => (
              <th key={column.key} className="px-2 py-2 text-right font-normal">
                <button type="button" className="text-muted hover:text-ink" onClick={() => sortBy(column.key)}>
                  {column.label}
                  {key === column.key ? (dir === "desc" ? " ↓" : " ↑") : ""}
                </button>
              </th>
            ))}
            {compareLabel ? <th className="px-2 py-2 text-right font-normal">{compareLabel}</th> : null}
            <th className="py-2 pl-3 font-normal">Impact</th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((player) => (
            <tr key={`${player.season}-${player.phase}-${player.id}`} className="border-b border-rule">
              <td className="py-2 pr-3 text-[14px]">
                <Link href={`/players/${player.id}`} className="text-ink">
                  {player.name}
                </Link>
                <span className="ml-2 text-[12px] text-muted">{player.position}</span>
              </td>
              <td className="tabular px-2 py-2 text-right text-[14px]">{player.games}</td>
              {COLUMNS.map((column) => {
                const value = player[column.key];
                const text =
                  value == null
                    ? "—"
                    : column.percent
                      ? pct(value)
                      : column.signed
                        ? signed(value)
                        : fixed(value);
                return (
                  <td key={column.key} className="tabular px-2 py-2 text-right text-[14px]">
                    {text}
                  </td>
                );
              })}
              {compareLabel ? (
                <td className="tabular px-2 py-2 text-right text-[14px] text-muted">
                  {player.previousOnOff == null ? "—" : signed(player.previousOnOff)}
                </td>
              ) : null}
              <td className="py-2 pl-3 text-[13px] text-muted" title={player.impact.sentence}>
                {player.impact.title}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
