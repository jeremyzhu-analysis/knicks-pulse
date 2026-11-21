// The API's contract: one JSON Schema per document and per route. The server
// validates requests and serializes responses with these; the page imports
// the types derived from them. Properties are listed in the order they are
// sent.

import { Type, type Static, type TSchema } from "typebox";

const Nullable = <T extends TSchema>(schema: T) => Type.Union([schema, Type.Null()]);

const Int = Type.Integer();
const Num = Type.Number();
const Str = Type.String();
const Bool = Type.Boolean();

/** A point in a game, with the score from the report team's side. */
export const GameMoment = Type.Object({
  period: Int,
  clockSeconds: Type.Number({ description: "Seconds left in the period." }),
  us: Int,
  them: Int,
});
export type GameMoment = Static<typeof GameMoment>;

export const Stint = Type.Object({ from: GameMoment, to: GameMoment });
export type Stint = Static<typeof Stint>;

export const Ratings = Type.Object({
  games: Int,
  wins: Int,
  losses: Int,
  margin: Num,
  offense: Num,
  defense: Num,
  net: Num,
  pace: Num,
  scored: Num,
  allowed: Num,
});
export type Ratings = Static<typeof Ratings>;

export const Rolling = Type.Object({
  window: Int,
  values: Type.Array(Nullable(Num), {
    description:
      "One per game, oldest first: the average margin of the last `window` games up to that one, fewer early in the season; null before the average starts.",
  }),
});
export type Rolling = Static<typeof Rolling>;

export const Factor = Type.Object({
  label: Str,
  now: Num,
  was: Num,
  isPercent: Bool,
  higherHelps: Type.Boolean({ description: "True when a higher value is good for the report team." }),
});
export type Factor = Static<typeof Factor>;

export const Factors = Type.Object({ offense: Type.Array(Factor), defense: Type.Array(Factor) });
export type Factors = Static<typeof Factors>;

export const QuarterRow = Type.Object({
  quarter: Int,
  scored: Num,
  allowed: Num,
  margin: Num,
  ahead: Int,
  behind: Int,
  tied: Int,
  lastMargin: Nullable(Num),
});
export type QuarterRow = Static<typeof QuarterRow>;

/** What the hero leads with: the number that moved most since last season. */
export const Headline = Type.Union([
  Type.Object({ kind: Type.Literal("games"), games: Int }, { description: "No last season to compare with." }),
  Type.Object(
    { kind: Type.Literal("offense"), change: Num },
    { description: "Points per 100 possessions scored, against last season." },
  ),
  Type.Object(
    { kind: Type.Literal("defense"), change: Num },
    { description: "Points per 100 possessions allowed, against last season." },
  ),
  Type.Object({ kind: Type.Literal("quarter"), quarter: Int, margin: Num, was: Num }),
  Type.Object({ kind: Type.Literal("net"), net: Num, was: Num }, { description: "Nothing moved by a full point." }),
]);
export type Headline = Static<typeof Headline>;

export const Split = Type.Object({ games: Int, wins: Int, losses: Int, margin: Num, net: Num });
export type Split = Static<typeof Split>;

export const Situation = Type.Object({ label: Str, now: Nullable(Split), last: Nullable(Split) });
export type Situation = Static<typeof Situation>;

export const ImpactKind = Type.Union([
  Type.Literal("lowMinutes"),
  Type.Literal("lineupDrag"),
  Type.Literal("twoWay"),
  Type.Literal("scoring"),
  Type.Literal("creation"),
  Type.Literal("lineupLift"),
  Type.Literal("disruption"),
  Type.Literal("rimProtection"),
  Type.Literal("rebounding"),
  Type.Literal("mixed"),
]);
export type ImpactKind = Static<typeof ImpactKind>;

export const ImpactTone = Type.Union([
  Type.Literal("score"),
  Type.Literal("lift"),
  Type.Literal("drag"),
  Type.Literal("muted"),
]);
export type ImpactTone = Static<typeof ImpactTone>;

export const Impact = Type.Object({ kind: ImpactKind, tone: ImpactTone });
export type Impact = Static<typeof Impact>;

/** A player's season in one quarter. */
export const PlayerQuarter = Type.Object({
  quarter: Int,
  pts: Nullable(
    Type.Number({
      description:
        "Points per game, over the games whose play-by-play adds up to the player's points; null without such a game.",
    }),
  ),
  plusMinus: Nullable(
    Type.Number({ description: "Net points per game while on the floor; null without a usable replay." }),
  ),
  opp48: Nullable(
    Type.Number({
      description: "The opponent's points per 48 minutes while on the floor; null without a usable replay.",
    }),
  ),
});
export type PlayerQuarter = Static<typeof PlayerQuarter>;

