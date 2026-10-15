# RAINCHECK — Build History

Everything below happened on **2026-10-14** (times in **UTC**; the whole product — research → contracts → backend → frontend → deploys → on-chain proofs — was built and proven in one day). Chain: **Arc mainnet, chain ID 5042**. Gas token: USDC (18-decimal native).

A stranger reading this file should be able to trace the whole build: what was made, when, by whom, what it cost, and where the receipts live.

---

## 0. Prior art (research wave, same day — before the build)

The product was designed and its escrow mechanism pre-proven in the R9 research round before any build worker was launched. Two experiment instances of the same source family were deployed on Arc mainnet and Sourcify-verified `exact_match`:

- **R9 reference instance** `0x41099436c5f18eA916B9ca3B835fdc4B5c758Deb` (challengeWindow 60s — documented experiment value; still live).
  Deploy tx `0xacec97a227d2e3529f7e44018499f35f0177dfbf57dbffb7d403f4bfc6d88bee`; Sourcify exact_match (creation + runtime), verified 2026-10-14T04:54:08Z. Source: `~/workspace/beacon-build/progress/deepdive-r9/RaincheckEscrow.sol`.
- **R9 void-path instance** `0x44357E99755705376627542509d8D2eabF02562F` — proved the VOID half (flag → void → full refund).
  Deploy tx `0xe6dfd6dc4de43351b8882fc8f5ea4aabd67715aa7553005e2f7e8c8542d3c904`, block 25867611.

The full R9 experiment log (deploy + authorize `0x0e0edcb4ec571dd5d41a817c97d044c0f3a8aacdd43d7f9ea75d6efd6857c528`, attest `0x09d42eb42bb5bff1fd3a84db739a4e01e196af91b3cef2dc79664bec59c5d900`, capture `0x78d48f08398031b1d9f3fa1bf389e4ac920f69ca344d51c48b2fd74056e30ae9`, void `0xf8ecf05d35d2c9b18675d48274877d4e569e6b72908bb2aad31ad8769b4fd60c`) lives in `~/workspace/your_files/raincheck-build-bible.md` §6 and is summarized in PROOFS.md §3 ("Prior art").

**Key research conclusion (R9, 2026-10-14):** RAINCHECK earned **9.0/10** on mainnet evidence. Above 9.0 requires real-world traction — no further research round can supply it. → build ordered.

---

## 1. Phase 1 build (morning, 2026-10-14)

**23 workers, four lanes:**

| Lane | Workers | What they built |
|---|---|---|
| Contracts | 6 | Foundry project, solc 0.8.24, optimizer OFF. `RaincheckEscrow.sol` (V1, production) + `RaincheckEscrowV2.sol` (experimental trust-stack deltas) + test suites |
| Backend | 6 | Indexer (chain watcher → sqlite store), REST API, receipt derivation (JCS canonical hashing), webhook receiver |
| Frontend | 10 | React + Vite SPA (per the founder redirect: Vite, not Next.js; `design-standard.md` binding). Landing, dashboard, verify pages, token-icon system, GetEurc panel |
| Deploy | 1 | Mainnet deployment scripts, gas-limit rules, Sourcify verification flow |

**Key decisions, made before/on the morning of the build:**

1. **Vite over Next.js** — founder order. React SPA, no SSR surface, deployable to Vercel/Render as static files.
2. **One escrow instance per token** — multi-asset = one `RaincheckEscrow` deployment per ERC-20, not a multi-token contract. Receipt identity is the composite `(escrow, paymentId)`.
3. **V2 experimental, never wired** — `RaincheckEscrowV2` may be dust-tested on-chain, but the production app integrates the audited V1 only.
4. **challengeWindow = 300s** — the spec value (bible §4.1, §5.3). The R9 source carried a 60s experiment value; the one production change before deploy was 60 → 300, logic otherwise identical.

---

## 2. 17:15 UTC — PRODUCTION DEPLOY (V1, USDC)

