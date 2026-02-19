use common::valkey;
use common::DrawEvent;
use redis::AsyncCommands;
use std::sync::Arc;
use tokio::sync::{broadcast, RwLock};

use crate::board::Board;

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
        let applied = {
            let mut board = board.write().await;
            board.apply_event(&event).await
        };

        // Store in sorted set for WebSocket catch-up (trimmed to 2 hours)
        if !applied.is_empty() {
            let ws_event = serde_json::json!({
                "type": "draw",
                "signer": event.predecessor_id,
                "block_timestamp": event.block_timestamp_ms,
                "pixels": applied.iter().map(|p| {
                    serde_json::json!({
                        "x": p.x,
                        "y": p.y,
                        "color": format!("{:02X}{:02X}{:02X}", p.r, p.g, p.b)
                    })
                }).collect::<Vec<_>>()
            });

            let ws_json = ws_event.to_string();

            // Add to sorted set keyed by timestamp
            let _: () = con
                .zadd(valkey::DRAW_EVENTS_ZSET, &ws_json, event.block_timestamp_ms as f64)
                .await
                .unwrap_or_default();

            // Trim events older than 2 hours
            let two_hours_ago = event.block_timestamp_ms.saturating_sub(7_200_000_000_000);
            let _: () = con
                .zrembyscore(valkey::DRAW_EVENTS_ZSET, 0u64, two_hours_ago)
                .await
                .unwrap_or_default();

            // Broadcast to WebSocket subscribers
            let _ = broadcast_tx.send(ws_json);
        }

        // Remove from processing queue after successful processing
        let _: () = con
            .lrem(valkey::PROCESSING_QUEUE, 1, &event_json)
            .await
            .unwrap_or_default();
    }
}
