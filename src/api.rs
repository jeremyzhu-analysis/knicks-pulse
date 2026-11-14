//! The JSON the page reads from the `/api` routes. ts-rs writes matching
//! TypeScript types to web/src/api when `cargo test` runs.

use anyhow::Result;
use serde::Serialize;
use ts_rs::TS;

use crate::report::compute::PAIR_MIN_SECONDS;
use crate::report::compute::{
    Champion, Factors, GamePlayer, GameSide, Headline, LastSeries, PeriodPoints, PlayerReport,
    PlayerRow, QuarterRow, Ratings, Report as Computed, Rolling, SeasonReport, ShotMap, Situation,
    build_report, factors, flow, game_players, game_sides, headline, points_by_period, quarters,
    ratings, rolling_margins, shot_map, situations, won,
};
use crate::report::dates::new_york;
use crate::report::lineups::{GameMoment, REPLAY_TOLERANCE, replay_game};
use crate::report::load::{self, Dataset};

#[derive(Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct Report {
    /// ISO 8601 in UTC.
    pub synced_at: Option<String>,
    pub game_count: i32,
    pub replayed_games: i32,
    /// A replay counts when every player's replayed plus-minus is within this many points of the box score.
    pub replay_tolerance: i32,
    /// Pairings with less shared time than this are left blank.
    pub pair_min_seconds: f64,
    /// Most recent first: current regular season, then older ones.
    pub seasons: Vec<Season>,
    /// Keys into `seasons`.
    pub current_key: Option<String>,
    pub last_regular_key: Option<String>,
    pub latest_game: Option<LatestGame>,
    /// Null without a current season.
    pub headline: Option<Headline>,
    pub last_series: Option<LastSeries>,
    pub champion: Option<Champion>,
    /// Current season against last regular season; null without a current season.
    pub quarters: Option<Vec<QuarterRow>>,
    /// Null unless both seasons exist.
    pub factors: Option<Factors>,
    pub situations: Option<Vec<Situation>>,
}

/// `GET /api/sync`.
#[derive(Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct SyncStatus {
    /// When a sync last ran to the end, ISO 8601 in UTC; null before the first.
    pub checked_at: Option<String>,
}

/// `POST /api/sync`.
#[derive(Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct SyncOutcome {
    /// True when another sync was running, so this request started none.
    pub busy: bool,
    /// Games stored for the first time.
    pub added: i32,
    /// Games that were stored before and written again.
    pub updated: i32,
    pub checked_at: Option<String>,
}

#[derive(Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct Season {
    /// "2027:2": ESPN season year and type.
    pub key: String,
    pub year: i32,
    /// 2 regular season, 3 playoffs.
    pub r#type: i32,
    pub label: String,
    pub ratings: Ratings,
    /// Oldest first.
    pub games: Vec<Game>,
    /// The margin's running average over `games`, one entry per window length.
    pub rolling: Vec<Rolling>,
    pub player_report: PlayerReport,
}

#[derive(Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct Opponent {
    pub id: u32,
    pub abbreviation: String,
    pub name: String,
}

/// One game seen from the report team's side.
#[derive(Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct Game {
    pub id: String,
    /// ISO 8601 in UTC.
    pub starts_at: String,
    /// True for the designated home team, also at a neutral site.
    pub home: bool,
    pub neutral: bool,
    pub opponent: Opponent,
    pub venue: Option<String>,
    pub attendance: Option<u32>,
    pub note: Option<String>,
    pub periods: i32,
    pub pts: i32,
    pub opp_pts: i32,
    /// Points by period, index 0 is Q1.
    pub us_by_period: Vec<i32>,
    pub them_by_period: Vec<i32>,
    /// Points per 100 possessions in this game.
    pub offense: f64,
    pub defense: f64,
}

#[derive(Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct TopScorer {
    pub full_name: String,
    pub pts: i32,
}

#[derive(Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct LatestGame {
    #[serde(flatten)]
    pub game: Game,
    /// First player with the most points, in box-score order.
    pub top_scorer: Option<TopScorer>,
}

#[derive(Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct GameDetail {
    #[serde(flatten)]
    pub game: Game,
    /// False when the lineup replay is too far from the box score to show stints.
    pub replayed: bool,
    pub replay_tolerance: i32,
    /// The score after every play that changed it, starting at 0-0.
    pub flow: Vec<GameMoment>,
    pub us: GameSide,
    pub them: GameSide,
    pub players: Vec<GamePlayer>,
    pub opponents: Vec<GamePlayer>,
}

/// A game the player appeared in, with their line.
#[derive(Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct PlayerLogGame {
    #[serde(flatten)]
    pub game: Game,
    pub line: GamePlayer,
}

/// One season of a player.
#[derive(Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct PlayerSeason {
    /// As in `Season`.
    pub key: String,
    pub label: String,
    pub row: PlayerRow,
    /// The team's record in the games the player appeared in.
    pub wins: i32,
    pub losses: i32,
    /// Oldest first.
    pub games: Vec<PlayerLogGame>,
}

/// `GET /api/players/{id}`.
#[derive(Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct PlayerDetail {
    pub id: u32,
    pub name: String,
    pub position: Option<String>,
    /// Most recent first, as in the report; only seasons the player appeared in.
    pub seasons: Vec<PlayerSeason>,
}

