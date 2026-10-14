# E2E-V2 — RaincheckEscrowV2 mainnet dust-test proofs

**V2 experimental escrow:** `0x3795b865f7fc84a14ab60456be9fc6dd0cb56f0c` (challengeWindow=300s, Sourcify exact_match, deploy block 25962342)
**Status: EXPERIMENTAL — dust-tested on Arc mainnet (chain 5042), NOT audited, NOT app-wired.**
**Date:** 2026-10-14 ~21:10–21:35 EEST. **Operator key:** deployer `0xf76e6B0920e9332fF4410f6dD53F01722AbC71a3` (buyer = seller in all tests).
**Token:** USDC `0x3600000000000000000000000000000000000000` (6-dec face). **Memo:** `0x5294E9927c3306DcBaDb03fe70b92e01cCede505`.
All state transitions Memo-wrapped per build-bible §4.2 (`memo(address,bytes,bytes32,bytes)`, selector `0xc3b2c4f8`).
Manual gas limits, never eth_estimateGas: approve 120k / authorize 300k / attest 150k / capture-void-flag 120k.
Principal per test: 0.01 USDC (10,000 base). policyRef = keccak256("e2e-policy") = `0x784cf8d53fa6995b707cd374a7167c44643685c5fc763de549541dabfc5003c0`; fundingRef = bytes32(0).

## V2 deltas proven live
| Delta | Proof |
|---|---|
| 7-param `authorize(bytes32,bytes32,address,uint256,uint256,bytes32,bytes32)` (selector `0x42a945f7`, verified vs compiled ABI) | 3 authorizes, all status=1; `receipts()` shows stored policyRef |
| `getPayment(bytes32)` view (selector `0xe66eefc8`) | returns (status, seller, amount, termsHash); used for every state assertion |
| `disputes(address)` counter (selector `0xb0103b1a`) | =1 after T2 void; unchanged by T3 voidAfterDeadline (liveness ≠ dishonesty) |

**Deviation note:** the task brief described the 7-param overload as `(paymentId, buyer, seller, amount, deadline, policyRef, fundingRef)` and asked to verify `getPayment` returns the policyRef. The contract (authority) is `authorize(paymentId, termsHash, seller, amount, deadline, policyRef, fundingRef)` — buyer is `msg.sender` — and `getPayment` returns `(status, seller, amount, termsHash)` only. policyRef storage was verified via the public `receipts(bytes32)` getter instead.

## Test 1 — happy path (OPEN → ATTESTED → CAPTURED)
paymentId `0x243cddad5b75bfb35ec1ac59fab848fa4fcab9f30a9678958381e9670abcc2ab`
- approve 0.01 USDC → https://explorer.arc.io/tx/0xc07fd222c6538d3d648bc4d2441d909305e0b575ead2a8377ad95aeef11c69ac (block 25963058, status 1)
- **7-param authorize** → https://explorer.arc.io/tx/0x3ee922ba26fe51531f4fafd1c62660d6d1d48296262b8fdebd9ffa0a1f1c77cf (block 25963069, status 1). `getPayment` = OPEN, seller/amount/termsHash correct; `receipts()` policyRef matches keccak256("e2e-policy"), fundingRef = 0.
- attestDelivery → https://explorer.arc.io/tx/0xaa8479677c2c3be63a812437bf3d0c28ce5cd4648a711caba4091de01f420247 (block 25963127, status 1). State → ATTESTED (attestedAt 1792001685).
- waited 305s (challenge window 300s) → capture → https://explorer.arc.io/tx/0x05a82f10edb131813bc22e11e313452ae5963c3f30272d1a284321c9318b686e (block 25963733, status 1). State → CAPTURED; 10,000 base paid to seller.

## Test 2 — void path (OPEN → ATTESTED → FLAGGED → VOIDED)
paymentId `0x429a46e386773d590bae71aca8754ba5836d3bc117ac3cc538779d39dae33f74`
- approve → https://explorer.arc.io/tx/0x90730f4c5ef1196b979cbf16d1dd583ab19f7bfc91c8e156711ceb3633f670f2 (25963169)
- **7-param authorize** → https://explorer.arc.io/tx/0x1acea0032cc2b4c8f43a101dedfbb1ba11bb3765363716fb86d8c6bf2d388a64 (25963178)
- attestDelivery → https://explorer.arc.io/tx/0x9feadb35300068db6ff5fc4cc829225fa6a670c1826f4f56685848094b196d27 (25963189)
- flagNonDelivery → https://explorer.arc.io/tx/0x2e2c6889bf49021824df1afb9fe11386222c8fb92b8b2f830092e47bf8a8e3ba (25963199) — state FLAGGED
- void → https://explorer.arc.io/tx/0xe1784b3b7236b24c23e512a574a24283054c10bd934ab750346f639d913e4f3c (25963211) — state VOIDED, 10,000 base refunded to buyer (balance delta = −gas exactly), `disputes(seller)` = 1.

## Test 3 — failure path (capture before attestation reverts)
paymentId `0x7a47b40ddcec224068600c0636aea5338b8962bd2fcb938bfc8baa13dd65aafb`
- approve → https://explorer.arc.io/tx/0x95c8f5dad10aeca77d710557cfb442a510c8ec4da440d7d50626a05b12651b64 (25963255)
- **7-param authorize** → https://explorer.arc.io/tx/0x9ab0faf414da499407bae621f1efa3daecb3e6f6dbec3fcf83c3d0ba33160c79 (25963265) — state OPEN, never attested
- **capture (intentional failure)** → https://explorer.arc.io/tx/0x6dd430cbc9e74c915cde1f48172dc200bac24f30afd4834616e2575ccc1b0214 (25963275, **status 0**). Revert reason decoded via `eth_call` replay at the parent block: `execution reverted: not ATTESTED` (`0x08c379a0…` + "not ATTESTED") — the exact require string in the verified source. State unchanged (still OPEN). `debug_traceTransaction` is not supported by the public RPC.
- Bonus recovery: after the 900s deadline, `voidAfterDeadline` → https://explorer.arc.io/tx/0x25bd823ec538671916b0d355ce27f2f07f1807f3213cdcfc20d2d27a846c7aab (25965031, status 1) — state VOIDED, 10,000 base refunded, `disputes(seller)` still 1 (liveness ≠ dishonesty, per spec).

## Totals
13 broadcasts (12 ok + 1 intentional revert). Total gas 1,601,382; total fees **0.033629 USDC**. Principal: 0.03 USDC cycled, **zero lost** — V2 escrow final USDC balance = 0. One retry max was never needed (no transient RPC failures on broadcasts).

## Tooling notes (for future runs)
- `rpc.mainnet.arc.io` 403s Python urllib without a browser User-Agent; `requests` + browser UA works. EIP-1559 active (~20 gwei base + 1 gwei priority at test time).
- No cast/forge/eth_keys on this machine; signing done with a self-contained Python module (pycryptodome keccak + pure-Python secp256k1 RFC6979). Address-derivation gotcha: Ethereum address = keccak(x‖y)[-20:], no 0x04 prefix.
- Key read only from `~/workspace/user/files/env-3.txt`, derived address asserted before every stage; scripts: `evidence/e2e-v2/e2e_v2.py` + `stage*.py`, tx log `txlog.jsonl`.
