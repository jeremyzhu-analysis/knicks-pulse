//! Every number on the page. Sums run left to right from 0.0 in a fixed
//! order (games by date, lineups in order of first appearance); a different
//! order changes the last digits of the results.

use std::collections::HashMap;

use anyhow::Result;
use jiff::tz::TimeZone;
use serde::Serialize;
use ts_rs::TS;

use crate::report::dates::{day_number, last_name, season_label};
use crate::report::lineups::{FloorPeriod, GameMoment, Replay, Stint, replay_game};
use crate::report::load::{BoxScore, Dataset, Game, PlayerGame};

// ---------------------------------------------------------------- basics

/// `iter().sum()` starts at -0.0, which would print as -0.0 for an empty sum.
fn sum<T>(items: &[T], value: impl Fn(&T) -> f64) -> f64 {
    items.iter().fold(0.0, |total, item| total + value(item))
}

fn ratio(a: f64, b: f64) -> f64 {
    if b == 0.0 { 0.0 } else { a / b }
}

fn count<T>(items: &[T], test: impl Fn(&T) -> bool) -> i32 {
    items.iter().filter(|item| test(item)).count() as i32
}

/// Possessions per team, averaging both teams' estimates.
pub fn possessions(game: &Game) -> f64 {
    let estimate = |b: &BoxScore| {
        f64::from(b.fga) + 0.44 * f64::from(b.fta) - f64::from(b.oreb) + f64::from(b.tov)
    };
    (estimate(&game.us) + estimate(&game.them)) / 2.0
}

fn game_minutes(game: &Game) -> f64 {
    f64::from(48 + 5 * (game.periods - 4).max(0))
}

pub fn margin(game: &Game) -> i32 {
    game.pts - game.opp_pts
}

pub fn won(game: &Game) -> bool {
    game.pts > game.opp_pts
}

#[derive(Serialize, TS, Clone)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct Ratings {
    pub games: i32,
    pub wins: i32,
    pub losses: i32,
    pub margin: f64,
    pub offense: f64,
    pub defense: f64,
    pub net: f64,
    pub pace: f64,
    pub scored: f64,
    pub allowed: f64,
}

pub fn ratings(games: &[&Game]) -> Ratings {
    let n = games.len() as f64;
    let poss = sum(games, |g| possessions(g));
    let offense = ratio(100.0 * sum(games, |g| f64::from(g.pts)), poss);
    let defense = ratio(100.0 * sum(games, |g| f64::from(g.opp_pts)), poss);
    let wins = count(games, |g| won(g));
    Ratings {
        games: games.len() as i32,
        wins,
        losses: games.len() as i32 - wins,
        margin: ratio(sum(games, |g| f64::from(margin(g))), n),
        offense,
        defense,
        net: offense - defense,
        pace: ratio(48.0 * poss, sum(games, |g| game_minutes(g))),
        scored: ratio(sum(games, |g| f64::from(g.pts)), n),
        allowed: ratio(sum(games, |g| f64::from(g.opp_pts)), n),
    }
}

/// The margin chart's running averages, in games.
const ROLLING_WINDOWS: [usize; 2] = [5, 10];
/// The running average starts at this game of a season.
const ROLLING_FIRST_GAME: usize = 3;

#[derive(Serialize, TS)]
#[ts(export)]
pub struct Rolling {
    pub window: i32,
    /// One per game, oldest first: the average margin of the last `window`
    /// games up to that one, fewer early in the season; null before the
    /// average starts.
    pub values: Vec<Option<f64>>,
}

pub fn rolling_margins(games: &[&Game]) -> Vec<Rolling> {
    ROLLING_WINDOWS
        .iter()
        .map(|&window| Rolling {
            window: window as i32,
            values: (1..=games.len())
                .map(|played| {
                    let last = &games[played.saturating_sub(window)..played];
                    (played >= ROLLING_FIRST_GAME)
                        .then(|| sum(last, |g| f64::from(margin(g))) / last.len() as f64)
                })
                .collect(),
        })
        .collect()
}

// ---------------------------------------------------------------- seasons

pub struct Season<'a> {
    pub key: String,
    pub year: i32,
    pub season_type: i32,
    pub label: String,
    pub games: Vec<&'a Game>,
    pub ratings: Ratings,
}

fn group_seasons(games: &[Game]) -> Vec<Season<'_>> {
    let mut order: Vec<String> = Vec::new();
    let mut map: HashMap<String, Vec<&Game>> = HashMap::new();
    for game in games {
        let key = format!("{}:{}", game.season_year, game.season_type);
        if !map.contains_key(&key) {
            order.push(key.clone());
        }
        map.entry(key).or_default().push(game);
    }
    let mut seasons: Vec<Season> = order
        .into_iter()
        .map(|key| {
            let list = map.remove(&key).unwrap_or_default();
            let first = list[0];
            Season {
                year: first.season_year,
                season_type: first.season_type,
                label: season_label(first.season_year, first.season_type),
                ratings: ratings(&list),
                games: list,
                key,
            }
        })
        .collect();
    seasons.sort_by(|a, b| b.year.cmp(&a.year).then(a.season_type.cmp(&b.season_type)));
    seasons
}

// ---------------------------------------------------------------- four factors

