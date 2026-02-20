import { useState, useCallback, useRef, useEffect } from "react";
import { REGION_SIZE, PIXEL_SIZE } from "../lib/constants";
import type { DrawEventWS } from "../lib/types";

export type Mode = "move" | "draw";

type Pixel = { x: number; y: number; color: string };
type Stroke = Pixel[];

/** One hour in milliseconds (for client-side ownership hint). */
const OWNERSHIP_DURATION_MS = 3_600_000;

/** Maximum pixels a single flood fill can produce. */
const FILL_LIMIT = 420;

/** Sentinel for undrawn (unowned) pixels — distinct from drawn black "000000". */
const UNDRAWN = "UNDRAWN";

/** Derive a hex color from a string, with constrained brightness. */
function colorFromAccount(accountId: string): string {
  let hash = 0;
  for (let i = 0; i < accountId.length; i++) {
    hash = ((hash << 5) - hash + accountId.charCodeAt(i)) | 0;
  }
  const hue = ((hash >>> 0) % 360);
  const sat = 60 + ((hash >>> 8) % 25);     // 60-84%
  const light = 45 + ((hash >>> 16) % 20);   // 45-64%

  // HSL → hex
  const s = sat / 100, l = light / 100;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => {
    const k = (n + hue / 30) % 12;
    const c = l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
    return Math.round(255 * c).toString(16).padStart(2, "0");
  };
  return `#${f(0)}${f(8)}${f(4)}`;
}

/** Read the effective color for a pixel coordinate.
 *  Checks pending map first (last write wins), then falls back to region data.
 *  Returns UNDRAWN for unowned pixels, null if region data not loaded. */
function getPixelColor(
  px: number,
  py: number,
  pendingMap: Map<string, string>,
  regionData: Map<string, ArrayBuffer>
): string | null {
  const key = `${px},${py}`;
  const pending = pendingMap.get(key);
  if (pending) return pending;

  const rx = Math.floor(px / REGION_SIZE);
  const ry = Math.floor(py / REGION_SIZE);
  const blob = regionData.get(`${rx}:${ry}`);
  if (!blob) return null;

  const lx = ((px % REGION_SIZE) + REGION_SIZE) % REGION_SIZE;
  const ly = ((py % REGION_SIZE) + REGION_SIZE) % REGION_SIZE;
  const offset = (ly * REGION_SIZE + lx) * PIXEL_SIZE;
  const view = new Uint8Array(blob);

  const hasOwner =
    view[offset + 3] !== 0 || view[offset + 4] !== 0 || view[offset + 5] !== 0;
  if (!hasOwner) return UNDRAWN;

  const r = view[offset];
  const g = view[offset + 1];
  const b = view[offset + 2];
  return (
    r.toString(16).padStart(2, "0") +
    g.toString(16).padStart(2, "0") +
    b.toString(16).padStart(2, "0")
  ).toUpperCase();
}

/** Replay all strokes into a deduped pixel array (last write wins). */
function derivePixels(strokes: Stroke[], currentStroke: Stroke): Pixel[] {
  const map = new Map<string, Pixel>();
  for (const stroke of strokes) {
    for (const p of stroke) {
      map.set(`${p.x},${p.y}`, p);
    }
  }
  for (const p of currentStroke) {
    map.set(`${p.x},${p.y}`, p);
  }
  return Array.from(map.values());
}

