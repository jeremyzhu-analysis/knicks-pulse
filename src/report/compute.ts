import type { Box, Dataset, Game } from "./load.ts";
import { replayGame, type Replay } from "./lineups.ts";
import { dayNumber, lastName, seasonLabel } from "./format.ts";

// ---------------------------------------------------------------- basics

const sum = <T>(items: T[], value: (item: T) => number) => items.reduce((total, item) => total + value(item), 0);
const ratio = (a: number, b: number) => (b === 0 ? 0 : a / b);

/** Possessions per team, averaging both teams' estimates. */
export function possessions(game: Game): number {
  const estimate = (b: Box) => b.fga + 0.44 * b.fta - b.oreb + b.tov;
  return (estimate(game.us) + estimate(game.them)) / 2;
}

const gameMinutes = (game: Game) => 48 + 5 * Math.max(0, game.periods - 4);
export const margin = (game: Game) => game.pts - game.oppPts;
export const won = (game: Game) => game.pts > game.oppPts;

export interface Ratings {
  games: number;
  wins: number;
  losses: number;
  margin: number;
  offense: number;
  defense: number;
  net: number;
  pace: number;
  scored: number;
  allowed: number;
}

export function ratings(games: Game[]): Ratings {
  const poss = sum(games, possessions);
  const offense = ratio(100 * sum(games, (g) => g.pts), poss);
  const defense = ratio(100 * sum(games, (g) => g.oppPts), poss);
  const wins = games.filter(won).length;
  return {
    games: games.length,
    wins,
    losses: games.length - wins,
    margin: ratio(sum(games, margin), games.length),
    offense,
    defense,
    net: offense - defense,
    pace: ratio(48 * poss, sum(games, gameMinutes)),
    scored: ratio(sum(games, (g) => g.pts), games.length),
    allowed: ratio(sum(games, (g) => g.oppPts), games.length),
  };
}

// ---------------------------------------------------------------- seasons

export interface Season {
  key: string;
  year: number;
  type: number;
  label: string;
  games: Game[];
  ratings: Ratings;
}

function groupSeasons(games: Game[]): Season[] {
  const map = new Map<string, Game[]>();
  for (const game of games) {
    const key = `${game.seasonYear}:${game.seasonType}`;
    map.set(key, [...(map.get(key) ?? []), game]);
  }
  return [...map.entries()]
    .map(([key, list]) => {
      const first = list[0]!;
      return {
        key,
        year: first.seasonYear,
        type: first.seasonType,
        label: seasonLabel(first.seasonYear, first.seasonType),
        games: list,
        ratings: ratings(list),
      };
    })
    .sort((a, b) => b.year - a.year || a.type - b.type);
}

// ---------------------------------------------------------------- four factors

export interface Factor {
  label: string;
  now: number;
  was: number;
  isPercent: boolean;
  /** True when a higher value is good for the report team. */
  higherHelps: boolean;
}

function factorRows(games: Game[], side: "us" | "them") {
  const own = (g: Game) => g[side];
  const other = (g: Game) => g[side === "us" ? "them" : "us"];
  const n = games.length;
  return {
    efg: ratio(sum(games, (g) => own(g).fgm + 0.5 * own(g).fg3m), sum(games, (g) => own(g).fga)),
    tov: ratio(sum(games, (g) => own(g).tov), sum(games, (g) => own(g).fga + 0.44 * own(g).fta + own(g).tov)),
    orb: ratio(sum(games, (g) => own(g).oreb), sum(games, (g) => own(g).oreb + other(g).dreb)),
    ftr: ratio(sum(games, (g) => own(g).fta), sum(games, (g) => own(g).fga)),
    paint: ratio(sum(games, (g) => own(g).paintPts), n),
    fastBreak: ratio(sum(games, (g) => own(g).fastBreakPts), n),
    offTov: ratio(sum(games, (g) => own(g).ptsOffTov), n),
  };
}

export function factors(now: Game[], was: Game[]): { offense: Factor[]; defense: Factor[] } {
  const build = (side: "us" | "them", prefix: string, offense: boolean): Factor[] => {
    const a = factorRows(now, side);
    const b = factorRows(was, side);
    const row = (label: string, key: keyof typeof a, isPercent: boolean, higherIsGoodForShooter: boolean): Factor => ({
      label: prefix ? `${prefix} ${label.charAt(0).toLowerCase()}${label.slice(1)}` : label,
      now: a[key],
      was: b[key],
      isPercent,
      higherHelps: offense ? higherIsGoodForShooter : !higherIsGoodForShooter,
    });
    return [
      row("Effective field-goal %", "efg", true, true),
      row("Turnover rate", "tov", true, false),
      row("Offensive rebound rate", "orb", true, true),
      row("Free-throw rate", "ftr", true, true),
      row("Points in the paint", "paint", false, true),
      row("Fast-break points", "fastBreak", false, true),
      row("Points off turnovers", "offTov", false, true),
    ];
  };
  return { offense: build("us", "", true), defense: build("them", "Opponent", false) };
}