#[derive(Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct Factor {
    pub label: String,
    pub now: f64,
    pub was: f64,
    pub is_percent: bool,
    /// True when a higher value is good for the report team.
    pub higher_helps: bool,
}

#[derive(Serialize, TS)]
#[ts(export)]
pub struct Factors {
    pub offense: Vec<Factor>,
    pub defense: Vec<Factor>,
}

#[derive(Clone, Copy, PartialEq)]
enum Side {
    Us,
    Them,
}

struct FactorRows {
    efg: f64,
    tov: f64,
    orb: f64,
    ftr: f64,
    paint: f64,
    fast_break: f64,
    off_tov: f64,
}

fn factor_rows(games: &[&Game], side: Side) -> FactorRows {
    let own = |g: &Game| if side == Side::Us { g.us } else { g.them };
    let other = |g: &Game| if side == Side::Us { g.them } else { g.us };
    let n = games.len() as f64;
    let total = |f: &dyn Fn(BoxScore, BoxScore) -> f64| sum(games, |g| f(own(g), other(g)));
    FactorRows {
        efg: ratio(
            total(&|o, _| f64::from(o.fgm) + 0.5 * f64::from(o.fg3m)),
            total(&|o, _| f64::from(o.fga)),
        ),
        tov: ratio(
            total(&|o, _| f64::from(o.tov)),
            total(&|o, _| f64::from(o.fga) + 0.44 * f64::from(o.fta) + f64::from(o.tov)),
        ),
        orb: ratio(
            total(&|o, _| f64::from(o.oreb)),
            total(&|o, x| f64::from(o.oreb + x.dreb)),
        ),
        ftr: ratio(
            total(&|o, _| f64::from(o.fta)),
            total(&|o, _| f64::from(o.fga)),
        ),
        paint: ratio(total(&|o, _| f64::from(o.paint_pts)), n),
        fast_break: ratio(total(&|o, _| f64::from(o.fast_break_pts)), n),
        off_tov: ratio(total(&|o, _| f64::from(o.pts_off_tov)), n),
    }
}

pub fn factors(now: &[&Game], was: &[&Game]) -> Factors {
    let build = |side: Side, prefix: &str, offense: bool| {
        let a = factor_rows(now, side);
        let b = factor_rows(was, side);
        let row = |label: &str,
                   pick: fn(&FactorRows) -> f64,
                   is_percent: bool,
                   higher_is_good_for_shooter: bool| {
            let label = if prefix.is_empty() {
                label.to_string()
            } else {
                let mut chars = label.chars();
                let first = chars
                    .next()
                    .map(|c| c.to_lowercase().to_string())
                    .unwrap_or_default();
                format!("{prefix} {first}{}", chars.as_str())
            };
            Factor {
                label,
                now: pick(&a),
                was: pick(&b),
                is_percent,
                higher_helps: if offense {
                    higher_is_good_for_shooter
                } else {
                    !higher_is_good_for_shooter
                },
            }
        };
        vec![
            row("Effective field-goal %", |r| r.efg, true, true),
            row("Turnover rate", |r| r.tov, true, false),
            row("Offensive rebound rate", |r| r.orb, true, true),
            row("Free-throw rate", |r| r.ftr, true, true),
            row("Points in the paint", |r| r.paint, false, true),
            row("Fast-break points", |r| r.fast_break, false, true),
            row("Points off turnovers", |r| r.off_tov, false, true),
        ]
    };
    Factors {
        offense: build(Side::Us, "", true),
        defense: build(Side::Them, "Opponent", false),
    }
}

// ---------------------------------------------------------------- quarters

#[derive(Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct QuarterRow {
    pub quarter: i32,
    pub scored: f64,
    pub allowed: f64,
    pub margin: f64,
    pub ahead: i32,
    pub behind: i32,
    pub tied: i32,
    pub last_margin: Option<f64>,
}

fn period_pts(list: &[i32], q: usize) -> i32 {
    list.get(q).copied().unwrap_or(0)
}

fn quarter_diff(g: &Game, q: usize) -> i32 {
    period_pts(&g.us_by_period, q) - period_pts(&g.them_by_period, q)
}

fn quarter_margin(games: &[&Game], q: usize) -> f64 {
    ratio(
        sum(games, |g| f64::from(quarter_diff(g, q))),
        games.len() as f64,
    )
}

pub fn quarters(now: &[&Game], was: Option<&[&Game]>) -> Vec<QuarterRow> {
    (0..4)
        .map(|q| {
            let diffs: Vec<i32> = now.iter().map(|g| quarter_diff(g, q)).collect();
            QuarterRow {
                quarter: q as i32 + 1,
                scored: ratio(
                    sum(now, |g| f64::from(period_pts(&g.us_by_period, q))),
                    now.len() as f64,
                ),
                allowed: ratio(
                    sum(now, |g| f64::from(period_pts(&g.them_by_period, q))),
                    now.len() as f64,
                ),
                margin: quarter_margin(now, q),
                ahead: count(&diffs, |&d| d > 0),
                behind: count(&diffs, |&d| d < 0),
                tied: count(&diffs, |&d| d == 0),
                last_margin: was.filter(|w| !w.is_empty()).map(|w| quarter_margin(w, q)),
            }
        })
        .collect()
}

// ---------------------------------------------------------------- situations

