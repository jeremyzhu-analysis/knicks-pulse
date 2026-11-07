import {
  clockSeconds,
  elapsedSeconds,
  periodLength,
  quarterLabel,
} from "@/lib/clock";
import { KNICKS_TEAM_ID, type Game, type GameMeta, type PlayerGame, type PlayerQuarter, type Shot, type TeamBox } from "@/lib/types";

type Dict = Record<string, unknown>;

function rec(value: unknown): Dict {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Dict) : {};
}

function arr(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function str(value: unknown): string {
  if (typeof value === "string") return value;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return "";
}

function num(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "string") return 0;
  const cleaned = value.replace(/[+]/g, "").replace(/[—–-]+/g, (m) => (m.length ? "-" : m)).trim();
  if (!cleaned || cleaned === "--" || cleaned === "-") return 0;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : 0;
}

function scoreValue(value: unknown): number {
  if (typeof value === "number") return value;
  if (typeof value === "string") return num(value);
  const box = rec(value);
  if ("value" in box) return num(box.value);
  if ("displayValue" in box) return num(box.displayValue);
  return 0;
}

function splitMade(raw: string): [number, number] {
  const [made, att] = raw.split("-");
  return [num(made), num(att)];
}

function parseMinutes(raw: string): number {
  if (!raw || raw === "--") return 0;
  if (raw.includes(":")) {
    const [m, s] = raw.split(":");
    return num(m) + num(s) / 60;
  }
  return num(raw);
}

function emptyQuarter(period: number): PlayerQuarter {
  return {
    period,
    pts: 0,
    ast: 0,
    reb: 0,
    oreb: 0,
    dreb: 0,
    stl: 0,
    blk: 0,
    tov: 0,
    pf: 0,
    fgm: 0,
    fga: 0,
    tpm: 0,
    tpa: 0,
    ftm: 0,
    fta: 0,
    onPts: 0,
    onOpp: 0,
    seconds: 0,
    plusMinus: 0,
  };
}

function parseTeamBox(statistics: unknown, pts: number): TeamBox {
  const map = new Map<string, string>();
  for (const item of arr(statistics)) {
    const row = rec(item);
    map.set(str(row.name), str(row.displayValue));
  }
  const [fgm, fga] = splitMade(map.get("fieldGoalsMade-fieldGoalsAttempted") ?? "0-0");
  const [tpm, tpa] = splitMade(map.get("threePointFieldGoalsMade-threePointFieldGoalsAttempted") ?? "0-0");
  const [ftm, fta] = splitMade(map.get("freeThrowsMade-freeThrowsAttempted") ?? "0-0");
  const oreb = num(map.get("offensiveRebounds"));
  const dreb = num(map.get("defensiveRebounds"));
  return {
    fgm,
    fga,
    tpm,
    tpa,
    ftm,
    fta,
    oreb,
    dreb,
    reb: num(map.get("totalRebounds")) || oreb + dreb,
    ast: num(map.get("assists")),
    stl: num(map.get("steals")),
    blk: num(map.get("blocks")),
    tov: num(map.get("totalTurnovers")) || num(map.get("turnovers")),
    pf: num(map.get("fouls")),
    pts,
    paint: num(map.get("pointsInPaint")),
    fastBreak: num(map.get("fastBreakPoints")),
    pointsOffTurnovers: num(map.get("turnoverPoints")),
    largestLead: num(map.get("largestLead")),
    leadChanges: num(map.get("leadChanges")),
    leadPercent: num(map.get("leadPercentage")),
  };
}

interface ListedPlayer {
  game: PlayerGame;
  teamId: string;
}

