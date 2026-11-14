use std::collections::HashMap;

use anyhow::{Context, Result, anyhow};
use jiff::Timestamp;
use sqlx::FromRow;
use sqlx::mysql::MySqlPool;

#[derive(Clone, Copy)]
pub struct BoxScore {
    pub fgm: i32,
    pub fga: i32,
    pub fg3m: i32,
    pub fta: i32,
    pub oreb: i32,
    pub dreb: i32,
    pub tov: i32,
    pub paint_pts: i32,
    pub fast_break_pts: i32,
    pub pts_off_tov: i32,
}

pub struct PlayerGame {
    pub player_id: u32,
    pub full_name: String,
    pub position: Option<String>,
    pub starter: bool,
    pub minutes: i32,
    pub pts: i32,
    pub fgm: i32,
    pub fga: i32,
    pub ftm: i32,
    pub fta: i32,
    pub oreb: i32,
    pub dreb: i32,
    pub reb: i32,
    pub ast: i32,
    pub stl: i32,
    pub blk: i32,
    pub tov: i32,
    pub pf: i32,
    pub plus_minus: i32,
}

pub struct PlayRow {
    pub period: i32,
    pub clock_seconds: f64,
    pub type_text: String,
    pub home_score: i32,
    pub away_score: i32,
    /// The player the play is credited to comes first: the shooter of a shot.
    pub players: [Option<u32>; 3],
    /// Points the play scored.
    pub score_value: i32,
    /// A shot, free throws included.
    pub shooting: bool,
    /// 2 or 3 on a field-goal attempt.
    pub points_attempted: i32,
    /// ESPN's court position (x across the floor, y out from the basket, in
    /// feet); None where ESPN gives none.
    pub position: Option<(i16, i16)>,
}

pub struct Opponent {
    pub id: u32,
    pub abbreviation: String,
    pub name: String,
}

/// One game seen from the report team's side.
pub struct Game {
    pub id: String,
    pub season_year: i32,
    pub season_type: i32,
    pub starts_at: Timestamp,
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
    pub us: BoxScore,
    pub them: BoxScore,
    /// Points by period, index 0 is Q1.
    pub us_by_period: Vec<i32>,
    pub them_by_period: Vec<i32>,
    /// The report team's players.
    pub players: Vec<PlayerGame>,
    pub opponent_players: Vec<PlayerGame>,
    pub plays: Vec<PlayRow>,
}

pub struct Dataset {
    pub games: Vec<Game>,
    pub synced_at: Option<Timestamp>,
}

// DATETIME columns hold UTC; they're read as ISO strings so jiff can parse them.
const UTC_ISO: &str = "'%Y-%m-%dT%H:%i:%sZ'";

#[derive(FromRow)]
struct GameDb {
    id: u64,
    season_year: u16,
    season_type: u8,
    starts_at: String,
    home_team_id: u32,
    away_team_id: u32,
    home_score: u16,
    away_score: u16,
    periods: u8,
    venue: Option<String>,
    note: Option<String>,
    synced_at: String,
    neutral: bool,
    attendance: Option<u32>,
}

#[derive(FromRow)]
struct TeamDb {
    id: u32,
    abbreviation: String,
    display_name: String,
}

#[derive(FromRow)]
struct TeamStatsDb {
    game_id: u64,
    team_id: u32,
    fgm: u16,
    fga: u16,
    fg3m: u16,
    fta: u16,
    oreb: u16,
    dreb: u16,
    tov: u16,
    paint_pts: u16,
    fast_break_pts: u16,
    pts_off_tov: u16,
}

#[derive(FromRow)]
struct PeriodDb {
    game_id: u64,
    team_id: u32,
    period: u8,
    pts: u16,
}

#[derive(FromRow)]
struct PlayerDb {
    game_id: u64,
    player_id: u32,
    team_id: u32,
    full_name: String,
    position: Option<String>,
    starter: bool,
    minutes: u16,
    pts: u16,
    fgm: u16,
    fga: u16,
    ftm: u16,
    fta: u16,
    oreb: u16,
    dreb: u16,
    ast: u16,
    stl: u16,
    blk: u16,
    tov: u16,
    pf: u16,
    plus_minus: i16,
}

#[derive(FromRow)]
struct PlayDb {
    game_id: u64,
    period: u8,
    clock_s: String,
    type_text: String,
    home_score: u16,
    away_score: u16,
    player1_id: Option<u32>,
    player2_id: Option<u32>,
    player3_id: Option<u32>,
    score_value: u8,
    shooting: bool,
    points_attempted: u8,
    x: Option<i16>,
    y: Option<i16>,
}