#[derive(Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct Split {
    pub games: i32,
    pub wins: i32,
    pub losses: i32,
    pub margin: f64,
    pub net: f64,
}

#[derive(Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct Situation {
    pub label: String,
    pub now: Option<Split>,
    pub last: Option<Split>,
}

fn split(games: &[&Game]) -> Option<Split> {
    if games.is_empty() {
        return None;
    }
    let r = ratings(games);
    Some(Split {
        games: r.games,
        wins: r.wins,
        losses: r.losses,
        margin: r.margin,
        net: r.net,
    })
}

fn situation_games<'a>(
    games: &[&'a Game],
    new_york: &TimeZone,
) -> Result<Vec<(&'static str, Vec<&'a Game>)>> {
    // Days of rest and the previous result, for every game but the first.
    let mut rest_of: Vec<Option<i64>> = vec![None; games.len()];
    let mut after: Vec<Option<bool>> = vec![None; games.len()];
    for i in 1..games.len() {
        let previous = games[i - 1];
        rest_of[i] = Some(
            day_number(games[i].starts_at, new_york)?
                - day_number(previous.starts_at, new_york)?
                - 1,
        );
        after[i] = Some(won(previous));
    }
    let pick = |test: &dyn Fn(usize) -> bool| -> Vec<&'a Game> {
        games
            .iter()
            .enumerate()
            .filter(|(i, _)| test(*i))
            .map(|(_, g)| *g)
            .collect()
    };
    let rest = |test: fn(i64) -> bool| pick(&|i| rest_of[i].is_some_and(test));
    Ok(vec![
        ("Home", pick(&|i| games[i].home && !games[i].neutral)),
        ("Road", pick(&|i| !games[i].home && !games[i].neutral)),
        ("Back-to-back", rest(|d| d == 0)),
        ("One day off", rest(|d| d == 1)),
        ("Two or more days off", rest(|d| d >= 2)),
        ("After a win", pick(&|i| after[i] == Some(true))),
        ("After a loss", pick(&|i| after[i] == Some(false))),
    ])
}

pub fn situations(
    now: &[&Game],
    was: Option<&[&Game]>,
    new_york: &TimeZone,
) -> Result<Vec<Situation>> {
    let last = was.map(|w| situation_games(w, new_york)).transpose()?;
    Ok(situation_games(now, new_york)?
        .into_iter()
        .enumerate()
        .map(|(i, (label, games))| Situation {
            label: label.to_string(),
            now: split(&games),
            last: last.as_ref().and_then(|l| split(&l[i].1)),
        })
        .collect())
}

// ---------------------------------------------------------------- players and pairs

/// Thresholds for the impact label. Per-game numbers unless named per 36.
mod impact {
    pub const LOW_MINUTES: i32 = 60;
    pub const DRAG_ON_OFF: f64 = -9.0;
    pub const LIFT_ON_OFF: f64 = 8.0;
    pub const TWO_WAY_PTS: f64 = 10.0;
    pub const TWO_WAY_STOCKS: f64 = 2.0;
    pub const SCORING_PTS: f64 = 12.0;
    pub const SCORING_PER36: f64 = 15.0;
    pub const SCORING_TS: f64 = 0.56;
    pub const CREATION_AST_PER36: f64 = 6.0;
    pub const CREATION_AST_PER_TOV: f64 = 2.0;
    pub const DISRUPTION_STL_PER36: f64 = 1.6;
    pub const RIM_BLK_PER36: f64 = 1.5;
    pub const REBOUNDING_PER36: f64 = 9.0;
}

#[derive(Serialize, TS, Clone, Copy, PartialEq, Debug)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub enum ImpactKind {
    LowMinutes,
    LineupDrag,
    TwoWay,
    Scoring,
    Creation,
    LineupLift,
    Disruption,
    RimProtection,
    Rebounding,
    Mixed,
}

#[derive(Serialize, TS, Clone, Copy, PartialEq, Debug)]
#[serde(rename_all = "lowercase")]
#[ts(export)]
pub enum ImpactTone {
    Score,
    Lift,
    Drag,
    Muted,
}

#[derive(Serialize, TS, Clone, Copy)]
#[ts(export)]
pub struct Impact {
    pub kind: ImpactKind,
    pub tone: ImpactTone,
}

/// A player's season in one quarter.
#[derive(Serialize, TS, Clone)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct PlayerQuarter {
    pub quarter: i32,
    /// Points per game, over the games whose play-by-play adds up to the
    /// player's points; null without such a game.
    pub pts: Option<f64>,
    /// Net points per game while on the floor, and the opponent's points per
    /// 48 minutes then; null without a usable replay.
    pub plus_minus: Option<f64>,
    pub opp48: Option<f64>,
}

