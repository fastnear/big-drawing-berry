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
  const { camera, pan, zoomAt, zoomIn, zoomOut } = useCamera();
  const { accountId, loading, signIn, signOut, callDraw } = useWallet();
  const [canvasSize, setCanvasSize] = useState({ w: 0, h: 0 });

  // Use a ref-based callback so useBoard can call handleDrawEvent without circular deps
  const drawEventCallbackRef = useRef<((event: DrawEventWS) => void) | null>(null);
  const onDrawEvent = useCallback((event: DrawEventWS) => {
    drawEventCallbackRef.current?.(event);
  }, []);

  const { regionImages, regionDataRef } = useBoard(camera, canvasSize.w, canvasSize.h, onDrawEvent);

  const {
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
    undo,
    redo,
    canUndo,
    canRedo,
  } = useDrawing(callDraw, accountId, regionDataRef);

  // Wire the callback ref to the actual handler
  useEffect(() => {
    drawEventCallbackRef.current = handleDrawEvent;
  }, [handleDrawEvent]);

  const handleCanvasSize = useCallback((w: number, h: number) => {
    setCanvasSize({ w, h });
  }, []);

  return (
    <>
      <Board
        camera={camera}
        regionImages={regionImages}
        mode={mode}
        pendingPixels={pendingPixels}
        regionDataRef={regionDataRef}
        onPan={pan}
        onZoomAt={zoomAt}
        onStartDrawing={startDrawing}
        onStopDrawing={stopDrawing}
        onAddPixel={addPixel}
        onPickColor={setColor}
        onCanvasSize={handleCanvasSize}
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
      />

      <Minimap
        camera={camera}
        regionImages={regionImages}
        canvasWidth={canvasSize.w}
        canvasHeight={canvasSize.h}
      />

      <ZoomControls onZoomIn={zoomIn} onZoomOut={zoomOut} />
    </>
  );
}
