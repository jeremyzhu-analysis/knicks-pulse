use anyhow::{Context, Result};
use jiff::Timestamp;
use jiff::tz::TimeZone;

pub fn new_york() -> Result<TimeZone> {
    TimeZone::get("America/New_York").context("loading the America/New_York time zone")
}

/// Calendar day in New York as days since 1970-01-01, for counting days of rest.
pub fn day_number(ts: Timestamp, new_york: &TimeZone) -> Result<i64> {
    let date = ts.to_zoned(new_york.clone()).date();
    Ok(date.to_zoned(TimeZone::UTC)?.timestamp().as_second().div_euclid(86_400))
}

/// 2027 + type 3 -> "2026–27 playoffs"
pub fn season_label(season_year: i32, season_type: i32) -> String {
    let year = season_year.to_string();
    let short = year.get(2..).unwrap_or("");
    let kind = if season_type == 3 { "playoffs" } else { "regular season" };
    format!("{}–{short} {kind}", season_year - 1)
}

const SUFFIXES: [&str; 8] = ["jr", "jr.", "sr", "sr.", "ii", "iii", "iv", "v"];

/// "Kevin Porter Jr." -> "Porter"
pub fn last_name(full_name: &str) -> String {
    let mut words: Vec<&str> = full_name.split_whitespace().collect();
    while words.len() > 1 && SUFFIXES.contains(&words[words.len() - 1].to_lowercase().as_str()) {
        words.pop();
    }
    words.last().map_or_else(|| full_name.to_string(), |w| w.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn labels_seasons() {
        assert_eq!(season_label(2027, 2), "2026–27 regular season");
        assert_eq!(season_label(2026, 3), "2025–26 playoffs");
    }

    #[test]
    fn finds_last_names() {
        assert_eq!(last_name("Kevin Porter Jr."), "Porter");
        assert_eq!(last_name("Jalen Brunson"), "Brunson");
        assert_eq!(last_name("Gary Payton II"), "Payton");
        assert_eq!(last_name("Nene"), "Nene");
        assert_eq!(last_name("V"), "V");
        assert_eq!(last_name(""), "");
    }

    #[test]
    fn counts_new_york_days() {
        let tz = new_york().unwrap();
        // 00:30 UTC on Nov 3 is the evening of Nov 2 in New York.
        let late = day_number("2026-11-03T00:30:00Z".parse().unwrap(), &tz).unwrap();
        let early = day_number("2026-11-02T17:00:00Z".parse().unwrap(), &tz).unwrap();
        assert_eq!(late, early);
        assert_eq!(early, 20_759);
    }
}
