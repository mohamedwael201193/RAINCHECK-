import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { envVar, formatUSDC, shortHex } from "../../lib/chain";
import TokenIcon from "../../components/TokenIcon";
import "./ActivityPage.css";

/**
 * F7 — Activity / audit (build bible §8.1 S5). The global event feed.
 *
 * No dedicated /api/activity endpoint exists yet, so the feed is derived
 * client-side: GET /api/receipts summaries → per-receipt timelines →
 * merged, newest-first event feed. Every row traces to a chain transition
 * with a transaction link. Seller dispute counters are derived from
 * NonDeliveryFlagged events — never invented. Loading shows skeleton rows;
 * the feed never shows fake data.
 */

interface ReceiptSummary {
  paymentId: string;
  status: string;
  buyer: string;
  seller: string;
  amountUSDC: string;
  amountUSDCBase: string;
  /** Payment token symbol from the API ("USDC" | "EURC"); absent = USDC. */
  token?: string;
  openedAt: number;
  updatedAt: number;
  receiptHash: string;
}

interface TimelineEntry {
  event: string;
  txHash: string;
  explorerUrl: string;
  memoIndex: number | null;
  blockTime: number;
  blockNumber: number;
}

interface FeedEvent {
  id: string;
  kind: "OPEN" | "ATTEST" | "FLAG" | "CAPTURE" | "VOID";
  label: string;
  paymentId: string;
  seller: string;
  buyer: string;
  amountUSDCBase: string;
  /** The payment token the amount is denominated in. */
  token: "USDC" | "EURC";
  txHash: string;
  explorerUrl: string;
  memoIndex: number | null;
  blockTime: number;
}

interface SellerStat {
  seller: string;
  receipts: number;
  disputes: number;
  volumeBase: bigint;
}

type Filter = "ALL" | "OPEN" | "ATTEST" | "FLAG" | "CAPTURE" | "VOID";

const FILTERS: { key: Filter; label: string }[] = [
  { key: "ALL", label: "All" },
  { key: "OPEN", label: "Opens" },
  { key: "ATTEST", label: "Attestations" },
  { key: "FLAG", label: "Disputes" },
  { key: "CAPTURE", label: "Captures" },
  { key: "VOID", label: "Voids" },
];

const EVENT_KIND: Record<string, FeedEvent["kind"]> = {
  RaincheckOpened: "OPEN",
  DeliveryAttested: "ATTEST",
  NonDeliveryFlagged: "FLAG",
  RaincheckCaptured: "CAPTURE",
  RaincheckVoided: "VOID",
};

const KIND_LABEL: Record<FeedEvent["kind"], string> = {
  OPEN: "Receipt opened",
  ATTEST: "Delivery attested",
  FLAG: "Non-delivery flagged",
  CAPTURE: "Captured — seller paid",
  VOID: "Voided — refunded",
};

type LoadState =
  | { kind: "loading" }
  | { kind: "config-error"; message: string }
  | { kind: "error"; message: string }
  | {
      kind: "ready";
      events: FeedEvent[];
      sellers: SellerStat[];
      receipts: number;
      partial: number;
    };

function apiBase(): string | null {
  const base = envVar("VITE_API_URL")?.replace(/\/+$/, "");
  return base || null;
}

/** Number ticker: tweens to the new value only when it actually changes. */
function useTicker(target: number): string {
  const [shown, setShown] = useState(target);
  const shownRef = useRef(target);
  useEffect(() => {
    if (shownRef.current === target) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const from = shownRef.current;
    if (reduce) {
      shownRef.current = target;
      setShown(target);
      return;
    }
    const start = performance.now();
    const dur = 700;
    let raf = 0;
    const tick = (now: number) => {
      const p = Math.min(1, (now - start) / dur);
      const eased = 1 - Math.pow(1 - p, 3);
      const v = from + (target - from) * eased;
      shownRef.current = v;
      setShown(v);
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target]);
  return shown >= 1000
    ? Math.round(shown).toLocaleString()
    : (Math.round(shown * 10) / 10).toString();
}

async function fetchJson(url: string): Promise<unknown> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`API answered ${res.status}`);
  return res.json();
}

