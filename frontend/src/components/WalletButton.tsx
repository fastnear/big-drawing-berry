import { useState, useRef, useEffect } from "react";

interface Props {
  accountId: string | null;
  loading: boolean;
  onSignIn: () => void;
  onSignOut: () => void;
}

export default function WalletButton({
  accountId,
  loading,
  onSignIn,
  onSignOut,
}: Props) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // Close dropdown on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  if (loading) {
    return (
      <div style={styles.container}>
        <div style={styles.button}>...</div>
      </div>
    );
  }

  if (accountId) {
    const initial = accountId[0].toUpperCase();
    return (
      <div style={styles.container} ref={containerRef}>
        <button
          style={styles.button}
          onClick={() => setOpen((v) => !v)}
          title={`Signed in as ${accountId}`}
        >
          {initial}
        </button>
        {open && (
          <div style={styles.dropdown}>
            <div style={styles.accountId}>{accountId}</div>
            <button
              style={styles.signOutButton}
              onClick={() => {
                setOpen(false);
                onSignOut();
              }}
            >
              Sign out
            </button>
          </div>
        )}
      </div>
    );
  }

  return (
    <div style={styles.container}>
      <button style={styles.signInButton} onClick={onSignIn}>
        Connect
      </button>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    position: "absolute",
    top: 16,
    right: 16,
    zIndex: 100,
  },
  button: {
    width: 48,
    height: 48,
    borderRadius: "50%",
    border: "2px solid rgba(255,255,255,0.3)",
    background: "rgba(30,30,30,0.9)",
    color: "#fff",
    fontSize: 20,
    fontWeight: "bold",
    cursor: "pointer",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    boxShadow: "0 2px 8px rgba(0,0,0,0.5)",
  },
  signInButton: {
    padding: "10px 20px",
    borderRadius: 24,
    border: "2px solid rgba(255,255,255,0.3)",
    background: "rgba(30,30,30,0.9)",
    color: "#fff",
    fontSize: 14,
    fontWeight: "bold",
    cursor: "pointer",
    boxShadow: "0 2px 8px rgba(0,0,0,0.5)",
  },
  dropdown: {
    position: "absolute",
    top: 56,
    right: 0,
    background: "rgba(30,30,30,0.95)",
    borderRadius: 10,
    border: "1px solid rgba(255,255,255,0.15)",
    boxShadow: "0 4px 16px rgba(0,0,0,0.5)",
    padding: 12,
    minWidth: 180,
    display: "flex",
    flexDirection: "column",
    gap: 10,
  },
  accountId: {
    color: "#ccc",
    fontSize: 13,
    wordBreak: "break-all",
    lineHeight: 1.4,
  },
  signOutButton: {
    padding: "6px 12px",
    borderRadius: 8,
    border: "1px solid rgba(255,255,255,0.2)",
    background: "transparent",
    color: "#ff6b6b",
    fontSize: 13,
    cursor: "pointer",
    textAlign: "left" as const,
  },
};
