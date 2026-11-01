"use client";

import { useState } from "react";
import type { PairBoard, PairCell } from "@/lib/analytics";
import { signed } from "@/lib/format";
import { heatStyle } from "@/components/heat";

function findCell(cells: PairCell[], a: string, b: string): PairCell | undefined {
  return cells.find((cell) => (cell.a === a && cell.b === b) || (cell.a === b && cell.b === a));
}

export function PairHeatmap({ boards, initialId }: { boards: PairBoard[]; initialId: string }) {
  const [viewId, setViewId] = useState(initialId);
  const board = boards.find((item) => item.id === viewId) ?? boards[0];
  const [picked, setPicked] = useState<string | null>(null);

  if (!board || board.players.length === 0) {
    return <p className="text-muted">Pair minutes appear after a lineup replay.</p>;
  }

  const ranked = board.cells.slice().sort((a, b) => b.net48 - a.net48);
  const active = board.cells.find((cell) => `${cell.a}:${cell.b}` === picked) ?? ranked[0];
  const name = (id: string) => board.players.find((player) => player.id === id)?.name ?? id;

  return (
    <div>
      <div className="mb-4 flex flex-wrap gap-x-5 gap-y-2 text-[13px]">
        {boards.map((item) => (
          <button
            key={item.id}
            type="button"
            className={item.id === board.id ? "text-ink underline underline-offset-4" : "text-muted"}
            onClick={() => {
              setViewId(item.id);
              setPicked(null);
            }}
          >
            {item.label}
          </button>
        ))}
      </div>
      <div className="overflow-x-auto">
        <table className="border-collapse">
          <thead>
            <tr>
              <th className="w-24" />
              {board.players.map((player) => (
                <th key={player.id} className="p-0 align-bottom font-normal">
                  <div className="flex h-24 items-end justify-center pb-1">
                    <span className="text-[11px] uppercase tracking-[0.08em] text-muted [writing-mode:vertical-rl] rotate-180">
                      {player.name}
                    </span>
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {board.players.map((row) => (
              <tr key={row.id}>
                <th className="pr-3 text-right text-[12px] font-normal text-ink">{row.name}</th>
                {board.players.map((column) => {
                  const self = row.id === column.id;
                  const cell = self ? undefined : findCell(board.cells, row.id, column.id);
                  const value = self ? row.net48 : cell?.net48;
                  const key = self ? row.id : `${row.id}:${column.id}`;
                  if (value == null) {
                    return (
                      <td key={key} className="p-0.5">
                        <div className="flex h-12 w-12 items-center justify-center bg-[#141414] text-[11px] text-faint sm:h-14 sm:w-14">—</div>
                      </td>
                    );
                  }
                  const tone = heatStyle(value, 12);
                  return (
                    <td key={key} className="p-0.5">
                      <button
                        type="button"
                        className="tabular flex h-12 w-12 items-center justify-center text-[12px] sm:h-14 sm:w-14"
                        style={tone}
                        title={
                          self
                            ? `${row.name} on the floor, ${signed(value)} per 48`
                            : `${name(cell?.a ?? row.id)} + ${name(cell?.b ?? column.id)}, ${signed(value)} per 48, ${Math.round(cell?.minutes ?? 0)} min`
                        }
                        onClick={() => {
                          if (cell) setPicked(`${cell.a}:${cell.b}`);
                        }}
                      >
                        {signed(value, 0)}
                      </button>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="mt-4 flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-[11px] uppercase tracking-[0.14em] text-muted">{active ? "Pair" : "On court"}</p>
          <p className="mt-1 text-[22px] font-bold leading-none tabular">
            {active ? (
              <>
                {name(active.a)}–{name(active.b)}{" "}
                <span className={active.net48 >= 0 ? "text-knicks" : "text-opp"}>{signed(active.net48)}</span>
              </>
            ) : (
              "Diagonal is each player alone on the floor."
            )}
          </p>
          {active ? <p className="mt-1 text-[13px] text-muted">{Math.round(active.minutes)} shared minutes. Margin per 48.</p> : null}
        </div>
        <div className="flex items-center gap-2 text-[11px] uppercase tracking-[0.12em] text-muted">
          <span>Behind</span>
          <span className="h-2 w-24" style={{ background: "linear-gradient(90deg, #7eadd4, #141414, #e07a3d)" }} />
          <span>Ahead</span>
        </div>
      </div>
    </div>
  );
}
