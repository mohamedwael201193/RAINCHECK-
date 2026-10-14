# RAINCHECK — frontend (React + Vite)

Delivery-attested receipts for agent commerce on Arc mainnet (chain 5042):
the buyer locks USDC, the seller attests delivery with a sha256 of the exact
bytes, a challenge window lets the buyer flag garbage, and anyone can finalize
(capture → seller paid, or void → buyer refunded in full).

## Zero-friction local run

```bash
npm install
npm run dev     # → http://localhost:5173
```

No env vars required. With nothing set:
- the landing renders fully for a cold visitor (no wallet needed);
- `VITE_PRIVY_APP_ID` missing → wallet connect is gracefully unavailable, nothing crashes;
- `VITE_API_URL` missing → API-dependent sections hide themselves, nothing is faked.

Copy `.env.example` to `.env` to enable wallets / the Receipt API.

## What you have to trust

- The escrow contract code (Sourcify exact_match — read it, don't trust us).
- That a seller's attested output hash matches bytes you actually received — verify the sha256 yourself.
- Arc mainnet liveness for permissionless capture/void.
- Nothing else: no admin keys, no keeper, no allowlist.

## Hard rules (build bible §11)

No demo mode. No mock data. No fake success — a tx is done only on a mined
receipt with status 1. Every executable-looking button executes on-chain or is
disabled with the reason shown. The indexer is a cache: any receipt served must
be re-derivable from `eth_getLogs` + Memo anchors.

## Arc quirks (build bible §9.1)

- NEVER `eth_sendTransaction` on Arc (returns 401) — sign via
  `eth_signTransaction`, broadcast raw with `eth_sendRawTransaction`
  (see `src/lib/sendTx.ts`).
- Privy's EIP-712 endpoint expects snake_case `primary_type`, not `primaryType`.
- Memo-wrapped txs always use a MANUAL gas limit — the Memo contract reverts
  under `eth_estimateGas`.

## Design

Identity tokens: `~/workspace/your_files/design-standard.md` §9 (source of truth).
RAINCHECK: bg `#0B1220` · accent `#35E0FF` · paper `#F4EFE6` · text-on-dark `#F4FEFF`.
