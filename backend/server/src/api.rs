use axum::extract::{Path, Query, State, WebSocketUpgrade};
use axum::http::header;
use axum::response::IntoResponse;
use axum::routing::get;
use axum::Router;
use redis::AsyncCommands;
use serde::Deserialize;
use std::sync::Arc;
use tokio::sync::{broadcast, RwLock};

use crate::board::Board;
use crate::ws;

#[derive(Clone)]
pub struct AppState {
    pub board: Arc<RwLock<Board>>,
    pub valkey: redis::aio::MultiplexedConnection,
    pub broadcast_tx: broadcast::Sender<String>,
}

pub fn router(state: AppState) -> Router {
    Router::new()
        .route("/api/region/{rx}/{ry}", get(get_region))
        .route("/api/region/{rx}/{ry}/meta", get(get_region_meta))
        .route("/api/regions", get(get_regions_batch))
        .route("/api/stats/accounts", get(get_account_stats))
        .route("/api/stats/region/{rx}/{ry}", get(get_region_stats))
        .route("/api/region/{rx}/{ry}/timestamps", get(get_region_timestamps))
        .route("/api/account/{owner_id}", get(get_account_by_id))
        .route("/api/open-regions", get(get_open_regions))
        .route("/api/health", get(health))
        .route("/ws", get(ws_upgrade))
        .with_state(state)
}

async fn get_region(
    State(state): State<AppState>,
    Path((rx, ry)): Path<(i32, i32)>,
) -> impl IntoResponse {
    let blob = {
        let mut board = state.board.write().await;
        board.get_region(rx, ry).await
    };

    // Get last_updated from metadata
    let last_updated: Option<u64> = state
        .valkey
        .clone()
        .hget(common::valkey::region_meta_key(rx, ry), "last_updated")
        .await
        .unwrap_or(None);

    let last_updated_str = last_updated.map(|t| t.to_string()).unwrap_or_default();

    (
        [
            (header::CONTENT_TYPE, "application/octet-stream".to_string()),
            (
                header::HeaderName::from_static("x-last-updated"),
                last_updated_str,
            ),
            (
                header::CACHE_CONTROL,
                "no-cache, must-revalidate".to_string(),
            ),
        ],
        blob,
    )
}

async fn get_region_meta(
    State(state): State<AppState>,
    Path((rx, ry)): Path<(i32, i32)>,
) -> impl IntoResponse {
    let last_updated: Option<u64> = state
        .valkey
        .clone()
        .hget(common::valkey::region_meta_key(rx, ry), "last_updated")
        .await
        .unwrap_or(None);

    axum::Json(serde_json::json!({
        "rx": rx,
        "ry": ry,
        "last_updated": last_updated.unwrap_or(0)
    }))
}

#[derive(Deserialize)]
struct BatchQuery {
    coords: String,
}

async fn get_regions_batch(
    State(state): State<AppState>,
    Query(query): Query<BatchQuery>,
) -> impl IntoResponse {
    let coords: Vec<i32> = query
        .coords
        .split(',')
        .filter_map(|s| s.trim().parse().ok())
        .collect();

    let mut results = Vec::new();
    let mut valkey = state.valkey.clone();

    for chunk in coords.chunks(2) {
        if chunk.len() == 2 {
            let (rx, ry) = (chunk[0], chunk[1]);
            let last_updated: Option<u64> = valkey
                .hget(common::valkey::region_meta_key(rx, ry), "last_updated")
                .await
                .unwrap_or(None);

            results.push(serde_json::json!({
                "rx": rx,
                "ry": ry,
                "last_updated": last_updated.unwrap_or(0)
            }));
        }
    }

    axum::Json(results)
}

async fn health(State(state): State<AppState>) -> impl IntoResponse {
    let last_block: Option<u64> = state
        .valkey
        .clone()
        .get(common::valkey::LAST_PROCESSED_BLOCK)
        .await
        .unwrap_or(None);

    let queue_len: Option<u64> = state
        .valkey
        .clone()
        .llen(common::valkey::DRAW_QUEUE)
        .await
        .unwrap_or(None);

    axum::Json(serde_json::json!({
        "status": "ok",
        "last_processed_block": last_block,
        "queue_length": queue_len.unwrap_or(0)
    }))
}

