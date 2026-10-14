import { createHash } from "crypto";
import { createPublicClient, http, type Hex, type PublicClient } from "viem";
import { ESCROW_EVENTS, MEMO_EVENTS } from "./abi.js";
import { jcs } from "./jcs.js";
import {
  CHAIN_ID,
  ESCROW_ADDRESS,
  ESCROW_ADDRESS_EURC,
  EXPLORER,
  MEMO_ADDRESS,
  RPC_URL,
} from "../config.js";
import {
  isReceiptStatus,
  type CanonicalReceipt,
  type ReceiptSource,
  type ReceiptStatus,
  type ReceiptView,
  type TransitionEntry,
} from "./types.js";

export interface ChainStoreOptions {
  rpcUrl?: string;
  /** Single escrow to watch (legacy). Prefer `escrows` for multi-asset. */
  escrowAddress?: string;
  /** First block to scan. Default: the production escrow's deploy block. */
  fromBlock?: bigint;
  /**
   * Watched escrows with per-escrow first blocks. Multi-asset = one escrow
   * instance per token; the canonical receipt (§4.6) is token-blind, so every
   * watched instance folds into the same receipt shape and each served view
   * carries its originating escrow address internally (ReceiptView.escrowAddress).
   * Default: the USDC + EURC production instances.
   */
  escrows?: Array<{ address: string; fromBlock?: bigint }>;
}

export const PAYMENT_ID_RE = /^0x[0-9a-fA-F]{64}$/;
/** First-scan block: the production escrow's deployment block (25956323) —
 *  no escrow activity can exist before its own deploy block. */
export const DEFAULT_FROM_BLOCK = 25_956_323n;
/** EURC production instance deploy block (contracts/deployments/arc-5042.json). */
export const EURC_FROM_BLOCK = 25_962_288n;

/** The default watched set: both production escrow instances. */
export const DEFAULT_ESCROWS: Array<{ address: string; fromBlock: bigint }> = [
  { address: ESCROW_ADDRESS, fromBlock: DEFAULT_FROM_BLOCK },
  { address: ESCROW_ADDRESS_EURC, fromBlock: EURC_FROM_BLOCK },
];

/** Format 6-decimal base units as a USDC decimal string, e.g. "1.234567". */
export function toUsdcString(baseUnits: bigint): string {
  const neg = baseUnits < 0n;
  const abs = neg ? -baseUnits : baseUnits;
  const whole = abs / 1_000_000n;
  const frac = (abs % 1_000_000n).toString().padStart(6, "0");
  return (neg ? "-" : "") + whole.toString() + "." + frac;
}

export function receiptHashOf(receipt: CanonicalReceipt): string {
  return createHash("sha256").update(jcs(receipt), "utf8").digest("hex");
}

interface OpenData {
  buyer: string;
  seller: string;
  termsHash: string;
  amount: bigint;
  deadline: number;
  settleTx: string;
  openedAt: number;
}

/**
 * Build the canonical receipt (§4.6) from chain-derived fields.
 * MERGE NOTE (B3): when backend/src/receipts/ exposes buildReceipt(), call it
 * here instead of constructing the object inline — one construction path only.
 */
export function buildCanonicalReceipt(args: {
  paymentId: string;
  buyer: string;
  seller: string;
  termsHash: string;
  amountBase: string;
  deadline: number;
  outputHash: string | null;
  attestedAt: number | null;
  flagReasonHash: string | null;
  status: ReceiptStatus;
  settleTx: string;
  anchorTxs: string[];
}): CanonicalReceipt {
  const delivery: CanonicalReceipt["delivery"] =
    args.status === "FLAGGED"
      ? {
          nonDelivery: {
            // flagNonDelivery is buyer-only, so the flagger is the recorded buyer.
            flaggedBy: args.buyer,
            reasonHash: args.flagReasonHash ?? "0x",
          },
        }
      : args.outputHash !== null
        ? {
            outputHash: args.outputHash,
            attestedAt: args.attestedAt ?? 0,
            sellerSig: null, // off-chain; carried out-of-band, never invented here
          }
        : null;
  return {
    specVersion: "raincheck-receipt/v1",
    paymentId: args.paymentId,
    paymentProof: {
      settleTx: args.settleTx,
      // RaincheckOpened is emitted only after transferFrom succeeded, so the
      // EIP-3009 authorization was consumed by the open tx itself.
      authorizationState: true,
      payer: args.buyer,
      amount: args.amountBase,
    },
    terms: {
      termsHash: args.termsHash,
      endpoint: null, // off-chain terms bundle is not on-chain; never invented
      price: args.amountBase,
      deadline: args.deadline,
    },
    delivery,
    oracle: null, // T0-O tier specified, NOT live — never claim otherwise
    policy: null,
    funding: null,
    status: args.status,
    anchors: args.anchorTxs.map((t) => `eip155:${CHAIN_ID}:${t}`),
  };
}

