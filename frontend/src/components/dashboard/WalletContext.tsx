import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import type { ReactNode } from "react";
import { usePrivy, useWallets } from "@privy-io/react-auth";
import { useAppKit, useAppKitAccount, useAppKitProvider } from "@reown/appkit/react";
import { PRIVY_ENABLED } from "../../lib/privy";
import { REOWN_ENABLED } from "../../lib/reown";
import {
  connectWallet,
  getInjectedProvider,
  type EthereumProvider,
} from "../../lib/chain";

/**
 * The ONE wallet state for the whole app shell.
 *
 * Two roads, one context:
 *  - Privy enabled (VITE_PRIVY_APP_ID set) → Privy login modal, which itself
 *    offers injected wallets (MetaMask/Rabby) + embedded (email/SMS).
 *  - Otherwise → straight to the injected wallet via eth_requestAccounts.
 *
 * `canSign` tells pages whether the connected wallet can actually sign
 * through our tx path (window.ethereum). A Privy embedded wallet with no
 * injected provider connected can't — pages must disable signing buttons
 * with a plain-language reason instead of letting the click fail.
 */

export interface WalletState {
  address: `0x${string}` | null;
  /** Which road connected this session. */
  source: "privy" | "injected" | "reown" | null;
  /** EIP-1193 provider that will sign. Null until a wallet is connected. */
  provider: EthereumProvider | null;
  connecting: boolean;
  lastError: string | null;
  /** True when the connected wallet can sign via window.ethereum. */
  canSign: boolean;
  connect: () => Promise<void>;
  disconnect: () => void;
}

const WalletContext = createContext<WalletState | null>(null);

export function useWallet(): WalletState {
  const ctx = useContext(WalletContext);
  if (!ctx) {
    throw new Error("useWallet() must be used inside <WalletProvider>");
  }
  return ctx;
}

function shortAddr(a: string): string {
  return `${a.slice(0, 6)}…${a.slice(-4)}`;
}

/* ---------------- Privy road (only rendered under PrivyProvider) -------- */

function PrivyWalletProvider({ children }: { children: ReactNode }) {
  const { ready, authenticated, login, logout, user } = usePrivy();
  const { wallets } = useWallets();
  const [connecting, setConnecting] = useState(false);
  const [lastError, setLastError] = useState<string | null>(null);

  const address = useMemo(() => {
    const a =
      (user as { wallet?: { address?: string } } | null)?.wallet?.address ??
      wallets[0]?.address ??
      null;
    return a ? (a as `0x${string}`) : null;
  }, [user, wallets]);

  const connect = useCallback(async () => {
    setLastError(null);
    setConnecting(true);
    try {
      await login();
    } catch (e) {
      setLastError(e instanceof Error ? e.message : "Wallet connection failed.");
      throw e;
    } finally {
      setConnecting(false);
    }
  }, [login]);

  const disconnect = useCallback(() => {
    setLastError(null);
    void logout().catch(() => undefined);
  }, [logout]);

  const canSign = useMemo(() => !!getInjectedProvider(), [address]);

  const value = useMemo<WalletState>(
    () => ({
      address: authenticated ? address : null,
      source: authenticated ? "privy" : null,
      provider: authenticated ? getInjectedProvider() : null,
      connecting: connecting || !ready,
      lastError,
      canSign,
      connect,
      disconnect,
    }),
    [address, authenticated, connecting, ready, lastError, canSign, connect, disconnect],
  );

  return (
    <WalletContext.Provider value={value}>{children}</WalletContext.Provider>
  );
}

/* ---------------- Injected road (MetaMask / Rabby directly) ------------- */

function InjectedWalletProvider({ children }: { children: ReactNode }) {
  const [address, setAddress] = useState<`0x${string}` | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [lastError, setLastError] = useState<string | null>(null);

  // Stay in sync if the user switches accounts in the wallet mid-session.
  useEffect(() => {
    const provider = getInjectedProvider() as unknown as {
      on?: (ev: string, cb: (...a: unknown[]) => void) => void;
      removeListener?: (ev: string, cb: (...a: unknown[]) => void) => void;
    } | null;
    if (!provider?.on) return;
    const onAccounts = (...a: unknown[]) => {
      const acc = a[0] as string[] | undefined;
      setAddress(acc?.[0] ? (acc[0] as `0x${string}`) : null);
    };
    provider.on("accountsChanged", onAccounts);
    return () => provider.removeListener?.("accountsChanged", onAccounts);
  }, []);

  const connect = useCallback(async () => {
    setLastError(null);
    setConnecting(true);
    try {
      const addr = await connectWallet();
      setAddress(addr);
    } catch (e) {
      setLastError(
        e instanceof Error ? e.message : "Wallet connection failed.",
      );
      throw e;
    } finally {
      setConnecting(false);
    }
  }, []);

  // Injected wallets can't be "disconnected" by the dapp — clearing local
  // state is the honest equivalent; the wallet stays authorized in its own UI.
  const disconnect = useCallback(() => {
    setAddress(null);
    setLastError(null);
  }, []);

  const value = useMemo<WalletState>(
    () => ({
      address,
      source: address ? "injected" : null,
      provider: address ? getInjectedProvider() : null,
      connecting,
      lastError,
      canSign: !!address && !!getInjectedProvider(),
      connect,
      disconnect,
    }),
    [address, connecting, lastError, connect, disconnect],
  );

  return (
    <WalletContext.Provider value={value}>{children}</WalletContext.Provider>
  );
}

/* ---------------- Reown road (AppKit modal) ----------------------------- */

function ReownWalletProvider({ children }: { children: ReactNode }) {
  const { open } = useAppKit();
  const { address, isConnected } = useAppKitAccount();
  const { walletProvider } = useAppKitProvider("eip155");
  const [connecting, setConnecting] = useState(false);
  const [lastError, setLastError] = useState<string | null>(null);

  const provider = (walletProvider ?? null) as EthereumProvider | null;
  const connected = isConnected && !!address ? (address as `0x${string}`) : null;

  const connect = useCallback(async () => {
    setLastError(null);
    setConnecting(true);
    try {
      await open({ view: "Connect" });
    } catch (e) {
      setLastError(e instanceof Error ? e.message : "Wallet connection failed.");
      throw e;
    } finally {
      setConnecting(false);
    }
  }, [open]);

  const disconnect = useCallback(() => {
    setLastError(null);
    void open({ view: "Account" });
  }, [open]);

  const value = useMemo<WalletState>(
    () => ({
      address: connected,
      source: connected ? "reown" : null,
      provider: connected ? provider : null,
      connecting,
      lastError,
      canSign: !!connected && !!provider,
      connect,
      disconnect,
    }),
    [connected, provider, connecting, lastError, connect, disconnect],
  );

  return (
    <WalletContext.Provider value={value}>{children}</WalletContext.Provider>
  );
}

/* ---------------- public provider --------------------------------------- */

export function WalletProvider({ children }: { children: ReactNode }) {
  if (REOWN_ENABLED) {
    return <ReownWalletProvider>{children}</ReownWalletProvider>;
  }
  if (PRIVY_ENABLED) {
    return <PrivyWalletProvider>{children}</PrivyWalletProvider>;
  }
  return <InjectedWalletProvider>{children}</InjectedWalletProvider>;
}

/** For honest logs only — never rendered with the full address in UI copy. */
export function describeWallet(address: string | null): string {
  return address ? shortAddr(address) : "disconnected";
}
