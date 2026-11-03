mod api;
mod config;
mod db;
mod espn;
mod report;
mod server;
mod sync;

use anyhow::{Result, bail};

const USAGE: &str = "usage: knicks serve | migrate | sync";

#[tokio::main]
async fn main() -> Result<()> {
    let config = config::Config::load()?;
    match std::env::args().nth(1).as_deref() {
        Some("serve") => server::serve(&config, db::pool(&config.database_url).await?).await?,
        Some("migrate") => {
            db::migrate(&config.database_url).await?;
            println!("Schema is up to date.");
        }
        Some("sync") => {
            let pool = db::pool(&config.database_url).await?;
            let result =
                sync::sync_games(&pool, &espn::Espn::new()?, |line| println!("{line}")).await;
            pool.close().await;
            let result = result?;
            println!(
                "Done. {} new games, {} completed games in total.",
                result.added, result.completed
            );
        }
        _ => bail!(USAGE),
    }
    Ok(())
}
