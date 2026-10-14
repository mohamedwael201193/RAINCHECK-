import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import AppShell from "../../components/dashboard/AppShell";
import ReceiptCard from "../../components/dashboard/ReceiptCard";
import StatsStrip from "../../components/dashboard/StatsStrip";
import TapeEmpty from "../../components/dashboard/TapeEmpty";
import { useWallet } from "../../components/dashboard/WalletContext";
import { Receipt, fetchReceipts } from "../../lib/receipts";
import "../../styles/app.css";
import "./DashboardPage.css";

type Filter = "ALL" | "OPEN" | "ATTESTED" | "FLAGGED" | "CAPTURED" | "VOIDED";

const FILTERS: { key: Filter; label: string }[] = [
  { key: "ALL", label: "All" },
  { key: "OPEN", label: "Open" },
  { key: "ATTESTED", label: "Attested" },
  { key: "FLAGGED", label: "Flagged" },
  { key: "CAPTURED", label: "Captured" },
  { key: "VOIDED", label: "Voided" },
];

function SkeletonCard() {
  return (
    <div aria-hidden="true" className="rc-ticket rc-ticket-skel">
      <div className="rcx-skel" style={{ height: 20, width: "55%" }} />
      <div className="rcx-skel" style={{ height: 46, width: 46, borderRadius: 999 }} />
      <div className="rcx-skel" style={{ height: 30, width: "70%" }} />
      <div className="rcx-skel" style={{ height: 14, width: "90%" }} />
      <div className="rcx-skel" style={{ height: 14, width: "60%" }} />
    </div>
  );
}

/**
 * /dashboard — Receipts. The relay "TAPE": stats strip (vendored Magic UI
 * NumberTicker over live figures), filter tabs, ticket grid with lifecycle
 * position dots. Live receipts from GET /api/receipts (VITE_API_URL),
 * newest first. Four states: main / loading (skeletons) / empty / error —
 * all honest, no placeholder rows.
 */
export default function DashboardPage() {
  const { address, connecting, connect } = useWallet();
  const [receipts, setReceipts] = useState<Receipt[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>("ALL");
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setReceipts(null);
    setError(null);
    fetchReceipts()
      .then((r) => {
        if (!cancelled) setReceipts(r);
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      });
    return () => {
      cancelled = true;
    };
  }, [reloadKey]);

  const counts = useMemo(() => {
    const c: Record<string, number> = { ALL: 0 };
    for (const r of receipts ?? []) {
      c.ALL += 1;
      const k = String(r.status);
      c[k] = (c[k] ?? 0) + 1;
    }
    return c;
  }, [receipts]);

  const visible = useMemo(() => {
    if (!receipts) return null;
    if (filter === "ALL") return receipts;
    return receipts.filter((r) => r.status === filter);
  }, [receipts, filter]);

  return (
    <AppShell title="Receipts">
      {/* Page intro — one line of story, one primary action */}
      <div className="rc-dash-head rcx-rise">
        <div className="rc-dash-head-copy">
          <p className="rcx-sub" style={{ margin: 0, maxWidth: "40rem" }}>
            Every delivery leaves a signed receipt: money locked on-chain,
            delivery attested, seller paid or buyer refunded. Newest first.
          </p>
        </div>
        <div className="rc-dash-cta-row">
          <Link to="/dashboard/new" className="rcx-btn rcx-btn-primary">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" aria-hidden="true">
              <path d="M12 5v14M5 12h14" />
            </svg>
            Open receipt
          </Link>
        </div>
      </div>

      {/* Disconnected nudge — a clear CTA, not a dead end */}
      {!address && (
        <div className="rc-dash-connect rcx-rise" style={{ ["--rcx-i" as string]: "40ms" }}>
          <div>
            <p className="rc-dash-connect-title">Browsing without a wallet</p>
            <p className="rc-dash-connect-sub">
              You can read every receipt. Connect to open one, attest a
              delivery, or release funds.
            </p>
          </div>
          <button
            type="button"
            className="rcx-btn rcx-btn-primary"
            onClick={() => void connect().catch(() => undefined)}
            disabled={connecting}
          >
            {connecting ? "Connecting…" : "Connect wallet"}
          </button>
        </div>
      )}

      {/* Honest stats — computed from the live list, nothing invented */}
      <div className="rcx-rise" style={{ ["--rcx-i" as string]: "60ms" }}>
        <StatsStrip receipts={receipts} />
      </div>

      {/* Status filter tabs */}
      <div
        className="rc-dash-chips rcx-rise"
        style={{ ["--rcx-i" as string]: "120ms" }}
        role="tablist"
        aria-label="Filter receipts by status"
      >
        {FILTERS.map((f) => {
          const active = filter === f.key;
          const count = counts[f.key] ?? 0;
          return (
            <button
              key={f.key}
              role="tab"
              aria-selected={active}
              onClick={() => setFilter(f.key)}
              className={`rc-chip${active ? " rc-chip-active" : ""}`}
            >
              {f.label}
              <span className="rc-chip-count">{count}</span>
            </button>
          );
        })}
      </div>

      {/* Body: skeletons → error → empty → tickets. Never blank space. */}
      <div className="rc-dash-body">
        {receipts === null && error === null && (
          <div className="rc-grid" aria-label="Loading receipts">
            {Array.from({ length: 6 }).map((_, i) => (
              <SkeletonCard key={i} />
            ))}
          </div>
        )}

        {error !== null && (
          <div className="rc-dash-error rcx-rise" role="alert" title={`Technical detail: ${error}`}>
            <TapeEmpty
              headline="The tape is unreachable right now."
              sub="The receipt service isn't responding. Check your connection, then try again — nothing here is cached or guessed."
              actionLabel="Try again"
              onAction={() => setReloadKey((k) => k + 1)}
            />
          </div>
        )}

        {visible !== null && error === null && visible.length === 0 && (
          <div className="rcx-rise">
            <TapeEmpty
              headline={
                filter === "ALL"
                  ? "The tape starts with your first receipt."
                  : `No ${filter.toLowerCase()} receipts on the tape.`
              }
              sub={
                filter === "ALL"
                  ? "A receipt locks money against a signed delivery promise on Arc mainnet. Opening one takes about a minute."
                  : "Try another status, or look at everything at once."
              }
              actionLabel={filter === "ALL" ? "Open the first receipt" : "Show all receipts"}
              actionTo={filter === "ALL" ? "/dashboard/new" : undefined}
              onAction={filter === "ALL" ? undefined : () => setFilter("ALL")}
            />
          </div>
        )}

        {visible !== null && error === null && visible.length > 0 && (
          <div className="rc-grid">
            {visible.map((r, i) => (
              <div key={r.paymentId} style={{ ["--rcx-i" as string]: `${Math.min(i, 11) * 55}ms` }}>
                <ReceiptCard receipt={r} />
              </div>
            ))}
          </div>
        )}
      </div>
    </AppShell>
  );
}
