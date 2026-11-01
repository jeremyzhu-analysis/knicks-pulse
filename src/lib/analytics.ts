import { gameLengthSeconds, quarterLabel, quarterName } from "@/lib/clock";
import { daysBetween, etDayKey, lastName, prettySeason, record, signed } from "@/lib/format";
import {
  efg,
  freeThrowRate,
  gameScore,
  netPer48,
  offensiveRating,
  per48,
  possessions,
  reboundRate,
  trueShooting,
  turnoverRate,
  usageRate,
} from "@/lib/metrics";
import type { Game, Phase, PlayerGame, Store, TeamBox } from "@/lib/types";

export interface Ratings {
  games: number;
  wins: number;
  losses: number;
  ptsFor: number;
  ptsAgainst: number;
  margin: number;
  ortg: number;
  drtg: number;
  net: number;
  pace: number;
  efg: number;
  tovPct: number;
  orbPct: number;
  ftRate: number;
  oppEfg: number;
  oppTovPct: number;
  oppOrbPct: number;
  oppFtRate: number;
  paint: number;
  fastBreak: number;
  pointsOffTurnovers: number;
  oppPaint: number;
  oppFastBreak: number;
  oppPointsOffTurnovers: number;
}

export interface QuarterSummary {
  period: number;
  label: string;
  name: string;
  games: number;
  knicks: number;
  opponent: number;
  margin: number;
  won: number;
  lost: number;
  tied: number;
}

export interface Situation {
  id: string;
  label: string;
  games: number;
  wins: number;
  losses: number;
  margin: number;
  ortg: number;
  drtg: number;
  net: number;
}

export interface GameStub {
  id: string;
  season: string;
  phase: Phase;
  series: string | null;
  date: string;
  opponentAbbr: string;
  opponentName: string;
  home: boolean;
  neutral: boolean;
  win: boolean;
  knicksScore: number;
  opponentScore: number;
  margin: number;
  ortg: number;
  drtg: number;
  net: number;
  venue: string;
  quarters: { period: number; label: string; knicks: number; opponent: number; margin: number }[];
  backToBack: boolean;
  restDays: number | null;
  previousWin: boolean | null;
}

export interface PlayerQuarterRollup {
  period: number;
  label: string;
  games: number;
  pts: number;
  plusMinus: number;
  onNet48: number | null;
  oppPts48: number | null;
}

export interface PlayerRollup {
  id: string;
  name: string;
  shortName: string;
  position: string;
  jersey: string;
  season: string;
  phase: Phase;
  games: number;
  starts: number;
  minutes: number;
  mpg: number;
  pts: number;
  reb: number;
  ast: number;
  stl: number;
  blk: number;
  tov: number;
  plusMinus: number;
  pmPerGame: number;
  ts: number;
  efg: number;
  usg: number;
  gameScore: number;
  onNet48: number | null;
  offNet48: number | null;
  onOff: number | null;
  teamPts48On: number | null;
  teamPts48Off: number | null;
  oppPts48On: number | null;
  oppPts48Off: number | null;
  quarters: PlayerQuarterRollup[];
  impact: { kind: string; title: string; sentence: string };
}

export interface FactorRow {
  group: string;
  label: string;
  current: string;
  previous: string;
  delta: string;
  shift: number | null;
  tone: "good" | "bad" | "flat" | "none";
}

export interface PairPlayer {
  id: string;
  name: string;
  minutes: number;
  net48: number | null;
}

export interface PairCell {
  a: string;
  b: string;
  minutes: number;
  net48: number;
}

export interface PairBoard {
  id: string;
  label: string;
  players: PairPlayer[];
  cells: PairCell[];
  note: string;
}

export interface SeasonView {
  season: string;
  phase: Phase;
  label: string;
  ratings: Ratings;
  quarters: QuarterSummary[];
  situations: Situation[];
  games: GameStub[];
}

export interface LatestView {
  id: string;
  date: string;
  opponentName: string;
  opponentAbbr: string;
  home: boolean;
  neutral: boolean;
  win: boolean;
  knicksScore: number;
  opponentScore: number;
  venue: string;
  series: string | null;
  quarters: GameStub["quarters"];
  note: string;
  players: {
    id: string;
    name: string;
    shortName: string;
    pts: number;
    reb: number;
    ast: number;
    plusMinus: number;
    minutes: number;
    gameScore: number;
  }[];
}

export interface Report {
  updatedAt: string;
  checkedAt: string;
  gameCount: number;
  hero: { kicker: string; title: string; body: string };
  notes: {
    season: string;
    quarters: string;
    factors: string;
    situations: string;
    players: string;
    pairs: string;
  };
  current: SeasonView | null;
  previous: SeasonView | null;
  playoffs: SeasonView | null;
  seasons: SeasonView[];
  factors: FactorRow[];
  players: PlayerRollup[];
  pairs: PairBoard[];
  latest: LatestView | null;
  champion: { season: string; opponent: string; wins: number; losses: number } | null;
}

