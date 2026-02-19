mod processor;

use fastnear_neardata_fetcher::{FetcherConfigBuilder, start_fetcher};
use redis::AsyncCommands;
use std::sync::atomic::AtomicBool;
use std::sync::Arc;
use tokio::sync::mpsc;

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    let _ = dotenvy::dotenv();

    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::from_default_env()
                .add_directive("indexer=info".parse().unwrap())
                .add_directive("neardata-fetcher=info".parse().unwrap()),
        )
        .init();

    let contract_account = std::env::var("CONTRACT_ID").unwrap_or_else(|_| "berryfast.near".into());
    let valkey_url = std::env::var("VALKEY_URL").unwrap_or_else(|_| "redis://127.0.0.1:6379".into());
    let client = redis::Client::open(valkey_url)?;
    let mut con = client.get_multiplexed_async_connection().await?;

    // Read last processed block height
    let start_block: Option<u64> = con.get(common::valkey::LAST_PROCESSED_BLOCK).await?;
    let start_block = start_block.map(|h| h + 1);

    tracing::info!(
        "Starting indexer from block {:?} for contract {}",
        start_block,
        &contract_account
    );

    let is_running = Arc::new(AtomicBool::new(true));
    signal_hook::flag::register_conditional_default(signal_hook::consts::SIGINT, is_running.clone())?;
    signal_hook::flag::register_conditional_default(signal_hook::consts::SIGTERM, is_running.clone())?;

    let (blocks_tx, blocks_rx) = mpsc::channel(100);

    let mut builder = FetcherConfigBuilder::new()
        .num_threads(4)
        .chain_id(fastnear_primitives::types::ChainId::Mainnet);

    if let Some(height) = start_block {
        builder = builder.start_block_height(height);
    }

    if let Ok(token) = std::env::var("AUTH_BEARER_TOKEN") {
        builder = builder.auth_bearer_token(token);
    }

    let config = builder.build();

    let fetcher_running = is_running.clone();
    let fetcher_handle = tokio::spawn(async move {
        start_fetcher(config, blocks_tx, fetcher_running).await;
    });

    processor::process_blocks(blocks_rx, con, is_running.clone(), &contract_account).await;

    fetcher_handle.abort();

    tracing::info!("Indexer stopped.");
    Ok(())
}
