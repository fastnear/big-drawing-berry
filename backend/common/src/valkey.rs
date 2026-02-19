/// Valkey key for the draw event queue (indexer LPUSH, server RPOP).
pub const DRAW_QUEUE: &str = "draw_queue";

/// Valkey key for the processing queue (RPOPLPUSH target).
pub const PROCESSING_QUEUE: &str = "processing_queue";

/// Valkey key for the last processed block height.
pub const LAST_PROCESSED_BLOCK: &str = "last_processed_block";

/// Valkey key for account_id -> u32 owner index mapping.
pub const ACCOUNT_TO_ID: &str = "account_to_id";

/// Valkey key for u32 owner index -> account_id reverse mapping.
pub const ID_TO_ACCOUNT: &str = "id_to_account";

/// Valkey sorted set for recent draw events (for WebSocket catch-up).
pub const DRAW_EVENTS_ZSET: &str = "draw_events";

/// Hash: owner_id (u32) → pixel count (i64). Tracks how many pixels each account owns.
pub const ACCOUNT_PIXEL_COUNT: &str = "account_pixel_count";

/// Hash: "rx:ry" → pixel count (i64). Tracks drawn pixels per region.
pub const REGION_PIXEL_COUNT: &str = "region_pixel_count";

/// Set of "rx:ry" strings for regions that are open for drawing.
pub const OPEN_REGIONS: &str = "open_regions";

/// Build the Valkey key for a region blob.
pub fn region_key(rx: i32, ry: i32) -> String {
    format!("region:{rx}:{ry}")
}

/// Build the Valkey key for region metadata.
pub fn region_meta_key(rx: i32, ry: i32) -> String {
    format!("region_meta:{rx}:{ry}")
}

/// Build the Valkey key for per-region pixel timestamp sorted set.
pub fn pixel_ts_key(rx: i32, ry: i32) -> String {
    format!("pixel_ts:{rx}:{ry}")
}
