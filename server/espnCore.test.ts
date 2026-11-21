import assert from "node:assert/strict";
import { test } from "node:test";

import { build, coreGameSummary } from "./espnCore.ts";
import type { Side } from "./espnCore.ts";

function stats(category: string, values: [string, number][]): unknown {
  return {
    splits: { categories: [{ name: category, stats: values.map(([name, value]) => ({ name, value })) }] },
  };
}

function side(homeAway: string, id: number, abbreviation: string, score: number): Side {
  return {
    competitor: { id: String(id), homeAway },
    team: { id: String(id), abbreviation, displayName: `Team ${abbreviation}`, name: abbreviation },
    statistics: stats("offensive", [
      ["fieldGoalsMade", 37.0],
      ["fieldGoalsAttempted", 86.0],
      ["turnovers", 13.0],
    ]),
    linescores: { items: [{ value: 33.0 }, { value: 32.0 }] },
    score: { value: score },
    players: [],
  };
}

test("builds a game from core documents", () => {
  const home = side("home", 18, "NY", 119.0);
  home.players.push({
    entry: { playerId: 3934672, starter: true, didNotPlay: false, displayName: "Brunson" },
    athlete: { displayName: "Jalen Brunson", position: { abbreviation: "G" } },
    statistics: stats("general", [
      ["minutes", 34.0],
      ["plusMinus", 6.0],
      ["fouls", 3.0],
    ]),
  });
  const game = build("401809234", 2026, 2, "note", {
    competition: {
      date: "2025-10-22T23:00Z",
      attendance: 19812,
      neutralSite: false,
      venue: { fullName: "Madison Square Garden" },
    },
    plays: [
      {
        type: { text: "Jump Shot" },
        text: "Evan Mobley makes 11-foot two point shot",
        awayScore: 2,
        homeScore: 0,
        period: { number: 1 },
        clock: { displayValue: "11:45" },
        scoreValue: 2,
        shootingPlay: true,
        pointsAttempted: 2,
        coordinate: { x: 26, y: 12 },
        team: { $ref: "http://sports.core.api.espn.com/v2/sports/basketball/leagues/nba/seasons/2026/teams/5?lang=en" },
        participants: [
          { order: 2, athlete: { $ref: "http://x/seasons/2026/athletes/22?lang=en" } },
          { order: 1, athlete: { $ref: "http://x/seasons/2026/athletes/4432158?lang=en" } },
        ],
      },
    ],
    sides: [side("away", 5, "CLE", 111.0), home],
  });

  assert.deepEqual([game.home.id, game.away.id], [18, 5]);
  assert.deepEqual([game.homeScore, game.awayScore], [119, 111]);
  assert.equal(game.startsAt.toString(), "2025-10-22T23:00:00Z");
  assert.equal(game.venue, "Madison Square Garden");
  assert.deepEqual([game.neutral, game.attendance], [false, 19812]);
  assert.deepEqual([game.seasonYear, game.seasonType], [2026, 2]);
  const knicks = game.teamBoxes[0]!;
  assert.deepEqual([knicks.teamId, knicks.pts, knicks.fgm, knicks.fga, knicks.tov], [18, 119, 37, 86, 13]);
  assert.equal(game.periods.length, 4);
  assert.deepEqual([game.periods[1]!.period, game.periods[1]!.pts], [2, 32]);
  const p = game.playerBoxes[0]!;
  assert.deepEqual([p.playerId, p.fullName, p.position, p.starter], [3934672, "Jalen Brunson", "G", true]);
  assert.deepEqual([p.minutes, p.plusMinus, p.pf, p.teamId], [34, 6, 3, 18]);
  const play = game.plays[0]!;
  assert.equal(play.teamId, 5);
  assert.deepEqual(play.players, [4432158, 22, null]);
  assert.deepEqual([play.clockSeconds, play.awayScore], [705, 2]);
  assert.deepEqual(
    [play.shooting, play.scoreValue, play.pointsAttempted, play.position],
    [true, 2, 2, { x: 26, y: 12 }],
  );
});

test("stops asking for play pages at a fixed number", async () => {
  let pages = 0;
  const getJson = async (url: string) => {
    if (!url.includes("/plays?")) return {};
    pages++;
    return { items: [{}], pageCount: 500 };
  };
  await assert.rejects(coreGameSummary(getJson, "401", 2027, 2, null), /more than \d+ pages of plays/);
  assert.ok(pages <= 20, `asked for ${pages} pages`);
});

test("refuses a competitor id that is not a number", async () => {
  const asked: string[] = [];
  const getJson = async (url: string) => {
    asked.push(url);
    if (url.includes("/plays?")) return { items: [], pageCount: 1 };
    return { competitors: [{ id: "1/../../x", team: { $ref: "http://sports.core.api.espn.com/t" } }] };
  };
  await assert.rejects(coreGameSummary(getJson, "401", 2027, 2, null), /competitor id/);
  assert.ok(!asked.some((url) => url.includes("..")));
});
