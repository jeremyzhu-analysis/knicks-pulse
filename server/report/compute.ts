// Every number on the page. Sums run left to right from 0 in a fixed order
// (games by date, lineups in order of first appearance); a different order
// changes the last digits of the results. Objects list their properties in
// the order the API sends them.

import type {
  Champion,
  Factor,
  Factors,
  GameMoment,
  GamePlayer,
  GameSide,
  Headline,
  Impact,
  ImpactKind,
  ImpactTone,
  LastSeries,
  PairCell,
  PairExtreme,
  PlayerQuarter,
  PlayerReport,
  PlayerRow,
  QuarterRow,
  Ratings,
  Rolling,
  Shooter,
  Shot,
  ShotMap,
  Situation,
  Split,
} from "../schema.ts";
import { dayNumber, lastName, seasonLabel } from "./dates.ts";
import { replayGame, type FloorPeriod, type Replay } from "./lineups.ts";
import type { BoxScore, Dataset, Game, PlayerGame } from "./load.ts";

// ---------------------------------------------------------------- basics

function sum<T>(items: readonly T[], value: (item: T) => number): number {
  let total = 0;
  for (const item of items) total += value(item);
  return total;
}

const ratio = (a: number, b: number) => (b === 0 ? 0 : a / b);

function count<T>(items: readonly T[], test: (item: T) => boolean): number {
  let n = 0;
  for (const item of items) if (test(item)) n++;
  return n;
}

/** Possessions per team, averaging both teams' estimates. */
export function possessions(game: Game): number {
  const estimate = (b: BoxScore) => b.fga + 0.44 * b.fta - b.oreb + b.tov;
  return (estimate(game.us) + estimate(game.them)) / 2;
}

const gameMinutes = (game: Game) => 48 + 5 * Math.max(game.periods - 4, 0);

export const margin = (game: Game) => game.pts - game.oppPts;

export const won = (game: Game) => game.pts > game.oppPts;

export function ratings(games: readonly Game[]): Ratings {
  const n = games.length;
  const poss = sum(games, possessions);
  const offense = ratio(100 * sum(games, (g) => g.pts), poss);
  const defense = ratio(100 * sum(games, (g) => g.oppPts), poss);
  const wins = count(games, won);
  return {
    games: n,
    wins,
    losses: n - wins,
    margin: ratio(sum(games, margin), n),
    offense,
    defense,
    net: offense - defense,
    pace: ratio(48 * poss, sum(games, gameMinutes)),
    scored: ratio(sum(games, (g) => g.pts), n),
    allowed: ratio(sum(games, (g) => g.oppPts), n),
  };
}

/** The margin chart's running averages, in games. */
const ROLLING_WINDOWS = [5, 10];
/** The running average starts at this game of a season. */
const ROLLING_FIRST_GAME = 3;

export function rollingMargins(games: readonly Game[]): Rolling[] {
  return ROLLING_WINDOWS.map((window) => ({
    window,
    values: games.map((_, i) => {
      const played = i + 1;
      const last = games.slice(Math.max(played - window, 0), played);
      return played >= ROLLING_FIRST_GAME ? sum(last, margin) / last.length : null;
    }),
  }));
}

// ---------------------------------------------------------------- seasons

export type Season = {
  key: string;
  year: number;
  seasonType: number;
  label: string;
  games: Game[];
  ratings: Ratings;
};

function groupSeasons(games: readonly Game[]): Season[] {
  // A Map keeps its keys in order of first appearance.
  const map = new Map<string, Game[]>();
  for (const game of games) {
    const key = `${game.seasonYear}:${game.seasonType}`;
    const list = map.get(key);
    if (list) list.push(game);
    else map.set(key, [game]);
  }
  const seasons = [...map].map(([key, list]): Season => {
    const first = list[0]!;
    return {
      key,
      year: first.seasonYear,
      seasonType: first.seasonType,
      label: seasonLabel(first.seasonYear, first.seasonType),
      games: list,
      ratings: ratings(list),
    };
  });
  return seasons.sort((a, b) => b.year - a.year || a.seasonType - b.seasonType);
}

