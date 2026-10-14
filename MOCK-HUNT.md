# MOCK-HUNT + HONESTY SWEEP — RAINCHECK

**Agent:** QA3 | **Date:** 2026-10-14 20:45 EEST | **Scope:** `contracts/`, `backend/src/`, `frontend/src/` (read-only sweep)
**Verdict: CLEAN BILL.** Zero mock/fake-success paths users can reach. All routes, buttons, and APIs are honest.

---

## 1. Repo-wide mock hunt

**Method:** `grep -rnE "mock|stub|demo|fake|placeholder|lorem|TODO|FIXME|XXX|HACK"` over `contracts/src`, `backend/src`, `frontend/src`, `scripts`, excluding node_modules/dist/out/cache and test fixtures.

### Hits — all RESOLVED (no FLAGGED items)

| File:line | Hit | Classification |
|---|---|---|
| `backend/src/api/server.ts:28` | "serves an empty (honest) dataset rather than fake data" | RESOLVED — honest anti-fake comment; empty dataset on RPC failure is the documented behavior |
| `backend/src/webhooks/receiver.ts:42` | "forged payload can never create fake index state" | RESOLVED — anti-fake comment in HMAC verification logic |
| `frontend/src/components/landing/Hero.tsx:11` | "never faked" | RESOLVED — anti-fake comment |
| `frontend/src/components/landing/LiveStats.tsx:84` | "instead of showing fake data" | RESOLVED — anti-fake comment |
| `frontend/src/pages/LandingPage.tsx:17` | "never faked (§3, §10)" | RESOLVED — anti-fake comment |
| `frontend/src/pages/dashboard/ActivityPage.tsx:14,15` | "never shows fake data… No mock data" | RESOLVED — anti-fake comments |
| `frontend/src/pages/VerifyPage.tsx:23` | "No fake data" | RESOLVED — anti-fake comment |
| `frontend/src/App.tsx:11` | "never mock data" | RESOLVED — anti-fake comment |
| `NewReceiptPage.tsx:428,450,470`, `ReceiptDetailPage.tsx:826,971,1296,1318`, `VerifyPage.tsx:205,225` | HTML `placeholder=` attributes | RESOLVED — input format hints, explicitly excluded per task spec |
| `DashboardPage.tsx:54` | "no placeholder rows" | RESOLVED — anti-placeholder comment |
| `ActivityPage.tsx:160` | "never placeholders" | RESOLVED — anti-fake comment |
| `frontend/src/lib/__fixtures__/receiptHash.golden.json`, `receipt.test.ts`, `backend/src/receipts/receipt.test.ts` | 64-hex constants in test files | RESOLVED — test fixtures (expected-value vectors for hash golden tests), explicitly excluded |

**Zero TODO / FIXME / XXX / HACK / lorem hits.** No stub, demo, or mock code reachable from user flows.

---

## 2. Button audit (all 5 registered routes)

Every CTA below executes a real on-chain tx, real API/RPC read, or real local computation; disabled states carry a stated reason.

### `/` — LandingPage (Hero, LiveStats, TrustDisclosure, Footer)
- "Verify a receipt" (`Hero.tsx:129`) → `Link to="/verify"` — registered route ✓
- "Open receipt" (`Hero.tsx:136`) → `Link to="/dashboard/new"` — registered route ✓
- "How it works" (`LandingPage.tsx:33`) → anchor `#how`, exists at `LandingPage.tsx:48` ✓
- "Verify a receipt" (`LandingPage.tsx:36`) → `Link to="/verify"` ✓
- "Open a receipt" (`LandingPage.tsx:39`) → `Link to="/dashboard/new"` ✓
- Footer links → `/verify`, `/dashboard`, Arc explorer address (external) ✓
- No buttons in LiveStats/TrustDisclosure/HowItWorks — display components only.

### `/dashboard` — DashboardPage
- "Open receipt" (`DashboardPage.tsx:106`, also `:174`) → `Link to="/dashboard/new"` ✓
- Filter chips (`DashboardPage.tsx:121`) → `onClick={setFilter}` — real client-side filtering over live API rows; not fake.
- "Try again" (`DashboardPage.tsx:156`) → `setReloadKey` — real refetch of `GET /api/receipts` ✓
- Receipt cards → `Link to={/dashboard/r/:paymentId}` ✓
- Retry/empty-state buttons → real reload or link to `/dashboard/new` ✓

### `/dashboard/new` — NewReceiptPage
- "Connect wallet" (`NewReceiptPage.tsx:581`) → real wallet connect (`onConnect`); disabled with spinner + label "Connecting…" while pending. Below it a stated reason: "Connect a wallet first — any wallet can open a receipt." ✓
- "Open receipt" submit (`NewReceiptPage.tsx:591`) → full on-chain flow (`useTx` → `eth_signTransaction` + `eth_sendRawTransaction` to `https://rpc.mainnet.arc.io`), manual gas limit per Arc rules; `disabled={submitDisabled}` with stated reason "Fill in the highlighted fields above to continue." ✓
- Progress explorer links → real tx hashes on the Arc explorer ✓
- Failure path is honest: "Nothing was locked — only gas for mined transactions was spent." ✓