async function loadFeed(signal: AbortSignal): Promise<LoadState> {
  const base = apiBase();
  if (!base) {
    return {
      kind: "config-error",
      message:
        "The receipt API isn't configured in this build (VITE_API_URL is empty), so there's nothing to list. The feed needs the indexer to be reachable.",
    };
  }
  let summaries: ReceiptSummary[];
  try {
    const body = (await fetchJson(`${base}/api/receipts?limit=50`)) as {
      receipts?: ReceiptSummary[];
    };
    summaries = Array.isArray(body.receipts) ? body.receipts : [];
  } catch {
    return {
      kind: "error",
      message:
        "Couldn't reach the receipt API. Check your connection and try again — the feed shows live indexer data only, never placeholders.",
    };
  }
  if (summaries.length === 0) {
    return { kind: "ready", events: [], sellers: [], receipts: 0, partial: 0 };
  }

  const byId = new Map(summaries.map((s) => [s.paymentId.toLowerCase(), s]));
  const ids = summaries.slice(0, 40).map((s) => s.paymentId);
  const timelines = new Map<string, TimelineEntry[]>();
  let failed = 0;
  // Bounded concurrency: 5 at a time.
  for (let i = 0; i < ids.length; i += 5) {
    if (signal.aborted) throw new DOMException("aborted", "AbortError");
    const chunk = ids.slice(i, i + 5);
    const results = await Promise.all(
      chunk.map(async (id) => {
        try {
          const view = (await fetchJson(`${base}/api/receipts/${id}`)) as {
            timeline?: TimelineEntry[];
          };
          return { id, timeline: Array.isArray(view.timeline) ? view.timeline : [] };
        } catch {
          return { id, timeline: null as TimelineEntry[] | null };
        }
      }),
    );
    for (const r of results) {
      if (r.timeline) timelines.set(r.id.toLowerCase(), r.timeline);
      else failed += 1;
    }
  }

  const events: FeedEvent[] = [];
  for (const [pidLower, timeline] of timelines) {
    const s = byId.get(pidLower);
    if (!s) continue;
    for (const t of timeline) {
      const kind = EVENT_KIND[t.event];
      if (!kind) continue;
      events.push({
        id: `${t.txHash}:${t.blockNumber}:${t.event}`,
        kind,
        label: KIND_LABEL[kind],
        paymentId: s.paymentId,
        seller: s.seller,
        buyer: s.buyer,
        amountUSDCBase: s.amountUSDCBase,
        token: s.token === "EURC" ? "EURC" : "USDC",
        txHash: t.txHash,
        explorerUrl: t.explorerUrl,
        memoIndex: t.memoIndex ?? null,
        blockTime: t.blockTime,
      });
    }
  }
  events.sort((a, b) => b.blockTime - a.blockTime);

  const sellerMap = new Map<string, SellerStat>();
  for (const s of summaries) {
    const key = s.seller.toLowerCase();
    const cur = sellerMap.get(key) ?? {
      seller: s.seller,
      receipts: 0,
      disputes: 0,
      volumeBase: 0n,
    };
    cur.receipts += 1;
    try {
      cur.volumeBase += BigInt(s.amountUSDCBase);
    } catch {
      /* malformed amount — skip, don't invent */
    }
    sellerMap.set(key, cur);
  }
  for (const e of events) {
    if (e.kind === "FLAG") {
      const st = sellerMap.get(e.seller.toLowerCase());
      if (st) st.disputes += 1;
    }
  }
  const sellers = [...sellerMap.values()].sort(
    (a, b) => b.disputes - a.disputes || b.receipts - a.receipts,
  );

  return {
    kind: "ready",
    events,
    sellers,
    receipts: summaries.length,
    partial: failed,
  };
}

function formatTime(unixSeconds: number): string {
  return new Date(unixSeconds * 1000).toLocaleString();
}