fn player_details(seasons: &[SeasonReport], points: &PeriodPoints) -> Vec<PlayerDetail> {
    let mut details: Vec<PlayerDetail> = Vec::new();
    for s in seasons {
        for row in &s.player_report.players {
            let mut log = Vec::new();
            let mut wins = 0;
            for g in &s.season.games {
                let Some(line) = g.players.iter().find(|p| p.player_id == row.id) else {
                    continue;
                };
                wins += i32::from(won(g));
                let no_points = Default::default();
                let game_points = points.get(g.id.as_str()).unwrap_or(&no_points);
                log.extend(
                    game_players(std::slice::from_ref(line), game_points, None)
                        .into_iter()
                        .map(|line| PlayerLogGame {
                            game: game(g),
                            line,
                        }),
                );
            }
            let season = PlayerSeason {
                key: s.season.key.clone(),
                label: s.season.label.clone(),
                row: row.clone(),
                wins,
                losses: log.len() as i32 - wins,
                games: log,
            };
            match details.iter_mut().find(|d| d.id == row.id) {
                Some(detail) => detail.seasons.push(season),
                None => details.push(PlayerDetail {
                    id: row.id,
                    name: row.name.clone(),
                    position: row.position.clone(),
                    seasons: vec![season],
                }),
            }
        }
    }
    details
}

fn game_detail(g: &load::Game) -> GameDetail {
    let replay = replay_game(g);
    let flow = flow(g);
    let (us, them) = game_sides(g, &flow);
    let points = points_by_period(g);
    GameDetail {
        game: game(g),
        replayed: replay.ok,
        replay_tolerance: REPLAY_TOLERANCE,
        flow,
        us,
        them,
        players: game_players(&g.players, &points, Some(&replay)),
        opponents: game_players(&g.opponent_players, &points, None),
    }
}

fn game(g: &load::Game) -> Game {
    let rated = ratings(&[g]);
    Game {
        id: g.id.clone(),
        starts_at: g.starts_at.to_string(),
        home: g.home,
        neutral: g.neutral,
        opponent: Opponent {
            id: g.opponent.id,
            abbreviation: g.opponent.abbreviation.clone(),
            name: g.opponent.name.clone(),
        },
        venue: g.venue.clone(),
        attendance: g.attendance,
        note: g.note.clone(),
        periods: g.periods,
        pts: g.pts,
        opp_pts: g.opp_pts,
        us_by_period: g.us_by_period.clone(),
        them_by_period: g.them_by_period.clone(),
        offense: rated.offense,
        defense: rated.defense,
    }
}

fn season(s: SeasonReport) -> Season {
    Season {
        key: s.season.key,
        year: s.season.year,
        r#type: s.season.season_type,
        label: s.season.label,
        ratings: s.season.ratings,
        games: s.season.games.iter().map(|g| game(g)).collect(),
        rolling: rolling_margins(&s.season.games),
        player_report: s.player_report,
    }
}

/// Every document the API serves, by path, as JSON.
pub fn documents(data: &Dataset) -> Result<Vec<(String, Vec<u8>)>> {
    let mut documents = Vec::new();
    for g in &data.games {
        documents.push((
            format!("/api/games/{}", g.id),
            serde_json::to_vec(&game_detail(g))?,
        ));
    }
    let (report, players, shots) = report(data)?;
    for player in &players {
        documents.push((
            format!("/api/players/{}", player.id),
            serde_json::to_vec(player)?,
        ));
    }
    documents.push(("/api/shots".to_string(), serde_json::to_vec(&shots)?));
    documents.push(("/api/report".to_string(), serde_json::to_vec(&report)?));
    Ok(documents)
}

/// The report, the page of every player in it, and each season's shot map
/// (`GET /api/shots`), most recent season first.
fn report(data: &Dataset) -> Result<(Report, Vec<PlayerDetail>, Vec<ShotMap>)> {
    let Computed {
        game_count,
        replayed_games,
        seasons,
        current,
        last_regular,
        latest_game,
        last_series,
        champion,
        points,
    } = build_report(data);
    let players = player_details(&seasons, &points);
    let shots = seasons
        .iter()
        .map(|s| shot_map(&s.season.key, &s.season.games))
        .collect();
    let now = current.map(|i| seasons[i].season.games.as_slice());
    let was = last_regular.map(|i| seasons[i].season.games.as_slice());
    let tz = new_york()?;

    let quarters = now.map(|now| quarters(now, was));
    let headline = current.map(|i| {
        headline(
            &seasons[i].season.ratings,
            last_regular.map(|i| &seasons[i].season.ratings),
            quarters.as_deref().unwrap_or_default(),
        )
    });
    let factors = now.zip(was).map(|(now, was)| factors(now, was));
    let situations = now.map(|now| situations(now, was, &tz)).transpose()?;
    let current_key = current.map(|i| seasons[i].season.key.clone());
    let last_regular_key = last_regular.map(|i| seasons[i].season.key.clone());
    let latest_game = latest_game.map(|g| {
        let mut top: Option<&load::PlayerGame> = None;
        for p in &g.players {
            if top.is_none_or(|t| p.pts > t.pts) {
                top = Some(p);
            }
        }
        LatestGame {
            game: game(g),
            top_scorer: top.map(|p| TopScorer {
                full_name: p.full_name.clone(),
                pts: p.pts,
            }),
        }
    });

    let report = Report {
        synced_at: data.synced_at.map(|t| t.to_string()),
        game_count,
        replayed_games,
        replay_tolerance: REPLAY_TOLERANCE,
        pair_min_seconds: PAIR_MIN_SECONDS,
        seasons: seasons.into_iter().map(season).collect(),
        current_key,
        last_regular_key,
        latest_game,
        headline,
        last_series,
        champion,
        quarters,
        factors,
        situations,
    };
    Ok((report, players, shots))
}
