/**
 * MemoClient — client-side helper for wrapping Raincheck escrow calls in
 * Arc's Memo contract annotations.
 *
 * Spec references: build-bible §4.2 (Memo contract), §5.2 (Arc chain
 * specifics), §9.1 (manual gas limits).
 *
 * Memo contract: 0x5294E9927c3306DcBaDb03fe70b92e01cCede505
 * Interface: memo(address target, bytes callData, bytes32 memoId, bytes memoData)
 *
 * Behavior: executes callData on target preserving the original msg.sender
 * (CallFrom precompile), then emits BeforeMemo → inner logs → Memo.
 *
 * HARD CONSTRAINTS (do not "work around" these):
 *  - The outer memo() call must be EOA-initiated; smart-contract wallets
 *    (Safe, 4337 accounts, bundlers) revert.
 *  - Max 1 KB memoData per call.
 *  - The contract REVERTS under eth_call and gas estimation: always submit
 *    as a real signed transaction with a MANUAL gas limit (see MEMO_GAS_LIMITS).
 *  - Memos are public on-chain forever. Never put secrets in memoData.
 */
import {
  bytesToHex,
  decodeEventLog,
  encodeFunctionData,
  isAddress,
  isHex,
  keccak256,
  parseAbi,
  toBytes,
  toEventSelector,
  type Address,
  type Hex,
  type Log,
  type TransactionReceipt,
} from 'viem';

/* ------------------------------------------------------------------ */
/* Constants                                                           */
/* ------------------------------------------------------------------ */

/** The deployed Memo contract on Arc mainnet (existing infrastructure). */
export const MEMO_CONTRACT_ADDRESS: Address =
  '0x5294E9927c3306DcBaDb03fe70b92e01cCede505';

/** Arc mainnet chain id. */
export const ARC_CHAIN_ID = 5042;

/** Arc USDC ERC-20 face (6 decimals). */
export const USDC_ERC20_ADDRESS: Address =
  '0x3600000000000000000000000000000000000000';

/**
 * System address that emits the standard Transfer event (18-decimal) first
 * in every tx that moves native USDC. Gas fees and block rewards are NOT
 * emitted by it.
 */
export const NATIVE_TRANSFER_EMITTER: Address =
  '0xffffFFFfFFffffffffffffffFfFFFfffFFFfFFfE';

/** Hard cap on memoData: 1 KB (contract-enforced). */
export const MAX_MEMO_DATA_BYTES = 1024;

export const MEMO_ID_PREFIX = 'raincheck';
export const MEMO_ID_VERSION = 'v1';

/**
 * Manual gas limits for memo-wrapped Raincheck calls (build-bible §9.1).
 * NEVER use eth_estimateGas for these — the Memo contract reverts under
 * estimation. These include headroom over measured reference costs
 * (authorize ~190k, attest ~104k, capture ~86k, flag ~81k, void ~85k).
 */
export const MEMO_GAS_LIMITS = {
  authorize: 250_000n,
  attest: 150_000n,
  capture: 120_000n,
  void: 120_000n,
  flag: 120_000n,
} as const;

export type MemoWrappedFunction = keyof typeof MEMO_GAS_LIMITS;

/** Recommended manual gas limit for a memo-wrapped escrow function. */
export function recommendedGasLimit(fn: MemoWrappedFunction): bigint {
  return MEMO_GAS_LIMITS[fn];
}

/* ------------------------------------------------------------------ */
/* ABIs                                                                */
/* ------------------------------------------------------------------ */

export const MEMO_ABI = parseAbi([
  'function memo(address target, bytes callData, bytes32 memoId, bytes memoData)',
  'event BeforeMemo(uint256 indexed memoIndex)',
  'event Memo(address indexed sender, address indexed target, bytes32 callDataHash, bytes32 indexed memoId, bytes memo, uint256 memoIndex)',
]);

const TRANSFER_EVENT_ABI = parseAbi([
  'event Transfer(address indexed from, address indexed to, uint256 value)',
]);

// Topic-0 selectors for dispatch. viem's decodeEventLog with an explicit
// eventName does not validate topics[0], so we gate each decode attempt
// on the selector first — otherwise BeforeMemo logs also decode as Memo.
const BEFORE_MEMO_SIG = toEventSelector('BeforeMemo(uint256)');
const MEMO_EVENT_SIG = toEventSelector(
  'Memo(address,address,bytes32,bytes32,bytes,uint256)',
);
const TRANSFER_SIG = toEventSelector('Transfer(address,address,uint256)');

const topic0Is = (log: Log, sig: Hex): boolean =>
  (log.topics[0] ?? '').toLowerCase() === sig.toLowerCase();

/* ------------------------------------------------------------------ */
/* memoId convention                                                     */
/* ------------------------------------------------------------------ */

