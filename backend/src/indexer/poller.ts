/**
 * RAINCHECK indexer — eth_getLogs poller.
 *
 * Reads escrow events from chain logs (per-escrow ABIs: the production
 * contract and, opt-in, the R9 void-path variant), pairs each with its Memo
 * anchor (same-tx log order, §4.2), derives receipt status from the event NAME
 * (never an enum ordinal), and advances a persisted checkpoint block.
 *
 * Robustness: a watched contract may emit logs outside its known event set
 * (observed on the R9 variant). Unknown topics are warned-and-skipped, never
 * fatal — a cache must not crash on chain data it doesn't understand.
 *
 * Re-org policy: the checkpoint only moves forward and transition rows are
 * idempotent on (txHash, logIndex), so a shallow re-org replays cleanly.
 * A deep re-org (or any doubt) is cured by rebuildFromScratch(), which wipes
 * the DB and replays every log — the re-derivability guarantee (§5.4).
 */
import {
  createPublicClient,
  decodeEventLog,
  defineChain,
  http,
  keccak256,
  toHex,
  type AbiEvent,
  type Log,
  type PublicClient,
} from 'viem';
import {
  CHAIN_ID,
  EXPLORER_URL,
  INDEX_START_BLOCK,
  LEGAL_PREDECESSORS,
  LOG_RANGE_BLOCKS,
  RPC_URL,
  EVENT_TO_STATUS,
  PRODUCTION_ESCROW_CONFIG,
  type EscrowConfig,
  type EscrowEventName,
} from './config.js';
import { matchTxLogs } from './matcher.js';
import { IndexerStore } from './store.js';

export const arcMainnet = defineChain({
  id: CHAIN_ID,
  name: 'Arc',
  nativeCurrency: { name: 'USDC', symbol: 'USDC', decimals: 18 },
  rpcUrls: { default: { http: [RPC_URL] } },
  blockExplorers: { default: { name: 'Arc Explorer', url: EXPLORER_URL } },
});

export function createClient(rpcUrl: string = RPC_URL): PublicClient {
  return createPublicClient({ chain: arcMainnet, transport: http(rpcUrl) });
}

/** Events that move USDC — the only ones the Transfer-log rule (§4.2) applies to. */
const VALUE_MOVING_EVENTS: ReadonlySet<string> = new Set([
  'RaincheckOpened',
  'RaincheckCaptured',
  'RaincheckVoided',
]);

export interface PollRangeOptions {
  /** Watched escrows with their own ABIs. Default: production contract only. */
  escrows?: EscrowConfig[];
  fromBlock?: number;
  toBlock?: number;
  chunkBlocks?: number;
}

export interface PollRangeResult {
  fromBlock: number;
  toBlock: number;
  logsSeen: number;
  logsSkippedUnknown: number;
  transitionsWritten: number;
  receiptsTouched: number;
  warnings: string[];
}

/**
 * Index one block range, then advance the checkpoint to toBlock.
 * Idempotent: re-running a range re-inserts nothing (UNIQUE txHash/logIndex)
 * and recomputes the same receipt state from the same logs.
 */
