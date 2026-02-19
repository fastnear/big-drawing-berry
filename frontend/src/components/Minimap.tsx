import { useRef, useEffect, useCallback } from "react";
import type { Camera } from "../lib/types";
import { REGION_SIZE } from "../lib/constants";

interface Props {
  camera: Camera;
  regionImages: Map<string, ImageBitmap>;
  pendingPixels: Array<{ x: number; y: number; color: string }>;
  canvasWidth: number;
  canvasHeight: number;
  onNavigate: (worldX: number, worldY: number) => void;
  onCursorMove?: (worldX: number, worldY: number) => void;
}

const MINIMAP_SIZE = 160;

export default function Minimap({
  camera,
  regionImages,
  pendingPixels,
  canvasWidth,
  canvasHeight,
  onNavigate,
  onCursorMove,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  // Store the current mapping so click/drag handler can convert minimap coords → world coords
  const mappingRef = useRef({ minRx: 0, minRy: 0, scale: 1, offsetX: 0, offsetY: 0 });
  const isDraggingRef = useRef(false);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    // Clear
    ctx.fillStyle = "#111";
    ctx.fillRect(0, 0, MINIMAP_SIZE, MINIMAP_SIZE);

    if (regionImages.size === 0) return;

    // Find bounds of all loaded regions
    let minRx = Infinity,
      maxRx = -Infinity,
      minRy = Infinity,
      maxRy = -Infinity;

    for (const key of regionImages.keys()) {
      const [rxStr, ryStr] = key.split(":");
      const rx = parseInt(rxStr);
      const ry = parseInt(ryStr);
      minRx = Math.min(minRx, rx);
      maxRx = Math.max(maxRx, rx);
      minRy = Math.min(minRy, ry);
      maxRy = Math.max(maxRy, ry);
    }

    const rangeX = (maxRx - minRx + 1) * REGION_SIZE;
    const rangeY = (maxRy - minRy + 1) * REGION_SIZE;
    const maxRange = Math.max(rangeX, rangeY, REGION_SIZE);
    const scale = (MINIMAP_SIZE - 8) / maxRange;
    const offsetX = 4 + ((MINIMAP_SIZE - 8 - rangeX * scale) / 2);
    const offsetY = 4 + ((MINIMAP_SIZE - 8 - rangeY * scale) / 2);

    mappingRef.current = { minRx, minRy, scale, offsetX, offsetY };

    ctx.imageSmoothingEnabled = true;

    for (const [key, img] of regionImages) {
      const [rxStr, ryStr] = key.split(":");
      const rx = parseInt(rxStr);
      const ry = parseInt(ryStr);

      const sx = offsetX + (rx - minRx) * REGION_SIZE * scale;
      const sy = offsetY + (ry - minRy) * REGION_SIZE * scale;
      const sw = REGION_SIZE * scale;
      const sh = REGION_SIZE * scale;

      ctx.drawImage(img, sx, sy, sw, sh);
    }

    // Draw pending pixels
    for (const p of pendingPixels) {
      const sx = offsetX + (p.x - minRx * REGION_SIZE) * scale;
      const sy = offsetY + (p.y - minRy * REGION_SIZE) * scale;
      ctx.fillStyle = `#${p.color}`;
      ctx.fillRect(sx, sy, Math.max(scale, 1), Math.max(scale, 1));
    }

    // Draw viewport indicator
    const halfW = canvasWidth / 2 / camera.zoom;
    const halfH = canvasHeight / 2 / camera.zoom;
    const dpr = window.devicePixelRatio || 1;
    const vpX = offsetX + (camera.x - minRx * REGION_SIZE - halfW / dpr) * scale;
    const vpY = offsetY + (camera.y - minRy * REGION_SIZE - halfH / dpr) * scale;
    const vpW = (halfW * 2 / dpr) * scale;
    const vpH = (halfH * 2 / dpr) * scale;

    ctx.strokeStyle = "rgba(255, 255, 255, 0.8)";
    ctx.lineWidth = 1.5;
    ctx.strokeRect(vpX, vpY, vpW, vpH);
  }, [camera, regionImages, pendingPixels, canvasWidth, canvasHeight]);

  const minimapToWorld = useCallback((clientX: number, clientY: number) => {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    const mx = clientX - rect.left;
    const my = clientY - rect.top;
    const { minRx, minRy, scale, offsetX, offsetY } = mappingRef.current;
    return {
      x: (mx - offsetX) / scale + minRx * REGION_SIZE,
      y: (my - offsetY) / scale + minRy * REGION_SIZE,
    };
  }, []);

  const handleMouseDown = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      if (e.button !== 0) return;
      isDraggingRef.current = true;
      const world = minimapToWorld(e.clientX, e.clientY);
      if (world) {
        onNavigate(world.x, world.y);
        onCursorMove?.(world.x, world.y);
      }
    },
    [minimapToWorld, onNavigate, onCursorMove]
  );

  const handleMouseMove = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      const world = minimapToWorld(e.clientX, e.clientY);
      if (!world) return;
      onCursorMove?.(world.x, world.y);
      if (isDraggingRef.current) {
        onNavigate(world.x, world.y);
      }
    },
    [minimapToWorld, onNavigate, onCursorMove]
  );

  const handleMouseUp = useCallback(() => {
    isDraggingRef.current = false;
  }, []);

  // Release drag if mouse leaves the minimap
  const handleMouseLeave = useCallback(() => {
    isDraggingRef.current = false;
  }, []);

  return (
    <canvas
      ref={canvasRef}
      width={MINIMAP_SIZE}
      height={MINIMAP_SIZE}
      style={styles.canvas}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseLeave}
    />
  );
}

const styles: Record<string, React.CSSProperties> = {
  canvas: {
    position: "absolute",
    bottom: 24,
    left: 16,
    zIndex: 100,
    borderRadius: 8,
    border: "1px solid rgba(255,255,255,0.2)",
    boxShadow: "0 2px 12px rgba(0,0,0,0.5)",
    cursor: "pointer",
  },
};