#[derive(Serialize, TS, Clone)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct PlayerRow {
    pub id: u32,
    pub name: String,
    pub last: String,
    pub position: Option<String>,
    pub gp: i32,
    pub minutes: i32,
    pub mpg: f64,
    pub ppg: f64,
    pub rpg: f64,
    pub apg: f64,
    pub spg: f64,
    pub bpg: f64,
    pub topg: f64,
    pub ts: f64,
    /// Share of the team's possessions the player ended while on the floor,
    /// in percent: each game's rate weighted by the minutes played in it.
    pub usg: f64,
    pub plus_minus: f64,
    /// Net points per 48 with the player on and off the floor; null without a usable replay.
    pub on48: Option<f64>,
    pub off48: Option<f64>,
    /// Points per 48 by the team and by its opponent, with the player on and off.
    pub team48_on: Option<f64>,
    pub team48_off: Option<f64>,
    pub opp48: Option<f64>,
    pub opp48_off: Option<f64>,
    /// Q1 to Q4.
    pub quarters: Vec<PlayerQuarter>,
    /// `on48 - off48`.
    pub on_off: Option<f64>,
    /// The same player's `on_off` in the regular season before; set only in
    /// the current season.
    pub previous_on_off: Option<f64>,
    pub impact: Impact,
}

#[derive(Serialize, TS, Clone, Copy)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct PairCell {
    pub seconds: f64,
    pub net48: f64,
}

#[derive(Serialize, TS)]
#[ts(export)]
pub struct PairPlayer {
    pub id: u32,
    pub last: String,
}

#[derive(Serialize, TS)]
#[ts(export)]
pub struct PairExtreme {
    pub a: String,
    pub b: String,
    pub cell: PairCell,
}

#[derive(Serialize, TS)]
#[ts(export)]
pub struct Pairs {
    pub players: Vec<PairPlayer>,
    /// cells[i][j]; the diagonal is the player alone. null under the minute floor.
    pub cells: Vec<Vec<Option<PairCell>>>,
    pub best: Option<PairExtreme>,
    pub worst: Option<PairExtreme>,
}

#[derive(Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct PlayerReport {
    pub players: Vec<PlayerRow>,
    pub pairs: Pairs,
    pub replayed_games: i32,
}

pub const PAIR_MIN_SECONDS: f64 = 8.0 * 60.0;
const PAIR_PLAYERS: usize = 8;

fn per48(points: f64, seconds: f64) -> f64 {
    if seconds == 0.0 {
        0.0
    } else {
        (points / seconds) * 2880.0
    }
}

fn impact_of(p: &PlayerRow, on_off: Option<f64>) -> Impact {
    use ImpactKind::*;
    use ImpactTone::*;
    let per36 = |value: f64| ratio(value * f64::from(p.gp) * 36.0, f64::from(p.minutes));
    let make = |kind, tone| Impact { kind, tone };
    if p.minutes < impact::LOW_MINUTES {
        return make(LowMinutes, Muted);
    }
    if on_off.is_some_and(|d| d <= impact::DRAG_ON_OFF) {
        return make(LineupDrag, Drag);
    }
    if p.ppg >= impact::TWO_WAY_PTS && p.spg + p.bpg >= impact::TWO_WAY_STOCKS {
        return make(TwoWay, Lift);
    }
    if p.ppg >= impact::SCORING_PTS
        || (per36(p.ppg) >= impact::SCORING_PER36 && p.ts >= impact::SCORING_TS)
    {
        return make(Scoring, Score);
    }
    if per36(p.apg) >= impact::CREATION_AST_PER36 && p.apg >= impact::CREATION_AST_PER_TOV * p.topg
    {
        return make(Creation, Score);
    }
    if on_off.is_some_and(|d| d >= impact::LIFT_ON_OFF) {
        return make(LineupLift, Lift);
    }
    if per36(p.spg) >= impact::DISRUPTION_STL_PER36 {
        return make(Disruption, Muted);
    }
    if per36(p.bpg) >= impact::RIM_BLK_PER36 {
        return make(RimProtection, Muted);
    }
    if per36(p.rpg) >= impact::REBOUNDING_PER36 {
        return make(Rebounding, Muted);
    }
    make(Mixed, Muted)
}

#[derive(Default, Clone, Copy)]
struct FloorTime {
    seconds: f64,
    pts_for: i32,
    pts_against: i32,
}

impl FloorTime {
    fn add(&mut self, seconds: f64, pts_for: i32, pts_against: i32) {
        self.seconds += seconds;
        self.pts_for += pts_for;
        self.pts_against += pts_against;
    }
}

/// A possession ends with a shot, a trip to the line or a turnover.
fn possessions_used(fga: i32, fta: i32, tov: i32) -> f64 {
    f64::from(fga) + 0.44 * f64::from(fta) + f64::from(tov)
}

/// The player's share of the team's possessions in one game, in percent,
/// scaled to the time they were on the floor.
fn usage(p: &PlayerGame, game: &Game) -> f64 {
    let team_minutes: i32 = game.players.iter().map(|l| l.minutes).sum();
    let team = possessions_used(game.us.fga, game.us.fta, game.us.tov);
    if p.minutes <= 0 || team <= 0.0 {
        return 0.0;
    }
    100.0 * possessions_used(p.fga, p.fta, p.tov) * (f64::from(team_minutes) / 5.0)
        / (f64::from(p.minutes) * team)
}

/// Each game's points by period, by game id.
pub type PeriodPoints<'a> = HashMap<&'a str, HashMap<u32, Vec<i32>>>;

/// One quarter of a player's season, summed over games.
#[derive(Default, Clone, Copy)]
struct QuarterTotals {
    /// Games whose play-by-play adds up to the player's points.
    scored_games: i32,
    pts: i32,
    /// Replayed games the player appeared in.
    floor_games: i32,
    floor: FloorPeriod,
}

