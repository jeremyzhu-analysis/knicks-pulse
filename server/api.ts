// Builds the documents the `/api` routes send, shaped as server/schema.ts
// describes them.

import {
  PAIR_MIN_SECONDS,
  buildReport,
  factors,
  flow,
  gamePlayers,
  gameSides,
  headline,
  pointsByPeriod,
  quarters,
  ratings,
  rollingMargins,
  shotMap,
  situations,
  won,
  type PeriodPoints,
  type SeasonReport,
} from "./report/compute.ts";
import { REPLAY_TOLERANCE, replayGame } from "./report/lineups.ts";
import type { Dataset, Game as LoadedGame, PlayerGame } from "./report/load.ts";
import type {
  Game,
  GameDetail,
  LatestGame,
  PlayerDetail,
  PlayerLogGame,
  PlayerSeason,
  Report,
  Season,
  ShotMap,
} from "./schema.ts";

function playerDetails(seasons: readonly SeasonReport[], points: PeriodPoints): PlayerDetail[] {
  const details: PlayerDetail[] = [];
  for (const s of seasons) {
    for (const row of s.playerReport.players) {
      const log: PlayerLogGame[] = [];
      let wins = 0;
      for (const g of s.season.games) {
        const line = g.players.find((p) => p.playerId === row.id);
        if (!line) continue;
        if (won(g)) wins++;
        const gamePoints = points.get(g.id) ?? new Map<number, number[]>();
        for (const shown of gamePlayers([line], gamePoints, null)) log.push({ ...game(g), line: shown });
      }
      const season: PlayerSeason = {
        key: s.season.key,
        label: s.season.label,
        row,
        wins,
        losses: log.length - wins,
        games: log,
      };
      const detail = details.find((d) => d.id === row.id);
      if (detail) detail.seasons.push(season);
      else details.push({ id: row.id, name: row.name, position: row.position, seasons: [season] });
    }
  }
  return details;
}

function gameDetail(g: LoadedGame): GameDetail {
  const replay = replayGame(g);
  const moments = flow(g);
  const [us, them] = gameSides(g, moments);
  const points = pointsByPeriod(g);
  return {
    ...game(g),
    replayed: replay.ok,
    replayTolerance: REPLAY_TOLERANCE,
    flow: moments,
    us,
    them,
    players: gamePlayers(g.players, points, replay),
    opponents: gamePlayers(g.opponentPlayers, points, null),
  };
}

function game(g: LoadedGame): Game {
  const rated = ratings([g]);
  return {
    id: g.id,
    startsAt: g.startsAt,
    home: g.home,
    neutral: g.neutral,
    opponent: { id: g.opponent.id, abbreviation: g.opponent.abbreviation, name: g.opponent.name },
    venue: g.venue,
    attendance: g.attendance,
    note: g.note,
    periods: g.periods,
    pts: g.pts,
    oppPts: g.oppPts,
    usByPeriod: g.usByPeriod,
    themByPeriod: g.themByPeriod,
    offense: rated.offense,
    defense: rated.defense,
  };
}

function season(s: SeasonReport): Season {
  return {
    key: s.season.key,
    year: s.season.year,
    type: s.season.seasonType,
    label: s.season.label,
    ratings: s.season.ratings,
    games: s.season.games.map(game),
    rolling: rollingMargins(s.season.games),
    playerReport: s.playerReport,
  };
}

/** What a path of the API answers with. */
export type Document =
  | { kind: "game"; value: GameDetail }
  | { kind: "player"; value: PlayerDetail }
  | { kind: "shots"; value: ShotMap[] }
  | { kind: "report"; value: Report };

/** Every document the API serves, by path. */
export function documents(data: Dataset): Map<string, Document> {
  const documents = new Map<string, Document>();
  for (const g of data.games) documents.set(`/api/games/${g.id}`, { kind: "game", value: gameDetail(g) });
  const { report: built, players, shots } = report(data);
  for (const player of players) documents.set(`/api/players/${player.id}`, { kind: "player", value: player });
  documents.set("/api/shots", { kind: "shots", value: shots });
  documents.set("/api/report", { kind: "report", value: built });
  return documents;
}

/** The report, the page of every player in it, and each season's shot map, most recent season first. */
function report(data: Dataset): { report: Report; players: PlayerDetail[]; shots: ShotMap[] } {
  const computed = buildReport(data);
  const { seasons, current, lastRegular } = computed;
  const players = playerDetails(seasons, computed.points);
  const shots = seasons.map((s) => shotMap(s.season.key, s.season.games));
  const now = current === null ? null : seasons[current]!.season;
  const was = lastRegular === null ? null : seasons[lastRegular]!.season;

  const quarterRows = now ? quarters(now.games, was ? was.games : null) : null;
  let latestGame: LatestGame | null = null;
  if (computed.latestGame) {
    // The first player with the most points, in box-score order.
    let top: PlayerGame | null = null;
    for (const p of computed.latestGame.players) if (!top || p.pts > top.pts) top = p;
    latestGame = {
      ...game(computed.latestGame),
      topScorer: top ? { fullName: top.fullName, pts: top.pts } : null,
    };
  }

  return {
    report: {
      syncedAt: data.syncedAt,
      gameCount: computed.gameCount,
      replayedGames: computed.replayedGames,
      replayTolerance: REPLAY_TOLERANCE,
      pairMinSeconds: PAIR_MIN_SECONDS,
      seasons: seasons.map(season),
      currentKey: now ? now.key : null,
      lastRegularKey: was ? was.key : null,
      latestGame,
      headline: now ? headline(now.ratings, was ? was.ratings : null, quarterRows ?? []) : null,
      lastSeries: computed.lastSeries,
      champion: computed.champion,
      quarters: quarterRows,
      factors: now && was ? factors(now.games, was.games) : null,
      situations: now ? situations(now.games, was ? was.games : null) : null,
    },
    players,
    shots,
  };
}
