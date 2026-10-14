/**
 * Chain access layer for the RAINCHECK dashboard (F6).
 *
 * viem-based, self-contained until F8's lib/tx.ts lands (merge note: replace
 * buildActionTx / signAndBroadcast with F8's builders when available — the
 * function shapes are documented below so the swap is mechanical).
 *
 * Non-negotiables honored here (build bible §4.1, §7.2, §9.1):
 *  - attestedAt + challengeWindow are ALWAYS read from chain (eth_call),
 *    never from the indexer's clock. The capture gate uses the chain's own
 *    block timestamp as "now".
 *  - Status ordinals are NOT hardcoded as truth: the mapping comes from the
 *    Sourcify-verified source layout of the integrated deployment and is
 *    cross-checked against the indexer's status string; a mismatch surfaces
 *    a data-integrity warning instead of a silent wrong label.
 *  - Every state-changing tx is Memo-wrapped (bible §4.2) with a MANUAL gas
 *    limit — never eth_estimateGas (the Memo contract reverts under estimation).
 *  - Signing follows bible §9.1 workaround #1: prefer local signing via
 *    eth_signTransaction + eth_sendRawTransaction to our own RPC, falling
 *    back to eth_sendTransaction for injected wallets that don't expose
 *    eth_signTransaction (they broadcast through the wallet's own Arc RPC).
 *  - No secrets anywhere. RPC/explorer/contract addresses are public.
 */

import {
  createPublicClient,
  defineChain,
  encodeFunctionData,
  http,
  keccak256,
  stringToHex,
  toHex,
  type Abi,
} from "viem";

/**
 * Read a Vite-style env var without depending on vite/client types
 * (F1's scaffold may add those later — this cast avoids any conflict).
 */
export function envVar(key: string): string | undefined {
  const im = import.meta as unknown as { env?: Record<string, unknown> };
  const v = im.env?.[key];
  return typeof v === "string" && v.length > 0 ? v : undefined;
}

// ---------------------------------------------------------------------------
// Public constants (Arc mainnet 5042 — never testnet 5042002)
// ---------------------------------------------------------------------------

export const CHAIN_ID = 5042;
export const EXPLORER = "https://explorer.arc.io";
export const RPC_URL = envVar("VITE_RPC_URL")?.trim() || "https://rpc.mainnet.arc.io";

// RaincheckEscrow — PRODUCTION V1, Sourcify exact_match on 5042.
// (contracts/deployments/arc-5042.json; deploy tx 0xebd2e3fbbf805ba36fe0c1173f655b10aa769fd6809ccdfec5e61cef5213aa51,
// block 25956323, challengeWindow 300). Supersedes the R9 experiment instance
// 0x41099436c5f18eA916B9ca3B835fdc4B5c758Deb (60s challengeWindow).
export const ESCROW_ADDRESS = (envVar("VITE_ESCROW_ADDRESS")?.trim() ||
  "0x97f233865ae84DC7475F6D7CA404930654580CB5") as `0x${string}`;

// RaincheckEscrow — PRODUCTION V1 EURC instance, Sourcify exact_match on 5042.
// (contracts/deployments/arc-5042.json -> eurcEscrow; block 25962288,
// challengeWindow 300). SAME V1 source — constructor arg changed to EURC only.
// Multi-asset = one escrow instance per token; V2 experimental is NOT wired.
export const ESCROW_ADDRESS_EURC = (envVar("VITE_ESCROW_ADDRESS_EURC")?.trim() ||
  "0x3ceba2fbeb27162bfc4888f6b61e48bd359c1e0a") as `0x${string}`;

// Arc EURC — ERC-20 face (6 decimals), the EURC escrow's token.
export const EURC_ADDRESS =
  "0xbEf5f6d51CB62b58e6A8f77868681825C6fe21c1" as const;
// Arc USDC — ERC-20 face (6 decimals), the USDC escrow's token.
export const USDC_ADDRESS =
  "0x3600000000000000000000000000000000000000" as const;

/** Payment-token symbol. Both production tokens are 6-decimal. */
export type PaymentTokenSymbol = "USDC" | "EURC";

export interface PaymentTokenConfig {
  symbol: PaymentTokenSymbol;
  /** The escrow instance that settles this token. */
  escrow: `0x${string}`;
  /** The ERC-20 token contract approved/pulled. */
  token: `0x${string}`;
  decimals: 6;
}

