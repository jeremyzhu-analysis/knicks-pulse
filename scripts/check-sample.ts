import { readFileSync } from "node:fs";
import { parseSummary } from "../src/lib/parse-summary";

const file = process.argv[2] ?? "/tmp/knicks-probe/summary-sample.json";
const raw = JSON.parse(readFileSync(file, "utf8"));
const game = parseSummary(raw, {
  season: "2026-27",
  seasonYear: 2027,
  phase: "regular",
  series: null,
});

console.log(
  `${game.opponentAbbr} ${game.home ? "home" : "away"} ${game.knicksScore}-${game.opponentScore} lineupError=${game.lineupError} players=${game.players.length} flow=${game.flow.length}`,
);
console.log(
  "quarters",
  game.quarters.map((q) => `${q.label} ${q.knicks}-${q.opponent}`).join("  "),
);
console.log(
  "team",
  `FG ${game.team.fgm}-${game.team.fga}`,
  `3P ${game.team.tpm}-${game.team.tpa}`,
  `TOV ${game.team.tov}`,
  `OREB ${game.team.oreb}`,
);

let ptsOff = 0;
let minOff = 0;
for (const player of game.players) {
  if (player.didNotPlay) continue;
  const qpts = player.quarters.reduce((sum, quarter) => sum + quarter.pts, 0);
  const qpm = player.quarters.reduce((sum, quarter) => sum + quarter.plusMinus, 0);
  const minutes = player.onSeconds / 60;
  if (qpts !== player.pts) {
    ptsOff += 1;
    console.log(`PTS ${player.shortName} box ${player.pts} pbp ${qpts}`);
  }
  if (Math.abs(qpm - player.plusMinus) > 0) {
    console.log(`PM  ${player.shortName} box ${player.plusMinus} quarters ${qpm} on ${player.onPts - player.onOpp}`);
  }
  if (Math.abs(minutes - player.minutes) > 2) {
    minOff += 1;
    console.log(`MIN ${player.shortName} box ${player.minutes.toFixed(1)} tracked ${minutes.toFixed(1)}`);
  }
}
console.log(`point mismatches ${ptsOff}, minute mismatches ${minOff}`);
