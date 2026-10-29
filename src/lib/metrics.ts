export interface ShotLine {
  fgm: number;
  fga: number;
  tpm: number;
  tpa: number;
  ftm: number;
  fta: number;
  oreb: number;
  dreb: number;
  ast: number;
  stl: number;
  blk: number;
  tov: number;
  pf: number;
  pts: number;
}

/** Box-score possessions: FGA − OREB + TOV + 0.44 × FTA. */
export function possessions(line: {
  fga: number;
  oreb: number;
  tov: number;
  fta: number;
}): number {
  return line.fga - line.oreb + line.tov + 0.44 * line.fta;
}

export function efg(fgm: number, tpm: number, fga: number): number {
  if (fga <= 0) return 0;
  return (fgm + 0.5 * tpm) / fga;
}

export function trueShooting(pts: number, fga: number, fta: number): number {
  const denom = 2 * (fga + 0.44 * fta);
  if (denom <= 0) return 0;
  return pts / denom;
}

export function turnoverRate(tov: number, fga: number, fta: number): number {
  const denom = fga + 0.44 * fta + tov;
  if (denom <= 0) return 0;
  return tov / denom;
}

export function reboundRate(own: number, opp: number): number {
  const denom = own + opp;
  if (denom <= 0) return 0;
  return own / denom;
}

export function freeThrowRate(fta: number, fga: number): number {
  if (fga <= 0) return 0;
  return fta / fga;
}

export function offensiveRating(pts: number, poss: number): number {
  if (poss <= 0) return 0;
  return (100 * pts) / poss;
}

/** Hollinger game score, from the box score. */
export function gameScore(p: ShotLine): number {
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

export function usageRate(
  player: { fga: number; fta: number; tov: number; minutes: number },
  team: { fga: number; fta: number; tov: number; minutes: number },
): number {
  if (player.minutes <= 0 || team.minutes <= 0) return 0;
  const teamUse = team.fga + 0.44 * team.fta + team.tov;
  if (teamUse <= 0) return 0;
  const playerUse = player.fga + 0.44 * player.fta + player.tov;
  return (100 * (playerUse * (team.minutes / 5))) / (player.minutes * teamUse);
}

export function per48(value: number, seconds: number): number | null {
  if (seconds < 90) return null;
  return (value / seconds) * 48 * 60;
}

export function netPer48(scored: number, allowed: number, seconds: number): number | null {
  const margin = per48(scored - allowed, seconds);
  return margin;
}