/** Multi-asset config map: one escrow instance per token (USDC default). */
export const PAYMENT_TOKENS: Record<PaymentTokenSymbol, PaymentTokenConfig> = {
  USDC: { symbol: "USDC", escrow: ESCROW_ADDRESS, token: USDC_ADDRESS, decimals: 6 },
  EURC: { symbol: "EURC", escrow: ESCROW_ADDRESS_EURC, token: EURC_ADDRESS, decimals: 6 },
};

/** Derive the payment-token symbol from an escrow address (null = unknown). */
export function tokenSymbolForEscrow(
  escrow: string | null | undefined,
): PaymentTokenSymbol | null {
  if (!escrow) return null;
  const lower = escrow.toLowerCase();
  for (const cfg of Object.values(PAYMENT_TOKENS)) {
    if (cfg.escrow.toLowerCase() === lower) return cfg.symbol;
  }
  return null;
}

// Memo contract — existing infrastructure (bible §4.2).
export const MEMO_ADDRESS =
  "0x5294E9927c3306DcBaDb03fe70b92e01cCede505" as const;

export const txUrl = (hash: string) => `${EXPLORER}/tx/${hash}`;
export const addressUrl = (addr: string) => `${EXPLORER}/address/${addr}`;

export const arc = defineChain({
  id: CHAIN_ID,
  name: "Arc",
  nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 }, // gas-USDC is 18 decimals
  rpcUrls: { default: { http: [RPC_URL] } },
  blockExplorers: { default: { name: "Arc Explorer", url: EXPLORER } },
});

export const publicClient = createPublicClient({
  chain: arc,
  transport: http(RPC_URL),
});

// ---------------------------------------------------------------------------
// ABIs (minimal, from the Sourcify-verified RaincheckEscrow source)
// ---------------------------------------------------------------------------

const ESCROW_ABI = [
  {
    name: "receipts",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "paymentId", type: "bytes32" }],
    outputs: [
      { name: "termsHash", type: "bytes32" },
      { name: "buyer", type: "address" },
      { name: "seller", type: "address" },
      { name: "amount", type: "uint256" },
      { name: "deadline", type: "uint256" },
      { name: "outputHash", type: "bytes32" },
      { name: "attestedAt", type: "uint256" },
      { name: "flagReasonHash", type: "bytes32" },
      { name: "status", type: "uint8" },
    ],
  },
  {
    name: "challengeWindow",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
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
    name: "capture",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [{ name: "paymentId", type: "bytes32" }],
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
] as const satisfies Abi;

const MEMO_ABI = [
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
] as const satisfies Abi;

/**
 * Status ordinal → name from the Sourcify-verified source layout of the
 * integrated deployment (enum Status { NONE, OPEN, ATTESTED, CAPTURED, VOIDED, FLAGGED }).
 * Bible §4.1 ordinal caution: ordinals are a source-layout detail. The UI
 * cross-checks this mapping against the indexer's status string and warns on
 * mismatch instead of trusting either blindly.
 */
export const STATUS_BY_ORDINAL = [
  "NONE",
  "OPEN",
  "ATTESTED",
  "CAPTURED",
  "VOIDED",
  "FLAGGED",
] as const;

export type ChainStatusName = (typeof STATUS_BY_ORDINAL)[number];

// ---------------------------------------------------------------------------
// Chain reads (source of truth for all time-sensitive gating)
// ---------------------------------------------------------------------------

export interface ChainReceiptView {
  termsHash: `0x${string}`;
  buyer: `0x${string}`;
  seller: `0x${string}`;
  amount: bigint;
  deadline: bigint;
  outputHash: `0x${string}`;
  attestedAt: bigint;
  flagReasonHash: `0x${string}`;
  statusOrdinal: number;
  statusName: ChainStatusName | "UNKNOWN";
  challengeWindow: bigint;
}

