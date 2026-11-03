use std::collections::HashMap;
use std::env;
use std::fs;
use std::str::FromStr;

use anyhow::{Context, Result, anyhow};

/// ESPN's team slug and id for the New York Knicks.
pub const TEAM_SLUG: &str = "ny";
pub const TEAM_ID: u32 = 18;

pub struct Config {
    pub database_url: String,
    /// 127.0.0.1 keeps the server off the network; `tailscale serve` forwards to it.
    pub host: String,
    pub port: u16,
    pub sync_interval_minutes: u64,
}

impl Config {
    /// Reads the environment, falling back to `.env` in the current directory.
    /// A variable that is already set wins over the file, as with Node's
    /// `process.loadEnvFile`.
    pub fn load() -> Result<Self> {
        let file = match fs::read_to_string(".env") {
            Ok(text) => parse_env_file(&text),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => HashMap::new(),
            Err(error) => return Err(error).context("reading .env"),
        };
        let get = |name: &str| env::var(name).ok().or_else(|| file.get(name).cloned()).filter(|v| !v.is_empty());

        Ok(Self {
            database_url: get("DATABASE_URL")
                .ok_or_else(|| anyhow!("Missing environment variable DATABASE_URL. See .env.example."))?,
            host: get("HOST").unwrap_or_else(|| "127.0.0.1".into()),
            port: parse_or("PORT", get("PORT"), 3000)?,
            sync_interval_minutes: parse_or("SYNC_INTERVAL_MINUTES", get("SYNC_INTERVAL_MINUTES"), 60)?,
        })
    }
}

fn parse_or<T: FromStr>(name: &str, value: Option<String>, default: T) -> Result<T> {
    match value {
        None => Ok(default),
        Some(text) => text.trim().parse().map_err(|_| anyhow!("{name} must be a whole number, got {text:?}")),
    }
}

/// `KEY=value` lines; blank lines and `#` comments are skipped, an optional
/// `export ` prefix and matching quotes around the value are removed.
fn parse_env_file(text: &str) -> HashMap<String, String> {
    text.lines()
        .map(str::trim)
        .filter(|line| !line.is_empty() && !line.starts_with('#'))
        .filter_map(|line| {
            let line = line.strip_prefix("export ").unwrap_or(line);
            let (key, value) = line.split_once('=')?;
            let value = value.trim();
            let unquoted = ['"', '\'']
                .iter()
                .find_map(|q| value.strip_prefix(*q).and_then(|v| v.strip_suffix(*q)))
                .unwrap_or(value);
            Some((key.trim().to_string(), unquoted.to_string()))
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::parse_env_file;

    #[test]
    fn parses_env_lines() {
        let vars = parse_env_file("# note\n\nDATABASE_URL=mysql://a:b@h:1/db\nexport HOST = \"0.0.0.0\"\nEMPTY=\nPORT='4000'\n");
        assert_eq!(vars["DATABASE_URL"], "mysql://a:b@h:1/db");
        assert_eq!(vars["HOST"], "0.0.0.0");
        assert_eq!(vars["EMPTY"], "");
        assert_eq!(vars["PORT"], "4000");
        assert_eq!(vars.len(), 4);
    }
}
