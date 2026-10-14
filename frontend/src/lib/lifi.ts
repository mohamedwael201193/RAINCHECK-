/**
 * LI.FI same-chain swap plumbing (GETEURC) — USDC -> EURC on Arc (chain 5042).
 *
 * The quote comes from LI.FI's documented v1 API:
 *   GET https://li.quest/v1/quote
 *     ?fromChain=5042&toChain=5042
 *     &fromToken=0x3600000000000000000000000000000000000000 (USDC)
 *     &toToken=0xbEf5f6d51CB62b58e6A8f77868681825C6fe21c1 (EURC)
 *     &fromAmount=<base units>&fromAddress=<signer>
 *
 * Response-shape contract (validated at runtime by parseLifiQuoteResponse):
 * a success body carries `transactionRequest` { from, to, value, data,
 * gasPrice, gasLimit, chainId }, `toAmount`, and `estimate.approvalAddress`
 * (the spender USDC must be approved to, when the route needs an approval).
 * Error bodies carry { message, code }: code 1002 = no route for this pair,
 * code 1005 = rate limited. Anything else shaped differently is treated as
 * an error — never as a quote.
 *
 * Execution goes through F1's pipeline (src/lib/sendTx.ts):
 * eth_signTransaction + eth_sendRawTransaction to our own Arc RPC.
 * Gas is ALWAYS manual: LI.FI's gasLimit + 20% buffer, capped — never
 * eth_estimateGas (bible §9.1). The approval is a separate first step
 * (approve -> swap), each with user-words descriptions (design law §7.8).
 *
 * Nothing here holds secrets. Pure functions are unit-tested
 * (src/lib/__tests__/lifi.test.ts) with no network.
 */

import { useCallback, useEffect, useState } from "react";

// ---------------------------------------------------------------- constants

export const LIFI_API_BASE = "https://li.quest/v1";
export const LIFI_CHAIN_ID = 5042;

/** Arc mainnet USDC (6 decimals). */
export const LIFI_USDC_ADDRESS =
  "0x3600000000000000000000000000000000000000" as const;
/** Arc mainnet EURC (6 decimals, verified live on-chain). */
export const LIFI_EURC_ADDRESS =
  "0xbEf5f6d51CB62b58e6A8f77868681825C6fe21c1" as const;

/** Manual gas ceiling for a LI.FI swap leg (gasLimit + 20% buffer, capped). */
export const LIFI_GAS_CAP = 1_000_000n;
/** Manual gas limit for the ERC-20 approval leg — measured approves sit far below. */
export const LIFI_APPROVE_GAS = 120_000n;

// -------------------------------------------------------------------- types

export interface LifiTokenMeta {
  address: string;
  symbol: string;
  decimals: number;
}

export interface LifiTransactionRequest {
  from: `0x${string}`;
  to: `0x${string}`;
  value: `0x${string}`;
  data: `0x${string}`;
  gasPrice: `0x${string}`;
  gasLimit: `0x${string}`;
  chainId: number;
}

export interface LifiQuote {
  id: string;
  tool: string;
  fromToken: LifiTokenMeta;
  toToken: LifiTokenMeta;
  /** Base units, e.g. "500000" for 0.5 USDC. */
  fromAmount: string;
  fromAmountFormatted: string;
  /** Base units of EURC the route returns. */
  toAmount: string;
  toAmountMin: string;
  toAmountFormatted: string;
  /** LI.FI's estimated execution time in seconds; null when not provided. */
  estimatedSeconds: number | null;
  priceImpactPct: string | null;
  /**
   * Spender the user must approve USDC to before the swap — read from the
   * live response (estimate.approvalAddress), never hardcoded. Null when
   * the route needs no approval.
   */
  approvalAddress: `0x${string}` | null;
  approvalAmount: string | null;
  transactionRequest: LifiTransactionRequest;
}

export type LifiQuoteState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "quote"; quote: LifiQuote }
  | { status: "no-route" }
  | { status: "error"; message: string; retryable: boolean };

/**
 * One executable step of the swap. Carries exactly the fields F1's sendTx
 * consumes ({ to, data, gas }) plus the user-words description the UI
 * previews before signing (design law §7.8).
 */
