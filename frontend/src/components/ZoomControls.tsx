interface Props {
  onZoomIn: () => void;
  onZoomOut: () => void;
}

export default function ZoomControls({ onZoomIn, onZoomOut }: Props) {
  return (
    <div style={styles.container}>
      <button style={styles.button} onClick={onZoomIn} title="Zoom in">
        +
      </button>
      <button style={styles.button} onClick={onZoomOut} title="Zoom out">
        -
      </button>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    position: "absolute",
    bottom: 24,
    right: 16,
    zIndex: 100,
    display: "flex",
    flexDirection: "column",
    gap: 4,
  },
  button: {
    width: 40,
    height: 40,
    borderRadius: 8,
    border: "1px solid rgba(255,255,255,0.2)",
    background: "rgba(30,30,30,0.9)",
    color: "#fff",
    fontSize: 22,
    fontWeight: "bold",
    cursor: "pointer",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    boxShadow: "0 2px 8px rgba(0,0,0,0.5)",
  },
};