/** Read the full receipt struct + challengeWindow straight from chain. */
export async function readReceiptFromChain(
  paymentId: `0x${string}`,
  escrow: `0x${string}` = ESCROW_ADDRESS,
): Promise<ChainReceiptView> {
  const [r, challengeWindow] = await Promise.all([
    publicClient.readContract({
      address: escrow,
      abi: ESCROW_ABI,
      functionName: "receipts",
      args: [paymentId],
    }),
    publicClient.readContract({
      address: escrow,
      abi: ESCROW_ABI,
      functionName: "challengeWindow",
    }),
  ]);
  const [
    termsHash,
    buyer,
    seller,
    amount,
    deadline,
    outputHash,
    attestedAt,
    flagReasonHash,
    status,
  ] = r as readonly [
    `0x${string}`,
    `0x${string}`,
    `0x${string}`,
    bigint,
    bigint,
    `0x${string}`,
    bigint,
    `0x${string}`,
    number,
  ];
  const ordinal = Number(status);
  return {
    termsHash,
    buyer,
    seller,
    amount,
    deadline,
    outputHash,
    attestedAt,
    flagReasonHash,
    statusOrdinal: ordinal,
    statusName: STATUS_BY_ORDINAL[ordinal] ?? "UNKNOWN",
    challengeWindow: challengeWindow as bigint,
  };
}

/** "Now" according to the chain itself — the latest block timestamp. */
export async function readChainNow(): Promise<bigint> {
  const block = await publicClient.getBlock({ blockTag: "latest" });
  return block.timestamp;
}

// ---------------------------------------------------------------------------
// Action tx builders (Memo-wrapped, manual gas limits — bible §9.1)
// ---------------------------------------------------------------------------

export type ActionKind =
  | "attest"
  | "flag"
  | "capture"
  | "void"
  | "voidAfterDeadline";

const ACTION_LABEL: Record<ActionKind, string> = {
  attest: "Attest delivery",
  flag: "Flag non-delivery",
  capture: "Capture (release to seller)",
  void: "Void and refund",
  voidAfterDeadline: "Void after deadline",
};

/** Manual gas limits with headroom over the R9-measured Memo-wrapped costs. */
const GAS_LIMITS: Record<ActionKind, bigint> = {
  attest: 250_000n, // measured ~104k
  flag: 150_000n, // measured ~81k
  capture: 150_000n, // measured ~86k
  void: 150_000n, // measured ~85k
  voidAfterDeadline: 150_000n,
};

export interface ActionTxPreview {
  kind: ActionKind;
  label: string;
  /** The outer tx target — always the Memo contract (actions are Memo-wrapped). */
  to: `0x${string}`;
  data: `0x${string}`;
  value: "0x0";
  gas: string; // decimal string for display
  gasHex: `0x${string}`;
  chainId: number;
  /** Decoded inner call for the preview panel. */
  inner: { target: `0x${string}`; function: string; args: string[] };
  memoId: `0x${string}`;
}

function memoIdFor(label: string): `0x${string}` {
  // bible §4.2 convention: keccak256("raincheck:<label>:v1")
  return keccak256(stringToHex(`raincheck:${label}:v1`));
}

/**
 * Build the exact unsigned transaction an action will send.
 * Shape mirrors what F8's lib/tx.ts builders should produce, so the page
 * can swap implementations without changing the preview/prompt flow.
 *
 * `escrow` targets the action at a specific escrow instance (multi-asset:
 * USDC vs EURC). Defaults to the USDC production escrow.
 */
