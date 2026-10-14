// Circle Contracts API webhook receiver.
//
// Mounts POST /webhooks/circle on the backend app (B4) — or standalone:
//   import express from "express";
//   import { mountCircleWebhooks } from "./webhooks/receiver.js";
//   const app = express();
//   mountCircleWebhooks(app);
//   app.listen(process.env.PORT ?? 3000);
//
// IMPORTANT: signature verification needs the RAW request body, so the route
// uses express.raw() and is registered BEFORE any express.json() middleware.
// mountCircleWebhooks must be called before app.use(express.json()) in
// server.ts (Express matches routes in registration order).

import express from "express";
import { getConfiguredSecret, verifyCircleSignature, CIRCLE_SIGNATURE_HEADER } from "./verify.js";
import { ingestWebhookEvent } from "./ingest.js";

const BODY_LIMIT = "1mb";

export function mountCircleWebhooks(app: express.Express): void {
  // Circle sends HEAD requests when validating a webhook URL in the Console.
  app.head("/webhooks/circle", (_req, res) => res.sendStatus(200));
  app.get("/webhooks/circle", (_req, res) =>
    res.status(405).json({ error: "POST only" }),
  );

  app.post(
    "/webhooks/circle",
    express.raw({ type: "application/json", limit: BODY_LIMIT }),
    (req, res) => {
      void (async () => {
        const raw = req.body as Buffer;
        const signature = (req.headers[CIRCLE_SIGNATURE_HEADER] as string | undefined) ?? "";
        const secret = getConfiguredSecret();

        let verified = false;
        if (!secret) {
          // Degraded mode: no CIRCLE_WEBHOOK_SECRET configured, so the HMAC
          // cannot be checked. Accept as an unverified hint ONLY — ingest.ts
          // re-reads the named tx's logs from the chain before any state
          // change, so a forged payload can never create fake index state.
          console.warn(
            "[webhooks] CIRCLE_WEBHOOK_SECRET not set — accepting as UNVERIFIED hint only",
          );
        } else if (!signature) {
          res.status(401).json({ error: "missing signature" });
          return;
        } else {
          verified = verifyCircleSignature(raw, signature, secret);
          if (!verified) {
            res.status(401).json({ error: "invalid signature" });
            return;
          }
        }

        let parsed: unknown;
        try {
          parsed = JSON.parse(raw.toString("utf8"));
        } catch {
          res.status(400).json({ error: "invalid JSON" });
          return;
        }

        // Respond 200 immediately (Circle retries otherwise); process async.
        res.status(200).json({ received: true });
        try {
          const outcome = await ingestWebhookEvent(parsed, verified);
          console.log(`[webhooks] ${outcome}`);
        } catch (err) {
          console.error("[webhooks] ingest failed:", err instanceof Error ? err.message : err);
        }
      })();
    },
  );
}
