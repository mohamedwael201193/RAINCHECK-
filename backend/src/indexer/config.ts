/**
 * RAINCHECK indexer — chain config.
 *
 * Canonical values (chain, RPC, explorer, contract addresses) come from
 * backend/src/config.ts (B1); the escrow event ABIs come from
 * backend/src/abi/RaincheckEscrow.json (B1, from the Sourcify exact_match
 * reference source). This module re-exports them and adds only
 * indexer-specific constants: the name-based status machine, Memo topics,
 * and polling parameters.
 *
 * Source of truth: ~/workspace/your_files/raincheck-build-bible.md (§§3, 4.1, 4.2, 5.4).
 */
import { fileURLToPath } from 'node:url';
import { keccak256, toHex, type Abi, type AbiEvent } from 'viem';
import {
  CHAIN_ID,
  ESCROW_ADDRESS,
  ESCROW_ADDRESS_EURC,
  EURC_ADDRESS,
  EXPLORER,
  MEMO_ADDRESS,
  RPC_URL,
  USDC_ADDRESS,
  tokenForEscrow,
  type EscrowToken,
} from '../config.js';

/** Re-exported from the canonical config (single source of truth). */
export { tokenForEscrow, type EscrowToken };
export { TOKEN_BY_ESCROW } from '../config.js';
import escrowAbiJson from '../abi/RaincheckEscrow.json' with { type: 'json' };

export {
  CHAIN_ID,
  RPC_URL,
  ESCROW_ADDRESS,
  MEMO_ADDRESS,
};
/** B1 names this EXPLORER; the indexer historically used EXPLORER_URL. */
export const EXPLORER_URL = EXPLORER;
/** B1 names this USDC_ADDRESS (ERC-20 face, 6 decimals for payments). */
export const USDC_FACE_ADDRESS = USDC_ADDRESS;
/** EURC ERC-20 face (6 decimals) — the second production escrow's token. */
export const EURC_FACE_ADDRESS = EURC_ADDRESS;

/** Second R9 instance (same source) that proved the void path (§6.2). Included
 *  in self-tests and rebuilds; default live polling watches both. */
export const ESCROW_ADDRESS_R9_VOID =
  '0x44357E99755705376627542509d8D2eabF02562F' as const;

/** System address emitting the native-USDC Transfer log first in every tx that
 *  moves native USDC (18 decimals) — §5.2. */
export const SYSTEM_ADDRESS =
  '0xffffFFFfFFffffffffffffffFfFFFfffFFFfFFfE' as const;

/** First block the indexer scans. Grounded: the production escrow deployed at
 *  block 25956323 (contracts/deployments/arc-5042.json) — no escrow activity
 *  can exist before its own deploy block. Opt-in scans of the R9 void-path
 *  instance (ESCROW_ADDRESS_R9_VOID, deployed earlier) should pass their own
 *  startBlock explicitly. */
export const INDEX_START_BLOCK = 25_956_323;

/** eth_getLogs page size. Arc's RPC is happier with bounded ranges. */
export const LOG_RANGE_BLOCKS = 2_000;

/** Poll cadence for startIndexer(). */
export const POLL_INTERVAL_MS = 15_000;

/** The five escrow events, from backend/src/abi/RaincheckEscrow.json. */
const FULL_ABI = escrowAbiJson as unknown as Abi;
export const RAINCHECK_ESCROW_ABI: AbiEvent[] = FULL_ABI.filter(
  (e): e is AbiEvent => e.type === 'event',
);

