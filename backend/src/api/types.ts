/**
 * RAINCHECK Receipt API — shared types.
 *
 * SOURCE-OF-TRUTH RULE (bible §3): chain logs are the source of truth; the
 * indexer is a cache. Every response field below MUST trace to an on-chain
 * event, a Memo anchor, or a value deterministically derived from them.
 * Fields with no chain backing are null — never invented.
 */
import { CHAIN_ID, EXPLORER, ESCROW_ADDRESS, ESCROW_ADDRESS_EURC, tokenForEscrow, type EscrowToken } from "../config.js";

export { CHAIN_ID, EXPLORER, ESCROW_ADDRESS, ESCROW_ADDRESS_EURC, tokenForEscrow, type EscrowToken };

/** Terminal + intermediate statuses from the contract's Status enum, by NAME (never ordinal). */
export type ReceiptStatus = "OPEN" | "ATTESTED" | "FLAGGED" | "VOIDED" | "CAPTURED";

export const ALL_STATUSES: readonly ReceiptStatus[] = [
  "OPEN",
  "ATTESTED",
  "FLAGGED",
  "VOIDED",
  "CAPTURED",
];

export function isReceiptStatus(v: string): v is ReceiptStatus {
  return (ALL_STATUSES as readonly string[]).includes(v);
}

/** Canonical receipt JSON (bible §4.6). Amounts are strings of 6-decimal base units. */
export interface CanonicalReceipt {
  specVersion: "raincheck-receipt/v1";
  paymentId: string;
  paymentProof: {
    settleTx: string;
    authorizationState: boolean; // true: RaincheckOpened proves transferFrom consumed the auth
    payer: string;
    amount: string; // 6-decimal base units, string
  };
  terms: {
    termsHash: string;
    endpoint: string | null; // null unless the off-chain terms bundle is supplied later
    price: string; // 6-decimal base units, string
    deadline: number; // unix seconds
  };
  delivery:
    | { outputHash: string; attestedAt: number; sellerSig: string | null }
    | { nonDelivery: { flaggedBy: string; reasonHash: string } }
    | null;
  oracle: null; // T0-O tier is specified but NOT live (bible §4.5) — never claim otherwise
  policy: null;
  funding: null;
  status: ReceiptStatus;
  anchors: string[]; // <caip2>:<tx> refs, e.g. "eip155:5042:0x…"
}

/** One row of the receipt's state-transition timeline (bible §8.1 S3). */
export interface TransitionEntry {
  event: string; // e.g. "RaincheckOpened"
  txHash: string;
  explorerUrl: string; // explorer.arc.io link for the tx
  memoIndex: number | null; // Memo index in the anchoring tx, null if no memo found
  blockTime: number; // unix seconds
  blockNumber: number;
}

/** Full API view for one receipt. receiptHash is OUTSIDE the hashed JSON. */
export interface ReceiptView {
  receipt: CanonicalReceipt;
  receiptHash: string; // lowercase-hex(SHA-256(JCS(receipt)))
  timeline: TransitionEntry[]; // chronological, oldest first
  openedAt: number; // blockTime of RaincheckOpened (sort key for newest-first)
  updatedAt: number; // blockTime of the latest transition
  buyer: string; // from RaincheckOpened — carried outside the hashed receipt
  seller: string; // from RaincheckOpened — carried outside the hashed receipt
  /**
   * Originating escrow instance (lowercase address). INTERNAL bookkeeping for
   * multi-asset: the API derives the presentation-only `token` from this via
   * the TOKEN_BY_ESCROW config map. It NEVER enters the canonical receipt or
   * its hash (§4.6 schema is token-blind by design). Optional so older/test
   * sources that predate multi-asset still satisfy the interface.
   */
  escrowAddress?: string;
}

/** Summary row for the receipt list endpoint. */
export interface ReceiptSummary {
  paymentId: string;
  status: ReceiptStatus;
  buyer: string;
  seller: string;
  /** Payment token of the escrow instance, derived from the originating
   *  escrow address via the TOKEN_BY_ESCROW config map. Presentation-only —
   *  excluded from the canonical receipt hash. */
  token: EscrowToken;
  /** Originating escrow instance (lowercase address). */
  escrow: string;
  // NOTE: the amountUSDC* names are legacy (single-token era). They carry the
  // receipt's TOKEN base units — both USDC and EURC are 6-decimal — and the
  // `token` field above says which. Kept for API compatibility.
  amountUSDC: string; // decimal, e.g. "1.234567" (in the receipt's token)
  amountUSDCBase: string; // 6-decimal base units, string (in the receipt's token)
  openedAt: number;
  updatedAt: number;
  receiptHash: string;
}

/** MERGE POINT — the documented interfaces from the task brief. */
export interface B2IndexerLike {
  /** B2's documented interface: getReceipt(paymentId) / listReceipts(). */
  getReceipt(paymentId: string): unknown;
  listReceipts(): unknown[];
}

export interface B3ReceiptsLike {
  /** B3's documented interface. */
  buildReceipt(paymentId: string): unknown;
}

/**
 * ReceiptSource: the contract the API routes depend on.
 *
 * Chain is the source of truth; any implementation is a cache over it.
 * - ChainLogReceiptStore (this API, chainStore.ts): re-derives receipts from
 *   eth_getLogs over the escrow + Memo contracts via viem. Serves today.
 * - B2 indexer (backend/src/indexer/) when it compiles: plug its IndexerStore
 *   in via createB2Source() in ports.ts. The router/app only depend on this
 *   interface, so the swap never touches the endpoint surface.
 * - B3 receipts buildReceipt(): when it lands, the canonical-receipt
 *   construction in chainStore.ts should delegate to it (see MERGE note in
 *   ports.ts).
 */
export interface ReceiptSource {
  getReceipt(paymentId: string): Promise<ReceiptView | undefined>;
  listReceipts(): Promise<ReceiptView[]>;
  latestIndexedBlock(): bigint | null;
  /** Re-derive everything from chain logs. The cache may lag; chain never lies. */
  refresh(): Promise<void>;
}