export const PlayerRow = Type.Object({
  id: Int,
  name: Str,
  last: Str,
  position: Nullable(Str),
  gp: Int,
  minutes: Int,
  mpg: Num,
  ppg: Num,
  rpg: Num,
  apg: Num,
  spg: Num,
  bpg: Num,
  topg: Num,
  ts: Num,
  usg: Type.Number({
    description:
      "Share of the team's possessions the player ended while on the floor, in percent: each game's rate weighted by the minutes played in it.",
  }),
  plusMinus: Num,
  on48: Nullable(
    Type.Number({ description: "Net points per 48 with the player on the floor; null without a usable replay." }),
  ),
  off48: Nullable(Type.Number({ description: "Net points per 48 with the player off the floor." })),
  team48On: Nullable(Type.Number({ description: "Points per 48 by the team with the player on." })),
  team48Off: Nullable(Num),
  opp48: Nullable(Type.Number({ description: "Points per 48 by the opponent with the player on." })),
  opp48Off: Nullable(Num),
  quarters: Type.Array(PlayerQuarter, { description: "Q1 to Q4." }),
  onOff: Nullable(Type.Number({ description: "`on48 - off48`." })),
  previousOnOff: Nullable(
    Type.Number({
      description: "The same player's `onOff` in the regular season before; set only in the current season.",
    }),
  ),
  impact: Impact,
});
export type PlayerRow = Static<typeof PlayerRow>;

export const PairCell = Type.Object({ seconds: Num, net48: Num });
export type PairCell = Static<typeof PairCell>;

export const PairPlayer = Type.Object({ id: Int, last: Str });
export type PairPlayer = Static<typeof PairPlayer>;

export const PairExtreme = Type.Object({ a: Str, b: Str, cell: PairCell });
export type PairExtreme = Static<typeof PairExtreme>;

export const Pairs = Type.Object({
  players: Type.Array(PairPlayer),
  cells: Type.Array(Type.Array(Nullable(PairCell)), {
    description: "cells[i][j]; the diagonal is the player alone. null under the minute floor.",
  }),
  best: Nullable(PairExtreme),
  worst: Nullable(PairExtreme),
});
export type Pairs = Static<typeof Pairs>;

export const PlayerReport = Type.Object({ players: Type.Array(PlayerRow), pairs: Pairs, replayedGames: Int });
export type PlayerReport = Static<typeof PlayerReport>;

/** One team's game: the four factors and where its points came from. */
export const GameSide = Type.Object({
  efg: Num,
  tov: Num,
  orb: Num,
  ftr: Num,
  paint: Int,
  fastBreak: Int,
  offTov: Int,
  largestLead: Type.Integer({ description: "From the play-by-play; 0 for a team that never led." }),
});
export type GameSide = Static<typeof GameSide>;

export const GamePlayer = Type.Object({
  id: Int,
  name: Str,
  position: Nullable(Str),
  starter: Bool,
  minutes: Int,
  pts: Int,
  reb: Int,
  ast: Int,
  stl: Int,
  blk: Int,
  tov: Int,
  ts: Nullable(Type.Number({ description: "Null without a shot or free throw." })),
  plusMinus: Int,
  gameScore: Num,
  pointsByPeriod: Nullable(
    Type.Array(Int, {
      description: "Points by period, index 0 is Q1; null when the play-by-play doesn't add up to the player's points.",
    }),
  ),
  stints: Type.Array(Stint, { description: "Empty for an opponent, and when the game's replay didn't hold up." }),
});
export type GamePlayer = Static<typeof GamePlayer>;

export const Shot = Type.Object({
  p: Type.Integer({ description: "Player id." }),
  x: Int,
  y: Int,
  made: Bool,
  value: Type.Integer({ description: "2 or 3." }),
  period: Int,
});
export type Shot = Static<typeof Shot>;

export const Shooter = Type.Object({ id: Int, last: Str, makes: Int, attempts: Int });
export type Shooter = Static<typeof Shooter>;

/** The report team's field-goal attempts of one season. */
export const ShotMap = Type.Object({
  key: Type.String({ description: "As in `Season`." }),
  players: Type.Array(Shooter, { description: "Most attempts first." }),
  makes: Int,
  attempts: Int,
  shots: Type.Array(Shot, { description: "In game order." }),
});
export type ShotMap = Static<typeof ShotMap>;

export const LastSeries = Type.Object({ round: Str, wins: Int, losses: Int, opponent: Str });
export type LastSeries = Static<typeof LastSeries>;

/** A stored season that ended with the title; the numbers are the Finals. */
export const Champion = Type.Object({ wins: Int, losses: Int, opponent: Str });
export type Champion = Static<typeof Champion>;

export const Opponent = Type.Object({ id: Int, abbreviation: Str, name: Str });
export type Opponent = Static<typeof Opponent>;

const gameProperties = {
  id: Str,
  startsAt: Type.String({ description: "ISO 8601 in UTC." }),
  home: Type.Boolean({ description: "True for the designated home team, also at a neutral site." }),
  neutral: Bool,
  opponent: Opponent,
  venue: Nullable(Str),
  attendance: Nullable(Int),
  note: Nullable(Str),
  periods: Int,
  pts: Int,
  oppPts: Int,
  usByPeriod: Type.Array(Int, { description: "Points by period, index 0 is Q1." }),
  themByPeriod: Type.Array(Int),
  offense: Type.Number({ description: "Points per 100 possessions in this game." }),
  defense: Num,
};

