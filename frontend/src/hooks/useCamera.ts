import { useState, useCallback, useEffect, useRef } from "react";
import { MIN_ZOOM, MAX_ZOOM, DEFAULT_ZOOM } from "../lib/constants";
import type { Camera } from "../lib/types";

function parseHash(): Camera {
  const hash = window.location.hash.slice(1);
  const parts = hash.split(",");
  if (parts.length >= 2) {
    const x = parseFloat(parts[0]);
    const y = parseFloat(parts[1]);
    const zoom = parts.length >= 3 ? parseFloat(parts[2]) : 4;
    if (!isNaN(x) && !isNaN(y) && !isNaN(zoom)) {
      return { x, y, zoom: Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, zoom)) };
    }
  }
  return { x: 64, y: 64, zoom: DEFAULT_ZOOM };
}

function updateHash(camera: Camera) {
  const hash = `${Math.round(camera.x)},${Math.round(camera.y)},${camera.zoom.toFixed(1)}`;
  window.history.replaceState(null, "", `#${hash}`);
}

export function useCamera() {
  const [camera, setCamera] = useState<Camera>(parseHash);
  const hashUpdateTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Sync camera to URL hash (debounced)
  useEffect(() => {
    if (hashUpdateTimer.current) clearTimeout(hashUpdateTimer.current);
    hashUpdateTimer.current = setTimeout(() => updateHash(camera), 200);
    return () => {
      if (hashUpdateTimer.current) clearTimeout(hashUpdateTimer.current);
    };
  }, [camera]);

  const pan = useCallback((dx: number, dy: number) => {
    setCamera((c) => ({ ...c, x: c.x + dx, y: c.y + dy }));
  }, []);

  const zoomAt = useCallback(
    (factor: number, screenX: number, screenY: number, canvasWidth: number, canvasHeight: number) => {
      setCamera((c) => {
        const newZoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, c.zoom * factor));
        // Zoom towards the cursor position
        const worldX = (screenX - canvasWidth / 2) / c.zoom + c.x;
        const worldY = (screenY - canvasHeight / 2) / c.zoom + c.y;
        const newX = worldX - (screenX - canvasWidth / 2) / newZoom;
        const newY = worldY - (screenY - canvasHeight / 2) / newZoom;
        return { x: newX, y: newY, zoom: newZoom };
      });
    },
    []
  );

  const zoomIn = useCallback(() => {
    setCamera((c) => ({
      ...c,
      zoom: Math.min(MAX_ZOOM, c.zoom * 1.5),
    }));
  }, []);

  const zoomOut = useCallback(() => {
    setCamera((c) => ({
      ...c,
      zoom: Math.max(MIN_ZOOM, c.zoom / 1.5),
    }));
  }, []);

  return { camera, setCamera, pan, zoomAt, zoomIn, zoomOut };
}
