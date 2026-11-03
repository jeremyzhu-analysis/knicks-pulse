const MINUS = "−";
const TIME_ZONE = "America/New_York";

/** +1.2, −0.4, 0.0 */
export function signed(value: number, digits = 1): string {
  const text = Math.abs(value).toFixed(digits);
  if (Number(text) === 0) return text;
  return (value > 0 ? "+" : MINUS) + text;
}

export function fixed(value: number, digits = 1): string {
  const text = value.toFixed(digits);
  return text.startsWith("-") ? MINUS + text.slice(1) : text;
}

export function percent(ratio: number): string {
  return `${(ratio * 100).toFixed(1)}%`;
}

export function record(wins: number, losses: number): string {
  return `${wins}–${losses}`;
}

/** 2027 + type 3 -> "2026–27 playoffs" */
export function seasonLabel(seasonYear: number, seasonType: number): string {
  const span = `${seasonYear - 1}–${String(seasonYear).slice(2)}`;
  return `${span} ${seasonType === 3 ? "playoffs" : "regular season"}`;
}

const AP_MONTHS = ["Jan.", "Feb.", "March", "April", "May", "June", "July", "Aug.", "Sept.", "Oct.", "Nov.", "Dec."];

function parts(date: Date) {
  const values = new Intl.DateTimeFormat("en-US", {
    timeZone: TIME_ZONE, year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "2-digit", timeZoneName: "short",
  }).formatToParts(date);
  const get = (type: string) => values.find((p) => p.type === type)?.value ?? "";
  return {
    year: get("year"), month: Number(get("month")), day: get("day"),
    hour: get("hour"), minute: get("minute"), dayPeriod: get("dayPeriod"), zone: get("timeZoneName"),
  };
}

/** Oct. 30 (New York time) */
export function shortDate(date: Date): string {
  const p = parts(date);
  return `${AP_MONTHS[p.month - 1]} ${p.day}`;
}

/** Oct. 30, 2026 */
export function longDate(date: Date): string {
  return `${shortDate(date)}, ${parts(date).year}`;
}

/** Nov. 1, 2026, 10:26 a.m. EST */
export function dateTime(date: Date): string {
  const p = parts(date);
  const period = p.dayPeriod.toLowerCase() === "am" ? "a.m." : "p.m.";
  return `${longDate(date)}, ${p.hour}:${p.minute} ${period} ${p.zone}`;
}

/** Calendar day in New York, for counting days of rest. */
export function dayNumber(date: Date): number {
  const p = parts(date);
  return Date.UTC(Number(p.year), p.month - 1, Number(p.day)) / 86_400_000;
}

const SUFFIXES = new Set(["jr", "jr.", "sr", "sr.", "ii", "iii", "iv", "v"]);

/** "Kevin Porter Jr." -> "Porter" */
export function lastName(fullName: string): string {
  const words = fullName.trim().split(/\s+/);
  while (words.length > 1 && SUFFIXES.has(words.at(-1)!.toLowerCase())) words.pop();
  return words.at(-1) ?? fullName;
}

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}