pub fn player_report(
    games: &[&Game],
    replays: &HashMap<&str, Replay>,
    points: &PeriodPoints,
) -> PlayerReport {
    let mut team = FloorTime::default();
    let mut on: HashMap<u32, FloorTime> = HashMap::new();
    let mut together: HashMap<(u32, u32), FloorTime> = HashMap::new();
    let mut replayed_games = 0;
    for game in games {
        let Some(replay) = replays.get(game.id.as_str()).filter(|r| r.ok) else {
            continue;
        };
        replayed_games += 1;
        for l in &replay.lineups {
            team.add(l.seconds, l.pts_for, l.pts_against);
            for &a in &l.players {
                on.entry(a)
                    .or_default()
                    .add(l.seconds, l.pts_for, l.pts_against);
                for &b in &l.players {
                    if a >= b {
                        continue;
                    }
                    together
                        .entry((a, b))
                        .or_default()
                        .add(l.seconds, l.pts_for, l.pts_against);
                }
            }
        }
    }

    // Players in order of first appearance; it breaks ties in the minutes sort below.
    let mut order: Vec<u32> = Vec::new();
    let mut by_id: HashMap<u32, Vec<&PlayerGame>> = HashMap::new();
    let mut usage_minutes: HashMap<u32, f64> = HashMap::new();
    let mut quarters: HashMap<u32, [QuarterTotals; 4]> = HashMap::new();
    for game in games {
        let replay = replays.get(game.id.as_str()).filter(|r| r.ok);
        let game_points = points.get(game.id.as_str());
        for p in &game.players {
            by_id
                .entry(p.player_id)
                .or_insert_with(|| {
                    order.push(p.player_id);
                    Vec::new()
                })
                .push(p);
            *usage_minutes.entry(p.player_id).or_default() += usage(p, game) * f64::from(p.minutes);
            let totals = quarters.entry(p.player_id).or_default();
            let scored = game_points.and_then(|g| g.get(&p.player_id));
            let floor = replay.and_then(|r| r.periods.get(&p.player_id));
            for (q, total) in totals.iter_mut().enumerate() {
                if let Some(scored) = scored {
                    total.scored_games += 1;
                    total.pts += scored.get(q).copied().unwrap_or(0);
                }
                if let Some(floor) = floor {
                    let f = floor.get(q).copied().unwrap_or_default();
                    total.floor_games += 1;
                    total.floor.seconds += f.seconds;
                    total.floor.pts_for += f.pts_for;
                    total.floor.pts_against += f.pts_against;
                }
            }
        }
    }

    let mut players: Vec<PlayerRow> = order
        .iter()
        .map(|id| {
            let lines = &by_id[id];
            let first = lines[0];
            let gp = lines.len() as i32;
            let n = f64::from(gp);
            let total = |f: fn(&PlayerGame) -> f64| sum(lines, |l| f(l));
            let minutes = lines.iter().map(|l| l.minutes).sum();
            let floor = on.get(id);
            let off_seconds = team.seconds - floor.map_or(0.0, |f| f.seconds);
            let split = floor.filter(|f| f.seconds > 0.0 && off_seconds > 0.0);
            let quarters = quarters[id]
                .iter()
                .enumerate()
                .map(|(q, t)| PlayerQuarter {
                    quarter: q as i32 + 1,
                    pts: (t.scored_games > 0).then(|| f64::from(t.pts) / f64::from(t.scored_games)),
                    plus_minus: (t.floor_games > 0).then(|| {
                        f64::from(t.floor.pts_for - t.floor.pts_against) / f64::from(t.floor_games)
                    }),
                    opp48: (t.floor.seconds > 0.0)
                        .then(|| per48(f64::from(t.floor.pts_against), t.floor.seconds)),
                })
                .collect();
            let mut row = PlayerRow {
                id: *id,
                name: first.full_name.clone(),
                last: last_name(&first.full_name),
                position: first.position.clone(),
                gp,
                minutes,
                mpg: f64::from(minutes) / n,
                ppg: total(|l| f64::from(l.pts)) / n,
                rpg: total(|l| f64::from(l.reb)) / n,
                apg: total(|l| f64::from(l.ast)) / n,
                spg: total(|l| f64::from(l.stl)) / n,
                bpg: total(|l| f64::from(l.blk)) / n,
                topg: total(|l| f64::from(l.tov)) / n,
                ts: ratio(
                    total(|l| f64::from(l.pts)),
                    2.0 * total(|l| f64::from(l.fga) + 0.44 * f64::from(l.fta)),
                ),
                usg: ratio(usage_minutes[id], f64::from(minutes)),
                plus_minus: total(|l| f64::from(l.plus_minus)) / n,
                on48: split.map(|f| per48(f64::from(f.pts_for - f.pts_against), f.seconds)),
                off48: split.map(|f| {
                    per48(
                        f64::from(team.pts_for - f.pts_for - (team.pts_against - f.pts_against)),
                        off_seconds,
                    )
                }),
                team48_on: split.map(|f| per48(f64::from(f.pts_for), f.seconds)),
                team48_off: split.map(|f| per48(f64::from(team.pts_for - f.pts_for), off_seconds)),
                opp48: split.map(|f| per48(f64::from(f.pts_against), f.seconds)),
                opp48_off: split
                    .map(|f| per48(f64::from(team.pts_against - f.pts_against), off_seconds)),
                quarters,
                on_off: None,
                previous_on_off: None,
                impact: Impact {
                    kind: ImpactKind::Mixed,
                    tone: ImpactTone::Muted,
                },
            };
            row.on_off = row.on48.zip(row.off48).map(|(a, b)| a - b);
            row.impact = impact_of(&row, row.on_off);
            row
        })
        .collect();
    players.sort_by_key(|p| std::cmp::Reverse(p.minutes));

    let top = &players[..players.len().min(PAIR_PLAYERS)];
    let cell = |f: Option<&FloorTime>| {
        f.filter(|f| f.seconds >= PAIR_MIN_SECONDS)
            .map(|f| PairCell {
                seconds: f.seconds,
                net48: per48(f64::from(f.pts_for - f.pts_against), f.seconds),
            })
    };
    let cells: Vec<Vec<Option<PairCell>>> = top
        .iter()
        .map(|a| {
            top.iter()
                .map(|b| {
                    if a.id == b.id {
                        cell(on.get(&a.id))
                    } else {
                        cell(together.get(&(a.id.min(b.id), a.id.max(b.id))))
                    }
                })
                .collect()
        })
        .collect();
    let mut best: Option<PairExtreme> = None;
    let mut worst: Option<PairExtreme> = None;
    for (i, a) in top.iter().enumerate() {
        for (j, b) in top.iter().enumerate() {
            let Some(c) = cells[i][j].filter(|_| j > i) else {
                continue;
            };
            let extreme = || PairExtreme {
                a: a.last.clone(),
                b: b.last.clone(),
                cell: c,
            };
            if best.as_ref().is_none_or(|x| c.net48 > x.cell.net48) {
                best = Some(extreme());
            }
            if worst.as_ref().is_none_or(|x| c.net48 < x.cell.net48) {
                worst = Some(extreme());
            }
        }
    }

    PlayerReport {
        pairs: Pairs {
            players: top
                .iter()
                .map(|p| PairPlayer {
                    id: p.id,
                    last: p.last.clone(),
                })
                .collect(),
            cells,
            best,
            worst,
        },
        players,
        replayed_games,
    }
}

