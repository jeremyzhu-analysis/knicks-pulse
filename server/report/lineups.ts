import type { GameMoment, Stint } from "../schema.ts";
import type { Game, PlayRow } from "./load.ts";

/**
 * A game's play-by-play replay is dropped when any player's replayed
 * plus-minus is further than this from the box score.
 */
export const REPLAY_TOLERANCE = 8;

export type LineupTotals = {
  /** Ascending player ids. */
  players: number[];
  seconds: number;
  ptsFor: number;
  ptsAgainst: number;
};

/** A player's time on the floor in one period. */
export type FloorPeriod = { seconds: number; ptsFor: number; ptsAgainst: number };

export type Replay = {
  ok: boolean;
  /** In order of first appearance; float sums depend on it. */
  lineups: LineupTotals[];
  /** Each player's time on the floor by period, index 0 is Q1. */
  periods: Map<number, FloorPeriod[]>;
  /** Each player's time on the floor, oldest first. */
  stints: Map<number, Stint[]>;
};

const sameMoment = (a: GameMoment, b: GameMoment) =>
  a.period === b.period && a.clockSeconds === b.clockSeconds && a.us === b.us && a.them === b.them;

class StintLog {
  open = new Map<number, GameMoment>();
  done = new Map<number, Stint[]>();

  /**
   * A player already on the floor keeps the stint they're in, so a stint
   * runs across a period break when they stay on for it.
   */
  enter(id: number, at: GameMoment): void {
    if (!this.open.has(id)) this.open.set(id, at);
  }

  leave(id: number, at: GameMoment): void {
    const from = this.open.get(id);
    if (!from) return;
    this.open.delete(id);
    // ESPN lists every substitution at a stoppage, so a player can come in
    // and go out again without any time or points passing.
    if (!sameMoment(from, at)) {
      const list = this.done.get(id) ?? [];
      list.push({ from, to: at });
      this.done.set(id, list);
    }
  }

  leaveUnlessOn(onFloor: number[], at: GameMoment): void {
    for (const id of [...this.open.keys()]) {
      if (!onFloor.includes(id)) this.leave(id, at);
    }
  }
}

const periodSeconds = (period: number) => (period <= 4 ? 720 : 300);

/** Plays where a listed player may not be on the floor. */
function offFloorPlay(typeText: string): boolean {
  const text = typeText.toLowerCase();
  return ["technical", "ejection", "timeout", "jumpball", "jump ball"].some((word) => text.includes(word));
}

/** 0 and a missing id both mean "no player". */
const player = (id: number | null): number | null => (id === null || id === 0 ? null : id);

/**
 * Players on the floor are kept in the order they came on; that order decides
 * who fills the next period's five when substitutions don't say.
 */
function floorFrom(ids: number[]): number[] {
  const floor: number[] = [];
  for (const id of ids) if (!floor.includes(id)) floor.push(id);
  return floor;
}

class Lineups {
  list: LineupTotals[] = [];
  index = new Map<string, number>();

  entry(onFloor: number[]): number {
    const players = [...onFloor].sort((a, b) => a - b);
    const key = players.join(",");
    const found = this.index.get(key);
    if (found !== undefined) return found;
    this.list.push({ players, seconds: 0, ptsFor: 0, ptsAgainst: 0 });
    this.index.set(key, this.list.length - 1);
    return this.list.length - 1;
  }
}

/** What each lineup did in each period, in order of first appearance. */
class PeriodLog {
  list: { period: number; lineup: number; totals: FloorPeriod }[] = [];
  index = new Map<string, number>();

  entry(period: number, lineup: number): FloorPeriod {
    const key = `${period}:${lineup}`;
    let i = this.index.get(key);
    if (i === undefined) {
      this.list.push({ period, lineup, totals: { seconds: 0, ptsFor: 0, ptsAgainst: 0 } });
      i = this.list.length - 1;
      this.index.set(key, i);
    }
    return this.list[i]!.totals;
  }
}

/**
 * Rebuilds who was on the floor for the report team from substitutions.
 * ESPN doesn't list who starts the 2nd quarter onward, so each period's
 * five are inferred: players who appear before being subbed in, then
 * players still on the floor from the period before.
 */
