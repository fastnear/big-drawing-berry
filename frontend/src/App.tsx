import { useState, useCallback } from "react";
import { useCamera } from "./hooks/useCamera";
import { useWallet } from "./hooks/useWallet";
import { useBoard } from "./hooks/useBoard";
import { useDrawing } from "./hooks/useDrawing";
import Board from "./components/Board";
import WalletButton from "./components/WalletButton";
import Toolbar from "./components/Toolbar";
import Minimap from "./components/Minimap";
import ZoomControls from "./components/ZoomControls";

export default function App() {
  const { camera, pan, zoomAt, zoomIn, zoomOut } = useCamera();
  const { accountId, loading, signIn, signOut, callDraw } = useWallet();
  const [canvasSize, setCanvasSize] = useState({ w: 0, h: 0 });

  const regionImages = useBoard(camera, canvasSize.w, canvasSize.h);

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
  } = useDrawing(callDraw, accountId);

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
        onPan={pan}
        onZoomAt={zoomAt}
        onStartDrawing={startDrawing}
        onStopDrawing={stopDrawing}
        onAddPixel={addPixel}
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
