/// Region size in pixels (128x128).
pub const REGION_SIZE: i32 = 128;

/// Per-pixel binary size: 3 (RGB) + 3 (owner_id u24) = 6 bytes.
/// Timestamps are stored in per-region Valkey sorted sets (`pixel_ts:{rx}:{ry}`).
pub const PIXEL_SIZE: usize = 6;

/// Total region blob size: 128 * 128 * 6 = 98,304 bytes.
pub const REGION_BLOB_SIZE: usize = (REGION_SIZE as usize) * (REGION_SIZE as usize) * PIXEL_SIZE;

/// Number of drawn pixels required to open a region's cardinal neighbors (~20%).
pub const REGION_OPEN_THRESHOLD: i64 = (REGION_SIZE as i64 * REGION_SIZE as i64) / 5;

/// A stored pixel with color and owner. owner_id=0 means undrawn.
#[derive(Debug, Clone, Copy, Default)]
pub struct Pixel {
    pub r: u8,
    pub g: u8,
    pub b: u8,
    pub owner_id: u32,
}

/// Compute which region a world-space pixel coordinate falls in.
pub fn region_coords(x: i32, y: i32) -> (i32, i32) {
    (x.div_euclid(REGION_SIZE), y.div_euclid(REGION_SIZE))
}

/// Compute the local offset within a region for a world-space coordinate.
pub fn local_coords(x: i32, y: i32) -> (usize, usize) {
    (
        x.rem_euclid(REGION_SIZE) as usize,
        y.rem_euclid(REGION_SIZE) as usize,
    )
}

/// Byte offset into a region blob for a local (lx, ly) coordinate.
pub fn pixel_offset(lx: usize, ly: usize) -> usize {
    (ly * REGION_SIZE as usize + lx) * PIXEL_SIZE
}

impl Pixel {
    /// Encode a pixel into the 6-byte binary format (3 RGB + 3 owner_id LE).
    pub fn encode(&self, buf: &mut [u8]) {
        debug_assert!(buf.len() >= PIXEL_SIZE);
        let ob = self.owner_id.to_le_bytes();
        buf[0] = self.r;
        buf[1] = self.g;
        buf[2] = self.b;
        buf[3] = ob[0];
        buf[4] = ob[1];
        buf[5] = ob[2];
    }

    /// Decode a pixel from the 6-byte binary format.
    pub fn decode(buf: &[u8]) -> Self {
        debug_assert!(buf.len() >= PIXEL_SIZE);
        Self {
            r: buf[0],
            g: buf[1],
            b: buf[2],
            owner_id: u32::from_le_bytes([buf[3], buf[4], buf[5], 0]),
        }
    }

    /// Whether this pixel has ever been drawn on (owner_id == 0 means undrawn).
    pub fn is_empty(&self) -> bool {
        self.owner_id == 0
    }
}