/** One game seen from the report team's side. */
export const Game = Type.Object(gameProperties);
export type Game = Static<typeof Game>;

export const TopScorer = Type.Object({ fullName: Str, pts: Int });
export type TopScorer = Static<typeof TopScorer>;

export const LatestGame = Type.Object({
  ...gameProperties,
  topScorer: Nullable(TopScorer),
});
export type LatestGame = Static<typeof LatestGame>;

export const Season = Type.Object({
  key: Type.String({ description: '"2027:2": ESPN season year and type.' }),
  year: Int,
  type: Type.Integer({ description: "2 regular season, 3 playoffs." }),
  label: Str,
  ratings: Ratings,
  games: Type.Array(Game, { description: "Oldest first." }),
  rolling: Type.Array(Rolling, {
    description: "The margin's running average over `games`, one entry per window length.",
  }),
  playerReport: PlayerReport,
});
export type Season = Static<typeof Season>;

/** `GET /api/report`. */
export const Report = Type.Object({
  syncedAt: Nullable(Type.String({ description: "ISO 8601 in UTC." })),
  gameCount: Int,
  replayedGames: Int,
  replayTolerance: Type.Integer({
    description: "A replay counts when every player's replayed plus-minus is within this many points of the box score.",
  }),
  pairMinSeconds: Type.Number({ description: "Pairings with less shared time than this are left blank." }),
  seasons: Type.Array(Season, { description: "Most recent first: current regular season, then older ones." }),
  currentKey: Nullable(Type.String({ description: "A key in `seasons`." })),
  lastRegularKey: Nullable(Str),
  latestGame: Nullable(LatestGame),
  headline: Nullable(Headline),
  lastSeries: Nullable(LastSeries),
  champion: Nullable(Champion),
  quarters: Nullable(
    Type.Array(QuarterRow, {
      description: "Current season against last regular season; null without a current season.",
    }),
  ),
  factors: Nullable(Factors),
  situations: Nullable(Type.Array(Situation)),
});
export type Report = Static<typeof Report>;

/** `GET /api/shots`: each season's shot map, most recent season first. */
export const ShotMaps = Type.Array(ShotMap);

/** `GET /api/games/{id}`. */
export const GameDetail = Type.Object({
  ...gameProperties,
  replayed: Type.Boolean({
    description: "False when the lineup replay is too far from the box score to show stints.",
  }),
  replayTolerance: Int,
  flow: Type.Array(GameMoment, { description: "The score after every play that changed it, starting at 0-0." }),
  us: GameSide,
  them: GameSide,
  players: Type.Array(GamePlayer),
  opponents: Type.Array(GamePlayer),
});
export type GameDetail = Static<typeof GameDetail>;

/** A game the player appeared in, with their line. */
export const PlayerLogGame = Type.Object({ ...gameProperties, line: GamePlayer });
export type PlayerLogGame = Static<typeof PlayerLogGame>;

/** One season of a player. */
export const PlayerSeason = Type.Object({
  key: Type.String({ description: "As in `Season`." }),
  label: Str,
  row: PlayerRow,
  wins: Type.Integer({ description: "The team's wins in the games the player appeared in." }),
  losses: Int,
  games: Type.Array(PlayerLogGame, { description: "Oldest first." }),
});
export type PlayerSeason = Static<typeof PlayerSeason>;

/** `GET /api/players/{id}`. */
export const PlayerDetail = Type.Object({
  id: Int,
  name: Str,
  position: Nullable(Str),
  seasons: Type.Array(PlayerSeason, {
    description: "Most recent first, as in the report; only seasons the player appeared in.",
  }),
});
export type PlayerDetail = Static<typeof PlayerDetail>;

/** `GET /api/sync`. */
export const SyncStatus = Type.Object({
  checkedAt: Nullable(
    Type.String({ description: "When a sync last ran to the end, ISO 8601 in UTC; null before the first." }),
  ),
});
export type SyncStatus = Static<typeof SyncStatus>;

/** `POST /api/sync`. */
export const SyncOutcome = Type.Object({
  busy: Type.Boolean({ description: "True when another sync was running, so this request started none." }),
  added: Type.Integer({ description: "Games stored for the first time." }),
  updated: Type.Integer({ description: "Games that were stored before and written again." }),
  checkedAt: Nullable(Str),
});
export type SyncOutcome = Static<typeof SyncOutcome>;

/** The path parameter of a game or player route: ESPN's numeric id. */
export const IdParams = Type.Object({ id: Type.String({ pattern: "^[0-9]{1,20}$" }) });
export type IdParams = Static<typeof IdParams>;

/** Routes without a query string or a body read none: unknown query keys are dropped before the handler runs. */
export const NoQuery = Type.Object({}, { additionalProperties: false });
export const NoBody = Type.Null();

/** The plain-text answer of an error status. */
export const Message = Type.String();
