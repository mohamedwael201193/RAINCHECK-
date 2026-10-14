import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import { Link, useParams } from "react-router-dom";
import { keccak256, stringToHex } from "viem";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "../../components/ui/alert-dialog";
import { Toaster, toast } from "../../components/ui/sonner";
import TokenIcon from "../../components/TokenIcon";
import {
  type ActionKind,
  type ActionTxPreview,
  type ChainReceiptView,
  type PaymentTokenSymbol,
  addressUrl,
  buildActionTx,
  connectWallet,
  countdownText,
  envVar,
  ESCROW_ADDRESS,
  formatChainTime,
  formatUSDC,
  getInjectedProvider,
  isValidPaymentId,
  readChainNow,
  readReceiptFromChain,
  shortHex,
  signAndBroadcast,
  tokenSymbolForEscrow,
  txUrl,
  UserRejectedError,
} from "../../lib/chain";
import "./ReceiptDetailPage.css";

/**
 * F6 — Receipt detail (bible §8.1 S3). The core screen.
 * Design law: RAINCHECK tokens (#0B1220 / #35E0FF / #F4EFE6 / #F4FEFF),
 * user-words vocabulary, AlertDialog for destructive confirms, sonner toasts.
 *
 * Data sources, stated honestly:
 *  - Receipt body + timeline: GET {VITE_API_URL}/api/receipts/:paymentId
 *    (the indexer is a cache over eth_getLogs — never the source of truth).
 *  - attestedAt, challengeWindow, and "now": read from CHAIN via viem
 *    (eth_call + latest block timestamp). The capture/void gates never use
 *    the indexer's clock.
 *  - Every action shows the EXACT unsigned tx before the wallet prompt,
 *    and counts as done only on a mined receipt with status 1.
 */

// ---------------------------------------------------------------------------
// Receipt API types (tolerant — the indexer is a cache, fields may be absent)
// ---------------------------------------------------------------------------

interface TimelineEvent {
  event: string;
  txHash: string;
  memoIndex?: number | null;
  blockTime?: number | string | null;
  blockNumber?: number | null;
}

interface ReceiptDetail {
  paymentId: string;
  status: string;
  buyer: string;
  seller: string;
  amount: string; // 6-decimal base units, string (in the receipt's token)
  deadline?: number | string | null; // unix seconds
  termsHash: string;
  terms?: Record<string, unknown> | string | null;
  outputHash?: string | null;
  attestedAt?: number | string | null;
  flagReasonHash?: string | null;
  flaggedBy?: string | null;
  timeline: TimelineEvent[];
  /** Originating escrow instance (served by the API; multi-asset). */
  escrow?: string;
  /** Payment token symbol, derived by the API from the escrow address. */
  token?: string;
}

type LoadState =
  | { kind: "loading" }
  | { kind: "config-error"; message: string }
  | { kind: "invalid-id" }
  | { kind: "not-found"; message: string }
  | { kind: "error"; message: string }
  | { kind: "ready"; receipt: ReceiptDetail };

function apiBase(): string | null {
  const base = envVar("VITE_API_URL")?.replace(/\/+$/, "");
  return base || null;
}

/** Normalize indexer status strings (handles legacy "CHALLENGED"). */
function normalizeStatus(raw: unknown): string {
  if (typeof raw !== "string") return "UNKNOWN";
  const up = raw.trim().toUpperCase();
  return up === "CHALLENGED" ? "FLAGGED" : up;
}

/** Plain-meaning copy per status — bible §8.1 S3, verbatim. */
const STATUS_MEANING: Record<string, string> = {
  OPEN: "money locked, waiting for delivery",
  ATTESTED: "seller says delivered, challenge window open",
  FLAGGED: "under dispute",
  VOIDED: "refunded on-chain",
  CAPTURED: "seller paid",
};

/** User-words action labels (design law §7.8) + technical tx names. */
const ACTION_COPY: Record<
  ActionKind,
  { label: string; technical: string; pastTense: string }
> = {
  attest: {
    label: "Confirm delivery",
    technical: "attestDelivery(paymentId, outputHash)",
    pastTense: "Delivery confirmed",
  },
  flag: {
    label: "Flag a problem",
    technical: "flagNonDelivery(paymentId, reasonHash)",
    pastTense: "Problem flagged",
  },
  capture: {
    label: "Release to seller",
    technical: "capture(paymentId)",
    pastTense: "Released to seller",
  },
  void: {
    label: "Refund",
    technical: "void(paymentId)",
    pastTense: "Refunded",
  },
  voidAfterDeadline: {
    label: "Refund",
    technical: "voidAfterDeadline(paymentId)",
    pastTense: "Refunded after deadline",
  },
};

function toUnixSeconds(
  v: number | string | null | undefined | bigint,
): bigint | null {
  if (v === null || v === undefined || v === "") return null;
  if (typeof v === "bigint") return v;
  if (typeof v === "number") return BigInt(Math.floor(v > 1e12 ? v / 1000 : v));
  const s = String(v).trim();
  if (/^\d+$/.test(s)) {
    const n = BigInt(s);
    return n > 1_000_000_000_000n ? n / 1000n : n;
  }
  const ms = Date.parse(s);
  return Number.isNaN(ms) ? null : BigInt(Math.floor(ms / 1000));
}

function eqAddr(a?: string | null, b?: string | null): boolean {
  return !!a && !!b && a.toLowerCase() === b.toLowerCase();
}

async function sha256HexBytes(data: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", data as BufferSource);
  return (
    "0x" +
    Array.from(new Uint8Array(digest))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("")
  );
}

// ---------------------------------------------------------------------------
// Exact-tx preview (shown BEFORE every wallet prompt — bible §7.2)
// ---------------------------------------------------------------------------