// ---------------------------------------------------------------- one game

/// The score after every play that changed it, from the opening tip at 0-0.
pub fn flow(game: &Game) -> Vec<GameMoment> {
    let mut moments = vec![GameMoment {
        period: 1,
        clock_seconds: 720.0,
        us: 0,
        them: 0,
    }];
    let (mut us, mut them) = (0, 0);
    for play in &game.plays {
        let (now_us, now_them) = if game.home {
            (play.home_score, play.away_score)
        } else {
            (play.away_score, play.home_score)
        };
        if (now_us, now_them) != (us, them) {
            (us, them) = (now_us, now_them);
            moments.push(GameMoment {
                period: play.period,
                clock_seconds: play.clock_seconds,
                us,
                them,
            });
        }
    }
    moments
}

/// One team's game: the four factors and where its points came from.
#[derive(Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct GameSide {
    pub efg: f64,
    pub tov: f64,
    pub orb: f64,
    pub ftr: f64,
    pub paint: i32,
    pub fast_break: i32,
    pub off_tov: i32,
    /// From the play-by-play; 0 for a team that never led.
    pub largest_lead: i32,
}

/// (the report team, its opponent)
pub fn game_sides(game: &Game, flow: &[GameMoment]) -> (GameSide, GameSide) {
    let build = |side: Side, own: &BoxScore, lead: fn(&GameMoment) -> i32| {
        let rates = factor_rows(&[game], side);
        GameSide {
            efg: rates.efg,
            tov: rates.tov,
            orb: rates.orb,
            ftr: rates.ftr,
            paint: own.paint_pts,
            fast_break: own.fast_break_pts,
            off_tov: own.pts_off_tov,
            largest_lead: flow.iter().map(lead).max().unwrap_or(0).max(0),
        }
    };
    (
        build(Side::Us, &game.us, |m| m.us - m.them),
        build(Side::Them, &game.them, |m| m.them - m.us),
    )
}

/// John Hollinger's game score: a box-score line as one number, on the scale
/// of points.
pub fn game_score(p: &PlayerGame) -> f64 {
    f64::from(p.pts) + 0.4 * f64::from(p.fgm)
        - 0.7 * f64::from(p.fga)
        - 0.4 * f64::from(p.fta - p.ftm)
        + 0.7 * f64::from(p.oreb)
        + 0.3 * f64::from(p.dreb)
        + f64::from(p.stl)
        + 0.7 * f64::from(p.ast)
        + 0.7 * f64::from(p.blk)
        - 0.4 * f64::from(p.pf)
        - f64::from(p.tov)
}

