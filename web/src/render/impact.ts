import type { ImpactKind, PlayerRow } from "../../../server/schema.ts";

/** Under this many games the tooltip mentions the sample size. */
const SMALL_SAMPLE_GAMES = 10;

const LABELS: Record<ImpactKind, string> = {
  lowMinutes: "Low minutes",
  lineupDrag: "Lineup drag",
  twoWay: "Two-way",
  scoring: "Scoring",
  creation: "Creation",
  lineupLift: "Lineup lift",
  disruption: "Disruption",
  rimProtection: "Rim protection",
  rebounding: "Rebounding",
  mixed: "Mixed",
};

export function impactLabel(p: PlayerRow): string {
  return LABELS[p.impact.kind];
}

/** The tooltip: what put the player in the label, plus on/off and sample notes. */
export function impactTitle(p: PlayerRow): string {
  const games = `${p.gp} game${p.gp === 1 ? "" : "s"}`;
  if (p.impact.kind === "lowMinutes") return `${p.last}: ${p.minutes} min, ${games}.`;

  const fmt = (v: number) => (v > 0 ? "+" : v < 0 ? "−" : "") + Math.abs(v).toFixed(1);
  const floor =
    p.on48 === null || p.off48 === null
      ? ""
      : ` On ${fmt(p.on48)}, off ${fmt(p.off48)}. Opp ${p.opp48!.toFixed(1)}/48.`;
  const sample = p.gp < SMALL_SAMPLE_GAMES ? ` The sample is ${games}.` : "";
  const leads: Record<Exclude<ImpactKind, "lowMinutes">, () => string> = {
    lineupDrag: () => "lineup drag",
    twoWay: () => `${p.ppg.toFixed(1)} pts, ${p.spg.toFixed(1)} stl, ${p.bpg.toFixed(1)} blk`,
    scoring: () => `${p.ppg.toFixed(1)} pts, ${(p.ts * 100).toFixed(1)}% TS`,
    creation: () => `${p.apg.toFixed(1)} ast, ${p.topg.toFixed(1)} tov`,
    lineupLift: () => "lineup lift",
    disruption: () => `${p.spg.toFixed(1)} stl`,
    rimProtection: () => `${p.bpg.toFixed(1)} blk`,
    rebounding: () => `${p.rpg.toFixed(1)} reb`,
    mixed: () => `${p.ppg.toFixed(1)} / ${p.rpg.toFixed(1)} / ${p.apg.toFixed(1)}`,
  };
  return `${p.last}: ${leads[p.impact.kind]()}.${floor}${sample}`;
}