// ---------------------------------------------------------------- four factors

type Side = "us" | "them";

type FactorRows = {
  efg: number;
  tov: number;
  orb: number;
  ftr: number;
  paint: number;
  fastBreak: number;
  offTov: number;
};

function factorRows(games: readonly Game[], side: Side): FactorRows {
  const own = (g: Game) => (side === "us" ? g.us : g.them);
  const other = (g: Game) => (side === "us" ? g.them : g.us);
  const n = games.length;
  const total = (f: (own: BoxScore, other: BoxScore) => number) => sum(games, (g) => f(own(g), other(g)));
  return {
    efg: ratio(
      total((o) => o.fgm + 0.5 * o.fg3m),
      total((o) => o.fga),
    ),
    tov: ratio(
      total((o) => o.tov),
      total((o) => o.fga + 0.44 * o.fta + o.tov),
    ),
    orb: ratio(
      total((o) => o.oreb),
      total((o, x) => o.oreb + x.dreb),
    ),
    ftr: ratio(
      total((o) => o.fta),
      total((o) => o.fga),
    ),
    paint: ratio(
      total((o) => o.paintPts),
      n,
    ),
    fastBreak: ratio(
      total((o) => o.fastBreakPts),
      n,
    ),
    offTov: ratio(
      total((o) => o.ptsOffTov),
      n,
    ),
  };
}

export function factors(now: readonly Game[], was: readonly Game[]): Factors {
  const build = (side: Side, prefix: string, offense: boolean): Factor[] => {
    const a = factorRows(now, side);
    const b = factorRows(was, side);
    const row = (
      label: string,
      pick: (rows: FactorRows) => number,
      isPercent: boolean,
      higherIsGoodForShooter: boolean,
    ): Factor => ({
      label: prefix === "" ? label : `${prefix} ${label.slice(0, 1).toLowerCase()}${label.slice(1)}`,
      now: pick(a),
      was: pick(b),
      isPercent,
      higherHelps: offense ? higherIsGoodForShooter : !higherIsGoodForShooter,
    });
    return [
      row("Effective field-goal %", (r) => r.efg, true, true),
      row("Turnover rate", (r) => r.tov, true, false),
      row("Offensive rebound rate", (r) => r.orb, true, true),
      row("Free-throw rate", (r) => r.ftr, true, true),
      row("Points in the paint", (r) => r.paint, false, true),
      row("Fast-break points", (r) => r.fastBreak, false, true),
      row("Points off turnovers", (r) => r.offTov, false, true),
    ];
  };
  return { offense: build("us", "", true), defense: build("them", "Opponent", false) };
}

// ---------------------------------------------------------------- quarters

const periodPts = (list: readonly number[], q: number) => list[q] ?? 0;

const quarterDiff = (g: Game, q: number) => periodPts(g.usByPeriod, q) - periodPts(g.themByPeriod, q);

const quarterMargin = (games: readonly Game[], q: number) =>
  ratio(
    sum(games, (g) => quarterDiff(g, q)),
    games.length,
  );

export function quarters(now: readonly Game[], was: readonly Game[] | null): QuarterRow[] {
  return [0, 1, 2, 3].map((q) => {
    const diffs = now.map((g) => quarterDiff(g, q));
    return {
      quarter: q + 1,
      scored: ratio(
        sum(now, (g) => periodPts(g.usByPeriod, q)),
        now.length,
      ),
      allowed: ratio(
        sum(now, (g) => periodPts(g.themByPeriod, q)),
        now.length,
      ),
      margin: quarterMargin(now, q),
      ahead: count(diffs, (d) => d > 0),
      behind: count(diffs, (d) => d < 0),
      tied: count(diffs, (d) => d === 0),
      lastMargin: was && was.length > 0 ? quarterMargin(was, q) : null,
    };
  });
}

// ---------------------------------------------------------------- headline