| Item | Value |
|---|---|
| Contract | `RaincheckEscrow` V1 (production) |
| Address | `0x97f233865ae84DC7475F6D7CA404930654580CB5` |
| Deploy tx | `0xebd2e3fbbf805ba36fe0c1173f655b10aa769fd6809ccdfec5e61cef5213aa51` |
| Block | 25956323 |
| challengeWindow | 300 (verified on-chain via `cast call challengeWindow()` == 300) |
| Token | USDC `0x3600000000000000000000000000000000000000` (6-decimal face) |
| Compiler | solc 0.8.24+commit.e11b9ed9, optimizer OFF |
| Runtime bytes | 7270 |
| Gas used | 1,617,695 @ 20,000,053,600 wei → 0.0323541 USDC |
| Sourcify | **exact_match** (creation + runtime), verified 2026-10-14T17:17:58Z — https://sourcify.dev/server/v2/contract/5042/0x97f233865ae84DC7475F6D7CA404930654580CB5 |
| Record | `contracts/deployments/arc-5042.json` |

This instance supersedes the R9 experiment instance `0x41099436…` as the live integration target for the indexer, dashboard, and verifier.

---

## 3. ~17:54 UTC — Integration (QA1)

The app was wired to the live V1 deployment. QA1 findings and fixes:

- Duplicate JCS (canonical-JSON) implementations found across backend/frontend — **unified into one shared implementation**.
- Page selection: **ActivityPage picked** as the canonical integration surface.
- All gates green: **forge 38/38** (an earlier "40/40" figure included 2 deleted forge-scaffold `Counter` tests — corrected, not hidden), **backend 52/52**, **frontend 54/54**.

---

## 4. 18:07–18:08 UTC — MULTI-ASSET DEPLOYS (founder order)

Founder order: add EURC as a first-class asset **now** (not roadmap). Two deployments:

### 4a. EURC escrow (production, V1)

| Item | Value |
|---|---|
| Contract | `RaincheckEscrow` V1, constructor arg = EURC |
| Address | `0x3ceba2fbeb27162bfc4888f6b61e48bd359c1e0a` |
| Deploy tx | `0x34f7240f5c074fa082ad4e6b672d0fbd2542792459e5f09d51ee2ebc586a4094` |
| Block | 25962288 |
| Token | EURC `0xBeF5f6D51CB62b58e6A8f77868681825c6fE21C1`, 6 decimals |
| challengeWindow | 300 (verified on-chain) |
| Gas used | 1,617,923 → 0.0323585 USDC |
| Sourcify | **exact_match** (creation + runtime), verified 2026-10-14T18:07:51Z — https://sourcify.dev/server/v2/contract/5042/0x3ceba2fbeb27162bfc4888f6b61e48bd359c1e0a |

**Checksum note:** the founder's stated EURC form carried a bad EIP-55 checksum. It was corrected and verified by recomputation; both forms are the same 20 bytes on-chain.

### 4b. V2 experimental escrow

| Item | Value |
|---|---|
| Contract | `RaincheckEscrowV2` (trust-stack deltas, bible §4.1) |
| Address | `0x3795b865f7fc84a14ab60456be9fc6dd0cb56f0c` |
| Deploy tx | `0x046f1744296e87e006ce1a48318cad992ac3d4cd3a22b5302db26f0b3d7cdcae` |
| Block | 25962342 |
| Token | USDC, challengeWindow 300 |
| Runtime bytes | 8196; gas used 1,817,969 → 0.0363594 USDC |
| Sourcify | **exact_match**, verified 2026-10-14T18:08:21Z — https://sourcify.dev/server/v2/contract/5042/0x3795b865f7fc84a14ab60456be9fc6dd0cb56f0c |
| Status | **EXPERIMENTAL — dust-test only, not audited, NOT app-wired** (per key decision 3) |

**Combined deploy cost:** 0.0323585 + 0.0363594 = **0.0687179 USDC** (~0.0687, "total 0.0687 USDC" in the build log).

---

## 5. ~18:09 UTC — QA2 dust (V1/USDC): happy + void + failure

