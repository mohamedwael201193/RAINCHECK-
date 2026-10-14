import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import AppHeader from "../../components/dashboard/AppHeader";
import ReceiptCard from "../../components/dashboard/ReceiptCard";
import TokenIcon from "../../components/TokenIcon";
import { Receipt, fetchReceipts, formatUSDC } from "../../lib/receipts";
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

function ReceiptIcon() {
  return (
    <svg
      className="rcx-empty-icon"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M6 2h12v20l-3-2-3 2-3-2-3 2z" />
      <path d="M9 7.5l2 2 4-4.5" />
    </svg>
  );
}

/** Honest aggregate strip — every figure is computed from the live list. */
function sumBase(receipts: Receipt[], token: "USDC" | "EURC"): bigint {
  let total = 0n;
  for (const r of receipts) {
    if (String(r.status) !== "OPEN" && String(r.status) !== "ATTESTED" && String(r.status) !== "FLAGGED")
      continue;
    const isEurc = r.token === "EURC";
    if ((token === "EURC") !== isEurc) continue;
    try {
      total += BigInt(r.amount);
    } catch {
      /* malformed amount — skip it rather than invent */
    }
  }
  return total;
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

  const stats = useMemo(() => {
    const list = receipts ?? [];
    return {
      total: list.length,
      escrowedUsdc: sumBase(list, "USDC").toString(),
      escrowedEurc: sumBase(list, "EURC").toString(),
      disputes: list.filter((r) => String(r.status) === "FLAGGED").length,
    };
  }, [receipts]);

  return (
    <div className="rcx">
      <AppHeader />
      <main className="rcx-inner">
        {/* Header — exactly one primary action */}
        <div className="rc-dash-head rcx-rise">
          <div className="rc-dash-head-copy">
            <p className="rcx-eyebrow">Raincheck · escrow dashboard</p>
            <h1 className="rcx-title">Receipts</h1>
            <p className="rcx-sub">
              Every delivery leaves a signed receipt. Newest first, read from
              on-chain escrow activity.
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

        {/* Honest stats — computed from the live list, nothing invented */}
        <div className="rc-stats rcx-rise" style={{ ["--rcx-i" as string]: "60ms" }} aria-label="Escrow statistics">
          <div className="rc-stat">
            <div className="rc-stat-label">Receipts</div>
            <div className="rc-stat-value is-cyan">
              <span className="rc-stat-num">{receipts === null ? "—" : stats.total}</span>
            </div>
            <div className="rc-stat-sub">on-chain, newest first</div>
          </div>
          <div className="rc-stat">
            <div className="rc-stat-label">Escrowed · USDC</div>
            <div className="rc-stat-value">
              <TokenIcon token="USDC" size={26} />
              <span className="rc-stat-num" title={receipts === null ? undefined : `${stats.escrowedUsdc} base units`}>
                {receipts === null ? "—" : formatUSDC(stats.escrowedUsdc)}
              </span>
            </div>
            <div className="rc-stat-sub">locked in open receipts</div>
          </div>
          <div className="rc-stat">
            <div className="rc-stat-label">Escrowed · EURC</div>
            <div className="rc-stat-value">
              <TokenIcon token="EURC" size={26} />
              <span className="rc-stat-num" title={receipts === null ? undefined : `${stats.escrowedEurc} base units`}>
                {receipts === null ? "—" : formatUSDC(stats.escrowedEurc)}
              </span>
            </div>
            <div className="rc-stat-sub">locked in open receipts</div>
          </div>
          <div className="rc-stat">
            <div className="rc-stat-label">Disputes</div>
            <div className="rc-stat-value">
              <span className="rc-stat-num">{receipts === null ? "—" : stats.disputes}</span>
            </div>
            <div className="rc-stat-sub">flagged, awaiting resolution</div>
          </div>
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
              <div className="rcx-note rcx-note-error">
                <p style={{ margin: "0 0 6px", fontWeight: 800, color: "#fecaca" }}>
                  We couldn&apos;t load your receipts.
                </p>
                <p style={{ margin: 0 }}>
                  The receipt service isn&apos;t responding. Check your
                  connection, then try again.
                </p>
                <button
                  onClick={() => setReloadKey((k) => k + 1)}
                  className="rcx-btn rcx-btn-primary"
                  style={{ marginTop: 16 }}
                >
                  Try again
                </button>
              </div>
            </div>
          )}

          {visible !== null && error === null && visible.length === 0 && (
            <div className="rcx-empty rcx-rise">
              <ReceiptIcon />
              <p className="rcx-empty-line">
                {filter === "ALL"
                  ? "No receipts yet — open the first one."
                  : `No ${filter.toLowerCase()} receipts.`}
              </p>
              <p className="rcx-empty-sub">
                {filter === "ALL"
                  ? "A receipt locks money against a signed delivery promise. It takes about a minute."
                  : "Try another status, or look at everything at once."}
              </p>
              {filter === "ALL" ? (
                <Link to="/dashboard/new" className="rcx-btn rcx-btn-primary">
                  Open the first receipt
                </Link>
              ) : (
                <button
                  onClick={() => setFilter("ALL")}
                  className="rcx-btn rcx-btn-ghost"
                >
                  Show all receipts
                </button>
              )}
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

        <p className="rc-dash-note">
          *What you see here is read from on-chain escrow activity — anything
          listed can be checked against the chain itself.
        </p>
      </main>
    </div>
  );
}
