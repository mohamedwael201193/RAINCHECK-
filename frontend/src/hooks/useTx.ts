// RAINCHECK useTx hook — src/hooks/useTx.ts
//
// Takes a BuiltTx (from src/lib/tx.ts) → sends it via F1's sendTx
// (src/lib/sendTx.ts: eth_signTransaction + own-RPC eth_sendRawTransaction) →
// waits for the receipt → returns { status, txHash } or THROWS with the
// plain-language revert reason. Success is a mined receipt with status 1 ONLY.
//
// Expected F1 contract (src/lib/sendTx.ts must export this):
//   export async function sendTx(tx: BuiltTx): Promise<string>
// where the returned string is the 0x txHash. It signs with eth_signTransaction
// (Arc returns 401 on eth_sendTransaction — never use it) and broadcasts the
// raw tx to https://rpc.mainnet.arc.io via eth_sendRawTransaction.

import { useCallback, useEffect, useRef, useState } from "react";
import { sendTx } from "../lib/sendTx";
import {
  ARC_RPC_URL,
  explainRevert,
  type BuiltTx,
  type RevertExplanation,
} from "../lib/tx";

// ------------------------------------------------------------------ RPC utils

export interface RpcReceipt {
  transactionHash: string;
  blockNumber: string;
  status: string; // "0x1" | "0x0"
  logs: Array<unknown>;
}

export interface RpcTx {
  hash: string;
  from: string;
  to: string;
  input: string;
  value: string;
  gas: string;
}

