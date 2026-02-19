import { createRoot } from "react-dom/client";
import { WalletSelectorProvider } from "@near-wallet-selector/react-hook";
import { setupMyNearWallet } from "@near-wallet-selector/my-near-wallet";
import { setupMeteorWallet } from "@near-wallet-selector/meteor-wallet";
import { setupHereWallet } from "@near-wallet-selector/here-wallet";
import { setupHotWallet } from "@near-wallet-selector/hot-wallet";
import "@near-wallet-selector/modal-ui/styles.css";
import App from "./App";
import { CONTRACT_ID } from "./lib/constants";

createRoot(document.getElementById("root")!).render(
  <WalletSelectorProvider
    config={{
      network: "mainnet",
      createAccessKeyFor: CONTRACT_ID,
      modules: [
        setupMyNearWallet(),
        setupMeteorWallet(),
        setupHereWallet(),
        setupHotWallet(),
      ],
    }}
  >
    <App />
  </WalletSelectorProvider>
);