/** A change smaller than this doesn't make the headline. */
const HEADLINE_MIN_CHANGE = 1;
/** A quarter's margin can make the headline from this many games. */
const HEADLINE_QUARTER_GAMES = 2;

/**
 * What the hero leads with: the largest change among offense, defense and
 * each quarter's margin; the earlier of two equal ones, in that order.
 */
export function headline(now: Ratings, was: Ratings | null, quarters: readonly QuarterRow[]): Headline {
  if (!was || was.games <= 0) return { kind: "games", games: now.games };
  const offense = now.offense - was.offense;
  const defense = now.defense - was.defense;
  const stories: [number, Headline][] = [
    [Math.abs(offense), { kind: "offense", change: offense }],
    [Math.abs(defense), { kind: "defense", change: defense }],
  ];
  if (now.games >= HEADLINE_QUARTER_GAMES) {
    for (const q of quarters) {
      if (q.lastMargin !== null) {
        stories.push([
          Math.abs(q.margin - q.lastMargin),
          { kind: "quarter", quarter: q.quarter, margin: q.margin, was: q.lastMargin },
        ]);
      }
    }
  }
  let best = stories[0]!;
  for (const story of stories.slice(1)) if (story[0] > best[0]) best = story;
  return best[0] >= HEADLINE_MIN_CHANGE ? best[1] : { kind: "net", net: now.net, was: was.net };
}

// ---------------------------------------------------------------- situations

function split(games: readonly Game[]): Split | null {
  if (games.length === 0) return null;
  const r = ratings(games);
  return { games: r.games, wins: r.wins, losses: r.losses, margin: r.margin, net: r.net };
}

function situationGames(games: readonly Game[]): [string, Game[]][] {
  // Days of rest and the previous result, for every game but the first.
  const restOf: (number | null)[] = games.map(() => null);
  const after: (boolean | null)[] = games.map(() => null);
  for (let i = 1; i < games.length; i++) {
    const previous = games[i - 1]!;
    restOf[i] = dayNumber(games[i]!.startsAt) - dayNumber(previous.startsAt) - 1;
    after[i] = won(previous);
  }
  const pick = (test: (i: number) => boolean) => games.filter((_, i) => test(i));
  const rest = (test: (days: number) => boolean) =>
    pick((i) => {
      const days = restOf[i] ?? null;
      return days !== null && test(days);
    });
  return [
    ["Home", pick((i) => games[i]!.home && !games[i]!.neutral)],
    ["Road", pick((i) => !games[i]!.home && !games[i]!.neutral)],
    ["Back-to-back", rest((d) => d === 0)],
    ["One day off", rest((d) => d === 1)],
    ["Two or more days off", rest((d) => d >= 2)],
    ["After a win", pick((i) => after[i] === true)],
    ["After a loss", pick((i) => after[i] === false)],
  ];
}

export function situations(now: readonly Game[], was: readonly Game[] | null): Situation[] {
  const last = was ? situationGames(was) : null;
  return situationGames(now).map(([label, games], i) => ({
    label,
    now: split(games),
    last: last ? split(last[i]![1]) : null,
  }));
}

// ---------------------------------------------------------------- players and pairs

/** Thresholds for the impact label. Per-game numbers unless named per 36. */
const IMPACT = {
  lowMinutes: 60,
  dragOnOff: -9,
  liftOnOff: 8,
  twoWayPts: 10,
  twoWayStocks: 2,
  scoringPts: 12,
  scoringPer36: 15,
  scoringTs: 0.56,
  creationAstPer36: 6,
  creationAstPerTov: 2,
  disruptionStlPer36: 1.6,
  rimBlkPer36: 1.5,
  reboundingPer36: 9,
};

export const PAIR_MIN_SECONDS = 8 * 60;
const PAIR_PLAYERS = 8;

const per48 = (points: number, seconds: number) => (seconds === 0 ? 0 : (points / seconds) * 2880);

