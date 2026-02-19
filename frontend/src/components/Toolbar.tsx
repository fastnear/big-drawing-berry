import type { Mode } from "../hooks/useDrawing";

interface Props {
  mode: Mode;
  color: string;
  pendingCount: number;
  isSending: boolean;
  accountId: string | null;
  onSetMode: (mode: Mode) => void;
  onSetColor: (color: string) => void;
  onSubmit: () => void;
  onClear: () => void;
  onUndo: () => void;
  onRedo: () => void;
  canUndo: boolean;
  canRedo: boolean;
}

export default function Toolbar({
  mode,
  color,
  pendingCount,
  isSending,
  accountId,
  onSetMode,
  onSetColor,
  onSubmit,
  onClear,
  onUndo,
  onRedo,
  canUndo,
  canRedo,
}: Props) {
  // Don't show drawing controls if not signed in or on mobile
  const isMobile =
    typeof window !== "undefined" && "ontouchstart" in window;
  if (!accountId || isMobile) return null;

  return (
    <div style={styles.container}>
      <div style={styles.modeToggle}>
        <button
          style={{
            ...styles.modeButton,
            ...(mode === "move" ? styles.modeActive : {}),
          }}
          onClick={() => onSetMode("move")}
          title="Move mode"
        >
          Move
        </button>
        <button
          style={{
            ...styles.modeButton,
            ...(mode === "draw" ? styles.modeActive : {}),
          }}
          onClick={() => onSetMode("draw")}
          title="Draw mode"
        >
          Draw
        </button>
      </div>

      {mode === "draw" && (
        <>
          <input
            type="color"
            value={color}
            onChange={(e) => onSetColor(e.target.value)}
            style={styles.colorPicker}
            title="Pick a color"
          />

          <div style={styles.undoRedoSection}>
            <button
              style={{
                ...styles.clearButton,
                ...(canUndo ? {} : styles.disabledButton),
              }}
              onClick={onUndo}
              disabled={!canUndo}
              title="Undo (Ctrl+Z)"
            >
              Undo
            </button>
            <button
              style={{
                ...styles.clearButton,
                ...(canRedo ? {} : styles.disabledButton),
              }}
              onClick={onRedo}
              disabled={!canRedo}
              title="Redo (Ctrl+Shift+Z)"
            >
              Redo
            </button>
          </div>

          {pendingCount > 0 && (
            <div style={styles.pendingSection}>
              <span style={styles.pendingCount}>{pendingCount}px</span>
              <button
                style={styles.submitButton}
                onClick={onSubmit}
                disabled={isSending}
              >
                {isSending ? "Sending..." : "Submit"}
              </button>
              <button style={styles.clearButton} onClick={onClear}>
                Clear
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    position: "absolute",
    bottom: 24,
    left: "50%",
    transform: "translateX(-50%)",
    zIndex: 100,
    display: "flex",
    alignItems: "center",
    gap: 12,
    background: "rgba(30,30,30,0.9)",
    borderRadius: 12,
    padding: "8px 16px",
    boxShadow: "0 2px 12px rgba(0,0,0,0.5)",
  },
  modeToggle: {
    display: "flex",
    gap: 4,
  },
  modeButton: {
    padding: "6px 14px",
    borderRadius: 8,
    border: "1px solid rgba(255,255,255,0.2)",
    background: "transparent",
    color: "#aaa",
    fontSize: 13,
    cursor: "pointer",
  },
  modeActive: {
    background: "rgba(255,255,255,0.15)",
    color: "#fff",
    borderColor: "rgba(255,255,255,0.4)",
  },
  colorPicker: {
    width: 36,
    height: 36,
    border: "none",
    borderRadius: 8,
    cursor: "pointer",
    background: "transparent",
    padding: 0,
  },
  pendingSection: {
    display: "flex",
    alignItems: "center",
    gap: 8,
  },
  pendingCount: {
    color: "#aaa",
    fontSize: 13,
  },
  submitButton: {
    padding: "6px 14px",
    borderRadius: 8,
    border: "none",
    background: "#4CAF50",
    color: "#fff",
    fontSize: 13,
    cursor: "pointer",
    fontWeight: "bold",
  },
  clearButton: {
    padding: "6px 10px",
    borderRadius: 8,
    border: "1px solid rgba(255,255,255,0.2)",
    background: "transparent",
    color: "#aaa",
    fontSize: 13,
    cursor: "pointer",
  },
  undoRedoSection: {
    display: "flex",
    gap: 4,
  },
  disabledButton: {
    opacity: 0.35,
    cursor: "default",
  },
};
