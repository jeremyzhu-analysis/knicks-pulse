use std::collections::{HashMap, HashSet};

use anyhow::Result;
use sqlx::mysql::MySqlPool;
use sqlx::{MySql, QueryBuilder, Transaction};

use crate::config::TEAM_SLUG;
use crate::espn::{Espn, EspnHttpError, GameSummary, PLAYOFFS, REGULAR_SEASON};
use crate::report::dates::new_york;

/// Version of what `store_game` writes for a game. Raise it when a stored game
/// gains data that only ESPN can supply.
const STORE_FORMAT: u8 = 2;

pub struct SyncResult {
    pub completed: usize,
    /// Games stored for the first time.
    pub added: usize,
    /// Games that were stored before and written again.
    pub updated: usize,
}

/// ESPN corrects box scores and play-by-play for a while after the final
/// buzzer, so a game is fetched again on every sync until this long after its
/// start.
const SETTLE_HOURS: u8 = 36;

/// Stores every completed game of the current and previous season (regular
/// season and playoffs) that isn't in the database in the current
/// STORE_FORMAT, or that started within SETTLE_HOURS. Callers must not run two
/// syncs at once.
pub async fn sync_games(pool: &MySqlPool, espn: &Espn, log: impl Fn(&str)) -> Result<SyncResult> {
    let current = espn.schedule(TEAM_SLUG, None, REGULAR_SEASON).await?;
    let year = current.season_year;
    let schedules = [
        (REGULAR_SEASON, current),
        (
            PLAYOFFS,
            espn.schedule(TEAM_SLUG, Some(year), PLAYOFFS).await?,
        ),
        (
            REGULAR_SEASON,
            espn.schedule(TEAM_SLUG, Some(year - 1), REGULAR_SEASON)
                .await?,
        ),
        (
            PLAYOFFS,
            espn.schedule(TEAM_SLUG, Some(year - 1), PLAYOFFS).await?,
        ),
    ];
    let mut seen = HashSet::new();
    let listed: Vec<Listed> = schedules
        .into_iter()
        .flat_map(|(season_type, schedule)| {
            let season_year = schedule.season_year;
            schedule
                .completed_games
                .into_iter()
                .map(move |game| Listed {
                    id: game.id,
                    season_year,
                    season_type,
                    note: game.note,
                })
        })
        .filter(|game| seen.insert(game.id.clone()))
        .collect();

    // id -> whether the stored game can be left as it is.
    let stored: HashMap<String, bool> = sqlx::query_as::<_, (u64, bool)>(
        "SELECT id, store_format = ? AND starts_at <= UTC_TIMESTAMP() - INTERVAL ? HOUR FROM games",
    )
    .bind(STORE_FORMAT)
    .bind(SETTLE_HOURS)
    .fetch_all(pool)
    .await?
    .into_iter()
    .map(|(id, settled)| (id.to_string(), settled))
    .collect();
    let to_fetch: Vec<&Listed> = listed
        .iter()
        .filter(|game| stored.get(&game.id) != Some(&true))
        .collect();
    log(&format!(
        "{} completed games, {} to fetch.",
        listed.len(),
        to_fetch.len()
    ));

    let new_york = new_york()?;
    let (mut added, mut updated) = (0, 0);
    for listed in to_fetch {
        let id = &listed.id;
        let game = match espn.game_summary(id).await {
            Ok(game) => game,
            // ESPN lists some finished games whose summary answers 404; its
            // core API still has them.
            Err(error) if is_not_found(&error) => {
                let core = espn
                    .core_game_summary(
                        id,
                        listed.season_year.into(),
                        listed.season_type.into(),
                        listed.note.clone(),
                    )
                    .await;
                match core {
                    Ok(game) => game,
                    // With neither source the game stays unstored, so every
                    // later sync asks for it again.
                    Err(error) if is_not_found(&error) => {
                        log(&format!("Skipped game {id}: ESPN has no data for it."));
                        continue;
                    }
                    Err(error) => return Err(error),
                }
            }
            Err(error) => return Err(error),
        };
        if !game.completed {
            continue;
        }
        store_game(pool, &game).await?;
        let verb = if stored.contains_key(id) {
            updated += 1;
            "Updated"
        } else {
            added += 1;
            "Stored"
        };
        log(&format!(
            "{verb} {} {} {} at {} {}",
            game.starts_at
                .to_zoned(new_york.clone())
                .strftime("%Y-%m-%d"),
            game.away.abbreviation,
            game.away_score,
            game.home.abbreviation,
            game.home_score
        ));
    }
    sqlx::query(
        "INSERT INTO sync_status (id, checked_at) VALUES (1, UTC_TIMESTAMP())
         ON DUPLICATE KEY UPDATE checked_at = VALUES(checked_at)",
    )
    .execute(pool)
    .await?;
    Ok(SyncResult {
        completed: listed.len(),
        added,
        updated,
    })
}

/// A completed game as a schedule lists it.
struct Listed {
    id: String,
    season_year: i32,
    season_type: u8,
    note: Option<String>,
}

fn is_not_found(error: &anyhow::Error) -> bool {
    error
        .downcast_ref::<EspnHttpError>()
        .is_some_and(|e| e.status == 404)
}