The full trio ran against the production V1/USDC escrow (`0x97f233865ae84DC7475F6D7CA404930654580CB5`):

- **Happy:** authorize `0x0697041f9d71e2b80d78c308a634c49431ddc454dc1cb04326b7245cae152ac3` → attest `0x0d2c0f7da5c6288c508e8af729f9454f145f0e7fb8c1ef070f266382e22c5f04` → capture `0xd59f0d320acf596ef5a15a1109aae7ed70050d6e816b626f68ae25685d9b3b22` — **seller paid 0.01 USDC** (Transfer event = 10,000 base).
- **Void:** authorize `0x1837d7cb39959fe7517b5432dc2991cb70c537ea7a32f14a596973724775c7ad` → attest `0x54aae49af79ca741ec30bbf508359e6497127642fa4446912c881713cd355bfb` → flag `0x05855d92db957d892288ee743aeb47d4fc70478fbdb7cd5931604247a8715c22` → void `0x1223f1a53aa3424c2ccd4dc207f1b85a2c5fef86edabbabec436b3d8468b8324` — **buyer refunded 0.01 USDC**.
- **Failure:** capture `0x98f696c9af23a4aeb6036ff83ffa5dfb680b5e53a16097cd7f95b93d360cbe34` on an OPEN (never-attested) receipt **reverted with `not ATTESTED`** (status 0); receipt stayed OPEN — **funds stayed locked**.

Evidence: `evidence/qa2-e2e-results.json`, `evidence/qa2-failure-results.json`. Full per-tx breakdown in PROOFS.md §3.

---

## 6. ~18:27 UTC — Multi-asset integration (INT)

Backend now indexes **both** escrow instances; frontend adds a **USDC | EURC selector** and per-token stats.

- **Real bug caught:** the composite identity `(escrow, paymentId)` revealed a **cross-escrow paymentId collision** — the same 32-byte paymentId could open on both instances and would be silently merged under a single-key store. Fixed: identity is per-contract; migration backfills pre-multi-asset rows to the USDC production escrow.
- Gates re-greened: **backend 57/57**, **frontend 78/78**.

---

## 7. ~18:31 UTC — V2 dust tests

Against the experimental V2 escrow (`0x3795b865f7fc84a14ab60456be9fc6dd0cb56f0c`):

- **Happy:** 7-param authorize `0x3ee922ba26fe51531f4fafd1c62660d6d1d48296262b8fdebd9ffa0a1f1c77cf` (policyRef = keccak256("e2e-policy") stored — **V2 delta proven**) → attest `0xaa8479677c2c3be63a812437bf3d0c28ce5cd4648a711caba4091de01f420247` → capture `0x05a82f10edb131813bc22e11e313452ae5963c3f30272d1a284321c9318b686e` — seller paid.
- **Void:** authorize `0x1acea0032cc2b4c8f43a101dedfbb1ba11bb3765363716fb86d8c6bf2d388a64` → attest `0x9feadb35300068db6ff5fc4cc829225fa6a670c1826f4f56685848094b196d27` → flag `0x2e2c6889bf49021824df1afb9fe11386222c8fb92b8b2f830092e47bf8a8e3ba` → void `0xe1784b3b7236b24c23e512a574a24283054c10bd934ab750346f639d913e4f3c` — buyer refunded; **`disputes(seller)` = 1** — V2 delta proven.
- **Failure:** capture `0x6dd430cbc9e74c915cde1f48172dc200bac24f30afd4834616e2575ccc1b0214` on an OPEN receipt **reverted, status 0, `not ATTESTED`**.
- **Recovery:** `voidAfterDeadline` `0x25bd823ec538671916b0d355ce27f2f07f1807f3213cdcfc20d2d27a846c7aab` — refunded; disputes counter unchanged (liveness ≠ dishonesty, per spec).
- 13 broadcasts (12 ok + 1 intentional revert); total fees 0.033629 USDC; **zero principal lost**; V2 escrow final USDC balance = 0.