// ---------------------------------------------------------------- quarters

export interface QuarterRow {
  quarter: number;
  scored: number;
  allowed: number;
  margin: number;
  ahead: number;
  behind: number;
  tied: number;
  lastMargin: number | null;
}

function quarterMargin(games: Game[], q: number): number {
  return ratio(sum(games, (g) => (g.usByPeriod[q] ?? 0) - (g.themByPeriod[q] ?? 0)), games.length);
}

export function quarters(now: Game[], was: Game[] | null): QuarterRow[] {
  return [0, 1, 2, 3].map((q) => {
    const diffs = now.map((g) => (g.usByPeriod[q] ?? 0) - (g.themByPeriod[q] ?? 0));
    return {
      quarter: q + 1,
      scored: ratio(sum(now, (g) => g.usByPeriod[q] ?? 0), now.length),
      allowed: ratio(sum(now, (g) => g.themByPeriod[q] ?? 0), now.length),
      margin: quarterMargin(now, q),
      ahead: diffs.filter((d) => d > 0).length,
      behind: diffs.filter((d) => d < 0).length,
      tied: diffs.filter((d) => d === 0).length,
      lastMargin: was?.length ? quarterMargin(was, q) : null,
    };
  });
}

// ---------------------------------------------------------------- situations

export interface Split {
  games: number;
  wins: number;
  losses: number;
  margin: number;
  net: number;
}

export interface Situation {
  label: string;
  now: Split | null;
  last: Split | null;
}

function split(games: Game[]): Split | null {
  if (games.length === 0) return null;
  const r = ratings(games);
  return { games: r.games, wins: r.wins, losses: r.losses, margin: r.margin, net: r.net };
}

function situationGames(games: Game[]) {
  const restOf = new Map<Game, number>();
  const after = new Map<Game, boolean>();
  games.forEach((game, i) => {
    const previous = games[i - 1];
    if (!previous) return;
    restOf.set(game, dayNumber(game.startsAt) - dayNumber(previous.startsAt) - 1);
    after.set(game, won(previous));
  });
  const rest = (test: (days: number) => boolean) => games.filter((g) => restOf.has(g) && test(restOf.get(g)!));
  return [
    { label: "Home", games: games.filter((g) => g.home) },
    { label: "Road", games: games.filter((g) => !g.home) },
    { label: "Back-to-back", games: rest((d) => d === 0) },
    { label: "One day off", games: rest((d) => d === 1) },
    { label: "Two or more days off", games: rest((d) => d >= 2) },
    { label: "After a win", games: games.filter((g) => after.get(g) === true) },
    { label: "After a loss", games: games.filter((g) => after.get(g) === false) },
  ];
}

export function situations(now: Game[], was: Game[] | null): Situation[] {
  const last = was ? situationGames(was) : null;
  return situationGames(now).map((s, i) => ({ label: s.label, now: split(s.games), last: last ? split(last[i]!.games) : null }));
}

// ---------------------------------------------------------------- players and pairs