type ImpactInput = Pick<PlayerRow, "gp" | "minutes" | "ppg" | "rpg" | "apg" | "spg" | "bpg" | "topg" | "ts">;

function impactOf(p: ImpactInput, onOff: number | null): Impact {
  const per36 = (value: number) => ratio(value * p.gp * 36, p.minutes);
  const make = (kind: ImpactKind, tone: ImpactTone): Impact => ({ kind, tone });
  if (p.minutes < IMPACT.lowMinutes) return make("lowMinutes", "muted");
  if (onOff !== null && onOff <= IMPACT.dragOnOff) return make("lineupDrag", "drag");
  if (p.ppg >= IMPACT.twoWayPts && p.spg + p.bpg >= IMPACT.twoWayStocks) return make("twoWay", "lift");
  if (p.ppg >= IMPACT.scoringPts || (per36(p.ppg) >= IMPACT.scoringPer36 && p.ts >= IMPACT.scoringTs)) {
    return make("scoring", "score");
  }
  if (per36(p.apg) >= IMPACT.creationAstPer36 && p.apg >= IMPACT.creationAstPerTov * p.topg) {
    return make("creation", "score");
  }
  if (onOff !== null && onOff >= IMPACT.liftOnOff) return make("lineupLift", "lift");
  if (per36(p.spg) >= IMPACT.disruptionStlPer36) return make("disruption", "muted");
  if (per36(p.bpg) >= IMPACT.rimBlkPer36) return make("rimProtection", "muted");
  if (per36(p.rpg) >= IMPACT.reboundingPer36) return make("rebounding", "muted");
  return make("mixed", "muted");
}

type FloorTime = { seconds: number; ptsFor: number; ptsAgainst: number };

const noFloorTime = (): FloorTime => ({ seconds: 0, ptsFor: 0, ptsAgainst: 0 });

function addFloorTime(to: FloorTime, seconds: number, ptsFor: number, ptsAgainst: number): void {
  to.seconds += seconds;
  to.ptsFor += ptsFor;
  to.ptsAgainst += ptsAgainst;
}

function entry<K, V>(map: Map<K, V>, key: K, make: () => V): V {
  let value = map.get(key);
  if (value === undefined) {
    value = make();
    map.set(key, value);
  }
  return value;
}

/** A possession ends with a shot, a trip to the line or a turnover. */
const possessionsUsed = (fga: number, fta: number, tov: number) => fga + 0.44 * fta + tov;

/**
 * The player's share of the team's possessions in one game, in percent,
 * scaled to the time they were on the floor.
 */
function usage(p: PlayerGame, game: Game): number {
  let teamMinutes = 0;
  for (const line of game.players) teamMinutes += line.minutes;
  const team = possessionsUsed(game.us.fga, game.us.fta, game.us.tov);
  if (p.minutes <= 0 || team <= 0) return 0;
  return (100 * possessionsUsed(p.fga, p.fta, p.tov) * (teamMinutes / 5)) / (p.minutes * team);
}

/** Each game's points by period (by player id), by game id. */
export type PeriodPoints = Map<string, Map<number, number[]>>;

/** One quarter of a player's season, summed over games. */
type QuarterTotals = {
  /** Games whose play-by-play adds up to the player's points. */
  scoredGames: number;
  pts: number;
  /** Replayed games the player appeared in. */
  floorGames: number;
  floor: FloorPeriod;
};

