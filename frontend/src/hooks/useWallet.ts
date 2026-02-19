import { useState, useEffect, useCallback, useRef } from "react";
import { NearConnector } from "@hot-labs/near-connect";
import { CONTRACT_ID } from "../lib/constants";

const ACCESS_KEY_STORAGE = "berry:hasAccessKey";

function hasStoredAccessKey(account: string): boolean {
  try {
    return localStorage.getItem(`${ACCESS_KEY_STORAGE}:${account}`) === "1";
  } catch {
    return false;
  }
}

function storeAccessKey(account: string) {
  try {
    localStorage.setItem(`${ACCESS_KEY_STORAGE}:${account}`, "1");
  } catch {
    // localStorage unavailable
  }
}

export function useWallet() {
  const connectorRef = useRef<NearConnector | null>(null);
  const [accountId, setAccountId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const hasAccessKeyRef = useRef(false);

  useEffect(() => {
    const connector = new NearConnector({
      network: "mainnet",
      signIn: { contractId: CONTRACT_ID, methodNames: ["draw"] },
      footerBranding: null,
    });
    connectorRef.current = connector;

    connector.on("wallet:signIn", ({ accounts }) => {
      const id = accounts[0]?.accountId ?? null;
      setAccountId(id);
      // If the wallet supported signIn with contract in the constructor,
      // the access key was added on connect — mark it as granted.
      if (id) {
        hasAccessKeyRef.current = true;
        storeAccessKey(id);
      }
    });

    connector.on("wallet:signOut", () => {
      setAccountId(null);
      hasAccessKeyRef.current = false;
    });

    // Restore previous session
    connector.getConnectedWallet().then(({ accounts }) => {
      const id = accounts[0]?.accountId ?? null;
      setAccountId(id);
      hasAccessKeyRef.current = id ? hasStoredAccessKey(id) : false;
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
    hasAccessKeyRef.current = false;
  }, []);

  const callDraw = useCallback(
    async (pixels: Array<{ x: number; y: number; color: string }>) => {
      const connector = connectorRef.current;
      if (!connector) return;
      const wallet = await connector.wallet();

      // Request a limited access key on the first draw
      if (!hasAccessKeyRef.current) {
        await wallet.signIn({
          contractId: CONTRACT_ID,
          methodNames: ["draw"],
        });
        hasAccessKeyRef.current = true;
        const accounts = await wallet.getAccounts();
        const id = accounts[0]?.accountId;
        if (id) storeAccessKey(id);
      }

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