function parseListedPlayers(boxscore: Dict): ListedPlayer[] {
  const listed: ListedPlayer[] = [];
  for (const side of arr(boxscore.players)) {
    const sideRec = rec(side);
    const teamId = str(rec(sideRec.team).id);
    const group = rec(arr(sideRec.statistics)[0]);
    const keys = arr(group.keys).map((key) => str(key));
    for (const athlete of arr(group.athletes)) {
      const row = rec(athlete);
      const person = rec(row.athlete);
      const stats = arr(row.stats).map((value) => str(value));
      const read = (key: string) => stats[keys.indexOf(key)] ?? "";
      const didNotPlay = Boolean(row.didNotPlay);
      const [fgm, fga] = splitMade(read("fieldGoalsMade-fieldGoalsAttempted"));
      const [tpm, tpa] = splitMade(read("threePointFieldGoalsMade-threePointFieldGoalsAttempted"));
      const [ftm, fta] = splitMade(read("freeThrowsMade-freeThrowsAttempted"));
      const oreb = num(read("offensiveRebounds"));
      const dreb = num(read("defensiveRebounds"));
      const game: PlayerGame = {
        id: str(person.id),
        name: str(person.displayName),
        shortName: str(person.shortName) || str(person.displayName),
        position: str(rec(person.position).abbreviation) || str(rec(person.position).displayName),
        jersey: str(person.jersey),
        starter: Boolean(row.starter),
        didNotPlay,
        reason: didNotPlay ? str(row.reason) || null : null,
        minutes: didNotPlay ? 0 : parseMinutes(read("minutes")),
        pts: didNotPlay ? 0 : num(read("points")),
        fgm: didNotPlay ? 0 : fgm,
        fga: didNotPlay ? 0 : fga,
        tpm: didNotPlay ? 0 : tpm,
        tpa: didNotPlay ? 0 : tpa,
        ftm: didNotPlay ? 0 : ftm,
        fta: didNotPlay ? 0 : fta,
        oreb: didNotPlay ? 0 : oreb,
        dreb: didNotPlay ? 0 : dreb,
        reb: didNotPlay ? 0 : num(read("rebounds")),
        ast: didNotPlay ? 0 : num(read("assists")),
        stl: didNotPlay ? 0 : num(read("steals")),
        blk: didNotPlay ? 0 : num(read("blocks")),
        tov: didNotPlay ? 0 : num(read("turnovers")),
        pf: didNotPlay ? 0 : num(read("fouls")),
        plusMinus: didNotPlay ? 0 : num(read("plusMinus")),
        onPts: 0,
        onOpp: 0,
        onSeconds: 0,
        quarters: [],
      };
      if (game.id) listed.push({ game, teamId });
    }
  }
  return listed;
}

function bump(map: Map<string, Map<number, PlayerQuarter>>, id: string, period: number): PlayerQuarter {
  let periods = map.get(id);
  if (!periods) {
    periods = new Map();
    map.set(id, periods);
  }
  let line = periods.get(period);
  if (!line) {
    line = emptyQuarter(period);
    periods.set(period, line);
  }
  return line;
}

/**
 * Replay the play-by-play. Starters open each game. Substitutions are applied
 * after the current play's score, and plays are ordered by period then clock
 * because ESPN sequence numbers can land a next-quarter sub ahead of a late
 * review in the previous quarter.
 */
function extractShots(plays: unknown[]): Shot[] {
  const shots: Shot[] = [];
  for (const raw of plays) {
    const play = rec(raw);
    if (!play.shootingPlay) continue;
    if (str(rec(play.team).id) !== KNICKS_TEAM_ID) continue;
    const typeText = str(rec(play.type).text);
    const text = str(play.text);
    if (/free throw/i.test(typeText) || /free throw/i.test(text)) continue;
    const coord = rec(play.coordinate);
    if (typeof coord.x !== "number" || typeof coord.y !== "number") continue;
    const x = coord.x;
    const y = coord.y;
    if (x < -2 || x > 52 || y < -8 || y > 45) continue;
    const playerId = arr(play.participants).map((part) => str(rec(rec(part).athlete).id)).find(Boolean);
    if (!playerId) continue;
    const made = Boolean(play.scoringPlay);
    const value: 2 | 3 = /three/i.test(text) || num(play.pointsAttempted) === 3 ? 3 : 2;
    shots.push({
      playerId,
      period: num(rec(play.period).number) || 1,
      x,
      y,
      made,
      value,
    });
  }
  return shots;
}

