import { useEffect, useRef, useCallback, useState } from "react";
import type { Camera, DrawEventWS } from "../lib/types";
import { REGION_SIZE, PIXEL_SIZE } from "../lib/constants";
import { fetchRegion, fetchRegionsBatch, fetchOpenRegions } from "../lib/api";
import { getCachedRegion, setCachedRegion } from "../lib/region-cache";
import { decodeRegionToImageData, getVisibleRegions } from "../lib/canvas-renderer";
import { WebSocketClient } from "../lib/ws";

/**
 * Manages region data fetching, caching, and live WebSocket updates.
 * Returns a Map of region keys to ImageBitmaps for rendering, plus regionDataRef.
 */
export function useBoard(
  camera: Camera,
  canvasWidth: number,
  canvasHeight: number,
  onDrawEvent?: (event: DrawEventWS) => void
) {
  const [regionImages, setRegionImages] = useState<Map<string, ImageBitmap>>(new Map());
  const regionDataRef = useRef<Map<string, ArrayBuffer>>(new Map());
  const regionMetaRef = useRef<Map<string, number>>(new Map()); // key -> lastUpdated
  const fetchingRef = useRef<Set<string>>(new Set());
  const wsRef = useRef<WebSocketClient | null>(null);
  const openRegionsRef = useRef<Set<string>>(new Set(["0:0"]));

  // Connect WebSocket + fetch open regions
  useEffect(() => {
    const ws = new WebSocketClient();
    wsRef.current = ws;
    ws.connect();

    ws.onDraw((event: DrawEventWS) => {
      applyLivePixels(event);
      onDrawEvent?.(event);
    });

    ws.onRegionsOpened((event) => {
      for (const r of event.regions) {
        openRegionsRef.current.add(`${r.rx}:${r.ry}`);
      }
    });

    // Fetch initial open regions from server
    fetchOpenRegions().then((regions) => {
      for (const r of regions) {
        openRegionsRef.current.add(`${r.rx}:${r.ry}`);
      }
    }).catch((e) => console.error("Failed to fetch open regions:", e));

    return () => ws.disconnect();
  }, []);

  // Apply live pixel updates from WebSocket
  const applyLivePixels = useCallback((event: DrawEventWS) => {
    const affectedRegions = new Set<string>();

    for (const pixel of event.pixels) {
      const rx = Math.floor(pixel.x / REGION_SIZE);
      const ry = Math.floor(pixel.y / REGION_SIZE);
      const key = `${rx}:${ry}`;

      const blob = regionDataRef.current.get(key);
      if (!blob) continue;

      const lx = ((pixel.x % REGION_SIZE) + REGION_SIZE) % REGION_SIZE;
      const ly = ((pixel.y % REGION_SIZE) + REGION_SIZE) % REGION_SIZE;
      const offset = (ly * REGION_SIZE + lx) * PIXEL_SIZE;

      const view = new Uint8Array(blob);
      const r = parseInt(pixel.color.slice(0, 2), 16);
      const g = parseInt(pixel.color.slice(2, 4), 16);
      const b = parseInt(pixel.color.slice(4, 6), 16);

      view[offset] = r;
      view[offset + 1] = g;
      view[offset + 2] = b;

      // Set a non-zero owner_id so the pixel renders as drawn
      if (view[offset + 3] === 0 && view[offset + 4] === 0 && view[offset + 5] === 0) {
        view[offset + 3] = 1; // minimal non-zero marker
      }

      affectedRegions.add(key);
    }

    // Rebuild ImageBitmaps for affected regions
    if (affectedRegions.size > 0) {
      rebuildImages(affectedRegions);
    }
  }, []);

  // Rebuild ImageBitmaps from raw region data
  const rebuildImages = useCallback(async (keys: Set<string>) => {
    const updates = new Map<string, ImageBitmap>();

    for (const key of keys) {
      const blob = regionDataRef.current.get(key);
      if (!blob) continue;

      const imageData = decodeRegionToImageData(blob);
      const bitmap = await createImageBitmap(imageData);
      updates.set(key, bitmap);
    }

    setRegionImages((prev) => {
      const next = new Map(prev);
      for (const [k, v] of updates) {
        next.set(k, v);
      }
      return next;
    });
  }, []);

  // Fetch visible regions
  useEffect(() => {
    if (canvasWidth === 0 || canvasHeight === 0) return;

    const visible = getVisibleRegions(camera, canvasWidth, canvasHeight);

    // Check which regions need fetching
    const toFetch: Array<{ rx: number; ry: number; key: string }> = [];

    for (const { rx, ry } of visible) {
      const key = `${rx}:${ry}`;
      if (regionDataRef.current.has(key) || fetchingRef.current.has(key)) continue;
      toFetch.push({ rx, ry, key });
    }

    if (toFetch.length === 0) return;

    // Mark as fetching
    for (const { key } of toFetch) {
      fetchingRef.current.add(key);
    }

    // Fetch regions
    (async () => {
      for (const { rx, ry, key } of toFetch) {
        try {
          // Try cache first
          const cached = await getCachedRegion(rx, ry);
          if (cached) {
            regionDataRef.current.set(key, cached.data);
            regionMetaRef.current.set(key, cached.lastUpdated);
          }

          // Always fetch fresh from server (will be a no-op if server has no updates)
          const { data, lastUpdated } = await fetchRegion(rx, ry);
          regionDataRef.current.set(key, data);
          regionMetaRef.current.set(key, lastUpdated);
          await setCachedRegion(rx, ry, data, lastUpdated);
        } catch (e) {
          console.error(`Failed to fetch region ${key}:`, e);
        } finally {
          fetchingRef.current.delete(key);
        }
      }

      // Build ImageBitmaps for newly fetched regions
      const newKeys = new Set(toFetch.map((r) => r.key));
      await rebuildImages(newKeys);
    })();
  }, [camera, canvasWidth, canvasHeight, rebuildImages]);

  return { regionImages, regionDataRef, openRegionsRef };
}
