const ET = "America/New_York";

export function signed(value: number, digits = 1): string {
  if (!Number.isFinite(value)) return "\u2014";
  const abs = Math.abs(value).toFixed(digits);
  if (value > 0) return `+${abs}`;
  if (value < 0) return `\u2212${abs}`;
  return (0).toFixed(digits);
}

export function fixed(value: number, digits = 1): string {
  if (!Number.isFinite(value)) return "\u2014";
  return value.toFixed(digits);
}

export function pct(value: number, digits = 1): string {
  if (!Number.isFinite(value)) return "\u2014";
  return `${(value * 100).toFixed(digits)}%`;
}

export function record(wins: number, losses: number): string {
  return `${wins}\u2013${losses}`;
}

export function prettySeason(season: string): string {
  return season.replace("-", "\u2013");
}

export function etDate(iso: string, withYear = true): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  const formatted = new Intl.DateTimeFormat("en-US", {
    timeZone: ET,
    month: "short",
    day: "numeric",
    year: withYear ? "numeric" : undefined,
  }).format(date);
  return formatted.replace(/^([A-Za-z]+)/, "$1.");
}

export function etDateTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  const formatted = new Intl.DateTimeFormat("en-US", {
    timeZone: ET,
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  }).format(date);
  return formatted.replace(/^([A-Za-z]+)/, "$1.").replace(" AM", " a.m.").replace(" PM", " p.m.");
}

export function etDayKey(iso: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: ET,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(iso));
}

export function daysBetween(earlier: string, later: string): number {
  const [ay, am, ad] = earlier.split("-").map(Number);
  const [by, bm, bd] = later.split("-").map(Number);
  return Math.round((Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad)) / 86400000);
}

export function lastName(name: string): string {
  const parts = name.trim().split(/\s+/);
  return parts[parts.length - 1] || name;
}

export function place(home: boolean, neutral: boolean): string {
  if (neutral) return "vs.";
  return home ? "vs." : "at";
}
