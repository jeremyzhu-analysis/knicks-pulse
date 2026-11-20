import assert from "node:assert/strict";
import { test } from "node:test";

import { dayNumber, lastName, seasonLabel } from "./dates.ts";

test("labels seasons", () => {
  assert.equal(seasonLabel(2027, 2), "2026–27 regular season");
  assert.equal(seasonLabel(2026, 3), "2025–26 playoffs");
});

test("finds last names", () => {
  assert.equal(lastName("Kevin Porter Jr."), "Porter");
  assert.equal(lastName("Jalen Brunson"), "Brunson");
  assert.equal(lastName("Gary Payton II"), "Payton");
  assert.equal(lastName("Nene"), "Nene");
  assert.equal(lastName("V"), "V");
  assert.equal(lastName(""), "");
});

test("counts New York days", () => {
  // 00:30 UTC on Nov 3 is the evening of Nov 2 in New York.
  const late = dayNumber("2026-11-03T00:30:00Z");
  const early = dayNumber("2026-11-02T17:00:00Z");
  assert.equal(late, early);
  assert.equal(early, 20_759);
});