/**
 * R9 void-path instance (0x4435…) wire format — RECONSTRUCTED FROM MAINNET LOGS.
 *
 * This contract is NOT Sourcify-verified. Its events come from the R9 wave-1c
 * iteration of the source (~/workspace/beacon-build/progress/deepdive-r9/w1c/
 * RaincheckEscrow.sol — NOT the same source as the production instance, despite
 * bible §6.2's "same source" line; the chain is truth). Observed topic0s on 5042:
 *   0xa57c1c86…  RaincheckOpened(bytes32 indexed,bytes32,address,address,uint256,uint256)
 *   0x32e8df43…  DeliveryAttested — identical to canonical
 *   0x88c0dcc9…  NonDeliveryFlagged(bytes32 indexed,address indexed,bytes32)
 *   0x9f392e88…  RaincheckVoided(bytes32 indexed,address indexed,uint256)
 * Argument NAMES are normalized to the canonical ones so receipt derivation
 * is identical; only the wire layout differs. The self-test asserts every
 * topic0 above against live logs. Verified against txs 0xa5c889b7…,
 * 0xc496c6a0…, 0x57959284…, 0xf8ecf05d….
 */
export const R9_VOID_ESCROW_ABI: AbiEvent[] = [
  {
    type: 'event',
    name: 'RaincheckOpened',
    inputs: [
      { name: 'paymentId', type: 'bytes32', indexed: true },
      { name: 'termsHash', type: 'bytes32', indexed: false },
      { name: 'buyer', type: 'address', indexed: false },
      { name: 'seller', type: 'address', indexed: false },
      { name: 'amount', type: 'uint256', indexed: false },
      { name: 'deadline', type: 'uint256', indexed: false },
    ],
  },
  {
    type: 'event',
    name: 'DeliveryAttested',
    inputs: [
      { name: 'paymentId', type: 'bytes32', indexed: true },
      { name: 'outputHash', type: 'bytes32', indexed: false },
      { name: 'attestedAt', type: 'uint256', indexed: false },
    ],
  },
  {
    type: 'event',
    name: 'NonDeliveryFlagged',
    inputs: [
      { name: 'paymentId', type: 'bytes32', indexed: true },
      { name: 'flaggedBy', type: 'address', indexed: true },
      { name: 'reasonHash', type: 'bytes32', indexed: false },
    ],
  },
  {
    type: 'event',
    name: 'RaincheckVoided',
    inputs: [
      { name: 'paymentId', type: 'bytes32', indexed: true },
      { name: 'refundedTo', type: 'address', indexed: true },
      { name: 'amount', type: 'uint256', indexed: false },
    ],
  },
  {
    type: 'event',
    name: 'RaincheckCaptured',
    inputs: [
      { name: 'paymentId', type: 'bytes32', indexed: true },
      { name: 'paidTo', type: 'address', indexed: true },
      { name: 'amount', type: 'uint256', indexed: false },
    ],
  },
] as unknown as AbiEvent[];

/** One watched escrow: its address, its event ABI, a human label, and the
 *  first block worth scanning (its own deploy block — no escrow activity can
 *  exist before it). Defaults to INDEX_START_BLOCK when omitted. */
export interface EscrowConfig {
  address: string;
  abi: AbiEvent[];
  label: string;
  startBlock?: number;
}

/** Production escrow — the indexer's default scope (task scope). */
export const PRODUCTION_ESCROW_CONFIG: EscrowConfig = {
  address: ESCROW_ADDRESS,
  abi: RAINCHECK_ESCROW_ABI,
  label: 'production',
  startBlock: INDEX_START_BLOCK,
};

/**
 * Production EURC escrow — the SAME V1 source as the production USDC instance
 * (Sourcify exact_match, challengeWindow 300); the constructor arg is the
 * only difference. Multi-asset = one escrow instance per token.
 * (contracts/deployments/arc-5042.json -> eurcEscrow, block 25962288.)
 */
export const EURC_ESCROW_CONFIG: EscrowConfig = {
  address: ESCROW_ADDRESS_EURC,
  abi: RAINCHECK_ESCROW_ABI,
  label: 'production-eurc',
  startBlock: 25_962_288,
};

