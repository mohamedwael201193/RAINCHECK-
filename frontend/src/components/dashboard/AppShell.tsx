import { useEffect } from "react";
import { Link, NavLink, useLocation } from "react-router-dom";
import { useWallet } from "./WalletContext";
import AmbientAurora from "./AmbientAurora";
import { shortHex } from "../../lib/receipts";
import "./AppShell.css";

/**
 * AppShell — the relay-style app frame for every RAINCHECK app screen.
 *
 * Desktop: left sidebar (brand, wallet status card, icon+label nav with the
 * active item in accent, bottom network indicator + connect), top bar
 * (page title, wallet status pill, connect button), content.
 * Mobile: compact top bar + fixed bottom tab nav. 44px touch targets.
 *
 * Wallet connection is first-class: disconnected users get a clear CTA in
 * the sidebar card AND the top bar — never a dead end.
 */

function BrandMark() {
  return (
    <span className="rcs-brand-mark" aria-hidden="true">
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
        <path
          d="M6 3h12v18l-2.5-1.7L13 21l-2.5-1.7L8 21l-2-1.3V3z"
          fill="#0B1220"
          stroke="#35E0FF"
          strokeWidth="1.8"
        />
        <path
          d="M9 8.5l2 2 4-4.5"
          stroke="#35E0FF"
          strokeWidth="2.2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </span>
  );
}

function TicketIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M6 3h12v18l-2.5-1.7L13 21l-2.5-1.7L8 21l-2-1.3V3z" />
      <path d="M9.5 12.5h5M9.5 15.5h3.5" />
    </svg>
  );
}
function PlusIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
      <circle cx="12" cy="12" r="9" />
      <path d="M12 8.5v7M8.5 12h7" />
    </svg>
  );
}
function PulseIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M3 12h4l2.5-6 4 12 2.5-6H21" />
    </svg>
  );
}
function ShieldIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 3l7.5 3v5.5c0 4.8-3.2 8-7.5 9.5-4.3-1.5-7.5-4.7-7.5-9.5V6L12 3z" />
      <path d="M9 12l2 2 4-4.5" />
    </svg>
  );
}
function BridgeIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M3 17c2.5-5.5 6-8 9-8s6.5 2.5 9 8" />
      <path d="M5.5 13.5v-2M9.5 10.8V9M14.5 9v1.8M18.5 11.5v2" />
      <path d="M2 20h20" />
    </svg>
  );
}
function BookIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H20v15H6.5A2.5 2.5 0 0 0 4 20.5V5.5z" />
      <path d="M4 20.5A2.5 2.5 0 0 1 6.5 18H20" />
    </svg>
  );
}

interface NavItem {
  to: string;
  label: string;
  end: boolean;
  Icon: () => JSX.Element;
}

const NAV: NavItem[] = [
  { to: "/dashboard", label: "Receipts", end: true, Icon: TicketIcon },
  { to: "/dashboard/new", label: "New receipt", end: true, Icon: PlusIcon },
  { to: "/dashboard/activity", label: "Activity", end: false, Icon: PulseIcon },
  { to: "/dashboard/bridge", label: "Bridge", end: true, Icon: BridgeIcon },
  { to: "/verify", label: "Verify", end: false, Icon: ShieldIcon },
];

function WalletCard() {
  const { address, connecting, connect, lastError } = useWallet();
  return (
    <div className="rcs-wallet-card" aria-live="polite">
      {address ? (
        <>
          <div className="rcs-wallet-row">
            <span className="rcs-dot is-on" aria-hidden="true" />
            <span className="rcs-wallet-state">Connected</span>
          </div>
          <code className="rcs-wallet-addr" title={address}>
            {shortHex(address)}
          </code>
          <p className="rcs-wallet-net">Arc mainnet · signs receipts as you</p>
        </>
      ) : (
        <>
          <div className="rcs-wallet-row">
            <span className="rcs-dot" aria-hidden="true" />
            <span className="rcs-wallet-state">No wallet connected</span>
          </div>
          <p className="rcs-wallet-copy">
            Connect to open receipts and sign delivery attestations. Any
            wallet works — no allowlist.
          </p>
          <button
            type="button"
            className="rcx-btn rcx-btn-primary rcs-connect"
            onClick={() => void connect().catch(() => undefined)}
            disabled={connecting}
          >
            {connecting ? "Connecting…" : "Connect wallet"}
          </button>
          {lastError && (
            <p className="rcs-wallet-error" role="alert">
              {lastError}
            </p>
          )}
        </>
      )}
    </div>
  );
}

