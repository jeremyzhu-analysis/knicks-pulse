import assert from "node:assert/strict";
import { test } from "node:test";

import type { QuarterRow, Ratings } from "../schema.ts";
import { headline, roundName } from "./compute.ts";

const rated = (games: number, offense: number, defense: number): Ratings => ({
  games,
  wins: 0,
  losses: 0,
  margin: 0,
  offense,
  defense,
  net: offense - defense,
  pace: 0,
  scored: 0,
  allowed: 0,
});

const quarter = (quarter: number, margin: number, lastMargin: number | null): QuarterRow => ({
  quarter,
  scored: 0,
  allowed: 0,
  margin,
  ahead: 0,
  behind: 0,
  tied: 0,
  lastMargin,
});

test("headline takes the largest change", () => {
  const was = rated(82, 115, 112);
  assert.deepEqual(headline(rated(10, 118, 113), null, []), { kind: "games", games: 10 });
  assert.deepEqual(headline(rated(10, 118, 113), was, []), { kind: "offense", change: 3 });
  assert.deepEqual(headline(rated(10, 116, 108), was, []), { kind: "defense", change: -4 });
  const quarters = [quarter(1, 0.5, 0), quarter(3, -4, 2.5)];
  assert.deepEqual(headline(rated(10, 118, 113), was, quarters), {
    kind: "quarter",
    quarter: 3,
    margin: -4,
    was: 2.5,
  });
  // One game is too few for a quarter to lead.
  assert.deepEqual(headline(rated(1, 118, 113), was, quarters), { kind: "offense", change: 3 });
  // Equal changes: offense comes before defense.
  assert.deepEqual(headline(rated(10, 117, 114), was, []), { kind: "offense", change: 2 });
  assert.deepEqual(headline(rated(10, 115.5, 112.5), was, []), { kind: "net", net: 3, was: 3 });
});

test("round names", () => {
  assert.equal(roundName("NBA Finals - Game 5"), "Finals");
  assert.equal(roundName("East 1st Round - Game 7"), "East 1st Round");
  assert.equal(roundName("East Semifinals -game 12"), "East Semifinals");
  assert.equal(roundName("NBA Cup Final"), "Cup Final");
  assert.equal(roundName("NBAX - Game 1"), "NBAX");
  assert.equal(roundName("Game 3"), "Game 3");
  assert.equal(roundName(" - Game 3"), null);
  assert.equal(roundName(""), null);
  assert.equal(roundName(null), null);
});
