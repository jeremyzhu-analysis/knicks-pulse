use std::collections::{HashMap, HashSet};

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
                if on_floor.0.len() != 5 {
                    ok = false;
                }
                current = lineups.entry(&on_floor);
            }
        }
        lineups.list[current].seconds += clock;
        previous_end = on_floor.0;
    }

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