export function playerReport(
  games: readonly Game[],
  replays: Map<string, Replay>,
  points: PeriodPoints,
): PlayerReport {
  const usable = (game: Game): Replay | null => {
    const replay = replays.get(game.id);
    return replay?.ok ? replay : null;
  };
  const team = noFloorTime();
  const on = new Map<number, FloorTime>();
  const together = new Map<string, FloorTime>();
  let replayedGames = 0;
  for (const game of games) {
    const replay = usable(game);
    if (!replay) continue;
    replayedGames++;
    for (const l of replay.lineups) {
      addFloorTime(team, l.seconds, l.ptsFor, l.ptsAgainst);
      for (const a of l.players) {
        addFloorTime(entry(on, a, noFloorTime), l.seconds, l.ptsFor, l.ptsAgainst);
        for (const b of l.players) {
          if (a >= b) continue;
          addFloorTime(entry(together, `${a}:${b}`, noFloorTime), l.seconds, l.ptsFor, l.ptsAgainst);
        }
      }
    }
  }

  // A Map keeps players in order of first appearance; it breaks ties in the minutes sort below.
  const byId = new Map<number, PlayerGame[]>();
  const usageMinutes = new Map<number, number>();
  const quarterTotals = new Map<number, QuarterTotals[]>();
  for (const game of games) {
    const replay = usable(game);
    const gamePoints = points.get(game.id);
    for (const p of game.players) {
      entry(byId, p.playerId, () => []).push(p);
      usageMinutes.set(p.playerId, (usageMinutes.get(p.playerId) ?? 0) + usage(p, game) * p.minutes);
      const totals = entry(quarterTotals, p.playerId, () =>
        [0, 1, 2, 3].map(() => ({ scoredGames: 0, pts: 0, floorGames: 0, floor: noFloorTime() })),
      );
      const scored = gamePoints?.get(p.playerId);
      const floor = replay?.periods.get(p.playerId);
      totals.forEach((total, q) => {
        if (scored) {
          total.scoredGames++;
          total.pts += scored[q] ?? 0;
        }
        if (floor) {
          const f = floor[q] ?? noFloorTime();
          total.floorGames++;
          total.floor.seconds += f.seconds;
          total.floor.ptsFor += f.ptsFor;
          total.floor.ptsAgainst += f.ptsAgainst;
        }
      });
    }
  }

  const players = [...byId].map(([id, lines]): PlayerRow => {
    const first = lines[0]!;
    const gp = lines.length;
    const total = (f: (line: PlayerGame) => number) => sum(lines, f);
    const minutes = total((l) => l.minutes);
    const floor = on.get(id);
    const offSeconds = team.seconds - (floor ? floor.seconds : 0);
    const split = floor && floor.seconds > 0 && offSeconds > 0 ? floor : null;
    const quarters = quarterTotals.get(id)!.map(
      (t, q): PlayerQuarter => ({
        quarter: q + 1,
        pts: t.scoredGames > 0 ? t.pts / t.scoredGames : null,
        plusMinus: t.floorGames > 0 ? (t.floor.ptsFor - t.floor.ptsAgainst) / t.floorGames : null,
        opp48: t.floor.seconds > 0 ? per48(t.floor.ptsAgainst, t.floor.seconds) : null,
      }),
    );
    const on48 = split ? per48(split.ptsFor - split.ptsAgainst, split.seconds) : null;
    const off48 = split
      ? per48(team.ptsFor - split.ptsFor - (team.ptsAgainst - split.ptsAgainst), offSeconds)
      : null;
    const onOff = on48 !== null && off48 !== null ? on48 - off48 : null;
    const rates = {
      gp,
      minutes,
      mpg: minutes / gp,
      ppg: total((l) => l.pts) / gp,
      rpg: total((l) => l.reb) / gp,
      apg: total((l) => l.ast) / gp,
      spg: total((l) => l.stl) / gp,
      bpg: total((l) => l.blk) / gp,
      topg: total((l) => l.tov) / gp,
      ts: ratio(
        total((l) => l.pts),
        2 * total((l) => l.fga + 0.44 * l.fta),
      ),
    };
    return {
      id,
      name: first.fullName,
      last: lastName(first.fullName),
      position: first.position,
      ...rates,
      usg: ratio(usageMinutes.get(id)!, minutes),
      plusMinus: total((l) => l.plusMinus) / gp,
      on48,
      off48,
      team48On: split ? per48(split.ptsFor, split.seconds) : null,
      team48Off: split ? per48(team.ptsFor - split.ptsFor, offSeconds) : null,
      opp48: split ? per48(split.ptsAgainst, split.seconds) : null,
      opp48Off: split ? per48(team.ptsAgainst - split.ptsAgainst, offSeconds) : null,
      quarters,
      onOff,
      previousOnOff: null,
      impact: impactOf(rates, onOff),
    };
  });
  players.sort((a, b) => b.minutes - a.minutes);

  const top = players.slice(0, PAIR_PLAYERS);
  const cell = (f: FloorTime | undefined): PairCell | null =>
    f && f.seconds >= PAIR_MIN_SECONDS
      ? { seconds: f.seconds, net48: per48(f.ptsFor - f.ptsAgainst, f.seconds) }
      : null;
  const cells = top.map((a) =>
    top.map((b) =>
      a.id === b.id ? cell(on.get(a.id)) : cell(together.get(`${Math.min(a.id, b.id)}:${Math.max(a.id, b.id)}`)),
    ),
  );
  let best: PairExtreme | null = null;
  let worst: PairExtreme | null = null;
  top.forEach((a, i) => {
    top.forEach((b, j) => {
      const c = j > i ? cells[i]![j]! : null;
      if (!c) return;
      const extreme = (): PairExtreme => ({ a: a.last, b: b.last, cell: c });
      if (!best || c.net48 > best.cell.net48) best = extreme();
      if (!worst || c.net48 < worst.cell.net48) worst = extreme();
    });
  });

  return {
    players,
    pairs: { players: top.map((p) => ({ id: p.id, last: p.last })), cells, best, worst },
    replayedGames,
  };
}

