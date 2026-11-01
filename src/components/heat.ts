function mix(from: string, to: string, amount: number): string {
  const parse = (hex: string) => [1, 3, 5].map((index) => parseInt(hex.slice(index, index + 2), 16));
  const a = parse(from);
  const b = parse(to);
  const channels = a.map((channel, index) => Math.round(channel + (b[index] - channel) * amount));
  return `#${channels.map((channel) => channel.toString(16).padStart(2, "0")).join("")}`;
}

export function heatStyle(value: number, cap = 16): { background: string; color: string } {
  const t = Math.max(-1, Math.min(1, value / cap));
  const background = t >= 0 ? mix("#141414", "#e07a3d", Math.abs(t)) : mix("#141414", "#7eadd4", Math.abs(t));
  return { background, color: Math.abs(t) > 0.55 ? "#140e0a" : "#f4f1ea" };
}
