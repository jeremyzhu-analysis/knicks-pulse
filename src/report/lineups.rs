use std::collections::{HashMap, HashSet};

use serde::Serialize;
use ts_rs::TS;

use crate::report::load::{Game, PlayRow};

/// A game's play-by-play replay is dropped when any player's replayed
/// plus-minus is further than this from the box score.
pub const REPLAY_TOLERANCE: i32 = 8;

pub struct LineupTotals {
    /// Ascending player ids.
    pub players: Vec<u32>,
    pub seconds: f64,
    pub pts_for: i32,
    pub pts_against: i32,
}

pub struct Replay {
    pub ok: bool,
    /// In order of first appearance; float sums depend on it.
    pub lineups: Vec<LineupTotals>,
    /// Each player's time on the floor, oldest first.
    pub stints: HashMap<u32, Vec<Stint>>,
}

/// A point in a game, with the score from the report team's side.
#[derive(Serialize, TS, Clone, Copy, PartialEq, Debug)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct GameMoment {
    pub period: i32,
    /// Seconds left in the period.
    pub clock_seconds: f64,
    pub us: i32,
    pub them: i32,
}

#[derive(Serialize, TS, Clone, Copy, PartialEq, Debug)]
#[ts(export)]
pub struct Stint {
    pub from: GameMoment,
    pub to: GameMoment,
}

#[derive(Default)]
struct StintLog {
    open: HashMap<u32, GameMoment>,
    done: HashMap<u32, Vec<Stint>>,
}

impl StintLog {
    /// A player already on the floor keeps the stint they're in, so a stint
    /// runs across a period break when they stay on for it.
    fn enter(&mut self, id: u32, at: GameMoment) {
        self.open.entry(id).or_insert(at);
    }
    fn leave(&mut self, id: u32, at: GameMoment) {
        let Some(from) = self.open.remove(&id) else {
            return;
        };
        // ESPN lists every substitution at a stoppage, so a player can come in
        // and go out again without any time or points passing.
        if from != at {
            self.done
                .entry(id)
                .or_default()
                .push(Stint { from, to: at });
        }
    }
    fn leave_unless_on(&mut self, on_floor: &Floor, at: GameMoment) {
        let gone: Vec<u32> = self
            .open
            .keys()
            .copied()
            .filter(|&id| !on_floor.has(id))
            .collect();
        for id in gone {
            self.leave(id, at);
        }
    }
}

fn period_seconds(period: i32) -> f64 {
    if period <= 4 { 720.0 } else { 300.0 }
}

/// Plays where a listed player may not be on the floor.
fn off_floor_play(type_text: &str) -> bool {
    let text = type_text.to_lowercase();
    ["technical", "ejection", "timeout", "jumpball", "jump ball"]
        .iter()
        .any(|w| text.contains(w))
}

/// 0 and a missing id both mean "no player".
fn player(id: Option<u32>) -> Option<u32> {
    id.filter(|&id| id != 0)
}

/// Players on the floor in the order they came on; that order decides who
/// fills the next period's five when substitutions don't say.
#[derive(Default)]
struct Floor(Vec<u32>);

impl Floor {
    fn has(&self, id: u32) -> bool {
        self.0.contains(&id)
    }
    fn add(&mut self, id: u32) {
        if !self.has(id) {
            self.0.push(id);
        }
    }
    fn delete(&mut self, id: u32) -> bool {
        match self.0.iter().position(|&x| x == id) {
            Some(i) => {
                self.0.remove(i);
                true
            }
            None => false,
        }
    }
    fn from_ids(ids: &[u32]) -> Self {
        let mut floor = Self::default();
        for &id in ids {
            floor.add(id);
        }
        floor
    }
}

#[derive(Default)]
struct Lineups {
    list: Vec<LineupTotals>,
    index: HashMap<Vec<u32>, usize>,
}

impl Lineups {
    fn entry(&mut self, on_floor: &Floor) -> usize {
        let mut players = on_floor.0.clone();
        players.sort_unstable();
        if let Some(&i) = self.index.get(&players) {
            return i;
        }
        self.list.push(LineupTotals {
            players: players.clone(),
            seconds: 0.0,
            pts_for: 0,
            pts_against: 0,
        });
        self.index.insert(players, self.list.len() - 1);
        self.list.len() - 1
    }
}