// ---------------------------------------------------------------- one game

/**
 * The score after every scoring play, from the opening tip at 0-0. Points
 * are added up from the plays and given to the scorer's team: ESPN's running
 * score on a play is sometimes a point off the final.
 */
export function flow(game: Game): GameMoment[] {
  const ours = new Set(game.players.map((p) => p.playerId));
  const moments: GameMoment[] = [{ period: 1, clockSeconds: 720, us: 0, them: 0 }];
  let us = 0;
  let them = 0;
  for (const play of game.plays) {
    const scorer = play.players[0];
    if (scorer === null || play.scoreValue <= 0) continue;
    if (ours.has(scorer)) us += play.scoreValue;
    else them += play.scoreValue;
    moments.push({ period: play.period, clockSeconds: play.clockSeconds, us, them });
  }
  return moments;
}

/** One team's game: the four factors and where its points came from. Returns [the report team, its opponent]. */
export function gameSides(game: Game, flow: readonly GameMoment[]): [GameSide, GameSide] {
  const build = (side: Side, own: BoxScore, lead: (m: GameMoment) => number): GameSide => {
    const rates = factorRows([game], side);
    return {
      efg: rates.efg,
      tov: rates.tov,
      orb: rates.orb,
      ftr: rates.ftr,
      paint: own.paintPts,
      fastBreak: own.fastBreakPts,
      offTov: own.ptsOffTov,
      // From the play-by-play; 0 for a team that never led.
      largestLead: Math.max(0, ...flow.map(lead)),
    };
  };
  return [
    build("us", game.us, (m) => m.us - m.them),
    build("them", game.them, (m) => m.them - m.us),
  ];
}

/** John Hollinger's game score: a box-score line as one number, on the scale of points. */
export function gameScore(p: PlayerGame): number {
  return (
    p.pts +
    0.4 * p.fgm -
    0.7 * p.fga -
    0.4 * (p.fta - p.ftm) +
    0.7 * p.oreb +
    0.3 * p.dreb +
    p.stl +
    0.7 * p.ast +
    0.7 * p.blk -
    0.4 * p.pf -
    p.tov
  );
}

/**
 * Each player's points by period (index 0 is Q1), from the play-by-play.
 * A player is left out when their plays don't add up to their box-score
 * points, so a wrong split is never shown.
 */
