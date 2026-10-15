import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { QueryClientProvider } from "@tanstack/react-query";
import { WagmiProvider, type Config as WagmiConfig } from "wagmi";
import { PrivyProvider } from "@privy-io/react-auth";
import App from "./App";
import { WalletProvider } from "./components/dashboard/WalletContext";
import "./index.css";
import { arc } from "./lib/chain";
import { PRIVY_ENABLED } from "./lib/privy";
import { queryClient, REOWN_ENABLED, wagmiAdapter } from "./lib/reown";

// Privy App ID is a PUBLIC identifier (NEXT_PUBLIC_/VITE_ by design) —
// never a secret. Never put private keys in env.
const PRIVY_APP_ID = (
  import.meta.env.VITE_PRIVY_APP_ID as string | undefined
)?.trim();

/**
 * Zero-friction local run: the app mounts with NO env vars set.
 * - VITE_PRIVY_APP_ID missing → PrivyProvider is skipped gracefully; the
 *   landing renders fully for a cold visitor. Wallet-dependent screens must
 *   degrade (connect button explains it's unavailable), never crash.
 * - VITE_PRIVY_APP_ID set → full wallet stack: injected (MetaMask/Rabby) +
 *   embedded (email/SMS) on Arc mainnet 5042 (bible §9.1).
 */
// NOTE: no BrowserRouter here — src/App.tsx owns the single <BrowserRouter>.
// Rendering a second Router inside App's would throw
// "You cannot render a <Router> inside another <Router>".
function Root() {
  // WalletProvider is the single wallet state for the app shell; it picks
  // the Privy road only when the PrivyProvider above is actually mounted.
  const app = (
    <WalletProvider>
      <App />
    </WalletProvider>
  );

  if (REOWN_ENABLED && wagmiAdapter) {
    const config = wagmiAdapter.wagmiConfig as unknown as WagmiConfig;
    return (
      <WagmiProvider config={config}>
        <QueryClientProvider client={queryClient}>{app}</QueryClientProvider>
      </WagmiProvider>
    );
  }

  if (!PRIVY_ENABLED) {
    if (import.meta.env.DEV) {
      console.warn(
        "[raincheck] VITE_PRIVY_APP_ID is not set — running without Privy. " +
          "Wallet connect is unavailable; everything else works.",
      );
    }
    return app;
  }

  return (
    <PrivyProvider
      appId={PRIVY_APP_ID ?? ""}
      config={{
        // Bible §9.1: wallet (injected: MetaMask, Rabby, Coinbase Wallet) + email/SMS embedded.
        loginMethods: ["wallet", "email", "sms"],
        supportedChains: [arc],
        defaultChain: arc,
      }}
    >
      {app}
    </PrivyProvider>
  );
}

const rootEl = document.getElementById("root");
if (!rootEl) {
  throw new Error("RAINCHECK: #root element missing from index.html");
}

createRoot(rootEl).render(
  <StrictMode>
    <Root />
  </StrictMode>,
);