/// Rebuilds who was on the floor for the report team from substitutions.
/// ESPN doesn't list who starts the 2nd quarter onward, so each period's
/// five are inferred: players who appear before being subbed in, then
/// players still on the floor from the period before.
pub fn replay_game(game: &Game) -> Replay {
    let roster: HashSet<u32> = game.players.iter().map(|p| p.player_id).collect();
    let mut lineups = Lineups::default();
    let mut ok = true;
    let mut previous_end: Vec<u32> = game
        .players
        .iter()
        .filter(|p| p.starter)
        .map(|p| p.player_id)
        .collect();
    let mut last_home = 0;
    let mut last_away = 0;
    let mut stints = StintLog::default();
    let moment = |period: i32, clock_seconds: f64, home: i32, away: i32| {
        let (us, them) = if game.home {
            (home, away)
        } else {
            (away, home)
        };
        GameMoment {
            period,
            clock_seconds,
            us,
            them,
        }
    };

    for period in 1..=game.periods {
        let plays: Vec<&PlayRow> = game.plays.iter().filter(|p| p.period == period).collect();
        let mut on_floor = if period == 1 && previous_end.len() == 5 {
            Floor::from_ids(&previous_end)
        } else {
            Floor::from_ids(&period_starters(&plays, &roster, &previous_end))
        };
        if on_floor.0.len() != 5 {
            ok = false;
        }

        stints.leave_unless_on(&on_floor, moment(period - 1, 0.0, last_home, last_away));
        let period_start = moment(period, period_seconds(period), last_home, last_away);
        for &id in &on_floor.0 {
            stints.enter(id, period_start);
        }

        let mut clock = period_seconds(period);
        let mut current = lineups.entry(&on_floor);
        for play in &plays {
            let entry = &mut lineups.list[current];
            entry.seconds += f64::max(0.0, clock - play.clock_seconds);
            clock = play.clock_seconds;
            let d_home = play.home_score - last_home;
            let d_away = play.away_score - last_away;
            entry.pts_for += if game.home { d_home } else { d_away };
            entry.pts_against += if game.home { d_away } else { d_home };
            last_home = play.home_score;
            last_away = play.away_score;

            let (entering, leaving) = (player(play.players[0]), player(play.players[1]));
            if let (true, Some(entering), Some(leaving)) =
                (play.type_text == "Substitution", entering, leaving)
                && roster.contains(&entering)
            {
                if !on_floor.delete(leaving) || on_floor.has(entering) {
                    ok = false;
                }
                on_floor.add(entering);
                let now = moment(period, clock, last_home, last_away);
                stints.leave(leaving, now);
                stints.enter(entering, now);
                if on_floor.0.len() != 5 {
                    ok = false;
                }
                current = lineups.entry(&on_floor);
            }
        }
        lineups.list[current].seconds += clock;
        previous_end = on_floor.0;
    }

    stints.leave_unless_on(
        &Floor::default(),
        moment(game.periods, 0.0, last_home, last_away),
    );

    let mut replayed: HashMap<u32, i32> = HashMap::new();
    for l in &lineups.list {
        for &id in &l.players {
            *replayed.entry(id).or_default() += l.pts_for - l.pts_against;
        }
    }
    for p in &game.players {
        if (replayed.get(&p.player_id).copied().unwrap_or(0) - p.plus_minus).abs()
            > REPLAY_TOLERANCE
        {
            ok = false;
        }
    }
    Replay {
        ok,
        lineups: lineups.list,
        stints: stints.done,
    }
}

