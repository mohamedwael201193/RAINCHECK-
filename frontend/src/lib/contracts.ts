/**
 * RAINCHECK contract addresses + minimal ABIs (Arc mainnet 5042).
 *
 * Source of truth: ~/workspace/your_files/raincheck-build-bible.md §4, §10.
 * - RaincheckEscrow 0x97f233865ae84DC7475F6D7CA404930654580CB5 (PRODUCTION V1, Sourcify exact_match)
 * - Memo contract   0x5294E9927c3306DcBaDb03fe70b92e01cCede505 (existing infra)
 * - Arc USDC        0x3600000000000000000000000000000000000000 (ERC-20 face, 6 decimals)
 *
 * Addresses are public on-chain data — never secrets. No private keys in env, ever.
 */

// Re-export the canonical addresses from the chain module (single source of truth).
export {
  ESCROW_ADDRESS,
  ESCROW_ADDRESS_EURC,
  MEMO_ADDRESS,
  EURC_ADDRESS,
  PAYMENT_TOKENS,
  tokenSymbolForEscrow,
  type PaymentTokenSymbol,
  type PaymentTokenConfig,
} from "./chain";

/** Arc USDC — ERC-20 face (6 decimals). The gas token is the same asset at 18 decimals. */
export const USDC_ADDRESS =
  "0x3600000000000000000000000000000000000000" as const;

/** RaincheckEscrow — the 6 state-changing functions (bible §4.1). */
export const ESCROW_ABI = [
  {
    name: "authorize",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "paymentId", type: "bytes32" },
      { name: "termsHash", type: "bytes32" },
      { name: "seller", type: "address" },
      { name: "amount", type: "uint256" },
      { name: "deadline", type: "uint256" },
    ],
    outputs: [],
  },
  {
    name: "attestDelivery",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "paymentId", type: "bytes32" },
      { name: "outputHash", type: "bytes32" },
    ],
    outputs: [],
  },
  {
    name: "capture",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [{ name: "paymentId", type: "bytes32" }],
    outputs: [],
  },
  {
    name: "flagNonDelivery",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "paymentId", type: "bytes32" },
      { name: "reasonHash", type: "bytes32" },
    ],
    outputs: [],
  },
  {
    name: "void",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [{ name: "paymentId", type: "bytes32" }],
    outputs: [],
  },
  {
    name: "voidAfterDeadline",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [{ name: "paymentId", type: "bytes32" }],
    outputs: [],
  },
] as const;

/** RaincheckEscrow — the 5 receipt events (the indexer's only input). */
export const ESCROW_EVENTS_ABI = [
  {
    name: "RaincheckOpened",
    type: "event",
    inputs: [
      { name: "paymentId", type: "bytes32", indexed: true },
      { name: "buyer", type: "address", indexed: true },
      { name: "seller", type: "address", indexed: true },
      { name: "termsHash", type: "bytes32", indexed: false },
      { name: "amount", type: "uint256", indexed: false },
      { name: "deadline", type: "uint256", indexed: false },
    ],
  },
  {
    name: "DeliveryAttested",
    type: "event",
    inputs: [
      { name: "paymentId", type: "bytes32", indexed: true },
      { name: "outputHash", type: "bytes32", indexed: false },
      { name: "attestedAt", type: "uint256", indexed: false },
    ],
  },
  {
    name: "RaincheckCaptured",
    type: "event",
    inputs: [
      { name: "paymentId", type: "bytes32", indexed: true },
      { name: "amount", type: "uint256", indexed: false },
    ],
  },
  {
    name: "NonDeliveryFlagged",
    type: "event",
    inputs: [
      { name: "paymentId", type: "bytes32", indexed: true },
      { name: "reasonHash", type: "bytes32", indexed: false },
    ],
  },
  {
    name: "RaincheckVoided",
    type: "event",
    inputs: [
      { name: "paymentId", type: "bytes32", indexed: true },
      { name: "amount", type: "uint256", indexed: false },
      { name: "refundedTo", type: "address", indexed: true },
    ],
  },
] as const;

/** Memo contract — memo(address target, bytes callData, bytes32 memoId, bytes memoData) (bible §4.2). */
export const MEMO_ABI = [
  {
    name: "memo",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "target", type: "address" },
      { name: "callData", type: "bytes" },
      { name: "memoId", type: "bytes32" },
      { name: "memoData", type: "bytes" },
    ],
    outputs: [],
  },
] as const;