/** Thresholds for the impact label. Per-game numbers unless named per 36. */
export const IMPACT = {
  lowMinutes: 60,
  smallSampleGames: 10,
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

export type ImpactTone = "score" | "lift" | "drag" | "muted";

export interface PlayerRow {
  id: number;
  name: string;
  last: string;
  position: string | null;
  gp: number;
  minutes: number;
  mpg: number;
  ppg: number;
  rpg: number;
  apg: number;
  spg: number;
  bpg: number;
  topg: number;
  ts: number;
  plusMinus: number;
  /** Net points per 48 with the player on and off the floor; null without a usable replay. */
  on48: number | null;
  off48: number | null;
  opp48: number | null;
  impact: { label: string; tone: ImpactTone; title: string };
}

export interface PairCell {
  seconds: number;
  net48: number;
}

export interface Pairs {
  players: { id: number; last: string }[];
  /** cells[i][j]; the diagonal is the player alone. null under the minute floor. */
  cells: (PairCell | null)[][];
  best: { a: string; b: string; cell: PairCell } | null;
  worst: { a: string; b: string; cell: PairCell } | null;
}

export const PAIR_MIN_SECONDS = 8 * 60;
const PAIR_PLAYERS = 8;

const per48 = (points: number, seconds: number) => (seconds === 0 ? 0 : (points / seconds) * 2880);

function impactOf(p: Omit<PlayerRow, "impact">, onOff: number | null): PlayerRow["impact"] {
  const per36 = (value: number) => ratio(value * p.gp * 36, p.minutes);
  const games = `${p.gp} game${p.gp === 1 ? "" : "s"}`;
  if (p.minutes < IMPACT.lowMinutes) return { label: "Low minutes", tone: "muted", title: `${p.last}: ${p.minutes} min, ${games}.` };

  const fmt = (v: number) => (v > 0 ? "+" : v < 0 ? "−" : "") + Math.abs(v).toFixed(1);
  const floor =
    p.on48 === null || p.off48 === null ? "" : ` On ${fmt(p.on48)}, off ${fmt(p.off48)}. Opp ${p.opp48!.toFixed(1)}/48.`;
  const sample = p.gp < IMPACT.smallSampleGames ? ` The sample is ${games}.` : "";
  const make = (label: string, tone: ImpactTone, lead: string) => ({ label, tone, title: `${p.last}: ${lead}.${floor}${sample}` });

  if (onOff !== null && onOff <= IMPACT.dragOnOff) return make("Lineup drag", "drag", "lineup drag");
  if (p.ppg >= IMPACT.twoWayPts && p.spg + p.bpg >= IMPACT.twoWayStocks) {
    return make("Two-way", "lift", `${p.ppg.toFixed(1)} pts, ${p.spg.toFixed(1)} stl, ${p.bpg.toFixed(1)} blk`);
  }
  if (p.ppg >= IMPACT.scoringPts || (per36(p.ppg) >= IMPACT.scoringPer36 && p.ts >= IMPACT.scoringTs)) {
    return make("Scoring", "score", `${p.ppg.toFixed(1)} pts, ${(p.ts * 100).toFixed(1)}% TS`);
  }
  if (per36(p.apg) >= IMPACT.creationAstPer36 && p.apg >= IMPACT.creationAstPerTov * p.topg) {
    return make("Creation", "score", `${p.apg.toFixed(1)} ast, ${p.topg.toFixed(1)} tov`);
  }
  if (onOff !== null && onOff >= IMPACT.liftOnOff) return make("Lineup lift", "lift", "lineup lift");
  if (per36(p.spg) >= IMPACT.disruptionStlPer36) return make("Disruption", "muted", `${p.spg.toFixed(1)} stl`);
  if (per36(p.bpg) >= IMPACT.rimBlkPer36) return make("Rim protection", "muted", `${p.bpg.toFixed(1)} blk`);
  if (per36(p.rpg) >= IMPACT.reboundingPer36) return make("Rebounding", "muted", `${p.rpg.toFixed(1)} reb`);
  return make("Mixed", "muted", `${p.ppg.toFixed(1)} / ${p.rpg.toFixed(1)} / ${p.apg.toFixed(1)}`);
}

interface Floor {
  seconds: number;
  ptsFor: number;
  ptsAgainst: number;
}

const emptyFloor = (): Floor => ({ seconds: 0, ptsFor: 0, ptsAgainst: 0 });
const addFloor = (f: Floor, l: Floor) => {
  f.seconds += l.seconds;
  f.ptsFor += l.ptsFor;
  f.ptsAgainst += l.ptsAgainst;
};

export interface PlayerReport {
  players: PlayerRow[];
  pairs: Pairs;
  replayedGames: number;
}

export function playerReport(games: Game[], replays: Map<string, Replay>): PlayerReport {
  const team = emptyFloor();
  const on = new Map<number, Floor>();
  const together = new Map<string, Floor>();
  let replayedGames = 0;
  for (const game of games) {
    const replay = replays.get(game.id);
    if (!replay?.ok) continue;
    replayedGames++;
    for (const l of replay.lineups) {
      addFloor(team, l);
      for (const a of l.players) {
        if (!on.has(a)) on.set(a, emptyFloor());
        addFloor(on.get(a)!, l);
        for (const b of l.players) {
          if (a >= b) continue;
          const key = `${a}-${b}`;
          if (!together.has(key)) together.set(key, emptyFloor());
          addFloor(together.get(key)!, l);
        }
      }
    }
  }

  const byId = new Map<number, Game["players"]>();
  for (const game of games) for (const p of game.players) byId.set(p.playerId, [...(byId.get(p.playerId) ?? []), p]);

  const players = [...byId.entries()]
    .map(([id, lines]): PlayerRow => {
      const first = lines[0]!;
      const gp = lines.length;
      const total = (f: (l: (typeof lines)[number]) => number) => sum(lines, f);
      const minutes = total((l) => l.minutes);
      const floor = on.get(id);
      const offSeconds = team.seconds - (floor?.seconds ?? 0);
      const hasSplit = floor !== undefined && floor.seconds > 0 && offSeconds > 0;
      const base = {
        id,
        name: first.fullName,
        last: lastName(first.fullName),
        position: first.position,
        gp,
        minutes,
        mpg: minutes / gp,
        ppg: total((l) => l.pts) / gp,
        rpg: total((l) => l.reb) / gp,
        apg: total((l) => l.ast) / gp,
        spg: total((l) => l.stl) / gp,
        bpg: total((l) => l.blk) / gp,
        topg: total((l) => l.tov) / gp,
        ts: ratio(total((l) => l.pts), 2 * total((l) => l.fga + 0.44 * l.fta)),
        plusMinus: total((l) => l.plusMinus) / gp,
        on48: hasSplit ? per48(floor.ptsFor - floor.ptsAgainst, floor.seconds) : null,
        off48: hasSplit ? per48(team.ptsFor - floor.ptsFor - (team.ptsAgainst - floor.ptsAgainst), offSeconds) : null,
        opp48: hasSplit ? per48(floor.ptsAgainst, floor.seconds) : null,
      };
      const onOff = base.on48 !== null && base.off48 !== null ? base.on48 - base.off48 : null;
      return { ...base, impact: impactOf(base, onOff) };
    })
    .sort((a, b) => b.minutes - a.minutes);

  const top = players.slice(0, PAIR_PLAYERS);
  const cell = (f: Floor | undefined): PairCell | null =>
    f && f.seconds >= PAIR_MIN_SECONDS ? { seconds: f.seconds, net48: per48(f.ptsFor - f.ptsAgainst, f.seconds) } : null;
  const cells = top.map((a) =>
    top.map((b) => (a.id === b.id ? cell(on.get(a.id)) : cell(together.get(a.id < b.id ? `${a.id}-${b.id}` : `${b.id}-${a.id}`)))),
  );
  let best: Pairs["best"] = null;
  let worst: Pairs["worst"] = null;
  top.forEach((a, i) =>
    top.forEach((b, j) => {
      const c = cells[i]![j];
      if (j <= i || !c) return;
      if (!best || c.net48 > best.cell.net48) best = { a: a.last, b: b.last, cell: c };
      if (!worst || c.net48 < worst.cell.net48) worst = { a: a.last, b: b.last, cell: c };
    }),
  );

  return {
    players,
    pairs: { players: top.map((p) => ({ id: p.id, last: p.last })), cells, best, worst },
    replayedGames,
  };
}

// ---------------------------------------------------------------- report

export interface SeasonReport extends Season {
  playerReport: PlayerReport;
}

export interface Report {
  syncedAt: Date | null;
  gameCount: number;
  replayedGames: number;
  /** Most recent first: current regular season, then older ones. */
  seasons: SeasonReport[];
  current: SeasonReport | null;
  lastRegular: SeasonReport | null;
  latestGame: Game | null;
  lastSeries: { round: string; wins: number; losses: number; opponent: string } | null;
}

/** "NBA Finals - Game 5" -> "Finals" */
function roundName(note: string | null): string | null {
  if (!note) return null;
  return note.replace(/\s*-\s*Game \d+$/i, "").replace(/^NBA\s+/, "").trim() || null;
}

export function buildReport(data: Dataset): Report {
  const replays = new Map(data.games.map((g) => [g.id, replayGame(g)]));
  const seasons: SeasonReport[] = groupSeasons(data.games).map((s) => ({ ...s, playerReport: playerReport(s.games, replays) }));
  const regular = seasons.filter((s) => s.type === 2);
  const current = regular[0] ?? seasons[0] ?? null;
  const lastRegular = regular.find((s) => current && s.year === current.year - 1) ?? null;

  let lastSeries: Report["lastSeries"] = null;
  const playoffs = seasons.find((s) => s.type === 3);
  const finalGame = playoffs?.games.at(-1);
  if (playoffs && finalGame) {
    const series = playoffs.games.filter((g) => g.opponent.id === finalGame.opponent.id);
    const wins = series.filter(won).length;
    lastSeries = {
      round: roundName(finalGame.note) ?? "Playoffs",
      wins,
      losses: series.length - wins,
      opponent: finalGame.opponent.name,
    };
  }

  return {
    syncedAt: data.syncedAt,
    gameCount: data.games.length,
    replayedGames: [...replays.values()].filter((r) => r.ok).length,
    seasons,
    current,
    lastRegular,
    latestGame: data.games.at(-1) ?? null,
    lastSeries,
  };
}