function sumBox(games: Game[], side: "team" | "opponent"): TeamBox {
  const zero: TeamBox = {
    fgm: 0, fga: 0, tpm: 0, tpa: 0, ftm: 0, fta: 0, oreb: 0, dreb: 0, reb: 0,
    ast: 0, stl: 0, blk: 0, tov: 0, pf: 0, pts: 0, paint: 0, fastBreak: 0,
    pointsOffTurnovers: 0, largestLead: 0, leadChanges: 0, leadPercent: 0,
  };
  for (const game of games) {
    const box = game[side];
    (Object.keys(zero) as (keyof TeamBox)[]).forEach((key) => {
      zero[key] += box[key];
    });
  }
  return zero;
}

function gameMinutes(game: Game): number {
  const ot = game.quarters.filter((quarter) => quarter.period > 4).length;
  return 48 + ot * 5;
}

export function rateGames(games: Game[]): Ratings {
  const n = games.length;
  const team = sumBox(games, "team");
  const opp = sumBox(games, "opponent");
  const poss = possessions(team);
  const oppPoss = possessions(opp);
  const minutes = games.reduce((sum, game) => sum + gameMinutes(game), 0);
  const empty = n === 0;
  const ortg = empty ? 0 : offensiveRating(team.pts, poss);
  const drtg = empty ? 0 : offensiveRating(opp.pts, oppPoss);
  return {
    games: n,
    wins: games.filter((game) => game.win).length,
    losses: games.filter((game) => !game.win).length,
    ptsFor: empty ? 0 : team.pts / n,
    ptsAgainst: empty ? 0 : opp.pts / n,
    margin: empty ? 0 : (team.pts - opp.pts) / n,
    ortg,
    drtg,
    net: ortg - drtg,
    pace: minutes > 0 ? (((poss + oppPoss) / 2) / minutes) * 48 : 0,
    efg: efg(team.fgm, team.tpm, team.fga),
    tovPct: turnoverRate(team.tov, team.fga, team.fta),
    orbPct: reboundRate(team.oreb, opp.dreb),
    ftRate: freeThrowRate(team.fta, team.fga),
    oppEfg: efg(opp.fgm, opp.tpm, opp.fga),
    oppTovPct: turnoverRate(opp.tov, opp.fga, opp.fta),
    oppOrbPct: reboundRate(opp.oreb, team.dreb),
    oppFtRate: freeThrowRate(opp.fta, opp.fga),
    paint: empty ? 0 : team.paint / n,
    fastBreak: empty ? 0 : team.fastBreak / n,
    pointsOffTurnovers: empty ? 0 : team.pointsOffTurnovers / n,
    oppPaint: empty ? 0 : opp.paint / n,
    oppFastBreak: empty ? 0 : opp.fastBreak / n,
    oppPointsOffTurnovers: empty ? 0 : opp.pointsOffTurnovers / n,
  };
}

function quarterSummaries(games: Game[]): QuarterSummary[] {
  const periods = new Set<number>();
  for (const game of games) for (const quarter of game.quarters) periods.add(quarter.period);
  return [...periods]
    .sort((a, b) => a - b)
    .map((period) => {
      const rows = games
        .map((game) => game.quarters.find((quarter) => quarter.period === period))
        .filter((quarter): quarter is NonNullable<typeof quarter> => Boolean(quarter));
      const n = rows.length;
      const knicks = n ? rows.reduce((sum, row) => sum + row.knicks, 0) / n : 0;
      const opponent = n ? rows.reduce((sum, row) => sum + row.opponent, 0) / n : 0;
      return {
        period,
        label: quarterLabel(period),
        name: quarterName(period),
        games: n,
        knicks,
        opponent,
        margin: knicks - opponent,
        won: rows.filter((row) => row.knicks > row.opponent).length,
        lost: rows.filter((row) => row.knicks < row.opponent).length,
        tied: rows.filter((row) => row.knicks === row.opponent).length,
      };
    });
}

