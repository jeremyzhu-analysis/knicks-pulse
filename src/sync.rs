use std::collections::HashSet;

use anyhow::Result;
use sqlx::mysql::MySqlPool;
use sqlx::{MySql, QueryBuilder, Transaction};

use crate::config::TEAM_SLUG;
use crate::espn::{Espn, EspnHttpError, GameSummary, PLAYOFFS, REGULAR_SEASON};
use crate::report::dates::new_york;

pub struct SyncResult {
    pub completed: usize,
    pub added: usize,
}

/// Stores every completed game of the current and previous season (regular
/// season and playoffs) that isn't in the database yet. Finished games don't
/// change, so a stored game is never fetched again. Callers must not run two
/// syncs at once.
pub async fn sync_games(pool: &MySqlPool, espn: &Espn, log: impl Fn(&str)) -> Result<SyncResult> {
    let current = espn.schedule(TEAM_SLUG, None, REGULAR_SEASON).await?;
    let year = current.season_year;
    let schedules = [
        current,
        espn.schedule(TEAM_SLUG, Some(year), PLAYOFFS).await?,
        espn.schedule(TEAM_SLUG, Some(year - 1), REGULAR_SEASON)
            .await?,
        espn.schedule(TEAM_SLUG, Some(year - 1), PLAYOFFS).await?,
    ];
    let mut seen = HashSet::new();
    let ids: Vec<String> = schedules
        .into_iter()
        .flat_map(|s| s.completed_game_ids)
        .filter(|id| seen.insert(id.clone()))
        .collect();

    let stored: HashSet<String> = sqlx::query_scalar::<_, u64>("SELECT id FROM games")
        .fetch_all(pool)
        .await?
        .into_iter()
        .map(|id| id.to_string())
        .collect();
    let missing: Vec<&String> = ids.iter().filter(|id| !stored.contains(*id)).collect();
    log(&format!(
        "{} completed games, {} to fetch.",
        ids.len(),
        missing.len()
    ));

    let new_york = new_york()?;
    let mut added = 0;
    for id in missing {
        let game = match espn.game_summary(id).await {
            Ok(game) => game,
            // ESPN lists some finished games whose summary answers 404. Skipping
            // leaves them unstored, so every later sync asks for them again.
            Err(error)
                if error
                    .downcast_ref::<EspnHttpError>()
                    .is_some_and(|e| e.status == 404) =>
            {
                log(&format!("Skipped game {id}: ESPN has no summary for it."));
                continue;
            }
            Err(error) => return Err(error),
        };
        if !game.completed {
            continue;
        }
        store_game(pool, &game).await?;
        added += 1;
        log(&format!(
            "Stored {} {} {} at {} {}",
            game.starts_at
                .to_zoned(new_york.clone())
                .strftime("%Y-%m-%d"),
            game.away.abbreviation,
            game.away_score,
            game.home.abbreviation,
            game.home_score
        ));
    }
    Ok(SyncResult {
        completed: ids.len(),
        added,
    })
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
        "INSERT INTO games (id, season_year, season_type, starts_at, home_team_id, away_team_id, home_score, away_score, periods, venue, note, synced_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, UTC_TIMESTAMP())",
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
        "plays (game_id, ord, period, clock_s, type_text, team_id, home_score, away_score, text, player1_id, player2_id, player3_id)",
        &plays,
        |mut row, (i, p)| {
            row.push_bind(game_id).push_bind(*i as i64).push_bind(p.period).push_bind(p.clock_seconds);
            row.push_bind(&p.type_text).push_bind(p.team_id).push_bind(p.home_score).push_bind(p.away_score);
            row.push_bind(&p.text).push_bind(p.players[0]).push_bind(p.players[1]).push_bind(p.players[2]);
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