function TxPreview({ preview }: { preview: ActionTxPreview }) {
  const copy = ACTION_COPY[preview.kind];
  return (
    <div>
      <dl className="rc-kv">
        <div>
          <dt>Action</dt>
          <dd>
            {copy.label}{" "}
            <span className="rc-muted">({copy.technical})</span>
          </dd>
        </div>
        <div>
          <dt>To (outer)</dt>
          <dd>
            <code>{preview.to}</code>{" "}
            <span className="rc-muted">(Memo contract — wraps the call)</span>
          </dd>
        </div>
        <div>
          <dt>Inner call</dt>
          <dd>
            <code>{preview.inner.target}</code>
            <br />
            <code>{preview.inner.function}</code>
          </dd>
        </div>
        <div>
          <dt>Value</dt>
          <dd>0 USDC (no funds move in this tx)</dd>
        </div>
        <div>
          <dt>Gas limit (manual)</dt>
          <dd>{preview.gas}</dd>
        </div>
        <div>
          <dt>Chain</dt>
          <dd>Arc mainnet (5042)</dd>
        </div>
        <div>
          <dt>memoId</dt>
          <dd>
            <code>{preview.memoId}</code>
          </dd>
        </div>
      </dl>
      <details className="rc-details">
        <summary>Full calldata (hex)</summary>
        <pre className="rc-code rc-code-wrap">{preview.data}</pre>
      </details>
    </div>
  );
}

