import { useState, useCallback, useRef, useEffect } from "react";
import { useCamera } from "./hooks/useCamera";
import { useWallet } from "./hooks/useWallet";
import { useBoard } from "./hooks/useBoard";
import { useDrawing } from "./hooks/useDrawing";
import Board from "./components/Board";
import WalletButton from "./components/WalletButton";
import Toolbar from "./components/Toolbar";
import Minimap from "./components/Minimap";
import ZoomControls from "./components/ZoomControls";
import { REGION_SIZE, PIXEL_SIZE } from "./lib/constants";
import { resolveOwnerSync, resolveOwner } from "./lib/owner-cache";
import type { DrawEventWS } from "./lib/types";

export default function App() {
  const { camera, setCamera, pan, zoomAt, zoomIn, zoomOut } = useCamera();
  const { accountId, loading, signIn, signOut, callDraw } = useWallet();
  const [canvasSize, setCanvasSize] = useState({ w: 0, h: 0 });
  const [cursorCoords, setCursorCoords] = useState<{ x: number; y: number } | null>(null);
  const [hoveredAccount, setHoveredAccount] = useState<string | null>(null);
  const [drawBlocked, setDrawBlocked] = useState(false);

  // Use a ref-based callback so useBoard can call handleDrawEvent without circular deps
  const drawEventCallbackRef = useRef<((event: DrawEventWS) => void) | null>(null);
  const onDrawEvent = useCallback((event: DrawEventWS) => {
    drawEventCallbackRef.current?.(event);
  }, []);

  const pixelTimestampsRef = useRef<Map<string, number>>(new Map());
  const { regionImages, regionDataRef, openRegionsRef } = useBoard(camera, canvasSize.w, canvasSize.h, onDrawEvent, pixelTimestampsRef);

  const {
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
    canDrawAt,
  } = useDrawing(callDraw, accountId, regionDataRef, openRegionsRef, pixelTimestampsRef);

  // Wire the callback ref to the actual handler
  useEffect(() => {
    drawEventCallbackRef.current = handleDrawEvent;
  }, [handleDrawEvent]);

  const handleCanvasSize = useCallback((w: number, h: number) => {
    setCanvasSize({ w, h });
  }, []);

  const handleCursorMove = useCallback((worldX: number, worldY: number) => {
    setCursorCoords({ x: Math.floor(worldX), y: Math.floor(worldY) });
    setDrawBlocked(!canDrawAt(worldX, worldY));
  }, [canDrawAt]);

  const handleMinimapNavigate = useCallback((worldX: number, worldY: number) => {
    setCamera((c) => ({ ...c, x: worldX, y: worldY }));
  }, [setCamera]);

  // Resolve hovered pixel's owner_id to account name
  useEffect(() => {
    if (!cursorCoords) {
      setHoveredAccount(null);
      return;
    }
    const { x, y } = cursorCoords;
    const rx = Math.floor(x / REGION_SIZE);
    const ry = Math.floor(y / REGION_SIZE);
    const blob = regionDataRef.current?.get(`${rx}:${ry}`);
    if (!blob) {
      setHoveredAccount(null);
      return;
    }
    const lx = ((x % REGION_SIZE) + REGION_SIZE) % REGION_SIZE;
    const ly = ((y % REGION_SIZE) + REGION_SIZE) % REGION_SIZE;
    const offset = (ly * REGION_SIZE + lx) * PIXEL_SIZE;
    const view = new Uint8Array(blob);
    const ownerId = view[offset + 3] | (view[offset + 4] << 8) | (view[offset + 5] << 16);
    if (ownerId === 0) {
      setHoveredAccount(null);
      return;
    }
    // Try sync cache first
    const cached = resolveOwnerSync(ownerId);
    if (cached !== undefined) {
      setHoveredAccount(cached);
      return;
    }
    // Async fetch
    let cancelled = false;
    resolveOwner(ownerId).then((account) => {
      if (!cancelled) setHoveredAccount(account);
    });
    return () => { cancelled = true; };
  }, [cursorCoords, regionDataRef]);

  return (
    <>
      <Board
        camera={camera}
        regionImages={regionImages}
        mode={mode}
        pendingPixels={pendingPixels}
        regionDataRef={regionDataRef}
        openRegionsRef={openRegionsRef}
        onPan={pan}
        onZoomAt={zoomAt}
        onStartDrawing={startDrawing}
        onStopDrawing={stopDrawing}
        onAddPixel={addPixel}
        onPickColor={setColor}
        onCanvasSize={handleCanvasSize}
        fillMode={fillMode}
        onFillAtPoint={fillAtPoint}
        onCursorMove={handleCursorMove}
        drawBlocked={drawBlocked}
      />

      <WalletButton
        accountId={accountId}
        loading={loading}
        onSignIn={signIn}
        onSignOut={signOut}
      />

      <Toolbar
        mode={mode}
        color={color}
        pendingPixels={pendingPixels}
        isSending={isSending}
        accountId={accountId}
        onSetMode={setMode}
        onSetColor={setColor}
        onSubmit={submitPixels}
        onClear={clearPending}
        onUndo={undo}
        onRedo={redo}
        canUndo={canUndo}
        canRedo={canRedo}
        fillMode={fillMode}
        onSetFillMode={setFillMode}
        autoSubmit={autoSubmit}
        onSetAutoSubmit={setAutoSubmit}
        unsubmittedPixelCount={unsubmittedPixelCount}
      />

      <Minimap
        camera={camera}
        regionImages={regionImages}
        pendingPixels={pendingPixels}
        canvasWidth={canvasSize.w}
        canvasHeight={canvasSize.h}
        openRegionsRef={openRegionsRef}
        onNavigate={handleMinimapNavigate}
        onCursorMove={handleCursorMove}
      />

      <ZoomControls onZoomIn={zoomIn} onZoomOut={zoomOut} />

      {cursorCoords && (
        <div
          style={{
            position: "absolute",
            top: 16,
            left: 16,
            zIndex: 100,
            background: "rgba(0, 0, 0, 0.5)",
            color: "#fff",
            padding: "4px 8px",
            borderRadius: 6,
            fontSize: 13,
            fontFamily: "monospace",
            pointerEvents: "none",
            userSelect: "none",
          }}
        >
          {cursorCoords.x}, {cursorCoords.y}
          {hoveredAccount && (
            <div style={{ color: "#aaa", fontSize: 11 }}>{hoveredAccount}</div>
          )}
        </div>
      )}

      {fillError && (
        <div
          style={{
            position: "absolute",
            top: 24,
            left: "50%",
            transform: "translateX(-50%)",
            zIndex: 200,
            background: "rgba(200, 40, 40, 0.9)",
            color: "#fff",
            padding: "8px 20px",
            borderRadius: 8,
            fontSize: 14,
            boxShadow: "0 2px 12px rgba(0,0,0,0.4)",
          }}
        >
          {fillError}
        </div>
      )}
    </>
  );
}
