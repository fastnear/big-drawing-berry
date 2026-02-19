import { useState, useEffect, useCallback } from "react";
import { setupWalletSelector } from "@near-wallet-selector/core";
import type { WalletSelector, AccountState } from "@near-wallet-selector/core";
import { setupMyNearWallet } from "@near-wallet-selector/my-near-wallet";
import { setupHereWallet } from "@near-wallet-selector/here-wallet";
import { setupModal } from "@near-wallet-selector/modal-ui";
import type { WalletSelectorModal } from "@near-wallet-selector/modal-ui";
import "@near-wallet-selector/modal-ui/styles.css";
import { CONTRACT_ID, NETWORK_ID } from "../lib/constants";

export function useWallet() {
  const [selector, setSelector] = useState<WalletSelector | null>(null);
  const [modal, setModal] = useState<WalletSelectorModal | null>(null);
  const [accounts, setAccounts] = useState<AccountState[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      const walletSelector = await setupWalletSelector({
        network: NETWORK_ID,
        modules: [setupMyNearWallet(), setupHereWallet()],
      });

      if (cancelled) return;

      const walletModal = setupModal(walletSelector, {
        contractId: CONTRACT_ID,
      });

      const state = walletSelector.store.getState();
      setAccounts(state.accounts);

      walletSelector.store.observable.subscribe((state) => {
        setAccounts(state.accounts);
      });

      setSelector(walletSelector);
      setModal(walletModal);
      setLoading(false);
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  const accountId = accounts.find((a) => a.active)?.accountId ?? null;

  const signIn = useCallback(() => {
    modal?.show();
  }, [modal]);

  const signOut = useCallback(async () => {
    if (!selector) return;
    const wallet = await selector.wallet();
    await wallet.signOut();
  }, [selector]);

  const callDraw = useCallback(
    async (pixels: Array<{ x: number; y: number; color: string }>) => {
      if (!selector) return;
      const wallet = await selector.wallet();
      await wallet.signAndSendTransaction({
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
    [selector]
  );

  return { accountId, loading, signIn, signOut, callDraw };
}
