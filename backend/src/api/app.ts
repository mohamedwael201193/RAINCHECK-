import express, { type Express } from "express";
import { createRoutes } from "./routes.js";
import type { ReceiptSource } from "./types.js";

/**
 * createApp — build the Receipt API application (B1 chose Express; matched).
 *
 * CORS: the receipt API serves the dashboard. The allowed origin comes from
 * FRONTEND_URL (default http://localhost:3000). Set FRONTEND_URL to the
 * production dashboard origin before deploying.
 */
export function createApp(store: ReceiptSource): Express {
  const app = express();
  app.disable("x-powered-by");
  app.use(express.json({ limit: "256kb" }));

  const frontendUrl = process.env.FRONTEND_URL ?? "http://localhost:3000";
  app.use((req, res, next) => {
    res.setHeader("Access-Control-Allow-Origin", frontendUrl);
    res.setHeader("Vary", "Origin");
    res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    if (req.method === "OPTIONS") {
      res.status(204).end();
      return;
    }
    next();
  });

  app.use("/api", createRoutes(store));

  // JSON 404 for unknown API routes — never an HTML dead end.
  app.use("/api", (_req, res) => {
    res.status(404).json({ error: "not found" });
  });

  return app;
}