/** Arc's RPC rejects unbounded ranges — same page size as B2's indexer. */
const LOG_RANGE_BLOCKS = 2_000n;

/**
 * Decoded event args, keyed by event name (bible §4.1 / §4.2). Statuses are
 * derived from these event NAMES — never from enum ordinals.
 */
interface EscrowEventArgs {
  RaincheckOpened: {
    paymentId: Hex;
    buyer: Hex;
    seller: Hex;
    termsHash: Hex;
    amount: bigint;
    deadline: bigint;
  };
  DeliveryAttested: { paymentId: Hex; outputHash: Hex; attestedAt: bigint };
  RaincheckCaptured: { paymentId: Hex; amount: bigint };
  NonDeliveryFlagged: { paymentId: Hex; reasonHash: Hex };
  RaincheckVoided: { paymentId: Hex; amount: bigint; refundedTo: Hex };
}

interface MemoEventArgs {
  Memo: {
    sender: Hex;
    target: Hex;
    callDataHash: Hex;
    memoId: Hex;
    memo: Hex;
    memoIndex: bigint;
  };
  BeforeMemo: { memoIndex: bigint };
}

/**
 * A decoded log whose `args` are narrowed by `eventName` (discriminated union).
 * `args` is `undefined` when viem could not decode the log — callers must skip
 * such logs rather than invent fields from them. No `unknown`, no casts.
 */
type DecodedLog<TMap extends object> = {
  [K in keyof TMap & string]: {
    eventName: K;
    args: TMap[K] | undefined;
    address: Hex;
    transactionHash: `0x${string}` | null;
    blockNumber: bigint;
    logIndex: number;
  };
}[keyof TMap & string];

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Fetch logs in bounded pages ("requested range too large" otherwise). */
async function getLogsPaged<TMap extends object>(
  client: PublicClient,
  req: { address: Hex; events: never; fromBlock: bigint },
): Promise<DecodedLog<TMap>[]> {
  const latest = await client.getBlockNumber();
  const out: DecodedLog<TMap>[] = [];
  let from = req.fromBlock;
  let attempt = 0;
  while (from <= latest) {
    const to = from + LOG_RANGE_BLOCKS - 1n > latest ? latest : from + LOG_RANGE_BLOCKS - 1n;
    try {
      const page = (await client.getLogs({
        address: req.address,
        events: req.events,
        fromBlock: from,
        toBlock: to,
      })) as unknown as DecodedLog<TMap>[];
      out.push(...page);
      from = to + 1n;
      attempt = 0;
      await sleep(200); // stay under the public RPC's rate limit
    } catch (err) {
      const msg = (err as Error).message ?? "";
      if (/rate limit|429|too many requests/i.test(msg) && attempt < 5) {
        attempt += 1;
        await sleep(1000 * 2 ** attempt); // exponential backoff, then retry same page
        continue;
      }
      throw err;
    }
  }
  return out;
}

/**
 * ChainLogReceiptStore — a cache over eth_getLogs; CHAIN IS THE SOURCE OF TRUTH.
 *
 * Every receipt served here is re-derived from escrow events (+ Memo anchors)
 * read directly from an Arc RPC node. If this cache is stale, wrong, or empty,
 * the same receipts can be rebuilt from logs alone (bible §3, §5).
 */
export class ChainLogReceiptStore implements ReceiptSource {
  private client: PublicClient;
  /** Watched escrows (multi-asset: one instance per token). */
  private escrows: Array<{ address: Hex; fromBlock: bigint }>;
  private receipts = new Map<string, ReceiptView>();
  private latestBlock: bigint | null = null;

