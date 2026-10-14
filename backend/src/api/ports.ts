import { createPublicClient, http, type PublicClient } from "viem";
import {
  buildCanonicalReceipt,
  receiptHashOf,
  toUsdcString,
  PAYMENT_ID_RE,
} from "./chainStore.js";
import { CHAIN_ID, EXPLORER, RPC_URL } from "../config.js";
import {
  isReceiptStatus,
  type ReceiptSource,
  type ReceiptStatus,
  type ReceiptView,
  type TransitionEntry,
} from "./types.js";

/**
 * MERGE ADAPTERS for the sibling backend modules.
 *
 * B2 indexer (backend/src/indexer/) exposes an IndexerStore with the documented
 * interface: getReceipt(paymentId), listReceipts(status?), getTransitions(paymentId),
 * getCheckpoint(). B2's files are still landing and do not compile yet under the
 * repo's CommonJS tsconfig (TS5097 '.ts' import specifiers, import.meta usage),
 * so this adapter is declared STRUCTURALLY — no import of B2's files. Once B2
 * compiles, pass their IndexerStore instance straight into createB2Source().
 *
 * Chain remains the source of truth: the API must keep the option to rebuild
 * any receipt from eth_getLogs (ChainLogReceiptStore does this today).
 *
 * MERGE NOTE for B3 receipts (backend/src/receipts/):
 * B3 exposes buildReceipt(paymentId) -> canonical receipt JSON. When it lands,
 * the buildCanonicalReceipt() call in chainStore.ts (and below) should delegate
 * to it so there is exactly one receipt-construction path. Timeline assembly
 * stays in the API layer — it needs both contracts' logs plus block times.
 */

/** Structural view of B2's IndexerStore public surface (from store.ts). */
export interface B2StoreLike {
  getReceipt(paymentId: string): B2ReceiptRow | undefined;
  listReceipts(status?: string): B2ReceiptRow[];
  getTransitions(paymentId: string): B2TransitionRow[];
  getCheckpoint(): number | null;
}

export interface B2ReceiptRow {
  paymentId: string;
  buyer: string | null;
  seller: string | null;
  termsHash: string | null;
  amount: string | null; // decimal string, 6-decimal base units
  deadline: number | null; // unix seconds
  outputHash: string | null;
  attestedAt: number | null;
  flagReasonHash: string | null;
  status: string;
  createdBlock: number;
  updatedBlock: number;
  /** Originating escrow instance (lowercase) — added with multi-asset. */
  escrowAddress: string | null;
}

export interface B2TransitionRow {
  paymentId: string;
  event: string;
  txHash: string;
  blockNumber: number;
  logIndex: number;
  memoIndex: number | null;
  /** Originating escrow instance (lowercase) — added with multi-asset. */
  escrowAddress: string | null;
}

/**
 * Wrap B2's IndexerStore as a ReceiptSource. B2 rows carry no block times, so
 * timeline entries fetch them from the RPC (cached per block). Everything else
 * is re-derived from B2's rows — statuses by name, canonical receipt via the
 * shared buildCanonicalReceipt() fold.
 */
export function createB2Source(
  b2: B2StoreLike,
  client?: PublicClient,
): ReceiptSource {
  const rpc: PublicClient =
    client ??
    createPublicClient({
      transport: http(RPC_URL),
      chain: {
        id: CHAIN_ID,
        name: "Arc",
        nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 },
        rpcUrls: { default: { http: [RPC_URL] } },
      },
    });
  const blockTimeCache = new Map<number, number>();
  const blockTimeOf = async (blockNumber: number): Promise<number> => {
    const cached = blockTimeCache.get(blockNumber);
    if (cached !== undefined) return cached;
    const block = await rpc.getBlock({ blockNumber: BigInt(blockNumber) });
    const t = Number(block.timestamp);
    blockTimeCache.set(blockNumber, t);
    return t;
  };

  const toView = async (row: B2ReceiptRow): Promise<ReceiptView | undefined> => {
    if (!isReceiptStatus(row.status)) return undefined; // statuses are names, never ordinals
    if (
      row.buyer === null ||
      row.seller === null ||
      row.termsHash === null ||
      row.amount === null ||
      row.deadline === null
    ) {
      return undefined; // an opened receipt always has these; never invent them
    }
    const transitions = b2.getTransitions(row.paymentId);
    const timeline: TransitionEntry[] = [];
    for (const t of transitions) {
      timeline.push({
        event: t.event,
        txHash: t.txHash,
        explorerUrl: `${EXPLORER}/tx/${t.txHash}`,
        memoIndex: t.memoIndex,
        blockTime: await blockTimeOf(t.blockNumber),
        blockNumber: t.blockNumber,
      });
    }
    const settleTx = timeline.length > 0 ? timeline[0]!.txHash : "";
    const openedAt =
      timeline.length > 0 ? timeline[0]!.blockTime : await blockTimeOf(row.createdBlock);
    const updatedAt =
      timeline.length > 0
        ? timeline[timeline.length - 1]!.blockTime
        : await blockTimeOf(row.updatedBlock);
    const receipt = buildCanonicalReceipt({
      paymentId: row.paymentId,
      buyer: row.buyer,
      seller: row.seller,
      termsHash: row.termsHash,
      amountBase: row.amount,
      deadline: row.deadline,
      outputHash: row.outputHash,
      attestedAt: row.attestedAt,
      flagReasonHash: row.flagReasonHash,
      status: row.status,
      settleTx,
      anchorTxs: timeline.map((t) => t.txHash),
    });
    return {
      receipt,
      receiptHash: receiptHashOf(receipt),
      timeline,
      openedAt,
      updatedAt,
      buyer: row.buyer,
      seller: row.seller,
      // Internal multi-asset bookkeeping: the originating escrow instance.
      // The API derives the presentation-only token from this; it never
      // enters the canonical receipt hash.
      ...(row.escrowAddress ? { escrowAddress: row.escrowAddress } : {}),
    };
  };

  return {
    async getReceipt(paymentId: string): Promise<ReceiptView | undefined> {
      if (!PAYMENT_ID_RE.test(paymentId)) return undefined;
      const row = b2.getReceipt(paymentId.toLowerCase());
      return row ? toView(row) : undefined;
    },
    async listReceipts(): Promise<ReceiptView[]> {
      const views: ReceiptView[] = [];
      for (const row of b2.listReceipts()) {
        const v = await toView(row);
        if (v) views.push(v);
      }
      return views;
    },
    latestIndexedBlock(): bigint | null {
      const cp = b2.getCheckpoint();
      return cp === null ? null : BigInt(cp);
    },
    async refresh(): Promise<void> {
      // B2 owns polling/rebuild (indexer/index.ts). Nothing to do here —
      // blockTimeCache warms lazily on reads.
      blockTimeCache.clear();
    },
  };
}

export { toUsdcString };
