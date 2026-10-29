/**
 * A few final games 404 on the site summary endpoint but still exist on the
 * core API. This rebuilds the summary shape the box-score parser expects.
 */

const CORE = "https://sports.core.api.espn.com/v2/sports/basketball/leagues/nba/events";

type Dict = Record<string, unknown>;

function rec(value: unknown): Dict {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Dict) : {};
}

function arr(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

async function getJson(url: string): Promise<Dict> {
  const response = await fetch(url.replace(/^http:\/\//, "https://"), {
    headers: { Accept: "application/json", "User-Agent": "knicks-game-to-game/1.0" },
    cache: "no-store",
  });
  if (!response.ok) throw new Error(`${response.status} ${url}`);
  return (await response.json()) as Dict;
}

function idFromRef(ref: unknown): string {
  const match = String(ref ?? "").match(/\/(?:athletes|teams|competitors)\/(\d+)/);
  return match?.[1] ?? "";
}

async function pool<T, R>(items: T[], size: number, worker: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;
  async function run() {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await worker(items[index]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(size, items.length) }, () => run()));
  return results;
}

function statMap(payload: Dict): Map<string, string> {
  const map = new Map<string, string>();
  const categories = arr(rec(payload.splits).categories);
  for (const category of categories) {
    for (const stat of arr(rec(category).stats)) {
      const row = rec(stat);
      const value = row.displayValue ?? row.value ?? "";
      map.set(String(row.name ?? ""), String(value));
    }
  }
  return map;
}

function statRow(name: string, displayValue: string) {
  return { name, displayValue };
}