function replayPlays(
  plays: unknown[],
  listed: ListedPlayer[],
  knicksHome: boolean,
): { lineupError: number; flow: Game["flow"]; pairs: Game["pairs"] } {
  const byId = new Map(listed.map((row) => [row.game.id, row]));
  const lineup = new Map<string, Set<string>>();
  for (const row of listed) {
    if (!row.game.starter || row.game.didNotPlay) continue;
    const set = lineup.get(row.teamId) ?? new Set<string>();
    set.add(row.game.id);
    lineup.set(row.teamId, set);
  }

  const quarters = new Map<string, Map<number, PlayerQuarter>>();
  const ordered = plays
    .map((play) => rec(play))
    .filter((play) => str(rec(play.period).number) || num(rec(play.period).number))
    .sort((a, b) => {
      const ap = num(rec(a.period).number);
      const bp = num(rec(b.period).number);
      if (ap !== bp) return ap - bp;
      const ac = clockSeconds(str(rec(a.clock).displayValue));
      const bc = clockSeconds(str(rec(b.clock).displayValue));
      if (ac !== bc) return bc - ac;
      return num(a.sequenceNumber) - num(b.sequenceNumber);
    });

  let period = 1;
  let clock = periodLength(1);
  let knicksScore = 0;
  let oppScore = 0;
  const flow: Game["flow"] = [];

  const knicksOnFloor = () => lineup.get(KNICKS_TEAM_ID) ?? new Set<string>();
  const pairs = new Map<string, { a: string; b: string; seconds: number; pts: number; opp: number }>();

  const knicksFive = (): string[] | null => {
    const ids = [...knicksOnFloor()].filter((id) => byId.get(id)?.teamId === KNICKS_TEAM_ID);
    if (ids.length !== 5) return null;
    ids.sort();
    return ids;
  };

  const eachPair = (apply: (row: { a: string; b: string; seconds: number; pts: number; opp: number }) => void) => {
    const ids = knicksFive();
    if (!ids) return;
    for (let i = 0; i < ids.length; i += 1) {
      for (let j = i + 1; j < ids.length; j += 1) {
        const a = ids[i];
        const b = ids[j];
        const key = `${a}:${b}`;
        let row = pairs.get(key);
        if (!row) {
          row = { a, b, seconds: 0, pts: 0, opp: 0 };
          pairs.set(key, row);
        }
        apply(row);
      }
    }
  };

  const creditSeconds = (seconds: number, atPeriod: number) => {
    if (seconds <= 0 || seconds > periodLength(atPeriod) + 2) return;
    for (const id of knicksOnFloor()) {
      const line = bump(quarters, id, atPeriod);
      line.seconds += seconds;
      const player = byId.get(id);
      if (player && player.teamId === KNICKS_TEAM_ID) player.game.onSeconds += seconds;
    }
    eachPair((row) => {
      row.seconds += seconds;
    });
  };

  const advanceClock = (nextPeriod: number, nextClock: number) => {
    while (period < nextPeriod) {
      creditSeconds(clock, period);
      period += 1;
      clock = periodLength(period);
    }
    if (nextPeriod === period) {
      const delta = clock - nextClock;
      if (delta > 0) creditSeconds(delta, period);
      if (nextClock < clock) clock = nextClock;
    }
  };

  const creditScore = (kDelta: number, oDelta: number, atPeriod: number) => {
    if (!kDelta && !oDelta) return;
    for (const id of knicksOnFloor()) {
      const line = bump(quarters, id, atPeriod);
      line.onPts += kDelta;
      line.onOpp += oDelta;
      line.plusMinus += kDelta - oDelta;
      const player = byId.get(id);
      if (player) {
        player.game.onPts += kDelta;
        player.game.onOpp += oDelta;
      }
    }
    eachPair((row) => {
      row.pts += kDelta;
      row.opp += oDelta;
    });
  };

  for (const play of ordered) {
    const playPeriod = num(rec(play.period).number) || period;
    const playClock = clockSeconds(str(rec(play.clock).displayValue));
    advanceClock(playPeriod, playClock);

    const hasScore = play.homeScore != null && play.awayScore != null;
    const homeScore = num(play.homeScore);
    const awayScore = num(play.awayScore);
    const nextKnicks = knicksHome ? homeScore : awayScore;
    const nextOpp = knicksHome ? awayScore : homeScore;
    const kDelta = hasScore ? nextKnicks - knicksScore : 0;
    const oDelta = hasScore ? nextOpp - oppScore : 0;
    if (kDelta || oDelta) {
      creditScore(kDelta, oDelta, period);
      knicksScore = nextKnicks;
      oppScore = nextOpp;
      flow.push({
        period,
        clock: playClock,
        elapsed: elapsedSeconds(period, playClock),
        margin: knicksScore - oppScore,
        knicks: knicksScore,
        opponent: oppScore,
      });
    }

    const typeText = str(rec(play.type).text);
    const text = str(play.text);
    const parts = arr(play.participants).map((part) => str(rec(rec(part).athlete).id)).filter(Boolean);
    const isFt = typeText.startsWith("Free Throw");
    const isThree = num(play.pointsAttempted) === 3 || /three/i.test(text);

    if (play.scoringPlay && parts[0]) {
      const line = bump(quarters, parts[0], period);
      const points = num(play.scoreValue) || (isFt ? 1 : isThree ? 3 : 2);
      line.pts += points;
      if (isFt) {
        line.ftm += 1;
        line.fta += 1;
      } else {
        line.fgm += 1;
        line.fga += 1;
        if (isThree) {
          line.tpm += 1;
          line.tpa += 1;
        }
      }
      if (/assists/i.test(text) && parts[1]) bump(quarters, parts[1], period).ast += 1;
    } else if (isFt && parts[0]) {
      bump(quarters, parts[0], period).fta += 1;
    } else if (
      parts[0] &&
      !/rebound|foul|turnover|timeout|substitution|challenge|jumpball|end /i.test(typeText) &&
      (play.shootingPlay || /misses|blocks/i.test(text))
    ) {
      const line = bump(quarters, parts[0], period);
      line.fga += 1;
      if (isThree) line.tpa += 1;
    }

    if (typeText === "Defensive Rebound" && parts[0]) bump(quarters, parts[0], period).dreb += 1;
    if (typeText === "Offensive Rebound" && parts[0]) bump(quarters, parts[0], period).oreb += 1;
    if (/turnover/i.test(typeText) && parts[0]) bump(quarters, parts[0], period).tov += 1;
    if (/steals/i.test(text) && parts[1]) bump(quarters, parts[1], period).stl += 1;
    if (/\bblocks\b/i.test(text) && parts[1]) bump(quarters, parts[1], period).blk += 1;
    if (/foul/i.test(typeText) && !/turnover/i.test(typeText) && parts[0]) {
      bump(quarters, parts[0], period).pf += 1;
    }

    if (typeText === "Substitution" && parts.length >= 2) {
      const teamId = str(rec(play.team).id);
      const on = lineup.get(teamId);
      if (on) {
        const enter = parts[0];
        const leave = parts[1];
        if (on.has(leave) && !on.has(enter)) {
          on.delete(leave);
          on.add(enter);
        }
      }
    }
  }

  creditSeconds(clock, period);

  let lineupError = 0;
  for (const row of listed) {
    if (row.teamId !== KNICKS_TEAM_ID) {
      row.game.quarters = [];
      row.game.onPts = 0;
      row.game.onOpp = 0;
      row.game.onSeconds = 0;
      continue;
    }
    if (!row.game.didNotPlay && row.game.minutes > 0) {
      const computed = row.game.onPts - row.game.onOpp;
      lineupError = Math.max(lineupError, Math.abs(computed - row.game.plusMinus));
    }
    const periodMap = quarters.get(row.game.id);
    row.game.quarters = periodMap
      ? [...periodMap.values()]
          .map((line) => ({ ...line, reb: line.oreb + line.dreb }))
          .sort((a, b) => a.period - b.period)
      : [];
  }

  const pairRows = [...pairs.values()].filter((row) => row.seconds > 0);
  return { lineupError, flow, pairs: pairRows };
}

