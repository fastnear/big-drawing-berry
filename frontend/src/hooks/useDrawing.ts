import { useState, useCallback, useRef } from "react";
import { REGION_SIZE, PIXEL_SIZE } from "../lib/constants";
import type { DrawEventWS } from "../lib/types";

export type Mode = "move" | "draw";

/** One hour in milliseconds (for client-side ownership hint). */
const OWNERSHIP_DURATION_MS = 3_600_000;

export function useDrawing(
  callDraw: (pixels: Array<{ x: number; y: number; color: string }>) => Promise<void>,
  accountId: string | null,
  regionDataRef: React.RefObject<Map<string, ArrayBuffer>>
) {
  const [mode, setMode] = useState<Mode>("move");
  const [color, setColor] = useState("#FF5733");
  const [pendingPixels, setPendingPixels] = useState<
    Array<{ x: number; y: number; color: string }>
  >([]);
  const [isSending, setIsSending] = useState(false);
  const isDrawingRef = useRef(false);

  // Track timestamps for pixels we own (client-side hint to avoid wasted transactions)
  const ownPixelTimestamps = useRef<Map<string, number>>(new Map());

  const colorHex = color.replace("#", "").toUpperCase();

  const startDrawing = useCallback(() => {
    if (mode !== "draw" || !accountId) return;
    isDrawingRef.current = true;
  }, [mode, accountId]);

  const stopDrawing = useCallback(() => {
    isDrawingRef.current = false;
  }, []);

  /** Called from useBoard when a WebSocket draw event arrives. */
  const handleDrawEvent = useCallback(
    (event: DrawEventWS) => {
      if (!accountId || event.signer !== accountId) return;
      const now = Date.now();
      for (const pixel of event.pixels) {
        ownPixelTimestamps.current.set(`${pixel.x},${pixel.y}`, now);
      }
    },
    [accountId]
  );

  const addPixel = useCallback(
    (worldX: number, worldY: number) => {
      if (!isDrawingRef.current || mode !== "draw" || !accountId) return;

      const px = Math.floor(worldX);
      const py = Math.floor(worldY);

      // Client-side ownership hint: check if pixel is drawable
      const rx = Math.floor(px / REGION_SIZE);
      const ry = Math.floor(py / REGION_SIZE);
      const key = `${rx}:${ry}`;
      const blob = regionDataRef.current?.get(key);
      if (blob) {
        const lx = ((px % REGION_SIZE) + REGION_SIZE) % REGION_SIZE;
        const ly = ((py % REGION_SIZE) + REGION_SIZE) % REGION_SIZE;
        const offset = (ly * REGION_SIZE + lx) * PIXEL_SIZE;
        const view = new Uint8Array(blob);
        const hasOwner =
          view[offset + 3] !== 0 || view[offset + 4] !== 0 || view[offset + 5] !== 0;

        if (hasOwner) {
          // Pixel is owned — check our local timestamp cache
          const coordKey = `${px},${py}`;
          const ownTs = ownPixelTimestamps.current.get(coordKey);
          if (!ownTs) {
            // We don't own this pixel (or don't know about it) — skip
            return;
          }
          const ageMs = Date.now() - ownTs;
          if (ageMs >= OWNERSHIP_DURATION_MS) {
            // Pixel is permanent — skip
            return;
          }
          // We own it and it's within the ownership window — allow
        }
      }

      setPendingPixels((prev) => {
        // Deduplicate
        if (prev.some((p) => p.x === px && p.y === py)) return prev;
        return [...prev, { x: px, y: py, color: colorHex }];
      });
    },
    [mode, accountId, colorHex, regionDataRef]
  );

  const submitPixels = useCallback(async () => {
    if (pendingPixels.length === 0 || isSending) return;
    setIsSending(true);
    try {
      await callDraw(pendingPixels);
      setPendingPixels([]);
    } catch (e) {
      console.error("Failed to submit pixels:", e);
    } finally {
      setIsSending(false);
    }
  }, [pendingPixels, isSending, callDraw]);

  const clearPending = useCallback(() => {
    setPendingPixels([]);
  }, []);

  return {
    mode,
    setMode,
    color,
    setColor,
    pendingPixels,
    isSending,
    startDrawing,
    stopDrawing,
    addPixel,
    submitPixels,
    clearPending,
    handleDrawEvent,
  };
}
