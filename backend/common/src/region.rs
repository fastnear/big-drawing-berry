/// Region size in pixels (128x128).
pub const REGION_SIZE: i64 = 128;

/// Per-pixel binary size: 3 (RGB) + 4 (owner_id u32) + 8 (timestamp_ns u64) = 15 bytes.
pub const PIXEL_SIZE: usize = 15;

/// Total region blob size: 128 * 128 * 15 = 245,760 bytes.
pub const REGION_BLOB_SIZE: usize = (REGION_SIZE as usize) * (REGION_SIZE as usize) * PIXEL_SIZE;

/// A stored pixel with color, owner, and timestamp.
#[derive(Debug, Clone, Copy, Default)]
pub struct Pixel {
    pub r: u8,
    pub g: u8,
    pub b: u8,
    pub owner_id: u32,
    pub timestamp_ns: u64,
}

/// Compute which region a world-space pixel coordinate falls in.
pub fn region_coords(x: i64, y: i64) -> (i64, i64) {
    (x.div_euclid(REGION_SIZE), y.div_euclid(REGION_SIZE))
}

/// Compute the local offset within a region for a world-space coordinate.
pub fn local_coords(x: i64, y: i64) -> (usize, usize) {
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
    /// Encode a pixel into the 15-byte binary format.
    pub fn encode(&self, buf: &mut [u8]) {
        debug_assert!(buf.len() >= PIXEL_SIZE);
        buf[0] = self.r;
        buf[1] = self.g;
        buf[2] = self.b;
        buf[3..7].copy_from_slice(&self.owner_id.to_le_bytes());
        buf[7..15].copy_from_slice(&self.timestamp_ns.to_le_bytes());
    }

    /// Decode a pixel from the 15-byte binary format.
    pub fn decode(buf: &[u8]) -> Self {
        debug_assert!(buf.len() >= PIXEL_SIZE);
        Self {
            r: buf[0],
            g: buf[1],
            b: buf[2],
            owner_id: u32::from_le_bytes(buf[3..7].try_into().unwrap()),
            timestamp_ns: u64::from_le_bytes(buf[7..15].try_into().unwrap()),
        }
    }

    /// Whether this pixel has ever been drawn on.
    pub fn is_empty(&self) -> bool {
        self.timestamp_ns == 0
    }
}
