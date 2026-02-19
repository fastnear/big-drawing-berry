import { useCallback } from "react";
import { useWalletSelector } from "@near-wallet-selector/react-hook";
import { CONTRACT_ID } from "../lib/constants";

export function useWallet() {
  const {
    walletSelector,
    signedAccountId,
    signIn,
    signOut,
    callFunction,
  } = useWalletSelector();

  const callDraw = useCallback(
    async (pixels: Array<{ x: number; y: number; color: string }>) => {
      await callFunction({
        contractId: CONTRACT_ID,
        method: "draw",
        args: { pixels },
        gas: "30000000000000",
        deposit: "0",
      });
    },
    [callFunction]
  );

  return {
    accountId: signedAccountId,
    loading: !walletSelector,
    signIn,
    signOut,
    callDraw,
  };
}
