/**
 * Receipt print model — dependency-free data mapping for the Print / PDF view.
 *
 * buildPrintModel maps the live receipt detail (exactly what the page loaded —
 * chain-derived + indexer cache, never invented) to a flat, print-ready
 * model: every field a paper record needs, explorer links as FULL URLs (paper
 * can't click short links), and the status timeline with plain-language event
 * labels. Pure functions — unit-tested, no DOM, no network.
 */

export interface PrintTimelineInput {
  event: string;
  txHash: string;
  explorerUrl?: string | null;
  memoIndex?: number | null;
  blockTime?: number | string | null;
  blockNumber?: number | null;
}

export interface PrintReceiptInput {
  paymentId: string;
  status: string;
  buyer: string;
  seller: string;
  /** 6-decimal base units, string, in the receipt's token. */
  amount: string;
  token?: string;
  /** unix seconds (number or numeric string) */
  deadline?: number | string | null;
  termsHash: string;
  terms?: Record<string, unknown> | string | null;
  outputHash?: string | null;
  attestedAt?: number | string | null;
  flagReasonHash?: string | null;
  flaggedBy?: string | null;
  escrow?: string | null;
  timeline: PrintTimelineInput[];
  /**
   * Oracle attestation block (T0-O tier, win/oracle-tier branch). Rendered
   * only when present — the block passes whatever the indexer serves through
   * verbatim, never invented.
   */
  oracle?: unknown;
}

export interface PrintTimelineEvent {
  /** Plain-language label, e.g. "Delivery confirmed by seller". */
  label: string;
  /** Raw chain event name, e.g. "RaincheckAttested". */
  event: string;
  txHash: string;
  /** Full URL — paper can't click short links. */
  explorerUrl: string;
  memoIndex: number | null;
  blockTimeIso: string | null;
}

export interface PrintModel {
  paymentId: string;
  status: string;
  statusMeaning: string | null;
  buyer: string;
  seller: string;
  /** Display amount, e.g. "1.5" */
  amount: string;
  /** Raw 6-decimal base units, e.g. "1500000" */
  amountBaseUnits: string;
  token: string;
  deadlineIso: string | null;
  termsHash: string;
  termsJson: string | null;
  outputHash: string | null;
  attestedAtIso: string | null;
  flagReasonHash: string | null;
  flaggedBy: string | null;
  escrow: string | null;
  timeline: PrintTimelineEvent[];
  oraclePresent: boolean;
  oracleJson: string | null;
  printedAtIso: string;
}

export const ARC_EXPLORER_TX_BASE = "https://explorer.arc.io/tx";

/** Plain-meaning copy per status — bible §8.1 S3, verbatim. */
const STATUS_MEANING: Record<string, string> = {
  OPEN: "money locked, waiting for delivery",
  ATTESTED: "seller says delivered, challenge window open",
  FLAGGED: "under dispute",
  VOIDED: "refunded on-chain",
  CAPTURED: "seller paid",
};

/** Plain-language labels for the chain event names the indexer serves. */
const EVENT_LABELS: Record<string, string> = {
  RaincheckOpened: "Receipt opened — funds locked in escrow",
  RaincheckAttested: "Delivery confirmed by seller",
  RaincheckFlagged: "Delivery disputed by buyer",
  RaincheckCaptured: "Payment released to seller",
  RaincheckVoided: "Receipt voided — buyer refunded",
};

/** Plain-language label for a chain event name (raw name when unknown). */
export function eventLabel(event: string): string {
  return EVENT_LABELS[event] ?? event;
}

/** Full explorer URL for a tx hash — paper can't click short links. */
export function txExplorerUrl(txHash: string): string {
  return `${ARC_EXPLORER_TX_BASE}/${txHash}`;
}

/**
 * 6-decimal base units → display string. "1500000" -> "1.5", "1000000" -> "1".
 * Tolerant of malformed input (returns it unchanged rather than throwing —
 * a print view must never crash on odd data).
 */
export function formatBaseUnits(amount: string): string {
  const s = String(amount ?? "").trim();
  const m = /^(-?)(\d+)$/.exec(s);
  if (!m) return s;
  const [, neg, digits] = m;
  const padded = digits.padStart(7, "0");
  const whole = padded.slice(0, -6).replace(/^0+(?=\d)/, "");
  const frac = padded.slice(-6).replace(/0+$/, "");
  return `${neg}${whole}${frac ? "." + frac : ""}`;
}

/** unix seconds (number, numeric string, or ms) → ISO string, null when unknown. */
export function formatUnixIso(
  v: number | string | null | undefined | bigint,
): string | null {
  if (v === null || v === undefined || v === "") return null;
  try {
    let secs: bigint;
    if (typeof v === "bigint") {
      secs = v;
    } else if (typeof v === "number") {
      if (!Number.isFinite(v)) return null;
      secs = BigInt(Math.floor(v > 1e12 ? v / 1000 : v));
    } else {
      const t = String(v).trim();
      if (!/^\d+$/.test(t)) {
        const ms = Date.parse(t);
        return Number.isNaN(ms) ? null : new Date(ms).toISOString();
      }
      const n = BigInt(t);
      secs = n > 1_000_000_000_000n ? n / 1000n : n;
    }
    return new Date(Number(secs) * 1000).toISOString();
  } catch {
    return null;
  }
}

function prettyJson(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  if (typeof v === "string") return v;
  try {
    return JSON.stringify(v, null, 2);
  } catch {
    return String(v);
  }
}

/**
 * Map a loaded receipt detail to the print model. Every field comes from the
 * input; nothing is invented. Optional blocks (delivery, flag, oracle,
 * timeline rows) degrade to null/empty — never to placeholder text.
 */
export function buildPrintModel(input: PrintReceiptInput): PrintModel {
  const status = String(input.status ?? "").toUpperCase();
  const oraclePresent =
    input.oracle !== null && input.oracle !== undefined;
  return {
    paymentId: String(input.paymentId ?? ""),
    status,
    statusMeaning: STATUS_MEANING[status] ?? null,
    buyer: String(input.buyer ?? ""),
    seller: String(input.seller ?? ""),
    amount: formatBaseUnits(input.amount),
    amountBaseUnits: String(input.amount ?? ""),
    token: input.token ? String(input.token) : "USDC",
    deadlineIso: formatUnixIso(input.deadline),
    termsHash: String(input.termsHash ?? ""),
    termsJson: prettyJson(input.terms),
    outputHash: input.outputHash != null ? String(input.outputHash) : null,
    attestedAtIso: formatUnixIso(input.attestedAt),
    flagReasonHash:
      input.flagReasonHash != null ? String(input.flagReasonHash) : null,
    flaggedBy: input.flaggedBy != null ? String(input.flaggedBy) : null,
    escrow: input.escrow != null ? String(input.escrow) : null,
    timeline: (Array.isArray(input.timeline) ? input.timeline : []).map(
      (e) => ({
        label: eventLabel(String(e.event ?? "")),
        event: String(e.event ?? ""),
        txHash: String(e.txHash ?? ""),
        explorerUrl:
          e.explorerUrl && String(e.explorerUrl).trim()
            ? String(e.explorerUrl)
            : txExplorerUrl(String(e.txHash ?? "")),
        memoIndex:
          e.memoIndex === null || e.memoIndex === undefined
            ? null
            : Number(e.memoIndex),
        blockTimeIso: formatUnixIso(e.blockTime),
      }),
    ),
    oraclePresent,
    oracleJson: oraclePresent ? prettyJson(input.oracle) : null,
    printedAtIso: new Date().toISOString(),
  };
}