  constructor(opts: ChainStoreOptions = {}) {
    const rpcUrl = opts.rpcUrl ?? RPC_URL;
    this.client = createPublicClient({
      transport: http(rpcUrl),
      chain: {
        id: CHAIN_ID,
        name: "Arc",
        nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 },
        rpcUrls: { default: { http: [rpcUrl] } },
      },
    });
    if (opts.escrows) {
      this.escrows = opts.escrows.map((e) => ({
        address: e.address as Hex,
        fromBlock: e.fromBlock ?? DEFAULT_FROM_BLOCK,
      }));
    } else {
      this.escrows = [
        {
          address: (opts.escrowAddress ?? ESCROW_ADDRESS) as Hex,
          fromBlock: opts.fromBlock ?? DEFAULT_FROM_BLOCK,
        },
      ];
    }
  }

  /** Lowercase set of watched escrow addresses (memo-target filter). */
  private escrowSet(): Set<string> {
    return new Set(this.escrows.map((e) => e.address.toLowerCase()));
  }

  /**
   * Look up one receipt by paymentId. Identity is (escrow, paymentId) — the
   * same 32 bytes can open on both instances. The single-id lookup serves the
   * earliest-opened receipt on a collision (first-wins, matching the B2
   * indexer's row policy); the list endpoint exposes every instance with its
   * token so nothing is hidden.
   */
  async getReceipt(paymentId: string): Promise<ReceiptView | undefined> {
    const needle = paymentId.toLowerCase();
    let best: ReceiptView | undefined;
    for (const [key, view] of this.receipts) {
      if (!key.endsWith(`:${needle}`)) continue;
      if (!best || view.openedAt < best.openedAt) best = view;
    }
    return best;
  }

  async listReceipts(): Promise<ReceiptView[]> {
    return [...this.receipts.values()];
  }

  latestIndexedBlock(): bigint | null {
    return this.latestBlock;
  }

  /**
   * Re-derive all receipts from chain logs. Wipes the cache and rebuilds —
   * the chain is the only truth, so a rebuild can never "lose" a receipt that
   * is really there.
   */
  async refresh(): Promise<void> {
    // Sequential (not parallel): paged scans at once multiply the RPC rate.
    // One scan per watched escrow — each has its own deploy block, and every
    // log is tagged with its originating escrow address at fold time.
    const escrowAddrs = this.escrowSet();
    const escrowLogs: DecodedLog<EscrowEventArgs>[] = [];
    let memoFromBlock = this.escrows[0]!.fromBlock;
    for (const e of this.escrows) {
      if (e.fromBlock < memoFromBlock) memoFromBlock = e.fromBlock;
      const logs = await getLogsPaged<EscrowEventArgs>(this.client, {
        address: e.address,
        events: ESCROW_EVENTS as never,
        fromBlock: e.fromBlock,
      });
      escrowLogs.push(...logs);
    }
    const memoLogs = await getLogsPaged<MemoEventArgs>(this.client, {
      address: MEMO_ADDRESS as Hex,
      events: MEMO_EVENTS as never,
      fromBlock: memoFromBlock,
    });

    // Memo anchors keyed by tx hash (only memos wrapping a call to a watched escrow).
    const memoIndexByTx = new Map<string, number | null>();
    for (const log of memoLogs) {
      if (log.eventName !== "Memo") continue;
      const margs = log.args;
      if (!margs) continue; // undecodable Memo log: skip, never invent
      if (!escrowAddrs.has(margs.target.toLowerCase())) continue;
      const tx = log.transactionHash!.toLowerCase();
      if (!memoIndexByTx.has(tx)) {
        memoIndexByTx.set(tx, Number(margs.memoIndex));
      }
    }

    // Block times, fetched once per block.
    const blockTimeCache = new Map<number, number>();
    const blockTimeOf = async (blockNumber: number): Promise<number> => {
      const cached = blockTimeCache.get(blockNumber);
      if (cached !== undefined) return cached;
      const block = await this.client.getBlock({ blockNumber: BigInt(blockNumber) });
      const t = Number(block.timestamp);
      blockTimeCache.set(blockNumber, t);
      return t;
    };

    // Apply transitions in chain order: (blockNumber, logIndex).
    // Identity is (escrow, paymentId): paymentId uniqueness is enforced per
    // escrow CONTRACT, so the same 32 bytes can open on both instances and
    // must never be merged across tokens.
    const rowKey = (escrow: string, paymentId: string) => `${escrow}:${paymentId}`;
    const ordered = [...escrowLogs].sort(
      (a, b) => Number(a.blockNumber - b.blockNumber) || Number(a.logIndex - b.logIndex),
    );

    const opens = new Map<string, OpenData & { escrowAddress: string; paymentId: string }>();
    const transitions = new Map<string, TransitionEntry[]>();
    const statusByPayment = new Map<string, ReceiptStatus>();
    const outputByPayment = new Map<string, { outputHash: string; attestedAt: number }>();
    const flagByPayment = new Map<string, string>();
    const anchorTxsByPayment = new Map<string, string[]>();

    let maxBlock = 0n;
    for (const log of ordered) {
      if (log.blockNumber > maxBlock) maxBlock = log.blockNumber;
      const args = log.args;
      if (!args) continue; // undecodable log: never invent fields from it
      const escrow = log.address.toLowerCase();
      const paymentId = args.paymentId.toLowerCase();
      const key = rowKey(escrow, paymentId);
      const txHash = log.transactionHash!;
      const blockNumber = Number(log.blockNumber);
      const blockTime = await blockTimeOf(blockNumber);

      const tl = transitions.get(key) ?? [];
      tl.push({
        event: log.eventName,
        txHash,
        explorerUrl: `${EXPLORER}/tx/${txHash}`,
        memoIndex: memoIndexByTx.get(txHash.toLowerCase()) ?? null,
        blockTime,
        blockNumber,
      });
      transitions.set(key, tl);

      const atx = anchorTxsByPayment.get(key) ?? [];
      atx.push(txHash);
      anchorTxsByPayment.set(key, atx);

      switch (log.eventName) {
        case "RaincheckOpened": {
          const a = log.args;
          if (!a) break;
          opens.set(key, {
            paymentId,
            buyer: a.buyer.toLowerCase(),
            seller: a.seller.toLowerCase(),
            termsHash: a.termsHash.toLowerCase(),
            amount: a.amount,
            deadline: Number(a.deadline),
            settleTx: txHash,
            openedAt: blockTime,
            escrowAddress: escrow,
          });
          statusByPayment.set(key, "OPEN");
          break;
        }
        case "DeliveryAttested": {
          const a = log.args;
          if (!a) break;
          statusByPayment.set(key, "ATTESTED");
          outputByPayment.set(key, {
            outputHash: a.outputHash.toLowerCase(),
            attestedAt: Number(a.attestedAt),
          });
          break;
        }
        case "NonDeliveryFlagged": {
          const a = log.args;
          if (!a) break;
          statusByPayment.set(key, "FLAGGED");
          flagByPayment.set(key, a.reasonHash.toLowerCase());
          break;
        }
        case "RaincheckCaptured": {
          statusByPayment.set(key, "CAPTURED");
          break;
        }
        case "RaincheckVoided": {
          statusByPayment.set(key, "VOIDED");
          break;
        }
        default: {
          // Unknown event: status stays whatever the chain told us before.
          // Never guess from an unrecognized event name.
          break;
        }
      }
    }

    // Fold opens + transitions into canonical receipts. No open event => no receipt.
    // The canonical receipt (§4.6) is token-blind: the originating escrow rides
    // on the VIEW (escrowAddress), never inside the hashed JSON.
    const next = new Map<string, ReceiptView>();
    for (const [key, open] of opens) {
      const status = statusByPayment.get(key) ?? "OPEN";
      if (!isReceiptStatus(status)) continue; // defensive; statuses are enum names
      const output = outputByPayment.get(key) ?? null;
      const receipt = buildCanonicalReceipt({
        paymentId: open.paymentId,
        buyer: open.buyer,
        seller: open.seller,
        termsHash: open.termsHash,
        amountBase: open.amount.toString(),
        deadline: open.deadline,
        outputHash: output?.outputHash ?? null,
        attestedAt: output?.attestedAt ?? null,
        flagReasonHash: flagByPayment.get(key) ?? null,
        status,
        settleTx: open.settleTx,
        anchorTxs: anchorTxsByPayment.get(key) ?? [open.settleTx],
      });
      const timeline = transitions.get(key) ?? [];
      const updatedAt =
        timeline.length > 0 ? timeline[timeline.length - 1]!.blockTime : open.openedAt;
      next.set(key, {
        receipt,
        receiptHash: receiptHashOf(receipt),
        timeline,
        openedAt: open.openedAt,
        updatedAt,
        buyer: open.buyer,
        seller: open.seller,
        escrowAddress: open.escrowAddress,
      });
    }

    this.receipts = next;
    this.latestBlock = maxBlock;
  }
}
