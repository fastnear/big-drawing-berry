import { useRef, useEffect, useCallback } from "react";
import type { Camera } from "../lib/types";
import { renderBoard } from "../lib/canvas-renderer";
import type { Mode } from "../hooks/useDrawing";

interface Props {
  camera: Camera;
  regionImages: Map<string, ImageBitmap>;
  mode: Mode;
  pendingPixels: Array<{ x: number; y: number; color: string }>;
  onPan: (dx: number, dy: number) => void;
  onZoomAt: (
    factor: number,
    screenX: number,
    screenY: number,
    canvasWidth: number,
    canvasHeight: number
  ) => void;
  onStartDrawing: () => void;
  onStopDrawing: () => void;
  onAddPixel: (worldX: number, worldY: number) => void;
  onCanvasSize: (w: number, h: number) => void;
}

export default function Board({
  camera,
  regionImages,
  mode,
  pendingPixels,
  onPan,
  onZoomAt,
  onStartDrawing,
  onStopDrawing,
  onAddPixel,
  onCanvasSize,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const isPanningRef = useRef(false);
  const lastMouseRef = useRef({ x: 0, y: 0 });
  const rafRef = useRef<number>(0);

  // Resize canvas to fill viewport
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const resize = () => {
      const dpr = window.devicePixelRatio || 1;
      canvas.width = window.innerWidth * dpr;
      canvas.height = window.innerHeight * dpr;
      canvas.style.width = `${window.innerWidth}px`;
      canvas.style.height = `${window.innerHeight}px`;
      onCanvasSize(canvas.width, canvas.height);
    };

    resize();
    window.addEventListener("resize", resize);
    return () => window.removeEventListener("resize", resize);
  }, [onCanvasSize]);

  // Render loop
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const scaledCamera = { ...camera, zoom: camera.zoom * dpr };

    renderBoard(ctx, canvas, scaledCamera, regionImages);

    // Draw pending pixels
    if (pendingPixels.length > 0) {
      const { x: cx, y: cy, zoom } = scaledCamera;
      const { width, height } = canvas;

      for (const p of pendingPixels) {
        const sx = (p.x - cx) * zoom + width / 2;
        const sy = (p.y - cy) * zoom + height / 2;
        ctx.fillStyle = `#${p.color}`;
        ctx.fillRect(sx, sy, zoom, zoom);
        // Draw a subtle outline to show pending state
        ctx.strokeStyle = "rgba(255, 255, 255, 0.5)";
        ctx.lineWidth = 1;
        ctx.strokeRect(sx, sy, zoom, zoom);
      }
    }
  }, [camera, regionImages, pendingPixels]);

  // Screen to world coordinate conversion
  const screenToWorld = useCallback(
    (screenX: number, screenY: number) => {
      const canvas = canvasRef.current;
      if (!canvas) return { x: 0, y: 0 };
      const dpr = window.devicePixelRatio || 1;
      const w = canvas.width;
      const h = canvas.height;
      const worldX = (screenX * dpr - w / 2) / (camera.zoom * dpr) + camera.x;
      const worldY = (screenY * dpr - h / 2) / (camera.zoom * dpr) + camera.y;
      return { x: worldX, y: worldY };
    },
    [camera]
  );

  // Mouse handlers
  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      if (mode === "move" || e.button === 1) {
        isPanningRef.current = true;
        lastMouseRef.current = { x: e.clientX, y: e.clientY };
      } else if (mode === "draw" && e.button === 0) {
        onStartDrawing();
        const { x, y } = screenToWorld(e.clientX, e.clientY);
        onAddPixel(x, y);
      }
    },
    [mode, screenToWorld, onStartDrawing, onAddPixel]
  );

  const handleMouseMove = useCallback(
    (e: React.MouseEvent) => {
      if (isPanningRef.current) {
        const dx = -(e.clientX - lastMouseRef.current.x) / camera.zoom;
        const dy = -(e.clientY - lastMouseRef.current.y) / camera.zoom;
        lastMouseRef.current = { x: e.clientX, y: e.clientY };
        onPan(dx, dy);
      } else if (mode === "draw") {
        const { x, y } = screenToWorld(e.clientX, e.clientY);
        onAddPixel(x, y);
      }
    },
    [camera.zoom, mode, screenToWorld, onPan, onAddPixel]
  );

  const handleMouseUp = useCallback(() => {
    isPanningRef.current = false;
    onStopDrawing();
  }, [onStopDrawing]);

  const handleWheel = useCallback(
    (e: React.WheelEvent) => {
      e.preventDefault();
      const factor = e.deltaY > 0 ? 0.9 : 1.1;
      const canvas = canvasRef.current;
      if (!canvas) return;
      const dpr = window.devicePixelRatio || 1;
      onZoomAt(
        factor,
        e.clientX * dpr,
        e.clientY * dpr,
        canvas.width,
        canvas.height
      );
    },
    [onZoomAt]
  );

  // Touch handlers for mobile pan/pinch
  const touchStartRef = useRef<{ touches: Array<{ x: number; y: number }>; dist: number }>({
    touches: [],
    dist: 0,
  });

  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    const touches = Array.from(e.touches).map((t) => ({
      x: t.clientX,
      y: t.clientY,
    }));
    let dist = 0;
    if (touches.length === 2) {
      dist = Math.hypot(
        touches[1].x - touches[0].x,
        touches[1].y - touches[0].y
      );
    }
    touchStartRef.current = { touches, dist };
  }, []);

  const handleTouchMove = useCallback(
    (e: React.TouchEvent) => {
      e.preventDefault();
      const touches = Array.from(e.touches).map((t) => ({
        x: t.clientX,
        y: t.clientY,
      }));
      const prev = touchStartRef.current;

      if (touches.length === 1 && prev.touches.length >= 1) {
        // Pan
        const dx = -(touches[0].x - prev.touches[0].x) / camera.zoom;
        const dy = -(touches[0].y - prev.touches[0].y) / camera.zoom;
        onPan(dx, dy);
      } else if (touches.length === 2 && prev.touches.length === 2) {
        // Pinch zoom
        const dist = Math.hypot(
          touches[1].x - touches[0].x,
          touches[1].y - touches[0].y
        );
        if (prev.dist > 0) {
          const factor = dist / prev.dist;
          const midX = (touches[0].x + touches[1].x) / 2;
          const midY = (touches[0].y + touches[1].y) / 2;
          const canvas = canvasRef.current;
          if (canvas) {
            const dpr = window.devicePixelRatio || 1;
            onZoomAt(factor, midX * dpr, midY * dpr, canvas.width, canvas.height);
          }
        }
      }

      let dist = 0;
      if (touches.length === 2) {
        dist = Math.hypot(
          touches[1].x - touches[0].x,
          touches[1].y - touches[0].y
        );
      }
      touchStartRef.current = { touches, dist };
    },
    [camera.zoom, onPan, onZoomAt]
  );

  return (
    <canvas
      ref={canvasRef}
      style={{
        position: "absolute",
        top: 0,
        left: 0,
        cursor: mode === "move" ? "grab" : "crosshair",
        touchAction: "none",
      }}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseUp}
      onWheel={handleWheel}
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleMouseUp}
    />
  );
}
