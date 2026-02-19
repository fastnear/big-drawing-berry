use common::valkey;
use common::DrawArgs;
use common::DrawEvent;
use fastnear_primitives::block_with_tx_hash::BlockWithTxHashes;
use fastnear_primitives::near_primitives::views::{ActionView, ReceiptEnumView};
use redis::AsyncCommands;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use tokio::sync::mpsc;

pub async fn process_blocks(
    mut blocks_rx: mpsc::Receiver<BlockWithTxHashes>,
    mut con: redis::aio::MultiplexedConnection,
    is_running: Arc<AtomicBool>,
    contract_account: &str,
) {
    let mut blocks_processed: u64 = 0;

    while is_running.load(Ordering::SeqCst) {
        let block = match blocks_rx.recv().await {
            Some(block) => block,
            None => break,
        };

        let block_height = block.block.header.height;
        let block_timestamp = block.block.header.timestamp_nanosec;
        let block_timestamp_ms = block_timestamp / 1_000_000; // Convert to milliseconds

        let mut events = Vec::new();

        // Iterate through shards and receipt execution outcomes (maintains ordering)
        for shard in &block.shards {
            for outcome in &shard.receipt_execution_outcomes {
                let receipt = &outcome.receipt;

                // Filter: only receipts to our contract
                if receipt.receiver_id.as_str() != contract_account {
                    continue;
                }

                // Extract predecessor_id and actions from the receipt
                let actions = match &receipt.receipt {
                    ReceiptEnumView::Action {
                        actions, ..
                    } => actions,
                    _ => continue,
                };

                let predecessor_id = receipt.predecessor_id.to_string();

                // Find "draw" function calls
                for action in actions {
                    if let ActionView::FunctionCall {
                        method_name, args, ..
                    } = action
                    {
                        if method_name != "draw" {
                            continue;
                        }

                        // args is FunctionArgs which derefs to Vec<u8> (raw JSON bytes)
                        match serde_json::from_slice::<DrawArgs>(&args) {
                            Ok(draw_args) => {
                                // Validate pixels have valid hex colors
                                let valid_pixels: Vec<_> = draw_args
                                    .pixels
                                    .into_iter()
                                    .filter(|p| p.rgb().is_some())
                                    .collect();

                                if !valid_pixels.is_empty() {
                                    events.push(DrawEvent {
                                        predecessor_id: predecessor_id.clone(),
                                        block_height,
                                        block_timestamp_ms,
                                        pixels: valid_pixels,
                                    });
                                }
                            }
                            Err(e) => {
                                tracing::warn!(
                                    "Failed to parse draw args at block {}: {}",
                                    block_height,
                                    e
                                );
                            }
                        }
                    }
                }
            }
        }

        // Push events to Valkey queue
        if !events.is_empty() {
            let serialized: Vec<String> = events
                .iter()
                .map(|e| serde_json::to_string(e).unwrap())
                .collect();

            for event_json in &serialized {
                let _: () = con
                    .lpush(valkey::DRAW_QUEUE, event_json)
                    .await
                    .unwrap_or_else(|e| {
                        tracing::error!("Failed to LPUSH draw event: {}", e);
                    });
            }

            tracing::info!(
                "Block {}: pushed {} draw events ({} total pixels)",
                block_height,
                events.len(),
                events.iter().map(|e| e.pixels.len()).sum::<usize>()
            );
        }

        // Update last processed block
        let _: () = con
            .set(valkey::LAST_PROCESSED_BLOCK, block_height)
            .await
            .unwrap_or_else(|e| {
                tracing::error!("Failed to update last_processed_block: {}", e);
            });

        blocks_processed += 1;
        if blocks_processed % 1000 == 0 {
            tracing::info!(
                "Processed {} blocks (latest: {})",
                blocks_processed,
                block_height
            );
        }
    }
}
