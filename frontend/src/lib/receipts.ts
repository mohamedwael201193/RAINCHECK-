// Receipt data access for the RAINCHECK dashboard.
// Source: GET /api/receipts on the Receipt API (VITE_API_URL).
// The indexer is a cache over eth_getLogs — every receipt served here must be
// re-derivable from chain logs + Memo anchors. Never invent state here.

export type ReceiptStatus = "OPEN" | "ATTESTED" | "FLAGGED" | "CAPTURED" | "VOIDED";

const KNOWN_STATUSES: readonly ReceiptStatus[] = [
  "OPEN",
  "ATTESTED",
  "FLAGGED",
  "CAPTURED",
  "VOIDED",
];

/** Minimal receipt view the dashboard list needs. Amounts are 6-decimal base units as strings. */
export interface Receipt {
  paymentId: string;
  seller: string;
  buyer?: string;
  /** 6-decimal base units, e.g. "1000" = 0.001 of the payment token */
  amount: string;
  status: ReceiptStatus | string;
  /** Payment token symbol ("USDC" | "EURC"); absent = USDC (pre-multi-asset). */
  token?: string;
  /** Protocol tier: "V1" (default) or "V2" (experimental). */
  protocol?: "V1" | "V2";
  /** Originating escrow instance address, when known (always set for V2). */
  escrow?: string;
  /** unix milliseconds; undefined = unknown (sorts last) */
  updatedAt?: number;
}

/**
 * Normalize a V2 chain status name (from readV2ReceiptFromChain) to the
 * dashboard ReceiptStatus. V2 shares V1's status ordinals, so this is a
 * straight pass-through with a safety net.
 */
export function normalizeStatusForV2(statusName: string): ReceiptStatus | string {
  const up = statusName.trim().toUpperCase();
  return (KNOWN_STATUSES as readonly string[]).includes(up) ? up : "OPEN";
}

/** Plain-meaning copy per status (build bible §8.1 S3). Pill styling lives in CSS. */
export const STATUS_MEANING: Record<ReceiptStatus, string> = {
  OPEN: "money locked, waiting for delivery",
  ATTESTED: "seller says delivered, challenge open",
  FLAGGED: "under dispute",
  VOIDED: "refunded on-chain",
  CAPTURED: "seller paid",
};

export function apiBase(): string | null {
  // KEEP the `(import.meta as {...}).env` member access literal on this line:
  // Vite only injects import.meta.env when it sees that exact shape.
  const env = (import.meta as { env?: Record<string, unknown> }).env ?? {};
  const fromMeta = typeof env.VITE_API_URL === "string" ? env.VITE_API_URL : "";
  // Vitest 2.1 `vi.stubEnv` writes process.env only — import.meta.env is not
  // updated — so tests (and any non-Vite runner) are read from here second.
  const proc = (globalThis as { process?: { env?: Record<string, string | undefined> } })
    .process;
  const fromProcess =
    typeof proc?.env?.VITE_API_URL === "string" ? proc.env.VITE_API_URL : "";
  const base = (fromMeta || fromProcess).trim().replace(/\/+$/, "");
  return base || null;
}

/** Normalize a raw status string (handles e.g. "CHALLENGED" from older indexers) to a known status. */
function normalizeStatus(raw: unknown): ReceiptStatus | string {
  if (typeof raw !== "string") return "OPEN";
  const up = raw.trim().toUpperCase();
  if (up === "CHALLENGED") return "FLAGGED";
  return (KNOWN_STATUSES as readonly string[]).includes(up) ? up : up;
}

/** Normalize an updated-time value to unix milliseconds; 0 = unknown. */
function normalizeUpdatedAt(v: unknown): number | undefined {
  if (typeof v === "number" && Number.isFinite(v)) return v < 1e12 ? v * 1000 : v;
  if (typeof v === "string") {
    const n = Number(v);
    if (Number.isFinite(n)) return n < 1e12 ? n * 1000 : n;
    const t = Date.parse(v);
    return Number.isNaN(t) ? undefined : t;
  }
  return undefined;
}

function coerceReceipt(raw: unknown): Receipt | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const paymentId = typeof r.paymentId === "string" ? r.paymentId : null;
  const seller = typeof r.seller === "string" ? r.seller : null;
  if (!paymentId || !seller) return null;
  // The Receipt API serves the ORIGINAL escrowed amount as `amountUSDCBase`
  // (present for every status — open, voided, captured alike). Older shapes
  // used `amount`; prefer the explicit field, fall back gracefully.
  const amountRaw = r.amountUSDCBase ?? r.amount;
  const amount =
    typeof amountRaw === "string" || typeof amountRaw === "number"
      ? String(amountRaw)
      : "0";
  return {
    paymentId,
    seller,
    buyer: typeof r.buyer === "string" ? r.buyer : undefined,
    amount,
    status: normalizeStatus(r.status),
    token:
      r.token === "EURC" ? "EURC" : r.token === "USDC" ? "USDC" : undefined,
    protocol: r.protocol === "V2" ? "V2" : undefined,
    escrow: typeof r.escrow === "string" ? r.escrow : undefined,
    updatedAt: normalizeUpdatedAt(r.updatedAt),
  };
}

/** Fetch the receipt list, newest first. Throws on network/HTTP errors — the page renders the failure honestly. */
export async function fetchReceipts(): Promise<Receipt[]> {
  const base = apiBase();
  if (!base) {
    throw new Error(
      "VITE_API_URL is not set — the dashboard cannot reach the Receipt API.",
    );
  }
  const res = await fetch(`${base}/api/receipts`, { cache: "no-store" });
  if (!res.ok) {
    throw new Error(`Receipt API returned ${res.status} ${res.statusText}`);
  }
  const body: unknown = await res.json();
  const list = Array.isArray(body)
    ? body
    : Array.isArray((body as Record<string, unknown>)?.receipts)
      ? (body as { receipts: unknown[] }).receipts
      : [];
  const receipts = list
    .map(coerceReceipt)
    .filter((r): r is Receipt => r !== null);
  receipts.sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0));
  return receipts;
}

/** "0x1234…abcd" short form for addresses and payment ids. */
export function shortHex(hex: string, prefix = 6, suffix = 4): string {
  if (!hex || hex.length <= prefix + suffix) return hex;
  return `${hex.slice(0, prefix)}…${hex.slice(-suffix)}`;
}

/** 6-decimal USDC base units → human USDC ("1000" → "0.001"). */
export function formatUSDC(baseUnits: string): string {
  const digits = (baseUnits ?? "0").replace(/^0+(?=\d)/, "");
  const whole = digits.length > 6 ? digits.slice(0, digits.length - 6) : "0";
  const frac =
    digits.length > 6 ? digits.slice(digits.length - 6) : digits.padStart(6, "0");
  const trimmed = frac.replace(/0+$/, "");
  return trimmed ? `${whole}.${trimmed}` : whole;
}

/** Relative time ("3m ago"); exact time goes in the title attribute via formatExact. */
export function formatRelative(ms: number | undefined): string {
  if (!ms) return "time unknown";
  const s = Math.floor((Date.now() - ms) / 1000);
  if (s < 5) return "just now";
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d}d ago`;
  return new Date(ms).toLocaleDateString();
}

/** Exact local time for the title tooltip. */
export function formatExact(ms: number | undefined): string {
  if (!ms) return "No timestamp recorded";
  return new Date(ms).toLocaleString();
}

export function statusMeaning(status: ReceiptStatus | string): string {
  return (STATUS_MEANING as Record<string, string>)[status] ?? "unknown state";
}