impl From<&TeamStatsDb> for BoxScore {
    fn from(r: &TeamStatsDb) -> Self {
        Self {
            fgm: r.fgm.into(),
            fga: r.fga.into(),
            fg3m: r.fg3m.into(),
            fta: r.fta.into(),
            oreb: r.oreb.into(),
            dreb: r.dreb.into(),
            tov: r.tov.into(),
            paint_pts: r.paint_pts.into(),
            fast_break_pts: r.fast_break_pts.into(),
            pts_off_tov: r.pts_off_tov.into(),
        }
    }
}

fn group_by<T>(rows: Vec<T>, key: impl Fn(&T) -> u64) -> HashMap<u64, Vec<T>> {
    let mut map: HashMap<u64, Vec<T>> = HashMap::new();
    for row in rows {
        map.entry(key(&row)).or_default().push(row);
    }
    map
}

fn parse_utc(value: &str) -> Result<Timestamp> {
    value
        .parse()
        .with_context(|| format!("stored DATETIME {value:?}"))
}

pub async fn load_dataset(pool: &MySqlPool, team_id: u32) -> Result<Dataset> {
    let game_rows: Vec<GameDb> = sqlx::query_as(sqlx::AssertSqlSafe(format!(
        "SELECT id, season_year, season_type, DATE_FORMAT(starts_at, {UTC_ISO}) starts_at, home_team_id, away_team_id,
                home_score, away_score, periods, venue, note, DATE_FORMAT(synced_at, {UTC_ISO}) synced_at,
                neutral, attendance
           FROM games WHERE home_team_id = ? OR away_team_id = ? ORDER BY games.starts_at"
    )))
    .bind(team_id)
    .bind(team_id)
    .fetch_all(pool)
    .await?;
    if game_rows.is_empty() {
        return Ok(Dataset {
            games: Vec::new(),
            synced_at: None,
        });
    }

    // The same games as above, so these queries never need an id list.
    const TEAM_GAMES: &str = "(SELECT id FROM games WHERE home_team_id = ? OR away_team_id = ?)";
    let teams = sqlx::query_as::<_, TeamDb>("SELECT id, abbreviation, display_name FROM teams")
        .fetch_all(pool);
    let stats = sqlx::query_as::<_, TeamStatsDb>(sqlx::AssertSqlSafe(format!(
        "SELECT game_id, team_id, fgm, fga, fg3m, fta, oreb, dreb, tov, paint_pts, fast_break_pts, pts_off_tov
           FROM game_team_stats WHERE game_id IN {TEAM_GAMES}"
    )))
    .bind(team_id)
    .bind(team_id)
    .fetch_all(pool);
    let periods = sqlx::query_as::<_, PeriodDb>(sqlx::AssertSqlSafe(format!(
        "SELECT game_id, team_id, period, pts FROM game_periods WHERE game_id IN {TEAM_GAMES}"
    )))
    .bind(team_id)
    .bind(team_id)
    .fetch_all(pool);
    // Player order decides ties later (sorting by minutes, the top scorer), so
    // the query fixes it instead of leaving it to the query plan.
    let players = sqlx::query_as::<_, PlayerDb>(sqlx::AssertSqlSafe(format!(
        "SELECT gp.game_id, gp.player_id, gp.team_id, p.full_name, p.position, gp.starter, gp.minutes,
                gp.pts, gp.fgm, gp.fga, gp.ftm, gp.fta, gp.oreb, gp.dreb, gp.ast, gp.stl, gp.blk,
                gp.tov, gp.pf, gp.plus_minus
           FROM game_players gp JOIN players p ON p.id = gp.player_id
          WHERE gp.game_id IN {TEAM_GAMES}
          ORDER BY gp.game_id, gp.player_id"
    )))
    .bind(team_id)
    .bind(team_id)
    .fetch_all(pool);
    // clock_s is DECIMAL; reading it as text and parsing it gives the nearest
    // double without a decimal crate.
    let plays = sqlx::query_as::<_, PlayDb>(sqlx::AssertSqlSafe(format!(
        "SELECT game_id, period, CAST(clock_s AS CHAR) clock_s, type_text, home_score, away_score,
                player1_id, player2_id, player3_id, score_value, shooting, points_attempted, x, y
           FROM plays WHERE game_id IN {TEAM_GAMES} ORDER BY game_id, ord"
    )))
    .bind(team_id)
    .bind(team_id)
    .fetch_all(pool);
    let (teams, stats, periods, players, plays) =
        tokio::try_join!(teams, stats, periods, players, plays)?;

    let team_by_id: HashMap<u32, TeamDb> = teams.into_iter().map(|t| (t.id, t)).collect();
    let stats_by_game = group_by(stats, |r| r.game_id);
    let periods_by_game = group_by(periods, |r| r.game_id);
    let mut players_by_game = group_by(players, |r| r.game_id);
    let mut plays_by_game = group_by(plays, |r| r.game_id);

    let mut synced_at: Option<Timestamp> = None;
    let mut games = Vec::with_capacity(game_rows.len());
    for g in game_rows {
        let synced = parse_utc(&g.synced_at)?;
        if synced_at.is_none_or(|max| synced > max) {
            synced_at = Some(synced);
        }
        let home = g.home_team_id == team_id;
        let opp_id = if home { g.away_team_id } else { g.home_team_id };
        let opp = team_by_id.get(&opp_id);
        let game_stats = stats_by_game
            .get(&g.id)
            .map(Vec::as_slice)
            .unwrap_or_default();
        let box_for = |team: u32| {
            game_stats
                .iter()
                .find(|s| s.team_id == team)
                .map(BoxScore::from)
                .ok_or_else(|| anyhow!("Game is missing team stats"))
        };
        let game_periods = periods_by_game
            .get(&g.id)
            .map(Vec::as_slice)
            .unwrap_or_default();
        let by_period = |team: u32| {
            let mut list = vec![0; usize::from(g.periods)];
            for p in game_periods.iter().filter(|p| p.team_id == team) {
                let i = usize::from(p.period).saturating_sub(1);
                if i >= list.len() {
                    list.resize(i + 1, 0);
                }
                list[i] = i32::from(p.pts);
            }
            list
        };
        let (players, opponent_players) = players_by_game
            .remove(&g.id)
            .unwrap_or_default()
            .into_iter()
            .partition::<Vec<_>, _>(|p| p.team_id == team_id);
        let lines = |rows: Vec<PlayerDb>| -> Vec<PlayerGame> {
            rows.into_iter()
                .map(|p| PlayerGame {
                    player_id: p.player_id,
                    full_name: p.full_name,
                    position: p.position,
                    starter: p.starter,
                    minutes: p.minutes.into(),
                    pts: p.pts.into(),
                    fgm: p.fgm.into(),
                    fga: p.fga.into(),
                    ftm: p.ftm.into(),
                    fta: p.fta.into(),
                    oreb: p.oreb.into(),
                    dreb: p.dreb.into(),
                    reb: i32::from(p.oreb) + i32::from(p.dreb),
                    ast: p.ast.into(),
                    stl: p.stl.into(),
                    blk: p.blk.into(),
                    tov: p.tov.into(),
                    pf: p.pf.into(),
                    plus_minus: p.plus_minus.into(),
                })
                .collect()
        };
        let plays = plays_by_game
            .remove(&g.id)
            .unwrap_or_default()
            .into_iter()
            .map(|p| {
                Ok(PlayRow {
                    period: p.period.into(),
                    clock_seconds: p
                        .clock_s
                        .parse()
                        .with_context(|| format!("clock_s {:?}", p.clock_s))?,
                    type_text: p.type_text,
                    home_score: p.home_score.into(),
                    away_score: p.away_score.into(),
                    players: [p.player1_id, p.player2_id, p.player3_id],
                    score_value: p.score_value.into(),
                    shooting: p.shooting,
                    points_attempted: p.points_attempted.into(),
                    position: p.x.zip(p.y),
                })
            })
            .collect::<Result<_>>()?;
        games.push(Game {
            id: g.id.to_string(),
            season_year: g.season_year.into(),
            season_type: g.season_type.into(),
            starts_at: parse_utc(&g.starts_at)?,
            home,
            neutral: g.neutral,
            opponent: Opponent {
                id: opp_id,
                abbreviation: opp.map_or_else(|| "?".into(), |t| t.abbreviation.clone()),
                name: opp.map_or_else(|| "Opponent".into(), |t| t.display_name.clone()),
            },
            venue: g.venue,
            attendance: g.attendance,
            note: g.note,
            periods: g.periods.into(),
            pts: if home { g.home_score } else { g.away_score }.into(),
            opp_pts: if home { g.away_score } else { g.home_score }.into(),
            us: box_for(team_id)?,
            them: box_for(opp_id)?,
            us_by_period: by_period(team_id),
            them_by_period: by_period(opp_id),
            players: lines(players),
            opponent_players: lines(opponent_players),
            plays,
        });
    }
    Ok(Dataset { games, synced_at })
}
