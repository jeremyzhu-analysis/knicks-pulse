import assert from "node:assert/strict";
import { test } from "node:test";

import { int, jsonWithin, madeAttempted, parseClock, parseEspnDate, parseSchedule, parseSummary } from "./espn.ts";

test("int parses like parseInt", () => {
  assert.equal(int("12"), 12);
  assert.equal(int("+5"), 5);
  assert.equal(int("-12"), -12);
  assert.equal(int("  7 "), 7);
  assert.equal(int("12abc"), 12);
  assert.equal(int("4.9"), 4);
  assert.equal(int(""), 0);
  assert.equal(int("-"), 0);
  assert.equal(int("abc"), 0);
  assert.equal(int(null), 0);
});

test("madeAttempted splits", () => {
  assert.deepEqual(madeAttempted("37-75"), [37, 75]);
  assert.deepEqual(madeAttempted("0-0"), [0, 0]);
  assert.deepEqual(madeAttempted("5"), [5, 0]);
  assert.deepEqual(madeAttempted(null), [0, 0]);
});

test("parseClock reads both forms", () => {
  assert.equal(parseClock("11:24"), 684);
  assert.equal(parseClock("0:00"), 0);
  assert.equal(parseClock("45.2"), 45.2);
  assert.equal(parseClock(""), 0);
  assert.equal(parseClock("1:x"), 60);
  assert.equal(parseClock("inf"), 0);
});

test("parses ESPN dates without seconds", () => {
  assert.equal(parseEspnDate("2026-11-03T00:30Z").toString(), "2026-11-03T00:30:00Z");
  assert.equal(parseEspnDate("2026-11-03T00:30:15Z").toString(), "2026-11-03T00:30:15Z");
});

test("skips players who did not play even without a name", () => {
  const json = `{
    "header": {"season": {"year": 2026, "type": 2}, "gameNote": null, "competitions": [{
      "date": "2026-02-22T20:30Z", "neutralSite": true, "status": {"type": {"completed": true}},
      "competitors": [
        {"id": "18", "homeAway": "home", "score": "108", "linescores": [{"displayValue": "30"}],
         "team": {"id": "18", "abbreviation": "NY", "displayName": "New York Knicks", "name": "Knicks"}},
        {"id": "10", "homeAway": "away", "score": "106",
         "team": {"id": "10", "abbreviation": "HOU", "displayName": "Houston Rockets", "name": "Rockets"}}
      ]}]},
    "gameInfo": {"attendance": 19812},
    "plays": [
      {"type": {"text": "Jump Shot"}, "text": "Jalen Brunson makes 25-foot three point jumper", "period": {"number": 1},
       "clock": {"displayValue": "11:24"}, "team": {"id": "18"}, "homeScore": 3, "awayScore": 0,
       "participants": [{"athlete": {"id": "1"}}],
       "shootingPlay": true, "scoreValue": 3, "pointsAttempted": 3, "coordinate": {"x": 44, "y": 12}},
      {"type": {"text": "Free Throw - 1 of 2"}, "period": {"number": 1},
       "clock": {"displayValue": "10:02"}, "team": {"id": "18"}, "homeScore": 4, "awayScore": 0,
       "shootingPlay": true, "scoreValue": 1, "coordinate": {"x": -214748340, "y": -214748365}}
    ],
    "boxscore": {
      "teams": [
        {"team": {"id": "18"}, "statistics": [{"name": "fieldGoalsMade-fieldGoalsAttempted", "displayValue": "40-85"}]},
        {"team": {"id": "10"}, "statistics": []}
      ],
      "players": [{"team": {"id": "18"}, "statistics": [{"names": ["MIN", "PTS", "FG", "+/-"], "athletes": [
        {"athlete": {"id": "1", "displayName": "Jalen Brunson", "position": {"abbreviation": "G"}},
         "starter": true, "didNotPlay": false, "stats": ["36", "31", "11-22", "+5"]},
        {"athlete": {"shortName": "Olbrich"}, "starter": false, "didNotPlay": true, "stats": []}
      ]}]}]
    }
  }`;
  const game = parseSummary("1", JSON.parse(json));
  assert.equal(game.playerBoxes.length, 1);
  const p = game.playerBoxes[0]!;
  assert.deepEqual(
    [p.playerId, p.fullName, p.minutes, p.pts, p.fgm, p.fga, p.plusMinus],
    [1, "Jalen Brunson", 36, 31, 11, 22, 5],
  );
  assert.deepEqual([game.teamBoxes[0]!.pts, game.teamBoxes[0]!.fga], [108, 85]);
  assert.equal(game.periods.length, 1);
  assert.ok(game.venue === null && game.note === null);
  assert.deepEqual([game.neutral, game.attendance], [true, 19812]);
  const shot = game.plays[0]!;
  assert.deepEqual(
    [shot.shooting, shot.scoreValue, shot.pointsAttempted, shot.position],
    [true, 3, 3, { x: 44, y: 12 }],
  );
  const freeThrow = game.plays[1]!;
  assert.deepEqual([freeThrow.shooting, freeThrow.pointsAttempted, freeThrow.position], [true, 0, null]);
});

const summary = (teams: unknown[]) => ({
  header: {
    season: { year: 2027, type: 2 },
    competitions: [
      {
        date: "2026-11-03T00:30Z",
        status: { type: { completed: true } },
        competitors: [
          {
            id: "18",
            homeAway: "home",
            score: "100",
            team: { id: "18", abbreviation: "NY", displayName: "A", name: "A" },
          },
          {
            id: "2",
            homeAway: "away",
            score: "90",
            team: { id: "2", abbreviation: "BOS", displayName: "B", name: "B" },
          },
        ],
      },
    ],
  },
  boxscore: { teams },
});

test("refuses a summary without the stats of both teams", () => {
  const box = (id: string) => ({ team: { id }, statistics: [] });
  assert.equal(parseSummary("401", summary([box("18"), box("2")])).teamBoxes.length, 2);
  assert.throws(() => parseSummary("401", summary([])), /team stats/);
  assert.throws(() => parseSummary("401", summary([box("18")])), /team stats/);
  assert.throws(() => parseSummary("401", summary([box("18"), box("5")])), /team stats/);
  assert.throws(() => parseSummary("401", summary([box("18"), box("18")])), /team stats/);
});

test("refuses a schedule whose game id is not a number", () => {
  const schedule = (id: string) => ({
    requestedSeason: { year: 2027 },
    events: [{ id, competitions: [{ status: { type: { completed: true } } }] }],
  });
  assert.deepEqual(parseSchedule(schedule("401810001"), null).completedGames, [{ id: "401810001", note: null }]);
  for (const id of ["401&event=1", "../401", "0401", "4 01", "401\n", ""]) {
    assert.throws(() => parseSchedule(schedule(id), null), /game id/, JSON.stringify(id));
  }
});

test("stops reading an answer that is larger than allowed", async () => {
  assert.deepEqual(await jsonWithin(new Response('{"a":1}'), 7, "u"), { a: 1 });
  await assert.rejects(jsonWithin(new Response('{"a":12}'), 7, "u"), /larger than 7 bytes/);
  // Without a content-length the body is counted as it arrives.
  let sent = 0;
  const endless = new ReadableStream<Uint8Array>({
    pull(controller) {
      sent++;
      controller.enqueue(new Uint8Array(1024).fill(32));
    },
  });
  await assert.rejects(jsonWithin(new Response(endless), 4096, "u"), /larger than 4096 bytes/);
  assert.ok(sent < 20, `read ${sent} chunks`);
});