/// Each player's points by period (index 0 is Q1), from the play-by-play.
/// A player is left out when their plays don't add up to their box-score
/// points, so a wrong split is never shown.
pub fn points_by_period(game: &Game) -> HashMap<u32, Vec<i32>> {
    let periods = game.periods.max(0) as usize;
    let mut by_player: HashMap<u32, Vec<i32>> = HashMap::new();
    for play in &game.plays {
        let Some(scorer) = play.players[0].filter(|_| play.score_value > 0) else {
            continue;
        };
        let Some(slot) = (play.period as usize)
            .checked_sub(1)
            .filter(|&i| i < periods)
        else {
            continue;
        };
        by_player.entry(scorer).or_insert_with(|| vec![0; periods])[slot] += play.score_value;
    }
    let mut checked = HashMap::new();
    for p in game.players.iter().chain(&game.opponent_players) {
        let points = by_player
            .remove(&p.player_id)
            .unwrap_or_else(|| vec![0; periods]);
        if points.iter().sum::<i32>() == p.pts {
            checked.insert(p.player_id, points);
        }
    }
    checked
}

#[derive(Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct GamePlayer {
    pub id: u32,
    pub name: String,
    pub position: Option<String>,
    pub starter: bool,
    pub minutes: i32,
    pub pts: i32,
    pub reb: i32,
    pub ast: i32,
    pub stl: i32,
    pub blk: i32,
    pub tov: i32,
    /// Null without a shot or free throw.
    pub ts: Option<f64>,
    pub plus_minus: i32,
    pub game_score: f64,
    /// Points by period, index 0 is Q1; null when the play-by-play doesn't
    /// add up to the player's points.
    pub points_by_period: Option<Vec<i32>>,
    /// Empty for an opponent, and when the game's replay didn't hold up.
    pub stints: Vec<Stint>,
}

/// Starters first, then by minutes. `replay` is the report team's; pass None
/// for the opponent's players.
pub fn game_players(
    players: &[PlayerGame],
    points_by_period: &HashMap<u32, Vec<i32>>,
    replay: Option<&Replay>,
) -> Vec<GamePlayer> {
    let mut players: Vec<GamePlayer> = players
        .iter()
        .map(|p| {
            let shots = f64::from(p.fga) + 0.44 * f64::from(p.fta);
            GamePlayer {
                id: p.player_id,
                name: p.full_name.clone(),
                position: p.position.clone(),
                starter: p.starter,
                minutes: p.minutes,
                pts: p.pts,
                reb: p.reb,
                ast: p.ast,
                stl: p.stl,
                blk: p.blk,
                tov: p.tov,
                ts: (shots > 0.0).then(|| f64::from(p.pts) / (2.0 * shots)),
                plus_minus: p.plus_minus,
                game_score: game_score(p),
                points_by_period: points_by_period.get(&p.player_id).cloned(),
                stints: replay
                    .filter(|replay| replay.ok)
                    .and_then(|replay| replay.stints.get(&p.player_id))
                    .cloned()
                    .unwrap_or_default(),
            }
        })
        .collect();
    players.sort_by_key(|p| (std::cmp::Reverse(p.starter), std::cmp::Reverse(p.minutes)));
    players
}

// ---------------------------------------------------------------- shots

/// The half court the shot map draws, in ESPN's feet: x across the floor, y
/// out from the basket. Attempts from outside it (heaves from the backcourt)
/// are left off the map and out of its counts.
const SHOT_X: std::ops::RangeInclusive<i16> = -2..=52;
const SHOT_Y: std::ops::RangeInclusive<i16> = -8..=45;

#[derive(Serialize, TS)]
#[ts(export)]
pub struct Shot {
    /// Player id.
    pub p: u32,
    pub x: i16,
    pub y: i16,
    pub made: bool,
    /// 2 or 3.
    pub value: i32,
    pub period: i32,
}

#[derive(Serialize, TS)]
#[ts(export)]
pub struct Shooter {
    pub id: u32,
    pub last: String,
    pub makes: i32,
    pub attempts: i32,
}

/// The report team's field-goal attempts of one season.
#[derive(Serialize, TS)]
#[ts(export)]
pub struct ShotMap {
    /// As in `Season`.
    pub key: String,
    /// Most attempts first.
    pub players: Vec<Shooter>,
    pub makes: i32,
    pub attempts: i32,
    /// In game order.
    pub shots: Vec<Shot>,
}

pub fn shot_map(key: &str, games: &[&Game]) -> ShotMap {
    let mut shots = Vec::new();
    let mut players: Vec<Shooter> = Vec::new();
    for game in games {
        for play in &game.plays {
            let (Some(shooter), Some((x, y))) = (play.players[0], play.position) else {
                continue;
            };
            if !play.shooting
                || play.points_attempted < 2
                || !SHOT_X.contains(&x)
                || !SHOT_Y.contains(&y)
            {
                continue;
            }
            let Some(line) = game.players.iter().find(|p| p.player_id == shooter) else {
                continue;
            };
            let made = play.score_value > 0;
            let i = players
                .iter()
                .position(|p| p.id == shooter)
                .unwrap_or_else(|| {
                    players.push(Shooter {
                        id: shooter,
                        last: last_name(&line.full_name),
                        makes: 0,
                        attempts: 0,
                    });
                    players.len() - 1
                });
            players[i].attempts += 1;
            players[i].makes += i32::from(made);
            shots.push(Shot {
                p: shooter,
                x,
                y,
                made,
                value: play.points_attempted,
                period: play.period,
            });
        }
    }
    players.sort_by_key(|p| std::cmp::Reverse(p.attempts));
    ShotMap {
        key: key.to_string(),
        makes: players.iter().map(|p| p.makes).sum(),
        attempts: players.iter().map(|p| p.attempts).sum(),
        players,
        shots,
    }
}

