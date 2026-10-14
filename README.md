# RAINCHECK

**Delivery-attested receipts for agent commerce.** Pay for agent work: money is held in escrow, released when delivery is proven on-chain, refunded when it isn't. Every state transition is anchored through the on-chain Memo contract, so each receipt is portable, third-party-verifiable evidence — not a database row.

> No demo mode. No mock data. No fake success. Every button that looks executable executes on-chain, or it is disabled with the reason and the next action shown. If a control can't be backed by a real transaction, it isn't in the product.

---

## Contents

1. [The story](#the-story)
2. [Architecture](#architecture)
3. [Repo layout](#repo-layout)
4. [Mainnet contracts](#mainnet-contracts)
5. [Run locally](#run-locally)
6. [Deploy](#deploy)
7. [Wallet setup (Privy)](#wallet-setup-privy)
8. [Environment variables](#environment-variables)
9. [Tests](#tests)
10. [What you have to trust](#what-you-have-to-trust)
11. [Links](#links)

---

## The story

An agent pays for an API call, gets HTTP 400 or garbage bytes back, and has nothing to show its principal — the money is gone and no machine-verifiable proof exists that anything was delivered. RAINCHECK is a delivery-attested escrow that closes exactly this gap: the buyer locks USDC against signed terms, the seller attests delivery with the SHA-256 hash of the exact delivered bytes, a 300-second challenge window lets the buyer flag garbage, and then *anyone* can finalize — `capture` pays the seller, `void` refunds the buyer in full. Every step is wrapped through the on-chain Memo contract, so the receipt is anchored, queryable, and verifiable by any third party (marketplaces, auditors, trust-scorers) from chain state alone. The happy path (deliver → attest → capture → seller paid) and the dispute path (garbage → flag → void → full refund) are both proven on Arc mainnet with real signed transactions, recorded in the test ledger below.

---

## Architecture

```
                         ┌──────────────────────────────────────────────┐
                         │               ARC MAINNET (5042)             │
                         │                                              │
   ┌──────────┐          │   ┌───────────────────┐   ┌──────────────┐   │
   │   User   │          │   │ RaincheckEscrow   │   │ Memo         │   │
   │  + Privy │ sign ───▶│   │ 0x97f233…580CB5  │──▶│ 0x5294E9…    │   │
   │  wallet  │          │   │ (holds USDC)      │anchor│ e505 (annotation)││
   └────┬─────┘          │   └─────────┬─────────┘   └──────────────┘   │
        │               │             │ events (RaincheckOpened,       │
        │               └─────────────┼─────────────── DeliveryAttested,│
        ▼                             │               Captured, Voided) │
   ┌────────────┐                     ▼                                 │
   │  Frontend  │          ┌─────────────────────┐    ┌──────────────┐   │
   │  React +   │◀─────────│ Indexer (Node)      │───▶│ REST API     │   │
   │  Vite      │  HTTP    │ events → receipts   │    │ (SQLite)     │   │
   └────────────┘          └─────────────────────┘    └──────────────┘   │
```

**The chain is the source of truth. Everything else is a view of it.**

- **RaincheckEscrow** holds USDC per `paymentId`. State machine: OPEN → ATTESTED → CAPTURED, or ATTESTED → FLAGGED → VOIDED, or OPEN → VOIDED (deadline). `capture`, `void`, `voidAfterDeadline` are permissionless — no keeper, no liveness dependency, funds can never trap.
- **Memo** (`0x5294E9…e505`, existing infrastructure we use but never redeploy) wraps every state-transition transaction: execution and anchoring in one tx, with `callDataHash` cryptographically binding the annotation to the exact calldata.
- **Indexer** is a cache: it consumes the five escrow events (via Circle Contracts API monitors + webhooks, with `eth_getLogs` as fallback) and rebuilds canonical receipt JSON per `paymentId`. Every receipt it serves must be re-derivable from chain logs + Memo anchors alone.
- **Frontend** never invents state. Every displayed status is read from chain or the event cache; every action button maps to exactly one on-chain transaction.

---

## Repo layout

```
raincheck-build/
├── README.md            # this file
├── contracts/           # Foundry — RaincheckEscrow.sol, deploy scripts, forge tests
│   ├── src/             # Solidity sources
│   ├── test/            # forge tests (40/40 passing)
│   ├── script/          # deployment scripts
│   ├── deployments/     # arc-5042.json / arc-mainnet.json (verified addresses, Sourcify refs)
│   └── DEPLOY.md        # deployment runbook
├── backend/             # Node/Express + SQLite — event indexer + Receipt REST API
│   ├── src/             # indexer, receipt builder, API routes
│   └── test/            # backend tests (52/52 passing)
├── frontend/            # React + Vite + Tailwind + Privy — dashboard
│   ├── src/             # screens: receipt list, /new, receipt detail, /verify, /activity
│   └── MOCK-HUNT.md     # the hunt that killed every mock — nothing fake ships
└── scripts/             # shared ops scripts
```

Full build specification: [`raincheck-build-bible.md`](../your_files/raincheck-build-bible.md) — thesis, contract specs, test-evidence ledger, UI spec, wallet decision. It is the source of truth for *why* things are built the way they are.

---

## Mainnet contracts

All on **Arc mainnet (chain ID 5042)**. Verify everything below on the explorer before trusting it.

| Contract | Address |
|---|---|
| **RaincheckEscrow (production)** | `0x97f233865ae84DC7475F6D7CA404930654580CB5` |
| USDC (gas token + payment token) | `0x3600000000000000000000000000000000000000` |
| Memo (annotation infrastructure) | `0x5294E9927c3306DcBaDb03fe70b92e01cCede505` |

**Production escrow deployment record:**

- Deploy tx: `0xebd2e3fbbf805ba36fe0c1173f655b10aa769fd6809ccdfec5e61cef5213aa51`
- Block: **25956323**
- `challengeWindow`: **300 seconds** (spec value)
- Sourcify: **exact_match** (creation + runtime), chain 5042 — [verify the match](https://repo.sourcify.dev/contracts/chain/5042/address/0x97f233865ae84DC7475F6D7CA404930654580CB5)

**Prior art.** The mechanism was first proven on a 60-second-window experiment instance, `0x41099436c5f18eA916B9ca3B835fdc4B5c758Deb` (deploy tx `0xacec97a227d2e3529f7e44018499f35f0177dfbf57dbffb7d403f4bfc6d88bee`, Sourcify exact_match). On it we proved the deliver half (attest → capture → seller paid) and, on a second instance `0x44357E99755705376627542509d8D2eabF02562F`, the void half (garbage → flag → void → full refund, txs in the build bible §6). The production build above is the same verified source with the spec 300s window. The T0-O third-party-oracle tier and trust-stack deltas (`disputesBySeller`, `policyRef`/`fundingRef`) are **specified, not yet deployed** — they are not claimed as live anywhere in this product.

Note on the state enum: never hardcode status ordinals off-chain — read them from the Sourcify-verified source of the exact deployment you integrate with. The state machine is specified by **name** (OPEN → ATTESTED → CAPTURED; ATTESTED → FLAGGED → VOIDED; OPEN → VOIDED on deadline), never by number.

---

## Run locally

### Prerequisites

- Node 20+, npm
- Foundry (`forge`, `cast`) — for contracts
- A wallet with a small amount of Arc USDC (gas) if you want to execute on mainnet — gas price observed ≈ 20 gwei; a full receipt lifecycle costs roughly 0.008–0.01 USDC

### Contracts

```bash
cd contracts
forge build        # compile
forge test         # 40/40
```

### Backend (indexer + Receipt API)

```bash
cd backend
npm install
cp .env.example .env     # edit only if you need non-default public values
npm run dev              # starts the API (default http://localhost:4000)
```

The indexer boots by scanning from `ESCROW_DEPLOY_BLOCK` and then follows events via `eth_getLogs` (and Circle Contracts API monitors if `CIRCLE_API_KEY` is set). On first run it backfills — give it a few minutes against mainnet.

### Frontend (dashboard)

```bash
cd frontend
npm install
cp .env.example .env     # set VITE_PRIVY_APP_ID; VITE_API_URL points at the backend
npm run dev              # http://localhost:3000
```

Open a receipt, walk the flow. On the detail page, every action button names the exact transaction it will send before your wallet prompts. Attest/flag/capture/void are Memo-wrapped, sent with manual gas limits (never `eth_estimateGas` — the Memo contract reverts under estimation).

---

## Deploy

- **Frontend → Vercel.** Build command `npm run build`, output `dist`. Set `VITE_PRIVY_APP_ID` (public app ID) and `VITE_API_URL` (the backend URL) as environment variables. Ship on a **custom domain from day one** — shared-hosting subdomains get flagged on domain reputation in some wallets (a benign report is "received," not "cleared").
- **Backend → Render.** Node 20 runtime, start command `npm start`. Set `FRONTEND_URL` to the frontend origin (CORS), `RPC_URL` to your Arc RPC endpoint, `ESCROW_ADDRESS` to the production escrow above. Circle API keys go through the platform's secret store — never in the repo. A fresh deploy backfills the index from `ESCROW_DEPLOY_BLOCK`, so the dashboard is live without a data migration.

---

## Wallet setup (Privy)

The build bible picked **Privy** because the integration quirks on Arc are empirically documented with working workarounds — real teams have shipped this path, and the founder's own test wallets (MetaMask, Rabby) are covered by Privy's injected-connector path, so the tested flow and the shipped flow are the same thing.

1. Create an app at [privy.io](https://www.privy.io) and copy the **App ID** into `VITE_PRIVY_APP_ID`.
2. Login methods: **wallet (injected: MetaMask, Rabby, Coinbase Wallet) + email/SMS embedded wallets**. Embedded wallets on Arc are EOAs — they can sign everything RAINCHECK needs.
3. Add Arc mainnet as a custom chain:

```ts
const arcMainnet = {
  id: 5042,
  name: 'Arc',
  nativeCurrency: { name: 'USDC', symbol: 'USDC', decimals: 18 }, // gas-USDC is 18 decimals
  rpcUrls: { default: { http: ['https://rpc.mainnet.arc.io'] } },
  blockExplorers: { default: { name: 'Arc Explorer', url: 'https://explorer.arc.io' } },
};
```

Two Arc-specific workarounds are mandatory and already baked into the frontend:

- **`eth_signTransaction` + own-RPC broadcast.** `eth_sendTransaction` returns 401 on Arc. The app signs locally and broadcasts the raw transaction itself via `eth_sendRawTransaction` to `https://rpc.mainnet.arc.io`. Do not use `eth_sendTransaction` anywhere.
- **EIP-712 snake_case `primary_type`.** Privy's typed-data signing expects `primary_type` (snake_case), not `primaryType`. The terms-signing and attestation flows use the snake_case field.

Two chain facts the app assumes: Memo-wrapped transactions always use a **manual gas limit** (Memo reverts under `eth_call`/gas estimation); and **EIP-2612 `permit` is not supported on Arc USDC** — approvals go through `approve`, never `permit`.

---

## Environment variables

Public defaults live in the `.env.example` files. Copy them to `.env` for local overrides; **never commit a real `.env`, and never put private keys or API secrets in any committed file**.

- [`backend/.env.example`](backend/.env.example) — `RPC_URL`, `PORT`, `FRONTEND_URL` (CORS), `ESCROW_ADDRESS`, `ESCROW_DEPLOY_BLOCK`, `WEBHOOK_URL`, `CIRCLE_BLOCKCHAIN`; optional `CIRCLE_API_KEY`, `CIRCLE_WEBHOOK_SECRET`, `CIRCLE_ENTITY_SECRET` (real-time monitors; empty = `eth_getLogs` path only). All defaults are public values.
- [`frontend/.env.example`](frontend/.env.example) — `VITE_PRIVY_APP_ID` (public app ID), `VITE_API_URL` (backend base URL). Everything in this file is public by design.

Secrets in production are provisioned through the platform secret store (Render env / Vercel env) — never through files.

---

## Tests

Counts below are the committed suites in this repo. If a number doesn't match, the suite changed — check it, don't trust this line.

| Suite | Command | Result |
|---|---|---|
| Contracts (Foundry) | `cd contracts && forge test` | **40/40** |
| Backend | `cd backend && npm test` | **52/52** |
| Frontend | `cd frontend && npm test` | **54/54** |

What the suites prove, and what they don't: unit coverage of the state machine (double-open reverts, seller-only attest, buyer-only flag inside the window, permissionless capture/void), the indexer receipt builder against recorded mainnet logs, and the dashboard capability gates (a button only enables when role + state + chain time allow). **Test counts are for the repo suites.** Mainnet execution evidence — real signed transactions with real USDC dust — lives in the build bible (§6) and is referenced by tx hash, never reprinted as proof here. The T0-O oracle tier has a Forge test matrix specified but **no tests running against a live deployment, because it isn't deployed**.

---

## What you have to trust

This section is on the front page on purpose. Read it before using the product.

1. **The chain is the source of truth; the indexer is a cache.** The API serves receipts rebuilt from contract events. It can be wrong, stale, or down — every receipt is re-derivable from chain logs + Memo anchors, and the `/verify` screen recomputes the receipt hash client-side against the on-chain anchor. If the API and the chain disagree, the chain wins.
2. **No backend custody.** The backend never holds funds, keys, or signing authority. USDC lives in the escrow contract; transactions are signed by the user's wallet. There is nothing to withdraw from us.
3. **Seller attestation is a claim, not proof.** `attestDelivery` records that the seller *says* specific bytes were delivered (committed by SHA-256). What makes the system work is the 300-second challenge window plus the permanent, anchored record — the buyer verifies the bytes match the claim before the window closes, and a false claim becomes public, permanent evidence.
4. **Delivery quality can't be hashed.** If the bytes match the claim but the work is subjectively bad, no cryptography settles that — the terms you signed are the contract, and you should write them precisely.
5. **You must watch the challenge window.** If the buyer doesn't inspect the delivery and flag garbage within 300 seconds, the seller can be paid. In ORACLE_ONLY mode (T0-O, specified, not yet live), an oracle proof plus a short post-proof window replaces seller attestation — the oracle attests an *event*, not correctness, and the window exists for the semantic gap.
6. **Specified ≠ proven.** T0-O third-party oracle attestation and the trust-stack deltas (`disputesBySeller`, policy/funding refs) are fully specified and kill-gate-corrected — they are not deployed and not claimed as live. Anything on this page that is specified rather than proven says so in plain words.
7. **The Memo contract is infrastructure we use, not code we control.** Every transition is anchored through `0x5294E9…e505`. If that contract were ever upgraded or behaved differently, receipt anchoring would be affected — the escrow logic itself would not be, because the escrow functions stand alone without the wrapper.

---

## Links

- **Arc explorer:** https://explorer.arc.io
- **Production escrow:** https://explorer.arc.io/address/0x97f233865ae84DC7475F6D7CA404930654580CB5
- **Deploy transaction:** https://explorer.arc.io/tx/0xebd2e3fbbf805ba36fe0c1173f655b10aa769fd6809ccdfec5e61cef5213aa51
- **Sourcify verification (exact_match):** https://repo.sourcify.dev/contracts/chain/5042/address/0x97f233865ae84DC7475F6D7CA404930654580CB5
- **Memo contract:** https://explorer.arc.io/address/0x5294E9927c3306DcBaDb03fe70b92e01cCede505
- **USDC:** https://explorer.arc.io/address/0x3600000000000000000000000000000000000000
- **Repo:** https://github.com/mohamedwael201193/RAINCHECK-
- **Build bible (full spec + test-evidence ledger):** `../your_files/raincheck-build-bible.md`
