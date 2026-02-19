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

async fn ws_upgrade(
    ws: WebSocketUpgrade,
    State(state): State<AppState>,
) -> impl IntoResponse {
    ws.on_upgrade(move |socket| ws::handle_socket(socket, state))
}