export function parseSummary(raw: unknown, meta: GameMeta): Game {
  const root = rec(raw);
  const header = rec(root.header);
  const competition = rec(arr(header.competitions)[0]);
  const competitors = arr(competition.competitors).map((item) => rec(item));
  const knicks = competitors.find((item) => str(rec(item.team).id) === KNICKS_TEAM_ID);
  const opponent = competitors.find((item) => str(rec(item.team).id) !== KNICKS_TEAM_ID);
  if (!knicks || !opponent) {
    throw new Error(`Summary ${str(header.id) || "unknown"} is missing a Knicks competitor.`);
  }

  const knicksLines = arr(knicks.linescores).map((line) => scoreValue(rec(line).displayValue ?? line));
  const oppLines = arr(opponent.linescores).map((line) => scoreValue(rec(line).displayValue ?? line));
  const periods = Math.max(knicksLines.length, oppLines.length, 4);
  const quarters = Array.from({ length: periods }, (_, index) => {
    const period = index + 1;
    return {
      period,
      label: quarterLabel(period),
      knicks: knicksLines[index] ?? 0,
      opponent: oppLines[index] ?? 0,
    };
  });

  const knicksScore = scoreValue(knicks.score) || quarters.reduce((sum, quarter) => sum + quarter.knicks, 0);
  const opponentScore = scoreValue(opponent.score) || quarters.reduce((sum, quarter) => sum + quarter.opponent, 0);
  const knicksHome = str(knicks.homeAway) === "home";

  const boxscore = rec(root.boxscore);
  const teamRows = arr(boxscore.teams).map((item) => rec(item));
  const knicksTeam = teamRows.find((item) => str(rec(item.team).id) === KNICKS_TEAM_ID);
  const oppTeam = teamRows.find((item) => str(rec(item.team).id) !== KNICKS_TEAM_ID);

  const listed = parseListedPlayers(boxscore);
  const plays = arr(root.plays);
  const { lineupError, flow, pairs } = replayPlays(plays, listed, knicksHome);
  const shots = extractShots(plays);

  const info = rec(root.gameInfo);
  const venue = rec(info.venue);
  const season = rec(header.season);
  const seasonType = rec(header.seasonType || rec(competition.seasonType));
  const phase = meta.phase || (num(seasonType.type) === 3 ? "playoffs" : "regular");

  const players = listed.filter((row) => row.teamId === KNICKS_TEAM_ID).map((row) => row.game);
  const opponentPlayers = listed.filter((row) => row.teamId !== KNICKS_TEAM_ID).map((row) => row.game);

  return {
    id: str(header.id) || str(competition.id),
    season: meta.season || str(season.displayName),
    seasonYear: meta.seasonYear || num(season.year),
    phase,
    series: meta.series,
    date: str(competition.date) || str(header.date),
    opponentId: str(rec(opponent.team).id),
    opponentAbbr: str(rec(opponent.team).abbreviation),
    opponentName: str(rec(opponent.team).displayName) || str(rec(opponent.team).shortDisplayName),
    home: knicksHome,
    neutral: Boolean(competition.neutralSite),
    win: typeof knicks.winner === "boolean" ? knicks.winner : knicksScore > opponentScore,
    knicksScore,
    opponentScore,
    venue: str(venue.fullName),
    attendance: info.attendance == null ? null : num(info.attendance) || null,
    quarters,
    team: parseTeamBox(knicksTeam?.statistics, knicksScore),
    opponent: parseTeamBox(oppTeam?.statistics, opponentScore),
    players,
    opponentPlayers,
    flow,
    lineupError,
    pairs,
    shots,
  };
}
