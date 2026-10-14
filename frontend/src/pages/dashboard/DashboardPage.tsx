import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import ReceiptCard from "../../components/dashboard/ReceiptCard";
import { Receipt, fetchReceipts } from "../../lib/receipts";
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
    <div aria-hidden="true" className="rc-card rc-skeleton">
      <div className="rc-card-head">
        <div className="rc-sk rc-sk-label" />
        <div className="rc-sk rc-sk-pill" />
      </div>
      <div className="rc-sk rc-sk-value" />
      <div className="rc-sk rc-sk-meta" />
      <div className="rc-sk rc-sk-meta2" />
    </div>
  );
}

function ReceiptIcon() {
  return (
    <svg
      className="rc-empty-icon"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M6 2h12v20l-3-2-3 2-3-2-3 2z" />
      <path d="M9 7h6M9 11h6" />
    </svg>
  );
}

/**
 * /dashboard — the receipt list. Live receipts from GET /api/receipts
 * (VITE_API_URL), newest first. One primary action ("Open receipt").
 * Four states: main / loading (skeletons) / empty / error — all honest,
 * no placeholder rows. Lazy-loaded by src/App.tsx — keep this a default
 * export.
 */
export default function DashboardPage() {
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
    <main className="rc-dash">
      <div className="rc-dash-inner">
        {/* Header — exactly one primary action */}
        <div className="rc-dash-head">
          <div>
            <h1 className="rc-dash-title">Receipts</h1>
            <p className="rc-dash-sub">
              Every delivery leaves a signed receipt. Newest first.
            </p>
          </div>
          <Link to="/dashboard/new" className="rc-dash-cta">
            Open receipt
          </Link>
        </div>

        {/* Status filter chips */}
        <div
          className="rc-dash-chips"
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

        {/* Body: skeletons → error → empty → cards. Never blank space. */}
        <div className="rc-dash-body">
          {receipts === null && error === null && (
            <div className="rc-grid" aria-label="Loading receipts">
              {Array.from({ length: 6 }).map((_, i) => (
                <SkeletonCard key={i} />
              ))}
            </div>
          )}

          {error !== null && (
            <div
              className="rc-error"
              role="alert"
              title={`Technical detail: ${error}`}
            >
              <p className="rc-error-title">We couldn&apos;t load your receipts.</p>
              <p className="rc-error-msg">
                The receipt service isn&apos;t responding. Check your
                connection, then try again.
              </p>
              <button
                onClick={() => setReloadKey((k) => k + 1)}
                className="rc-error-retry"
              >
                Try again
              </button>
            </div>
          )}

          {visible !== null && error === null && visible.length === 0 && (
            <div className="rc-empty">
              <ReceiptIcon />
              <p className="rc-empty-line">
                {filter === "ALL"
                  ? "No receipts yet — open the first one."
                  : `No ${filter.toLowerCase()} receipts.`}
              </p>
              {filter === "ALL" ? (
                <Link to="/dashboard/new" className="rc-dash-cta">
                  Open the first receipt
                </Link>
              ) : (
                <button
                  onClick={() => setFilter("ALL")}
                  className="rc-chip"
                >
                  Show all receipts
                </button>
              )}
            </div>
          )}

          {visible !== null && error === null && visible.length > 0 && (
            <div className="rc-grid">
              {visible.map((r) => (
                <ReceiptCard key={r.paymentId} receipt={r} />
              ))}
            </div>
          )}
        </div>

        <p className="rc-dash-note">
          *What you see here is read from on-chain escrow activity — anything
          listed can be checked against the chain itself.
        </p>
      </div>
    </main>
  );
}