export async function pollRange(
  client: PublicClient,
  store: IndexerStore,
  opts: PollRangeOptions = {},
): Promise<PollRangeResult> {
  const escrows = opts.escrows ?? [PRODUCTION_ESCROW_CONFIG];
  const byAddress = new Map(
    escrows.map((e) => [e.address.toLowerCase(), e] as const),
  );
  const addresses = [...byAddress.keys()] as `0x${string}`[];
  const chunkBlocks = opts.chunkBlocks ?? LOG_RANGE_BLOCKS;

  const latest = Number(await client.getBlockNumber());
  const toBlock = opts.toBlock ?? latest;
  const checkpoint = store.getCheckpoint();
  const fromBlock =
    opts.fromBlock ?? (checkpoint === null ? INDEX_START_BLOCK : checkpoint + 1);

  const result: PollRangeResult = {
    fromBlock,
    toBlock,
    logsSeen: 0,
    logsSkippedUnknown: 0,
    transitionsWritten: 0,
    receiptsTouched: 0,
    warnings: [],
  };
  const warn = (m: string) => {
    result.warnings.push(m);
    console.warn(`[indexer] ${m}`);
  };

  if (fromBlock > toBlock) return result;

  /** A log we can decode: watched address + known topic0 for that address. */
  const topicsByAddress = new Map<string, Set<string>>();
  for (const [addr, cfg] of byAddress) {
    topicsByAddress.set(
      addr,
      new Set(
        cfg.abi
          .filter((e) => e.type === 'event')
          .map((e) => eventTopic(cfg.abi, e.name).toLowerCase()),
      ),
    );
  }
  const isKnown = (log: Log): boolean => {
    const set = topicsByAddress.get(log.address.toLowerCase());
    return !!set && !!log.topics[0] && set.has(log.topics[0].toLowerCase());
  };

  for (let start = fromBlock; start <= toBlock; start += chunkBlocks) {
    const end = Math.min(start + chunkBlocks - 1, toBlock);
    const logs = await client.getLogs({
      address: addresses,
      fromBlock: BigInt(start),
      toBlock: BigInt(end),
    });
    result.logsSeen += logs.length;

    // Global order: block, then log index. Status is a pure function of the
    // event-name sequence, so ordering is what makes it correct.
    const ordered = [...logs].sort((a, b) => {
      const ba = Number(a.blockNumber);
      const bb = Number(b.blockNumber);
      return ba === bb ? Number(a.logIndex) - Number(b.logIndex) : ba - bb;
    });

    // Pair Memo anchors per transaction (one receipt fetch per tx).
    const byTx = new Map<string, Log[]>();
    for (const l of ordered) {
      const h = l.transactionHash!;
      if (!byTx.has(h)) byTx.set(h, []);
      byTx.get(h)!.push(l);
    }
    const matchByTx = new Map<string, ReturnType<typeof matchTxLogs>>();
    for (const [hash, txLogs] of byTx) {
      const receipt = await client.getTransactionReceipt({
        hash: hash as `0x${string}`,
      });
      matchByTx.set(hash, matchTxLogs(receipt.logs as Log[], isKnown));
    }

    const touched = new Set<string>();
    for (const log of ordered) {
      const cfg = byAddress.get(log.address.toLowerCase())!;
      const topic0 = log.topics[0]?.toLowerCase();
      if (!topic0 || !topicsByAddress.get(log.address.toLowerCase())!.has(topic0)) {
        // Observed on the R9 variant: the contract emits logs outside the
        // known event set. Warn and skip — never crash the poller.
        result.logsSkippedUnknown += 1;
        warn(
          `unknown topic ${topic0 ?? '(none)'} from watched ${cfg.label} ${log.address} in ${log.transactionHash} — skipped`,
        );
        continue;
      }

      let eventName: EscrowEventName;
      let args: Record<string, unknown>;
      try {
        const decoded = decodeEventLog({
          abi: cfg.abi,
          data: log.data,
          topics: log.topics,
        });
        eventName = decoded.eventName as unknown as EscrowEventName;
        args = decoded.args as unknown as Record<string, unknown>;
      } catch (e) {
        result.logsSkippedUnknown += 1;
        warn(
          `decode failed for ${topic0} in ${log.transactionHash}: ${e instanceof Error ? e.message : e} — skipped`,
        );
        continue;
      }

      const paymentId = String(args.paymentId).toLowerCase();
      const blockNumber = Number(log.blockNumber);
      const logIndex = Number(log.logIndex);
      const match = matchByTx.get(log.transactionHash!)!;
      const memoIndex = match.memoIndexByLogIndex.get(String(logIndex)) ?? null;

      // §4.2: never match on the memo alone — value-moving transitions must
      // have a system Transfer log in the tx. attest/flag move no funds, so
      // the rule applies only to open/capture/void.
      if (!match.hasTransfer && VALUE_MOVING_EVENTS.has(eventName)) {
        warn(
          `${eventName} ${paymentId.slice(0, 10)}… in ${log.transactionHash} has no system Transfer log (memo-only or direct call)`,
        );
      }

      // Status transition validated by NAME, never by ordinal.
      const existing = store.getReceipt(paymentId);
      const prevStatus: string | null = existing ? existing.status : null;
      if (!LEGAL_PREDECESSORS[eventName].includes(prevStatus)) {
        warn(
          `illegal transition ${eventName} on ${paymentId.slice(0, 10)}… (prev=${prevStatus}); log recorded, receipt untouched`,
        );
      } else {
        const applied = store.applyEvent(
          eventName,
          EVENT_TO_STATUS[eventName],
          args,
          blockNumber,
          cfg.address,
        );
        if (!applied.ok) warn(applied.reason!);
        else touched.add(paymentId);
      }

      if (
        store.insertTransition({
          paymentId,
          event: eventName,
          txHash: log.transactionHash!,
          blockNumber,
          logIndex,
          memoIndex,
          escrowAddress: cfg.address.toLowerCase(),
        })
      ) {
        result.transitionsWritten += 1;
      }
    }

    result.receiptsTouched += touched.size;
    store.setCheckpoint(end);
  }

  return result;
}

/** Canonical topic0 for a named event in an ABI. */
function eventTopic(abi: AbiEvent[], name: string): string {
  const ev = abi.find((e) => e.type === 'event' && e.name === name);
  if (!ev) throw new Error(`event ${name} not in ABI`);
  const sig = `${ev.name}(${(ev.inputs ?? []).map((i) => i.type).join(',')})`;
  return keccak256(toHex(sig));
}
