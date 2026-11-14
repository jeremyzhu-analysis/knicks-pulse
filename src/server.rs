use std::collections::HashMap;
use std::sync::Arc;
use std::time::Duration;

use anyhow::{Context, Result};
use axum::Router;
use axum::body::Bytes;
use axum::extract::State;
use axum::http::header::{CACHE_CONTROL, CONTENT_TYPE};
use axum::http::{HeaderMap, HeaderValue, Response, StatusCode, Uri};
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
    /// The API's documents by path, ready to send. They only change when a
    /// sync stores games, so they're built once and kept until then. The lock
    /// also makes concurrent first requests wait for one build instead of
    /// starting their own.
    built: Mutex<Option<Arc<HashMap<String, Bytes>>>>,
    espn: Espn,
    /// Held for the length of a sync, so two never run at once.
    syncing: Mutex<()>,
}

impl AppState {
    async fn built(&self) -> Result<Arc<HashMap<String, Bytes>>> {
        let mut cached = self.built.lock().await;
        if let Some(built) = cached.as_ref() {
            return Ok(built.clone());
        }
        let data = load_dataset(&self.pool, TEAM_ID).await?;
        let built: Arc<HashMap<String, Bytes>> = Arc::new(
            api::documents(&data)?
                .into_iter()
                .map(|(path, json)| (path, Bytes::from(json)))
                .collect(),
        );
        *cached = Some(built.clone());
        Ok(built)
    }
}

impl AppState {
    /// The caller holds `syncing`.
    async fn sync(&self) -> Result<sync::SyncResult> {
        let result =
            sync::sync_games(&self.pool, &self.espn, |line| println!("[sync] {line}")).await?;
        if result.added + result.updated > 0 {
            *self.built.lock().await = None;
        }
        Ok(result)
    }
}

fn json_response(json: Bytes) -> axum::response::Response {
    (
        [
            (CONTENT_TYPE, "application/json"),
            (CACHE_CONTROL, "no-cache"),
        ],
        json,
    )
        .into_response()
}

fn serialized(value: &impl serde::Serialize) -> axum::response::Response {
    match serde_json::to_vec(value) {
        Ok(json) => json_response(Bytes::from(json)),
        Err(error) => server_error(error.into()),
    }
}

fn server_error(error: anyhow::Error) -> axum::response::Response {
    eprintln!("{error:#}");
    (StatusCode::INTERNAL_SERVER_ERROR, "Something went wrong.").into_response()
}

/// One of the built documents, by the request's path.
async fn document(State(state): State<Arc<AppState>>, uri: Uri) -> axum::response::Response {
    match state.built().await {
        Ok(built) => match built.get(uri.path()) {
            Some(json) => json_response(json.clone()),
            None => (StatusCode::NOT_FOUND, "Not found").into_response(),
        },
        Err(error) => server_error(error),
    }
}

async fn sync_status(State(state): State<Arc<AppState>>) -> axum::response::Response {
    match sync::checked_at(&state.pool).await {
        Ok(checked_at) => serialized(&api::SyncStatus { checked_at }),
        Err(error) => server_error(error),
    }
}

/// Starts a sync unless one is running. Browsers say where a request comes
/// from; one sent by another site's page is refused.
async fn sync_now(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
) -> axum::response::Response {
    if headers
        .get("sec-fetch-site")
        .is_some_and(|site| site != "same-origin")
    {
        return (StatusCode::FORBIDDEN, "Forbidden").into_response();
    }
    let outcome = async {
        let result = match state.syncing.try_lock() {
            Ok(_running) => Some(state.sync().await?),
            Err(_) => None,
        };
        anyhow::Ok(api::SyncOutcome {
            busy: result.is_none(),
            added: result.as_ref().map_or(0, |r| r.added as i32),
            updated: result.as_ref().map_or(0, |r| r.updated as i32),
            checked_at: sync::checked_at(&state.pool).await?,
        })
    };
    match outcome.await {
        Ok(outcome) => serialized(&outcome),
        Err(error) => server_error(error),
    }
}

/// Only successful responses get a cache header; errors stay uncached.
fn cache_on_success<B>(
    value: &'static str,
) -> impl Fn(&Response<B>) -> Option<HeaderValue> + Clone {
    move |res| {
        res.status()
            .is_success()
            .then(|| HeaderValue::from_static(value))
    }
}

fn app(state: Arc<AppState>) -> Router {
    let not_found = || async { (StatusCode::NOT_FOUND, "Not found") };
    // Vite puts a content hash in every file name under assets/.
    let assets = ServeDir::new(format!("{DIST}/assets")).not_found_service(get(not_found));
    let pages = ServeDir::new(DIST).not_found_service(get(not_found));
    Router::new()
        .route("/api/report", get(document))
        .route("/api/shots", get(document))
        .route("/api/games/{id}", get(document))
        .route("/api/players/{id}", get(document))
        .route("/api/sync", get(sync_status).post(sync_now))
        .with_state(state)
        .nest_service(
            "/assets",
            SetResponseHeader::overriding(
                assets,
                CACHE_CONTROL,
                cache_on_success("public, max-age=31536000, immutable"),
            ),
        )
        .fallback_service(SetResponseHeader::overriding(
            pages,
            CACHE_CONTROL,
            cache_on_success("no-cache"),
        ))
}

/// Syncs once at startup, then every `minutes` (0 = only once). A tick missed
/// during a long sync is skipped.
async fn sync_loop(state: Arc<AppState>, minutes: u64) {
    let mut ticks = (minutes > 0).then(|| {
        let mut interval = tokio::time::interval(Duration::from_secs(minutes * 60));
        interval.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
        interval
    });
    loop {
        if let Some(ticks) = ticks.as_mut() {
            ticks.tick().await;
        }
        let _running = state.syncing.lock().await;
        if let Err(error) = state.sync().await {
            eprintln!("[sync] failed: {error:#}");
        }
        drop(_running);
        if ticks.is_none() {
            return;
        }
    }
}

async fn shutdown_signal() {
    let interrupt = tokio::signal::ctrl_c();
    let mut terminate =
        match tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate()) {
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
    let state = Arc::new(AppState {
        pool,
        built: Mutex::new(None),
        espn: Espn::new()?,
        syncing: Mutex::new(()),
    });
    let listener = tokio::net::TcpListener::bind((config.host.as_str(), config.port))
        .await
        .with_context(|| format!("listening on {}:{}", config.host, config.port))?;
    println!("Listening on http://{}:{}", config.host, config.port);

    let syncing = tokio::spawn(sync_loop(state.clone(), config.sync_interval_minutes));
    axum::serve(listener, app(state.clone()))
        .with_graceful_shutdown(shutdown_signal())
        .await?;
    // A sync cut off here rolls back its open transaction.
    syncing.abort();
    let _ = syncing.await;
    state.pool.close().await;
    Ok(())
}
