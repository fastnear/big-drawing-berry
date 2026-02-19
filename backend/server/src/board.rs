use common::region::*;
use common::valkey;
use common::DrawEvent;
use lru::LruCache;
use redis::AsyncCommands;
use std::num::NonZero;

/// One hour in milliseconds.
const OWNERSHIP_DURATION_MS: u64 = 3_600_000;

pub struct Board {
    /// LRU cache of region blobs keyed by (rx, ry).
    cache: LruCache<(i32, i32), Vec<u8>>,
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
    pub async fn get_region(&mut self, rx: i32, ry: i32) -> Vec<u8> {
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
        let owner_id = self.resolve_owner_id(&event.predecessor_id).await;
        let mut applied = Vec::new();

        // Group pixels by region
        let mut region_pixels: std::collections::HashMap<(i32, i32), Vec<(usize, usize, u8, u8, u8)>> =
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
            let ts_key = valkey::pixel_ts_key(*rx, *ry);
            let mut applied_ts: Vec<(String, f64)> = Vec::new();
            let mut new_pixel_count: i64 = 0;

            for &(lx, ly, r, g, b) in pixels {
                let offset = pixel_offset(lx, ly);
                let existing = Pixel::decode(&blob[offset..offset + PIXEL_SIZE]);

                // Ownership check
                if !existing.is_empty() {
                    let member = format!("{lx},{ly}");
                    let ts: Option<f64> = redis::cmd("ZSCORE")
                        .arg(&ts_key)
                        .arg(&member)
                        .query_async(&mut self.valkey)
                        .await
                        .unwrap_or(None);

                    match ts {
                        None => {
                            // No timestamp found — pre-migration permanent pixel, skip
                            continue;
                        }
                        Some(ts_f64) => {
                            let ts_ns = ts_f64 as u64;
                            let age = event.block_timestamp_ms.saturating_sub(ts_ns);
                            if age >= OWNERSHIP_DURATION_MS {
                                // Pixel is permanent — skip
                                continue;
                            }
                            if existing.owner_id != owner_id {
                                // Within ownership period and different owner — skip
                                continue;
                            }
                            // Same owner within ownership period — allow overwrite
                        }
                    }
                }

                // Track newly claimed pixels (undrawn → drawn)
                if existing.is_empty() {
                    new_pixel_count += 1;
                }

                // Apply the pixel
                let new_pixel = Pixel {
                    r,
                    g,
                    b,
                    owner_id,
                };
                new_pixel.encode(&mut blob[offset..offset + PIXEL_SIZE]);

                applied_ts.push((format!("{lx},{ly}"), event.block_timestamp_ms as f64));
                applied.push(AppliedPixel {
                    x: *rx * REGION_SIZE + lx as i32,
                    y: *ry * REGION_SIZE + ly as i32,
                    r,
                    g,
                    b,
                });
            }

            // Save back to cache
            self.cache.put((*rx, *ry), blob.clone());

            // Pipeline all writes for this region: ZADD + trim + SET + HSET
            let mut pipe = redis::pipe();

            if !applied_ts.is_empty() {
                pipe.cmd("ZADD")
                    .arg(&ts_key)
                    .arg(applied_ts.iter().flat_map(|(member, score)| {
                        vec![score.to_string(), member.clone()]
                    }).collect::<Vec<_>>())
                    .ignore();

                let one_hour_ago = event.block_timestamp_ms.saturating_sub(OWNERSHIP_DURATION_MS);
                pipe.zrembyscore(&ts_key, 0u64, one_hour_ago).ignore();
            }

            pipe.set(valkey::region_key(*rx, *ry), blob).ignore();
            pipe.cmd("HSET")
                .arg(valkey::region_meta_key(*rx, *ry))
                .arg("last_updated")
                .arg(event.block_timestamp_ms)
                .ignore();

            // Increment pixel count stats for newly claimed pixels
            if new_pixel_count > 0 {
                pipe.cmd("HINCRBY")
                    .arg(valkey::ACCOUNT_PIXEL_COUNT)
                    .arg(owner_id)
                    .arg(new_pixel_count)
                    .ignore();
                pipe.cmd("HINCRBY")
                    .arg(valkey::REGION_PIXEL_COUNT)
                    .arg(format!("{}:{}", rx, ry))
                    .arg(new_pixel_count)
                    .ignore();
            }

            let _: () = pipe
                .query_async(&mut self.valkey)
                .await
                .unwrap_or_else(|e| {
                    tracing::error!("Failed to write region ({},{}): {}", rx, ry, e);
                });
        }

        applied
    }

    /// Resolve an account_id to a u32 owner index, creating a new one if needed.
    /// IDs start at 1; 0 is reserved as the "undrawn" sentinel.
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

        // Assign a new ID: hlen + 1 so IDs start at 1 (0 = undrawn sentinel)
        let new_id: u32 = self
            .valkey
            .hlen::<_, u32>(valkey::ACCOUNT_TO_ID)
            .await
            .unwrap_or(0)
            + 1;

        let _: () = redis::pipe()
            .hset(valkey::ACCOUNT_TO_ID, account_id, new_id).ignore()
            .hset(valkey::ID_TO_ACCOUNT, new_id, account_id).ignore()
            .query_async(&mut self.valkey)
            .await
            .unwrap_or_else(|e| {
                tracing::error!("Failed to set owner mappings for {}: {}", account_id, e);
            });

        new_id
    }
}

#[derive(Debug, Clone)]
pub struct AppliedPixel {
    pub x: i32,
    pub y: i32,
    pub r: u8,
    pub g: u8,
    pub b: u8,
}
