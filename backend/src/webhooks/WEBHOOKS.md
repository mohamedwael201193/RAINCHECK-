# RAINCHECK Webhooks (Circle Contracts API event monitors)

This module adds the real-time push path for the five `RaincheckEscrow` events
(`RaincheckOpened`, `DeliveryAttested`, `RaincheckCaptured`,
`NonDeliveryFlagged`, `RaincheckVoided` — exact signatures in the build bible
§4.1) to the receipt indexer. It lives in `backend/src/webhooks/`.

## The consistency model: polling is authoritative, webhooks are hints

Two paths feed the same ingest handler:

| Path | Role | Latency | Trust |
|---|---|---|---|
| `eth_getLogs` polling (B2's poller) | **Authoritative** | seconds–minutes (poll interval) | Reads chain directly. On every restart it re-scans from the checkpoint to the tip, so anything missed is recovered. |
| Circle event monitors → `POST /webhooks/circle` | **Low-latency hint** | ~1s (push) | Never trusted as state. Every accepted webhook triggers a targeted re-read of the named transaction's receipt **from the chain via RPC**; only logs the chain actually emitted reach the ingest handler. |

Reconcile-by-checkpoint rule:

1. The poller owns a **checkpoint** = the last block it has fully scanned. It
   advances monotonically and is persisted by the poller.
2. Webhooks **never advance the checkpoint** and never write index state
   directly. Each accepted webhook enqueues a hint (`state.ts`) with
   `notificationId`, `txHash`, `blockNumber`.
3. The poller's scan is a recount from the checkpoint: a webhook hint whose
   block is at/after the checkpoint is naturally re-read by the scan; a hint
   for a block *before* the checkpoint means Circle delivered late — the
   poller's idempotent ingest (same handler, dedupe by notificationId +
   txHash+logIndex) makes the double-delivery harmless.
4. On restart with no monitors configured, or with webhooks down, the system
   behaves identically to polling-only. Push adds latency, never correctness.

## Setup (only needed when CIRCLE_API_KEY exists)

1. Start the backend; it mounts `POST /webhooks/circle` automatically.
2. Expose it publicly (reverse proxy / tunnel) and set `WEBHOOK_URL`
   (e.g. `https://api.example.com`).
3. Register that URL in the Circle Developer Console → Webhooks (manual step
   per Circle docs). Note the **webhook secret** shown there → set
   `CIRCLE_WEBHOOK_SECRET`.
4. Run `npm run setup:monitors`. It calls `createEventMonitor(blockchain,
   contractAddress, eventSignature)` for each of the five escrow events on
   blockchain `"ARC"` (Arc mainnet, chain 5042; override with
   `CIRCLE_BLOCKCHAIN` for testnets) and prints the created monitor IDs.
   Re-running is idempotent ("already exists" is logged, not an error).

Without `CIRCLE_API_KEY` the script exits 0 after printing that polling mode
is active. The backend's default path needs no Circle account at all.

## Signature verification

Per Circle's webhook scheme, every POST carries the raw body signed as
HMAC-SHA256 with the webhook secret, hex-encoded, in the `X-Circle-Signature`
header (`verify.ts`). The receiver:

- 401s on a missing or mismatched signature when `CIRCLE_WEBHOOK_SECRET` is set.
- Uses `crypto.timingSafeEqual` (constant-time compare).
- Uses `express.raw()` for this route only, registered **before**
  `express.json()` in `server.ts` — JSON middleware would destroy the raw
  bytes the HMAC needs.
- If `CIRCLE_WEBHOOK_SECRET` is unset, accepts as an **unverified hint**:
  safe, because `ingest.ts` re-reads the transaction receipt from the chain
  before anything reaches the indexer's handler. A forged payload without a
  matching on-chain log produces no state change.

Always 200s fast (before processing) so Circle doesn't retry; processing is
async. Duplicate `notificationId`s are skipped (Circle retries deliveries).

## Feeding the indexer

`ingest.ts` exports `registerEscrowLogHandler(fn)`. The indexer's handler
receives viem `Log` objects — the same shape B2's `eth_getLogs` poller
produces — so one handler serves both paths. If no handler is registered yet,
webhooks are logged and reconciled via hints only.

Payload acceptance checks (all in `ingest.ts`): `notificationType` must be
`contracts.eventLog`; `contractAddress` must equal the deployed
`RaincheckEscrow` (case-insensitive); `txHash`/`blockHeight`/`topics`/`data`
must be present. Anything else is rejected with a logged reason, never
partially applied.

## Env vars (also in `.env.example`)

- `CIRCLE_API_KEY` — Contracts API key. Unset = polling-only (default).
- `CIRCLE_ENTITY_SECRET` — required alongside the API key to init the SDK client.
- `CIRCLE_WEBHOOK_SECRET` — webhook HMAC secret. Unset = hints unverified.
- `WEBHOOK_URL` — public base URL of this server (no trailing path).
- `CIRCLE_BLOCKCHAIN` — Contracts API blockchain label; default `"ARC"`.

Secrets are never printed: `setup-monitors.ts` logs monitor IDs only.
