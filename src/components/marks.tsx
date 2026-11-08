export function KnicksMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 64 64" className={className} role="img" aria-label="New York Knicks">
      <circle cx="32" cy="32" r="30" fill="#006BB6" />
      <circle cx="32" cy="32" r="27" fill="none" stroke="#F58426" strokeWidth="2.5" />
      <path d="M32 8c2 6 2 10 0 16M32 40c-2 6-2 10 0 16M8 32c6-2 10-2 16 0M40 32c6 2 10 2 16 0" fill="none" stroke="#F58426" strokeWidth="1.2" opacity="0.7" />
      <text x="32" y="39" textAnchor="middle" fontFamily="Arial, Helvetica, sans-serif" fontWeight="700" fontSize="20" fill="#F58426">
        NY
      </text>
    </svg>
  );
}

/** Pixel Statue of Liberty. Copper figure, gilded torch, seven crown spikes, tablet in her left hand. */
export const LIBERTY_ROWS = [
  ".....F..........................",
  "....fFf.........................",
  "...oFFFo........................",
  "...ofFfo........................",
  "...UUUUU........................",
  "...UuuuU........................",
  ".....aa.........................",
  ".....aa.........................",
  ".....aa.........................",
  ".....aa............R............",
  ".....aa..........R.R.R..........",
  ".....aa........R.R.R.R.R........",
  ".....aa......R.R.R.R.R.R.R......",
  "......aaa....R.R.R.R.R.R.R......",
  ".......aaa..CCnCCCnCCCnCCCC.....",
  "........aaa.CCnCCCnCCCnCCCC.....",
  ".........aaa..CGggGGggGC........",
  "..........aaa.CGGeGGGeGC........",
  "...........aaa.GGGGnGGGG........",
  "............aaaGGGmmmGGG........",
  ".............aaa.ggggg..........",
  ".............LLGGGgGGGGGGG..tttt",
  ".............LLGGGgGGGGGGGaatTTt",
  "............LLGGGGgGGGGGGGaattTt",
  "............LLGGGGgGGGGGGGaatTtt",
  "............LLGGGGgGGGGGGGG.ttTt",
  "............LLGGGGgGGGGGGGG.tTTt",
  "...........LLGGGGGgGGGGGGGGGtttt",
  "...........LLGGGGGgGGGGGGGGG....",
  "...........LLGGGGGgGGGGGGGGG....",
  "..........LLGGGGGGgGGGGGGGGGG...",
  "..........LLGGGGGGgGGGGGGGGGG...",
  "..........LLGGGGGGgGGGGGGGGGG...",
  ".........LLGGGGGGGgGGGGGGGGGGG..",
  ".........LLGGGGGGGgGGGGGGGGGGG..",
  ".........LLGGGGGGGgGGGGGGGGGGG..",
  ".........LLGGGGGGGgGGGGGGGGGGG..",
  "........LLGGGGgggggGGGggggGGGGG.",
  "........LLGGGGgggggGGGggggGGGGG.",
  "............PPPPPPPPPPPPPPPP....",
  "...........PPPPPPPPPPPPPPPPPP...",
  "..........pppppppppppppppppppp..",
  ".........pppppppppppppppppppppp.",
];

export const LIBERTY_PIXEL: Record<string, string> = {
  F: "#fff6d8",
  f: "#ffc56a",
  o: "#e07a3d",
  U: "#f3e2a8",
  u: "#c6a15a",
  a: "#8fc4b2",
  R: "#e7f6f1",
  C: "#9fd0bf",
  n: "#16302c",
  G: "#3f8f78",
  g: "#24584c",
  L: "#d5eee4",
  e: "#10211e",
  m: "#16302c",
  T: "#f7f4ee",
  t: "#6d6a64",
  P: "#9a958c",
  p: "#2a2a2a",
};

export function Liberty({ className }: { className?: string }) {
  const cols = LIBERTY_ROWS[0]?.length ?? 0;
  const rows = LIBERTY_ROWS.length;
  const size = 4;
  return (
    <svg
      viewBox={`0 0 ${cols * size} ${rows * size}`}
      className={className}
      role="img"
      aria-label="Pixel Statue of Liberty"
      shapeRendering="crispEdges"
    >
      {LIBERTY_ROWS.flatMap((row, y) =>
        [...row].map((cell, x) => {
          const fill = LIBERTY_PIXEL[cell];
          if (!fill) return null;
          return <rect key={`${x}-${y}`} x={x * size} y={y * size} width={size} height={size} fill={fill} />;
        }),
      )}
    </svg>
  );
}
