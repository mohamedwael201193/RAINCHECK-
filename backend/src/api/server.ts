import "dotenv/config";
import type { Express } from "express";
import { ChainLogReceiptStore, EURC_FROM_BLOCK } from "./chainStore.js";
import { createApp as buildApiApp } from "./app.js";
import { createB2Source, type B2StoreLike } from "./ports.js";
import { ESCROW_ADDRESS, ESCROW_ADDRESS_EURC } from "../config.js";
import type { ReceiptSource } from "./types.js";

/**
 * Receipt API server wiring (B4).
 *
 * ENV (public configuration only — never secrets; see backend/.env.example):
 *   RPC_URL              Arc mainnet RPC (default https://rpc.mainnet.arc.io)
 *   PORT                 listen port (default 3000)
 *   FRONTEND_URL         dashboard origin for CORS (default http://localhost:3000)
 *   ESCROW_ADDRESS       RaincheckEscrow USDC deployment to index (production V1,
 *                        default 0x97f233865ae84DC7475F6D7CA404930654580CB5)
 *   ESCROW_DEPLOY_BLOCK  first block to scan for the USDC instance
 *                        (default 25956323, the production deployment block)
 *   ESCROW_ADDRESS_EURC  RaincheckEscrow EURC deployment to index (production V1,
 *                        default 0x3ceba2fbeb27162bfc4888f6b61e48bd359c1e0a)
 *   ESCROW_DEPLOY_BLOCK_EURC  first block to scan for the EURC instance
 *                        (default 25962288, its deployment block)
 *
 * Multi-asset: both production escrow instances are indexed by default
 * (one instance per token). Set ESCROW_ADDRESS_EURC="" to watch USDC only.
 *
 * STORE SELECTION: B2's indexer (backend/src/indexer/) is still landing and
 * does not compile yet under the repo's CommonJS tsconfig, so today the API
 * re-derives receipts straight from eth_getLogs (ChainLogReceiptStore) — the
 * chain is the source of truth, so this is correct, not a fallback hack. To
 * switch to B2's SQLite cache once it compiles: pass its IndexerStore into
 * createB2Source() and hand the result to createApp(). See ports.ts.
 *
 * The initial chain scan is best-effort: if the RPC is unreachable the API
 * still starts and serves an empty (honest) dataset rather than fake data.
 */

/** Build the API app over an explicit receipt source. */
export function createApp(store?: ReceiptSource): Express {
  const source = store ?? new ChainLogReceiptStore();
  return buildApiApp(source);
}

/** Build the API app over B2's indexer store (use once B2 compiles). */
export function createAppFromB2(b2: B2StoreLike): Express {
  return buildApiApp(createB2Source(b2));
}

/** Boot the receipt API server. */
export async function start(): Promise<void> {
  const port = Number(process.env.PORT ?? "3000");
  const escrowAddress = process.env.ESCROW_ADDRESS ?? ESCROW_ADDRESS;
  const fromBlock = BigInt(process.env.ESCROW_DEPLOY_BLOCK ?? "25956323");
  const escrowAddressEurc = (process.env.ESCROW_ADDRESS_EURC ?? ESCROW_ADDRESS_EURC).trim();
  const fromBlockEurc = BigInt(process.env.ESCROW_DEPLOY_BLOCK_EURC ?? String(EURC_FROM_BLOCK));

  const escrows = [{ address: escrowAddress, fromBlock }];
  if (escrowAddressEurc) {
    escrows.push({ address: escrowAddressEurc, fromBlock: fromBlockEurc });
  }
  const store = new ChainLogReceiptStore({ escrows });
  try {
    await store.refresh();
    const n = (await store.listReceipts()).length;
    console.log(
      `[api] indexed ${n} receipts from chain logs (escrows ${escrows.map((e) => e.address).join(", ")})`,
    );
  } catch (err) {
    console.warn(
      `[api] initial chain scan failed (${(err as Error).message}); serving empty dataset until refresh succeeds`,
    );
  }

  const app = createApp(store);
  app.listen(port, () => {
    console.log(`[api] RAINCHECK receipt API listening on :${port}`);
  });
}
