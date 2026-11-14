//! A game from ESPN's core API, for the finished games whose site summary
//! answers 404. The core API spreads a game over many small documents linked
//! by `$ref` URLs; this reads the ones that make up a `GameSummary`.

use anyhow::{Result, anyhow};
use serde_json::Value;

use crate::espn::{
    Espn, GameSummary, Period, Play, PlayerBox, Team, TeamBox, court_position, int, parse_clock,
    parse_espn_date, truncate,
};

const HOST: &str = "https://sports.core.api.espn.com/";
const EVENTS: &str = "https://sports.core.api.espn.com/v2/sports/basketball/leagues/nba/events";

/// The documents of one game, as fetched.
struct Documents {
    competition: Value,
    plays: Vec<Value>,
    sides: Vec<Side>,
}

struct Side {
    competitor: Value,
    team: Value,
    statistics: Value,
    linescores: Value,
    score: Value,
    players: Vec<RosterPlayer>,
}

/// A roster entry of a player who played.
struct RosterPlayer {
    entry: Value,
    athlete: Value,
    statistics: Value,
}

impl Espn {
    /// The core API has no season or series note on a game, so the caller
    /// passes the ones from the schedule that listed it. Requests go out one
    /// at a time: about 65 for a game.
    pub async fn core_game_summary(
        &self,
        game_id: &str,
        season_year: i64,
        season_type: i64,
        note: Option<String>,
    ) -> Result<GameSummary> {
        let base = format!("{EVENTS}/{game_id}/competitions/{game_id}");
        let competition: Value = self.get_json(&format!("{base}?lang=en")).await?;

        let mut plays = Vec::new();
        let mut page = 1;
        loop {
            let mut json: Value = self
                .get_json(&format!("{base}/plays?limit=1000&page={page}&lang=en"))
                .await?;
            if let Some(items) = json["items"].as_array_mut() {
                plays.append(items);
            }
            if page >= json["pageCount"].as_i64().unwrap_or(1) {
                break;
            }
            page += 1;
        }

        let mut sides = Vec::new();
        for competitor in competition["competitors"].as_array().into_iter().flatten() {
            let id = text(&competitor["id"]);
            let of_side = format!("{base}/competitors/{id}");
            let team = self.get_ref(&competitor["team"]).await?;
            let roster: Value = self.get_json(&format!("{of_side}/roster?lang=en")).await?;
            let statistics = self
                .get_json(&format!("{of_side}/statistics?lang=en"))
                .await?;
            let linescores = self
                .get_json(&format!("{of_side}/linescores?lang=en"))
                .await?;
            let score = self.get_json(&format!("{of_side}/score?lang=en")).await?;
            let mut players = Vec::new();
            for entry in roster["entries"].as_array().into_iter().flatten() {
                if entry["didNotPlay"].as_bool() == Some(true) {
                    continue;
                }
                let player_id = number(&entry["playerId"]);
                players.push(RosterPlayer {
                    athlete: self.get_ref(&entry["athlete"]).await?,
                    statistics: self
                        .get_json(&format!(
                            "{of_side}/roster/{player_id}/statistics/0?lang=en"
                        ))
                        .await?,
                    entry: entry.clone(),
                });
            }
            sides.push(Side {
                competitor: competitor.clone(),
                team,
                statistics,
                linescores,
                score,
                players,
            });
        }

        build(
            game_id,
            season_year,
            season_type,
            note,
            Documents {
                competition,
                plays,
                sides,
            },
        )
    }

    /// Follows a `{"$ref": url}` link. ESPN writes these with http; they are
    /// fetched over https, and only from the core API's own host.
    async fn get_ref(&self, link: &Value) -> Result<Value> {
        let url = link["$ref"]
            .as_str()
            .ok_or_else(|| anyhow!("ESPN core document has no $ref"))?;
        let url = url.replacen("http://", "https://", 1);
        if !url.starts_with(HOST) {
            return Err(anyhow!("ESPN core $ref points elsewhere: {url}"));
        }
        self.get_json(&url).await
    }
}