Evidence: `evidence/e2e-v2/PROOFS.md`, `evidence/e2e-v2/txlog.jsonl`.

---

## 8. 19:16 UTC — LI.FI swap proof

Founder order: a USDC-only user must never be stranded — the "Get EURC" path must be real.

- **LI.FI quote (tool: Kyberswap), same-chain USDC → EURC on Arc 5042.**
- Approve: `0xd503f54ace28b6d25cd535a50932283ca401105b2eb8151b10da0e7558d419a9`.
- Swap: `0x69872320406f3547a980564d5930b4b0cf727f8685557390f381a456d4e34e60` (block 25970407).
- **0.5 USDC → 0.448314 EURC** (estimate was 0.448319; received balance delta = 462,129 − 13,815 = 448,314 base).
- This **proves the "Get EURC" path** and funded the deployer's EURC balance for the EURC dust tests.

Evidence: `evidence/lifi-swap.json`.

---

## 9. ~19:26 UTC — EURC dust tests

The full trio on the production EURC instance (`0x3ceba2fbeb27162bfc4888f6b61e48bd359c1e0a`):

- **Happy:** approve `0x0ed5c1bc84d8779eb80e78251af301e895b165c450d06002277cbebe5f207a8b` → authorize `0x068c97c13f9e3aeda3516fccaa09ab1ccc816e684d130d927f0ec17fe820ffe0` → attest `0x32adffa8925aed921878bec6728b6faacb16d97d5ed4c9d3b0b677e6b5ba2e99` → capture `0x9818c1396b95ea60cbbc9e18ba138018133120fcdbc99ce477156eaa77ca323a` — **seller paid 0.01 EURC**.
- **Void:** authorize `0x3339a97d582c72a502beabeef73459796e5277e46ed0797d35ef446b4d6c25b2` → attest `0x81678dac6cd8977e79679bf34a430c42038d81a7411dbffa20edb6e7c33c619c` → flag `0x143267ec5aa5e4d7dc03c5534f94259ca62be6ff434438113b91e53bfeb61808` → void `0x65130f8b1b3ee19f1820c2464dcb850c91914a66cc22d68aabd760b777f04464` — **+0.01 EURC refund verified**.
- **Failure:** capture `0x35713984327c26d5149f5129c924c96879563ef302836374ccf9b7e10cb1096e` **reverted `not ATTESTED`**; dust recovered via attest `0x58c9102a6b9f6fc85ffa8552530d522087de21d40343fe673b60b1430afeefa1` → flag `0x4d4f94e2efb83848e027d63d12377085a673b49fb7fcff71141aaa2eee19be8c` → void `0x65de00044f86e946b034fd006c8ab127ec3b865e11df812a4d4cddd9ba072d6c`.
- Principal net ~0 across the suite (deployer was buyer AND seller; all dust refunded/voided). Completed 2026-10-14T19:26:06Z.

Evidence: `evidence/e2e-eurc.json`.

---

## 10. Also in the record

- **Design-law review:** a P0 nested-router crash was found and fixed; the hero "melt test" **passed**.
- **Mock hunts:** repo-wide sweeps (mock/stub/demo/fake/placeholder/TODO/HACK) came back **clean** — every remaining hit is an anti-fake comment, a test fixture, or an HTML `placeholder=` attribute. `MOCK-HUNT.md` (repo root and `frontend/MOCK-HUNT.md`).
- **README** written: architecture, run instructions, test gates, deployment record.
- **Repo hygiene:** `.env.example` (no secrets committed), `.gitignore`, `DEPLOY.md` (gas-limit rule: `runtimeBytes × 200 + 300,000`), `contracts/README.md`.

---

## 11. Money accounting (dust, Arc mainnet)

| Item | Cost (USDC) |
|---|---|
| V1/USDC deploy | 0.0323541 |
| EURC V1 deploy | 0.0323585 |
| V2 experimental deploy | 0.0363594 |
| QA2 e2e (V1/USDC, 8 txs) | 0.0196668 |
| QA2 failure (V1/USDC, 3 txs) | ~0.0068 (per-tx costWei totals in evidence) |
| V2 dust (13 broadcasts) | 0.033629 |
| EURC dust (15 txs) | 0.033975 |
| LI.FI swap (0.5 USDC → 0.448314 EURC) | 0.5 USDC principal + gas |
| **Principal lost in all tests** | **0** — every escrow ended at zero balance; all dust refunded or captured to the seller |

