/**
 * Pre-send eth_call simulation — run BEFORE any action button signs.
 *
 * KNOWN QUIRK (PROOFS.md): the Memo contract REVERTS under eth_call /
 * eth_estimateGas, so a memo-wrapped call can never be eth_call-previewed.
 * We therefore simulate the INNER escrow calldata UNWRAPPED against the
 * escrow contract — the exact bytes the Memo contract will forward on-chain.
 * Every UI surface that shows a simulation result MUST carry the honest
 * label SIMULATION_LABEL so nobody mistakes the preview for the full tx.
 *
 * Semantics:
 *  - eth_call succeeds          → the escrow step should succeed → sign away.
 *  - eth_call reverts           → the chain would reject it → DISABLE the
 *                                 sign button and show the revert reason in
 *                                 user words (explainRevert, design §7.8).
 *  - RPC unreachable            → the CHECK is unavailable, not the tx. The
 *                                 button stays enabled and the notice says the
 *                                 check is advisory — never block a user
 *                                 because our own RPC was down.
 *
 * No viem dependency: plain fetch JSON-RPC, same as lib/sendTx.ts's
 * broadcast path. `fetchImpl` is a test seam; production uses global fetch.
 */

import { RPC_URL, type ActionKind, type ActionTxPreview } from "./chain";
import {
  encodeFunctionCall,
  explainRevert,
  type BuiltTx,
  type TxKind,
} from "./tx";

/**
 * Honest label for every simulation surface. The wrapper IS applied at
 * signing — the preview only covers the escrow step.
 */
export const SIMULATION_LABEL =
  "Simulates the escrow step (memo wrapper excluded — the wrapper is applied at signing).";

/** The unwrapped escrow step to eth_call-preview. */
export interface SimulationTarget {
  /** Escrow contract address — the inner call's target, never the Memo. */
  to: `0x${string}`;
  /** Inner calldata — the exact bytes the Memo contract forwards on-chain. */
  data: `0x${string}`;
  /** For per-action user-words copy in explainRevert. */
  kind: TxKind;
}

export type SimulationOutcome =
  | { ok: true }
  | {
      ok: false;
      /**
       * "revert": the chain would reject this tx → disable signing.
       * "unavailable": the check itself couldn't run → signing stays enabled,
       * the notice is advisory.
       */
      kind: "revert" | "unavailable";
      /** User words (design-standard §7.8) — rendered directly. */
      userMessage: string;
      /** Technical detail — collapsible debug element, never headline copy. */
      technical: string;
      /** The contract's exact require string when decoded, else null. */
      requireString: string | null;
    };

export interface SimulateOptions {
  /** Passed as `from` so role/allowance checks simulate for this wallet. */
  from?: `0x${string}`;
  rpcUrl?: string;
  /** Test seam — real fetch in production. */
  fetchImpl?: typeof fetch;
}

const ACTION_TO_TX_KIND: Record<ActionKind, TxKind> = {
  attest: "attestDelivery",
  flag: "flagNonDelivery",
  capture: "capture",
  void: "void",
  voidAfterDeadline: "voidAfterDeadline",
};

/** Map a chain.ts action preview to its simulatable escrow step. */
export function previewToSimulationTarget(
  preview: ActionTxPreview,
): SimulationTarget {
  return {
    to: preview.inner.target,
    data: preview.innerData,
    kind: ACTION_TO_TX_KIND[preview.kind],
  };
}

/** Map an F1 BuiltTx (lib/tx.ts) to its simulatable escrow step. */
export function builtTxToSimulationTarget(built: BuiltTx): SimulationTarget {
  return {
    to: built.innerTarget,
    data: built.innerCalldata,
    kind: built.kind,
  };
}

/** Pull hex revert data out of a JSON-RPC error object (several shapes). */
function extractRevertData(error: unknown): string | null {
  const data = (error as { data?: unknown } | null)?.data;
  if (typeof data === "string" && data.startsWith("0x")) return data;
  if (data && typeof data === "object") {
    const inner = (data as Record<string, unknown>).data;
    if (typeof inner === "string" && inner.startsWith("0x")) return inner;
  }
  return null;
}

const REVERTED_MSG_RE = /execution reverted(?::\s*(.*?))?\s*$/i;

/**
 * eth_call the unwrapped escrow step at the latest block. Returns ok:true
 * when the call succeeds, ok:false with a user-words explanation when it
 * reverts, and ok:false/unavailable when the RPC itself couldn't be reached.
 */
export async function simulate(
  target: SimulationTarget,
  opts: SimulateOptions = {},
): Promise<SimulationOutcome> {
  const rpcUrl = opts.rpcUrl ?? RPC_URL;
  const fetchImpl = opts.fetchImpl ?? fetch;
  const callObject: Record<string, string> = {
    to: target.to,
    data: target.data,
  };
  if (opts.from) callObject.from = opts.from;

  let body: {
    result?: string | null;
    error?: { message?: string; data?: unknown };
  };
  try {
    const res = await fetchImpl(rpcUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "eth_call",
        params: [callObject, "latest"],
      }),
    });
    body = (await res.json()) as typeof body;
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    return {
      ok: false,
      kind: "unavailable",
      userMessage:
        "The pre-send check couldn't reach the Arc network, so it couldn't " +
        "verify this transaction. You can still sign — the check is advisory " +
        "when the network is unreachable.",
      technical: `eth_call transport failed: ${detail}`,
      requireString: null,
    };
  }

  if (body.result !== undefined && body.result !== null) {
    return { ok: true };
  }

  // The call reverted. Prefer hex revert data (decodes the contract's exact
  // require string); fall back to the RPC's "execution reverted: <reason>"
  // message; last resort is the generic no-reason copy.
  const data = extractRevertData(body.error);
  if (data) {
    const exp = explainRevert(data, target.kind);
    return {
      ok: false,
      kind: "revert",
      userMessage: exp.userMessage,
      technical: exp.technical,
      requireString: exp.requireString,
    };
  }

  const msg = String(body.error?.message ?? "");
  const m = msg.match(REVERTED_MSG_RE);
  const reason = (m?.[1] ?? "").trim();
  if (reason) {
    // Synthesize Error(string) revert data so explainRevert can map the
    // contract's require string to its user-words copy.
    const exp = explainRevert(
      encodeFunctionCall("Error(string)", ["string"], [reason]),
      target.kind,
    );
    return {
      ok: false,
      kind: "revert",
      userMessage: exp.userMessage,
      technical: `${exp.technical} (from RPC message: ${msg})`,
      requireString: exp.requireString,
    };
  }

  const exp = explainRevert("0x", target.kind);
  return {
    ok: false,
    kind: "revert",
    userMessage: exp.userMessage,
    technical: `eth_call reverted with no decodable reason. RPC said: ${msg || "(no message)"}`,
    requireString: null,
  };
}
