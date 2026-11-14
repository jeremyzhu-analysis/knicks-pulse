//! Client for ESPN's public site API (no key, undocumented). Only the fields
//! this site stores are read. Numbers arrive as strings and may be missing;
//! `int` reads them leniently, so a missing or malformed value counts as 0.

use std::fmt;
use std::time::Duration;

use anyhow::{Context, Result, anyhow};
use jiff::Timestamp;
use serde::Deserialize;
use serde::de::DeserializeOwned;

const BASE: &str = "https://site.api.espn.com/apis/site/v2/sports/basketball/nba";

pub const REGULAR_SEASON: u8 = 2;
pub const PLAYOFFS: u8 = 3;

#[derive(Debug)]
pub struct EspnHttpError {
    pub status: u16,
    url: String,
}

impl fmt::Display for EspnHttpError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "ESPN {} for {}", self.status, self.url)
    }
}

impl std::error::Error for EspnHttpError {}

pub struct Espn {
    http: reqwest::Client,
}

impl Espn {
    /// Trusts Mozilla's root certificates bundled at build time, not the macOS
    /// keychain: the macOS check runs in trustd, which sandboxed processes
    /// (such as an agent's shell) can't reach.
    pub fn new() -> Result<Self> {
        let roots = webpki_root_certs::TLS_SERVER_ROOT_CERTS
            .iter()
            .map(|der| reqwest::Certificate::from_der(der))
            .collect::<Result<Vec<_>, _>>()?;
        Ok(Self {
            http: reqwest::Client::builder().tls_certs_only(roots).build()?,
        })
    }

    /// Up to 3 attempts; only 5xx answers are retried, after 1 s and then 2 s.
    pub(crate) async fn get_json<T: DeserializeOwned>(&self, url: &str) -> Result<T> {
        for attempt in 1u64.. {
            let res = self
                .http
                .get(url)
                .header(reqwest::header::ACCEPT, "application/json")
                .send()
                .await?;
            let status = res.status().as_u16();
            if res.status().is_success() {
                return res
                    .json::<T>()
                    .await
                    .with_context(|| format!("parsing {url}"));
            }
            if attempt >= 3 || status < 500 {
                return Err(EspnHttpError {
                    status,
                    url: url.to_string(),
                }
                .into());
            }
            tokio::time::sleep(Duration::from_millis(1000 * attempt)).await;
        }
        unreachable!()
    }