/**
 * memoId convention: keccak256("raincheck:<label>:v1").
 * Use per-transition labels, e.g. "authorize", "attest", "capture",
 * "flag", "void", "voidAfterDeadline".
 */
export function memoIdFor(label: string): Hex {
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(label)) {
    throw new Error(
      `invalid memo label "${label}": must be 1-64 chars of [A-Za-z0-9_-]`,
    );
  }
  return keccak256(toBytes(`${MEMO_ID_PREFIX}:${label}:${MEMO_ID_VERSION}`));
}

/* ------------------------------------------------------------------ */
/* Wrapping (pure: no chain interaction)                                 */
/* ------------------------------------------------------------------ */

/**
 * Encode the outer memo() call that wraps an inner escrow call.
 *
 * Pure function — it only ABI-encodes. Submitting it is the caller's job:
 * sign with an EOA and broadcast a REAL transaction with a manual gas
 * limit from MEMO_GAS_LIMITS (see recommendedGasLimit). Do not simulate
 * or estimate gas first; the Memo contract reverts under eth_call.
 *
 * @param target    the escrow contract (or other contract) to call
 * @param callData  the exact encoded inner calldata to execute
 * @param label     per-transition label, e.g. "authorize" (drives memoId)
 * @param memoData  annotation bytes (<= 1 KB). Public forever. No secrets.
 */
export function wrapWithMemo(
  target: Address,
  callData: Hex,
  label: string,
  memoData: Hex | Uint8Array,
): Hex {
  if (!isAddress(target)) {
    throw new Error(`invalid target address "${target}"`);
  }
  if (!isHex(callData)) {
    throw new Error('callData must be 0x-prefixed hex');
  }
  const dataBytes: Uint8Array =
    typeof memoData === 'string' ? toBytes(memoData) : memoData;
  if (dataBytes.length > MAX_MEMO_DATA_BYTES) {
    throw new Error(
      `memoData is ${dataBytes.length} bytes; Memo contract caps it at ${MAX_MEMO_DATA_BYTES}`,
    );
  }
  return encodeFunctionData({
    abi: MEMO_ABI,
    functionName: 'memo',
    args: [target, callData, memoIdFor(label), bytesToHex(dataBytes)],
  });
}

/* ------------------------------------------------------------------ */
/* Receipt log parsing (pure over receipt logs, in order)               */
/* ------------------------------------------------------------------ */

export interface ParsedTransfer {
  from: Address;
  to: Address;
  value: bigint;
  /** Emitting contract: the USDC face or the native-system emitter. */
  emitter: Address;
  /** True when emitted by the native-USDC system address (18-decimal face). */
  isSystemNative: boolean;
}

export interface MemoFrame {
  /** Sequential memo index, reserved by BeforeMemo, closed by Memo. */
  memoIndex: bigint;
  sender: Address;
  target: Address;
  callDataHash: Hex;
  memoId: Hex;
  memo: Hex;
  /** Inner Transfer logs observed between BeforeMemo and Memo, in order. */
  transfers: ParsedTransfer[];
  /** All non-memo inner logs (decoded when known, raw otherwise). */
  innerLogs: Array<{ address: Address; eventName: string | null; args: unknown }>;
  /** True only when both BeforeMemo and its closing Memo were seen. */
  complete: boolean;
}

type RawLog = Log<bigint, number, false>;

/**
 * Decode a receipt's logs in order and group them into memo frames:
 * BeforeMemo → inner logs → Memo. Supports nested memo frames via a stack.
 *
 * Pure: takes the receipt's logs array as-is (already ordered).
 */