async fn get_account_stats(State(state): State<AppState>) -> impl IntoResponse {
    let mut valkey = state.valkey.clone();

    // Get all owner_id → pixel_count pairs
    let counts: Vec<(String, i64)> = valkey
        .hgetall(common::valkey::ACCOUNT_PIXEL_COUNT)
        .await
        .unwrap_or_default();

    // Get all id → account_id mappings
    let id_to_account: Vec<(String, String)> = valkey
        .hgetall(common::valkey::ID_TO_ACCOUNT)
        .await
        .unwrap_or_default();

    let account_map: std::collections::HashMap<String, String> =
        id_to_account.into_iter().collect();

    let results: Vec<serde_json::Value> = counts
        .into_iter()
        .filter_map(|(owner_id, count)| {
            let account_id = account_map.get(&owner_id)?;
            Some(serde_json::json!({
                "account_id": account_id,
                "pixel_count": count,
            }))
        })
        .collect();

    axum::Json(results)
}

async fn get_region_stats(
    State(state): State<AppState>,
    Path((rx, ry)): Path<(i32, i32)>,
) -> impl IntoResponse {
    let count: i64 = state
        .valkey
        .clone()
        .hget(common::valkey::REGION_PIXEL_COUNT, format!("{rx}:{ry}"))
        .await
        .unwrap_or(0);

    axum::Json(serde_json::json!({ "count": count }))
}

async fn get_open_regions(State(state): State<AppState>) -> impl IntoResponse {
    let members: Vec<String> = state
        .valkey
        .clone()
        .smembers(common::valkey::OPEN_REGIONS)
        .await
        .unwrap_or_default();

    let regions: Vec<serde_json::Value> = members
        .iter()
        .filter_map(|s| {
            let parts: Vec<&str> = s.split(':').collect();
            if parts.len() == 2 {
                let rx: i32 = parts[0].parse().ok()?;
                let ry: i32 = parts[1].parse().ok()?;
                Some(serde_json::json!({ "rx": rx, "ry": ry }))
            } else {
                None
            }
        })
        .collect();

    axum::Json(regions)
}

async fn get_region_timestamps(
    State(state): State<AppState>,
    Path((rx, ry)): Path<(i32, i32)>,
) -> impl IntoResponse {
    let key = common::valkey::pixel_ts_key(rx, ry);
    let now_ms = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_millis() as f64;
    let one_hour_ago_ms = now_ms - 3_600_000.0;

    // Fetch only fresh entries (< 1 hour old); scores are in milliseconds
    let entries: Vec<(String, f64)> = redis::cmd("ZRANGEBYSCORE")
        .arg(&key)
        .arg(one_hour_ago_ms)
        .arg("+inf")
        .arg("WITHSCORES")
        .query_async(&mut state.valkey.clone())
        .await
        .unwrap_or_default();

    // Convert to [[lx, ly, ts_ms], ...] for compact transfer
    let results: Vec<[u64; 3]> = entries
        .into_iter()
        .filter_map(|(member, score)| {
            let (lx_str, ly_str) = member.split_once(',')?;
            let lx: u64 = lx_str.parse().ok()?;
            let ly: u64 = ly_str.parse().ok()?;
            Some([lx, ly, score as u64])
        })
        .collect();

    axum::Json(results)
}

async fn get_account_by_id(
    State(state): State<AppState>,
    Path(owner_id): Path<u32>,
) -> impl IntoResponse {
    let account: Option<String> = state
        .valkey
        .clone()
        .hget(common::valkey::ID_TO_ACCOUNT, owner_id)
        .await
        .unwrap_or(None);

    match account {
        Some(id) => (
            [
                (header::CACHE_CONTROL, "public, max-age=31536000, immutable"),
            ],
            id,
        )
            .into_response(),
        None => axum::http::StatusCode::NOT_FOUND.into_response(),
    }
}

async fn ws_upgrade(
    ws: WebSocketUpgrade,
    State(state): State<AppState>,
) -> impl IntoResponse {
    ws.on_upgrade(move |socket| ws::handle_socket(socket, state))
}
