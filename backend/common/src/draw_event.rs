use serde::{Deserialize, Serialize};

/// A single pixel in a draw call's arguments.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DrawPixel {
    pub x: i32,
    pub y: i32,
    /// Hex color string, e.g. "FF5733"
    pub color: String,
}

/// The JSON args passed to the `draw` contract method.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DrawArgs {
    pub pixels: Vec<DrawPixel>,
}

/// A fully resolved draw event with signer and block metadata.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DrawEvent {
    pub predecessor_id: String,
    pub block_height: u64,
    pub block_timestamp_ms: u64,
    pub pixels: Vec<DrawPixel>,
}

impl DrawPixel {
    /// Parse the hex color string into (R, G, B).
    pub fn rgb(&self) -> Option<(u8, u8, u8)> {
        if self.color.len() != 6 {
            return None;
        }
        let r = u8::from_str_radix(&self.color[0..2], 16).ok()?;
        let g = u8::from_str_radix(&self.color[2..4], 16).ok()?;
        let b = u8::from_str_radix(&self.color[4..6], 16).ok()?;
        Some((r, g, b))
    }
}