export function extractMemoFrames(logs: readonly RawLog[]): MemoFrame[] {
  const frames: MemoFrame[] = [];
  const stack: MemoFrame[] = [];

  for (const log of logs) {
    const asLog = log as unknown as Log;

    // BeforeMemo(uint256 indexed memoIndex)
    if (topic0Is(asLog, BEFORE_MEMO_SIG)) {
      const decoded = decodeEventLog({
        abi: MEMO_ABI,
        eventName: 'BeforeMemo',
        data: asLog.data,
        topics: asLog.topics,
      });
      const frame: MemoFrame = {
        memoIndex: decoded.args.memoIndex as bigint,
        sender: '0x0000000000000000000000000000000000000000',
        target: '0x0000000000000000000000000000000000000000',
        callDataHash: '0x',
        memoId: '0x',
        memo: '0x',
        transfers: [],
        innerLogs: [],
        complete: false,
      };
      stack.push(frame);
      frames.push(frame);
      continue;
    }

    // Memo(address indexed sender, address indexed target, bytes32
    // callDataHash, bytes32 indexed memoId, bytes memo, uint256 memoIndex)
    if (topic0Is(asLog, MEMO_EVENT_SIG)) {
      const decoded = decodeEventLog({
        abi: MEMO_ABI,
        eventName: 'Memo',
        data: asLog.data,
        topics: asLog.topics,
      });
      const idx = decoded.args.memoIndex as bigint;
      const pos = stack.findLastIndex((f) => f.memoIndex === idx);
      if (pos >= 0) {
        const frame = stack[pos];
        frame.sender = decoded.args.sender as Address;
        frame.target = decoded.args.target as Address;
        frame.callDataHash = decoded.args.callDataHash as Hex;
        frame.memoId = decoded.args.memoId as Hex;
        frame.memo = decoded.args.memo as Hex;
        frame.complete = true;
        stack.splice(pos, 1);
      }
      continue;
    }

    // Transfer (USDC face or native-system emitter) inside the current frame.
    if (topic0Is(asLog, TRANSFER_SIG)) {
      const decoded = decodeEventLog({
        abi: TRANSFER_EVENT_ABI,
        eventName: 'Transfer',
        data: asLog.data,
        topics: asLog.topics,
      });
      const emitter = (asLog.address ?? '').toLowerCase();
      const transfer: ParsedTransfer = {
        from: decoded.args.from as Address,
        to: decoded.args.to as Address,
        value: decoded.args.value as bigint,
        emitter: asLog.address as Address,
        isSystemNative: emitter === NATIVE_TRANSFER_EMITTER.toLowerCase(),
      };
      const top = stack[stack.length - 1];
      if (top) {
        top.transfers.push(transfer);
        top.innerLogs.push({
          address: asLog.address as Address,
          eventName: 'Transfer',
          args: decoded.args,
        });
      }
      continue;
    }

    // Unknown inner log: keep position info for the current frame.
    const top = stack[stack.length - 1];
    if (top) {
      top.innerLogs.push({
        address: asLog.address as Address,
        eventName: null,
        args: { data: asLog.data, topics: asLog.topics },
      });
    }
  }

  return frames;
}

/* ------------------------------------------------------------------ */
/* Verification & matching (pure)                                        */
/* ------------------------------------------------------------------ */

/**
 * Verify the frame's sender matches the wallet that was supposed to call
 * memo(). The Memo contract preserves the EOA as sender for the inner
 * call; this checks the outer Memo event agrees.
 */
export function verifyFrameSender(frame: MemoFrame, expectedSender: Address): boolean {
  return frame.sender.toLowerCase() === expectedSender.toLowerCase();
}

/**
 * Verify the frame's callDataHash against the exact inner calldata the
 * application created. This is the disambiguator for multi-transfer txs:
 * the hash cryptographically binds the annotation to one specific call.
 */
export function verifyCallDataHash(frame: MemoFrame, callData: Hex): boolean {
  return frame.callDataHash.toLowerCase() === keccak256(callData).toLowerCase();
}

export interface FrameMatch {
  frame: MemoFrame;
  /** Transfers considered the value evidence for this memo. */
  transfers: ParsedTransfer[];
  senderVerified: boolean;
  callDataHashVerified: boolean | null; // null when no reference calldata given
  /**
   * Always match on the system/ERC-20 Transfer log, never the memo alone:
   * a memo can wrap a zero-value call, so a frame with zero Transfer logs
   * carries NO value evidence and must not be treated as a payment.
   */
  hasValueEvidence: boolean;
}

/**
 * Match a parsed memo frame to its value transfers.
 *
 * Matching rule (build-bible §4.2 / §5.4):
 *  1. Frames come from the tx's own ordered logs (tx-hash matching is done
 *     by the caller — pass only logs from one receipt).
 *  2. For multi-transfer txs, compare callDataHash against the exact
 *     calldata; only then is the memo bound to a specific transfer set.
 *  3. Never match on the memo alone: hasValueEvidence is false unless at
 *     least one Transfer log sits inside the frame.
 */
export function matchFrame(
  frame: MemoFrame,
  opts: { expectedSender: Address; referenceCallData?: Hex },
): FrameMatch {
  return {
    frame,
    transfers: frame.transfers,
    senderVerified: verifyFrameSender(frame, opts.expectedSender),
    callDataHashVerified:
      opts.referenceCallData === undefined
        ? null
        : verifyCallDataHash(frame, opts.referenceCallData),
    hasValueEvidence: frame.transfers.length > 0 && frame.complete,
  };
}

/**
 * Full pipeline for one receipt: parse ordered logs into frames and match
 * each frame against an expected sender and optional reference calldata.
 */
export function matchReceipt(
  receipt: TransactionReceipt,
  opts: {
    expectedSender: Address;
    /** Map memoId → the exact inner calldata the app created. */
    referenceCallDataByMemoId?: Record<string, Hex>;
  },
): FrameMatch[] {
  const frames = extractMemoFrames(receipt.logs as unknown as RawLog[]);
  return frames.map((frame) =>
    matchFrame(frame, {
      expectedSender: opts.expectedSender,
      referenceCallData:
        opts.referenceCallDataByMemoId?.[frame.memoId.toLowerCase()],
    }),
  );
}
