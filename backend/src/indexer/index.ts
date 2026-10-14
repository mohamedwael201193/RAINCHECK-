/**
 * RAINCHECK indexer — public surface.
 *
 *   startIndexer(opts)      — begin polling; returns { stop(), getState() }.
 *   rebuildFromScratch(opts) — wipe the DB and replay ALL logs from
 *                              INDEX_START_BLOCK (the re-derivability
 *                              guarantee: every receipt must be re-derivable
 *                              from chain logs + Memo anchors alone, §5.4).
 *
 * The indexer is a CACHE. It never invents state; status is derived from the
 * event-name sequence per the state machine in config.ts (ordinals are never
 * read). It prints no secrets — only addresses, hashes, and block numbers.
 */
import {
  DEFAULT_ESCROW_CONFIGS,
  INDEX_START_BLOCK,
  POLL_INTERVAL_MS,
  PRODUCTION_ESCROW_CONFIG,
  defaultDbPath,
  type EscrowConfig,
} from './config.js';
import { createClient } from './poller.js';
import { pollRange, type PollRangeResult } from './poller.js';
import { IndexerStore, openStore } from './store.js';

export { IndexerStore, openStore };
export { pollRange, createClient };
export { matchTxLogs } from './matcher.js';
export * from './config.js';

export interface IndexerOptions {
  dbPath?: string;
  rpcUrl?: string;
  /**
   * Watched escrows with per-contract ABIs. Default: BOTH production escrows
   * (USDC + EURC instances — multi-asset is one escrow instance per token).
   * Add R9_VOID_ESCROW_CONFIG (from ./config.js) to also index the R9
   * void-path instance (unverified variant wire format — see config.ts).
   */
  escrows?: EscrowConfig[];
  pollIntervalMs?: number;
  /** First run starts here when no checkpoint exists. Default: the earliest
   *  watched escrow's startBlock. */
  startBlock?: number;
}

export interface IndexerHandle {
  stop: () => void;
  getState: () => {
    running: boolean;
    checkpoint: number | null;
    receipts: number;
    transitions: number;
    lastPoll?: PollRangeResult | undefined;
    lastError?: string | undefined;
  };
}

function resolveEscrows(opts: IndexerOptions): EscrowConfig[] {
  return opts.escrows ?? DEFAULT_ESCROW_CONFIGS;
}

/**
 * Earliest block worth scanning across the watched escrows. Each escrow
 * carries its own deploy block (EscrowConfig.startBlock); no escrow can have
 * activity before its own deployment, so the min is exact, not approximate.
 */
function resolveStartBlock(opts: IndexerOptions, escrows: EscrowConfig[]): number {
  if (opts.startBlock !== undefined) return opts.startBlock;
  let min = INDEX_START_BLOCK;
  for (const e of escrows) {
    const s = e.startBlock ?? INDEX_START_BLOCK;
    if (s < min) min = s;
  }
  return min;
}

export function startIndexer(opts: IndexerOptions = {}): IndexerHandle {
  const store = openStore(opts.dbPath ?? defaultDbPath());
  const client = createClient(opts.rpcUrl);
  const escrows = resolveEscrows(opts);
  const intervalMs = opts.pollIntervalMs ?? POLL_INTERVAL_MS;
  const startBlock = resolveStartBlock(opts, escrows);

  let running = true;
  let lastPoll: PollRangeResult | undefined;
  let lastError: string | undefined;
  let timer: ReturnType<typeof setInterval> | undefined;

  const tick = async () => {
    if (!running) return;
    try {
      const checkpoint = store.getCheckpoint();
      lastPoll = await pollRange(client, store, {
        escrows: escrows,
        fromBlock: checkpoint === null ? startBlock : checkpoint + 1,
      });
      lastError = undefined;
    } catch (e) {
      // A failed poll never advances the checkpoint: the next tick retries
      // the same range. No partial state is committed beyond chunk boundaries.
      lastError = e instanceof Error ? e.message : String(e);
      console.error(`[indexer] poll failed: ${lastError}`);
    }
  };

  void tick();
  timer = setInterval(() => void tick(), intervalMs);

  return {
    stop: () => {
      running = false;
      if (timer) clearInterval(timer);
      store.close();
    },
    getState: () => ({
      running,
      checkpoint: store.getCheckpoint(),
      receipts: store.countReceipts(),
      transitions: store.countTransitions(),
      lastPoll,
      lastError,
    }),
  };
}

/**
 * The re-derivability guarantee (§5.4): wipe the store and replay every escrow
 * log from the earliest watched deploy block to latest. The resulting receipts
 * must be byte-identical (modulo checkpoint) to any continuously-polled store
 * over the same range.
 *
 * Multi-asset note: enabling a second escrow on an EXISTING database does not
 * backfill it — the single checkpoint may already sit past the new escrow's
 * deploy block. Run rebuildFromScratch() once after adding an escrow; the
 * re-derivability guarantee makes that a safe, complete backfill.
 */
export async function rebuildFromScratch(
  opts: IndexerOptions = {},
): Promise<PollRangeResult> {
  const store = openStore(opts.dbPath ?? defaultDbPath());
  store.wipe();
  const client = createClient(opts.rpcUrl);
  const escrows = resolveEscrows(opts);
  try {
    return await pollRange(client, store, {
      escrows,
      fromBlock: resolveStartBlock(opts, escrows),
    });
  } finally {
    store.close();
  }
}