### `/dashboard/r/:paymentId` — ReceiptDetailPage
- "Retry" (`ReceiptDetailPage.tsx:620`) → real `setRefreshTick` RPC refetch ✓
- "Check pasted bytes" (`:834`) → real local `sha256` of pasted bytes compared to `outputHash` (line 565) ✓
- File-verify button (`:840`) → opens real file picker; real `sha256` of file bytes vs `outputHash` ✓
- "Connect wallet" (`:903`) → real connect; stated reason "Connect a wallet to act…" ✓
- "Dismiss" (`:931`) → clears sent-tx banner; cosmetic, fine ✓
- "Release to seller" (`:1065`) → preview dialog → "Sign & send in wallet" (`:1387`) broadcasts a REAL `capture()` on-chain tx via `sendAction` (preview modal, disabled `sending`); disabled without wallet with stated reason ✓
- "Compute sha256" (`:1302`) → real local hash of attest bytes; disabled unless bytes present ✓
- "Submit attestation" (`:1331`) → preview → real `attest()` on-chain tx; disabled unless valid `0x{64}` hash ✓
- "Cancel" (`:1401`) → cancels preview; cosmetic, fine ✓
- Copy button (VerifyPage-style snippet, `:57`) → `navigator.clipboard.writeText`; graceful catch with stated fallback ✓
- Explorer/tx links → real tx/address URLs on Arc explorer ✓

### `/verify` — VerifyPage
- Copy button (`VerifyPage.tsx:57`) → real clipboard write ✓
- "Verify receipt" submit (`:236`) → real RPC `eth_call`/receipt read of `outputHash` vs supplied bytes (`lib/verify.ts`); disabled while busy, spinner + "Checking on-chain…" ✓
- "Load live" (`:251`) → real live RPC fetch; disabled while busy ✓

**FLAGGED: none.** No button that looks live but does nothing.

---

## 3. API honesty — `backend/src/`

All routes in `backend/src/api/routes.ts` read from the `ReceiptSource` (today `ChainLogReceiptStore`, re-derived from `eth_getLogs` on Arc mainnet — chain as source of truth):

| Route | Implementation | Verdict |
|---|---|---|
| `GET /api/receipts` (`routes.ts:46`) | `store.listReceipts()` + real status filter/pagination/sort; errors → 400 | REAL |
| `GET /api/receipts/:paymentId` (`routes.ts:93`) | strict `paymentId` regex; `store.getReceipt()`; 404 when absent (honest) | REAL |
| `GET /api/stats` (`routes.ts:112`) | counts + volume aggregated from listed receipts — all fields derived from events | REAL |
| `GET /api/health` (`routes.ts:140`) | `latestIndexedBlock`, chainId, escrow address | REAL |

`server.ts` documents that if the initial chain scan fails, the API serves an **empty (honest) dataset rather than fake data** — per hard rule. No stub routes found anywhere in `backend/src`.

**FLAGGED: none.**

---

## 4. Secret scan

- No literal private keys, mnemonics, or seed phrases anywhere in source (all env access is `process.env.*`, documented in `backend/.env.example` / `frontend/.env.example`).
- The only `0x{64}` strings in non-test source are public deploy tx hashes in comments (`backend/src/config.ts:16`, `frontend/src/lib/chain.ts:55`).
- `0x{64}` hits in `backend/src/receipts/receipt.test.ts` are expected-value vectors for hash golden tests — not keys.
- The repo has no `.git` checkout / no committed history to audit here; the earlier compiled-output ABI noise (`"key"` fields in forge JSON) is public ABI data, not secrets.
- **Deployer key does NOT appear anywhere.** CLEAN.

---

## 5. Dead-end check

- All distinct `Link to=` targets: `/`, `/dashboard`, `/dashboard/new`, `/verify` — **all registered in `App.tsx`**. ✓
- Dynamic `navigate('/dashboard/r/${paymentId}')` and `<Link to={/dashboard/r/...}>` match the registered `/dashboard/r/:paymentId` route. ✓
- No `github.com` links (truncated or otherwise) in frontend code. ✓
- No links to `/activity` or any other unregistered route; the two `ActivityPage.tsx` candidates are deliberately unrouted (noted in `App.tsx`) and nothing links to them. ✓
- Unknown paths render the honest `NotFound` component. ✓

**FLAGGED: none.**

---

## Summary

**FLAGGED items: 0.** Clean bill across all five task areas — no mock/fake-success paths, no dead CTAs, no API stubs, no secrets, no dead-end links. The codebase's comments actively document the anti-fake policy ("never faked", "no mock data", "empty dataset rather than fake data"), and behavior matches the comments.