function formatRelative(unixSeconds: number): string {
  const s = Math.floor(Date.now() / 1000 - unixSeconds);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

export default function ActivityPage() {
  const [state, setState] = useState<LoadState>({ kind: "loading" });
  const [filter, setFilter] = useState<Filter>("ALL");
  const [nonce, setNonce] = useState(0);
  const abortRef = useRef<AbortController | null>(null);

  const refresh = useCallback(() => {
    abortRef.current?.abort();
    const ctl = new AbortController();
    abortRef.current = ctl;
    setState({ kind: "loading" });
    loadFeed(ctl.signal).then(
      (s) => {
        if (!ctl.signal.aborted) setState(s);
      },
      (e) => {
        if ((e as Error)?.name === "AbortError") return;
        setState({
          kind: "error",
          message: "The feed failed to load. Check your connection and try again.",
        });
      },
    );
  }, []);

  useEffect(() => {
    refresh();
    return () => abortRef.current?.abort();
  }, [refresh, nonce]);

  const events = state.kind === "ready" ? state.events : [];
  const filtered = useMemo(
    () => (filter === "ALL" ? events : events.filter((e) => e.kind === filter)),
    [events, filter],
  );

  const stats = useMemo(() => {
    if (state.kind !== "ready") return null;
    const disputes = state.events.filter((e) => e.kind === "FLAG").length;
    const captured = state.events.filter((e) => e.kind === "CAPTURE").length;
    return { receipts: state.receipts, events: state.events.length, disputes, captured };
  }, [state]);

  return (
    <div className="rc-activity">
      <div className="rc-activity-inner">
        <Link to="/" className="rc-back">
          ← Back
        </Link>

        <header className="rc-activity-head">
          <h1 className="rc-display">
            EVERYTHING,
            <br />
            <span className="rc-display-accent">ON-CHAIN.</span>
          </h1>
          <p className="rc-subline">
            Every receipt event, newest first — opens, attestations, disputes,
            captures, voids. Each row links to the transaction that made it
            happen.
          </p>
        </header>

        {state.kind === "loading" && (
          <>
            <div className="rc-stat-row" aria-label="Loading statistics">
              {[0, 1, 2, 3].map((i) => (
                <div key={i} className="rc-stat-card">
                  <div className="rc-skel rc-skel-label" />
                  <div className="rc-skel rc-skel-value" />
                </div>
              ))}
            </div>
            <div className="rc-feed" aria-label="Loading feed">
              {[0, 1, 2, 3, 4].map((i) => (
                <div key={i} className="rc-feed-row rc-feed-skel">
                  <div className="rc-skel rc-skel-pill" />
                  <div className="rc-skel rc-skel-line" style={{ width: "45%" }} />
                  <div className="rc-skel rc-skel-line" style={{ width: "30%" }} />
                </div>
              ))}
            </div>
          </>
        )}

        {(state.kind === "config-error" || state.kind === "error") && (
          <section className="rc-panel rc-empty" aria-live="polite">
            <svg className="rc-empty-icon" viewBox="0 0 48 48" aria-hidden="true">
              <circle cx="24" cy="24" r="20" fill="none" stroke="#35E0FF" strokeWidth="2.5" />
              <path d="M24 14v12" stroke="#F4FEFF" strokeWidth="2.5" strokeLinecap="round" />
              <circle cx="24" cy="33" r="2" fill="#F4FEFF" />
            </svg>
            <p className="rc-empty-line">{state.message}</p>
            <button type="button" className="rc-ghost" onClick={() => setNonce((n) => n + 1)}>
              Try again
            </button>
          </section>
        )}

        {state.kind === "ready" && stats && (
          <>
            <div className="rc-stat-row">
              <StatCard label="Receipts" value={stats.receipts} />
              <StatCard label="Events tracked" value={stats.events} />
              <StatCard label="Disputes flagged" value={stats.disputes} tone="warn" />
              <StatCard label="Captures" value={stats.captured} tone="good" />
            </div>
            {state.partial > 0 && (
              <p className="rc-note" role="status">
                {state.partial} receipt{state.partial === 1 ? "" : "s"} couldn't be
                expanded — the feed shows what the indexer returned, nothing
                invented.
              </p>
            )}

            {events.length === 0 ? (
              <section className="rc-panel rc-empty">
                <svg className="rc-empty-icon" viewBox="0 0 48 48" aria-hidden="true">
                  <rect x="10" y="8" width="28" height="32" rx="3" fill="none" stroke="#35E0FF" strokeWidth="2.5" />
                  <path d="M16 17h16M16 23h16M16 29h10" stroke="#F4FEFF" strokeWidth="2.5" strokeLinecap="round" />
                </svg>
                <p className="rc-empty-line">
                  No receipts yet — the feed fills in as receipts open on-chain.
                </p>
                <Link to="/verify" className="rc-ghost rc-ghost-link">
                  Verify a receipt
                </Link>
              </section>
            ) : (
              <>
                <div className="rc-filters" role="tablist" aria-label="Filter events">
                  {FILTERS.map((f) => (
                    <button
                      key={f.key}
                      type="button"
                      role="tab"
                      aria-selected={filter === f.key}
                      className={`rc-filter ${filter === f.key ? "is-active" : ""}`}
                      onClick={() => setFilter(f.key)}
                    >
                      {f.label}
                    </button>
                  ))}
                </div>

                <ol className="rc-feed" key={filter}>
                  {filtered.map((e, i) => (
                    <li
                      key={e.id}
                      className="rc-feed-row"
                      style={{ ["--rc-enter" as string]: `${Math.min(i, 12) * 45}ms` }}
                    >
                      <span className={`rc-kind rc-kind-${e.kind.toLowerCase()}`}>
                        {e.label}
                      </span>
                      <div className="rc-feed-main">
                        <div className="rc-feed-top">
                          <code className="rc-code" title={e.paymentId}>
                            {shortHex(e.paymentId)}
                          </code>
                          <span className="rc-feed-amount">
                            <TokenIcon token={e.token} size={18} />
                            {formatUSDC(e.amountUSDCBase)} {e.token}
                          </span>
                        </div>
                        <div className="rc-feed-sub">
                          <span>
                            seller <code className="rc-code" title={e.seller}>{shortHex(e.seller)}</code>
                          </span>
                          <a
                            className="rc-link"
                            href={e.explorerUrl}
                            target="_blank"
                            rel="noreferrer"
                          >
                            {shortHex(e.txHash)}
                          </a>
                          {e.memoIndex !== null && (
                            <span className="rc-muted">memo #{e.memoIndex}</span>
                          )}
                          <time className="rc-muted" title={formatTime(e.blockTime)}>
                            {formatRelative(e.blockTime)}
                          </time>
                        </div>
                      </div>
                    </li>
                  ))}
                </ol>
                {filtered.length === 0 && (
                  <p className="rc-note">Nothing here yet under this filter.</p>
                )}

                {state.sellers.some((s) => s.disputes > 0) && (
                  <section className="rc-panel rc-disputes" aria-label="Disputes by seller">
                    <h2 className="rc-section-title">Disputes by seller</h2>
                    <table className="rc-table">
                      <thead>
                        <tr>
                          <th scope="col">Seller</th>
                          <th scope="col">Receipts</th>
                          <th scope="col">Disputes</th>
                          <th scope="col">Volume</th>
                        </tr>
                      </thead>
                      <tbody>
                        {state.sellers
                          .filter((s) => s.disputes > 0)
                          .map((s) => (
                            <tr key={s.seller}>
                              <td>
                                <code className="rc-code" title={s.seller}>
                                  {shortHex(s.seller)}
                                </code>
                              </td>
                              <td>{s.receipts}</td>
                              <td className="rc-dispute-count">{s.disputes}</td>
                              <td>{formatUSDC(s.volumeBase.toString())} USDC</td>
                            </tr>
                          ))}
                      </tbody>
                    </table>
                  </section>
                )}

                <div className="rc-actions">
                  <button type="button" className="rc-primary" onClick={() => setNonce((n) => n + 1)}>
                    Refresh feed
                  </button>
                  <Link to="/verify" className="rc-ghost rc-ghost-link">
                    Verify a receipt
                  </Link>
                </div>
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function StatCard({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone?: "warn" | "good";
}) {
  const shown = useTicker(value);
  return (
    <div className="rc-stat-card">
      <div className="rc-stat-label">{label}</div>
      <div className={`rc-stat-value ${tone ? `is-${tone}` : ""}`}>{shown}</div>
    </div>
  );
}