export function pointsByPeriod(game: Game): Map<number, number[]> {
  const periods = Math.max(game.periods, 0);
  const zeros = (): number[] => new Array(periods).fill(0);
  const byPlayer = new Map<number, number[]>();
  for (const play of game.plays) {
    const scorer = play.players[0];
    if (scorer === null || play.scoreValue <= 0) continue;
    const slot = play.period - 1;
    if (slot < 0 || slot >= periods) continue;
    const list = entry(byPlayer, scorer, zeros);
    list[slot] = list[slot]! + play.scoreValue;
  }
  const checked = new Map<number, number[]>();
  for (const p of [...game.players, ...game.opponentPlayers]) {
    const points = byPlayer.get(p.playerId) ?? zeros();
    byPlayer.delete(p.playerId);
    if (sum(points, (n) => n) === p.pts) checked.set(p.playerId, points);
  }
  return checked;
}

/**
 * Starters first, then by minutes. `replay` is the report team's; pass null
 * for the opponent's players.
 */
export function gamePlayers(
  players: readonly PlayerGame[],
  pointsByPeriod: Map<number, number[]>,
  replay: Replay | null,
): GamePlayer[] {
  const list = players.map((p): GamePlayer => {
    const shots = p.fga + 0.44 * p.fta;
    return {
      id: p.playerId,
      name: p.fullName,
      position: p.position,
      starter: p.starter,
      minutes: p.minutes,
      pts: p.pts,
      reb: p.reb,
      ast: p.ast,
      stl: p.stl,
      blk: p.blk,
      tov: p.tov,
      ts: shots > 0 ? p.pts / (2 * shots) : null,
      plusMinus: p.plusMinus,
      gameScore: gameScore(p),
      pointsByPeriod: pointsByPeriod.get(p.playerId) ?? null,
      stints: (replay?.ok ? replay.stints.get(p.playerId) : undefined) ?? [],
    };
  });
  return list.sort((a, b) => Number(b.starter) - Number(a.starter) || b.minutes - a.minutes);
}

// ---------------------------------------------------------------- shots

// The half court the shot map draws, in ESPN's feet: x across the floor, y
// out from the basket. Attempts from outside it (heaves from the backcourt)
// are left off the map and out of its counts.
const SHOT_X = [-2, 52] as const;
const SHOT_Y = [-8, 45] as const;

const within = (value: number, [low, high]: readonly [number, number]) => value >= low && value <= high;

/** The report team's field-goal attempts of one season. */
export function shotMap(key: string, games: readonly Game[]): ShotMap {
  const shots: Shot[] = [];
  const players: Shooter[] = [];
  for (const game of games) {
    for (const play of game.plays) {
      const shooter = play.players[0];
      const at = play.position;
      if (shooter === null || at === null) continue;
      if (!play.shooting || play.pointsAttempted < 2 || !within(at.x, SHOT_X) || !within(at.y, SHOT_Y)) continue;
      const line = game.players.find((p) => p.playerId === shooter);
      if (!line) continue;
      const made = play.scoreValue > 0;
      let entry = players.find((p) => p.id === shooter);
      if (!entry) {
        entry = { id: shooter, last: lastName(line.fullName), makes: 0, attempts: 0 };
        players.push(entry);
      }
      entry.attempts++;
      if (made) entry.makes++;
      shots.push({ p: shooter, x: at.x, y: at.y, made, value: play.pointsAttempted, period: play.period });
    }
  }
  players.sort((a, b) => b.attempts - a.attempts);
  return {
    key,
    players,
    makes: sum(players, (p) => p.makes),
    attempts: sum(players, (p) => p.attempts),
    shots,
  };
}

// ---------------------------------------------------------------- report

export type SeasonReport = { season: Season; playerReport: PlayerReport };

/** The title takes four wins in the Finals. */
const FINALS_WINS = 4;

/** Compares ASCII letters without regard to case and every other character exactly. */
function equalsIgnoringAsciiCase(a: string, b: string): boolean {
  const lower = (text: string) => text.replace(/[A-Z]/g, (letter) => letter.toLowerCase());
  return lower(a) === lower(b);
}

