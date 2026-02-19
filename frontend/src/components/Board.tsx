import { useRef, useState, useEffect, useCallback } from "react";
import type { Camera } from "../lib/types";
import { renderBoard } from "../lib/canvas-renderer";
import { REGION_SIZE, PIXEL_SIZE } from "../lib/constants";
import type { Mode } from "../hooks/useDrawing";

interface Props {
  camera: Camera;
  regionImages: Map<string, ImageBitmap>;
  mode: Mode;
  pendingPixels: Array<{ x: number; y: number; color: string }>;
  regionDataRef: React.RefObject<Map<string, ArrayBuffer>>;
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
  onPickColor: (color: string) => void;
  onCanvasSize: (w: number, h: number) => void;
  fillMode: boolean;
  onFillAtPoint: (worldX: number, worldY: number) => void;
}

export default function Board({
  camera,
  regionImages,
  mode,
  pendingPixels,
  regionDataRef,
  onPan,
  onZoomAt,
  onStartDrawing,
  onStopDrawing,
  onAddPixel,
  onPickColor,
  onCanvasSize,
  fillMode,
  onFillAtPoint,
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

  // Alt key tracking for eyedropper cursor
  const [altHeld, setAltHeld] = useState(false);
  useEffect(() => {
    const down = (e: KeyboardEvent) => { if (e.key === "Alt") setAltHeld(true); };
    const up = (e: KeyboardEvent) => { if (e.key === "Alt") setAltHeld(false); };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    window.addEventListener("blur", () => setAltHeld(false));
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
      window.removeEventListener("blur", () => setAltHeld(false));
    };
  }, []);

  // Mouse handlers
  const pickColorAt = useCallback(
    (screenX: number, screenY: number) => {
      const { x, y } = screenToWorld(screenX, screenY);
      const px = Math.floor(x);
      const py = Math.floor(y);

      // Check pending pixels first (last one wins, matching render order)
      for (let i = pendingPixels.length - 1; i >= 0; i--) {
        const p = pendingPixels[i];
        if (p.x === px && p.y === py) {
          onPickColor("#" + p.color);
          return;
        }
      }

      // Fall back to region data
      const rx = Math.floor(px / REGION_SIZE);
      const ry = Math.floor(py / REGION_SIZE);
      const blob = regionDataRef.current?.get(`${rx}:${ry}`);
      if (!blob) return;
      const lx = ((px % REGION_SIZE) + REGION_SIZE) % REGION_SIZE;
      const ly = ((py % REGION_SIZE) + REGION_SIZE) % REGION_SIZE;
      const offset = (ly * REGION_SIZE + lx) * PIXEL_SIZE;
      const view = new Uint8Array(blob);
      const r = view[offset];
      const g = view[offset + 1];
      const b = view[offset + 2];
      const hex =
        "#" +
        r.toString(16).padStart(2, "0") +
        g.toString(16).padStart(2, "0") +
        b.toString(16).padStart(2, "0");
      onPickColor(hex);
    },
    [screenToWorld, pendingPixels, regionDataRef, onPickColor]
  );

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      if (e.altKey && e.button === 0) {
        pickColorAt(e.clientX, e.clientY);
        return;
      }
      if (mode === "move" || e.button === 1) {
        isPanningRef.current = true;
        lastMouseRef.current = { x: e.clientX, y: e.clientY };
      } else if (mode === "draw" && e.button === 0) {
        if (fillMode) {
          const { x, y } = screenToWorld(e.clientX, e.clientY);
          onFillAtPoint(x, y);
        } else {
          onStartDrawing();
          const { x, y } = screenToWorld(e.clientX, e.clientY);
          onAddPixel(x, y);
        }
      }
    },
    [mode, fillMode, screenToWorld, onStartDrawing, onAddPixel, onFillAtPoint, pickColorAt]
  );

  const handleMouseMove = useCallback(
    (e: React.MouseEvent) => {
      if (isPanningRef.current) {
        const dx = -(e.clientX - lastMouseRef.current.x) / camera.zoom;
        const dy = -(e.clientY - lastMouseRef.current.y) / camera.zoom;
        lastMouseRef.current = { x: e.clientX, y: e.clientY };
        onPan(dx, dy);
      } else if (mode === "draw" && !fillMode) {
        const { x, y } = screenToWorld(e.clientX, e.clientY);
        onAddPixel(x, y);
      }
    },
    [camera.zoom, mode, fillMode, screenToWorld, onPan, onAddPixel]
  );

  const handleMouseUp = useCallback(() => {
    isPanningRef.current = false;
    onStopDrawing();
  }, [onStopDrawing]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const handler = (e: WheelEvent) => {
      e.preventDefault();
      const factor = e.deltaY > 0 ? 0.99 : 1.01;
      const dpr = window.devicePixelRatio || 1;
      onZoomAt(
        factor,
        e.clientX * dpr,
        e.clientY * dpr,
        canvas.width,
        canvas.height
      );
    };
    canvas.addEventListener("wheel", handler, { passive: false });
    return () => canvas.removeEventListener("wheel", handler);
  }, [onZoomAt]);

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
        cursor: altHeld ? "copy" : mode === "move" ? "grab" : fillMode ? "cell" : "crosshair",
        touchAction: "none",
      }}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseUp}
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleMouseUp}
    />
  );
}
