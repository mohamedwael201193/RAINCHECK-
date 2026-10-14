/**
 * RAINCHECK indexer — Memo matching (§4.2 of the build bible).
 *
 * Matching rules, in order:
 *  1. Match on transaction hash: memo pairing only ever happens between logs of
 *     the SAME transaction receipt.
 *  2. Pair by log order: `BeforeMemo(memoIndex)` → inner contract event(s) →
 *     `Memo(…, memoIndex)`. The k-th BeforeMemo and k-th Memo of a tx form a
 *     pair; every escrow event with a logIndex strictly between them is
 *     assigned that pair's memoIndex. (Log indexes are NOT assumed contiguous —
 *     the live void tx skips 0/1.)
 *  3. For multi-memo txs, the extracted callDataHash of each Memo is recorded
 *     so callers can compare it against keccak256 of the exact calldata.
 *  4. A memo is never matched alone: we require a system Transfer log in the
 *     tx (ERC-20 USDC face 0x3600… or the native-USDC system address
 *     0xffff…fe) before treating the Memo pair as value-bearing evidence.
 *     Escrow events from a direct (non-memo-wrapped) call get memoIndex=null —
 *     the chain is still truth; the memo is only the anchor.
 */
import type { Log } from 'viem';
import {
  BEFORE_MEMO_TOPIC,
  MEMO_ADDRESS,
  MEMO_TOPIC,
  TRANSFER_LOG_ADDRESSES,
  TRANSFER_TOPIC,
} from './config.js';

export interface MemoPair {
  memoIndex: number;
  /** keccak256 of the exact calldata executed via memo() — data[0:32]. */
  callDataHash: string | null;
  /** Indexed memoId convention, e.g. keccak256("memo-raincheck:v1"). */
  memoId: string | null;
  sender: string | null;
  target: string | null;
}

export interface TxMatch {
  /** escrow-event logIndex (as string key) -> memoIndex (or null if unwrapped) */
  memoIndexByLogIndex: Map<string, number | null>;
  /** memoIndex -> pair details (for callDataHash verification) */
  pairs: Map<number, MemoPair>;
  /** a Transfer log from USDC face or the system address exists in this tx */
  hasTransfer: boolean;
}

const memoAddr = MEMO_ADDRESS.toLowerCase();

function logIndexNum(l: Log): number {
  return Number(l.logIndex);
}

/** Extract memoIndex from a BeforeMemo log: indexed in topics[1]; data fallback. */
function beforeMemoIndex(log: Log): number | null {
  try {
    if (log.topics.length > 1 && log.topics[1]) return Number(BigInt(log.topics[1]));
    if (log.data && log.data !== '0x') return Number(BigInt(log.data));
  } catch {
    /* fall through */
  }
  return null;
}

/**
 * Extract memoIndex from a Memo log.
 *
 * True wire layout (proven against live logs — see self-test §5):
 *   Memo(address indexed sender, address indexed target,
 *        bytes32 indexed memoId, bytes32 callDataHash, bytes memo,
 *        uint256 memoIndex)
 * topics = [topic0, sender, target, memoId]
 * data   = callDataHash[0:32] | memoOffset[32:64] | memoIndex[64:96] | memo…
 * Verified: data[64:96] == 1143/1144/1145 on the known R9 txs; data[0:32] ==
 * keccak256 of the exact calldata decoded from the tx input.
 */
function memoLogIndex(log: Log): number | null {
  try {
    const data = log.data;
    if (data && data.length >= 2 + 192) {
      return Number(BigInt('0x' + data.slice(2 + 128, 2 + 192)));
    }
  } catch {
    /* fall through */
  }
  return null;
}

function toAddr(topic: string | undefined): string | null {
  if (!topic) return null;
  try {
    return ('0x' + topic.slice(-40)).toLowerCase();
  } catch {
    return null;
  }
}

/**
 * Pair memo anchors with escrow events inside one transaction receipt's logs.
 * @param receiptLogs all logs of the tx (already filtered to this tx)
 * @param isEscrowEvent predicate: true for the 5 escrow event logs we care about
 */
export function matchTxLogs(
  receiptLogs: Log[],
  isEscrowEvent: (log: Log) => boolean,
): TxMatch {
  const sorted = [...receiptLogs].sort((a, b) => logIndexNum(a) - logIndexNum(b));
  const memoIndexByLogIndex = new Map<string, number | null>();
  const pairs = new Map<number, MemoPair>();
  let hasTransfer = false;
  let openMemoIndex: number | null = null;

  for (const log of sorted) {
    const addr = log.address.toLowerCase();
    const topic0 = log.topics[0];

    if (topic0 === TRANSFER_TOPIC && TRANSFER_LOG_ADDRESSES.includes(addr)) {
      hasTransfer = true;
      continue;
    }
    if (addr !== memoAddr) {
      if (isEscrowEvent(log)) {
        // Escrow event: assign the currently-open memo pair (or null when the
        // call was not memo-wrapped).
        memoIndexByLogIndex.set(String(logIndexNum(log)), openMemoIndex);
      }
      continue;
    }
    if (topic0 === BEFORE_MEMO_TOPIC) {
      openMemoIndex = beforeMemoIndex(log);
      continue;
    }
    if (topic0 === MEMO_TOPIC) {
      const fromData = memoLogIndex(log);
      // Prefer the BeforeMemo's index; the Memo log's own extraction is the
      // cross-check. Pair by ORDER (k-th BeforeMemo ↔ k-th Memo) per §4.2.
      const idx = openMemoIndex ?? fromData;
      if (idx !== null && idx !== undefined) {
        pairs.set(idx, {
          memoIndex: idx,
          callDataHash:
            log.data && log.data.length >= 66
              ? '0x' + log.data.slice(2, 66).toLowerCase()
              : null,
          memoId: log.topics[3] ?? null,
          sender: toAddr(log.topics[1]),
          target: toAddr(log.topics[2]),
        });
        if (fromData !== null && fromData !== idx) {
          console.warn(
            `[indexer] Memo/BeforeMemo index mismatch in tx ${log.transactionHash}: before=${idx} memo=${fromData}`,
          );
        }
      }
      openMemoIndex = null;
    }
  }

  return { memoIndexByLogIndex, pairs, hasTransfer };
}
