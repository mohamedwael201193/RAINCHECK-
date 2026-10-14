# RAINCHECK Receipt API (B4)

REST API over the RaincheckEscrow event stream. Matches B1's framework choice (Express).

## Source-of-truth rule (bible §3)

**Chain logs are the source of truth; the indexer is a cache.** Every response
field traces to an on-chain event, a Memo anchor, or a deterministic derivation
of them. Fields with no chain backing are `null` — never invented. Statuses are
derived from event NAMES (`RaincheckOpened` → `OPEN`, …), never enum ordinals.

## Files

| File | Purpose |
|---|---|
| `types.ts` | Statuses, canonical receipt schema (§4.6), `ReceiptView`, `ReceiptSource` port |
| `abi.ts` | The 5 escrow events + 2 Memo events (B1's `src/abi/RaincheckEscrow.json` is the ABI home; this file keeps event-only ABIs for log decoding) |
| `jcs.ts` | Minimal RFC 8785 canonicalization for `receiptHash = lowercase-hex(SHA-256(JCS(receipt)))` |
| `chainStore.ts` | `ChainLogReceiptStore implements ReceiptSource` — re-derives receipts from paged `eth_getLogs` over escrow + Memo contracts (viem). Bounded 2000-block pages, rate-limit backoff. |
| `ports.ts` | Merge adapters: `createB2Source(b2IndexerStore)` (B2), merge note for B3's `buildReceipt()` |
| `routes.ts` | The four endpoints (async handlers over `ReceiptSource`) |
| `app.ts` | `createApp(store)` — Express app + CORS |
| `server.ts` | `createApp()`, `createAppFromB2()`, `start()` |

## Endpoints

- `GET /api/receipts` — newest-first list. `?status=OPEN|ATTESTED|FLAGGED|VOIDED|CAPTURED`, `?limit=` (1–100, default 50), `?offset=`. Returns `{total, limit, offset, receipts: ReceiptSummary[]}`. Each summary carries `token` (`"USDC"|"EURC"`, derived from the originating escrow address via the `TOKEN_BY_ESCROW` config map — presentation-only, never part of the canonical hash) and `escrow` (the originating escrow instance address).
- `GET /api/receipts/:paymentId` — `{receipt, receiptHash, timeline[], token, escrow}`. Timeline rows: `{event, txHash, explorerUrl, memoIndex, blockTime, blockNumber}`, chronological. 400 on malformed paymentId, 404 when the chain has no such receipt.
- `GET /api/stats` — `{totalReceipts, byStatus, byToken, totalVolumeUSDCBase, totalVolumeUSDC, totalVolumeEURCBase, totalVolumeEURC, totalVoids}`, all folded from events. Volumes are per-token (USDC and EURC are different assets and are never summed).
- `GET /api/health` — `{ok, chainId: 5042, escrow, escrows, latestIndexedBlock}`.

CORS: `FRONTEND_URL` env (default `http://localhost:3000`).

## Multi-asset

One escrow instance per payment token (USDC `0x97f233865ae84DC7475F6D7CA404930654580CB5`, EURC `0x3ceba2fbeb27162bfc4888f6b61e48bd359c1e0a` — same V1 source, Sourcify exact_match, challengeWindow 300). Both instances are indexed by default. The canonical receipt (§4.6) is token-blind by design: `token` is derived at the API layer from the log's escrow address and excluded from `receiptHash`. Receipt identity is `(escrow, paymentId)` internally — the same 32-byte paymentId can open on both instances (uniqueness is enforced per contract); cross-escrow collisions are refused, never silently merged.

## Env (public config only — no secrets; see `backend/.env.example`)

`RPC_URL`, `PORT`, `FRONTEND_URL`, `ESCROW_ADDRESS`, `ESCROW_DEPLOY_BLOCK`
(default 25956323 — the USDC production escrow's deployment block),
`ESCROW_ADDRESS_EURC` (default `0x3ceba2fbeb27162bfc4888f6b61e48bd359c1e0a`;
set to empty to watch USDC only), `ESCROW_DEPLOY_BLOCK_EURC`
(default 25962288 — the EURC instance's deployment block).

## Merge notes

- **B1**: constants now imported from `backend/src/config.ts` (was duplicated; fixed).
- **B2**: `backend/src/indexer/` is still landing and does not compile under the repo's CommonJS tsconfig (TS5097 `.ts` import specifiers, `import.meta` in `config.ts`). Until it does, `start()` uses `ChainLogReceiptStore` (direct chain re-derivation — correct, not a hack). Swap: `createAppFromB2(b2IndexerStore)` in `ports.ts` — one line, no route changes.
- **B3**: when `backend/src/receipts/` exposes `buildReceipt()`, point `buildCanonicalReceipt()` in `chainStore.ts` at it so receipt construction has one home.