/** The indexer's default watched set: both production escrows. */
export const DEFAULT_ESCROW_CONFIGS: EscrowConfig[] = [
  PRODUCTION_ESCROW_CONFIG,
  EURC_ESCROW_CONFIG,
];

/** R9 void-path instance — opt-in; default OFF (unverified variant wire format). */
export const R9_VOID_ESCROW_CONFIG: EscrowConfig = {
  address: ESCROW_ADDRESS_R9_VOID,
  abi: R9_VOID_ESCROW_ABI,
  label: 'r9-void-variant',
};

/** Event names — exactly the five in the ABI file; status is derived from NAME. */
export type EscrowEventName =
  | 'RaincheckOpened'
  | 'DeliveryAttested'
  | 'RaincheckCaptured'
  | 'NonDeliveryFlagged'
  | 'RaincheckVoided';

/**
 * Status is derived from the event NAME — never from the contract's Status enum
 * ordinal. Ordinals are a source-layout detail and differ between deployments
 * (see bible §4.1 "Ordinal caution"). This mapping is the state machine:
 *   OPEN → ATTESTED → CAPTURED
 *   ATTESTED → FLAGGED → VOIDED
 *   OPEN → VOIDED  (voidAfterDeadline)
 */
export const EVENT_TO_STATUS: Record<EscrowEventName, string> = {
  RaincheckOpened: 'OPEN',
  DeliveryAttested: 'ATTESTED',
  RaincheckCaptured: 'CAPTURED',
  NonDeliveryFlagged: 'FLAGGED',
  RaincheckVoided: 'VOIDED',
};

/** Legal predecessor statuses per event NAME. `null` = the receipt must not exist yet. */
export const LEGAL_PREDECESSORS: Record<EscrowEventName, (string | null)[]> = {
  RaincheckOpened: [null],
  DeliveryAttested: ['OPEN'],
  RaincheckCaptured: ['ATTESTED'],
  NonDeliveryFlagged: ['ATTESTED'],
  RaincheckVoided: ['FLAGGED', 'OPEN'],
};

/** Memo contract topics. Topic0s verified against the live void tx 0xf8ecf05d…
 *  (self-test asserts them). True wire layout, proven from live logs:
 *    BeforeMemo(uint256 indexed memoIndex)
 *    Memo(address indexed sender, address indexed target,
 *         bytes32 indexed memoId, bytes32 callDataHash, bytes memo,
 *         uint256 memoIndex)
 *  (topic0 depends only on the type list, so the keccak preimages below stay
 *  valid; the indexed-ness was corrected after decoding real receipts.)
 */
export const BEFORE_MEMO_TOPIC = keccak256(toHex('BeforeMemo(uint256)'));
export const MEMO_TOPIC = keccak256(
  toHex('Memo(address,address,bytes32,bytes32,bytes,uint256)'),
);
export const TRANSFER_TOPIC = keccak256(toHex('Transfer(address,address,uint256)'));

/** Addresses whose Transfer log counts as the "system Transfer log" for the
 *  memo-matching rule (§4.2): ERC-20 faces (USDC, EURC — one watched escrow
 *  per token), or the native-USDC system address. */
export const TRANSFER_LOG_ADDRESSES = [
  USDC_FACE_ADDRESS.toLowerCase(),
  EURC_FACE_ADDRESS.toLowerCase(),
  SYSTEM_ADDRESS.toLowerCase(),
];

/** Default DB path (backend/raincheck-index.db). Overridable via RAINCHECK_DB_PATH. */
export function defaultDbPath(): string {
  if (process.env.RAINCHECK_DB_PATH && process.env.RAINCHECK_DB_PATH.trim()) {
    return process.env.RAINCHECK_DB_PATH.trim();
  }
  // fileURLToPath, not URL.pathname: on Windows pathname is "/D:/..." which
  // better-sqlite3 cannot open.
  return fileURLToPath(new URL('../../raincheck-index.db', import.meta.url));
}