export interface LifiStep {
  kind: "approve" | "swap";
  to: `0x${string}`;
  data: `0x${string}`;
  /** Manual gas — never estimated. */
  gas: bigint;
  /** User words — rendered directly in the UI confirm screen. */
  description: string;
  /** Technical detail — rendered in a collapsible debug element only. */
  technical: string;
}

// ------------------------------------------------------------ URL building

export function buildQuoteUrl(
  fromAmountBase: string,
  fromAddress: string,
): string {
  const q = new URLSearchParams({
    fromChain: String(LIFI_CHAIN_ID),
    toChain: String(LIFI_CHAIN_ID),
    fromToken: LIFI_USDC_ADDRESS,
    toToken: LIFI_EURC_ADDRESS,
    fromAmount: fromAmountBase,
    fromAddress,
  });
  return `${LIFI_API_BASE}/quote?${q.toString()}`;
}

// ------------------------------------------------------- response parsing
// Pure — unit-tested. The runtime shape check IS the verification against
// LI.FI's documented v1 API: anything that doesn't look like a quote is
// classified no-route / error, never executed.

const ADDR_RE = /^0x[0-9a-fA-F]{40}$/;
const HEX_RE = /^0x[0-9a-fA-F]*$/;

function asRecord(v: unknown): Record<string, unknown> | null {
  return v !== null && typeof v === "object" && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : null;
}

function asNonEmptyString(v: unknown): string | null {
  return typeof v === "string" && v.length > 0 ? v : null;
}

function asAddress(v: unknown): `0x${string}` | null {
  return typeof v === "string" && ADDR_RE.test(v) ? (v as `0x${string}`) : null;
}

function asHex(v: unknown): `0x${string}` | null {
  return typeof v === "string" && HEX_RE.test(v) ? (v as `0x${string}`) : null;
}

function asTokenMeta(v: unknown, fallbackDecimals: number): LifiTokenMeta | null {
  const r = asRecord(v);
  if (!r) return null;
  const address = asNonEmptyString(r.address);
  const symbol = asNonEmptyString(r.symbol);
  const decimals =
    typeof r.decimals === "number" && Number.isInteger(r.decimals) && r.decimals >= 0
      ? r.decimals
      : fallbackDecimals;
  if (!address || !symbol) return null;
  return { address, symbol, decimals };
}

function asTransactionRequest(v: unknown): LifiTransactionRequest | null {
  const r = asRecord(v);
  if (!r) return null;
  const from = asAddress(r.from);
  const to = asAddress(r.to);
  const value = asHex(r.value);
  const data = asHex(r.data);
  const gasPrice = asHex(r.gasPrice);
  const gasLimit = asHex(r.gasLimit);
  const chainId = typeof r.chainId === "number" ? r.chainId : null;
  if (!from || !to || !value || !data || !gasPrice || !gasLimit || chainId === null)
    return null;
  return { from, to, value, data, gasPrice, gasLimit, chainId };
}

/** Base-unit integer string -> human decimal string, e.g. ("500000", 6) -> "0.5". */
export function formatBaseUnits(value: string, decimals: number): string {
  const neg = value.startsWith("-");
  const digits = (neg ? value.slice(1) : value).replace(/\D/g, "") || "0";
  const int =
    decimals === 0
      ? digits.replace(/^0+(?=\d)/, "") || "0"
      : (digits.padStart(decimals + 1, "0").slice(0, -decimals).replace(/^0+(?=\d)/, "") ||
          "0");
  const frac =
    decimals === 0
      ? ""
      : digits.padStart(decimals + 1, "0").slice(-decimals).replace(/0+$/, "");
  return `${neg ? "-" : ""}${int}${frac ? "." + frac : ""}`;
}

