//! The JSON the page reads from `/api/report` and `/api/games/{id}`. ts-rs writes matching
//! TypeScript types to web/src/api when `cargo test` runs.

use anyhow::Result;
use serde::Serialize;
use ts_rs::TS;

use crate::report::compute::PAIR_MIN_SECONDS;
use crate::report::compute::{
    Factors, GamePlayer, LastSeries, PlayerReport, QuarterRow, Ratings, Report as Computed,
    SeasonReport, Situation, build_report, factors, game_players, quarters, situations,
};
use crate::report::dates::new_york;
use crate::report::lineups::{REPLAY_TOLERANCE, replay_game};
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
    pub last_series: Option<LastSeries>,
    /// Current season against last regular season; null without a current season.
    pub quarters: Option<Vec<QuarterRow>>,
    /// Null unless both seasons exist.
    pub factors: Option<Factors>,
    pub situations: Option<Vec<Situation>>,
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
    pub home: bool,
    pub opponent: Opponent,
    pub venue: Option<String>,
    pub note: Option<String>,
    pub periods: i32,
    pub pts: i32,
    pub opp_pts: i32,
    /// Points by period, index 0 is Q1.
    pub us_by_period: Vec<i32>,
    pub them_by_period: Vec<i32>,
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
    pub players: Vec<GamePlayer>,
}

pub fn game_detail(g: &load::Game) -> GameDetail {
    let replay = replay_game(g);
    GameDetail {
        game: game(g),
        replayed: replay.ok,
        replay_tolerance: REPLAY_TOLERANCE,
        players: game_players(g, &replay),
    }
}

fn game(g: &load::Game) -> Game {
    Game {
        id: g.id.clone(),
        starts_at: g.starts_at.to_string(),
        home: g.home,
        opponent: Opponent {
            id: g.opponent.id,
            abbreviation: g.opponent.abbreviation.clone(),
            name: g.opponent.name.clone(),
        },
        venue: g.venue.clone(),
        note: g.note.clone(),
        periods: g.periods,
        pts: g.pts,
        opp_pts: g.opp_pts,
        us_by_period: g.us_by_period.clone(),
        them_by_period: g.them_by_period.clone(),
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
        player_report: s.player_report,
    }
}

pub fn report(data: &Dataset) -> Result<Report> {
    let Computed {
        game_count,
        replayed_games,
        seasons,
        current,
        last_regular,
        latest_game,
        last_series,
    } = build_report(data);
    let now = current.map(|i| seasons[i].season.games.as_slice());
    let was = last_regular.map(|i| seasons[i].season.games.as_slice());
    let tz = new_york()?;

    let quarters = now.map(|now| quarters(now, was));
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

    Ok(Report {
        synced_at: data.synced_at.map(|t| t.to_string()),
        game_count,
        replayed_games,
        replay_tolerance: REPLAY_TOLERANCE,
        pair_min_seconds: PAIR_MIN_SECONDS,
        seasons: seasons.into_iter().map(season).collect(),
        current_key,
        last_regular_key,
        latest_game,
        last_series,
        quarters,
        factors,
        situations,
    })
}
