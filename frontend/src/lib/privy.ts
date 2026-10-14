/**
 * Privy availability flag — the single switch for the Privy wallet path.
 *
 * Privy is mounted in src/main.tsx only when VITE_PRIVY_APP_ID is set to a
 * real (non-placeholder) value. When it isn't, the app runs the injected
 * wallet path (MetaMask / Rabby via window.ethereum) instead — wallet
 * connect is never a dead end, it just takes the other road.
 *
 * The App ID is a PUBLIC identifier by design — never a secret.
 */
function readAppId(): string {
  const env = (import.meta as unknown as { env?: Record<string, unknown> })
    .env;
  const v = env?.["VITE_PRIVY_APP_ID"];
  return typeof v === "string" ? v.trim() : "";
}

export const PRIVY_APP_ID = readAppId();

/** True when the PrivyProvider is mounted and usePrivy() is safe to call. */
export const PRIVY_ENABLED =
  PRIVY_APP_ID.length > 0 && PRIVY_APP_ID !== "your-privy-app-id-here";
