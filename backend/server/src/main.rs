mod api;
mod board;
mod config;
mod consumer;
mod ws;

use std::sync::Arc;
use tokio::sync::broadcast;
use tower_http::cors::CorsLayer;

async fn shutdown_signal() {
    let ctrl_c = tokio::signal::ctrl_c();
    let mut sigterm = tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate())
        .expect("failed to register SIGTERM handler");
    tokio::select! {
        _ = ctrl_c => tracing::info!("Received SIGINT, shutting down..."),
        _ = sigterm.recv() => tracing::info!("Received SIGTERM, shutting down..."),
    }
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    let _ = dotenvy::dotenv();

    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::from_default_env()
                .add_directive("server=info".parse().unwrap()),
        )
        .init();

    let config = config::Config::from_env();
    tracing::info!("Starting server on {}", config.listen_addr);

    let valkey_client = redis::Client::open(config.valkey_url.as_str())?;
    let valkey_con = valkey_client.get_multiplexed_async_connection().await?;

    let (broadcast_tx, _) = broadcast::channel::<String>(4096);

    let board = Arc::new(tokio::sync::RwLock::new(
        board::Board::new(valkey_con.clone()),
    ));

    let state = api::AppState {
        board: board.clone(),
        valkey: valkey_con.clone(),
        broadcast_tx: broadcast_tx.clone(),
    };

    // Start consumer task
    let consumer_board = board.clone();
    let consumer_valkey = valkey_con.clone();
    let consumer_broadcast = broadcast_tx.clone();
    tokio::spawn(async move {
        consumer::run(consumer_valkey, consumer_board, consumer_broadcast).await;
    });

    let app = api::router(state)
        .layer(CorsLayer::permissive());

    let listener = tokio::net::TcpListener::bind(&config.listen_addr).await?;
    tracing::info!("Server listening on {}", config.listen_addr);
    axum::serve(listener, app)
        .with_graceful_shutdown(shutdown_signal())
        .await?;

    tracing::info!("Server stopped.");
    Ok(())
}