export function buildActionTx(
  kind: ActionKind,
  paymentId: `0x${string}`,
  extra?: { outputHash?: `0x${string}`; reasonHash?: `0x${string}` },
  escrow: `0x${string}` = ESCROW_ADDRESS,
): ActionTxPreview {
  let innerFn: string;
  let innerArgs: string[];
  let innerData: `0x${string}`;

  switch (kind) {
    case "attest": {
      if (!extra?.outputHash) throw new Error("attest requires outputHash");
      innerFn = "attestDelivery(bytes32,bytes32)";
      innerArgs = [paymentId, extra.outputHash];
      innerData = encodeFunctionData({
        abi: ESCROW_ABI,
        functionName: "attestDelivery",
        args: [paymentId, extra.outputHash],
      });
      break;
    }
    case "flag": {
      if (!extra?.reasonHash) throw new Error("flag requires reasonHash");
      innerFn = "flagNonDelivery(bytes32,bytes32)";
      innerArgs = [paymentId, extra.reasonHash];
      innerData = encodeFunctionData({
        abi: ESCROW_ABI,
        functionName: "flagNonDelivery",
        args: [paymentId, extra.reasonHash],
      });
      break;
    }
    case "capture":
      innerFn = "capture(bytes32)";
      innerArgs = [paymentId];
      innerData = encodeFunctionData({
        abi: ESCROW_ABI,
        functionName: "capture",
        args: [paymentId],
      });
      break;
    case "void":
      innerFn = "void(bytes32)";
      innerArgs = [paymentId];
      innerData = encodeFunctionData({
        abi: ESCROW_ABI,
        functionName: "void",
        args: [paymentId],
      });
      break;
    case "voidAfterDeadline":
      innerFn = "voidAfterDeadline(bytes32)";
      innerArgs = [paymentId];
      innerData = encodeFunctionData({
        abi: ESCROW_ABI,
        functionName: "voidAfterDeadline",
        args: [paymentId],
      });
      break;
  }

  const memoId = memoIdFor(kind);
  // Public reference line only — never secret data (memos are public forever).
  const memoData = stringToHex(`raincheck/${kind}/${paymentId.slice(0, 18)}`);
  const data = encodeFunctionData({
    abi: MEMO_ABI,
    functionName: "memo",
    args: [escrow, innerData, memoId, memoData],
  });
  const gas = GAS_LIMITS[kind];

  return {
    kind,
    label: ACTION_LABEL[kind],
    to: MEMO_ADDRESS,
    data,
    value: "0x0",
    gas: gas.toString(),
    gasHex: toHex(gas),
    chainId: CHAIN_ID,
    inner: { target: escrow, function: innerFn, args: innerArgs },
    memoId,
  };
}

// ---------------------------------------------------------------------------
// Wallet plumbing (bible §9.1)
// ---------------------------------------------------------------------------

export interface EthereumProvider {
  request: (args: { method: string; params?: unknown }) => Promise<unknown>;
  on?: (event: string, cb: (...a: unknown[]) => void) => void;
  removeListener?: (event: string, cb: (...a: unknown[]) => void) => void;
}

declare global {
  interface Window {
    ethereum?: EthereumProvider;
  }
}

export function getInjectedProvider(): EthereumProvider | null {
  return typeof window !== "undefined" && window.ethereum
    ? window.ethereum
    : null;
}

export async function connectWallet(): Promise<`0x${string}`> {
  const provider = getInjectedProvider();
  if (!provider) {
    throw new Error(
      "No wallet found. Install MetaMask or Rabby, or connect with an embedded wallet.",
    );
  }
  const accounts = (await provider.request({
    method: "eth_requestAccounts",
  })) as string[];
  if (!accounts?.length) throw new Error("Wallet connection was rejected.");
  await ensureArcChain(provider);
  return accounts[0] as `0x${string}`;
}

export async function ensureArcChain(
  provider: EthereumProvider,
): Promise<void> {
  const chainIdHex = (await provider.request({
    method: "eth_chainId",
  })) as string;
  if (chainIdHex?.toLowerCase() === toHex(CHAIN_ID).toLowerCase()) return;
  try {
    await provider.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: toHex(CHAIN_ID) }],
    });
  } catch (err: unknown) {
    const code = (err as { code?: number })?.code;
    if (code === 4902) {
      await provider.request({
        method: "wallet_addEthereumChain",
        params: [
          {
            chainId: toHex(CHAIN_ID),
            chainName: "Arc",
            nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 },
            rpcUrls: [RPC_URL],
            blockExplorerUrls: [EXPLORER],
          },
        ],
      });
    } else {
      throw err;
    }
  }
}

export class UserRejectedError extends Error {
  constructor() {
    super("Signature rejected in wallet. Nothing was sent on-chain.");
    this.name = "UserRejectedError";
  }
}

function isUserRejection(err: unknown): boolean {
  const code = (err as { code?: unknown })?.code;
  return code === 4001 || code === "ACTION_REJECTED";
}

export interface BroadcastResult {
  hash: `0x${string}`;
  /** true only when the receipt is mined with status == 1 */
  confirmed: boolean;
}

/**
 * Sign + broadcast an action tx, then wait for a mined receipt.
 * Honors bible §9.1 workaround #1: eth_signTransaction + eth_sendRawTransaction
 * to our own RPC first; injected wallets that lack eth_signTransaction fall
 * back to eth_sendTransaction (broadcast via the wallet's own Arc RPC).
 * A tx counts as "done" ONLY on a mined receipt with status 1 — never earlier.
 */
