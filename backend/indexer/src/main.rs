mod processor;

use fastnear_neardata_fetcher::{FetcherConfigBuilder, start_fetcher};
use redis::AsyncCommands;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use tokio::sync::mpsc;

const CONTRACT_ACCOUNT: &str = "berryfast.near";

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::from_default_env()
                .add_directive("indexer=info".parse().unwrap()),
        )
        .init();

    let valkey_url = std::env::var("VALKEY_URL").unwrap_or_else(|_| "redis://127.0.0.1:6379".into());
    let client = redis::Client::open(valkey_url)?;
    let mut con = client.get_multiplexed_async_connection().await?;

    // Read last processed block height
    let start_block: Option<u64> = con.get(common::valkey::LAST_PROCESSED_BLOCK).await?;
    let start_block = start_block.map(|h| h + 1);

    tracing::info!(
        "Starting indexer from block {:?} for contract {}",
        start_block,
        CONTRACT_ACCOUNT
    );

    let is_running = Arc::new(AtomicBool::new(true));
    let is_running_clone = is_running.clone();

    ctrlc::set_handler(move || {
        tracing::info!("Shutting down...");
        is_running_clone.store(false, Ordering::SeqCst);
    })?;

    let (blocks_tx, blocks_rx) = mpsc::channel(100);

    let mut builder = FetcherConfigBuilder::new()
        .num_threads(4)
        .chain_id(fastnear_primitives::types::ChainId::Mainnet);

    if let Some(height) = start_block {
        builder = builder.start_block_height(height);
    }

    let config = builder.build();

    let fetcher_running = is_running.clone();
    let fetcher_handle = tokio::spawn(async move {
        start_fetcher(config, blocks_tx, fetcher_running).await;
    });

    processor::process_blocks(blocks_rx, con, is_running.clone(), CONTRACT_ACCOUNT).await;

    fetcher_handle.abort();

    tracing::info!("Indexer stopped.");
    Ok(())
}
