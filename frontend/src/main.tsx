import { Buffer } from "buffer";
globalThis.Buffer = Buffer;

import { createRoot } from "react-dom/client";
import { WalletSelectorProvider } from "@near-wallet-selector/react-hook";
import { setupMyNearWallet } from "@near-wallet-selector/my-near-wallet";
import { setupMeteorWallet } from "@near-wallet-selector/meteor-wallet";
import { setupHotWallet } from "@near-wallet-selector/hot-wallet";
import "@near-wallet-selector/modal-ui/styles.css";
import App from "./App";
import { CONTRACT_ID } from "./lib/constants";
import {setupIntearWallet} from "@near-wallet-selector/intear-wallet";

createRoot(document.getElementById("root")!).render(
  <WalletSelectorProvider
    config={{
      network: "mainnet",
      createAccessKeyFor: CONTRACT_ID,
      modules: [
        setupMeteorWallet(),
        setupIntearWallet(),
        setupMyNearWallet(),
        setupHotWallet(),
      ],
    }}
  >
    <App />
  </WalletSelectorProvider>
);