/// The game was listed as completed by the schedule that led here, so it is
/// reported as completed.
fn build(
    game_id: &str,
    season_year: i64,
    season_type: i64,
    note: Option<String>,
    docs: Documents,
) -> Result<GameSummary> {
    let side = |name: &str| {
        docs.sides
            .iter()
            .find(|s| s.competitor["homeAway"].as_str() == Some(name))
    };
    let (Some(home), Some(away)) = (side("home"), side("away")) else {
        return Err(anyhow!("Game {game_id} is missing a team"));
    };
    let team_id = |s: &Side| number(&s.team["id"]);
    let team = |s: &Side| Team {
        id: team_id(s),
        abbreviation: text(&s.team["abbreviation"]),
        display_name: text(&s.team["displayName"]),
        short_name: text(&s.team["name"]),
    };

    let mut team_boxes = Vec::new();
    let mut player_boxes = Vec::new();
    let mut periods = Vec::new();
    for s in [home, away] {
        let team_stat = |name: &str| stat(&s.statistics, name);
        team_boxes.push(TeamBox {
            team_id: team_id(s),
            pts: number(&s.score["value"]),
            fgm: team_stat("fieldGoalsMade"),
            fga: team_stat("fieldGoalsAttempted"),
            fg3m: team_stat("threePointFieldGoalsMade"),
            fg3a: team_stat("threePointFieldGoalsAttempted"),
            ftm: team_stat("freeThrowsMade"),
            fta: team_stat("freeThrowsAttempted"),
            oreb: team_stat("offensiveRebounds"),
            dreb: team_stat("defensiveRebounds"),
            ast: team_stat("assists"),
            stl: team_stat("steals"),
            blk: team_stat("blocks"),
            tov: match team_stat("totalTurnovers") {
                0 => team_stat("turnovers"),
                total => total,
            },
            paint_pts: team_stat("pointsInPaint"),
            fast_break_pts: team_stat("fastBreakPoints"),
            pts_off_tov: team_stat("turnoverPoints"),
        });
        for p in &s.players {
            let player_stat = |name: &str| stat(&p.statistics, name);
            let full_name = [&p.athlete["displayName"], &p.entry["displayName"]]
                .into_iter()
                .find_map(Value::as_str)
                .ok_or_else(|| anyhow!("Game {game_id}: a player who played has no name"))?;
            player_boxes.push(PlayerBox {
                player_id: number(&p.entry["playerId"]),
                full_name: full_name.to_string(),
                position: p.athlete["position"]["abbreviation"]
                    .as_str()
                    .map(str::to_string),
                team_id: team_id(s),
                starter: p.entry["starter"].as_bool() == Some(true),
                minutes: player_stat("minutes"),
                pts: player_stat("points"),
                fgm: player_stat("fieldGoalsMade"),
                fga: player_stat("fieldGoalsAttempted"),
                fg3m: player_stat("threePointFieldGoalsMade"),
                fg3a: player_stat("threePointFieldGoalsAttempted"),
                ftm: player_stat("freeThrowsMade"),
                fta: player_stat("freeThrowsAttempted"),
                oreb: player_stat("offensiveRebounds"),
                dreb: player_stat("defensiveRebounds"),
                ast: player_stat("assists"),
                stl: player_stat("steals"),
                blk: player_stat("blocks"),
                tov: player_stat("turnovers"),
                pf: player_stat("fouls"),
                plus_minus: player_stat("plusMinus"),
            });
        }
        for (i, line) in s.linescores["items"]
            .as_array()
            .into_iter()
            .flatten()
            .enumerate()
        {
            periods.push(Period {
                team_id: team_id(s),
                period: i as i64 + 1,
                pts: number(&line["value"]),
            });
        }
    }

    let plays = docs
        .plays
        .iter()
        .map(|p| {
            let mut participants: Vec<&Value> =
                p["participants"].as_array().into_iter().flatten().collect();
            participants.sort_by_key(|x| number(&x["order"]));
            let participant = |i: usize| {
                participants
                    .get(i)
                    .and_then(|x| id_in_ref(&x["athlete"], "/athletes/"))
            };
            Play {
                period: number(&p["period"]["number"]),
                clock_seconds: parse_clock(p["clock"]["displayValue"].as_str().unwrap_or("")),
                type_text: truncate(p["type"]["text"].as_str().unwrap_or(""), 64),
                team_id: id_in_ref(&p["team"], "/teams/"),
                home_score: number(&p["homeScore"]),
                away_score: number(&p["awayScore"]),
                text: truncate(p["text"].as_str().unwrap_or(""), 255),
                players: [participant(0), participant(1), participant(2)],
                shooting: p["shootingPlay"].as_bool() == Some(true),
                score_value: number(&p["scoreValue"]),
                points_attempted: number(&p["pointsAttempted"]),
                position: court_position(
                    p["coordinate"]["x"].as_f64(),
                    p["coordinate"]["y"].as_f64(),
                ),
            }
        })
        .collect();

    let date = docs.competition["date"]
        .as_str()
        .ok_or_else(|| anyhow!("Game {game_id} has no date"))?;
    Ok(GameSummary {
        id: game_id.to_string(),
        completed: true,
        season_year,
        season_type,
        starts_at: parse_espn_date(date)?,
        home: team(home),
        away: team(away),
        home_score: number(&home.score["value"]),
        away_score: number(&away.score["value"]),
        periods,
        venue: docs.competition["venue"]["fullName"]
            .as_str()
            .map(str::to_string),
        note,
        neutral: docs.competition["neutralSite"].as_bool() == Some(true),
        attendance: docs.competition["attendance"].as_i64().filter(|&a| a > 0),
        team_boxes,
        player_boxes,
        plays,
    })
}

/// A count that ESPN writes as a number (often with ".0") or as a string.
fn number(value: &Value) -> i64 {
    match value {
        Value::Number(n) => n.as_f64().map_or(0, |n| n as i64),
        Value::String(s) => int(Some(s)),
        _ => 0,
    }
}

fn text(value: &Value) -> String {
    match value {
        Value::String(s) => s.clone(),
        Value::Number(n) => n.to_string(),
        _ => String::new(),
    }
}