/// One transaction per game; a failure leaves nothing of the game behind.
async fn store_game(pool: &MySqlPool, game: &GameSummary) -> Result<()> {
    let game_id: u64 = game.id.parse()?;
    let mut tx = pool.begin().await?;
    for team in [&game.home, &game.away] {
        sqlx::query(
            "INSERT INTO teams (id, abbreviation, display_name, short_name) VALUES (?, ?, ?, ?)
             ON DUPLICATE KEY UPDATE abbreviation = VALUES(abbreviation), display_name = VALUES(display_name), short_name = VALUES(short_name)",
        )
        .bind(team.id)
        .bind(&team.abbreviation)
        .bind(&team.display_name)
        .bind(&team.short_name)
        .execute(&mut *tx)
        .await?;
    }
    if !game.player_boxes.is_empty() {
        let mut q = QueryBuilder::<MySql>::new("INSERT INTO players (id, full_name, position) ");
        q.push_values(&game.player_boxes, |mut row, p| {
            row.push_bind(p.player_id)
                .push_bind(&p.full_name)
                .push_bind(&p.position);
        });
        q.push(
            " ON DUPLICATE KEY UPDATE full_name = VALUES(full_name), position = VALUES(position)",
        );
        q.build().execute(&mut *tx).await?;
    }
    sqlx::query("DELETE FROM games WHERE id = ?")
        .bind(game_id)
        .execute(&mut *tx)
        .await?;
    let period_count = game
        .periods
        .iter()
        .map(|p| p.period)
        .max()
        .unwrap_or(0)
        .max(4);
    sqlx::query(
        "INSERT INTO games (id, season_year, season_type, starts_at, home_team_id, away_team_id, home_score, away_score, periods, venue, note, synced_at, neutral, attendance, store_format)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, UTC_TIMESTAMP(), ?, ?, ?)",
    )
    .bind(game_id)
    .bind(game.season_year)
    .bind(game.season_type)
    .bind(game.starts_at.strftime("%Y-%m-%d %H:%M:%S").to_string())
    .bind(game.home.id)
    .bind(game.away.id)
    .bind(game.home_score)
    .bind(game.away_score)
    .bind(period_count)
    .bind(&game.venue)
    .bind(&game.note)
    .bind(game.neutral)
    .bind(game.attendance)
    .bind(STORE_FORMAT)
    .execute(&mut *tx)
    .await?;

    insert(
        &mut tx,
        "game_team_stats (game_id, team_id, pts, fgm, fga, fg3m, fg3a, ftm, fta, oreb, dreb, ast, stl, blk, tov, paint_pts, fast_break_pts, pts_off_tov)",
        &game.team_boxes,
        |mut row, t| {
            row.push_bind(game_id).push_bind(t.team_id).push_bind(t.pts).push_bind(t.fgm).push_bind(t.fga);
            row.push_bind(t.fg3m).push_bind(t.fg3a).push_bind(t.ftm).push_bind(t.fta).push_bind(t.oreb);
            row.push_bind(t.dreb).push_bind(t.ast).push_bind(t.stl).push_bind(t.blk).push_bind(t.tov);
            row.push_bind(t.paint_pts).push_bind(t.fast_break_pts).push_bind(t.pts_off_tov);
        },
    )
    .await?;
    insert(
        &mut tx,
        "game_periods (game_id, team_id, period, pts)",
        &game.periods,
        |mut row, p| {
            row.push_bind(game_id)
                .push_bind(p.team_id)
                .push_bind(p.period)
                .push_bind(p.pts);
        },
    )
    .await?;
    insert(
        &mut tx,
        "game_players (game_id, player_id, team_id, starter, minutes, pts, fgm, fga, fg3m, fg3a, ftm, fta, oreb, dreb, ast, stl, blk, tov, pf, plus_minus)",
        &game.player_boxes,
        |mut row, p| {
            row.push_bind(game_id).push_bind(p.player_id).push_bind(p.team_id).push_bind(p.starter);
            row.push_bind(p.minutes).push_bind(p.pts).push_bind(p.fgm).push_bind(p.fga).push_bind(p.fg3m);
            row.push_bind(p.fg3a).push_bind(p.ftm).push_bind(p.fta).push_bind(p.oreb).push_bind(p.dreb);
            row.push_bind(p.ast).push_bind(p.stl).push_bind(p.blk).push_bind(p.tov).push_bind(p.pf);
            row.push_bind(p.plus_minus);
        },
    )
    .await?;
    let plays: Vec<_> = game.plays.iter().enumerate().collect();
    insert(
        &mut tx,
        "plays (game_id, ord, period, clock_s, type_text, team_id, home_score, away_score, text, player1_id, player2_id, player3_id, shooting, score_value, points_attempted, x, y)",
        &plays,
        |mut row, (i, p)| {
            row.push_bind(game_id).push_bind(*i as i64).push_bind(p.period).push_bind(p.clock_seconds);
            row.push_bind(&p.type_text).push_bind(p.team_id).push_bind(p.home_score).push_bind(p.away_score);
            row.push_bind(&p.text).push_bind(p.players[0]).push_bind(p.players[1]).push_bind(p.players[2]);
            row.push_bind(p.shooting).push_bind(p.score_value).push_bind(p.points_attempted);
            row.push_bind(p.position.map(|c| c.0)).push_bind(p.position.map(|c| c.1));
        },
    )
    .await?;
    tx.commit().await?;
    Ok(())
}

async fn insert<'a, T>(
    tx: &mut Transaction<'_, MySql>,
    table_and_columns: &'static str,
    rows: &'a [T],
    push_row: impl FnMut(sqlx::query_builder::Separated<'_, MySql, &'static str>, &'a T),
) -> Result<()> {
    if rows.is_empty() {
        return Ok(());
    }
    let mut q = QueryBuilder::<MySql>::new("INSERT INTO ");
    q.push(table_and_columns).push(" ");
    q.push_values(rows, push_row);
    q.build().execute(&mut **tx).await?;
    Ok(())
}