// ---------------------------------------------------------------- report

pub struct SeasonReport<'a> {
    pub season: Season<'a>,
    pub player_report: PlayerReport,
}

#[derive(Serialize, TS)]
#[ts(export)]
pub struct LastSeries {
    pub round: String,
    pub wins: i32,
    pub losses: i32,
    pub opponent: String,
}

pub struct Report<'a> {
    pub game_count: i32,
    pub replayed_games: i32,
    /// Most recent first: current regular season, then older ones.
    pub seasons: Vec<SeasonReport<'a>>,
    /// Indexes into `seasons`.
    pub current: Option<usize>,
    pub last_regular: Option<usize>,
    pub latest_game: Option<&'a Game>,
    pub last_series: Option<LastSeries>,
    pub points: PeriodPoints<'a>,
}

/// "NBA Finals - Game 5" -> "Finals"
fn round_name(note: Option<&str>) -> Option<String> {
    let note = note.filter(|n| !n.is_empty())?;
    let without_game = strip_game_suffix(note).unwrap_or(note);
    let without_nba = without_game
        .strip_prefix("NBA")
        .filter(|rest| rest.starts_with(char::is_whitespace))
        .map_or(without_game, str::trim_start);
    let round = without_nba.trim();
    (!round.is_empty()).then(|| round.to_string())
}

/// Removes a trailing `\s*-\s*Game \d+` (case-insensitive), if there is one.
fn strip_game_suffix(note: &str) -> Option<&str> {
    let digits = note.len() - note.trim_end_matches(|c: char| c.is_ascii_digit()).len();
    if digits == 0 {
        return None;
    }
    let before_digits = &note[..note.len() - digits];
    let game = before_digits.len().checked_sub("game ".len())?;
    if !before_digits.is_char_boundary(game) || !before_digits[game..].eq_ignore_ascii_case("game ")
    {
        return None;
    }
    let before_dash = before_digits[..game].trim_end().strip_suffix('-')?;
    Some(before_dash.trim_end())
}

pub fn build_report(data: &Dataset) -> Report<'_> {
    let replays: HashMap<&str, Replay> = data
        .games
        .iter()
        .map(|g| (g.id.as_str(), replay_game(g)))
        .collect();
    let points: PeriodPoints = data
        .games
        .iter()
        .map(|g| (g.id.as_str(), points_by_period(g)))
        .collect();
    let mut seasons: Vec<SeasonReport> = group_seasons(&data.games)
        .into_iter()
        .map(|season| SeasonReport {
            player_report: player_report(&season.games, &replays, &points),
            season,
        })
        .collect();
    let regular: Vec<usize> = (0..seasons.len())
        .filter(|&i| seasons[i].season.season_type == 2)
        .collect();
    let current = regular
        .first()
        .copied()
        .or(if seasons.is_empty() { None } else { Some(0) });
    let last_regular = current.and_then(|c| {
        let year = seasons[c].season.year;
        regular
            .iter()
            .copied()
            .find(|&i| seasons[i].season.year == year - 1)
    });

    if let (Some(current), Some(last)) = (current, last_regular) {
        let before: HashMap<u32, Option<f64>> = seasons[last]
            .player_report
            .players
            .iter()
            .map(|p| (p.id, p.on_off))
            .collect();
        for p in &mut seasons[current].player_report.players {
            p.previous_on_off = before.get(&p.id).copied().flatten();
        }
    }

    let last_series = seasons
        .iter()
        .find(|s| s.season.season_type == 3)
        .and_then(|playoffs| {
            let final_game = *playoffs.season.games.last()?;
            let series: Vec<&Game> = playoffs
                .season
                .games
                .iter()
                .copied()
                .filter(|g| g.opponent.id == final_game.opponent.id)
                .collect();
            let wins = count(&series, |g| won(g));
            Some(LastSeries {
                round: round_name(final_game.note.as_deref()).unwrap_or_else(|| "Playoffs".into()),
                wins,
                losses: series.len() as i32 - wins,
                opponent: final_game.opponent.name.clone(),
            })
        });

    Report {
        game_count: data.games.len() as i32,
        replayed_games: replays.values().filter(|r| r.ok).count() as i32,
        seasons,
        current,
        last_regular,
        latest_game: data.games.last(),
        last_series,
        points,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn round_names() {
        assert_eq!(
            round_name(Some("NBA Finals - Game 5")).as_deref(),
            Some("Finals")
        );
        assert_eq!(
            round_name(Some("East 1st Round - Game 7")).as_deref(),
            Some("East 1st Round")
        );
        assert_eq!(
            round_name(Some("East Semifinals -game 12")).as_deref(),
            Some("East Semifinals")
        );
        assert_eq!(
            round_name(Some("NBA Cup Final")).as_deref(),
            Some("Cup Final")
        );
        assert_eq!(round_name(Some("NBAX - Game 1")).as_deref(), Some("NBAX"));
        assert_eq!(round_name(Some("Game 3")).as_deref(), Some("Game 3"));
        assert_eq!(round_name(Some(" - Game 3")), None);
        assert_eq!(round_name(Some("")), None);
        assert_eq!(round_name(None), None);
    }
}
