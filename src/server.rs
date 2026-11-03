use std::sync::Arc;
use std::time::Duration;

use anyhow::{Context, Result};
use axum::Router;
use axum::body::Bytes;
use axum::extract::State;
use axum::http::header::{CACHE_CONTROL, CONTENT_TYPE};
use axum::http::{HeaderValue, Response, StatusCode};
use axum::response::IntoResponse;
use axum::routing::get;
use sqlx::mysql::MySqlPool;
use tokio::sync::Mutex;
use tower_http::services::ServeDir;
use tower_http::set_header::SetResponseHeader;

use crate::config::{Config, TEAM_ID};
use crate::espn::Espn;
use crate::report::load::load_dataset;
use crate::{api, sync};

/// Built by `npm run build`; paths are relative to the repo root.
const DIST: &str = "web/dist";

struct AppState {
    pool: MySqlPool,
    /// The report only changes when a sync stores new games, so its JSON is
    /// built once and kept until then. The lock also makes concurrent first
    /// requests wait for one build instead of starting their own.
    report: Mutex<Option<Bytes>>,
}

impl AppState {
    async fn report_json(&self) -> Result<Bytes> {
        let mut cached = self.report.lock().await;
        if let Some(json) = cached.as_ref() {
            return Ok(json.clone());
        }
        let data = load_dataset(&self.pool, TEAM_ID).await?;
        let json = Bytes::from(serde_json::to_vec(&api::report(&data)?)?);
        *cached = Some(json.clone());
        Ok(json)
    }
}

async fn report(State(state): State<Arc<AppState>>) -> impl IntoResponse {
    match state.report_json().await {
        Ok(json) => {
            ([(CONTENT_TYPE, "application/json"), (CACHE_CONTROL, "no-cache")], json).into_response()
        }
        Err(error) => {
            eprintln!("{error:#}");
            (StatusCode::INTERNAL_SERVER_ERROR, "Something went wrong.").into_response()
        }
    }
}

/// Only successful responses get a cache header; errors stay uncached.
fn cache_on_success<B>(value: &'static str) -> impl Fn(&Response<B>) -> Option<HeaderValue> + Clone {
    move |res| res.status().is_success().then(|| HeaderValue::from_static(value))
}

fn app(state: Arc<AppState>) -> Router {
    let not_found = || async { (StatusCode::NOT_FOUND, "Not found") };
    // Vite puts a content hash in every file name under assets/.
    let assets = ServeDir::new(format!("{DIST}/assets")).not_found_service(get(not_found));
    let pages = ServeDir::new(DIST).not_found_service(get(not_found));
    Router::new()
        .route("/api/report", get(report))
        .with_state(state)
        .nest_service(
            "/assets",
            SetResponseHeader::overriding(assets, CACHE_CONTROL, cache_on_success("public, max-age=31536000, immutable")),
        )
        .fallback_service(SetResponseHeader::overriding(pages, CACHE_CONTROL, cache_on_success("no-cache")))
}

/// Syncs once at startup, then every `minutes` (0 = only once). Runs inline,
/// so two syncs never overlap; a tick missed during a long sync is skipped.
async fn sync_loop(state: Arc<AppState>, minutes: u64) {
    let espn = match Espn::new() {
        Ok(espn) => espn,
        Err(error) => return eprintln!("[sync] failed: {error:#}"),
    };
    let mut ticks = (minutes > 0).then(|| {
        let mut interval = tokio::time::interval(Duration::from_secs(minutes * 60));
        interval.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
        interval
    });
    loop {
        if let Some(ticks) = ticks.as_mut() {
            ticks.tick().await;
        }
        match sync::sync_games(&state.pool, &espn, |line| println!("[sync] {line}")).await {
            Ok(result) if result.added > 0 => *state.report.lock().await = None,
            Ok(_) => {}
            Err(error) => eprintln!("[sync] failed: {error:#}"),
        }
        if ticks.is_none() {
            return;
        }
    }
}

async fn shutdown_signal() {
    let interrupt = tokio::signal::ctrl_c();
    let mut terminate = match tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate()) {
        Ok(signal) => signal,
        Err(error) => {
            eprintln!("can't listen for SIGTERM: {error}");
            let _ = interrupt.await;
            return;
        }
    };
    tokio::select! {
        _ = interrupt => {}
        _ = terminate.recv() => {}
    }
}

pub async fn serve(config: &Config, pool: MySqlPool) -> Result<()> {
    let state = Arc::new(AppState { pool, report: Mutex::new(None) });
    let listener = tokio::net::TcpListener::bind((config.host.as_str(), config.port))
        .await
        .with_context(|| format!("listening on {}:{}", config.host, config.port))?;
    println!("Listening on http://{}:{}", config.host, config.port);

    let syncing = tokio::spawn(sync_loop(state.clone(), config.sync_interval_minutes));
    axum::serve(listener, app(state.clone())).with_graceful_shutdown(shutdown_signal()).await?;
    // A sync cut off here rolls back its open transaction.
    syncing.abort();
    let _ = syncing.await;
    state.pool.close().await;
    Ok(())
}
