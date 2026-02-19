import { useState, useEffect, useCallback, useRef } from "react";
import { NearConnector } from "@hot-labs/near-connect";
import { CONTRACT_ID } from "../lib/constants";

export function useWallet() {
  const connectorRef = useRef<NearConnector | null>(null);
  const [accountId, setAccountId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const connector = new NearConnector({ network: "mainnet" });
    connectorRef.current = connector;

    connector.on("wallet:signIn", ({ accounts }) => {
      setAccountId(accounts[0]?.accountId ?? null);
    });

    connector.on("wallet:signOut", () => {
      setAccountId(null);
    });

    // Restore previous session
    connector.getConnectedWallet().then(({ accounts }) => {
      setAccountId(accounts[0]?.accountId ?? null);
    }).catch(() => {
      // No previous session
    }).finally(() => {
      setLoading(false);
    });

    return () => {
      connector.removeAllListeners();
    };
  }, []);

  const signIn = useCallback(async () => {
    const connector = connectorRef.current;
    if (!connector) return;
    try {
      await connector.connect();
    } catch {
      // User cancelled or wallet error
    }
  }, []);

  const signOut = useCallback(async () => {
    const connector = connectorRef.current;
    if (!connector) return;
    try {
      await connector.disconnect();
    } catch {
      // Ignore errors
    }
    setAccountId(null);
  }, []);

  const callDraw = useCallback(
    async (pixels: Array<{ x: number; y: number; color: string }>) => {
      const connector = connectorRef.current;
      if (!connector) return;
      const wallet = await connector.wallet();
      await wallet.signAndSendTransaction({
        receiverId: CONTRACT_ID,
        actions: [
          {
            type: "FunctionCall",
            params: {
              methodName: "draw",
              args: { pixels },
              gas: "30000000000000",
              deposit: "0",
            },
          },
        ],
      });
    },
    []
  );

  return { accountId, loading, signIn, signOut, callDraw };
}
