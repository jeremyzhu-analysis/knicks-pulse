import type { QuarterSummary } from "@/lib/analytics";
import type { FlowPoint } from "@/lib/types";
import { signed } from "@/lib/format";

export function QuarterBars({
  current,
  previous,
  currentLabel,
  previousLabel,
}: {
  current: QuarterSummary[];
  previous: QuarterSummary[] | null;
  currentLabel: string;
  previousLabel: string | null;
}) {
  const periods = [1, 2, 3, 4];
  const values = periods.flatMap((period) => {
    const now = current.find((quarter) => quarter.period === period)?.margin ?? 0;
    const then = previous?.find((quarter) => quarter.period === period)?.margin ?? 0;
    return [now, then];
  });
  const peak = Math.max(4, ...values.map((value) => Math.abs(value)));
  const width = 860;
  const height = 240;
  const pad = { l: 36, r: 12, t: 16, b: 36 };
  const zero = pad.t + (height - pad.t - pad.b) / 2;
  const unit = (height - pad.t - pad.b) / 2 / peak;
  const groupW = (width - pad.l - pad.r) / periods.length;

  return (
    <div>
      <svg viewBox={`0 0 ${width} ${height}`} className="h-auto w-full" role="img" aria-label="Average quarter margin by season">
        <line x1={pad.l} x2={width - pad.r} y1={zero} y2={zero} stroke="#2a2a2a" />
        <text x={0} y={pad.t + 8} fill="#a39e94" fontSize="11" fontFamily="Arial, Helvetica, sans-serif">
          +{peak.toFixed(0)}
        </text>
        <text x={0} y={height - pad.b} fill="#a39e94" fontSize="11" fontFamily="Arial, Helvetica, sans-serif">
          −{peak.toFixed(0)}
        </text>
        {periods.map((period, index) => {
          const now = current.find((quarter) => quarter.period === period);
          const then = previous?.find((quarter) => quarter.period === period);
          const cx = pad.l + groupW * index + groupW / 2;
          const bars = [
            { value: now?.margin ?? 0, fill: "#e07a3d", dx: previous ? -11 : 0 },
            previous ? { value: then?.margin ?? 0, fill: "#8a847c", dx: 11 } : null,
          ].filter((bar): bar is { value: number; fill: string; dx: number } => Boolean(bar));
          return (
            <g key={period}>
              {bars.map((bar) => {
                const h = Math.abs(bar.value) * unit;
                const y = bar.value >= 0 ? zero - h : zero;
                return <rect key={bar.fill} x={cx + bar.dx - 7} y={y} width="14" height={Math.max(h, 1)} fill={bar.fill} />;
              })}
              <text
                x={cx}
                y={height - 14}
                textAnchor="middle"
                fill="#a39e94"
                fontSize="12"
                fontFamily="Arial, Helvetica, sans-serif"
              >
                Q{period}
              </text>
              <text
                x={cx}
                y={12}
                textAnchor="middle"
                fill="#f4f1ea"
                fontSize="11"
                fontFamily="Arial, Helvetica, sans-serif"
              >
                {now ? signed(now.margin) : ""}
              </text>
            </g>
          );
        })}
      </svg>
      <p className="mt-2 text-[12px] text-muted">
        <span className="text-knicks">Orange</span> is {currentLabel}
        {previousLabel ? (
          <>
            . <span className="text-faint">Gray</span> is {previousLabel}. The number above each group is this season.
          </>
        ) : (
          ". Bars are the average point margin in that quarter."
        )}
      </p>
    </div>
  );
}

export function FlowChart({ flow }: { flow: FlowPoint[] }) {
  if (flow.length < 2) return <p className="text-muted">No scoring sequence was stored for this game.</p>;
  const width = 860;
  const height = 240;
  const pad = { l: 36, r: 12, t: 16, b: 28 };
  const maxElapsed = Math.max(flow[flow.length - 1]?.elapsed ?? 1, 2880);
  const peak = Math.max(6, ...flow.map((point) => Math.abs(point.margin)));
  const x = (elapsed: number) => pad.l + (elapsed / maxElapsed) * (width - pad.l - pad.r);
  const y = (margin: number) => pad.t + ((peak - margin) / (peak * 2)) * (height - pad.t - pad.b);
  const d = flow
    .map((point, index) => `${index === 0 ? "M" : "L"}${x(point.elapsed).toFixed(1)},${y(point.margin).toFixed(1)}`)
    .join(" ");
  const marks = [720, 1440, 2160, 2880].filter((mark) => mark <= maxElapsed + 1);

  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="h-auto w-full" role="img" aria-label="Point margin through the game">
      <line x1={pad.l} x2={width - pad.r} y1={y(0)} y2={y(0)} stroke="#2a2a2a" />
      {marks.map((mark, index) => (
        <g key={mark}>
          <line x1={x(mark)} x2={x(mark)} y1={pad.t} y2={height - pad.b} stroke="#2a2a2a" />
          <text x={x(mark) - 4} y={height - 8} textAnchor="end" fill="#a39e94" fontSize="11" fontFamily="Arial, Helvetica, sans-serif">
            Q{index + 1}
          </text>
        </g>
      ))}
      <path d={d} fill="none" stroke="#e07a3d" strokeWidth="1.7" />
      <text x={0} y={y(peak) + 4} fill="#a39e94" fontSize="11" fontFamily="Arial, Helvetica, sans-serif">
        +{peak.toFixed(0)}
      </text>
      <text x={0} y={y(-peak) + 4} fill="#a39e94" fontSize="11" fontFamily="Arial, Helvetica, sans-serif">
        −{peak.toFixed(0)}
      </text>
    </svg>
  );
}