    /// Without a season ESPN answers with the current one.
    pub async fn schedule(
        &self,
        team_slug: &str,
        season_year: Option<i32>,
        season_type: u8,
    ) -> Result<Schedule> {
        let mut url = format!("{BASE}/teams/{team_slug}/schedule?seasontype={season_type}");
        if let Some(year) = season_year {
            url.push_str(&format!("&season={year}"));
        }
        let json: ScheduleJson = self.get_json(&url).await?;
        // A season type that hasn't started (playoffs during the regular season)
        // comes back without requestedSeason and with no events.
        let year = json
            .requested_season
            .and_then(|s| s.year)
            .or(season_year)
            .filter(|&y| y != 0);
        let season_year = year.ok_or_else(|| anyhow!("ESPN schedule has no requestedSeason"))?;
        let completed_games = json
            .events
            .unwrap_or_default()
            .into_iter()
            .filter(|event| {
                let status = event
                    .competitions
                    .as_ref()
                    .and_then(|c| c.first())
                    .and_then(|c| c.status.as_ref());
                status
                    .and_then(|s| s.r#type.as_ref())
                    .and_then(|t| t.completed)
                    == Some(true)
            })
            .map(|event| ScheduleGame {
                note: event
                    .competitions
                    .and_then(|c| c.into_iter().next())
                    .and_then(|c| c.notes)
                    .and_then(|notes| notes.into_iter().next())
                    .and_then(|note| note.headline)
                    .filter(|headline| !headline.is_empty()),
                id: event.id,
            })
            .collect();
        Ok(Schedule {
            season_year,
            completed_games,
        })
    }

    pub async fn game_summary(&self, game_id: &str) -> Result<GameSummary> {
        let json: SummaryJson = self
            .get_json(&format!("{BASE}/summary?event={game_id}"))
            .await?;
        parse_summary(game_id, json)
    }
}

pub struct Schedule {
    pub season_year: i32,
    pub completed_games: Vec<ScheduleGame>,
}

pub struct ScheduleGame {
    pub id: String,
    /// The playoff series and game, as in "East 1st Round - Game 7".
    pub note: Option<String>,
}

pub struct Team {
    pub id: i64,
    pub abbreviation: String,
    pub display_name: String,
    pub short_name: String,
}

pub struct TeamBox {
    pub team_id: i64,
    pub pts: i64,
    pub fgm: i64,
    pub fga: i64,
    pub fg3m: i64,
    pub fg3a: i64,
    pub ftm: i64,
    pub fta: i64,
    pub oreb: i64,
    pub dreb: i64,
    pub ast: i64,
    pub stl: i64,
    pub blk: i64,
    pub tov: i64,
    pub paint_pts: i64,
    pub fast_break_pts: i64,
    pub pts_off_tov: i64,
}

pub struct PlayerBox {
    pub player_id: i64,
    pub full_name: String,
    pub position: Option<String>,
    pub team_id: i64,
    pub starter: bool,
    pub minutes: i64,
    pub pts: i64,
    pub fgm: i64,
    pub fga: i64,
    pub fg3m: i64,
    pub fg3a: i64,
    pub ftm: i64,
    pub fta: i64,
    pub oreb: i64,
    pub dreb: i64,
    pub ast: i64,
    pub stl: i64,
    pub blk: i64,
    pub tov: i64,
    pub pf: i64,
    pub plus_minus: i64,
}

pub struct Play {
    pub period: i64,
    pub clock_seconds: f64,
    pub type_text: String,
    pub team_id: Option<i64>,
    pub home_score: i64,
    pub away_score: i64,
    pub text: String,
    pub players: [Option<i64>; 3],
    /// A shot, free throws included.
    pub shooting: bool,
    /// Points the play scored.
    pub score_value: i64,
    /// 2 or 3 on a field-goal attempt.
    pub points_attempted: i64,
    /// ESPN's court position; None where ESPN gives none.
    pub position: Option<(i16, i16)>,
}

pub struct Period {
    pub team_id: i64,
    pub period: i64,
    pub pts: i64,
}

pub struct GameSummary {
    pub id: String,
    pub completed: bool,
    pub season_year: i64,
    pub season_type: i64,
    pub starts_at: Timestamp,
    pub home: Team,
    pub away: Team,
    pub home_score: i64,
    pub away_score: i64,
    pub periods: Vec<Period>,
    pub venue: Option<String>,
    pub note: Option<String>,
    pub neutral: bool,
    pub attendance: Option<i64>,
    pub team_boxes: Vec<TeamBox>,
    pub player_boxes: Vec<PlayerBox>,
    pub plays: Vec<Play>,
}

fn parse_summary(game_id: &str, json: SummaryJson) -> Result<GameSummary> {
    let competition = json
        .header
        .competitions
        .into_iter()
        .next()
        .ok_or_else(|| anyhow!("Game {game_id} has no competition"))?;
    let side = |name: &str| competition.competitors.iter().find(|c| c.home_away == name);
    let (Some(home), Some(away)) = (side("home"), side("away")) else {
        return Err(anyhow!("Game {game_id} is missing a team"));
    };
    let team = |c: &CompetitorJson| Team {
        id: int(c.team.id.as_deref()),
        abbreviation: c.team.abbreviation.clone(),
        display_name: c.team.display_name.clone(),
        short_name: c.team.name.clone(),
    };

    let team_boxes = json
        .boxscore
        .teams
        .iter()
        .map(|t| {
            let stat = |name: &str| {
                t.statistics
                    .iter()
                    .find(|s| s.name.as_deref() == Some(name))
                    .and_then(|s| s.display_value.as_deref())
            };
            let (fgm, fga) = made_attempted(stat("fieldGoalsMade-fieldGoalsAttempted"));
            let (fg3m, fg3a) = made_attempted(stat(
                "threePointFieldGoalsMade-threePointFieldGoalsAttempted",
            ));
            let (ftm, fta) = made_attempted(stat("freeThrowsMade-freeThrowsAttempted"));
            let team_id = int(t.team.id.as_deref());
            let score = if team_id == int(home.id.as_deref()) {
                &home.score
            } else {
                &away.score
            };
            TeamBox {
                team_id,
                pts: int(score.as_deref()),
                fgm,
                fga,
                fg3m,
                fg3a,
                ftm,
                fta,
                oreb: int(stat("offensiveRebounds")),
                dreb: int(stat("defensiveRebounds")),
                ast: int(stat("assists")),
                stl: int(stat("steals")),
                blk: int(stat("blocks")),
                tov: int(stat("totalTurnovers").or_else(|| stat("turnovers"))),
                paint_pts: int(stat("pointsInPaint")),
                fast_break_pts: int(stat("fastBreakPoints")),
                pts_off_tov: int(stat("turnoverPoints")),
            }
        })
        .collect();

    let mut player_boxes = Vec::new();
    for side in json.boxscore.players.iter().flatten() {
        let Some(group) = side.statistics.first() else {
            continue;
        };
        for a in &group.athletes {
            // Players who didn't play can come without an id or a name.
            if a.did_not_play == Some(true) {
                continue;
            }
            let missing =
                |field: &str| anyhow!("Game {game_id}: a player who played has no {field}");
            let stats = a.stats.as_ref().ok_or_else(|| missing("stats"))?;
            if stats.is_empty() {
                continue;
            }
            let athlete = a.athlete.as_ref().ok_or_else(|| missing("athlete"))?;
            let names = group.names.as_ref().ok_or_else(|| missing("stat names"))?;
            let col = |name: &str| {
                names
                    .iter()
                    .position(|n| n == name)
                    .and_then(|i| stats.get(i))
                    .map(String::as_str)
            };
            let (fgm, fga) = made_attempted(col("FG"));
            let (fg3m, fg3a) = made_attempted(col("3PT"));
            let (ftm, fta) = made_attempted(col("FT"));
            player_boxes.push(PlayerBox {
                player_id: int(athlete.id.as_deref()),
                full_name: athlete
                    .display_name
                    .clone()
                    .ok_or_else(|| missing("displayName"))?,
                position: athlete
                    .position
                    .as_ref()
                    .and_then(|p| p.abbreviation.clone()),
                team_id: int(side.team.id.as_deref()),
                starter: a.starter.ok_or_else(|| missing("starter"))?,
                minutes: int(col("MIN")),
                pts: int(col("PTS")),
                fgm,
                fga,
                fg3m,
                fg3a,
                ftm,
                fta,
                oreb: int(col("OREB")),
                dreb: int(col("DREB")),
                ast: int(col("AST")),
                stl: int(col("STL")),
                blk: int(col("BLK")),
                tov: int(col("TO")),
                pf: int(col("PF")),
                plus_minus: int(col("+/-")),
            });
        }
    }

    let periods = [home, away]
        .into_iter()
        .flat_map(|c| {
            let team_id = int(c.team.id.as_deref());
            c.linescores
                .iter()
                .flatten()
                .enumerate()
                .map(move |(i, l)| Period {
                    team_id,
                    period: i as i64 + 1,
                    pts: int(l.display_value.as_deref()),
                })
        })
        .collect();

    let plays = json
        .plays
        .unwrap_or_default()
        .into_iter()
        .map(|p| {
            let participant = |i: usize| {
                let id = p
                    .participants
                    .as_ref()
                    .and_then(|list| list.get(i))
                    .and_then(|x| x.athlete.id.as_deref());
                id.filter(|id| !id.is_empty()).map(|id| int(Some(id)))
            };
            Play {
                period: p.period.number,
                clock_seconds: parse_clock(&p.clock.display_value),
                type_text: truncate(&p.r#type.text, 64),
                team_id: p.team.as_ref().map(|t| int(t.id.as_deref())),
                home_score: p.home_score,
                away_score: p.away_score,
                text: truncate(p.text.as_deref().unwrap_or(""), 255),
                players: [participant(0), participant(1), participant(2)],
                shooting: p.shooting_play.unwrap_or(false),
                score_value: p.score_value.unwrap_or(0),
                points_attempted: p.points_attempted.unwrap_or(0),
                position: p.coordinate.and_then(|c| court_position(c.x, c.y)),
            }
        })
        .collect();

    let attendance = json.game_info.as_ref().and_then(|g| g.attendance);
    Ok(GameSummary {
        id: game_id.to_string(),
        completed: competition.status.r#type.completed,
        season_year: json.header.season.year,
        season_type: json.header.season.r#type,
        starts_at: parse_espn_date(&competition.date)?,
        home: team(home),
        away: team(away),
        home_score: int(home.score.as_deref()),
        away_score: int(away.score.as_deref()),
        periods,
        venue: json
            .game_info
            .and_then(|g| g.venue)
            .and_then(|v| v.full_name),
        note: json.header.game_note,
        neutral: competition.neutral_site.unwrap_or(false),
        attendance: attendance.filter(|&a| a > 0),
        team_boxes,
        player_boxes,
        plays,
    })
}

/// ESPN puts a huge negative number in both coordinates of a play that has no
/// place on the court (free throws, timeouts); real ones fit well within ±200.
pub(crate) fn court_position(x: Option<f64>, y: Option<f64>) -> Option<(i16, i16)> {
    let on_court = |v: f64| (v.abs() <= 200.0).then_some(v.round() as i16);
    Some((on_court(x?)?, on_court(y?)?))
}

/// ESPN's dates often have no seconds: "2026-11-03T00:30Z".
pub(crate) fn parse_espn_date(value: &str) -> Result<Timestamp> {
    value
        .parse()
        .with_context(|| format!("ESPN date {value:?}"))
}

/// Like JavaScript `parseInt(value, 10)`: leading whitespace, an optional sign,
/// then digits; anything unparsable is 0.
pub(crate) fn int(value: Option<&str>) -> i64 {
    let text = value.unwrap_or("").trim_start();
    let (negative, rest) = match text.as_bytes().first() {
        Some(b'-') => (true, &text[1..]),
        Some(b'+') => (false, &text[1..]),
        _ => (false, text),
    };
    let digits = rest.bytes().take_while(u8::is_ascii_digit).count();
    match rest[..digits].parse::<i64>() {
        Ok(n) if negative => -n,
        Ok(n) => n,
        Err(_) => 0,
    }
}

/// Like JavaScript `Number(value) || 0`, for the decimal forms ESPN sends.
fn number(value: &str) -> f64 {
    let text = value.trim();
    if text.is_empty() {
        return 0.0;
    }
    text.parse::<f64>()
        .ok()
        .filter(|n| n.is_finite())
        .unwrap_or(0.0)
}

/// "37-75" -> (37, 75)
fn made_attempted(value: Option<&str>) -> (i64, i64) {
    let mut parts = value.unwrap_or("").split('-');
    (int(parts.next()), int(parts.next()))
}

/// "11:24" or "45.2" -> seconds left in the period.
pub fn parse_clock(value: &str) -> f64 {
    let mut parts = value.split(':');
    let a = parts.next().unwrap_or("");
    match parts.next() {
        None => number(a),
        Some(b) => int(Some(a)) as f64 * 60.0 + number(b),
    }
}

/// MySQL VARCHAR lengths count characters.
pub(crate) fn truncate(text: &str, max: usize) -> String {
    text.chars().take(max).collect()
}

// ---------------------------------------------------------------- ESPN JSON

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ScheduleJson {
    requested_season: Option<YearJson>,
    events: Option<Vec<EventJson>>,
}

#[derive(Deserialize)]
struct YearJson {
    year: Option<i32>,
}

#[derive(Deserialize)]
struct EventJson {
    id: String,
    competitions: Option<Vec<EventCompetitionJson>>,
}

#[derive(Deserialize)]
struct EventCompetitionJson {
    status: Option<EventStatusJson>,
    notes: Option<Vec<EventNoteJson>>,
}

#[derive(Deserialize)]
struct EventNoteJson {
    headline: Option<String>,
}

#[derive(Deserialize)]
struct EventStatusJson {
    r#type: Option<CompletedJson>,
}

#[derive(Deserialize)]
struct CompletedJson {
    completed: Option<bool>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct SummaryJson {
    header: HeaderJson,
    game_info: Option<GameInfoJson>,
    boxscore: BoxscoreJson,
    plays: Option<Vec<PlayJson>>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct HeaderJson {
    season: SeasonJson,
    game_note: Option<String>,
    competitions: Vec<CompetitionJson>,
}

#[derive(Deserialize)]
struct SeasonJson {
    year: i64,
    r#type: i64,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct CompetitionJson {
    date: String,
    neutral_site: Option<bool>,
    status: StatusJson,
    competitors: Vec<CompetitorJson>,
}

#[derive(Deserialize)]
struct StatusJson {
    r#type: StatusTypeJson,
}

#[derive(Deserialize)]
struct StatusTypeJson {
    completed: bool,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct CompetitorJson {
    id: Option<String>,
    home_away: String,
    score: Option<String>,
    linescores: Option<Vec<LinescoreJson>>,
    team: TeamJson,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct LinescoreJson {
    display_value: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct TeamJson {
    id: Option<String>,
    abbreviation: String,
    display_name: String,
    name: String,
}

#[derive(Deserialize)]
struct GameInfoJson {
    venue: Option<VenueJson>,
    attendance: Option<i64>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct VenueJson {
    full_name: Option<String>,
}

#[derive(Deserialize)]
struct BoxscoreJson {
    teams: Vec<BoxTeamJson>,
    players: Option<Vec<BoxPlayersJson>>,
}

#[derive(Deserialize)]
struct IdJson {
    id: Option<String>,
}

#[derive(Deserialize)]
struct BoxTeamJson {
    team: IdJson,
    statistics: Vec<TeamStatJson>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct TeamStatJson {
    name: Option<String>,
    display_value: Option<String>,
}

#[derive(Deserialize)]
struct BoxPlayersJson {
    team: IdJson,
    statistics: Vec<PlayerGroupJson>,
}

#[derive(Deserialize)]
struct PlayerGroupJson {
    names: Option<Vec<String>>,
    athletes: Vec<AthleteLineJson>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct AthleteLineJson {
    athlete: Option<AthleteJson>,
    starter: Option<bool>,
    did_not_play: Option<bool>,
    stats: Option<Vec<String>>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct AthleteJson {
    id: Option<String>,
    display_name: Option<String>,
    position: Option<PositionJson>,
}

#[derive(Deserialize)]
struct PositionJson {
    abbreviation: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct PlayJson {
    r#type: PlayTypeJson,
    text: Option<String>,
    period: PeriodJson,
    clock: ClockJson,
    team: Option<IdJson>,
    home_score: i64,
    away_score: i64,
    participants: Option<Vec<ParticipantJson>>,
    shooting_play: Option<bool>,
    score_value: Option<i64>,
    points_attempted: Option<i64>,
    coordinate: Option<CoordinateJson>,
}

#[derive(Deserialize)]
struct CoordinateJson {
    x: Option<f64>,
    y: Option<f64>,
}

#[derive(Deserialize)]
struct PlayTypeJson {
    text: String,
}

#[derive(Deserialize)]
struct PeriodJson {
    number: i64,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ClockJson {
    display_value: String,
}

#[derive(Deserialize)]
struct ParticipantJson {
    athlete: IdJson,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn int_parses_like_parse_int() {
        assert_eq!(int(Some("12")), 12);
        assert_eq!(int(Some("+5")), 5);
        assert_eq!(int(Some("-12")), -12);
        assert_eq!(int(Some("  7 ")), 7);
        assert_eq!(int(Some("12abc")), 12);
        assert_eq!(int(Some("4.9")), 4);
        assert_eq!(int(Some("")), 0);
        assert_eq!(int(Some("-")), 0);
        assert_eq!(int(Some("abc")), 0);
        assert_eq!(int(None), 0);
    }

    #[test]
    fn made_attempted_splits() {
        assert_eq!(made_attempted(Some("37-75")), (37, 75));
        assert_eq!(made_attempted(Some("0-0")), (0, 0));
        assert_eq!(made_attempted(Some("5")), (5, 0));
        assert_eq!(made_attempted(None), (0, 0));
    }

    #[test]
    fn parse_clock_reads_both_forms() {
        assert_eq!(parse_clock("11:24"), 684.0);
        assert_eq!(parse_clock("0:00"), 0.0);
        assert_eq!(parse_clock("45.2"), 45.2);
        assert_eq!(parse_clock(""), 0.0);
        assert_eq!(parse_clock("1:x"), 60.0);
        assert_eq!(parse_clock("inf"), 0.0);
    }

    #[test]
    fn parses_espn_dates_without_seconds() {
        let ts = parse_espn_date("2026-11-03T00:30Z").unwrap();
        assert_eq!(ts.to_string(), "2026-11-03T00:30:00Z");
        assert_eq!(
            parse_espn_date("2026-11-03T00:30:15Z").unwrap().to_string(),
            "2026-11-03T00:30:15Z"
        );
    }

    #[test]
    fn skips_players_who_did_not_play_even_without_a_name() {
        let json = r#"{
          "header": {"season": {"year": 2026, "type": 2}, "gameNote": null, "competitions": [{
            "date": "2026-02-22T20:30Z", "neutralSite": true, "status": {"type": {"completed": true}},
            "competitors": [
              {"id": "18", "homeAway": "home", "score": "108", "linescores": [{"displayValue": "30"}],
               "team": {"id": "18", "abbreviation": "NY", "displayName": "New York Knicks", "name": "Knicks"}},
              {"id": "10", "homeAway": "away", "score": "106",
               "team": {"id": "10", "abbreviation": "HOU", "displayName": "Houston Rockets", "name": "Rockets"}}
            ]}]},
          "gameInfo": {"attendance": 19812},
          "plays": [
            {"type": {"text": "Jump Shot"}, "text": "Jalen Brunson makes 25-foot three point jumper", "period": {"number": 1},
             "clock": {"displayValue": "11:24"}, "team": {"id": "18"}, "homeScore": 3, "awayScore": 0,
             "participants": [{"athlete": {"id": "1"}}],
             "shootingPlay": true, "scoreValue": 3, "pointsAttempted": 3, "coordinate": {"x": 44, "y": 12}},
            {"type": {"text": "Free Throw - 1 of 2"}, "period": {"number": 1},
             "clock": {"displayValue": "10:02"}, "team": {"id": "18"}, "homeScore": 4, "awayScore": 0,
             "shootingPlay": true, "scoreValue": 1, "coordinate": {"x": -214748340, "y": -214748365}}
          ],
          "boxscore": {
            "teams": [{"team": {"id": "18"}, "statistics": [{"name": "fieldGoalsMade-fieldGoalsAttempted", "displayValue": "40-85"}]}],
            "players": [{"team": {"id": "18"}, "statistics": [{"names": ["MIN", "PTS", "FG", "+/-"], "athletes": [
              {"athlete": {"id": "1", "displayName": "Jalen Brunson", "position": {"abbreviation": "G"}},
               "starter": true, "didNotPlay": false, "stats": ["36", "31", "11-22", "+5"]},
              {"athlete": {"shortName": "Olbrich"}, "starter": false, "didNotPlay": true, "stats": []}
            ]}]}]
          }
        }"#;
        let game = parse_summary("1", serde_json::from_str(json).unwrap()).unwrap();
        assert_eq!(game.player_boxes.len(), 1);
        let p = &game.player_boxes[0];
        assert_eq!(
            (
                p.player_id,
                p.full_name.as_str(),
                p.minutes,
                p.pts,
                p.fgm,
                p.fga,
                p.plus_minus
            ),
            (1, "Jalen Brunson", 36, 31, 11, 22, 5)
        );
        assert_eq!((game.team_boxes[0].pts, game.team_boxes[0].fga), (108, 85));
        assert_eq!(game.periods.len(), 1);
        assert!(game.venue.is_none() && game.note.is_none());
        assert_eq!((game.neutral, game.attendance), (true, Some(19812)));
        let shot = &game.plays[0];
        assert_eq!(
            (
                shot.shooting,
                shot.score_value,
                shot.points_attempted,
                shot.position
            ),
            (true, 3, 3, Some((44, 12)))
        );
        let free_throw = &game.plays[1];
        assert_eq!(
            (
                free_throw.shooting,
                free_throw.points_attempted,
                free_throw.position
            ),
            (true, 0, None)
        );
    }
}