fn period_starters(plays: &[&PlayRow], roster: &HashSet<u32>, previous_end: &[u32]) -> Vec<u32> {
    let mut starters = Vec::new();
    let mut seen = HashSet::new();
    for play in plays {
        if starters.len() == 5 {
            break;
        }
        if play.type_text == "Substitution" {
            let (Some(entering), Some(leaving)) =
                (player(play.players[0]), player(play.players[1]))
            else {
                continue;
            };
            if !roster.contains(&entering) {
                continue;
            }
            if !seen.contains(&leaving) {
                starters.push(leaving);
            }
            seen.insert(leaving);
            seen.insert(entering);
        } else if !off_floor_play(&play.type_text) {
            for id in play.players.iter().filter_map(|&id| player(id)) {
                if roster.contains(&id) && seen.insert(id) {
                    starters.push(id);
                }
            }
        }
    }
    for &id in previous_end {
        if starters.len() >= 5 {
            break;
        }
        if seen.insert(id) {
            starters.push(id);
        }
    }
    starters.truncate(5);
    starters
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::report::load::{BoxScore, Opponent, PlayerGame};

    const IDS: [u32; 6] = [1, 2, 3, 4, 5, 6];

    fn player_line(id: u32, plus_minus: i32) -> PlayerGame {
        PlayerGame {
            player_id: id,
            full_name: format!("Player {id}"),
            position: None,
            starter: id <= 5,
            minutes: 0,
            pts: 0,
            fgm: 0,
            fga: 0,
            ftm: 0,
            fta: 0,
            oreb: 0,
            dreb: 0,
            reb: 0,
            ast: 0,
            stl: 0,
            blk: 0,
            tov: 0,
            pf: 0,
            plus_minus,
        }
    }

    fn play(period: i32, clock: f64, kind: &str, home: i32, away: i32, a: u32, b: u32) -> PlayRow {
        PlayRow {
            period,
            clock_seconds: clock,
            type_text: kind.to_string(),
            home_score: home,
            away_score: away,
            players: [Some(a), Some(b), None],
            score_value: 0,
        }
    }

    /// A road game of `periods` periods; player 6 is the only substitute.
    fn road_game(periods: i32, plays: Vec<PlayRow>, plus_minus: [i32; 6]) -> Game {
        let empty = BoxScore {
            fgm: 0,
            fga: 0,
            fg3m: 0,
            fta: 0,
            oreb: 0,
            dreb: 0,
            tov: 0,
            paint_pts: 0,
            fast_break_pts: 0,
            pts_off_tov: 0,
        };
        Game {
            id: "1".into(),
            season_year: 2027,
            season_type: 2,
            starts_at: jiff::Timestamp::UNIX_EPOCH,
            home: false,
            neutral: false,
            opponent: Opponent {
                id: 2,
                abbreviation: "OPP".into(),
                name: "Opponent".into(),
            },
            venue: None,
            attendance: None,
            note: None,
            periods,
            pts: 0,
            opp_pts: 0,
            us: empty,
            them: empty,
            us_by_period: vec![],
            them_by_period: vec![],
            players: IDS
                .iter()
                .zip(plus_minus)
                .map(|(&id, pm)| player_line(id, pm))
                .collect(),
            opponent_players: vec![],
            plays,
        }
    }

    fn at(period: i32, clock_seconds: f64, us: i32, them: i32) -> GameMoment {
        GameMoment {
            period,
            clock_seconds,
            us,
            them,
        }
    }

    #[test]
    fn stints_follow_substitutions_from_the_report_teams_side() {
        let game = road_game(
            1,
            vec![
                // The home team is the opponent here, so home_score is "them".
                play(1, 600.0, "Jump Shot", 4, 10, 2, 0),
                play(1, 300.0, "Substitution", 4, 10, 6, 1),
                play(1, 100.0, "Jump Shot", 9, 10, 3, 0),
            ],
            [6, 1, 1, 1, 1, -5],
        );
        let replay = replay_game(&game);
        assert!(replay.ok);
        assert_eq!(
            replay.stints[&1],
            vec![Stint {
                from: at(1, 720.0, 0, 0),
                to: at(1, 300.0, 10, 4),
            }]
        );
        assert_eq!(
            replay.stints[&6],
            vec![Stint {
                from: at(1, 300.0, 10, 4),
                to: at(1, 0.0, 10, 9),
            }]
        );
    }

    #[test]
    fn a_stint_runs_across_a_period_break_when_the_player_stays_on() {
        let game = road_game(
            2,
            vec![
                play(1, 300.0, "Jump Shot", 0, 2, 1, 0),
                play(2, 700.0, "Jump Shot", 0, 2, 1, 0),
                play(2, 650.0, "Jump Shot", 0, 2, 2, 0),
                play(2, 600.0, "Jump Shot", 0, 2, 3, 0),
                play(2, 550.0, "Jump Shot", 0, 2, 4, 0),
                play(2, 500.0, "Jump Shot", 0, 2, 5, 0),
            ],
            [2, 2, 2, 2, 2, 0],
        );
        let replay = replay_game(&game);
        assert_eq!(
            replay.stints[&1],
            vec![Stint {
                from: at(1, 720.0, 0, 0),
                to: at(2, 0.0, 2, 0),
            }]
        );
    }

    #[test]
    fn a_player_in_and_out_at_the_same_stoppage_has_no_stint() {
        let game = road_game(
            1,
            vec![
                play(1, 300.0, "Substitution", 0, 0, 6, 1),
                play(1, 300.0, "Substitution", 0, 0, 1, 6),
            ],
            [0, 0, 0, 0, 0, 0],
        );
        assert!(!replay_game(&game).stints.contains_key(&6));
    }
}
