export const KNICKS_TEAM_ID = "18";

export type Phase = "regular" | "playoffs";

export interface QuarterScore {
  period: number;
  label: string;
  knicks: number;
  opponent: number;
}

export interface TeamBox {
  fgm: number;
  fga: number;
  tpm: number;
  tpa: number;
  ftm: number;
  fta: number;
  oreb: number;
  dreb: number;
  reb: number;
  ast: number;
  stl: number;
  blk: number;
  tov: number;
  pf: number;
  pts: number;
  paint: number;
  fastBreak: number;
  pointsOffTurnovers: number;
  largestLead: number;
  leadChanges: number;
  leadPercent: number;
}

export interface PlayerQuarter {
  period: number;
  pts: number;
  ast: number;
  reb: number;
  oreb: number;
  dreb: number;
  stl: number;
  blk: number;
  tov: number;
  pf: number;
  fgm: number;
  fga: number;
  tpm: number;
  tpa: number;
  ftm: number;
  fta: number;
  onPts: number;
  onOpp: number;
  seconds: number;
  plusMinus: number;
}

export interface PlayerGame {
  id: string;
  name: string;
  shortName: string;
  position: string;
  jersey: string;
  starter: boolean;
  didNotPlay: boolean;
  reason: string | null;
  minutes: number;
  pts: number;
  fgm: number;
  fga: number;
  tpm: number;
  tpa: number;
  ftm: number;
  fta: number;
  oreb: number;
  dreb: number;
  reb: number;
  ast: number;
  stl: number;
  blk: number;
  tov: number;
  pf: number;
  plusMinus: number;
  onPts: number;
  onOpp: number;
  onSeconds: number;
  quarters: PlayerQuarter[];
}

export interface FlowPoint {
  period: number;
  clock: number;
  elapsed: number;
  margin: number;
  knicks: number;
  opponent: number;
}

/** Two Knicks on the floor at the same time. Ids are sorted. */
export interface CourtPair {
  a: string;
  b: string;
  seconds: number;
  pts: number;
  opp: number;
}

/** A Knicks field-goal attempt. x is 0–50, y is feet from the rim (negative is the corner). */
export interface Shot {
  playerId: string;
  period: number;
  x: number;
  y: number;
  made: boolean;
  value: 2 | 3;
}

export interface Game {
  id: string;
  season: string;
  seasonYear: number;
  phase: Phase;
  series: string | null;
  date: string;
  opponentId: string;
  opponentAbbr: string;
  opponentName: string;
  home: boolean;
  neutral: boolean;
  win: boolean;
  knicksScore: number;
  opponentScore: number;
  venue: string;
  attendance: number | null;
  quarters: QuarterScore[];
  team: TeamBox;
  opponent: TeamBox;
  players: PlayerGame[];
  opponentPlayers: PlayerGame[];
  flow: FlowPoint[];
  /** Max absolute gap between reconstructed plus-minus and the box score. */
  lineupError: number;
  /** Shared on-court time for each Knicks pairing. Missing on older snapshots. */
  pairs?: CourtPair[];
  /** Field-goal attempts with court coordinates. Free throws are left out. */
  shots?: Shot[];
}

export interface Store {
  version: 1;
  updatedAt: string;
  checkedAt: string;
  source: "ESPN";
  teamId: typeof KNICKS_TEAM_ID;
  games: Game[];
}

export interface GameMeta {
  season: string;
  seasonYear: number;
  phase: Phase;
  series: string | null;
}
