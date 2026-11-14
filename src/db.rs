use anyhow::{Context, Result, anyhow};
use sqlx::Connection;
use sqlx::mysql::{MySqlConnectOptions, MySqlConnection, MySqlPool, MySqlPoolOptions};

const SCHEMA: &str = include_str!("../db/schema.sql");

/// Columns that databases created from an earlier schema.sql may lack:
/// (table, column, definition). CREATE TABLE IF NOT EXISTS leaves an existing
/// table alone, so `migrate` adds these itself. Each must also be in
/// schema.sql, written as "column definition".
const ADDED_COLUMNS: &[(&str, &str, &str)] = &[
    ("games", "neutral", "BOOLEAN NOT NULL DEFAULT FALSE"),
    ("games", "attendance", "INT UNSIGNED NULL"),
    (
        "games",
        "store_format",
        "TINYINT UNSIGNED NOT NULL DEFAULT 1",
    ),
    ("plays", "shooting", "BOOLEAN NOT NULL DEFAULT FALSE"),
    (
        "plays",
        "score_value",
        "TINYINT UNSIGNED NOT NULL DEFAULT 0",
    ),
    (
        "plays",
        "points_attempted",
        "TINYINT UNSIGNED NOT NULL DEFAULT 0",
    ),
    ("plays", "x", "SMALLINT NULL"),
    ("plays", "y", "SMALLINT NULL"),
];

/// Sessions run in UTC, so DATETIME values are read and written as UTC.
pub async fn pool(database_url: &str) -> Result<MySqlPool> {
    let options: MySqlConnectOptions = database_url.parse().context("parsing DATABASE_URL")?;
    let options = options.timezone(String::from("+00:00"));
    MySqlPoolOptions::new()
        .max_connections(5)
        .connect_with(options)
        .await
        .context("connecting to MySQL")
}

/// Creates the database named in the URL if needed, then the tables, then any
/// column of ADDED_COLUMNS an existing table lacks.
pub async fn migrate(database_url: &str) -> Result<()> {
    let (server_url, database) = split_database(database_url)?;
    let mut admin = MySqlConnection::connect(&server_url)
        .await
        .context("connecting to MySQL")?;
    let id = escape_id(&database);
    // Identifiers can't be bound as parameters; escape_id quotes the name.
    let create = format!("CREATE DATABASE IF NOT EXISTS {id} CHARACTER SET utf8mb4; USE {id};");
    sqlx::raw_sql(sqlx::AssertSqlSafe(create))
        .execute(&mut admin)
        .await?;
    sqlx::raw_sql(SCHEMA)
        .execute(&mut admin)
        .await
        .context("creating tables")?;
    for (table, column, definition) in ADDED_COLUMNS {
        let present: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM information_schema.columns
             WHERE table_schema = DATABASE() AND table_name = ? AND column_name = ?",
        )
        .bind(table)
        .bind(column)
        .fetch_one(&mut admin)
        .await?;
        if present == 0 {
            let add = format!(
                "ALTER TABLE {} ADD COLUMN {} {definition}",
                escape_id(table),
                escape_id(column)
            );
            sqlx::raw_sql(sqlx::AssertSqlSafe(add))
                .execute(&mut admin)
                .await
                .with_context(|| format!("adding {table}.{column}"))?;
        }
    }
    admin.close().await?;
    Ok(())
}

/// "mysql://u:p@host:3307/knicks?x=1" -> ("mysql://u:p@host:3307/?x=1", "knicks")
fn split_database(url: &str) -> Result<(String, String)> {
    let after_scheme = url
        .find("://")
        .map(|i| i + 3)
        .ok_or_else(|| anyhow!("DATABASE_URL has no scheme"))?;
    let path_start = url[after_scheme..].find('/').map(|i| after_scheme + i);
    let Some(path_start) = path_start else {
        return Err(anyhow!("DATABASE_URL names no database"));
    };
    let path_end = url[path_start..]
        .find('?')
        .map_or(url.len(), |i| path_start + i);
    let database = percent_decode(&url[path_start + 1..path_end])?;
    if database.is_empty() {
        return Err(anyhow!("DATABASE_URL names no database"));
    }
    Ok((
        format!("{}/{}", &url[..path_start], &url[path_end..]),
        database,
    ))
}

fn percent_decode(text: &str) -> Result<String> {
    let bytes = text.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' {
            let hex = text
                .get(i + 1..i + 3)
                .ok_or_else(|| anyhow!("bad escape in database name"))?;
            out.push(u8::from_str_radix(hex, 16).context("bad escape in database name")?);
            i += 3;
        } else {
            out.push(bytes[i]);
            i += 1;
        }
    }
    String::from_utf8(out).context("database name is not UTF-8")
}

/// MySQL identifier quoting: backticks, with any backtick inside doubled.
fn escape_id(name: &str) -> String {
    format!("`{}`", name.replace('`', "``"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn splits_database_from_url() {
        let (server, db) = split_database("mysql://knicks:knicks@127.0.0.1:3307/knicks").unwrap();
        assert_eq!(
            (server.as_str(), db.as_str()),
            ("mysql://knicks:knicks@127.0.0.1:3307/", "knicks")
        );
        let (server, db) = split_database("mysql://u@h/my%20db?ssl-mode=disabled").unwrap();
        assert_eq!(
            (server.as_str(), db.as_str()),
            ("mysql://u@h/?ssl-mode=disabled", "my db")
        );
        assert!(split_database("mysql://u@h").is_err());
        assert!(split_database("mysql://u@h/").is_err());
    }

    #[test]
    fn added_columns_are_in_the_schema() {
        for (table, column, definition) in ADDED_COLUMNS {
            assert!(
                SCHEMA.contains(&format!("  {column} {definition},\n")),
                "{table}.{column} differs from schema.sql"
            );
        }
    }

    #[test]
    fn escapes_identifiers() {
        assert_eq!(escape_id("knicks"), "`knicks`");
        assert_eq!(escape_id("a`b"), "`a``b`");
    }
}