async function rpcCall<T>(method: string, params: unknown[]): Promise<T> {
  const res = await fetch(ARC_RPC_URL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  const body = (await res.json()) as { result?: T; error?: { message?: string; data?: unknown } };
  if (body.error) {
    const err = new Error(body.error.message || `${method} failed`);
    (err as { rpcData?: unknown }).rpcData = body.error.data;
    throw err;
  }
  return body.result as T;
}

export async function getReceipt(txHash: string): Promise<RpcReceipt | null> {
  return rpcCall<RpcReceipt | null>("eth_getTransactionReceipt", [txHash]);
}

export async function getTx(txHash: string): Promise<RpcTx | null> {
  return rpcCall<RpcTx | null>("eth_getTransactionByHash", [txHash]);
}

/** Poll eth_getTransactionReceipt until it appears. Throws on timeout. */
export async function waitForReceipt(
  txHash: string,
  opts: { intervalMs?: number; timeoutMs?: number } = {},
): Promise<RpcReceipt> {
  const intervalMs = opts.intervalMs ?? 2000;
  const timeoutMs = opts.timeoutMs ?? 300_000;
  const start = Date.now();
  for (;;) {
    const receipt = await getReceipt(txHash);
    if (receipt) return receipt;
    if (Date.now() - start > timeoutMs) {
      const err = new Error(
        "This is taking longer than expected. The transaction may still go through — check the explorer before trying again.",
      ) as Error & { technical?: string };
      err.technical = `Timed out waiting for receipt of ${txHash} after ${Math.round(timeoutMs / 1000)}s.`;
      throw err;
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
}

/**
 * Best-effort revert explanation: replay the failed tx with eth_call at the
 * block it was included in, then split the result into user words
 * (`userMessage`, rendered directly) and technical detail (`technical`,
 * rendered in a collapsible debug element) per design-standard §7.8.
 */
export async function extractRevertExplanation(
  txHash: string,
  blockNumber: string,
  kind?: BuiltTx["kind"],
): Promise<RevertExplanation> {
  try {
    const tx = await getTx(txHash);
    if (!tx)
      return {
        userMessage: "The transaction didn't go through.",
        technical: `Transaction ${txHash} not found — cannot extract a reason.`,
        requireString: null,
      };
    const callParams = {
      from: tx.from,
      to: tx.to,
      data: tx.input,
      gas: tx.gas,
      value: tx.value ?? "0x0",
    };
    let returnData: string | null = null;
    try {
      returnData = await rpcCall<string>("eth_call", [callParams, blockNumber]);
    } catch (e) {
      // RPC errors often carry the revert data in `error.data`.
      const rpcData = (e as { rpcData?: unknown }).rpcData;
      if (typeof rpcData === "string" && rpcData.startsWith("0x")) returnData = rpcData;
      else if (rpcData && typeof rpcData === "object") {
        const inner = (rpcData as Record<string, unknown>).data;
        if (typeof inner === "string" && inner.startsWith("0x")) returnData = inner;
      }
      if (!returnData) {
        const msg = e instanceof Error ? e.message : String(e);
        return {
          userMessage: "The transaction didn't go through, and no reason was returned.",
          technical: `replay failed without decodable reason. RPC said: ${msg} (tx ${txHash})`,
          requireString: null,
        };
      }
    }
    return explainRevert(returnData, kind);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return {
      userMessage: "The transaction didn't go through.",
      technical: `reason extraction failed (${msg}). Tx: ${txHash}`,
      requireString: null,
    };
  }
}
// ---------------------------------------------------------------------- hook

export type TxPhase = "idle" | "sending" | "pending" | "done" | "error";

export interface TxState {
  phase: TxPhase;
  /** Set once the tx is broadcast. */
  txHash: string | null;
  /** User words (design-standard §7.8) — rendered directly in the UI. */
  error: string | null;
  /** Technical detail — rendered in a collapsible debug element, never as headline copy. */
  errorTechnical: string | null;
  receipt: RpcReceipt | null;
}

export interface TxResult {
  /** Mined receipt status — always 1 here; anything else throws. */
  status: 1;
  txHash: string;
  receipt: RpcReceipt;
}

const IDLE: TxState = { phase: "idle", txHash: null, error: null, errorTechnical: null, receipt: null };

export interface UseTxOptions {
  onSuccess?: (result: TxResult) => void;
  onError?: (error: Error & { technical?: string }) => void;
}

/** Attach technical detail to an Error without polluting its message. */
function fail(userMessage: string, technical: string): Error & { technical?: string } {
  const err = new Error(userMessage) as Error & { technical?: string };
  err.technical = technical;
  return err;
}

/**
 * useTx: send a BuiltTx and wait for a mined status-1 receipt.
 *
 * ```tsx
 * const { state, send, reset } = useTx();
 * const onOpen = async () => {
 *   const built = buildAuthorize(paymentId, termsHash, seller, amount, deadline);
 *   // preview built.data / built.description in the UI first
 *   const { txHash } = await send(built); // throws with plain reason on revert
 * };
 * ```
 */
export function useTx(options: UseTxOptions = {}) {
  const [state, setState] = useState<TxState>(IDLE);
  const mounted = useRef(true);
  const optsRef = useRef(options);
  optsRef.current = options;

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  // Track unmount to avoid setState after teardown.
  // (Effect ordering note: this runs once; safe with StrictMode.)
  const setIfMounted = useCallback((s: TxState | ((p: TxState) => TxState)) => {
    if (mounted.current)
      setState(typeof s === "function" ? (s as (p: TxState) => TxState) : () => s as TxState);
  }, []);

  const reset = useCallback(() => setIfMounted(IDLE), [setIfMounted]);

  const send = useCallback(
    async (built: BuiltTx): Promise<TxResult> => {
      const failState = (
        error: string,
        errorTechnical: string | null,
        txHash: string | null,
        receipt: RpcReceipt | null,
      ): never => {
        setIfMounted({ phase: "error", txHash, error, errorTechnical, receipt });
        const err = fail(error, errorTechnical ?? "");
        optsRef.current.onError?.(err);
        throw err;
      };

      setIfMounted({ phase: "sending", txHash: null, error: null, errorTechnical: null, receipt: null });
      let txHash: string;
      try {
        // F1's sendTx: eth_signTransaction + eth_sendRawTransaction to own RPC.
        txHash = await sendTx(built);
      } catch (e) {
        const technical = e instanceof Error ? e.message : String(e);
        return failState(
          "Couldn't sign or send the transaction. Check your wallet is connected and try again.",
          `sendTx failed: ${technical}`,
          null,
          null,
        );
      }

      setIfMounted({ phase: "pending", txHash, error: null, errorTechnical: null, receipt: null });

      let receipt: RpcReceipt;
      try {
        receipt = await waitForReceipt(txHash);
      } catch (e) {
        const technical =
          (e as { technical?: string })?.technical ?? (e instanceof Error ? e.message : String(e));
        return failState(e instanceof Error ? e.message : String(e), technical, txHash, null);
      }

      if (receipt.status !== "0x1") {
        const explanation = await extractRevertExplanation(txHash, receipt.blockNumber, built.kind);
        return failState(
          explanation.userMessage,
          `${explanation.technical} · tx ${txHash}`,
          txHash,
          receipt,
        );
      }

      const result: TxResult = { status: 1, txHash, receipt };
      setIfMounted({ phase: "done", txHash, error: null, errorTechnical: null, receipt });
      optsRef.current.onSuccess?.(result);
      return result;
    },
    [setIfMounted],
  );

  return { state, send, reset };
}
