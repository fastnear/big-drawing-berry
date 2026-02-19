import { useState, useCallback, useRef } from "react";
import type { Camera } from "../lib/types";

export type Mode = "move" | "draw";

export function useDrawing(
  callDraw: (pixels: Array<{ x: number; y: number; color: string }>) => Promise<void>,
  accountId: string | null
) {
  const [mode, setMode] = useState<Mode>("move");
  const [color, setColor] = useState("#FF5733");
  const [pendingPixels, setPendingPixels] = useState<
    Array<{ x: number; y: number; color: string }>
  >([]);
  const [isSending, setIsSending] = useState(false);
  const isDrawingRef = useRef(false);

  const colorHex = color.replace("#", "").toUpperCase();

  const startDrawing = useCallback(() => {
    if (mode !== "draw" || !accountId) return;
    isDrawingRef.current = true;
  }, [mode, accountId]);

  const stopDrawing = useCallback(() => {
    isDrawingRef.current = false;
  }, []);

  const addPixel = useCallback(
    (worldX: number, worldY: number) => {
      if (!isDrawingRef.current || mode !== "draw" || !accountId) return;

      const px = Math.floor(worldX);
      const py = Math.floor(worldY);

      setPendingPixels((prev) => {
        // Deduplicate
        if (prev.some((p) => p.x === px && p.y === py)) return prev;
        return [...prev, { x: px, y: py, color: colorHex }];
      });
    },
    [mode, accountId, colorHex]
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
  };
}