function toLifiQuote(body: unknown): LifiQuote | null {
  const r = asRecord(body);
  if (!r) return null;
  const transactionRequest = asTransactionRequest(r.transactionRequest);
  const toAmount = asNonEmptyString(r.toAmount);
  const fromAmount = asNonEmptyString(r.fromAmount);
  // USDC and EURC on Arc are 6-decimal tokens; the response's own decimals
  // win when present.
  const fromToken = asTokenMeta(r.fromToken, 6);
  const toToken = asTokenMeta(r.toToken, 6);
  if (!transactionRequest || !toAmount || !fromAmount || !fromToken || !toToken)
    return null;

  const estimate = asRecord(r.estimate);
  const approvalAddress = estimate ? asAddress(estimate.approvalAddress) : null;
  const approvalAmount =
    estimate && typeof estimate.approvalAmount === "string"
      ? estimate.approvalAmount
      : null;

  const estimatedSeconds =
    estimate && typeof estimate.executionDuration === "number"
      ? Math.max(0, Math.round(estimate.executionDuration))
      : null;
  const priceImpactPct =
    typeof r.priceImpact === "string" && r.priceImpact.length > 0
      ? r.priceImpact
      : null;

  return {
    id: asNonEmptyString(r.id) ?? "lifi-quote",
    tool: asNonEmptyString(r.tool) ?? "lifi",
    fromToken,
    toToken,
    fromAmount,
    fromAmountFormatted: formatBaseUnits(fromAmount, fromToken.decimals),
    toAmount,
    toAmountMin: asNonEmptyString(r.toAmountMin) ?? toAmount,
    toAmountFormatted: formatBaseUnits(toAmount, toToken.decimals),
    estimatedSeconds,
    priceImpactPct,
    approvalAddress,
    approvalAmount,
    transactionRequest,
  };
}

/**
 * Classify a LI.FI /v1/quote HTTP response.
 *
 * - 429 / code 1005 -> error (retryable): rate limited, not "no route".
 * - 404 / code 1002 -> no-route: LI.FI has no USDC->EURC route on Arc.
 * - other non-2xx      -> error with LI.FI's message when it has one.
 * - 2xx without a transactionRequest -> error: the shape changed; the panel
 *   must not treat it as a quote (and so shows no swap button).
 */
export function parseLifiQuoteResponse(
  httpStatus: number,
  body: unknown,
): LifiQuoteState {
  const r = asRecord(body);
  const code = r && typeof r.code === "number" ? r.code : null;
  const message = r && typeof r.message === "string" ? r.message : null;

  if (httpStatus === 429 || code === 1005) {
    return {
      status: "error",
      retryable: true,
      message:
        message ??
        "LI.FI is rate-limiting price requests right now. Wait a few minutes and try again — the bridge option below works regardless.",
    };
  }
  if (httpStatus === 404 || code === 1002) return { status: "no-route" };
  if (httpStatus < 200 || httpStatus >= 300) {
    return {
      status: "error",
      retryable: httpStatus >= 500,
      message:
        message ??
        `The price request failed (HTTP ${httpStatus}). Try again, or use the bridge option below.`,
    };
  }
  if (message) {
    // 2xx with an error envelope is not a quote.
    return { status: "error", retryable: false, message };
  }
  const quote = toLifiQuote(body);
  if (!quote) {
    return {
      status: "error",
      retryable: false,
      message:
        "LI.FI answered, but the quote was missing the transaction it needs. Nothing was quoted — try again or use the bridge option below.",
    };
  }
  return { status: "quote", quote };
}

/** Fetch one quote; terminal states only (loading is owned by the hook). */
export async function getLifiQuote(
  params: { fromAmountBase: string; fromAddress: string },
  opts: { signal?: AbortSignal } = {},
): Promise<LifiQuoteState> {
  let res: Response;
  try {
    res = await fetch(buildQuoteUrl(params.fromAmountBase, params.fromAddress), {
      headers: { accept: "application/json" },
      signal: opts.signal,
    });
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError")
      return { status: "idle" };
    return {
      status: "error",
      retryable: true,
      message:
        "Couldn't reach LI.FI. Check your connection and try again — the bridge option below works regardless.",
    };
  }
  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    body = null;
  }
  return parseLifiQuoteResponse(res.status, body);
}

// ------------------------------------------------------------------ hook

export interface UseLifiQuoteParams {
  /** USDC base units as a decimal integer string, e.g. "500000". */
  fromAmountBase: string;
  fromAddress: string | null;
  enabled?: boolean;
  debounceMs?: number;
}

export interface UseLifiQuoteResult {
  state: LifiQuoteState;
  refresh: () => void;
}

/**
 * Live LI.FI quote for the panel. Fetches (debounced) only when the amount
 * is a positive integer and a wallet address is connected; otherwise idle.
 * The panel renders the swap button ONLY on { status: "quote" }.
 */