export async function signAndBroadcast(
  provider: EthereumProvider,
  from: `0x${string}`,
  preview: ActionTxPreview,
  opts?: { onTxHash?: (hash: `0x${string}`) => void },
): Promise<BroadcastResult> {
  const [nonce, gasPrice] = await Promise.all([
    publicClient.getTransactionCount({ address: from }),
    publicClient.getGasPrice(),
  ]);

  const unsigned = {
    from,
    to: preview.to,
    data: preview.data,
    value: preview.value,
    gas: preview.gasHex,
    gasPrice: toHex(gasPrice),
    nonce: toHex(nonce),
    chainId: toHex(CHAIN_ID),
  };

  let hash: `0x${string}`;
  try {
    // Path 1: local signing (bible §9.1 workaround #1).
    const signed = (await provider.request({
      method: "eth_signTransaction",
      params: [unsigned],
    })) as string;
    const res = await fetch(RPC_URL, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "eth_sendRawTransaction",
        params: [signed],
      }),
    });
    const json = (await res.json()) as {
      result?: `0x${string}`;
      error?: { message?: string };
    };
    if (json.error || !json.result) {
      throw new Error(
        `Broadcast failed: ${json.error?.message ?? "no tx hash returned"}`,
      );
    }
    hash = json.result;
  } catch (err) {
    if (isUserRejection(err)) throw new UserRejectedError();
    const code = (err as { code?: number })?.code;
    const msg = String((err as Error)?.message ?? err);
    const methodMissing =
      code === -32601 || code === -32602 || /method.*not.*(found|supported)/i.test(msg);
    if (!methodMissing) throw err;
    // Path 2: injected wallet without eth_signTransaction.
    try {
      hash = (await provider.request({
        method: "eth_sendTransaction",
        params: [
          {
            from,
            to: preview.to,
            data: preview.data,
            value: preview.value,
            gas: preview.gasHex,
          },
        ],
      })) as `0x${string}`;
    } catch (err2) {
      if (isUserRejection(err2)) throw new UserRejectedError();
      throw err2;
    }
  }

  opts?.onTxHash?.(hash);
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  return { hash, confirmed: receipt.status === "success" };
}

// ---------------------------------------------------------------------------
// Small formatting helpers
// ---------------------------------------------------------------------------

/** 6-decimal USDC base units (string) → human USDC, e.g. "1000" → "0.001". */
export function formatUSDC(baseUnits: string | bigint): string {
  const s = String(baseUnits);
  const neg = s.startsWith("-");
  const digits = (neg ? s.slice(1) : s).replace(/\D/g, "") || "0";
  const padded = digits.padStart(7, "0");
  const int = padded.slice(0, -6).replace(/^0+(?=\d)/, "");
  const frac = padded.slice(-6).replace(/0+$/, "");
  return `${neg ? "-" : ""}${int || "0"}${frac ? "." + frac : ""}`;
}

export function shortHex(h: string, head = 6, tail = 4): string {
  if (!h || h.length < head + tail + 3) return h;
  return `${h.slice(0, head + 2)}…${h.slice(-tail)}`;
}

export function isValidPaymentId(v: string | undefined): v is `0x${string}` {
  return !!v && /^0x[0-9a-fA-F]{64}$/.test(v);
}

export function formatChainTime(ts: bigint | number): string {
  const d = new Date(Number(ts) * 1000);
  const p = (n: number) => String(n).padStart(2, "0");
  return (
    `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())} ` +
    `${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())} UTC`
  );
}

/** "in 4m 12s" / "3h 2m ago" style countdown text for a unix-seconds target. */
export function countdownText(targetTs: bigint, nowTs: bigint): string {
  const diff = Number(targetTs) - Number(nowTs);
  const abs = Math.abs(diff);
  const h = Math.floor(abs / 3600);
  const m = Math.floor((abs % 3600) / 60);
  const s = abs % 60;
  const body = h > 0 ? `${h}h ${m}m` : m > 0 ? `${m}m ${s}s` : `${s}s`;
  return diff > 0 ? `in ${body}` : `${body} ago`;
}
