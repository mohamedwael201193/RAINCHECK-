// Reown AppKit — the connect modal. Signing stays on the Arc path in
// sendTx / chain.ts (eth_signTransaction + our own RPC). The project id is
// public and comes from env only; it is never hardcoded.

import { createAppKit } from "@reown/appkit/react";
import { WagmiAdapter } from "@reown/appkit-adapter-wagmi";
import { http } from "viem";
import { QueryClient } from "@tanstack/react-query";
import { arc, RPC_URL } from "./chain";

function readProjectId(): string {
  const env = (import.meta as unknown as { env?: Record<string, unknown> }).env;
  const v = env?.["VITE_REOWN_PROJECT_ID"];
  return typeof v === "string" ? v.trim() : "";
}

export const REOWN_PROJECT_ID = readProjectId();
export const REOWN_ENABLED = REOWN_PROJECT_ID.length > 0;

export const queryClient = new QueryClient();

export const wagmiAdapter = REOWN_ENABLED
  ? new WagmiAdapter({
      networks: [arc],
      projectId: REOWN_PROJECT_ID,
      ssr: false,
      transports: { [arc.id]: http(RPC_URL) },
    })
  : null;

if (wagmiAdapter) {
  createAppKit({
    adapters: [wagmiAdapter],
    networks: [arc],
    projectId: REOWN_PROJECT_ID,
    metadata: {
      name: "RAINCHECK",
      description: "Delivery-attested receipts for agent commerce on Arc",
      url: typeof window !== "undefined" ? window.location.origin : "https://raincheck.app",
      icons: [],
    },
    allowUnsupportedChain: false,
    features: { analytics: false },
    themeMode: "dark",
  });
}