function TechnicalNote({ kind }: { kind: ActionKind }) {
  return (
    <details className="rc-details">
      <summary>Technical details</summary>
      <p className="rc-muted">
        Sends <code>{ACTION_COPY[kind].technical}</code>, Memo-wrapped, on Arc
        mainnet (5042) with a manual gas limit.
      </p>
    </details>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function ReceiptDetailPage() {
  const { paymentId } = useParams<{ paymentId: string }>();

  const [load, setLoad] = useState<LoadState>({ kind: "loading" });
  const [chain, setChain] = useState<ChainReceiptView | null>(null);
  // The escrow instance this receipt lives on (multi-asset). Comes from the
  // API's receipt view; every chain read and action tx targets it. Defaults
  // to the USDC production escrow until the API answers.
  const [escrowAddr, setEscrowAddr] = useState<`0x${string}`>(ESCROW_ADDRESS);
  const [chainNow, setChainNow] = useState<bigint | null>(null);
  const [chainError, setChainError] = useState<string | null>(null);
  const [wallet, setWallet] = useState<`0x${string}` | null>(null);
  const [walletError, setWalletError] = useState<string | null>(null);
  const [refreshTick, setRefreshTick] = useState(0);

  // Non-destructive action preview (attest / capture): exact tx before prompt
  const [pendingAction, setPendingAction] = useState<{
    kind: ActionKind;
    preview: ActionTxPreview;
  } | null>(null);
  // Destructive dialog previews (flag / void / voidAfterDeadline)
  const [dialogPreview, setDialogPreview] = useState<ActionTxPreview | null>(
    null,
  );
  const [sending, setSending] = useState(false);
  const [sentTx, setSentTx] = useState<`0x${string}` | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionDone, setActionDone] = useState<string | null>(null);

  // Flag form
  const [flagReason, setFlagReason] = useState("");
  // Attest form
  const [attestBytes, setAttestBytes] = useState("");
  const [attestHash, setAttestHash] = useState("");
  const [attestHashError, setAttestHashError] = useState<string | null>(null);
  // Verify helper
  const [verifyInput, setVerifyInput] = useState("");
  const [verifyResult, setVerifyResult] = useState<
    null | { ok: boolean; computed: string }
  >(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const validId = isValidPaymentId(paymentId);

  // --- load receipt from the indexer API -----------------------------------
  const loadReceipt = useCallback(async () => {
    if (!validId) {
      setLoad({ kind: "invalid-id" });
      return;
    }
    const base = apiBase();
    if (!base) {
      setLoad({
        kind: "config-error",
        message:
          "Receipt API is not configured (VITE_API_URL is empty). The page cannot load receipt data without the indexer API.",
      });
      return;
    }
    setLoad((l) => (l.kind === "ready" ? l : { kind: "loading" }));
    try {
      const res = await fetch(`${base}/api/receipts/${paymentId}`, {
        headers: { accept: "application/json" },
      });
      if (res.status === 404) {
        setLoad({
          kind: "not-found",
          message:
            "No receipt with this paymentId in the indexer. It may not exist on-chain, or the indexer has not caught up yet.",
        });
        return;
      }
      if (!res.ok) {
        throw new Error(`API returned HTTP ${res.status}`);
      }
      const json = (await res.json()) as ReceiptDetail;
      if (!Array.isArray(json.timeline)) json.timeline = [];
      // Multi-asset: the API serves the originating escrow instance — all
      // chain reads and action txs below target it, never the default.
      if (typeof json.escrow === "string" && /^0x[0-9a-fA-F]{40}$/.test(json.escrow)) {
        setEscrowAddr(json.escrow as `0x${string}`);
      }
      setLoad({ kind: "ready", receipt: json });
    } catch (err) {
      setLoad({
        kind: "error",
        message: `Could not load the receipt: ${err instanceof Error ? err.message : String(err)}`,
      });
    }
  }, [paymentId, validId]);

  useEffect(() => {
    void loadReceipt();
  }, [loadReceipt, refreshTick]);

  // --- read the timing-critical values from CHAIN (never the indexer clock) --
  // Targets the receipt's own escrow instance (multi-asset).
  const refreshChain = useCallback(async () => {
    if (!validId || !paymentId) return;
    try {
      const [view, now] = await Promise.all([
        readReceiptFromChain(paymentId, escrowAddr),
        readChainNow(),
      ]);
      setChain(view);
      setChainNow(now);
      setChainError(null);
    } catch (err) {
      setChainError(
        `Chain read failed: ${err instanceof Error ? err.message : String(err)}. Time-sensitive buttons stay locked until the chain answers.`,
      );
    }
  }, [paymentId, validId, escrowAddr]);

  useEffect(() => {
    void refreshChain();
  }, [refreshChain, refreshTick]);

  // Re-read chain time while the receipt is in a time-sensitive state.
  const receipt = load.kind === "ready" ? load.receipt : null;
  const status = receipt ? normalizeStatus(receipt.status) : "UNKNOWN";
  // Payment-token symbol for display: prefer the API's derived `token`,
  // fall back to the escrow-address map, default USDC (pre-multi-asset).
  const symbol: PaymentTokenSymbol =
    receipt?.token === "EURC" ? "EURC" : (tokenSymbolForEscrow(receipt?.escrow) ?? "USDC");
  useEffect(() => {
    if (status !== "ATTESTED" && status !== "OPEN") return;
    const t = setInterval(() => void refreshChain(), 15_000);
    return () => clearInterval(t);
  }, [status, refreshChain]);

  // --- derived gating -------------------------------------------------------
  const isBuyer = !!wallet && !!receipt && eqAddr(wallet, receipt.buyer);
  const isSeller = !!wallet && !!receipt && eqAddr(wallet, receipt.seller);

  const unlockTime =
    chain && chain.attestedAt > 0n
      ? chain.attestedAt + chain.challengeWindow
      : null;
  const windowOpen =
    unlockTime !== null && chainNow !== null ? chainNow < unlockTime : null;
  const deadlineTs = receipt ? toUnixSeconds(receipt.deadline) : null;
  const deadlinePassed =
    deadlineTs !== null && chainNow !== null ? chainNow > deadlineTs : null;

  const statusMismatch =
    chain &&
    chain.statusName !== "UNKNOWN" &&
    chain.statusName !== "NONE" &&
    chain.statusName !== status
      ? `Indexer says ${status}, chain says ${chain.statusName}. The chain wins — buttons below follow the chain.`
      : null;

  // --- wallet ---------------------------------------------------------------
  const onConnect = useCallback(async () => {
    setWalletError(null);
    try {
      const addr = await connectWallet();
      setWallet(addr);
    } catch (err) {
      setWalletError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  useEffect(() => {
    const provider = getInjectedProvider();
    if (!provider?.on) return;
    const onAccounts = (...a: unknown[]) => {
      const acc = a[0] as string[] | undefined;
      setWallet(acc && acc[0] ? (acc[0] as `0x${string}`) : null);
    };
    provider.on("accountsChanged", onAccounts);
    return () => provider.removeListener?.("accountsChanged", onAccounts);
  }, []);

  // --- send flow (shared by dialogs and the preview panel) -------------------
  // Sends the EXACT preview the user already reviewed — never rebuilt, so
  // what the wallet signs is byte-identical to what was shown.
  const sendAction = useCallback(
    async (preview: ActionTxPreview) => {
      if (!validId || !wallet) return;
      const provider = getInjectedProvider();
      if (!provider) {
        const msg = "No wallet provider found.";
        setActionError(msg);
        toast.error(msg);
        return;
      }
      setSending(true);
      setActionError(null);
      setActionDone(null);
      setSentTx(null);
      const toastId = `rc-tx-${preview.kind}-${Date.now()}`;
      try {
        const { hash, confirmed } = await signAndBroadcast(
          provider,
          wallet,
          preview,
          {
            onTxHash: (h) => {
              setSentTx(h);
              toast.loading("Transaction sent — waiting for confirmation.", {
                id: toastId,
                description: (
                  <a
                    href={txUrl(h)}
                    target="_blank"
                    rel="noreferrer"
                    style={{ color: "#35E0FF" }}
                  >
                    {shortHex(h)} ↗
                  </a>
                ),
              });
            },
          },
        );
        if (!confirmed) {
          const msg = `Transaction ${shortHex(hash)} was mined but REVERTED. Nothing changed on-chain.`;
          setActionError(`${msg} Check the explorer for the revert reason.`);
          toast.error("Transaction reverted.", {
            id: toastId,
            description: "Nothing changed on-chain.",
          });
        } else {
          const done = `${ACTION_COPY[preview.kind].pastTense} on-chain (${shortHex(hash)}).`;
          setActionDone(done);
          toast.success(done, { id: toastId });
          setPendingAction(null);
          setDialogPreview(null);
          setRefreshTick((t) => t + 1); // reload receipt + chain state
        }
      } catch (err) {
        if (err instanceof UserRejectedError) {
          setActionError(err.message);
          toast.dismiss(toastId);
        } else {
          const msg = `Send failed: ${err instanceof Error ? err.message : String(err)}`;
          setActionError(msg);
          toast.error("Send failed.", {
            id: toastId,
            description: err instanceof Error ? err.message : String(err),
          });
        }
      } finally {
        setSending(false);
      }
    },
    [validId, wallet],
  );

  /** Non-destructive step 1: show the exact tx, then the wallet prompt. */
  const openPreview = useCallback(
    (
      kind: Extract<ActionKind, "attest" | "capture">,
      extra?: { outputHash?: `0x${string}` },
    ) => {
      if (!validId || !paymentId) return;
      setActionError(null);
      setActionDone(null);
      setSentTx(null);
      try {
        setPendingAction({ kind, preview: buildActionTx(kind, paymentId, extra, escrowAddr) });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        setActionError(msg);
        toast.error(msg);
      }
    },
    [paymentId, validId, escrowAddr],
  );

  /** Destructive step 1: build the exact-tx preview shown inside the dialog. */
  const openDestructivePreview = useCallback(
    (
      kind: Extract<ActionKind, "flag" | "void" | "voidAfterDeadline">,
      extra?: { reasonHash?: `0x${string}` },
    ) => {
      if (!validId || !paymentId) return;
      try {
        setDialogPreview(buildActionTx(kind, paymentId, extra, escrowAddr));
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        setActionError(msg);
        toast.error(msg);
        setDialogPreview(null);
      }
    },
    [paymentId, validId, escrowAddr],
  );

  const cancelPreview = useCallback(() => {
    if (sending) return;
    setPendingAction(null);
    setSentTx(null);
  }, [sending]);

  // --- attest form: compute sha256 of pasted bytes --------------------------
  const onComputeAttestHash = useCallback(async () => {
    setAttestHashError(null);
    try {
      const bytes = new TextEncoder().encode(attestBytes);
      const h = await sha256HexBytes(bytes);
      setAttestHash(h);
    } catch (err) {
      setAttestHashError(err instanceof Error ? err.message : String(err));
    }
  }, [attestBytes]);

  const onAttestHashManual = useCallback((v: string) => {
    const t = v.trim();
    setAttestHash(t);
    setAttestHashError(
      t && !/^0x[0-9a-fA-F]{64}$/.test(t)
        ? "Must be 0x + 64 hex chars — the sha256 of the exact delivered bytes."
        : null,
    );
  }, []);

  const flagReasonHash = useMemo(
    () =>
      flagReason.trim() ? keccak256(stringToHex(flagReason.trim())) : null,
    [flagReason],
  );

  // --- verify helper ----------------------------------------------------------
  const onVerifyText = useCallback(async () => {
    setVerifyResult(null);
    if (!receipt?.outputHash) return;
    const h = await sha256HexBytes(new TextEncoder().encode(verifyInput));
    setVerifyResult({
      ok: h.toLowerCase() === receipt.outputHash.toLowerCase(),
      computed: h,
    });
  }, [verifyInput, receipt]);

  const onVerifyFile = useCallback(
    async (f: File | undefined) => {
      setVerifyResult(null);
      if (!f || !receipt?.outputHash) return;
      const buf = new Uint8Array(await f.arrayBuffer());
      const h = await sha256HexBytes(buf);
      setVerifyResult({
        ok: h.toLowerCase() === receipt.outputHash.toLowerCase(),
        computed: h,
      });
    },
    [receipt],
  );

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  if (load.kind === "loading") {
    return (
      <div className="rc-detail">
        <Toaster />
        <div className="rc-skeleton rc-skeleton-title" />
        <div className="rc-skeleton" />
        <div className="rc-skeleton" />
        <div className="rc-skeleton" />
      </div>
    );
  }

  if (load.kind !== "ready") {
    return (
      <div className="rc-detail">
        <Toaster />
        <Link to="/dashboard" className="rc-back">
          ← All receipts
        </Link>
        <div className="rc-panel rc-panel-error" role="alert">
          <h1>Couldn&apos;t load this receipt</h1>
          {"message" in load && <p>{load.message}</p>}
          {load.kind === "invalid-id" && (
            <p>
              Expected a paymentId like <code>0x…</code> (64 hex chars).
            </p>
          )}
          <button
            className="rc-btn rc-btn-primary"
            onClick={() => setRefreshTick((t) => t + 1)}
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  const r = receipt as ReceiptDetail;
  const pillClass =
    status === "CAPTURED"
      ? "rc-pill rc-pill-captured"
      : status === "VOIDED"
        ? "rc-pill rc-pill-voided"
        : status === "FLAGGED"
          ? "rc-pill rc-pill-flagged"
          : "rc-pill";
  const meaning = STATUS_MEANING[status];
  const chainWindowSecs = chain ? Number(chain.challengeWindow) : null;

  // Capability checks (role by on-chain record, never by allowlist)
  const windowStillOpen = status === "ATTESTED" && windowOpen === true;
  const windowClosed = status === "ATTESTED" && windowOpen === false;
  const canVoidAfterDeadline = status === "OPEN" && deadlinePassed === true;

  return (
    <div className="rc-detail">
      <Toaster />
      <Link to="/dashboard" className="rc-back">
        ← All receipts
      </Link>

      {/* (1) Header: status pill + plain meaning --------------------------- */}
      <header className="rc-panel rc-header">
        <div className="rc-header-top">
          <span className={pillClass}>{status}</span>
          {meaning && <p className="rc-meaning">{meaning}</p>}
        </div>
        <h1 className="rc-payment-id" title={r.paymentId}>
          {shortHex(r.paymentId, 10, 8)}
        </h1>
        <p className="rc-payment-id-full">
          <code>{r.paymentId}</code>
        </p>
        {status === "ATTESTED" && unlockTime !== null && (
          <p className="rc-window-line">
            Challenge window open until{" "}
            <strong>{formatChainTime(unlockTime)}</strong>
            {chainNow !== null && windowOpen && (
              <span className="rc-countdown">
                {" "}
                — closes {countdownText(unlockTime, chainNow)} (chain time)
              </span>
            )}
          </p>
        )}
        {statusMismatch && (
          <p className="rc-warn" role="alert">
            ⚠ {statusMismatch}
          </p>
        )}
        {chainError && (
          <p className="rc-warn" role="alert">
            ⚠ {chainError}
          </p>
        )}
      </header>

      {/* (2) Timeline — animated-list entrances ------------------------------ */}
      <section className="rc-panel" aria-label="Timeline">
        <h2>Timeline</h2>
        <p className="rc-muted">
          Every state transition, rebuilt from chain events and Memo anchors.
        </p>
        {r.timeline.length === 0 ? (
          <p className="rc-muted">No transitions recorded yet.</p>
        ) : (
          <ol className="rc-timeline">
            {r.timeline.map((e, i) => (
              <li
                key={`${e.txHash}-${i}`}
                className="rc-timeline-row"
                style={{ "--rc-i": i } as CSSProperties}
              >
                <div className="rc-timeline-event">{e.event}</div>
                <div className="rc-timeline-meta">
                  <a
                    href={txUrl(e.txHash)}
                    target="_blank"
                    rel="noreferrer"
                    className="rc-txlink"
                  >
                    {shortHex(e.txHash)} ↗
                  </a>
                  {e.memoIndex !== null && e.memoIndex !== undefined && (
                    <span className="rc-memo-idx">Memo #{e.memoIndex}</span>
                  )}
                  {e.blockTime !== null && e.blockTime !== undefined && (
                    <span className="rc-block-time">
                      {formatChainTime(toUnixSeconds(e.blockTime) ?? 0n)}
                    </span>
                  )}
                </div>
              </li>
            ))}
          </ol>
        )}
      </section>

      {/* (3) Terms panel ---------------------------------------------------- */}
      <section className="rc-panel" aria-label="Terms">
        <h2>Terms</h2>
        <dl className="rc-kv">
          <div>
            <dt>Buyer</dt>
            <dd>
              <a href={addressUrl(r.buyer)} target="_blank" rel="noreferrer">
                <code>{r.buyer}</code> ↗
              </a>
            </dd>
          </div>
          <div>
            <dt>Seller</dt>
            <dd>
              <a href={addressUrl(r.seller)} target="_blank" rel="noreferrer">
                <code>{r.seller}</code> ↗
              </a>
            </dd>
          </div>
          <div>
            <dt>Amount</dt>
            <dd className="rc-amount-inline">
              <TokenIcon token={symbol} size={22} />
              {formatUSDC(r.amount)} {symbol}{" "}
              <span className="rc-muted">({r.amount} base units)</span>
            </dd>
          </div>
          <div>
            <dt>Delivery deadline</dt>
            <dd>
              {deadlineTs !== null ? (
                <>
                  {formatChainTime(deadlineTs)}{" "}
                  {deadlinePassed === true && (
                    <span className="rc-tag rc-tag-red">passed</span>
                  )}
                  {deadlinePassed === false && chainNow !== null && (
                    <span className="rc-muted">
                      ({countdownText(deadlineTs, chainNow)} left, chain time)
                    </span>
                  )}
                </>
              ) : (
                <span className="rc-muted">not set</span>
              )}
            </dd>
          </div>
          <div>
            <dt>termsHash</dt>
            <dd>
              <code>{r.termsHash}</code>
            </dd>
          </div>
        </dl>
        {r.terms && (
          <>
            <h3>Signed terms JSON</h3>
            <pre className="rc-code">
              {typeof r.terms === "string"
                ? r.terms
                : JSON.stringify(r.terms, null, 2)}
            </pre>
          </>
        )}
      </section>

      {/* (4) Delivery panel --------------------------------------------------- */}
      <section className="rc-panel" aria-label="Delivery">
        <h2>Delivery</h2>
        {r.outputHash ? (
          <>
            <dl className="rc-kv">
              <div>
                <dt>outputHash</dt>
                <dd>
                  <code>{r.outputHash}</code>
                </dd>
              </div>
              {r.attestedAt && (
                <div>
                  <dt>Attested at</dt>
                  <dd>{formatChainTime(toUnixSeconds(r.attestedAt) ?? 0n)}</dd>
                </div>
              )}
            </dl>
            <h3>Verify the delivery yourself</h3>
            <p className="rc-muted">
              Paste the exact bytes the seller delivered (or upload the file).
              This page recomputes sha256 locally and compares it to the
              on-chain <code>outputHash</code>. Nothing leaves your browser.
            </p>
            <textarea
              className="rc-textarea"
              rows={4}
              placeholder="Paste the delivered bytes here…"
              value={verifyInput}
              onChange={(e) => {
                setVerifyInput(e.target.value);
                setVerifyResult(null);
              }}
            />
            <div className="rc-row">
              <button
                className="rc-btn rc-btn-ghost"
                onClick={() => void onVerifyText()}
              >
                Check pasted bytes
              </button>
              <button
                className="rc-btn rc-btn-ghost"
                onClick={() => fileRef.current?.click()}
              >
                Check a file…
              </button>
              <input
                ref={fileRef}
                type="file"
                hidden
                onChange={(e) => void onVerifyFile(e.target.files?.[0])}
              />
            </div>
            {verifyResult && (
              <p
                className={verifyResult.ok ? "rc-verify-ok" : "rc-verify-bad"}
                role="status"
              >
                {verifyResult.ok ? "✓ MATCH" : "✗ NO MATCH"} — sha256 ={" "}
                <code>{verifyResult.computed}</code>
                {!verifyResult.ok && (
                  <>
                    {" "}
                    vs on-chain <code>{r.outputHash}</code>
                  </>
                )}
              </p>
            )}
          </>
        ) : (
          <p className="rc-muted">
            No delivery confirmed yet. The seller posts a sha256 of the exact
            delivered bytes when they confirm.
          </p>
        )}
        {status === "FLAGGED" && (
          <dl className="rc-kv">
            <div>
              <dt>Flagged by</dt>
              <dd>
                <code>{r.flaggedBy ?? "—"}</code>
              </dd>
            </div>
            <div>
              <dt>reasonHash</dt>
              <dd>
                <code>{r.flagReasonHash ?? "—"}</code>
              </dd>
            </div>
          </dl>
        )}
      </section>

      {/* (5) Action area — capability-gated, never identity-gated ------------- */}
      <section className="rc-panel" aria-label="Actions">
        <h2>Actions</h2>
        {!wallet ? (
          <div className="rc-connect">
            <p className="rc-muted">
              Connect a wallet to act. Roles come from the on-chain record
              (buyer / seller), never from an allowlist — any wallet can
              finalize.
            </p>
            <button
              className="rc-btn rc-btn-primary"
              onClick={() => void onConnect()}
            >
              Connect wallet
            </button>
            {walletError && (
              <p className="rc-error" role="alert">
                {walletError}
              </p>
            )}
          </div>
        ) : (
          <p className="rc-muted">
            Connected: <code>{wallet}</code>
            {isBuyer && <span className="rc-tag">you are the buyer</span>}
            {isSeller && <span className="rc-tag">you are the seller</span>}
            {!isBuyer && !isSeller && (
              <span className="rc-tag">
                third party — you can still finalize
              </span>
            )}
          </p>
        )}

        {actionDone && (
          <p className="rc-success" role="status">
            ✓ {actionDone}{" "}
            <button
              className="rc-link-btn"
              onClick={() => {
                setActionDone(null);
                setSentTx(null);
              }}
            >
              Dismiss
            </button>
          </p>
        )}
        {actionError && (
          <p className="rc-error" role="alert">
            {actionError}
          </p>
        )}

        <div className="rc-actions">
          {/* Flag a problem — buyer only, inside the window (DESTRUCTIVE) */}
          {status === "ATTESTED" && windowOpen !== false && (
            <div className="rc-action">
              <h3>Flag a problem</h3>
              {!wallet ? (
                <ActionDisabled reason="Connect your wallet to flag. Only the recorded buyer can flag." />
              ) : !isBuyer ? (
                <ActionDisabled
                  reason={`Only the recorded buyer (${shortHex(r.buyer)}) can flag this receipt. Your wallet is not the buyer — but you can still release or refund once those unlock.`}
                />
              ) : windowOpen === null ? (
                <ActionDisabled reason="Waiting for the chain to report the challenge window — the button unlocks when the chain answers, never on the indexer's clock." />
              ) : (
                <>
                  <label className="rc-label" htmlFor="flag-reason">
                    What went wrong? (plain text — hashed on-chain as the
                    dispute record)
                  </label>
                  <textarea
                    id="flag-reason"
                    className="rc-textarea"
                    rows={3}
                    placeholder="e.g. Paid call returned HTTP 400; delivered bytes are random, not the quoted report."
                    value={flagReason}
                    onChange={(e) => setFlagReason(e.target.value)}
                  />
                  {flagReasonHash && (
                    <p className="rc-muted">
                      reasonHash = <code>{flagReasonHash}</code>
                    </p>
                  )}
                  <AlertDialog>
                    <AlertDialogTrigger
                      className="rc-btn rc-btn-danger"
                      disabled={!flagReason.trim() || sending}
                      onClick={() =>
                        openDestructivePreview("flag", {
                          reasonHash: flagReasonHash as `0x${string}`,
                        })
                      }
                    >
                      {sending ? (
                        <>
                          <span className="rc-btn-spinner" aria-hidden="true" />
                          Working…
                        </>
                      ) : (
                        "Flag a problem"
                      )}
                    </AlertDialogTrigger>
                    <AlertDialogContent tone="destructive">
                      <AlertDialogHeader>
                        <AlertDialogTitle>
                          Flag a problem with this delivery?
                        </AlertDialogTitle>
                        <AlertDialogDescription>
                          Flagging starts the void path: anyone can then void
                          and your {formatUSDC(r.amount)} {symbol} returns on-chain.
                          A defeated flag costs you the flag stake (see terms).
                          This cannot be undone on-chain.
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <p className="rc-muted" style={{ margin: "0 0 8px" }}>
                        Your wallet will be asked to sign exactly this
                        transaction:
                      </p>
                      {dialogPreview?.kind === "flag" ? (
                        <TxPreview preview={dialogPreview} />
                      ) : (
                        <p className="rc-error">
                          Could not build the transaction preview — cancel and
                          try again.
                        </p>
                      )}
                      <AlertDialogFooter>
                        <AlertDialogCancel>
                          Keep the receipt as is
                        </AlertDialogCancel>
                        <AlertDialogAction
                          disabled={
                            !flagReason.trim() ||
                            sending ||
                            dialogPreview?.kind !== "flag"
                          }
                          onClick={() => {
                            if (dialogPreview) void sendAction(dialogPreview);
                          }}
                        >
                          {sending ? "Working…" : "Flag a problem"}
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                  <TechnicalNote kind="flag" />
                  {unlockTime && chainNow !== null && (
                    <p className="rc-muted">
                      Window closes {countdownText(unlockTime, chainNow)} (chain
                      time).
                    </p>
                  )}
                </>
              )}
            </div>
          )}

          {/* Release to seller — anyone, only after the window closed (chain) */}
          {status === "ATTESTED" && (
            <div className="rc-action">
              <h3>Release to seller</h3>
              {windowClosed ? (
                <>
                  <p className="rc-muted">
                    The challenge window closed on-chain with no flag. Anyone
                    can finalize — that&apos;s the design, not a bug.{" "}
                    {formatUSDC(r.amount)} {symbol} goes to the seller.
                  </p>
                  <button
                    className={
                      pendingAction?.kind === "capture"
                        ? "rc-btn rc-btn-ghost"
                        : "rc-btn rc-btn-primary"
                    }
                    disabled={!wallet || pendingAction !== null || sending}
                    onClick={() => openPreview("capture")}
                  >
                    Release to seller
                  </button>
                  {!wallet && (
                    <p className="rc-muted">
                      Connect any wallet to submit — releasing is permissionless.
                    </p>
                  )}
                  <TechnicalNote kind="capture" />
                </>
              ) : (
                <ActionDisabled
                  reason={
                    unlockTime && chainWindowSecs !== null
                      ? `Release unlocks at ${formatChainTime(unlockTime)} (attestedAt + ${chainWindowSecs}s on-chain).`
                      : "Waiting for the chain to report attestedAt + challengeWindow — never the indexer's clock."
                  }
                  countdown={
                    unlockTime && chainNow !== null && windowStillOpen
                      ? `Unlocks ${countdownText(unlockTime, chainNow)} (chain time).`
                      : undefined
                  }
                />
              )}
            </div>
          )}

          {/* Refund — anyone, only in FLAGGED (DESTRUCTIVE) */}
          {status === "FLAGGED" && (
            <div className="rc-action">
              <h3>Refund</h3>
              <p className="rc-muted">
                The buyer flagged a problem. Anyone can refund — the full{" "}
                {formatUSDC(r.amount)} {symbol} returns to the buyer on-chain.
              </p>
              {!wallet ? (
                <ActionDisabled reason="Connect any wallet to submit — refunding is permissionless." />
              ) : (
                <>
                  <AlertDialog>
                    <AlertDialogTrigger
                      className="rc-btn rc-btn-primary"
                      disabled={sending}
                      onClick={() => openDestructivePreview("void")}
                    >
                      {sending ? (
                        <>
                          <span className="rc-btn-spinner" aria-hidden="true" />
                          Working…
                        </>
                      ) : (
                        "Refund"
                      )}
                    </AlertDialogTrigger>
                    <AlertDialogContent tone="destructive">
                      <AlertDialogHeader>
                        <AlertDialogTitle>
                          Refund the buyer {formatUSDC(r.amount)} {symbol}?
                        </AlertDialogTitle>
                        <AlertDialogDescription>
                          This voids the receipt: the full escrowed amount
                          returns to the buyer on-chain, and the receipt becomes
                          permanent non-delivery evidence. This cannot be
                          undone.
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <p className="rc-muted" style={{ margin: "0 0 8px" }}>
                        Your wallet will be asked to sign exactly this
                        transaction:
                      </p>
                      {dialogPreview?.kind === "void" ? (
                        <TxPreview preview={dialogPreview} />
                      ) : (
                        <p className="rc-error">
                          Could not build the transaction preview — cancel and
                          try again.
                        </p>
                      )}
                      <AlertDialogFooter>
                        <AlertDialogCancel>Don&apos;t refund</AlertDialogCancel>
                        <AlertDialogAction
                          disabled={sending || dialogPreview?.kind !== "void"}
                          onClick={() => {
                            if (dialogPreview) void sendAction(dialogPreview);
                          }}
                        >
                          {sending ? "Working…" : "Refund"}
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                  <TechnicalNote kind="void" />
                </>
              )}
            </div>
          )}

          {/* Refund after the deadline — anyone, only OPEN + deadline passed */}
          {status === "OPEN" && (
            <div className="rc-action">
              <h3>Refund after the deadline</h3>
              {canVoidAfterDeadline ? (
                <>
                  <p className="rc-muted">
                    The seller never confirmed by the deadline. Anyone can
                    refund — the full {formatUSDC(r.amount)} {symbol} returns to
                    the buyer on-chain. Funds never trap.
                  </p>
                  {!wallet ? (
                    <ActionDisabled reason="Connect any wallet to submit — refunding is permissionless." />
                  ) : (
                    <>
                      <AlertDialog>
                        <AlertDialogTrigger
                          className="rc-btn rc-btn-primary"
                          disabled={sending}
                          onClick={() =>
                            openDestructivePreview("voidAfterDeadline")
                          }
                        >
                          {sending ? (
                            <>
                              <span
                                className="rc-btn-spinner"
                                aria-hidden="true"
                              />
                              Working…
                            </>
                          ) : (
                            "Refund"
                          )}
                        </AlertDialogTrigger>
                        <AlertDialogContent tone="destructive">
                          <AlertDialogHeader>
                            <AlertDialogTitle>
                              Refund the buyer {formatUSDC(r.amount)} {symbol}?
                            </AlertDialogTitle>
                            <AlertDialogDescription>
                              The deadline passed with no delivery confirmed.
                              This voids the receipt and returns the full
                              escrowed amount to the buyer on-chain. This
                              cannot be undone.
                            </AlertDialogDescription>
                          </AlertDialogHeader>
                          <p
                            className="rc-muted"
                            style={{ margin: "0 0 8px" }}
                          >
                            Your wallet will be asked to sign exactly this
                            transaction:
                          </p>
                          {dialogPreview?.kind === "voidAfterDeadline" ? (
                            <TxPreview preview={dialogPreview} />
                          ) : (
                            <p className="rc-error">
                              Could not build the transaction preview — cancel
                              and try again.
                            </p>
                          )}
                          <AlertDialogFooter>
                            <AlertDialogCancel>
                              Don&apos;t refund
                            </AlertDialogCancel>
                            <AlertDialogAction
                              disabled={
                                sending ||
                                dialogPreview?.kind !== "voidAfterDeadline"
                              }
                              onClick={() => {
                                if (dialogPreview) void sendAction(dialogPreview);
                              }}
                            >
                              {sending ? "Working…" : "Refund"}
                            </AlertDialogAction>
                          </AlertDialogFooter>
                        </AlertDialogContent>
                      </AlertDialog>
                      <TechnicalNote kind="voidAfterDeadline" />
                    </>
                  )}
                </>
              ) : (
                <ActionDisabled
                  reason={
                    deadlineTs !== null
                      ? `Available after the deadline (${formatChainTime(deadlineTs)}), while the receipt is still OPEN.`
                      : "Deadline unknown — cannot offer a post-deadline refund."
                  }
                  countdown={
                    deadlineTs !== null &&
                    chainNow !== null &&
                    deadlinePassed === false
                      ? `Deadline ${countdownText(deadlineTs, chainNow)} (chain time).`
                      : undefined
                  }
                />
              )}
            </div>
          )}

          {/* Confirm delivery — seller only, while OPEN */}
          {status === "OPEN" && (
            <div className="rc-action">
              <h3>Confirm delivery</h3>
              {!wallet ? (
                <ActionDisabled reason="Connect your wallet to confirm. Only the recorded seller can confirm." />
              ) : !isSeller ? (
                <ActionDisabled
                  reason={`Only the recorded seller (${shortHex(r.seller)}) can confirm delivery. Your wallet is not the seller.`}
                />
              ) : (
                <>
                  <p className="rc-muted">
                    Post the sha256 of the <em>exact bytes</em> you delivered.
                    Paste the bytes to compute it, or enter the hash directly.
                  </p>
                  <label className="rc-label" htmlFor="attest-bytes">
                    Delivered bytes (to hash)
                  </label>
                  <textarea
                    id="attest-bytes"
                    className="rc-textarea"
                    rows={3}
                    placeholder="Paste the exact delivered bytes…"
                    value={attestBytes}
                    disabled={pendingAction?.kind === "attest"}
                    onChange={(e) => setAttestBytes(e.target.value)}
                  />
                  <div className="rc-row">
                    <button
                      className="rc-btn rc-btn-ghost"
                      disabled={
                        !attestBytes || pendingAction?.kind === "attest"
                      }
                      onClick={() => void onComputeAttestHash()}
                    >
                      Compute sha256
                    </button>
                  </div>
                  <label className="rc-label" htmlFor="attest-hash">
                    outputHash
                  </label>
                  <input
                    id="attest-hash"
                    className="rc-input"
                    placeholder="0x… (64 hex chars)"
                    value={attestHash}
                    disabled={pendingAction?.kind === "attest"}
                    onChange={(e) => onAttestHashManual(e.target.value)}
                  />
                  {attestHashError && (
                    <p className="rc-error">{attestHashError}</p>
                  )}
                  <p className="rc-consequence">
                    Confirming opens the {chainWindowSecs ?? 300}s challenge
                    window: the buyer can flag a problem until it closes, and
                    anyone can then refund for a full on-chain refund.
                  </p>
                  <button
                    className={
                      pendingAction?.kind === "attest"
                        ? "rc-btn rc-btn-ghost"
                        : "rc-btn rc-btn-primary"
                    }
                    disabled={
                      !/^0x[0-9a-fA-F]{64}$/.test(attestHash) ||
                      pendingAction !== null ||
                      sending
                    }
                    onClick={() =>
                      openPreview("attest", {
                        outputHash: attestHash as `0x${string}`,
                      })
                    }
                  >
                    Confirm delivery
                  </button>
                  <TechnicalNote kind="attest" />
                </>
              )}
            </div>
          )}

          {(status === "CAPTURED" || status === "VOIDED") && (
            <p className="rc-muted">
              This receipt is terminal ({status}). No further actions exist —
              the full history is in the timeline above.
            </p>
          )}
        </div>

        {/* Tx preview — the EXACT tx, shown BEFORE the wallet prompt */}
        {pendingAction && (
          <div
            className="rc-preview"
            role="dialog"
            aria-label="Transaction preview"
          >
            <h3>Review the exact transaction</h3>
            <p className="rc-muted">
              Your wallet will be asked to sign <em>exactly</em> this. Nothing
              else. If anything differs in the wallet prompt, reject it.
            </p>
            <TxPreview preview={pendingAction.preview} />
            {sentTx && (
              <p className="rc-pending" role="status">
                Transaction sent:{" "}
                <a href={txUrl(sentTx)} target="_blank" rel="noreferrer">
                  {shortHex(sentTx)} ↗
                </a>{" "}
                — waiting for confirmation. Not done yet.
              </p>
            )}
            <div className="rc-row">
              <button
                className="rc-btn rc-btn-primary"
                disabled={sending}
                onClick={() => void sendAction(pendingAction.preview)}
              >
                {sending ? (
                  <>
                    <span className="rc-btn-spinner" aria-hidden="true" />
                    Waiting for wallet…
                  </>
                ) : (
                  "Sign & send in wallet"
                )}
              </button>
              <button
                className="rc-btn rc-btn-ghost"
                disabled={sending}
                onClick={cancelPreview}
              >
                Cancel
              </button>
            </div>
          </div>
        )}
      </section>

      {/* (6) "What you have to trust" — on the page, never in a FAQ --------- */}
      <section className="rc-panel rc-trust" aria-label="What you have to trust">
        <p className="rc-eyebrow">READ THIS FIRST. NOT A FAQ.</p>
        <h2>What you have to trust</h2>
        <ul>
          <li>
            <strong>A confirmation is a claim, not proof.</strong> The
            seller&apos;s <code>outputHash</code> proves they delivered{" "}
            <em>something</em> — it does not prove they delivered what the
            terms describe. Use the verify helper above on the real bytes.
          </li>
          <li>
            <strong>The challenge window is the leverage.</strong> If the buyer
            doesn&apos;t inspect the delivery before the window closes
            (on-chain time, shown above), the seller gets paid. The receipt
            gives you the time and the evidence; the looking is on you.
          </li>
          <li>
            <strong>Quality you can&apos;t hash stays human.</strong> A hash
            can&apos;t measure correctness or &ldquo;good enough&rdquo; —
            disputes are settled by the flag → refund path, not by math.
          </li>
          <li>
            <strong>The record is permanent and public.</strong> Every state
            change is Memo-anchored on-chain. Anyone — a marketplace, an
            auditor, a stranger — can re-derive this receipt from chain logs
            alone.
          </li>
          <li>
            <strong>This page&apos;s receipt body is a cache.</strong> The
            indexer replays on-chain events; if it ever disagrees with the
            chain, the chain wins. All time-sensitive gates on this page read
            the chain directly.
          </li>
        </ul>
      </section>
    </div>
  );
}

function ActionDisabled({
  reason,
  countdown,
}: {
  reason: string;
  countdown?: string;
}) {
  return (
    <div className="rc-disabled-note" role="note">
      <p>{reason}</p>
      {countdown && <p className="rc-countdown-live">{countdown}</p>}
    </div>
  );
}