function stubsFor(games: Game[]): GameStub[] {
  const sorted = games.slice().sort((a, b) => a.date.localeCompare(b.date));
  return sorted.map((game, index) => {
    const previous = index > 0 ? sorted[index - 1] : null;
    const restDays = previous ? daysBetween(etDayKey(previous.date), etDayKey(game.date)) - 1 : null;
    const poss = possessions(game.team);
    const oppPoss = possessions(game.opponent);
    const ortg = offensiveRating(game.knicksScore, poss);
    const drtg = offensiveRating(game.opponentScore, oppPoss);
    return {
      id: game.id,
      season: game.season,
      phase: game.phase,
      series: game.series,
      date: game.date,
      opponentAbbr: game.opponentAbbr,
      opponentName: game.opponentName,
      home: game.home,
      neutral: game.neutral,
      win: game.win,
      knicksScore: game.knicksScore,
      opponentScore: game.opponentScore,
      margin: game.knicksScore - game.opponentScore,
      ortg,
      drtg,
      net: ortg - drtg,
      venue: game.venue,
      quarters: game.quarters.map((quarter) => ({
        period: quarter.period,
        label: quarter.label,
        knicks: quarter.knicks,
        opponent: quarter.opponent,
        margin: quarter.knicks - quarter.opponent,
      })),
      backToBack: restDays === 0,
      restDays,
      previousWin: previous ? previous.win : null,
    };
  });
}

function rateStubGroup(games: Game[], ids: Set<string>): { margin: number; ortg: number; drtg: number; net: number; wins: number; losses: number; games: number } {
  const subset = games.filter((game) => ids.has(game.id));
  const ratings = rateGames(subset);
  return {
    games: ratings.games,
    wins: ratings.wins,
    losses: ratings.losses,
    margin: ratings.margin,
    ortg: ratings.ortg,
    drtg: ratings.drtg,
    net: ratings.net,
  };
}

function situationsFor(games: Game[], stubs: GameStub[]): Situation[] {
  const groups: { id: string; label: string; ids: string[] }[] = [
    { id: "home", label: "Home", ids: stubs.filter((game) => game.home && !game.neutral).map((game) => game.id) },
    { id: "road", label: "Road", ids: stubs.filter((game) => !game.home && !game.neutral).map((game) => game.id) },
    { id: "b2b", label: "Back-to-back", ids: stubs.filter((game) => game.backToBack).map((game) => game.id) },
    { id: "rest1", label: "One day off", ids: stubs.filter((game) => game.restDays === 1).map((game) => game.id) },
    { id: "rest2", label: "Two or more days off", ids: stubs.filter((game) => game.restDays != null && game.restDays >= 2).map((game) => game.id) },
    { id: "afterWin", label: "After a win", ids: stubs.filter((game) => game.previousWin === true).map((game) => game.id) },
    { id: "afterLoss", label: "After a loss", ids: stubs.filter((game) => game.previousWin === false).map((game) => game.id) },
  ];
  return groups
    .map((group) => {
      const rated = rateStubGroup(games, new Set(group.ids));
      return { id: group.id, label: group.label, ...rated };
    })
    .filter((row) => row.games > 0);
}

function seasonView(season: string, phase: Phase, games: Game[]): SeasonView {
  const subset = games.filter((game) => game.season === season && game.phase === phase);
  const ordered = subset.slice().sort((a, b) => a.date.localeCompare(b.date));
  const stubs = stubsFor(ordered);
  const phaseLabel = phase === "playoffs" ? "playoffs" : "regular season";
  return {
    season,
    phase,
    label: `${prettySeason(season)} ${phaseLabel}`,
    ratings: rateGames(ordered),
    quarters: quarterSummaries(ordered),
    situations: situationsFor(ordered, stubs),
    games: stubs,
  };
}

