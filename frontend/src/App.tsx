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
import type { DrawEventWS } from "./lib/types";

export default function App() {
  const { camera, setCamera, pan, zoomAt, zoomIn, zoomOut } = useCamera();
  const { accountId, loading, signIn, signOut, callDraw } = useWallet();
  const [canvasSize, setCanvasSize] = useState({ w: 0, h: 0 });
  const [cursorCoords, setCursorCoords] = useState<{ x: number; y: number } | null>(null);

  // Use a ref-based callback so useBoard can call handleDrawEvent without circular deps
  const drawEventCallbackRef = useRef<((event: DrawEventWS) => void) | null>(null);
  const onDrawEvent = useCallback((event: DrawEventWS) => {
    drawEventCallbackRef.current?.(event);
  }, []);

  const { regionImages, regionDataRef, openRegionsRef } = useBoard(camera, canvasSize.w, canvasSize.h, onDrawEvent);

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
  } = useDrawing(callDraw, accountId, regionDataRef, openRegionsRef);

  // Wire the callback ref to the actual handler
  useEffect(() => {
    drawEventCallbackRef.current = handleDrawEvent;
  }, [handleDrawEvent]);

  const handleCanvasSize = useCallback((w: number, h: number) => {
    setCanvasSize({ w, h });
  }, []);

  const handleCursorMove = useCallback((worldX: number, worldY: number) => {
    setCursorCoords({ x: Math.floor(worldX), y: Math.floor(worldY) });
  }, []);

  const handleMinimapNavigate = useCallback((worldX: number, worldY: number) => {
    setCamera((c) => ({ ...c, x: worldX, y: worldY }));
  }, [setCamera]);

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
        pendingCount={pendingPixels.length}
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
      />

      <Minimap
        camera={camera}
        regionImages={regionImages}
        pendingPixels={pendingPixels}
        canvasWidth={canvasSize.w}
        canvasHeight={canvasSize.h}
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
