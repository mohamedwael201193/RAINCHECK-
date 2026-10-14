# MOCK-HUNT — backend/ (excluding test/ sources and node_modules)

Grep: `mock|fake|demo|placeholder|lorem|todo` (case-insensitive) over `src/`, `dist/`,
`package.json`, `tsconfig*.json`. `dist/` hits are compiled copies of the `src/` hits
listed — not counted twice. Run 2026-10-14, re-run after the test rewrite. No secrets
were printed at any point.

## Hits in production code (src/)

| # | Location | Hit | Verdict |
|---|----------|-----|---------|
| 1 | `src/api/server.ts:28` | comment: "serves an empty (honest) dataset rather than fake data" | **RESOLVED** — explicit anti-fake design note: when the RPC is unreachable the API serves an empty dataset, never invented rows. Real data wired (ChainLogReceiptStore re-derives from `eth_getLogs`). |
| 2 | `src/webhooks/receiver.ts:42` | comment: "a forged payload can never create fake index state" | **RESOLVED** — security invariant, not a mock path: unverified webhook payloads are hints only; `ingest.ts` re-reads tx logs from chain before any state change. |
| 3 | `package.json` description | "No mock data." | **RESOLVED** — package policy statement, matches hard rule. |

## Hits in test/ sources (documented test-local helpers, not production paths)

| # | Location | Hit | Verdict |
|---|----------|-----|---------|
| 4 | `test/lib/derive.ts:8` | `TODO(B2): run the re-derivability assertions against the real IndexerStore once src/indexer/ compiles` | **RESOLVED** — clearly-marked TODO referencing the expected B2 interface, as authorized. The derivation under test already uses the PRODUCTION receipt builder (`src/api/chainStore.ts`), so only the store swap is pending. |
| 5 | `test/fixtures/logs.ts` | fixture log sequences modeled on bible §6.2/§6.3 (labeled FIXTURE) | **RESOLVED** — fixtures are explicitly allowed ("tests may use fixtures (clearly labeled)"); file header states they are synthetic sequences for determinism testing, not chain evidence. |
| 6 | `test/lib/seed.ts` (`remapIds`) | synthetic paymentIds/tx-hashes per seed row | **RESOLVED** — test-only ID remapping so seeded rows stay distinct; clearly labeled, never leaves the test DB. |

## Result

**0 FLAGGED. 6 RESOLVED.** No mock/fake/demo/placeholder/lorem data in any production
path. The API tests exercise the REAL Express app (`src/api/app.ts`) and the REAL
receipt builder (`src/api/chainStore.ts`); the single remaining TODO (#4) names the
B2 indexer interface it will attach to once that module compiles.

## Observation for the owner (not a mock issue)

Two JCS implementations coexist: `src/api/jcs.ts` (minimal, integer-only, used by the
API's `receiptHashOf`) and `src/receipts/jcs.ts` (wraps the `canonicalize` npm
package). Both are RFC 8785 for the receipt subset, but they differ on edge inputs
(fractions, undefined). One canonical JCS path should win before mainnet receipts
are hashed in two places.