All gas paid in USDC (Arc's native 18-decimal gas token). No user funds ever touched: every test used the deployer's own dust, with the deployer acting as buyer and seller.

---

## 12. 2026-10-15 — publish session (local gates, then wallet)

Bundle `raincheck-build.bundle` SHA-256 `46b417196cf4feb678e206d037b89d7230a62128128d653d8df1d0b929be447a` matches the expected prefix `46b417196cf4feb6`. Cloned to `raincheck/`. Gates re-run on this machine:

| Gate | Result |
|---|---|
| `contracts && forge test` | **60/60** |
| `backend && npm test` | **57/57** |
| `frontend && npx tsc --noEmit` | clean after the two fixes below |
| `frontend && npm test` | **155/155** after the receipt-client fix |
| `frontend && npm run build` | succeeded |

**Fixes (this session, before any deploy):**

1. **Frontend tests 152/155.** `fetchReceipts` read `import.meta.env.VITE_API_URL` only. Vitest 2.1 `vi.stubEnv` writes `process.env` and does not update `import.meta.env`, so three amount-coercion tests threw "VITE_API_URL is not set". `apiBase()` now prefers the Vite value and falls back to `process.env.VITE_API_URL`. Browser behavior is unchanged when Vite injects the variable.
2. **`tsc --noEmit` TS6305.** `vite.config.ts` was in both the root program and the composite `tsconfig.node.json`. Root `include` is now `src` only; `tsc -b` still typechecks the Vite config.
3. **`npm start` did not serve receipts.** `backend/src/server.ts` only exposed `/health` and `/config`. The receipt API and SQLite indexer already existed and were unmounted. `npm start` / `npm run dev` now boot `dist/api/server.js`: one SQLite connection shared by the poller and `createB2Source()`, `/health` answers immediately while the backfill walks, `/config` lists both production escrows. `defaultDbPath()` uses `fileURLToPath` so Windows does not hand better-sqlite3 a `/D:/...` path. `*.db` is gitignored. Local boot against Arc mainnet indexed **6 live receipts** (USDC + EURC, statuses matching chain). No invented rows.
4. **Wallet.** A Privy app id borrowed from another product was rejected in the user's Chrome: `auth.privy.io` frame-ancestors allow only `till-0g.vercel.app`. That id was removed and never committed. The founder supplied a **Reown project id** (public, gitignored `frontend/.env` as `VITE_REOWN_PROJECT_ID`, not in git). Connect now opens the Reown modal on Arc 5042 when that variable is set. Signing is unchanged: `eth_signTransaction` + `eth_sendRawTransaction` to `https://rpc.mainnet.arc.io`. Privy remains the fallback only when Reown is unset and a real `VITE_PRIVY_APP_ID` is set.

**Still open at the end of this entry:** the in-browser dust lifecycle (user confirms in the wallet), GitHub push, Vercel, Render, and the post-deploy repeat of open → attest → capture. Third-party volume and the OIDC_RS256 tier stay specified-not-live. No fake receipts.

---

## 13. 2026-10-15 — wallet dust open, two real failures, then a send-path fix

Local app: API `http://127.0.0.1:3000` (`/health` ok, chain 5042, 6 indexed receipts, checkpoint advancing, `lastError` null). Vite `http://127.0.0.1:5174` (5173 is Hallpass). Reown connected in the user's Chrome as `0xf76e6B0920e9332fF4410f6dD53F01722AbC71a3`. Form: self-deal, 0.001 USDC, V1 production escrow, deadline the next morning. Nothing was broadcast on either failed attempt.

1. **Terms signature rejected by MetaMask: `Invalid input`.** `eth_signTypedData_v4` was sent `{...typedData, primaryType}` and the payload still contained snake_case `primary_type`. MetaMask's schema is `additionalProperties: false`. `signTermsWithInjected` now strips `primary_type` and sends `primaryType` only. Non-Error RPC objects are surfaced by their `message` instead of "Something went wrong."
2. **Approve rejected by MetaMask: `Method not supported`.** The terms signature succeeded (the failure stack is `sendTxShim` → `NewReceiptPage` approve, not the typed-data call). MetaMask does not implement `eth_signTransaction`. The Arc **node** `eth_sendTransaction` still 401s; the **wallet** method does not — MetaMask signs locally and broadcasts with `eth_sendRawTransaction`. `signAndBroadcastArc` now falls through to the wallet method when `eth_signTransaction` is missing, and still passes the manual gas limit so the wallet does not `eth_estimateGas`. `sendTxShim` delegates to that function. Receipt detail already had this fallback in `chain.ts` `signAndBroadcast`. UI copy that told MetaMask users to "connect MetaMask" was wrong and is gone.

**Dust receipt opened and attested (user confirmed in MetaMask).** Self-deal, 0.001 USDC, V1 production escrow `0x97f233865ae84DC7475F6D7CA404930654580CB5`. paymentId `0x208570faa8d6cecd4bb319210111006ae8daff227ec7d208fc216fa09f8ac39d`. Delivered bytes (UTF-8): `RAINCHECK publish dust: a one-page delivery note whose exact bytes will be sha256-attested on Arc mainnet.` outputHash `0x39b446fc3c1d7fa464748853a8d6eb89d40e98dc3f10adfb18a6797e8e73a4d3` (recomputed locally, matches chain).

| Step | Tx |
|---|---|
| approve (1000 base units to the escrow) | `0x24f1f48477396cb6e441a216260cf5075ee80a4466add27c4b6eba44a0bd2031` |
| authorize / RaincheckOpened, Memo #1272, block 26026063 | `0x4eb2cf5cb6316a14d4537d553317a3f64db76e2a644cbbc7f53726b1dd32f8fe` |
| attestDelivery, block 26026505, attestedAt 1792033794 | `0x1be41bdf15c2ee96add354cb12c8b34bc4f56b8507d16deed8f363149ec8e8bf` |

Chain status is ATTESTED. The pre-send `eth_call` on the unwrapped escrow step reported "Pre-send check passed" before the wallet prompt. MetaMask still logs `Method not supported` for `eth_signTransaction`; the wallet `eth_sendTransaction` fallback is what actually broadcast. The detail page 404'd for a few seconds because the indexer had not polled the new log yet, and the 404 path only probed V2. Retry after the poller caught up showed the receipt, with an honest "indexer says OPEN, chain says ATTESTED" banner until the cache caught the attest. The 404 path now reads both production escrows from chain before V2. Capture completed after the 300s window. Chain status `CAPTURED` (ordinal 3). capture tx `0x945755f14a09a35e0cd0c0bc65a59147b034be283f565158d66b110d3d50d959` (Memo #1274, block 26027221). The UI showed "Released to seller on-chain" and "This receipt is terminal (CAPTURED)." Pre-send check passed before the capture prompt. Print / Save as PDF button is on the receipt page (browser print dialog; not a fake export). Recorded in PROOFS.md §6.

**Still open:** GitHub push, Vercel, Render, and one more open → attest → capture through the deployed frontend. Third-party volume and OIDC_RS256 stay specified-not-live.

---

## 14. 2026-10-15 — operator name, Render free tier

The operator asked to be recorded as **devmo**.

Render target is a **free** web service (`plan: free` in `backend/render.yaml`). The free tier cannot mount a disk, so the persistent-disk block is removed. `RAINCHECK_DB_PATH` is `/tmp/raincheck-index.db`. That file is a cache: after the free instance sleeps or redeploys, the indexer rebuilds it from Arc mainnet. `FRONTEND_URL` stays dashboard-only (CORS for the Vercel origin). No paid instance type.
