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

/** Pixel Statue of Liberty. Torch on her right, seven crown rays, tablet on her left. */
export const LIBERTY_ROWS = [
  "..Y...................",
  ".fYF..................",
  ".fYF..................",
  "..tt..................",
  "tTTt..................",
  ".tt.........C.........",
  ".tt.......C.C.C.......",
  ".tt.....C.C.C.C.C.....",
  ".aa...C.C.C.C.C.C.C...",
  ".aa...CCCCCCCCCCCCC...",
  ".aa...CCnnCnnCnnCC....",
  ".aa......kkkkkkk......",
  ".aa......kkekekk......",
  ".aa......kkkkkkk......",
  ".ggggggggggggg........",
  ".gGggggggggggG........",
  ".ggggggggggggg........",
  ".ggggdggdggggg........",
  ".gggggggggggWW........",
  ".gGgggggggggWw........",
  ".gggggggggggWW........",
  "..ggggggggggg.........",
  "..ppppppppppp.........",
  ".BBBBBBBBBBBBB........",
  ".bbbbbbbbbbbbb........",
  "..bbbbbbbbbbb.........",
];

export const LIBERTY_PIXEL: Record<string, string> = {
  Y: "#ffe1a8",
  F: "#ffb15a",
  f: "#e07a3d",
  t: "#b8894e",
  T: "#f0ddb0",
  C: "#d5e4c4",
  n: "#141414",
  a: "#9bb888",
  k: "#f0d2a8",
  e: "#1a140e",
  g: "#7ea06e",
  G: "#d7e6c4",
  d: "#3e5a36",
  W: "#f7f4ee",
  w: "#8a847c",
  p: "#6d8f5e",
  B: "#5c5c5c",
  b: "#2a2a2a",
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
