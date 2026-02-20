import { useState, useEffect, useRef } from "react";
import type { Mode } from "../hooks/useDrawing";

const MAX_RECENT = 12;

interface Props {
  mode: Mode;
  color: string;
  pendingPixels: Array<{ x: number; y: number; color: string }>;
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
  fillMode: boolean;
  onSetFillMode: (fill: boolean) => void;
}

export default function Toolbar({
  mode,
  color,
  pendingPixels,
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
  fillMode,
  onSetFillMode,
}: Props) {
  const [recentColors, setRecentColors] = useState<string[]>([]);
  const knownColors = useRef(new Set<string>());

  // Track colors as they appear in pending pixels (drawn or submitted)
  useEffect(() => {
    const newColors: string[] = [];
    for (const p of pendingPixels) {
      const c = "#" + p.color;
      if (!knownColors.current.has(c)) {
        knownColors.current.add(c);
        newColors.push(c);
      }
    }
    if (newColors.length > 0) {
      setRecentColors((prev) => {
        const filtered = prev.filter((c) => !newColors.includes(c));
        return [...newColors, ...filtered].slice(0, MAX_RECENT);
      });
    }
  }, [pendingPixels]);

  // Don't show drawing controls if not signed in or on mobile
  const isMobile =
    typeof window !== "undefined" && "ontouchstart" in window;
  if (!accountId || isMobile) return null;

  return (
    <div style={styles.wrapper}>
    {mode === "draw" && recentColors.length > 0 && (
      <div style={styles.recentRow}>
        {recentColors.map((c) => (
          <button
            key={c}
            style={{
              ...styles.swatch,
              background: c,
              ...(c.toUpperCase() === color.toUpperCase() ? styles.swatchActive : {}),
            }}
            onClick={() => onSetColor(c)}
            title={c}
          />
        ))}
      </div>
    )}
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

          <button
            style={{
              ...styles.clearButton,
              ...(fillMode ? styles.modeActive : {}),
            }}
            onClick={() => onSetFillMode(!fillMode)}
            title="Fill mode (bucket)"
          >
            Fill
          </button>

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

          {pendingPixels.length > 0 && (
            <div style={styles.pendingSection}>
              <span style={styles.pendingCount}>{pendingPixels.length}px</span>
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

    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  wrapper: {
    position: "absolute",
    bottom: 24,
    left: "50%",
    transform: "translateX(-50%)",
    zIndex: 100,
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: 6,
  },
  container: {
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
    border: "1px solid rgba(255,255,255,0.4)",
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
  recentRow: {
    display: "flex",
    gap: 4,
    background: "rgba(30,30,30,0.9)",
    borderRadius: 8,
    padding: "4px 8px",
    boxShadow: "0 2px 12px rgba(0,0,0,0.5)",
  },
  swatch: {
    width: 22,
    height: 22,
    borderRadius: 4,
    border: "2px solid transparent",
    cursor: "pointer",
    padding: 0,
  },
  swatchActive: {
    border: "2px solid #fff",
  },
};
