import assert from "node:assert/strict";
import { test } from "node:test";

import type { GameMoment } from "../schema.ts";
import { replayGame } from "./lineups.ts";
import type { BoxScore, Game, PlayerGame, PlayRow } from "./load.ts";

const IDS = [1, 2, 3, 4, 5, 6];

const playerLine = (id: number, plusMinus: number): PlayerGame => ({
  playerId: id,
  fullName: `Player ${id}`,
  position: null,
  starter: id <= 5,
  minutes: 0,
  pts: 0,
  fgm: 0,
  fga: 0,
  ftm: 0,
  fta: 0,
  oreb: 0,
  dreb: 0,
  reb: 0,
  ast: 0,
  stl: 0,
  blk: 0,
  tov: 0,
  pf: 0,
  plusMinus,
});

const play = (
  period: number,
  clock: number,
  kind: string,
  home: number,
  away: number,
  a: number,
  b: number,
): PlayRow => ({
  period,
  clockSeconds: clock,
  typeText: kind,
  homeScore: home,
  awayScore: away,
  players: [a, b, null],
  scoreValue: 0,
  shooting: false,
  pointsAttempted: 0,
  position: null,
});

/** A road game of `periods` periods; player 6 is the only substitute. */
function roadGame(periods: number, plays: PlayRow[], plusMinus: number[]): Game {
  const empty: BoxScore = {
    fgm: 0,
    fga: 0,
    fg3m: 0,
    fta: 0,
    oreb: 0,
    dreb: 0,
    tov: 0,
    paintPts: 0,
    fastBreakPts: 0,
    ptsOffTov: 0,
  };
  return {
    id: "1",
    seasonYear: 2027,
    seasonType: 2,
    startsAt: "1970-01-01T00:00:00Z",
    home: false,
    neutral: false,
    opponent: { id: 2, abbreviation: "OPP", name: "Opponent" },
    venue: null,
    attendance: null,
    note: null,
    periods,
    pts: 0,
    oppPts: 0,
    us: empty,
    them: empty,
    usByPeriod: [],
    themByPeriod: [],
    players: IDS.map((id, i) => playerLine(id, plusMinus[i]!)),
    opponentPlayers: [],
    plays,
  };
}

const at = (period: number, clockSeconds: number, us: number, them: number): GameMoment => ({
  period,
  clockSeconds,
  us,
  them,
});

test("stints follow substitutions from the report team's side", () => {
  const game = roadGame(
    1,
    [
      // The home team is the opponent here, so homeScore is "them".
      play(1, 600, "Jump Shot", 4, 10, 2, 0),
      play(1, 300, "Substitution", 4, 10, 6, 1),
      play(1, 100, "Jump Shot", 9, 10, 3, 0),
    ],
    [6, 1, 1, 1, 1, -5],
  );
  const replay = replayGame(game);
  assert.ok(replay.ok);
  assert.deepEqual(replay.stints.get(1), [{ from: at(1, 720, 0, 0), to: at(1, 300, 10, 4) }]);
  assert.deepEqual(replay.stints.get(6), [{ from: at(1, 300, 10, 4), to: at(1, 0, 10, 9) }]);
  const onFloor = (id: number) => replay.periods.get(id)![0];
  assert.deepEqual(onFloor(1), { seconds: 420, ptsFor: 10, ptsAgainst: 4 });
  assert.deepEqual(onFloor(6), { seconds: 300, ptsFor: 0, ptsAgainst: 5 });
  assert.deepEqual(onFloor(2), { seconds: 720, ptsFor: 10, ptsAgainst: 9 });
});

test("a stint runs across a period break when the player stays on", () => {
  const game = roadGame(
    2,
    [
      play(1, 300, "Jump Shot", 0, 2, 1, 0),
      play(2, 700, "Jump Shot", 0, 2, 1, 0),
      play(2, 650, "Jump Shot", 0, 2, 2, 0),
      play(2, 600, "Jump Shot", 0, 2, 3, 0),
      play(2, 550, "Jump Shot", 0, 2, 4, 0),
      play(2, 500, "Jump Shot", 0, 2, 5, 0),
    ],
    [2, 2, 2, 2, 2, 0],
  );
  assert.deepEqual(replayGame(game).stints.get(1), [{ from: at(1, 720, 0, 0), to: at(2, 0, 2, 0) }]);
});

test("a player in and out at the same stoppage has no stint", () => {
  const game = roadGame(
    1,
    [play(1, 300, "Substitution", 0, 0, 6, 1), play(1, 300, "Substitution", 0, 0, 1, 6)],
    [0, 0, 0, 0, 0, 0],
  );
  assert.ok(!replayGame(game).stints.has(6));
});
