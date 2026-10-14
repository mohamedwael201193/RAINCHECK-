# RAINCHECK — PROOFS.md

**Judges' verification file.** Every hash below is copied character-for-character from the evidence JSONs in `evidence/` (qa2-e2e-results.json, qa2-failure-results.json, e2e-eurc.json, lifi-swap.json, e2e-v2/txlog.jsonl) or from `contracts/deployments/arc-5042.json`. Build history (not proof) lives in HISTORY.md. Chain: Arc mainnet, chainId 5042, RPC https://rpc.mainnet.arc.io.

## 1. Contract deployments

| Instance | Address | Deploy tx | Block | Sourcify |
|---|---|---|---|---|
| V1 USDC (production) | `0x97f233865ae84DC7475F6D7CA404930654580CB5` | [`0xebd2e3fbbf805ba36fe0c1173f655b10aa769fd6809ccdfec5e61cef5213aa51`](https://explorer.arc.io/tx/0xebd2e3fbbf805ba36fe0c1173f655b10aa769fd6809ccdfec5e61cef5213aa51) | 25956323 | [`exact_match`](https://sourcify.dev/server/v2/contract/5042/0x97f233865ae84DC7475F6D7CA404930654580CB5) |
| V1 EURC (production) | `0x3ceba2fbeb27162bfc4888f6b61e48bd359c1e0a` | [`0x34f7240f5c074fa082ad4e6b672d0fbd2542792459e5f09d51ee2ebc586a4094`](https://explorer.arc.io/tx/0x34f7240f5c074fa082ad4e6b672d0fbd2542792459e5f09d51ee2ebc586a4094) | 25962288 | [`exact_match`](https://sourcify.dev/server/v2/contract/5042/0x3ceba2fbeb27162bfc4888f6b61e48bd359c1e0a) |
| V2 (experimental) | `0x3795b865f7fc84a14ab60456be9fc6dd0cb56f0c` | [`0x046f1744296e87e006ce1a48318cad992ac3d4cd3a22b5302db26f0b3d7cdcae`](https://explorer.arc.io/tx/0x046f1744296e87e006ce1a48318cad992ac3d4cd3a22b5302db26f0b3d7cdcae) | 25962342 | [`exact_match`](https://sourcify.dev/server/v2/contract/5042/0x3795b865f7fc84a14ab60456be9fc6dd0cb56f0c) |
| OracleRegistry (T0-O ECDSA_PINNED) | `0x61412688aAF14F8A0e94C6665933E5DFA84e405A` | [`0x1879d4fd35ebbbc71c933cb6d13626ca60783335c520e44bcfb6a54e6a45d67d`](https://explorer.arc.io/tx/0x1879d4fd35ebbbc71c933cb6d13626ca60783335c520e44bcfb6a54e6a45d67d) | 25995772 | [`exact_match`](https://sourcify.dev/server/v2/contract/5042/0x61412688aAF14F8A0e94C6665933E5DFA84e405A) |
| RaincheckEscrowFP (V1.1 freeze-proof, USDC) | `0x54F05A5214d99cA458d142bA9E2f0CB77c1B2470` | [`0x80295e4b498a9c46348bc4b55741a429e65bfb921d11b6517428a9ae50d0eb7c`](https://explorer.arc.io/tx/0x80295e4b498a9c46348bc4b55741a429e65bfb921d11b6517428a9ae50d0eb7c) | 25995933 | [`exact_match`](https://sourcify.dev/server/v2/contract/5042/0x54F05A5214d99cA458d142bA9E2f0CB77c1B2470) |
| RaincheckEscrowFP (V1.1 freeze-proof, test-token) | `0x10F2F2f10Fd9F6820BC83dE48EF0D6720A173F29` | [`0x1bbb6dc9cc226b023a9f64e2137688ac8e890e01ac836ad30e4cc199251db4b3`](https://explorer.arc.io/tx/0x1bbb6dc9cc226b023a9f64e2137688ac8e890e01ac836ad30e4cc199251db4b3) | 25995942 | [`exact_match`](https://sourcify.dev/server/v2/contract/5042/0x10F2F2f10Fd9F6820BC83dE48EF0D6720A173F29) |

On-chain checks passed (all six): `challengeWindow()` = 300 (0x12c) on all four escrow instances; constructor token matches the token listed for the instance; non-empty runtime code (7270 / 7270 / 8196 / 7658 / 7658 bytes; OracleRegistry 10359); OracleRegistry `owner()` = deployer, `ROTATION_TIMELOCK()` = 259200; deploy txs status 1. Test-only instrument: PausableTestToken `0x5A1166eC096e12C0C6187695F82B7F4b285389Df` ([deploy tx](https://explorer.arc.io/tx/0xf20a03534c75413a66e708030d20a8574811be99aee5d01ecb3896cf2049945c), Sourcify exact_match) — no economic value, exists only to prove the FP freeze path.

Reference tokens: USDC `0x3600000000000000000000000000000000000000`; EURC `0xbEf5f6d51CB62b58e6A8f77868681825C6fe21c1` (correct EIP-55 checksum — the founder's stated form had a bad checksum on identical 20 bytes); Memo `0x5294E9927c3306DcBaDb03fe70b92e01cCede505` (existing infra, reused for receipt anchoring).

## 2. Foundry tests

**60/60 pass** (`contracts/test/`): 14 lifecycle + 13 edge/fuzz + 11 V2-delta + 13 oracle (T0-O ECDSA_PINNED: happy path, wrong-key, revoked-issuer, 3-day rotation timelock, OIDC "not live", registration guards) + 9 freeze-proof (frozen capture/void/voidAfterDeadline → PaymentHeld + owed[]; withdraw after unpause; re-hold while frozen; happy path unchanged). No separate coverage artifact recorded.

### 2.1 T0-O oracle proofs (OracleRegistry `0x61412688aAF14F8A0e94C6665933E5DFA84e405A`)

Attestation store only — never holds funds. Digest: `keccak256("raincheck:5042:oracle:" ‖ paymentId ‖ outputHash)` signed RAW (no EIP-191 prefix).

| Tx | Action | What it proves |
|---|---|---|
| [`0x5bb3679dbfa7eb3bd493ddb10a7ae34adf952a3da297796affe63896297868ec`](https://explorer.arc.io/tx/0x5bb3679dbfa7eb3bd493ddb10a7ae34adf952a3da297796affe63896297868ec) | registerIssuer(ECDSA_PINNED, throwaway key `0x4003640Ba9D36593E054Ff395d72E707db72d39f`) | owner pins an ECDSA oracle key; `IssuerRegistered` emitted |
| [`0xee30d2ab4a9c12c0be462b2d0ca0e8d57af2775149825fd9a7577cdbb4339b2d`](https://explorer.arc.io/tx/0xee30d2ab4a9c12c0be462b2d0ca0e8d57af2775149825fd9a7577cdbb4339b2d) | attestWithOracle with a REAL signature from the pinned key | ecrecover matches pinned key; attestation stored on-chain: `attestations(0xef68…eb90)` = issuer `0x3e05…f501`, outputHash `0x1234…45aa`, attestedAt 1792018279; `OracleAttested` emitted |
| [`0xc486f85cd3f1d319545b854b042b1f09169787986d56ecdf8a57be6e9d5fd54d`](https://explorer.arc.io/tx/0xc486f85cd3f1d319545b854b042b1f09169787986d56ecdf8a57be6e9d5fd54d) | revokeKey | immediate revocation; on-chain `issuers(0x3e05…f501)` = kind 2 (ECDSA_PINNED), oracleKey 0x0, revoked true |

issuerId = `keccak256("ecdsa:raincheck-win-oracle")` = `0x3e050d60215ad9b943c99e7ff0fd99e1aeb8e57694be334fd44117c3564ef501`.

### 2.2 Freeze-proof proofs (RaincheckEscrowFP V1.1)

V1.1 = V1 with exactly two deltas: all payouts route through `_sendOrHold` (failed transfer → `owed[]` credit + `PaymentHeld`, never reverts the state transition) and a permissionless `withdraw()` with re-hold. State machine, 300s window, events otherwise identical to V1.

**Happy path — FP-USDC `0x54F05A5214d99cA458d142bA9E2f0CB77c1B2470`** (proves V1.1 does not change the unfrozen path):

| Tx | Action | What it proves |
|---|---|---|
| [`0x7190a92549ae7e1b2220278b06cadecd9b66a29af20cf26cc43fff9ddc92e618`](https://explorer.arc.io/tx/0x7190a92549ae7e1b2220278b06cadecd9b66a29af20cf26cc43fff9ddc92e618) | approve 0.01 USDC | allowance for the FP instance |
| [`0x30ae5eabe53f3a2204295a060499db4fc557f30258630d8f03d94d9b9c2368cd`](https://explorer.arc.io/tx/0x30ae5eabe53f3a2204295a060499db4fc557f30258630d8f03d94d9b9c2368cd) | happy authorize 0.01 USDC | receipt → OPEN; FP pulls principal via transferFrom |
| [`0xcb86c33cac2d534e395e7194e86aa64b4bc1cfd3ea78ee81b643fd6a400320b4`](https://explorer.arc.io/tx/0xcb86c33cac2d534e395e7194e86aa64b4bc1cfd3ea78ee81b643fd6a400320b4) | happy attest | receipt → ATTESTED |
| [`0xcfcbf20368e1e9ae2ea66363c57e3c4476a87be73a241f18897ad73d67735cd5`](https://explorer.arc.io/tx/0xcfcbf20368e1e9ae2ea66363c57e3c4476a87be73a241f18897ad73d67735cd5) | happy capture (post-300s window) | Transfer event = exactly 0.01 USDC (10000 base units) FP → seller; `owed(seller)` = 0 — direct payout, happy path byte-behavior unchanged from V1 |

**Freeze path — FP-testtoken `0x10F2F2f10Fd9F6820BC83dE48EF0D6720A173F29` + PausableTestToken `0x5A1166eC096e12C0C6187695F82B7F4b285389Df`:**

| Tx | Action | What it proves |
|---|---|---|
| [`0x4096f79b40bf23990a1e1911ef08f020f9a2fe8e2cc18e347300caf2ddc1bc02`](https://explorer.arc.io/tx/0x4096f79b40bf23990a1e1911ef08f020f9a2fe8e2cc18e347300caf2ddc1bc02) | approve 0.01 PTT | allowance for the FP instance |
| [`0x82f5ce00f2a5e1222eb42f21d839f682103b6377e63d86531fe252b105786190`](https://explorer.arc.io/tx/0x82f5ce00f2a5e1222eb42f21d839f682103b6377e63d86531fe252b105786190) | authorize 0.01 PTT | receipt → OPEN |
| [`0x4054fa45b3f2a344de1bc026c363a2d55654203d827af590ea52bdb618107790`](https://explorer.arc.io/tx/0x4054fa45b3f2a344de1bc026c363a2d55654203d827af590ea52bdb618107790) | attestDelivery | receipt → ATTESTED |
| [`0x3819a599ddf0ae46c36df8cf9b83a900c3c11797ea37aab48dfe89f68732229a`](https://explorer.arc.io/tx/0x3819a599ddf0ae46c36df8cf9b83a900c3c11797ea37aab48dfe89f68732229a) | flagNonDelivery | receipt → FLAGGED |
| [`0x3eeaa4ed23da7f27aff7d8044e42b5f6a0d19aabd456c9432afa6bb99d1c8f63`](https://explorer.arc.io/tx/0x3eeaa4ed23da7f27aff7d8044e42b5f6a0d19aabd456c9432afa6bb99d1c8f63) | pause token | freeze induced (simulates a frozen/blacklisted token) |
| [`0xe9b65a42f7cc8cd58f75c6c72fc016c3eeedf38a956eeb95b29aebb7495ce2ab`](https://explorer.arc.io/tx/0xe9b65a42f7cc8cd58f75c6c72fc016c3eeedf38a956eeb95b29aebb7495ce2ab) | **void while frozen** | **status 1 — does NOT revert**; `PaymentHeld(pid, buyer, 10000)` + `RaincheckVoided` emitted; `owed(buyer)` = 10000 verified on-chain (on V1 this bricks the receipt) |
| [`0xa49b888f26ae20ea3127c2deb2ce466ac99a5d8521788bc5d19ea0c7c0387cc6`](https://explorer.arc.io/tx/0xa49b888f26ae20ea3127c2deb2ce466ac99a5d8521788bc5d19ea0c7c0387cc6) | unpause token | freeze lifted |
| [`0xda6748623e86753daccdbf1315ad01f76d7a260acc6f45167598bed68232a72c`](https://explorer.arc.io/tx/0xda6748623e86753daccdbf1315ad01f76d7a260acc6f45167598bed68232a72c) | withdraw() (permissionless) | `owed(buyer)` 10000 → 0; buyer PTT balance 999999990000 → 1000000000000 (+10000) — **full recovery, nothing trapped** |

**Honest caveat:** the freeze path was executed on mainnet against a pausable TEST token (`0x5A1166eC096e12C0C6187695F82B7F4b285389Df`, no economic value); a real-USDC freeze cannot be induced on mainnet without Circle blacklisting an address. The failure mode exercised (token `transfer` reverts) is exactly what a frozen-USDC payout does at the EVM level — the contract cannot distinguish them.

### 2.3 External oracle trigger — end-to-end (WIN-order run, 2026-10-15)

One receipt whose delivery evidence comes from a **REAL EXTERNAL third-party oracle path** (a pinned-key courier signature verified on-chain by `ecrecover`), not from the seller's own attestation.

- Oracle: fresh throwaway courier keypair `0xDd406f432daAA903b94e3a801E5bb60e9E0F5525`, generated off-chain for this run and **shredded after use** (key held no funds; the courier only signs).
- issuerId = `keccak256("ecdsa:win-oracle-1")` = `0x22aad86fc46cbaec2361864edd19fa126bfa0f0a62e985acaacbc743efcdb128` (ECDSA_PINNED).
- paymentId = `keccak256("win-oracle-e2e-1")` = `0x25f4091febc4518191546cef160046b5c54ed6c4ad2eac230baccdad04438b58`, 0.01 USDC (10000 base units), FP-USDC `0x54F05A5214d99cA458d142bA9E2f0CB77c1B2470`.
- termsHash = `keccak256` of: *"Delivery of the RAINCHECK WIN-ORDER oracle run summary: a one-page audit note listing the on-chain tx hashes for registerIssuer, authorize, attestWithOracle, attestDelivery, and capture for this payment, delivered by the win-oracle-1 courier to the buyer."* = `0x4a0a29855f198f3f9c6967a0d3fafb0c8d7d48d7618a948d19b5689344872afa`.
- Delivery payload (the concrete artifact): JSON `{"paymentId":"0x25f4…38b58","artifact":"win-oracle-delivery-note.txt","noteSha256":"de1327b73ce1881a7dafb90d30561f5d9420e346f9c3c417968080b8237ca5c2","courier":"win-oracle-1","deliveredTo":"0xf76e6B0920e9332fF4410f6dD53F01722AbC71a3","deliveredAt":"<2026-10-15T~02:1xZ, sign time>"}`; outputHash = `keccak256(payload)` = `0x49c0eb8823ce4dd6993cbb3ad5aa331035710e4174f36ed011fd1ff3fee77ce0` (exact value verified on-chain; only the deliveredAt timestamp is approximate here).
- Oracle digest `0xa3a63f99213ba91c668488d758d7d856445ae0f57230e2180a4c2fe4c6c5d762` = `oracleDigest(paymentId, outputHash)`; signed **RAW** (no EIP-191 prefix) by the courier key, v=28 — the v value was chosen only after on-chain `verifyClaim` returned `ok=true` + `recovered == pinned key` (v=1 and v=27 were tried and rejected by the contract itself).

| Tx | Action | What it proves |
|---|---|---|
| [`0x54bc874c63871ef7f685e568f54c149e01efea43aa0fe5943cade2930ee0f809`](https://explorer.arc.io/tx/0x54bc874c63871ef7f685e568f54c149e01efea43aa0fe5943cade2930ee0f809) | registerIssuer(ECDSA_PINNED, courier key) | trust anchor for a third-party oracle pinned on-chain; `IssuerRegistered` emitted (block 25997339) |
| [`0xff5bd1e1d81d15f6334aa326f089d2a1bdf1dda13668dada11be9716344492b6`](https://explorer.arc.io/tx/0xff5bd1e1d81d15f6334aa326f089d2a1bdf1dda13668dada11be9716344492b6) | authorize 0.01 USDC | receipt OPEN on FP-USDC; `RaincheckOpened` + 10000-base-unit USDC transfer (block 25997356) |
| [`0x97d8ce20a2eb5c9275905dc80c3ba00b99e404a4c1a2c8471996b4e64f0a27fb`](https://explorer.arc.io/tx/0x97d8ce20a2eb5c9275905dc80c3ba00b99e404a4c1a2c8471996b4e64f0a27fb) | attestWithOracle (courier's real signature) | `ecrecover` matches the pinned courier key — a THIRD PARTY signed the delivery digest; `attestations(0x25f4…38b58)` = issuer `0x22aad8…128`, outputHash `0x49c0eb…77ce0`, attestedAt 1792019080 (block 25997461) |
| [`0xd50d08bb3cd4bd6648cb6b9b1a7a4a79e31b34a0e80312f2ed2a8e86dd0e8231`](https://explorer.arc.io/tx/0xd50d08bb3cd4bd6648cb6b9b1a7a4a79e31b34a0e80312f2ed2a8e86dd0e8231) | attestDelivery (seller path) | receipt → ATTESTED with the same outputHash (block 25997471) |
| [`0x5e2e277ba2dce8f7ff980b26440fa52ec9bca36df08cbf4fe93cdb51cffd1daa`](https://explorer.arc.io/tx/0x5e2e277ba2dce8f7ff980b26440fa52ec9bca36df08cbf4fe93cdb51cffd1daa) | capture (post-300s window) | receipt → CAPTURED; `receipts(paymentId).status == 3` verified on-chain (block 25998095) |

All five txs `status=1` on Arc mainnet 5042.

**Honest scoping:** the oracle attestation IS recorded on-chain in the standalone OracleRegistry (real third-party signature, real ecrecover check), and the receipt carries the same `outputHash` — but the escrow capture above went through the **normal seller path** (`attestDelivery` + `capture`), not through an oracle-gated escrow flow. The ORACLE_ONLY/ORACLE_PREFERRED wire-up (escrow accepts a receipt only when a registry attestation exists) remains **specified-not-live** — the registry contract itself documents this (see §2.1 and the contract header). The courier key was a single-use throwaway, shredded after the run, so no lingering trust anchor exists for it.

## 3. Dust transactions (Arc mainnet, dust amounts only)

All txs went through the Memo contract (`execute` wrapping) where noted; Memo anchoring verified per-tx via `target==escrow` + `callDataHash` match.

### 3.1 V1 USDC — `0x97f233865ae84DC7475F6D7CA404930654580CB5`

| Tx | Action | What it proves |
|---|---|---|
| [`0x0697041f9d71e2b80d78c308a634c49431ddc454dc1cb04326b7245cae152ac3`](https://explorer.arc.io/tx/0x0697041f9d71e2b80d78c308a634c49431ddc454dc1cb04326b7245cae152ac3) | happy authorize 0.01 USDC | receipt → OPEN; escrow pulls principal via transferFrom |
| [`0x0d2c0f7da5c6288c508e8af729f9454f145f0e7fb8c1ef070f266382e22c5f04`](https://explorer.arc.io/tx/0x0d2c0f7da5c6288c508e8af729f9454f145f0e7fb8c1ef070f266382e22c5f04) | happy attest | receipt → ATTESTED; 300s challenge window opens |
| [`0xd59f0d320acf596ef5a15a1109aae7ed70050d6e816b626f68ae25685d9b3b22`](https://explorer.arc.io/tx/0xd59f0d320acf596ef5a15a1109aae7ed70050d6e816b626f68ae25685d9b3b22) | happy capture | permissionless finalize post-window; receipt → CAPTURED; Transfer event = exactly 0.01 USDC (10000 base units) to seller |
| [`0x1837d7cb39959fe7517b5432dc2991cb70c537ea7a32f14a596973724775c7ad`](https://explorer.arc.io/tx/0x1837d7cb39959fe7517b5432dc2991cb70c537ea7a32f14a596973724775c7ad) | void authorize | receipt B → OPEN (evidence-authoritative; brief draft listed `…245cae152ac3` — the evidence JSON governs) |
| [`0x05855d92db957d892288ee743aeb47d4fc70478fbdb7cd5931604247a8715c22`](https://explorer.arc.io/tx/0x05855d92db957d892288ee743aeb47d4fc70478fbdb7cd5931604247a8715c22) | void flag | buyer disputes inside window; receipt → FLAGGED |
| [`0x1223f1a53aa3424c2ccd4dc207f1b85a2c5fef86edabbabec436b3d8468b8324`](https://explorer.arc.io/tx/0x1223f1a53aa3424c2ccd4dc207f1b85a2c5fef86edabbabec436b3d8468b8324) | void | receipt → VOIDED; Transfer event = exactly 0.01 USDC refund to buyer |
| [`0x98f696c9af23a4aeb6036ff83ffa5dfb680b5e53a16097cd7f95b93d360cbe34`](https://explorer.arc.io/tx/0x98f696c9af23a4aeb6036ff83ffa5dfb680b5e53a16097cd7f95b93d360cbe34) | failure capture (**REVERTED**, status 0) | capture on never-attested receipt reverts `not ATTESTED`; funds stay locked (still OPEN) |

### 3.2 V1 EURC — `0x3ceba2fbeb27162bfc4888f6b61e48bd359c1e0a`

| Tx | Action | What it proves |
|---|---|---|
| [`0x068c97c13f9e3aeda3516fccaa09ab1ccc816e684d130d927f0ec17fe820ffe0`](https://explorer.arc.io/tx/0x068c97c13f9e3aeda3516fccaa09ab1ccc816e684d130d927f0ec17fe820ffe0) | happy authorize 0.01 EURC | receipt → OPEN on the EURC instance (multi-asset live) |
| [`0x32adffa8925aed921878bec6728b6faacb16d97d5ed4c9d3b0b677e6b5ba2e99`](https://explorer.arc.io/tx/0x32adffa8925aed921878bec6728b6faacb16d97d5ed4c9d3b0b677e6b5ba2e99) | happy attest | receipt → ATTESTED |
| [`0x9818c1396b95ea60cbbc9e18ba138018133120fcdbc99ce477156eaa77ca323a`](https://explorer.arc.io/tx/0x9818c1396b95ea60cbbc9e18ba138018133120fcdbc99ce477156eaa77ca323a) | happy capture | 0.01 EURC paid to seller; receipt → CAPTURED |
| [`0x143267ec5aa5e4d7dc03c5534f94259ca62be6ff434438113b91e53bfeb61808`](https://explorer.arc.io/tx/0x143267ec5aa5e4d7dc03c5534f94259ca62be6ff434438113b91e53bfeb61808) | void flag | receipt → FLAGGED |
| [`0x65130f8b1b3ee19f1820c2464dcb850c91914a66cc22d68aabd760b777f04464`](https://explorer.arc.io/tx/0x65130f8b1b3ee19f1820c2464dcb850c91914a66cc22d68aabd760b777f04464) | void | full 0.01 EURC refund; receipt → VOIDED |
| [`0x35713984327c26d5149f5129c924c96879563ef302836374ccf9b7e10cb1096e`](https://explorer.arc.io/tx/0x35713984327c26d5149f5129c924c96879563ef302836374ccf9b7e10cb1096e) | failure capture (**REVERTED**, status 0) | same guard on EURC: `not ATTESTED`; receipt still OPEN (reason decoded via `eth_call` replay — `debug_traceTransaction` unsupported on this RPC, code -32601) |

EURC suite net principal ≈ 0 (deployer is buyer+sellers; all dust refunded/voided; failure-path dust recovered via attest→flag→void, `0x65de00044f86e946b034fd006c8ab127ec3b865e11df812a4d4cddd9ba072d6c`).

### 3.3 V2 — `0x3795b865f7fc84a14ab60456be9fc6dd0cb56f0c` (experimental, dust only)

| Tx | Action | What it proves |
|---|---|---|
| [`0x3ee922ba26fe51531f4fafd1c62660d6d1d48296262b8fdebd9ffa0a1f1c77cf`](https://explorer.arc.io/tx/0x3ee922ba26fe51531f4fafd1c62660d6d1d48296262b8fdebd9ffa0a1f1c77cf) | 7-param authorize | V2 delta live: `policyRef` stored on-chain |
| [`0x05a82f10edb131813bc22e11e313452ae5963c3f30272d1a284321c9318b686e`](https://explorer.arc.io/tx/0x05a82f10edb131813bc22e11e313452ae5963c3f30272d1a284321c9318b686e) | happy capture | full V2 lifecycle executes on mainnet |
| [`0xe1784b3b7236b24c23e512a574a24283054c10bd934ab750346f639d913e4f3c`](https://explorer.arc.io/tx/0xe1784b3b7236b24c23e512a574a24283054c10bd934ab750346f639d913e4f3c) | void | V2 delta live: `disputes=1` recorded |
| [`0x6dd430cbc9e74c915cde1f48172dc200bac24f30afd4834616e2575ccc1b0214`](https://explorer.arc.io/tx/0x6dd430cbc9e74c915cde1f48172dc200bac24f30afd4834616e2575ccc1b0214) | failure capture (**REVERTED**, status 0) | V2 guard parity with V1 |
| [`0x25bd823ec538671916b0d355ce27f2f07f1807f3213cdcfc20d2d27a846c7aab`](https://explorer.arc.io/tx/0x25bd823ec538671916b0d355ce27f2f07f1807f3213cdcfc20d2d27a846c7aab) | voidAfterDeadline | dead-man's recovery: dust refunded when seller never attests |

### 3.4 LI.FI USDC→EURC swap (live route on Arc 5042)

| Tx | Action | What it proves |
|---|---|---|
| [`0xd503f54ace28b6d25cd535a50932283ca401105b2eb8151b10da0e7558d419a9`](https://explorer.arc.io/tx/0xd503f54ace28b6d25cd535a50932283ca401105b2eb8151b10da0e7558d419a9) | approve | allowance for LI.FI executor |
| [`0x69872320406f3547a980564d5930b4b0cf727f8685557390f381a456d4e34e60`](https://explorer.arc.io/tx/0x69872320406f3547a980564d5930b4b0cf727f8685557390f381a456d4e34e60) | swap (block 25970407) | **0.5 USDC → ~0.448 EURC** executed via Kyberswap through a LI.FI quote (`23b53072-0257-4d24-97c7-7549416006f2:0`); EURC balance went 0.013815 → 0.462129 |

### 3.5 Prior art (build bible §6, R9 wave — still live)

60s-challengeWindow experiment instance `0x41099436c5f18eA916B9ca3B835fdc4B5c758Deb` proved the deliver half; second instance `0x44357E99755705376627542509d8D2eabF02562F` proved the void half. Superseded by the production 300s instances in §1; retained as evidence only.

## 4. Off-chain suites

- **Backend:** 57/57 pass (vitest-style node:test suite; receipt + webhook-verify tests).
- **Frontend:** 78/78 pass (lib/utils + component tests).

## 5. HONESTY — PROVEN vs SPECIFIED-NOT-LIVE

**PROVEN (on-chain or green tests, evidence above):**
- Full escrow lifecycle in USDC **and** EURC on Arc mainnet: authorize → attest → capture (seller paid), and flag → void (buyer refunded), at dust amounts.
- Pre-attestation capture **reverts** on both token instances (status 0, `not ATTESTED`, funds stay locked).
- V2 deltas execute on mainnet: 7-param authorize with `policyRef` stored, `disputes=1` on void, `voidAfterDeadline` recovery.
- LI.FI USDC→EURC swaps route live on Arc 5042 (Kyberswap executor).
- Memo receipt anchoring (`BeforeMemo` → inner → `Memo`, `callDataHash` bound per transition).
- Sourcify `exact_match` (creation + runtime) on all six instances, chain 5042.
- **T0-O ECDSA_PINNED oracle tier is LIVE** (OracleRegistry `0x61412688aAF14F8A0e94C6665933E5DFA84e405A`, Sourcify exact_match): issuer registered on-chain, real pinned-key signature attested on-chain (tx `0xee30d2ab…4339b2d`), issuer revoked on-chain (tx `0xc486f85c…5fd54d`). 13/13 forge tests green (happy path, wrong-key revert, revoked-issuer revert, 3-day rotation timelock, OIDC "not live" revert, registration guards). Attestation store only — never holds funds; escrow wire-up (ORACLE_ONLY/ORACLE_PREFERRED capture gates) still specified-not-live.
- **V1.1 freeze-proof escrow is LIVE** (RaincheckEscrowFP, Sourcify exact_match on both instances): happy path on real USDC unchanged (0.01 USDC capture → seller, `owed`=0); freeze path proven on mainnet — token paused → `void` status 1 (no revert), `PaymentHeld` emitted, `owed(buyer)`=10000, unpause → permissionless `withdraw()` → full +10000 recovery. Honest caveat: the freeze was induced on a pausable TEST token (real-USDC freeze needs Circle blacklisting); the exercised failure mode (transfer revert) is EVM-identical. 9/9 forge tests green (frozen capture/void/voidAfterDeadline hold; re-hold while frozen; happy path unchanged).

**SPECIFIED — NOT YET LIVE:**
- **T0-O OIDC_RS256 tier:** registration is allowed on OracleRegistry (kind recorded honestly) but every verification path reverts "OIDC not live" — RS256 verification never deployed, no mainnet txs.
- **Oracle→escrow wire-up:** `OraclePolicy` modes (ORACLE_ONLY/ORACLE_PREFERRED) and `attestWithOracle` capture gates are bible §4.5 spec — no escrow contract consumes oracle attestations yet.
- **V2 in the production app:** contract proven on mainnet but experimental — unwired in the UI, not audited, explicitly "do NOT integrate."
- **In-app CCTP execution:** guide only — contract-initiated CCTP burns are chain-gated on Arc (proven with minimal test contracts); direct EOA burns work.
- **Circle Onramp Kit:** mentioned as a fiat fallback only — no integration executed.
- **Third-party volume:** zero. All proofs are first-party dust; no real buyer/seller has used the product.

**Quirks (documented, not hidden):**
- Revert reasons surface in the `eth_call` message text, not as clean return data.
- Memo-wrapped calls can't be `eth_call`-previewed; revert reasons need direct-call replay.
- EURC checksum correction (§1): same 20 bytes, only the case encoding was fixed.

**Bottom line:** everything on this page either has a tx hash and an explorer link, or is labeled specified-not-live. No volume, no third parties, no unaudited code in the app — that is the current, complete state.
