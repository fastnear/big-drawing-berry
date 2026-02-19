use common::valkey;
use common::DrawEvent;
use redis::AsyncCommands;
use std::sync::Arc;
use tokio::sync::{broadcast, RwLock};

use crate::board::Board;

/// Two hours in milliseconds (for trimming the WS catch-up sorted set).
const CATCHUP_RETENTION_MS: u64 = 7_200_000;

/// Consume draw events from the Valkey queue and apply them to the board.
pub async fn run(
    mut con: redis::aio::MultiplexedConnection,
    board: Arc<RwLock<Board>>,
    broadcast_tx: broadcast::Sender<String>,
) {
    tracing::info!("Consumer started");

    loop {
        // RPOPLPUSH: atomically move from draw_queue to processing_queue
        let event_json: Option<String> = match redis::cmd("RPOPLPUSH")
            .arg(valkey::DRAW_QUEUE)
            .arg(valkey::PROCESSING_QUEUE)
            .query_async(&mut con)
            .await
        {
            Ok(v) => v,
            Err(e) => {
                tracing::error!("RPOPLPUSH failed: {}", e);
                tokio::time::sleep(tokio::time::Duration::from_millis(100)).await;
                continue;
            }
        };

        let event_json = match event_json {
            Some(json) => json,
            None => {
                // Queue is empty, wait a bit
                tokio::time::sleep(tokio::time::Duration::from_millis(50)).await;
                continue;
            }
        };

        // Parse and apply
        let event: DrawEvent = match serde_json::from_str(&event_json) {
            Ok(e) => e,
            Err(e) => {
                tracing::error!("Failed to parse draw event: {}", e);
                // Remove from processing queue even if parse fails
                let _: () = con
                    .lrem(valkey::PROCESSING_QUEUE, 1, &event_json)
                    .await
                    .unwrap_or_default();
                continue;
            }
        };

        // Apply to board
        let (applied, newly_opened) = {
            let mut board = board.write().await;
            board.apply_event(&event).await
        };

        // Store in sorted set for WebSocket catch-up (trimmed to 2 hours)
        if !applied.is_empty() {
            let ws_event = serde_json::json!({
                "type": "draw",
                "signer": event.predecessor_id,
                "block_timestamp_ms": event.block_timestamp_ms,
                "pixels": applied.iter().map(|p| {
                    serde_json::json!({
                        "x": p.x,
                        "y": p.y,
                        "color": format!("{:02X}{:02X}{:02X}", p.r, p.g, p.b)
                    })
                }).collect::<Vec<_>>()
            });

            let ws_json = ws_event.to_string();

            // ZADD + trim + LREM in a single pipeline
            let two_hours_ago = event.block_timestamp_ms.saturating_sub(CATCHUP_RETENTION_MS);
            let _: () = redis::pipe()
                .zadd(valkey::DRAW_EVENTS_ZSET, &ws_json, event.block_timestamp_ms as f64).ignore()
                .zrembyscore(valkey::DRAW_EVENTS_ZSET, 0u64, two_hours_ago).ignore()
                .lrem(valkey::PROCESSING_QUEUE, 1, &event_json).ignore()
                .query_async(&mut con)
                .await
                .unwrap_or_default();

            // Broadcast to WebSocket subscribers
            let _ = broadcast_tx.send(ws_json);

            // Broadcast newly opened regions
            if !newly_opened.is_empty() {
                let regions_event = serde_json::json!({
                    "type": "regions_opened",
                    "regions": newly_opened.iter().map(|(rx, ry)| {
                        serde_json::json!({ "rx": rx, "ry": ry })
                    }).collect::<Vec<_>>()
                });
                let _ = broadcast_tx.send(regions_event.to_string());
            }
        } else {
            // Remove from processing queue after successful processing
            let _: () = con
                .lrem(valkey::PROCESSING_QUEUE, 1, &event_json)
                .await
                .unwrap_or_default();
        }
    }
}