export function useLifiQuote({
  fromAmountBase,
  fromAddress,
  enabled = true,
  debounceMs = 600,
}: UseLifiQuoteParams): UseLifiQuoteResult {
  const [state, setState] = useState<LifiQuoteState>({ status: "idle" });
  const [nonce, setNonce] = useState(0);
  const refresh = useCallback(() => setNonce((n) => n + 1), []);

  useEffect(() => {
    const validAmount =
      /^\d+$/.test(fromAmountBase) && BigInt(fromAmountBase) > 0n;
    const validAddress =
      !!fromAddress && /^0x[0-9a-fA-F]{40}$/.test(fromAddress);
    if (!enabled || !validAmount || !validAddress || !fromAddress) {
      setState({ status: "idle" });
      return;
    }
    setState({ status: "loading" });
    const ctrl = new AbortController();
    const t = setTimeout(() => {
      void getLifiQuote(
        { fromAmountBase, fromAddress },
        { signal: ctrl.signal },
      ).then((s) => {
        if (!ctrl.signal.aborted) setState(s);
      });
    }, debounceMs);
    return () => {
      clearTimeout(t);
      ctrl.abort();
    };
  }, [fromAmountBase, fromAddress, enabled, debounceMs, nonce]);

  return { state, refresh };
}

// ------------------------------------------------------- tx construction
// Manual gas everywhere (bible §9.1): LI.FI's gasLimit + 20% buffer, capped.
// The approval is a separate first step — never bundled silently.

/** LI.FI gasLimit + 20% buffer, capped sanely. */
export function gasWithBuffer(gasLimitHex: string): bigint {
  const limit = BigInt(gasLimitHex);
  if (limit <= 0n) throw new Error("LI.FI gasLimit was not positive; refusing to build the tx.");
  const buffered = (limit * 120n) / 100n;
  return buffered > LIFI_GAS_CAP ? LIFI_GAS_CAP : buffered;
}

const APPROVE_SELECTOR = "095ea7b3";

function encodeApprove(
  spender: `0x${string}`,
  amountBase: string,
): `0x${string}` {
  const s = spender.slice(2).toLowerCase().padStart(64, "0");
  const a = BigInt(amountBase).toString(16).padStart(64, "0");
  return `0x${APPROVE_SELECTOR}${s}${a}`;
}

/**
 * Build the executable steps for a quote: an approval step first (only when
 * the route names an approvalAddress with a positive approvalAmount), then
 * the swap itself from LI.FI's transactionRequest.
 *
 * Throws when the route unexpectedly requires native value — a USDC->EURC
 * same-chain swap must be value-free.
 */
export function buildSwapSteps(
  quote: LifiQuote,
  _fromAddress: string,
): { approval: LifiStep | null; swap: LifiStep } {
  const tr = quote.transactionRequest;
  if (!/^0x0+$/.test(tr.value)) {
    throw new Error(
      "LI.FI's route unexpectedly requires native value. Refusing to build — a USDC→EURC swap must be value-free.",
    );
  }

  let approval: LifiStep | null = null;
  if (
    quote.approvalAddress &&
    quote.approvalAmount &&
    /^\d+$/.test(quote.approvalAmount) &&
    BigInt(quote.approvalAmount) > 0n
  ) {
    approval = {
      kind: "approve",
      to: LIFI_USDC_ADDRESS as unknown as `0x${string}`,
      data: encodeApprove(quote.approvalAddress, quote.approvalAmount),
      gas: LIFI_APPROVE_GAS,
      description: `Let the swap use exactly ${quote.fromAmountFormatted} USDC from your wallet`,
      technical: `approve(${quote.approvalAddress}, ${quote.approvalAmount}) on USDC ${LIFI_USDC_ADDRESS} · manual gas ${LIFI_APPROVE_GAS.toLocaleString()}`,
    };
  }

  const swap: LifiStep = {
    kind: "swap",
    to: tr.to,
    data: tr.data,
    gas: gasWithBuffer(tr.gasLimit),
    description: `Swap ${quote.fromAmountFormatted} USDC for about ${quote.toAmountFormatted} EURC`,
    technical: `LI.FI tool "${quote.tool}" · to ${tr.to} · gasLimit ${tr.gasLimit} + 20% buffer, capped at ${LIFI_GAS_CAP.toLocaleString()}`,
  };
  return { approval, swap };
}
