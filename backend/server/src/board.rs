use common::region::*;
use common::valkey;
use common::DrawEvent;
use lru::LruCache;
use redis::AsyncCommands;
use std::num::NonZero;

/// One hour in nanoseconds.
const OWNERSHIP_DURATION_NS: u64 = 3_600_000_000_000;

pub struct Board {
    /// LRU cache of region blobs keyed by (rx, ry).
    cache: LruCache<(i64, i64), Vec<u8>>,
    valkey: redis::aio::MultiplexedConnection,
}

impl Board {
    pub fn new(valkey: redis::aio::MultiplexedConnection) -> Self {
        Self {
            cache: LruCache::new(NonZero::new(256).unwrap()),
            valkey,
        }
    }

    /// Get or load a region blob. Returns a clone of the data.
    pub async fn get_region(&mut self, rx: i64, ry: i64) -> Vec<u8> {
        if let Some(blob) = self.cache.get(&(rx, ry)) {
            return blob.clone();
        }

        let blob: Vec<u8> = self
            .valkey
            .get(valkey::region_key(rx, ry))
            .await
            .unwrap_or_default();

        if blob.is_empty() {
            // Return a zeroed-out region (all black, undrawn)
            let empty = vec![0u8; REGION_BLOB_SIZE];
            self.cache.put((rx, ry), empty.clone());
            return empty;
        }

        self.cache.put((rx, ry), blob.clone());
        blob
    }

    /// Apply a draw event to the board, enforcing ownership rules.
    /// Returns the list of pixels that were actually applied (for broadcasting).
    pub async fn apply_event(&mut self, event: &DrawEvent) -> Vec<AppliedPixel> {
        let owner_id = self.resolve_owner_id(&event.signer_id).await;
        let mut applied = Vec::new();

        // Group pixels by region
        let mut region_pixels: std::collections::HashMap<(i64, i64), Vec<(usize, usize, u8, u8, u8)>> =
            std::collections::HashMap::new();

        for pixel in &event.pixels {
            let (r, g, b) = match pixel.rgb() {
                Some(rgb) => rgb,
                None => continue,
            };
            let (rx, ry) = region_coords(pixel.x, pixel.y);
            let (lx, ly) = local_coords(pixel.x, pixel.y);
            region_pixels
                .entry((rx, ry))
                .or_default()
                .push((lx, ly, r, g, b));
        }

        for ((rx, ry), pixels) in &region_pixels {
            let mut blob = self.get_region(*rx, *ry).await;

            for &(lx, ly, r, g, b) in pixels {
                let offset = pixel_offset(lx, ly);
                let existing = Pixel::decode(&blob[offset..offset + PIXEL_SIZE]);

                // Ownership check
                if !existing.is_empty() {
                    let age = event.block_timestamp.saturating_sub(existing.timestamp_ns);
                    if age < OWNERSHIP_DURATION_NS && existing.owner_id != owner_id {
                        // Within ownership period and different owner - skip
                        continue;
                    }
                    if age >= OWNERSHIP_DURATION_NS {
                        // Pixel is permanent - skip
                        continue;
                    }
                }

                // Apply the pixel
                let new_pixel = Pixel {
                    r,
                    g,
                    b,
                    owner_id,
                    timestamp_ns: event.block_timestamp,
                };
                new_pixel.encode(&mut blob[offset..offset + PIXEL_SIZE]);

                applied.push(AppliedPixel {
                    x: *rx * REGION_SIZE + lx as i64,
                    y: *ry * REGION_SIZE + ly as i64,
                    r,
                    g,
                    b,
                });
            }

            // Save back to cache and Valkey
            self.cache.put((*rx, *ry), blob.clone());
            let _: () = self
                .valkey
                .set(valkey::region_key(*rx, *ry), blob)
                .await
                .unwrap_or_else(|e| {
                    tracing::error!("Failed to save region ({},{}): {}", rx, ry, e);
                });

            // Update region metadata
            let _: () = self
                .valkey
                .hset(
                    valkey::region_meta_key(*rx, *ry),
                    "last_updated",
                    event.block_timestamp,
                )
                .await
                .unwrap_or_else(|e| {
                    tracing::error!("Failed to update region meta ({},{}): {}", rx, ry, e);
                });
        }

        applied
    }

    /// Resolve an account_id to a u32 owner index, creating a new one if needed.
    async fn resolve_owner_id(&mut self, account_id: &str) -> u32 {
        // Check if account already has an ID
        let existing: Option<u32> = self
            .valkey
            .hget(valkey::ACCOUNT_TO_ID, account_id)
            .await
            .unwrap_or(None);

        if let Some(id) = existing {
            return id;
        }

        // Assign a new ID by getting the current count
        let new_id: u32 = self
            .valkey
            .hlen(valkey::ACCOUNT_TO_ID)
            .await
            .unwrap_or(0);

        let _: () = self
            .valkey
            .hset(valkey::ACCOUNT_TO_ID, account_id, new_id)
            .await
            .unwrap_or_else(|e| {
                tracing::error!("Failed to set account_to_id for {}: {}", account_id, e);
            });

        let _: () = self
            .valkey
            .hset(valkey::ID_TO_ACCOUNT, new_id, account_id)
            .await
            .unwrap_or_else(|e| {
                tracing::error!("Failed to set id_to_account for {}: {}", new_id, e);
            });

        new_id
    }
}

#[derive(Debug, Clone)]
pub struct AppliedPixel {
    pub x: i64,
    pub y: i64,
    pub r: u8,
    pub g: u8,
    pub b: u8,
}