export function useDrawing(
  callDraw: (pixels: Array<{ x: number; y: number; color: string }>) => Promise<void>,
  accountId: string | null,
  regionDataRef: React.RefObject<Map<string, ArrayBuffer>>,
  openRegionsRef: React.RefObject<Set<string>>
) {
  const [mode, setModeRaw] = useState<Mode>(() => {
    const saved = localStorage.getItem("draw_mode");
    return saved === "draw" ? "draw" : "move";
  });
  const setMode = useCallback((m: Mode) => {
    localStorage.setItem("draw_mode", m);
    setModeRaw(m);
  }, []);
  const [color, setColorRaw] = useState(() => {
    const saved = localStorage.getItem("draw_color");
    if (saved) return saved;
    return accountId ? colorFromAccount(accountId) : "#FF5733";
  });
  const setColor = useCallback((c: string) => {
    localStorage.setItem("draw_color", c);
    setColorRaw(c);
  }, []);
  const hasSetAccountColor = useRef(false);

  useEffect(() => {
    if (accountId && !hasSetAccountColor.current) {
      hasSetAccountColor.current = true;
      if (!localStorage.getItem("draw_color")) {
        setColor(colorFromAccount(accountId));
      }
    }
  }, [accountId, setColor]);
  const [fillMode, setFillMode] = useState(false);
  const [fillError, setFillError] = useState<string | null>(null);
  const fillErrorTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const [pendingPixels, setPendingPixels] = useState<Pixel[]>([]);
  const [isSending, setIsSending] = useState(false);
  const isDrawingRef = useRef(false);

  // Auto-submit state and refs
  const [autoSubmit, setAutoSubmitRaw] = useState(() => {
    const saved = localStorage.getItem("auto_submit");
    return saved !== null ? saved === "true" : true;
  });
  const setAutoSubmit = useCallback((v: boolean) => {
    localStorage.setItem("auto_submit", String(v));
    setAutoSubmitRaw(v);
  }, []);
  const autoSubmitRef = useRef(autoSubmit);
  const autoSubmitTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const isSendingRef = useRef(false);
  const needsResubmitRef = useRef(false);
  const pendingPixelsRef = useRef<Pixel[]>([]);
  const doSubmitRef = useRef<(() => Promise<void>) | undefined>(undefined);

  // Keep autoSubmit ref in sync
  useEffect(() => { autoSubmitRef.current = autoSubmit; }, [autoSubmit]);

  // Stroke stacks
  const strokesRef = useRef<Stroke[]>([]);
  const redoStackRef = useRef<Stroke[]>([]);
  const currentStrokeRef = useRef<Stroke>([]);

  // Pixels submitted to chain but not yet confirmed by WebSocket
  const submittedPixelsRef = useRef<Pixel[]>([]);

  // Track timestamps for all pixels seen via WS (client-side hint to avoid wasted transactions)
  const pixelTimestamps = useRef<Map<string, number>>(new Map());

  const colorHex = color.replace("#", "").toUpperCase();

  const recomputePending = useCallback(() => {
    const drawn = derivePixels(strokesRef.current, currentStrokeRef.current);
    // Merge submitted (awaiting WS confirmation) with current drawing
    const map = new Map<string, Pixel>();
    for (const p of submittedPixelsRef.current) {
      map.set(`${p.x},${p.y}`, p);
    }
    for (const p of drawn) {
      map.set(`${p.x},${p.y}`, p);
    }
    const pixels = Array.from(map.values());
    pendingPixelsRef.current = pixels;
    setPendingPixels(pixels);
  }, []);

  const scheduleAutoSubmit = useCallback(() => {
    if (!autoSubmitRef.current) return;
    clearTimeout(autoSubmitTimerRef.current);
    autoSubmitTimerRef.current = setTimeout(() => {
      if (strokesRef.current.length === 0) return;
      if (isSendingRef.current) {
        needsResubmitRef.current = true;
        return;
      }
      doSubmitRef.current?.();
    }, 250);
  }, []);

  const doSubmit = useCallback(async () => {
    const pixels = derivePixels(strokesRef.current, []);
    if (pixels.length === 0 || isSendingRef.current) return;

    // Snapshot submitted strokes (by reference) for undo detection
    const submittedStrokes = [...strokesRef.current];

    // Capture original on-chain colors for undo recovery
    const originals = new Map<string, string>();
    const regionData = regionDataRef.current;
    if (regionData) {
      for (const p of pixels) {
        const color = getPixelColor(p.x, p.y, new Map(), regionData);
        if (color !== null) {
          originals.set(`${p.x},${p.y}`, color === UNDRAWN ? "000000" : color);
        }
      }
    }

    isSendingRef.current = true;
    setIsSending(true);
    let success = false;
    try {
      await callDraw(pixels);
      success = true;
      submittedPixelsRef.current = [...submittedPixelsRef.current, ...pixels];

      // Detect strokes undone during in-flight TX
      const currentStrokeSet = new Set(strokesRef.current);
      const undoneStrokes = submittedStrokes.filter(s => !currentStrokeSet.has(s));

      // Remove submitted strokes, keep any added during TX
      const submittedSet = new Set(submittedStrokes);
      strokesRef.current = strokesRef.current.filter(s => !submittedSet.has(s));
      redoStackRef.current = [];

      // Create recovery stroke for undone pixels
      if (undoneStrokes.length > 0 && originals.size > 0) {
        const remainingPixelKeys = new Set(
          derivePixels(strokesRef.current, currentStrokeRef.current)
            .map(p => `${p.x},${p.y}`)
        );
        const recoveryMap = new Map<string, Pixel>();
        for (const stroke of undoneStrokes) {
          for (const p of stroke) {
            const key = `${p.x},${p.y}`;
            if (remainingPixelKeys.has(key)) continue;
            const originalColor = originals.get(key);
            if (originalColor) {
              recoveryMap.set(key, { x: p.x, y: p.y, color: originalColor });
            }
          }
        }
        const recoveryStroke = Array.from(recoveryMap.values());
        if (recoveryStroke.length > 0) {
          strokesRef.current = [...strokesRef.current, recoveryStroke];
        }
      }

      recomputePending();
    } catch (e) {
      console.error("Failed to submit pixels:", e);
    } finally {
      isSendingRef.current = false;
      setIsSending(false);
      if (needsResubmitRef.current || (success && strokesRef.current.length > 0)) {
        needsResubmitRef.current = false;
        scheduleAutoSubmit();
      }
    }
  }, [callDraw, recomputePending, scheduleAutoSubmit]);
  doSubmitRef.current = doSubmit;

  const startDrawing = useCallback(() => {
    if (mode !== "draw" || !accountId) return;
    isDrawingRef.current = true;
    currentStrokeRef.current = [];
  }, [mode, accountId]);

  const stopDrawing = useCallback(() => {
    isDrawingRef.current = false;
    if (currentStrokeRef.current.length > 0) {
      strokesRef.current = [...strokesRef.current, currentStrokeRef.current];
      redoStackRef.current = [];
      currentStrokeRef.current = [];
      recomputePending();
      scheduleAutoSubmit();
    }
  }, [recomputePending, scheduleAutoSubmit]);

  /** Called from useBoard when a WebSocket draw event arrives. */
  const handleDrawEvent = useCallback(
    (event: DrawEventWS) => {
      const now = Date.now();
      // Track timestamps for ALL pixels (any signer)
      for (const pixel of event.pixels) {
        pixelTimestamps.current.set(`${pixel.x},${pixel.y}`, now);
      }
      // Only clear submitted buffer for our own events
      if (accountId && event.signer === accountId && submittedPixelsRef.current.length > 0) {
        const confirmed = new Set(event.pixels.map(p => `${p.x},${p.y}`));
        submittedPixelsRef.current = submittedPixelsRef.current.filter(
          (p) => !confirmed.has(`${p.x},${p.y}`)
        );
        recomputePending();
      }
    },
    [accountId, recomputePending]
  );

  const addPixel = useCallback(
    (worldX: number, worldY: number) => {
      if (!isDrawingRef.current || mode !== "draw" || !accountId) return;

      const px = Math.floor(worldX);
      const py = Math.floor(worldY);

      // Block drawing in locked regions
      const rx = Math.floor(px / REGION_SIZE);
      const ry = Math.floor(py / REGION_SIZE);
      const key = `${rx}:${ry}`;
      if (openRegionsRef.current && !openRegionsRef.current.has(key)) return;

      // Client-side ownership hint: check if pixel is drawable
      const blob = regionDataRef.current?.get(key);
      if (blob) {
        const lx = ((px % REGION_SIZE) + REGION_SIZE) % REGION_SIZE;
        const ly = ((py % REGION_SIZE) + REGION_SIZE) % REGION_SIZE;
        const offset = (ly * REGION_SIZE + lx) * PIXEL_SIZE;
        const view = new Uint8Array(blob);
        const hasOwner =
          view[offset + 3] !== 0 || view[offset + 4] !== 0 || view[offset + 5] !== 0;

        if (hasOwner) {
          const coordKey = `${px},${py}`;
          const ts = pixelTimestamps.current.get(coordKey);
          if (ts) {
            const ageMs = Date.now() - ts;
            if (ageMs >= OWNERSHIP_DURATION_MS) {
              // Pixel is permanent — skip
              return;
            }
          }
          // Allow — either we know it's recent, or we don't know (optimistic)
        }
      }

      // Add to current stroke (recolor if same pixel already in this stroke)
      const stroke = currentStrokeRef.current;
      const idx = stroke.findIndex((p) => p.x === px && p.y === py);
      if (idx !== -1) {
        if (stroke[idx].color === colorHex) return;
        stroke[idx] = { x: px, y: py, color: colorHex };
      } else {
        stroke.push({ x: px, y: py, color: colorHex });
      }

      recomputePending();
    },
    [mode, accountId, colorHex, regionDataRef, openRegionsRef, recomputePending]
  );

  const fillAtPoint = useCallback(
    (worldX: number, worldY: number) => {
      if (mode !== "draw" || !accountId) return;
      const regionData = regionDataRef.current;
      if (!regionData) return;

      const px = Math.floor(worldX);
      const py = Math.floor(worldY);

      // Block fill in locked regions
      const fillRx = Math.floor(px / REGION_SIZE);
      const fillRy = Math.floor(py / REGION_SIZE);
      if (openRegionsRef.current && !openRegionsRef.current.has(`${fillRx}:${fillRy}`)) return;

      // Build a pending pixel map (last write wins)
      const pendingMap = new Map<string, string>();
      for (const p of derivePixels(strokesRef.current, currentStrokeRef.current)) {
        pendingMap.set(`${p.x},${p.y}`, p.color);
      }

      const targetColor = getPixelColor(px, py, pendingMap, regionData);
      if (targetColor === null) return;
      if (targetColor === colorHex) return;

      const filled: Pixel[] = [];
      const visited = new Set<string>();
      const queue: Array<[number, number]> = [[px, py]];
      visited.add(`${px},${py}`);

      while (queue.length > 0 && filled.length < FILL_LIMIT) {
        const [cx, cy] = queue.shift()!;
        filled.push({ x: cx, y: cy, color: colorHex });

        for (const [nx, ny] of [
          [cx - 1, cy],
          [cx + 1, cy],
          [cx, cy - 1],
          [cx, cy + 1],
        ] as const) {
          const nk = `${nx},${ny}`;
          if (visited.has(nk)) continue;
          visited.add(nk);
          // Don't fill into locked regions
          const nrx = Math.floor(nx / REGION_SIZE);
          const nry = Math.floor(ny / REGION_SIZE);
          if (openRegionsRef.current && !openRegionsRef.current.has(`${nrx}:${nry}`)) continue;
          const nc = getPixelColor(nx, ny, pendingMap, regionData);
          if (nc === targetColor) {
            queue.push([nx, ny]);
          }
        }
      }

      // If BFS didn't finish (hit the limit), discard — area too large
      if (queue.length > 0) {
        clearTimeout(fillErrorTimer.current);
        setFillError(`Area too large to fill (>${FILL_LIMIT.toLocaleString()} pixels)`);
        fillErrorTimer.current = setTimeout(() => setFillError(null), 3000);
        setFillMode(false);
        return;
      }
      if (filled.length === 0) return;

      strokesRef.current = [...strokesRef.current, filled];
      redoStackRef.current = [];
      recomputePending();
      scheduleAutoSubmit();
      setFillMode(false);
    },
    [mode, accountId, colorHex, regionDataRef, openRegionsRef, recomputePending, scheduleAutoSubmit]
  );

  const undo = useCallback(() => {
    if (strokesRef.current.length === 0) return;
    const last = strokesRef.current[strokesRef.current.length - 1];
    strokesRef.current = strokesRef.current.slice(0, -1);
    redoStackRef.current = [...redoStackRef.current, last];
    recomputePending();
  }, [recomputePending]);

  const redo = useCallback(() => {
    if (redoStackRef.current.length === 0) return;
    const last = redoStackRef.current[redoStackRef.current.length - 1];
    redoStackRef.current = redoStackRef.current.slice(0, -1);
    strokesRef.current = [...strokesRef.current, last];
    recomputePending();
  }, [recomputePending]);

  const canUndo = strokesRef.current.length > 0;
  const canRedo = redoStackRef.current.length > 0;
  const unsubmittedPixelCount = derivePixels(strokesRef.current, currentStrokeRef.current).length;

  const submitPixels = doSubmit;

  const clearPending = useCallback(() => {
    clearTimeout(autoSubmitTimerRef.current);
    needsResubmitRef.current = false;
    strokesRef.current = [];
    redoStackRef.current = [];
    currentStrokeRef.current = [];
    submittedPixelsRef.current = [];
    pendingPixelsRef.current = [];
    setPendingPixels([]);
  }, []);

  // When autoSubmit is toggled on, schedule if there are pending strokes
  useEffect(() => {
    if (autoSubmit && strokesRef.current.length > 0) {
      scheduleAutoSubmit();
    }
  }, [autoSubmit, scheduleAutoSubmit]);

  // Keyboard shortcuts for undo/redo (only in draw mode)
  useEffect(() => {
    if (mode !== "draw") return;
    const handler = (e: KeyboardEvent) => {
      const ctrl = e.ctrlKey || e.metaKey;
      if (ctrl) {
        if (e.key === "z" && !e.shiftKey) {
          e.preventDefault();
          undo();
        } else if ((e.key === "z" && e.shiftKey) || e.key === "y") {
          e.preventDefault();
          redo();
        }
        return;
      }
      if (e.key === "g" || e.key === "G") {
        e.preventDefault();
        setFillMode((prev) => !prev);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [mode, undo, redo]);

  return {
    mode,
    setMode,
    color,
    setColor,
    fillMode,
    setFillMode,
    fillError,
    pendingPixels,
    isSending,
    startDrawing,
    stopDrawing,
    addPixel,
    fillAtPoint,
    submitPixels,
    clearPending,
    handleDrawEvent,
    undo,
    redo,
    canUndo,
    canRedo,
    autoSubmit,
    setAutoSubmit,
    unsubmittedPixelCount,
  };
}