/** The most recent playoffs whose "NBA Finals" games the team won. */
function champion(seasons: readonly SeasonReport[]): Champion | null {
  for (const playoffs of seasons) {
    if (playoffs.season.seasonType !== 3) continue;
    const finals = playoffs.season.games.filter(
      (g) => g.note !== null && equalsIgnoringAsciiCase(g.note.slice(0, "NBA Finals".length), "NBA Finals"),
    );
    const wins = count(finals, won);
    const losses = finals.length - wins;
    if (wins >= FINALS_WINS && wins > losses) {
      return { wins, losses, opponent: finals.at(-1)?.opponent.name ?? "" };
    }
  }
  return null;
}

export type Computed = {
  gameCount: number;
  replayedGames: number;
  /** Most recent first: current regular season, then older ones. */
  seasons: SeasonReport[];
  /** Indexes into `seasons`. */
  current: number | null;
  lastRegular: number | null;
  latestGame: Game | null;
  lastSeries: LastSeries | null;
  champion: Champion | null;
  points: PeriodPoints;
};

/** "NBA Finals - Game 5" -> "Finals" */
export function roundName(note: string | null): string | null {
  if (note === null || note === "") return null;
  const withoutGame = stripGameSuffix(note) ?? note;
  const withoutNba =
    withoutGame.startsWith("NBA") && /^\s/.test(withoutGame.slice(3)) ? withoutGame.slice(3).trimStart() : withoutGame;
  const round = withoutNba.trim();
  return round === "" ? null : round;
}

/** Removes a trailing `\s*-\s*Game \d+` (ASCII case-insensitive), if there is one. */
function stripGameSuffix(note: string): string | null {
  const beforeDigits = note.replace(/[0-9]+$/, "");
  if (beforeDigits.length === note.length) return null;
  const game = beforeDigits.length - "game ".length;
  if (game < 0 || !equalsIgnoringAsciiCase(beforeDigits.slice(game), "game ")) return null;
  const beforeGame = beforeDigits.slice(0, game).trimEnd();
  if (!beforeGame.endsWith("-")) return null;
  return beforeGame.slice(0, -1).trimEnd();
}

export function buildReport(data: Dataset): Computed {
  const replays = new Map(data.games.map((g) => [g.id, replayGame(g)]));
  const points: PeriodPoints = new Map(data.games.map((g) => [g.id, pointsByPeriod(g)]));
  const seasons = groupSeasons(data.games).map(
    (season): SeasonReport => ({ season, playerReport: playerReport(season.games, replays, points) }),
  );
  const regular = seasons.flatMap((s, i) => (s.season.seasonType === 2 ? [i] : []));
  const current = regular[0] ?? (seasons.length === 0 ? null : 0);
  let lastRegular: number | null = null;
  if (current !== null) {
    const year = seasons[current]!.season.year;
    lastRegular = regular.find((i) => seasons[i]!.season.year === year - 1) ?? null;
  }

  if (current !== null && lastRegular !== null) {
    const before = new Map(seasons[lastRegular]!.playerReport.players.map((p) => [p.id, p.onOff]));
    for (const p of seasons[current]!.playerReport.players) p.previousOnOff = before.get(p.id) ?? null;
  }

  let lastSeries: LastSeries | null = null;
  const playoffs = seasons.find((s) => s.season.seasonType === 3);
  const finalGame = playoffs?.season.games.at(-1);
  if (playoffs && finalGame) {
    const series = playoffs.season.games.filter((g) => g.opponent.id === finalGame.opponent.id);
    const wins = count(series, won);
    lastSeries = {
      round: roundName(finalGame.note) ?? "Playoffs",
      wins,
      losses: series.length - wins,
      opponent: finalGame.opponent.name,
    };
  }

  return {
    gameCount: data.games.length,
    replayedGames: count([...replays.values()], (r) => r.ok),
    seasons,
    current,
    lastRegular,
    latestGame: data.games.at(-1) ?? null,
    lastSeries,
    champion: champion(seasons),
    points,
  };
}