function Sidebar() {
  const { address, connecting, connect, disconnect } = useWallet();
  return (
    <aside className="rcs-sidebar" aria-label="App navigation">
      <Link to="/" className="rcs-brand" aria-label="RAINCHECK home">
        <BrandMark />
        <span className="rcs-brand-word">RAINCHECK</span>
      </Link>

      <WalletCard />

      <nav className="rcs-nav" aria-label="App">
        {NAV.map(({ to, label, end, Icon }) => (
          <NavLink
            key={to}
            to={to}
            end={end}
            className={({ isActive }) =>
              `rcs-navlink${isActive ? " is-active" : ""}`
            }
          >
            <span className="rcs-navicon" aria-hidden="true">
              <Icon />
            </span>
            <span>{label}</span>
          </NavLink>
        ))}
        <a href="/#how" className="rcs-navlink rcs-navlink-guide">
          <span className="rcs-navicon" aria-hidden="true">
            <BookIcon />
          </span>
          <span>How it works</span>
        </a>
      </nav>

      <div className="rcs-side-foot">
        <div className="rcs-net" aria-label="Network: Arc mainnet, chain 5042">
          <span className="rcs-dot is-on" aria-hidden="true" />
          <span>Arc · 5042</span>
        </div>
        {address ? (
          <button
            type="button"
            className="rcx-btn rcx-btn-ghost rcs-connect"
            onClick={disconnect}
          >
            Disconnect
          </button>
        ) : (
          <button
            type="button"
            className="rcx-btn rcx-btn-primary rcs-connect"
            onClick={() => void connect().catch(() => undefined)}
            disabled={connecting}
          >
            {connecting ? "Connecting…" : "Connect"}
          </button>
        )}
      </div>
    </aside>
  );
}

function TopBar({ title }: { title: string }) {
  const { address, connecting, connect, disconnect } = useWallet();
  return (
    <header className="rcs-topbar">
      <div className="rcs-topbar-in">
        <Link to="/" className="rcs-brand rcs-brand-mobile" aria-label="RAINCHECK home">
          <BrandMark />
        </Link>
        <h1 className="rcs-title">{title}</h1>
        <div className="rcs-top-actions">
          <span
            className={`rcs-pill${address ? " is-on" : ""}`}
            title={
              address
                ? `Connected as ${address} on Arc mainnet`
                : "Not connected — connect a wallet to sign"
            }
          >
            <span className={`rcs-dot${address ? " is-on" : ""}`} aria-hidden="true" />
            {address ? shortHex(address) : "Not connected"}
          </span>
          {address ? (
            <button
              type="button"
              className="rcs-disconnect"
              onClick={disconnect}
              title="Disconnect wallet"
            >
              Disconnect
            </button>
          ) : (
            <button
              type="button"
              className="rcx-btn rcx-btn-primary rcs-top-connect"
              onClick={() => void connect().catch(() => undefined)}
              disabled={connecting}
            >
              {connecting ? "Connecting…" : "Connect wallet"}
            </button>
          )}
          {/* Compact mobile wallet control (≤480px): one button, never
              clipped. Desktop pill + disconnect hide via CSS. */}
          {address ? (
            <button
              type="button"
              className="rcs-mwallet is-on"
              onClick={disconnect}
              title={`Connected as ${address} — tap to disconnect`}
              aria-label="Disconnect wallet"
            >
              <span className="rcs-dot is-on" aria-hidden="true" />
              {shortHex(address)}
            </button>
          ) : (
            <button
              type="button"
              className="rcs-mwallet"
              onClick={() => void connect().catch(() => undefined)}
              disabled={connecting}
            >
              {connecting ? "Connecting…" : "Connect"}
            </button>
          )}
        </div>
      </div>
    </header>
  );
}

function MobileNav() {
  return (
    <nav className="rcs-mobilenav" aria-label="App">
      {NAV.map(({ to, label, end, Icon }) => (
        <NavLink
          key={to}
          to={to}
          end={end}
          className={({ isActive }) =>
            `rcs-mtab${isActive ? " is-active" : ""}`
          }
        >
          <span className="rcs-mtab-icon" aria-hidden="true">
            <Icon />
          </span>
          <span className="rcs-mtab-label">{label}</span>
        </NavLink>
      ))}
      <a href="/#how" className="rcs-mtab">
        <span className="rcs-mtab-icon" aria-hidden="true">
          <BookIcon />
        </span>
        <span className="rcs-mtab-label">Guide</span>
      </a>
    </nav>
  );
}

export default function AppShell({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  const location = useLocation();

  // Landing deep-links (/#how): scroll to the section once it renders.
  useEffect(() => {
    if (!location.hash) return;
    const id = location.hash.slice(1);
    const t = window.setTimeout(() => {
      document.getElementById(id)?.scrollIntoView({ behavior: "smooth" });
    }, 350);
    return () => window.clearTimeout(t);
  }, [location.pathname, location.hash]);

  return (
    <div className="rcx rcs">
      {/* Ambient aurora — CSS aurora in the ReactBits Aurora visual
          language: slow cyan glow drift, transform/opacity only,
          frozen under prefers-reduced-motion. */}
      <div className="rcs-aurora" aria-hidden="true">
        <AmbientAurora opacity={0.8} />
      </div>
      <Sidebar />
      <div className="rcs-main">
        <TopBar title={title} />
        <main className="rcs-content">{children}</main>
      </div>
      <MobileNav />
    </div>
  );
}