function impactFor(player: Omit<PlayerRollup, "impact">): PlayerRollup["impact"] {
  const who = lastName(player.name);
  const sample =
    player.games < 8
      ? ` The sample is ${player.games} ${player.games === 1 ? "game" : "games"}.`
      : "";
  if (player.minutes < 48 || player.games < 2) {
    return {
      kind: "limited",
      title: "Low minutes",
      sentence: `${who}: ${player.minutes.toFixed(0)} min, ${player.games} ${player.games === 1 ? "game" : "games"}.`,
    };
  }
  const per36 = (value: number) => (value / player.minutes) * 36;
  const pts36 = per36(player.pts * player.games);
  const ast36 = per36(player.ast * player.games);
  const reb36 = per36(player.reb * player.games);
  const stl36 = per36(player.stl * player.games);
  const blk36 = per36(player.blk * player.games);
  const candidates: { kind: string; title: string; score: number }[] = [];
  if (pts36 >= 16 || (pts36 >= 13 && player.ts >= 0.57)) {
    candidates.push({ kind: "scoring", title: "Scoring", score: pts36 / 18 + Math.max(0, player.ts - 0.54) * 3 });
  }
  if (ast36 >= 4.5 && player.ast >= player.tov) {
    candidates.push({ kind: "creation", title: "Creation", score: ast36 / 5.5 });
  }
  if (reb36 >= 8) candidates.push({ kind: "rebounding", title: "Rebounding", score: reb36 / 9 });
  if (blk36 >= 1.15) candidates.push({ kind: "rim", title: "Rim protection", score: blk36 / 1.4 });
  if (stl36 >= 1.35) candidates.push({ kind: "disruption", title: "Disruption", score: stl36 / 1.5 });
  if (player.onOff != null && player.onOff >= 5) {
    candidates.push({ kind: "lift", title: "Lineup lift", score: player.onOff / 8 });
  }
  if (player.onOff != null && player.onOff <= -5) {
    candidates.push({ kind: "drag", title: "Lineup drag", score: Math.abs(player.onOff) / 8 });
  }
  if (pts36 >= 12 && stl36 + blk36 >= 1.8 && (player.onOff == null || player.onOff >= 0)) {
    candidates.push({ kind: "twoway", title: "Two-way", score: (stl36 + blk36) / 2 + pts36 / 24 });
  }
  candidates.sort((a, b) => b.score - a.score);
  const primary = candidates[0] ?? { kind: "mixed", title: "Mixed", score: 0 };
  let lead = `${who}: ${primary.title.toLowerCase()}.`;
  if (primary.kind === "scoring") lead = `${who}: ${player.pts.toFixed(1)} pts, ${pctText(player.ts)} TS.`;
  else if (primary.kind === "creation") lead = `${who}: ${player.ast.toFixed(1)} ast, ${player.tov.toFixed(1)} tov.`;
  else if (primary.kind === "rebounding") lead = `${who}: ${player.reb.toFixed(1)} reb.`;
  else if (primary.kind === "rim") lead = `${who}: ${player.blk.toFixed(1)} blk.`;
  else if (primary.kind === "disruption") lead = `${who}: ${player.stl.toFixed(1)} stl.`;
  else if (primary.kind === "twoway") lead = `${who}: ${player.pts.toFixed(1)} pts, ${player.stl.toFixed(1)} stl, ${player.blk.toFixed(1)} blk.`;
  else if (primary.kind === "mixed") lead = `${who}: ${player.pts.toFixed(1)} / ${player.reb.toFixed(1)} / ${player.ast.toFixed(1)}.`;
  const on = player.onNet48 == null ? "" : ` On ${signed(player.onNet48)}`;
  const off = player.offNet48 == null ? "" : `, off ${signed(player.offNet48)}`;
  const floor = on ? `${on}${off}.` : "";
  const defense = player.oppPts48On == null ? "" : ` Opp ${player.oppPts48On.toFixed(1)}/48.`;
  return { kind: primary.kind, title: primary.title, sentence: `${lead}${floor}${defense}${sample}`.replace(/\s+/g, " ").trim() };
}

