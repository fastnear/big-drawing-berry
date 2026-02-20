import { useEffect, useRef, useCallback, useState } from "react";
import type { Camera, DrawEventWS } from "../lib/types";
import { REGION_SIZE, PIXEL_SIZE } from "../lib/constants";
import { fetchRegion, fetchRegionsBatch, fetchOpenRegions, fetchRegionTimestamps } from "../lib/api";
import { getCachedRegion, setCachedRegion } from "../lib/region-cache";
import { decodeRegionToImageData, getVisibleRegions } from "../lib/canvas-renderer";
import { WebSocketClient } from "../lib/ws";

const OPEN_REGIONS_CACHE_KEY = "open_regions";

function loadCachedOpenRegions(): Set<string> {
  try {
    const raw = localStorage.getItem(OPEN_REGIONS_CACHE_KEY);
    if (raw) {
      const arr: string[] = JSON.parse(raw);
      if (arr.length > 0) return new Set(arr);
    }
  } catch {}
  return new Set(["0:0"]);
}

function saveCachedOpenRegions(regions: Set<string>) {
  try {
    localStorage.setItem(OPEN_REGIONS_CACHE_KEY, JSON.stringify([...regions]));
  } catch {}
}

/**
 * Manages region data fetching, caching, and live WebSocket updates.
 * Returns a Map of region keys to ImageBitmaps for rendering, plus regionDataRef.
 */
export function useBoard(
  camera: Camera,
  canvasWidth: number,
  canvasHeight: number,
  onDrawEvent?: (event: DrawEventWS) => void,
  pixelTimestampsRef?: React.RefObject<Map<string, number>>
) {
  const [regionImages, setRegionImages] = useState<Map<string, ImageBitmap>>(new Map());
  const regionDataRef = useRef<Map<string, ArrayBuffer>>(new Map());
  const regionMetaRef = useRef<Map<string, number>>(new Map()); // key -> lastUpdated
  const fetchingRef = useRef<Set<string>>(new Set());
  const wsRef = useRef<WebSocketClient | null>(null);
  const openRegionsRef = useRef<Set<string>>(loadCachedOpenRegions());
  const [openRegionsVersion, setOpenRegionsVersion] = useState(0);

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
      saveCachedOpenRegions(openRegionsRef.current);
      setOpenRegionsVersion((v) => v + 1);
    });

    // Fetch initial open regions from server
    fetchOpenRegions().then((regions) => {
      for (const r of regions) {
        openRegionsRef.current.add(`${r.rx}:${r.ry}`);
      }
      saveCachedOpenRegions(openRegionsRef.current);
      setOpenRegionsVersion((v) => v + 1);
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

    // Check which regions need loading
    const toLoad: Array<{ rx: number; ry: number; key: string }> = [];

    for (const { rx, ry } of visible) {
      const key = `${rx}:${ry}`;
      if (!openRegionsRef.current.has(key)) continue;
      if (regionDataRef.current.has(key) || fetchingRef.current.has(key)) continue;
      toLoad.push({ rx, ry, key });
    }

    if (toLoad.length === 0) return;

    // Mark as fetching
    for (const { key } of toLoad) {
      fetchingRef.current.add(key);
    }

    (async () => {
      // Phase 1: Load from IndexedDB cache and render immediately
      const cachedKeys = new Set<string>();

      await Promise.all(toLoad.map(async ({ rx, ry, key }) => {
        try {
          const cached = await getCachedRegion(rx, ry);
          if (cached) {
            regionDataRef.current.set(key, cached.data);
            regionMetaRef.current.set(key, cached.lastUpdated);
            cachedKeys.add(key);
          }
        } catch (e) {
          // Cache miss, will fetch from server
        }
      }));

      if (cachedKeys.size > 0) {
        await rebuildImages(cachedKeys);
      }

      // Phase 2: Batch-check server timestamps
      const coords = toLoad.map(({ rx, ry }) => [rx, ry] as [number, number]);
      let serverMetas: Array<{ rx: number; ry: number; last_updated: number }> = [];
      try {
        serverMetas = await fetchRegionsBatch(coords);
      } catch (e) {
        console.error("Failed to fetch region metadata batch:", e);
        for (const { key } of toLoad) {
          fetchingRef.current.delete(key);
        }
        return;
      }

      // Phase 3: Only fetch regions where server is newer than cache
      const serverMetaMap = new Map(
        serverMetas.map((m) => [`${m.rx}:${m.ry}`, m.last_updated])
      );
      const toFetchFull: Array<{ rx: number; ry: number; key: string }> = [];

      for (const { rx, ry, key } of toLoad) {
        const serverTs = serverMetaMap.get(key) ?? 0;
        const cachedTs = regionMetaRef.current.get(key) ?? 0;
        if (!cachedKeys.has(key) || serverTs > cachedTs) {
          toFetchFull.push({ rx, ry, key });
        }
      }

      // Phase 4: Fetch full data for stale/uncached regions
      const updatedKeys = new Set<string>();
      await Promise.all(toFetchFull.map(async ({ rx, ry, key }) => {
        try {
          const { data, lastUpdated } = await fetchRegion(rx, ry);
          regionDataRef.current.set(key, data);
          regionMetaRef.current.set(key, lastUpdated);
          await setCachedRegion(rx, ry, data, lastUpdated);
          updatedKeys.add(key);
        } catch (e) {
          console.error(`Failed to fetch region ${key}:`, e);
        }
      }));

      if (updatedKeys.size > 0) {
        await rebuildImages(updatedKeys);
      }

      // Fetch fresh pixel timestamps for all loaded regions
      if (pixelTimestampsRef?.current) {
        await Promise.all(toLoad.map(async ({ rx, ry, key }) => {
          try {
            const timestamps = await fetchRegionTimestamps(rx, ry);
            for (const [lx, ly, tsMs] of timestamps) {
              const wx = rx * REGION_SIZE + lx;
              const wy = ry * REGION_SIZE + ly;
              pixelTimestampsRef.current!.set(`${wx},${wy}`, tsMs);
            }
          } catch (e) {
            console.error(`Failed to fetch timestamps for ${key}:`, e);
          }
        }));
      }

      // Clean up fetching state
      for (const { key } of toLoad) {
        fetchingRef.current.delete(key);
      }
    })();
  }, [camera, canvasWidth, canvasHeight, openRegionsVersion, rebuildImages]);

  return { regionImages, regionDataRef, openRegionsRef };
}
