import {
  REGION_SIZE,
  PIXEL_SIZE,
  GRID_ZOOM_THRESHOLD,
} from "./constants";
import type { Camera } from "./types";

/**
 * Decode a region binary blob into an RGBA ImageData-compatible Uint8ClampedArray.
 * Each pixel is 6 bytes: R, G, B, owner_id(3 bytes LE, 0 = undrawn).
 * We extract just the RGB and set alpha to 255 for drawn pixels, 0 for empty.
 */
export function decodeRegionToImageData(
  blob: ArrayBuffer
): ImageData {
  const src = new Uint8Array(blob);
  const imageData = new ImageData(REGION_SIZE, REGION_SIZE);
  const dst = imageData.data;

  for (let i = 0; i < REGION_SIZE * REGION_SIZE; i++) {
    const srcOff = i * PIXEL_SIZE;
    const dstOff = i * 4;

    // Check if pixel is drawn by looking at owner_id bytes (offset 3-5)
    const hasOwner =
      src[srcOff + 3] !== 0 ||
      src[srcOff + 4] !== 0 ||
      src[srcOff + 5] !== 0;

    if (hasOwner) {
      dst[dstOff] = src[srcOff]; // R
      dst[dstOff + 1] = src[srcOff + 1]; // G
      dst[dstOff + 2] = src[srcOff + 2]; // B
      dst[dstOff + 3] = 255; // A
    }
    // else: stays (0,0,0,0) - transparent (drawn as black by canvas background)
  }

  return imageData;
}

/**
 * Render the board onto a canvas given the current camera state and loaded regions.
 */
export function renderBoard(
  ctx: CanvasRenderingContext2D,
  canvas: HTMLCanvasElement,
  camera: Camera,
  regionImages: Map<string, ImageBitmap>,
  openRegions?: Set<string>
) {
  const { width, height } = canvas;
  const { x: cx, y: cy, zoom } = camera;

  // Clear to black
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, width, height);

  // Calculate visible region range
  const halfW = width / 2 / zoom;
  const halfH = height / 2 / zoom;
  const minX = cx - halfW;
  const maxX = cx + halfW;
  const minY = cy - halfH;
  const maxY = cy + halfH;

  const minRx = Math.floor(minX / REGION_SIZE);
  const maxRx = Math.floor(maxX / REGION_SIZE);
  const minRy = Math.floor(minY / REGION_SIZE);
  const maxRy = Math.floor(maxY / REGION_SIZE);

  // Disable image smoothing for crisp pixels
  ctx.imageSmoothingEnabled = false;

  for (let ry = minRy; ry <= maxRy; ry++) {
    for (let rx = minRx; rx <= maxRx; rx++) {
      const key = `${rx}:${ry}`;

      // World position of this region's top-left corner
      const wx = rx * REGION_SIZE;
      const wy = ry * REGION_SIZE;

      // Convert to screen coordinates
      const sx = (wx - cx) * zoom + width / 2;
      const sy = (wy - cy) * zoom + height / 2;
      const sw = REGION_SIZE * zoom;
      const sh = REGION_SIZE * zoom;

      const img = regionImages.get(key);
      if (img) {
        ctx.drawImage(img, sx, sy, sw, sh);
      }

      // Gray overlay for locked (non-open) regions
      if (openRegions && !openRegions.has(key)) {
        ctx.fillStyle = "rgba(80, 80, 80, 0.7)";
        ctx.fillRect(sx, sy, sw, sh);
      }
    }
  }

  // Draw grid at high zoom levels
  if (zoom >= GRID_ZOOM_THRESHOLD) {
    drawGrid(ctx, width, height, camera);
  }
}

function drawGrid(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  camera: Camera
) {
  const { x: cx, y: cy, zoom } = camera;

  ctx.strokeStyle = "rgba(255, 255, 255, 0.15)";
  ctx.lineWidth = 1;

  const halfW = width / 2 / zoom;
  const halfH = height / 2 / zoom;
  const startX = Math.floor(cx - halfW);
  const endX = Math.ceil(cx + halfW);
  const startY = Math.floor(cy - halfH);
  const endY = Math.ceil(cy + halfH);

  ctx.beginPath();

  // Vertical lines
  for (let x = startX; x <= endX; x++) {
    const sx = (x - cx) * zoom + width / 2;
    ctx.moveTo(Math.round(sx) + 0.5, 0);
    ctx.lineTo(Math.round(sx) + 0.5, height);
  }

  // Horizontal lines
  for (let y = startY; y <= endY; y++) {
    const sy = (y - cy) * zoom + height / 2;
    ctx.moveTo(0, Math.round(sy) + 0.5);
    ctx.lineTo(width, Math.round(sy) + 0.5);
  }

  ctx.stroke();
}

/**
 * Get the list of visible region coordinates for the current camera.
 */
export function getVisibleRegions(
  camera: Camera,
  canvasWidth: number,
  canvasHeight: number
): Array<{ rx: number; ry: number }> {
  const { x: cx, y: cy, zoom } = camera;
  const halfW = canvasWidth / 2 / zoom;
  const halfH = canvasHeight / 2 / zoom;

  const minRx = Math.floor((cx - halfW) / REGION_SIZE);
  const maxRx = Math.floor((cx + halfW) / REGION_SIZE);
  const minRy = Math.floor((cy - halfH) / REGION_SIZE);
  const maxRy = Math.floor((cy + halfH) / REGION_SIZE);

  const regions: Array<{ rx: number; ry: number }> = [];
  for (let ry = minRy; ry <= maxRy; ry++) {
    for (let rx = minRx; rx <= maxRx; rx++) {
      regions.push({ rx, ry });
    }
  }
  return regions;
}