export function replayGame(game: Game): Replay {
  const roster = new Set(game.players.map((p) => p.playerId));
  const lineups = new Lineups();
  const byPeriod = new PeriodLog();
  let ok = true;
  let previousEnd = game.players.filter((p) => p.starter).map((p) => p.playerId);
  let lastHome = 0;
  let lastAway = 0;
  const stints = new StintLog();
  const moment = (period: number, clockSeconds: number, home: number, away: number): GameMoment => ({
    period,
    clockSeconds,
    us: game.home ? home : away,
    them: game.home ? away : home,
  });

  for (let period = 1; period <= game.periods; period++) {
    const plays = game.plays.filter((p) => p.period === period);
    const onFloor =
      period === 1 && previousEnd.length === 5
        ? floorFrom(previousEnd)
        : floorFrom(periodStarters(plays, roster, previousEnd));
    if (onFloor.length !== 5) ok = false;

    stints.leaveUnlessOn(onFloor, moment(period - 1, 0, lastHome, lastAway));
    const periodStart = moment(period, periodSeconds(period), lastHome, lastAway);
    for (const id of onFloor) stints.enter(id, periodStart);

    let clock = periodSeconds(period);
    let current = lineups.entry(onFloor);
    for (const play of plays) {
      const seconds = Math.max(0, clock - play.clockSeconds);
      clock = play.clockSeconds;
      const dHome = play.homeScore - lastHome;
      const dAway = play.awayScore - lastAway;
      const ptsFor = game.home ? dHome : dAway;
      const ptsAgainst = game.home ? dAway : dHome;
      const entry = lineups.list[current]!;
      entry.seconds += seconds;
      entry.ptsFor += ptsFor;
      entry.ptsAgainst += ptsAgainst;
      const inPeriod = byPeriod.entry(period, current);
      inPeriod.seconds += seconds;
      inPeriod.ptsFor += ptsFor;
      inPeriod.ptsAgainst += ptsAgainst;
      lastHome = play.homeScore;
      lastAway = play.awayScore;

      const entering = player(play.players[0]);
      const leaving = player(play.players[1]);
      if (play.typeText === "Substitution" && entering !== null && leaving !== null && roster.has(entering)) {
        const at = onFloor.indexOf(leaving);
        if (at >= 0) onFloor.splice(at, 1);
        if (at < 0 || onFloor.includes(entering)) ok = false;
        if (!onFloor.includes(entering)) onFloor.push(entering);
        const now = moment(period, clock, lastHome, lastAway);
        stints.leave(leaving, now);
        stints.enter(entering, now);
        if (onFloor.length !== 5) ok = false;
        current = lineups.entry(onFloor);
      }
    }
    lineups.list[current]!.seconds += clock;
    byPeriod.entry(period, current).seconds += clock;
    previousEnd = onFloor;
  }

  stints.leaveUnlessOn([], moment(game.periods, 0, lastHome, lastAway));

  const replayed = new Map<number, number>();
  for (const l of lineups.list) {
    for (const id of l.players) replayed.set(id, (replayed.get(id) ?? 0) + l.ptsFor - l.ptsAgainst);
  }
  for (const p of game.players) {
    if (Math.abs((replayed.get(p.playerId) ?? 0) - p.plusMinus) > REPLAY_TOLERANCE) ok = false;
  }
  const periods = new Map<number, FloorPeriod[]>();
  for (const { period, lineup, totals } of byPeriod.list) {
    for (const id of lineups.list[lineup]!.players) {
      let ofPlayer = periods.get(id);
      if (!ofPlayer) {
        ofPlayer = Array.from({ length: Math.max(game.periods, 0) }, () => ({ seconds: 0, ptsFor: 0, ptsAgainst: 0 }));
        periods.set(id, ofPlayer);
      }
      const slot = ofPlayer[period - 1]!;
      slot.seconds += totals.seconds;
      slot.ptsFor += totals.ptsFor;
      slot.ptsAgainst += totals.ptsAgainst;
    }
  }
  return { ok, periods, lineups: lineups.list, stints: stints.done };
}

function periodStarters(plays: PlayRow[], roster: Set<number>, previousEnd: number[]): number[] {
  const starters: number[] = [];
  const seen = new Set<number>();
  for (const play of plays) {
    if (starters.length === 5) break;
    if (play.typeText === "Substitution") {
      const entering = player(play.players[0]);
      const leaving = player(play.players[1]);
      if (entering === null || leaving === null) continue;
      if (!roster.has(entering)) continue;
      if (!seen.has(leaving)) starters.push(leaving);
      seen.add(leaving);
      seen.add(entering);
    } else if (!offFloorPlay(play.typeText)) {
      for (const raw of play.players) {
        const id = player(raw);
        if (id !== null && roster.has(id) && !seen.has(id)) {
          seen.add(id);
          starters.push(id);
        }
      }
    }
  }
  for (const id of previousEnd) {
    if (starters.length >= 5) break;
    if (!seen.has(id)) {
      seen.add(id);
      starters.push(id);
    }
  }
  return starters.slice(0, 5);
}