export async function buildSummaryFromCore(eventId: string): Promise<unknown> {
  const base = `${CORE}/${eventId}/competitions/${eventId}`;
  const [competition, playPage] = await Promise.all([
    getJson(`${base}?lang=en`),
    getJson(`${base}/plays?limit=1000&lang=en`),
  ]);
  let plays = arr(playPage.items);
  const pages = Number(playPage.pageCount ?? 1);
  for (let page = 2; page <= pages; page += 1) {
    const next = await getJson(`${base}/plays?limit=1000&page=${page}&lang=en`);
    plays = plays.concat(arr(next.items));
  }

  const competitors = arr(rec(await getJson(`${base}/competitors?lang=en`)).items).map((item) => rec(item));
  const sides = await pool(competitors, 2, async (competitor) => {
    const teamId = idFromRef(rec(competitor.team).$ref) || String(competitor.id ?? "");
    const [team, roster, statistics, linescores, score] = await Promise.all([
      getJson(String(rec(competitor.team).$ref)),
      getJson(`${base}/competitors/${competitor.id}/roster?lang=en`),
      getJson(`${base}/competitors/${competitor.id}/statistics?lang=en`),
      getJson(`${base}/competitors/${competitor.id}/linescores?lang=en`),
      getJson(`${base}/competitors/${competitor.id}/score?lang=en`),
    ]);
    const entries = arr(roster.entries).map((entry) => rec(entry));
    const athletes = await pool(entries, 6, async (entry) => {
      const athlete = await getJson(String(rec(entry.athlete).$ref));
      const statisticsPayload = entry.didNotPlay
        ? {}
        : await getJson(`${base}/competitors/${competitor.id}/roster/${entry.playerId}/statistics/0?lang=en`);
      return { entry, athlete, stats: statMap(statisticsPayload) };
    });
    return { competitor, teamId, team, statistics: statMap(statistics), linescores, score, athletes };
  });

  const teamStatistics = (stats: Map<string, string>) => {
    const pair = (made: string, att: string) => `${stats.get(made) ?? "0"}-${stats.get(att) ?? "0"}`;
    return [
      statRow("fieldGoalsMade-fieldGoalsAttempted", pair("fieldGoalsMade", "fieldGoalsAttempted")),
      statRow("threePointFieldGoalsMade-threePointFieldGoalsAttempted", pair("threePointFieldGoalsMade", "threePointFieldGoalsAttempted")),
      statRow("freeThrowsMade-freeThrowsAttempted", pair("freeThrowsMade", "freeThrowsAttempted")),
      statRow("totalRebounds", stats.get("totalRebounds") ?? stats.get("rebounds") ?? "0"),
      statRow("offensiveRebounds", stats.get("offensiveRebounds") ?? "0"),
      statRow("defensiveRebounds", stats.get("defensiveRebounds") ?? "0"),
      statRow("assists", stats.get("assists") ?? "0"),
      statRow("steals", stats.get("steals") ?? "0"),
      statRow("blocks", stats.get("blocks") ?? "0"),
      statRow("turnovers", stats.get("turnovers") ?? "0"),
      statRow("totalTurnovers", stats.get("totalTurnovers") ?? stats.get("turnovers") ?? "0"),
      statRow("fouls", stats.get("fouls") ?? "0"),
      statRow("pointsInPaint", stats.get("pointsInPaint") ?? "0"),
      statRow("fastBreakPoints", stats.get("fastBreakPoints") ?? "0"),
      statRow("turnoverPoints", stats.get("turnoverPoints") ?? "0"),
      statRow("largestLead", stats.get("largestLead") ?? "0"),
      statRow("leadChanges", stats.get("leadChanges") ?? "0"),
      statRow("leadPercentage", stats.get("leadPercentage") ?? "0"),
    ];
  };

  const playerKeys = [
    "minutes",
    "points",
    "fieldGoalsMade-fieldGoalsAttempted",
    "threePointFieldGoalsMade-threePointFieldGoalsAttempted",
    "freeThrowsMade-freeThrowsAttempted",
    "rebounds",
    "assists",
    "turnovers",
    "steals",
    "blocks",
    "offensiveRebounds",
    "defensiveRebounds",
    "fouls",
    "plusMinus",
  ];

  return {
    header: {
      id: eventId,
      competitions: [
        {
          id: eventId,
          date: competition.date,
          neutralSite: Boolean(competition.neutralSite),
          competitors: sides.map((side) => ({
            homeAway: side.competitor.homeAway,
            winner: side.competitor.winner,
            score: rec(side.score).displayValue ?? rec(side.score).value ?? "",
            linescores: arr(side.linescores.items).map((line) => ({ displayValue: String(rec(line).displayValue ?? rec(line).value ?? "0") })),
            team: {
              id: side.teamId,
              abbreviation: side.team.abbreviation,
              displayName: side.team.displayName,
              shortDisplayName: side.team.shortDisplayName,
            },
          })),
        },
      ],
    },
    gameInfo: {
      venue: { fullName: "" },
      attendance: competition.attendance ?? null,
    },
    boxscore: {
      teams: sides.map((side) => ({
        team: { id: side.teamId },
        statistics: teamStatistics(side.statistics),
      })),
      players: sides.map((side) => ({
        team: { id: side.teamId },
        statistics: [
          {
            keys: playerKeys,
            athletes: side.athletes.map(({ entry, athlete, stats }) => {
              const pair = (made: string, att: string) => `${stats.get(made) ?? "0"}-${stats.get(att) ?? "0"}`;
              const values: Record<string, string> = {
                minutes: stats.get("minutes") ?? "0",
                points: stats.get("points") ?? "0",
                "fieldGoalsMade-fieldGoalsAttempted": pair("fieldGoalsMade", "fieldGoalsAttempted"),
                "threePointFieldGoalsMade-threePointFieldGoalsAttempted": pair("threePointFieldGoalsMade", "threePointFieldGoalsAttempted"),
                "freeThrowsMade-freeThrowsAttempted": pair("freeThrowsMade", "freeThrowsAttempted"),
                rebounds: stats.get("rebounds") ?? stats.get("totalRebounds") ?? "0",
                assists: stats.get("assists") ?? "0",
                turnovers: stats.get("turnovers") ?? "0",
                steals: stats.get("steals") ?? "0",
                blocks: stats.get("blocks") ?? "0",
                offensiveRebounds: stats.get("offensiveRebounds") ?? "0",
                defensiveRebounds: stats.get("defensiveRebounds") ?? "0",
                fouls: stats.get("fouls") ?? "0",
                plusMinus: stats.get("plusMinus") ?? "0",
              };
              const position = rec(athlete.position);
              return {
                starter: Boolean(entry.starter),
                didNotPlay: Boolean(entry.didNotPlay),
                reason: entry.reason ?? "",
                stats: playerKeys.map((key) => values[key] ?? ""),
                athlete: {
                  id: String(entry.playerId ?? idFromRef(rec(entry.athlete).$ref)),
                  displayName: athlete.displayName ?? entry.displayName,
                  shortName: athlete.shortName ?? entry.displayName,
                  jersey: athlete.jersey ?? entry.jersey ?? "",
                  position: { abbreviation: position.abbreviation ?? "" },
                },
              };
            }),
          },
        ],
      })),
    },
    plays: plays.map((play) => {
      const row = rec(play);
      const participants = arr(row.participants)
        .map((part) => rec(part))
        .sort((a, b) => Number(a.order ?? 0) - Number(b.order ?? 0));
      return {
        sequenceNumber: row.sequenceNumber,
        type: row.type,
        text: row.text,
        awayScore: row.awayScore,
        homeScore: row.homeScore,
        period: row.period,
        clock: { displayValue: rec(row.clock).displayValue },
        scoringPlay: row.scoringPlay,
        scoreValue: row.scoreValue,
        shootingPlay: row.shootingPlay,
        pointsAttempted: row.pointsAttempted,
        team: { id: idFromRef(rec(row.team).$ref) },
        participants: participants.map((part) => ({ athlete: { id: idFromRef(rec(part.athlete).$ref) } })),
      };
    }),
  };
}
