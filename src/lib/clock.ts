/** ESPN clocks are "M:SS" until the final minute, then seconds ("49.8", "1.5"). */
export function clockSeconds(display: string | undefined | null): number {
  if (!display) return 0;
  const t = display.trim();
  if (!t) return 0;
  if (t.includes(":")) {
    const [m, s] = t.split(":");
    const min = Number(m);
    const sec = Number(s);
    if (!Number.isFinite(min) || !Number.isFinite(sec)) return 0;
    return min * 60 + sec;
  }
  const n = Number(t);
  return Number.isFinite(n) ? n : 0;
}

export function periodLength(period: number): number {
  return period <= 4 ? 720 : 300;
}

export function quarterLabel(period: number): string {
  if (period >= 1 && period <= 4) return `Q${period}`;
  if (period === 5) return "OT";
  return `OT${period - 4}`;
}

export function quarterName(period: number): string {
  if (period === 1) return "first quarter";
  if (period === 2) return "second quarter";
  if (period === 3) return "third quarter";
  if (period === 4) return "fourth quarter";
  if (period === 5) return "overtime";
  return `overtime ${period - 4}`;
}

export function elapsedSeconds(period: number, clockRemaining: number): number {
  let t = 0;
  for (let p = 1; p < period; p += 1) t += periodLength(p);
  return t + (periodLength(period) - clockRemaining);
}

export function gameLengthSeconds(periods: number[]): number {
  return periods.reduce((sum, period) => sum + periodLength(period), 0);
}
