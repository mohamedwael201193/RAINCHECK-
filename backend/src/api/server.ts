import "dotenv/config";
import type { Express } from "express";
import { ChainLogReceiptStore } from "./chainStore.js";
import { createApp as buildApiApp } from "./app.js";
import { createB2Source, type B2StoreLike } from "./ports.js";
import { CHAIN_ID, ESCROW_ADDRESS, ESCROW_ADDRESS_EURC, EURC_ADDRESS, EXPLORER, MEMO_ADDRESS, USDC_ADDRESS } from "../config.js";
import { defaultDbPath } from "../indexer/config.js";
import { startIndexer } from "../indexer/index.js";
import { openStore } from "../indexer/store.js";
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
 * STORE SELECTION: npm start boots the SQLite indexer (backend/src/indexer/)
 * and serves it through createB2Source(). The chain remains the source of
 * truth — the DB is a cache rebuilt from eth_getLogs. ChainLogReceiptStore
 * stays available for a direct log rebuild. See ports.ts.
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
  const dbPath = defaultDbPath();
  // One SQLite connection shared by the poller and the API. The chain is the
  // source of truth; this file is a cache and is rebuilt from eth_getLogs.
  const store = openStore(dbPath);
  const source = createB2Source(store);
  const indexer = startIndexer({ store });

  const app = createApp(source);
  app.get("/health", (_req, res) => {
    const state = indexer.getState();
    res.json({
      ok: true,
      chainId: CHAIN_ID,
      receipts: state.receipts,
      checkpoint: state.checkpoint,
      lastError: state.lastError ?? null,
    });
  });
  app.get("/config", (_req, res) => {
    res.json({
      chainId: CHAIN_ID,
      explorer: EXPLORER,
      escrow: process.env.ESCROW_ADDRESS ?? ESCROW_ADDRESS,
      escrowEurc: process.env.ESCROW_ADDRESS_EURC ?? ESCROW_ADDRESS_EURC,
      memo: MEMO_ADDRESS,
      usdc: USDC_ADDRESS,
      eurc: EURC_ADDRESS,
    });
  });

  app.listen(port, () => {
    console.log(`[api] RAINCHECK receipt API listening on :${port} (db ${dbPath})`);
  });

  // The first poll runs inside startIndexer. Log progress so a cold boot
  // (backfill from the deploy blocks) is visible, and never block listen —
  // Render's health check must answer while the backfill is still walking.
  const report = () => {
    const state = indexer.getState();
    console.log(
      `[api] index receipts=${state.receipts} checkpoint=${state.checkpoint ?? "none"}${state.lastError ? ` error=${state.lastError}` : ""}`,
    );
  };
  setTimeout(report, 5_000);
  setInterval(report, 30_000);
}

// `node dist/api/server.js` — the npm start entry. Importing this module from
// tests does not happen; the listen stays behind this direct-run check so a
// test import can never bind a port.
const invokedDirectly = process.argv[1]?.replace(/\\/g, "/").endsWith("/api/server.js")
  || process.argv[1]?.replace(/\\/g, "/").endsWith("/api/server.ts");
if (invokedDirectly) {
  start().catch((err) => {
    console.error(`[api] failed to start: ${(err as Error).message}`);
    process.exit(1);
  });
}
