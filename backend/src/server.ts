import express from "express";
import { CHAIN_ID, EXPLORER, ESCROW_ADDRESS, ESCROW_ADDRESS_EURC, EURC_ADDRESS, MEMO_ADDRESS, USDC_ADDRESS } from "./config.js";
import { mountCircleWebhooks } from "./webhooks/index.js";

export function createApp(): express.Express {
  const app = express();
  // Circle event-monitor webhooks. Registered FIRST: the route consumes the
  // raw request body for HMAC verification, before any JSON parsing.
  mountCircleWebhooks(app);
  app.use(express.json({ limit: "64kb" }));

  // Liveness only — never reports chain state as "live" from cache.
  app.get("/health", (_req, res) => {
    res.json({ ok: true, chainId: CHAIN_ID });
  });

  // Declared integration targets: read-only introspection of the exact
  // deployments the indexer serves receipts from (one escrow per token).
  app.get("/config", (_req, res) => {
    res.json({
      chainId: CHAIN_ID,
      explorer: EXPLORER,
      escrow: ESCROW_ADDRESS,
      escrowEurc: ESCROW_ADDRESS_EURC,
      memo: MEMO_ADDRESS,
      usdc: USDC_ADDRESS,
      eurc: EURC_ADDRESS,
    });
  });

  // Receipt routes go here (receipt re-derivable from eth_getLogs + Memo anchors;
  // the indexer is a cache, never the source of truth).
  return app;
}

const port = Number(process.env.PORT ?? 3000);
createApp().listen(port, () => {
  console.log(`raincheck-backend listening on :${port}`);
});
