import { useRef, useEffect } from "react";
import type { Camera } from "../lib/types";
import { REGION_SIZE } from "../lib/constants";

interface Props {
  camera: Camera;
  regionImages: Map<string, ImageBitmap>;
  canvasWidth: number;
  canvasHeight: number;
}

const MINIMAP_SIZE = 160;

export default function Minimap({
  camera,
  regionImages,
  canvasWidth,
  canvasHeight,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

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
  }, [camera, regionImages, canvasWidth, canvasHeight]);

  return (
    <canvas
      ref={canvasRef}
      width={MINIMAP_SIZE}
      height={MINIMAP_SIZE}
      style={styles.canvas}
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
  },
};
