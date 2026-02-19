use axum::extract::ws::{Message, WebSocket};
use futures::{SinkExt, StreamExt};
use redis::AsyncCommands;
use tokio::sync::mpsc;

use crate::api::AppState;

pub async fn handle_socket(socket: WebSocket, state: AppState) {
    let (mut ws_sender, mut ws_receiver) = socket.split();

    // Channel for sending messages to the client (from both broadcast and catch-up)
    let (tx, mut rx) = mpsc::channel::<String>(256);

    // Subscribe to broadcast channel
    let mut broadcast_rx = state.broadcast_tx.subscribe();

    // Task: forward broadcast events to the mpsc channel
    let broadcast_tx = tx.clone();
    let broadcast_task = tokio::spawn(async move {
        while let Ok(msg) = broadcast_rx.recv().await {
            if broadcast_tx.send(msg).await.is_err() {
                break;
            }
        }
    });

    // Task: send messages from mpsc channel to WebSocket
    let send_task = tokio::spawn(async move {
        while let Some(msg) = rx.recv().await {
            if ws_sender.send(Message::Text(msg.into())).await.is_err() {
                break;
            }
        }
    });

    // Handle incoming messages from client
    let valkey = state.valkey.clone();
    let recv_task = tokio::spawn(async move {
        while let Some(Ok(msg)) = ws_receiver.next().await {
            if let Message::Text(text) = msg {
                handle_client_message(&text, &valkey, &tx).await;
            }
        }
    });

    // Wait for any task to finish
    tokio::select! {
        _ = broadcast_task => {},
        _ = send_task => {},
        _ = recv_task => {},
    }
}

async fn handle_client_message(
    text: &str,
    valkey: &redis::aio::MultiplexedConnection,
    sender: &mpsc::Sender<String>,
) {
    let msg: serde_json::Value = match serde_json::from_str(text) {
        Ok(v) => v,
        Err(_) => return,
    };

    if msg.get("type").and_then(|t| t.as_str()) == Some("catch_up") {
        if let Some(since) = msg.get("since_timestamp").and_then(|t| t.as_f64()) {
            let since_ts = since as u64;
            let events: Vec<String> = valkey
                .clone()
                .zrangebyscore(common::valkey::DRAW_EVENTS_ZSET, since_ts, "+inf")
                .await
                .unwrap_or_default();

            tracing::info!(
                "WebSocket catch-up: {} events since {}",
                events.len(),
                since_ts
            );

            for event_json in events {
                if sender.send(event_json).await.is_err() {
                    break;
                }
            }
        }
    }
}
