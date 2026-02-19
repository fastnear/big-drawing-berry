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
  if (loading) {
    return (
      <div style={styles.container}>
        <div style={styles.button}>...</div>
      </div>
    );
  }

  if (accountId) {
    // Show first letter of account in a circle
    const initial = accountId[0].toUpperCase();
    return (
      <div style={styles.container}>
        <button
          style={styles.button}
          onClick={onSignOut}
          title={`Signed in as ${accountId}. Click to sign out.`}
        >
          {initial}
        </button>
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
};
