export const NEW_YORK = "America/New_York";

const EPOCH = Temporal.PlainDate.from("1970-01-01");

/** Calendar day in New York as days since 1970-01-01, for counting days of rest. `at` is ISO 8601 in UTC. */
export function dayNumber(at: string): number {
  const date = Temporal.Instant.from(at).toZonedDateTimeISO(NEW_YORK).toPlainDate();
  return EPOCH.until(date, { largestUnit: "days" }).days;
}

/** 2027 + type 3 -> "2026–27 playoffs" */
export function seasonLabel(seasonYear: number, seasonType: number): string {
  const short = String(seasonYear).slice(2);
  const kind = seasonType === 3 ? "playoffs" : "regular season";
  return `${seasonYear - 1}–${short} ${kind}`;
}

const SUFFIXES = ["jr", "jr.", "sr", "sr.", "ii", "iii", "iv", "v"];

/** "Kevin Porter Jr." -> "Porter" */
export function lastName(fullName: string): string {
  const words = fullName.split(/\s+/).filter((word) => word !== "");
  while (words.length > 1 && SUFFIXES.includes(words.at(-1)!.toLowerCase())) words.pop();
  return words.at(-1) ?? fullName;
}