function pctText(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

function rollPlayers(games: Game[], season: string, phase: Phase): PlayerRollup[] {
  const map = new Map<string, {
    meta: PlayerGame;
    games: number;
    starts: number;
    minutes: number;
    pts: number; reb: number; ast: number; stl: number; blk: number; tov: number; pm: number;
    fgm: number; fga: number; tpm: number; ftm: number; fta: number; oreb: number; dreb: number;
    usgWeighted: number;
    gs: number;
    onPts: number; onOpp: number; onSeconds: number;
    offPts: number; offOpp: number; offSeconds: number;
    quarters: Map<number, { games: number; pts: number; pm: number; onPts: number; onOpp: number; seconds: number }>;
  }>();

  for (const game of games) {
    if (game.season !== season || game.phase !== phase) continue;
    // A gap of a few points is a missed substitution in the feed, not a different game.
    // Larger gaps are left out so one broken log cannot swing a season split.
    const usable = game.lineupError <= 8;
    const length = gameLengthSeconds(game.quarters.map((quarter) => quarter.period));
    const teamMinutes = game.players.reduce((sum, player) => sum + player.minutes, 0);
    for (const player of game.players) {
      if (player.didNotPlay || player.minutes <= 0) continue;
      const row = map.get(player.id) ?? {
        meta: player,
        games: 0, starts: 0, minutes: 0,
        pts: 0, reb: 0, ast: 0, stl: 0, blk: 0, tov: 0, pm: 0,
        fgm: 0, fga: 0, tpm: 0, ftm: 0, fta: 0, oreb: 0, dreb: 0,
        usgWeighted: 0, gs: 0,
        onPts: 0, onOpp: 0, onSeconds: 0, offPts: 0, offOpp: 0, offSeconds: 0,
        quarters: new Map(),
      };
      row.meta = player;
      row.games += 1;
      if (player.starter) row.starts += 1;
      row.minutes += player.minutes;
      row.pts += player.pts;
      row.reb += player.reb;
      row.ast += player.ast;
      row.stl += player.stl;
      row.blk += player.blk;
      row.tov += player.tov;
      row.pm += player.plusMinus;
      row.fgm += player.fgm;
      row.fga += player.fga;
      row.tpm += player.tpm;
      row.ftm += player.ftm;
      row.fta += player.fta;
      row.oreb += player.oreb;
      row.dreb += player.dreb;
      row.gs += gameScore(player);
      row.usgWeighted += usageRate(player, { ...game.team, minutes: teamMinutes }) * player.minutes;
      if (usable && player.onSeconds > 0 && player.onSeconds < length + 90) {
        row.onPts += player.onPts;
        row.onOpp += player.onOpp;
        row.onSeconds += player.onSeconds;
        row.offPts += game.knicksScore - player.onPts;
        row.offOpp += game.opponentScore - player.onOpp;
        row.offSeconds += Math.max(0, length - player.onSeconds);
      }
      for (const quarter of player.quarters) {
        const bucket = row.quarters.get(quarter.period) ?? { games: 0, pts: 0, pm: 0, onPts: 0, onOpp: 0, seconds: 0 };
        bucket.games += 1;
        bucket.pts += quarter.pts;
        bucket.pm += quarter.plusMinus;
        if (usable) {
          bucket.onPts += quarter.onPts;
          bucket.onOpp += quarter.onOpp;
          bucket.seconds += quarter.seconds;
        }
        row.quarters.set(quarter.period, bucket);
      }
      map.set(player.id, row);
    }
  }

  const rows: PlayerRollup[] = [];
  for (const [id, row] of map) {
    const onNet48 = netPer48(row.onPts, row.onOpp, row.onSeconds);
    const offNet48 = netPer48(row.offPts, row.offOpp, row.offSeconds);
    const partial = {
      id,
      name: row.meta.name,
      shortName: row.meta.shortName,
      position: row.meta.position,
      jersey: row.meta.jersey,
      season,
      phase,
      games: row.games,
      starts: row.starts,
      minutes: row.minutes,
      mpg: row.minutes / row.games,
      pts: row.pts / row.games,
      reb: row.reb / row.games,
      ast: row.ast / row.games,
      stl: row.stl / row.games,
      blk: row.blk / row.games,
      tov: row.tov / row.games,
      plusMinus: row.pm,
      pmPerGame: row.pm / row.games,
      ts: trueShooting(row.pts, row.fga, row.fta),
      efg: efg(row.fgm, row.tpm, row.fga),
      usg: row.minutes > 0 ? row.usgWeighted / row.minutes : 0,
      gameScore: row.gs / row.games,
      onNet48,
      offNet48,
      onOff: onNet48 != null && offNet48 != null ? onNet48 - offNet48 : null,
      teamPts48On: per48(row.onPts, row.onSeconds),
      teamPts48Off: per48(row.offPts, row.offSeconds),
      oppPts48On: per48(row.onOpp, row.onSeconds),
      oppPts48Off: per48(row.offOpp, row.offSeconds),
      quarters: [...row.quarters.entries()]
        .sort((a, b) => a[0] - b[0])
        .map(([period, bucket]) => ({
          period,
          label: quarterLabel(period),
          games: bucket.games,
          pts: bucket.games ? bucket.pts / bucket.games : 0,
          plusMinus: bucket.games ? bucket.pm / bucket.games : 0,
          onNet48: netPer48(bucket.onPts, bucket.onOpp, bucket.seconds),
          oppPts48: per48(bucket.onOpp, bucket.seconds),
        })),
    };
    rows.push({ ...partial, impact: impactFor(partial) });
  }
  return rows.sort((a, b) => b.minutes - a.minutes);
}

function tone(delta: number, better: "higher" | "lower" | "neutral"): FactorRow["tone"] {
  if (!Number.isFinite(delta) || Math.abs(delta) < 0.15) return "flat";
  if (better === "neutral") return "flat";
  const improved = better === "higher" ? delta > 0 : delta < 0;
  return improved ? "good" : "bad";
}

function factorRows(current: Ratings | null, previous: Ratings | null): FactorRow[] {
  const specs: {
    group: string;
    label: string;
    key: keyof Ratings;
    digits: number;
    percent?: boolean;
    better: "higher" | "lower" | "neutral";
  }[] = [
    { group: "Scoring", label: "Offensive rating", key: "ortg", digits: 1, better: "higher" },
    { group: "Scoring", label: "Defensive rating", key: "drtg", digits: 1, better: "lower" },
    { group: "Scoring", label: "Net rating", key: "net", digits: 1, better: "higher" },
    { group: "Scoring", label: "Pace", key: "pace", digits: 1, better: "neutral" },
    { group: "Scoring", label: "Points scored", key: "ptsFor", digits: 1, better: "higher" },
    { group: "Scoring", label: "Points allowed", key: "ptsAgainst", digits: 1, better: "lower" },
    { group: "Offense", label: "Effective field-goal %", key: "efg", digits: 1, percent: true, better: "higher" },
    { group: "Offense", label: "Turnover rate", key: "tovPct", digits: 1, percent: true, better: "lower" },
    { group: "Offense", label: "Offensive rebound rate", key: "orbPct", digits: 1, percent: true, better: "higher" },
    { group: "Offense", label: "Free-throw rate", key: "ftRate", digits: 1, percent: true, better: "higher" },
    { group: "Offense", label: "Points in the paint", key: "paint", digits: 1, better: "higher" },
    { group: "Offense", label: "Fast-break points", key: "fastBreak", digits: 1, better: "higher" },
    { group: "Offense", label: "Points off turnovers", key: "pointsOffTurnovers", digits: 1, better: "higher" },
    { group: "Defense", label: "Opponent effective field-goal %", key: "oppEfg", digits: 1, percent: true, better: "lower" },
    { group: "Defense", label: "Opponent turnover rate", key: "oppTovPct", digits: 1, percent: true, better: "higher" },
    { group: "Defense", label: "Opponent offensive rebound rate", key: "oppOrbPct", digits: 1, percent: true, better: "lower" },
    { group: "Defense", label: "Opponent free-throw rate", key: "oppFtRate", digits: 1, percent: true, better: "lower" },
    { group: "Defense", label: "Opponent points in the paint", key: "oppPaint", digits: 1, better: "lower" },
    { group: "Defense", label: "Opponent fast-break points", key: "oppFastBreak", digits: 1, better: "lower" },
    { group: "Defense", label: "Opponent points off turnovers", key: "oppPointsOffTurnovers", digits: 1, better: "lower" },
  ];
  return specs.map((spec) => {
    const raw = (ratings: Ratings | null) => (ratings ? Number(ratings[spec.key]) : null);
    const cur = raw(current);
    const prev = raw(previous);
    const show = (value: number | null) => {
      if (value == null || !Number.isFinite(value)) return "\u2014";
      return spec.percent ? `${(value * 100).toFixed(spec.digits)}%` : value.toFixed(spec.digits);
    };
    const delta = cur != null && prev != null ? (spec.percent ? (cur - prev) * 100 : cur - prev) : null;
    return {
      group: spec.group,
      label: spec.label,
      current: show(cur),
      previous: show(prev),
      delta: delta == null ? "\u2014" : signed(delta, spec.digits),
      shift: delta,
      tone: delta == null ? "none" : tone(delta, spec.better),
    };
  });
}

function championOf(games: Game[]): Report["champion"] {
  const seasons = [...new Set(games.filter((game) => game.phase === "playoffs" && /^NBA Finals/i.test(game.series ?? "")).map((game) => game.season))];
  seasons.sort();
  for (const season of seasons.reverse()) {
    const finals = games.filter((game) => game.season === season && /^NBA Finals/i.test(game.series ?? ""));
    const wins = finals.filter((game) => game.win).length;
    const losses = finals.length - wins;
    if (wins >= 4 && wins > losses) {
      const last = finals.slice().sort((a, b) => a.date.localeCompare(b.date)).at(-1);
      return { season, opponent: last?.opponentName ?? "their opponent", wins, losses };
    }
  }
  return null;
}

function buildHero(current: SeasonView | null, previous: SeasonView | null, champion: Report["champion"]): Report["hero"] {
  if (!current) {
    return {
      kicker: "New York Knicks",
      title: "No completed games are in the snapshot yet.",
      body: "Ingest the latest game to pull the regular season and last year's playoffs from ESPN.",
    };
  }
  const kicker = `${current.label} · ${record(current.ratings.wins, current.ratings.losses)}`;
  if (!previous || previous.ratings.games === 0) {
    return {
      kicker,
      title: `Net rating is ${signed(current.ratings.net)} through ${current.ratings.games} games.`,
      body: `The Knicks are scoring ${current.ratings.ortg.toFixed(1)} points per 100 possessions and allowing ${current.ratings.drtg.toFixed(1)}.`,
    };
  }
  const dO = current.ratings.ortg - previous.ratings.ortg;
  const dD = current.ratings.drtg - previous.ratings.drtg;
  const stories: { score: number; title: string }[] = [
    {
      score: Math.abs(dO),
      title: dO >= 0 ? `Offense ${dO.toFixed(1)} points ahead` : `Offense ${Math.abs(dO).toFixed(1)} points behind`,
    },
    {
      score: Math.abs(dD),
      title: dD > 0 ? `Defense ${dD.toFixed(1)} points worse` : `Defense ${Math.abs(dD).toFixed(1)} points better`,
    },
  ];
  for (const period of [1, 2, 3, 4]) {
    const now = current.quarters.find((quarter) => quarter.period === period);
    const then = previous.quarters.find((quarter) => quarter.period === period);
    if (!now || !then || now.games < 2) continue;
    stories.push({
      score: Math.abs(now.margin - then.margin),
      title: `${now.label} ${signed(now.margin)}, was ${signed(then.margin)}`,
    });
  }
  stories.sort((a, b) => b.score - a.score);
  const title =
    stories[0] && stories[0].score >= 1
      ? stories[0].title
      : `Net ${signed(current.ratings.net)}, was ${signed(previous.ratings.net)}`;
  const bits = [
    current.ratings.games < 20 ? `${current.ratings.games} games. One night still moves the rate.` : `${current.ratings.games} games.`,
    champion ? `Finals ${record(champion.wins, champion.losses)}, ${champion.opponent}.` : "",
  ].filter(Boolean);
  return { kicker, title, body: bits.join(" ") };
}

function sectionNotes(current: SeasonView | null, previous: SeasonView | null, players: PlayerRollup[]): Report["notes"] {
  const season = !current
    ? "Waiting on a completed game."
    : !previous
      ? `${record(current.ratings.wins, current.ratings.losses)}, margin ${signed(current.ratings.margin)}.`
      : `Net ${signed(current.ratings.net)}. Last year ${signed(previous.ratings.net)}.`;

  let quarters = "Margin by period.";
  if (current) {
    const regs = current.quarters.filter((quarter) => quarter.period <= 4);
    const shown = (quarter: { margin: number }) => Math.round(quarter.margin * 10) / 10;
    const best = regs.slice().sort((a, b) => shown(b) - shown(a) || b.won - a.won)[0];
    const worst = regs.slice().sort((a, b) => shown(a) - shown(b) || a.won - b.won)[0];
    if (best && worst) {
      quarters = `Best ${best.label} ${signed(best.margin)}. Softest ${worst.label} ${signed(worst.margin)}.`;
    }
  }

  const factors = "Per 100 possessions. Olive helps. Rose hurts. Pace is unmarked.";

  let situations = "Small samples move fast.";
  if (current) {
    const home = current.situations.find((row) => row.id === "home");
    const road = current.situations.find((row) => row.id === "road");
    const b2b = current.situations.find((row) => row.id === "b2b");
    const bits: string[] = [];
    if (home && road && home.games >= 1 && road.games >= 1) {
      bits.push(`Home ${signed(home.margin)}. Road ${signed(road.margin)}.`);
    }
    if (b2b && b2b.games >= 1) bits.push(`Back-to-back ${signed(b2b.margin)}.`);
    if (bits.length) situations = bits.join(" ");
  }

  const currentPlayers = players.filter((player) => current && player.season === current.season && player.phase === current.phase && player.impact.kind !== "limited");
  const ranked = currentPlayers.filter((player) => player.onOff != null).sort((a, b) => (b.onOff ?? 0) - (a.onOff ?? 0));
  const playersNote = ranked[0] ? `${lastName(ranked[0].name)} ${signed(ranked[0].onOff ?? 0)} on/off.` : "On-court margin.";

  return { season, quarters, factors, situations, players: playersNote, pairs: "Both on the floor. Margin per 48." };
}

function latestView(games: Game[]): LatestView | null {
  const game = games.slice().sort((a, b) => a.date.localeCompare(b.date)).at(-1);
  if (!game) return null;
  const quarters = game.quarters.map((quarter) => ({
    period: quarter.period,
    label: quarter.label,
    knicks: quarter.knicks,
    opponent: quarter.opponent,
    margin: quarter.knicks - quarter.opponent,
  }));
  const swing = quarters.slice().sort((a, b) => Math.abs(b.margin) - Math.abs(a.margin))[0];
  const played = game.players
    .filter((player) => !player.didNotPlay && player.minutes > 0)
    .map((player) => ({ ...player, gameScore: gameScore(player) }))
    .sort((a, b) => b.gameScore - a.gameScore);
  const lead = played[0];
  const where = game.neutral ? "neutral" : game.home ? "home" : "road";
  return {
    id: game.id,
    date: game.date,
    opponentName: game.opponentName,
    opponentAbbr: game.opponentAbbr,
    home: game.home,
    neutral: game.neutral,
    win: game.win,
    knicksScore: game.knicksScore,
    opponentScore: game.opponentScore,
    venue: game.venue,
    series: game.series,
    quarters,
    note: `${where[0]?.toUpperCase()}${where.slice(1)} ${game.win ? "win" : "loss"}.${swing ? ` ${swing.label} ${signed(swing.margin, 0)}.` : ""}${lead ? ` ${lastName(lead.name)} ${lead.pts} pts.` : ""}`,
    players: played.slice(0, 5).map((player) => ({
      id: player.id,
      name: player.name,
      shortName: player.shortName,
      pts: player.pts,
      reb: player.reb,
      ast: player.ast,
      plusMinus: player.plusMinus,
      minutes: player.minutes,
      gameScore: player.gameScore,
    })),
  };
}

function pairBoards(games: Game[], seasons: SeasonView[], players: PlayerRollup[]): PairBoard[] {
  const minimum = 8 * 60;
  return seasons
    .filter((season) => season.ratings.games > 0)
    .map((season) => {
      const slice = games.filter(
        (game) => game.season === season.season && game.phase === season.phase && game.lineupError <= 8,
      );
      const totals = new Map<string, { seconds: number; pts: number; opp: number }>();
      for (const game of slice) {
        for (const pair of game.pairs ?? []) {
          const a = pair.a < pair.b ? pair.a : pair.b;
          const b = pair.a < pair.b ? pair.b : pair.a;
          const key = `${a}:${b}`;
          const row = totals.get(key) ?? { seconds: 0, pts: 0, opp: 0 };
          row.seconds += pair.seconds;
          row.pts += pair.pts;
          row.opp += pair.opp;
          totals.set(key, row);
        }
      }
      const shown = players
        .filter((player) => player.season === season.season && player.phase === season.phase && player.minutes >= 20)
        .slice(0, 8);
      const ids = new Set(shown.map((player) => player.id));
      const cells: PairCell[] = [];
      for (const [key, row] of totals) {
        if (row.seconds < minimum) continue;
        const [a, b] = key.split(":");
        if (!a || !b || !ids.has(a) || !ids.has(b)) continue;
        cells.push({ a, b, minutes: row.seconds / 60, net48: ((row.pts - row.opp) / row.seconds) * 48 * 60 });
      }
      const named = (id: string) => lastName(shown.find((player) => player.id === id)?.name ?? id);
      const ranked = cells.slice().sort((a, b) => b.net48 - a.net48);
      const best = ranked[0];
      const soft = ranked.length > 1 ? ranked[ranked.length - 1] : undefined;
      const note =
        cells.length === 0
          ? "Pair minutes are still loading."
          : best && soft
            ? `Best ${named(best.a)}–${named(best.b)} ${signed(best.net48)}. Softest ${named(soft.a)}–${named(soft.b)} ${signed(soft.net48)}.`
            : best
              ? `${named(best.a)}–${named(best.b)} ${signed(best.net48)}.`
              : "Both on the floor. Margin per 48.";
      return {
        id: `${season.season}:${season.phase}`,
        label: season.label,
        players: shown.map((player) => ({
          id: player.id,
          name: lastName(player.name),
          minutes: player.minutes,
          net48: player.onNet48,
        })),
        cells,
        note,
      };
    });
}

export function buildReport(store: Store): Report {
  const games = store.games.slice().sort((a, b) => a.date.localeCompare(b.date));
  const keys = new Map<string, { season: string; phase: Phase }>();
  for (const game of games) keys.set(`${game.season}:${game.phase}`, { season: game.season, phase: game.phase });
  const seasons = [...keys.values()]
    .sort((a, b) => a.season.localeCompare(b.season) || a.phase.localeCompare(b.phase))
    .map((key) => seasonView(key.season, key.phase, games));
  const regulars = seasons.filter((season) => season.phase === "regular" && season.ratings.games > 0);
  const current = regulars.at(-1) ?? null;
  const previous = regulars.length > 1 ? regulars[regulars.length - 2] : null;
  const playoffs = seasons.filter((season) => season.phase === "playoffs" && previous && season.season === previous.season).at(-1) ?? seasons.filter((season) => season.phase === "playoffs").at(-1) ?? null;
  const players = seasons.flatMap((season) => rollPlayers(games, season.season, season.phase));
  const pairs = pairBoards(games, seasons, players);
  const champion = championOf(games);
  const notes = sectionNotes(current, previous, players);
  const currentPairs = pairs.find((board) => current && board.id === `${current.season}:${current.phase}`);
  if (currentPairs && currentPairs.cells.length > 0) notes.pairs = currentPairs.note;
  return {
    updatedAt: store.updatedAt,
    checkedAt: store.checkedAt,
    gameCount: games.length,
    hero: buildHero(current, previous, champion),
    notes,
    current,
    previous,
    playoffs,
    seasons,
    factors: factorRows(current?.ratings ?? null, previous?.ratings ?? null),
    players,
    pairs,
    latest: latestView(games),
    champion,
  };
}

export function playerGames(store: Store, id: string): Game[] {
  return store.games
    .filter((game) => game.players.some((player) => player.id === id && !player.didNotPlay && player.minutes > 0))
    .sort((a, b) => b.date.localeCompare(a.date));
}
