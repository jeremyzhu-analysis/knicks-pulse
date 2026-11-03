import type { Game } from "./load.ts";

/** A game's play-by-play replay is dropped when any player's replayed plus-minus is further than this from the box score. */
export const REPLAY_TOLERANCE = 8;

export interface LineupTotals {
  players: number[];
  seconds: number;
  ptsFor: number;
  ptsAgainst: number;
}

export interface Replay {
  ok: boolean;
  lineups: LineupTotals[];
}

const periodSeconds = (period: number) => (period <= 4 ? 720 : 300);

/** Plays where a listed player may not be on the floor. */
const OFF_FLOOR_PLAY = /technical|ejection|timeout|jumpball|jump ball/i;

/**
 * Rebuilds who was on the floor for the report team from substitutions.
 * ESPN doesn't list who starts the 2nd quarter onward, so each period's
 * five are inferred: players who appear before being subbed in, then
 * players still on the floor from the period before.
 */
export function replayGame(game: Game): Replay {
  const roster = new Set(game.players.map((p) => p.playerId));
  const lineups = new Map<string, LineupTotals>();
  let ok = true;
  let previousEnd: number[] = game.players.filter((p) => p.starter).map((p) => p.playerId);
  let lastHome = 0;
  let lastAway = 0;

  for (let period = 1; period <= game.periods; period++) {
    const plays = game.plays.filter((p) => p.period === period);
    const onFloor = new Set(period === 1 && previousEnd.length === 5 ? previousEnd : periodStarters(plays, roster, previousEnd));
    if (onFloor.size !== 5) ok = false;

    let clock = periodSeconds(period);
    let current = lineupEntry(lineups, onFloor);
    for (const play of plays) {
      current.seconds += Math.max(0, clock - play.clockSeconds);
      clock = play.clockSeconds;
      const dHome = play.homeScore - lastHome;
      const dAway = play.awayScore - lastAway;
      current.ptsFor += game.home ? dHome : dAway;
      current.ptsAgainst += game.home ? dAway : dHome;
      lastHome = play.homeScore;
      lastAway = play.awayScore;

      const [entering, leaving] = play.players;
      if (play.typeText === "Substitution" && entering && leaving && roster.has(entering)) {
        if (!onFloor.delete(leaving) || onFloor.has(entering)) ok = false;
        onFloor.add(entering);
        if (onFloor.size !== 5) ok = false;
        current = lineupEntry(lineups, onFloor);
      }
    }
    current.seconds += clock;
    previousEnd = [...onFloor];
  }

  const replayed = new Map<number, number>();
  for (const l of lineups.values()) {
    for (const id of l.players) replayed.set(id, (replayed.get(id) ?? 0) + l.ptsFor - l.ptsAgainst);
  }
  for (const p of game.players) {
    if (Math.abs((replayed.get(p.playerId) ?? 0) - p.plusMinus) > REPLAY_TOLERANCE) ok = false;
  }
  return { ok, lineups: [...lineups.values()] };
}

function lineupEntry(lineups: Map<string, LineupTotals>, onFloor: Set<number>): LineupTotals {
  const players = [...onFloor].sort((a, b) => a - b);
  const key = players.join(",");
  let entry = lineups.get(key);
  if (!entry) lineups.set(key, (entry = { players, seconds: 0, ptsFor: 0, ptsAgainst: 0 }));
  return entry;
}

function periodStarters(plays: Game["plays"], roster: Set<number>, previousEnd: number[]): number[] {
  const starters: number[] = [];
  const seen = new Set<number>();
  for (const play of plays) {
    if (starters.length === 5) break;
    if (play.typeText === "Substitution") {
      const [entering, leaving] = play.players;
      if (!entering || !leaving || !roster.has(entering)) continue;
      if (!seen.has(leaving)) starters.push(leaving);
      seen.add(leaving);
      seen.add(entering);
    } else if (!OFF_FLOOR_PLAY.test(play.typeText)) {
      for (const id of play.players) {
        if (id && roster.has(id) && !seen.has(id)) {
          starters.push(id);
          seen.add(id);
        }
      }
    }
  }
  for (const id of previousEnd) {
    if (starters.length >= 5) break;
    if (!seen.has(id)) {
      starters.push(id);
      seen.add(id);
    }
  }
  return starters.slice(0, 5);
}
