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

const LIBERTY = [
  "......F.......",
  ".....FFF......",
  "......T.......",
  "......T.......",
  "....S.S.S.....",
  ".....S.S......",
  ".....GGG......",
  "....G.G.G.....",
  "....GGGGG.....",
  "....GGWGG.....",
  ".....GWG......",
  ".....GGG......",
  "....GGGGG.....",
  "....GGGGG.....",
  "....GGGGG.....",
  "....GGGGG.....",
  "...GGGGGGG....",
  "...GGGGGGG....",
  "..GGGGGGGGG...",
  "..DDDDDDDDD...",
];

const PIXEL: Record<string, string> = {
  F: "#e07a3d",
  T: "#c4a574",
  S: "#d7dece",
  G: "#8eae78",
  W: "#f4f1ea",
  D: "#3e5234",
};

export function Liberty({ className }: { className?: string }) {
  const cols = LIBERTY[0]?.length ?? 0;
  const rows = LIBERTY.length;
  const size = 4;
  return (
    <svg
      viewBox={`0 0 ${cols * size} ${rows * size}`}
      className={className}
      role="img"
      aria-label="Pixel Statue of Liberty"
      shapeRendering="crispEdges"
    >
      {LIBERTY.flatMap((row, y) =>
        [...row].map((cell, x) => {
          const fill = PIXEL[cell];
          if (!fill) return null;
          return <rect key={`${x}-${y}`} x={x * size} y={y * size} width={size} height={size} fill={fill} />;
        }),
      )}
    </svg>
  );
}