/// A named stat of a statistics document, whichever category holds it; 0 when
/// it is absent.
fn stat(statistics: &Value, name: &str) -> i64 {
    statistics["splits"]["categories"]
        .as_array()
        .into_iter()
        .flatten()
        .flat_map(|c| c["stats"].as_array().into_iter().flatten())
        .find(|s| s["name"].as_str() == Some(name))
        .map_or(0, |s| number(&s["value"]))
}

/// The id after `marker` in a `$ref` URL: ".../athletes/3934672?lang=en".
fn id_in_ref(link: &Value, marker: &str) -> Option<i64> {
    let url = link["$ref"].as_str()?;
    let rest = &url[url.find(marker)? + marker.len()..];
    let digits = rest.bytes().take_while(u8::is_ascii_digit).count();
    rest[..digits].parse().ok()
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn stats(category: &str, values: &[(&str, f64)]) -> Value {
        let stats: Vec<Value> = values
            .iter()
            .map(|(name, value)| json!({"name": name, "value": value}))
            .collect();
        json!({"splits": {"categories": [{"name": category, "stats": stats}]}})
    }

    fn side(home_away: &str, id: i64, abbreviation: &str, score: f64) -> Side {
        Side {
            competitor: json!({"id": id.to_string(), "homeAway": home_away}),
            team: json!({"id": id.to_string(), "abbreviation": abbreviation,
                "displayName": format!("Team {abbreviation}"), "name": abbreviation}),
            statistics: stats(
                "offensive",
                &[
                    ("fieldGoalsMade", 37.0),
                    ("fieldGoalsAttempted", 86.0),
                    ("turnovers", 13.0),
                ],
            ),
            linescores: json!({"items": [{"value": 33.0}, {"value": 32.0}]}),
            score: json!({"value": score}),
            players: Vec::new(),
        }
    }

    #[test]
    fn builds_a_game_from_core_documents() {
        let mut home = side("home", 18, "NY", 119.0);
        home.players.push(RosterPlayer {
            entry: json!({"playerId": 3934672, "starter": true, "didNotPlay": false, "displayName": "Brunson"}),
            athlete: json!({"displayName": "Jalen Brunson", "position": {"abbreviation": "G"}}),
            statistics: stats("general", &[("minutes", 34.0), ("plusMinus", 6.0), ("fouls", 3.0)]),
        });
        let docs = Documents {
            competition: json!({"date": "2025-10-22T23:00Z", "attendance": 19812, "neutralSite": false,
                "venue": {"fullName": "Madison Square Garden"}}),
            plays: vec![json!({
                "type": {"text": "Jump Shot"}, "text": "Evan Mobley makes 11-foot two point shot",
                "awayScore": 2, "homeScore": 0, "period": {"number": 1},
                "clock": {"displayValue": "11:45"}, "scoreValue": 2, "shootingPlay": true,
                "pointsAttempted": 2, "coordinate": {"x": 26, "y": 12},
                "team": {"$ref": "http://sports.core.api.espn.com/v2/sports/basketball/leagues/nba/seasons/2026/teams/5?lang=en"},
                "participants": [
                    {"order": 2, "athlete": {"$ref": "http://x/seasons/2026/athletes/22?lang=en"}},
                    {"order": 1, "athlete": {"$ref": "http://x/seasons/2026/athletes/4432158?lang=en"}}
                ]
            })],
            sides: vec![side("away", 5, "CLE", 111.0), home],
        };
        let game = build("401809234", 2026, 2, Some("note".into()), docs).unwrap();

        assert_eq!((game.home.id, game.away.id), (18, 5));
        assert_eq!((game.home_score, game.away_score), (119, 111));
        assert_eq!(game.starts_at.to_string(), "2025-10-22T23:00:00Z");
        assert_eq!(game.venue.as_deref(), Some("Madison Square Garden"));
        assert_eq!((game.neutral, game.attendance), (false, Some(19812)));
        assert_eq!((game.season_year, game.season_type), (2026, 2));
        let knicks = &game.team_boxes[0];
        assert_eq!(
            (
                knicks.team_id,
                knicks.pts,
                knicks.fgm,
                knicks.fga,
                knicks.tov
            ),
            (18, 119, 37, 86, 13)
        );
        assert_eq!(game.periods.len(), 4);
        assert_eq!((game.periods[1].period, game.periods[1].pts), (2, 32));
        let p = &game.player_boxes[0];
        assert_eq!(
            (
                p.player_id,
                p.full_name.as_str(),
                p.position.as_deref(),
                p.starter
            ),
            (3934672, "Jalen Brunson", Some("G"), true)
        );
        assert_eq!((p.minutes, p.plus_minus, p.pf, p.team_id), (34, 6, 3, 18));
        let play = &game.plays[0];
        assert_eq!(play.team_id, Some(5));
        assert_eq!(play.players, [Some(4432158), Some(22), None]);
        assert_eq!((play.clock_seconds, play.away_score), (705.0, 2));
        assert_eq!(
            (
                play.shooting,
                play.score_value,
                play.points_attempted,
                play.position
            ),
            (true, 2, 2, Some((26, 12)))
        );
    }
}
