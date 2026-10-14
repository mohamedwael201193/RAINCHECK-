# RAINCHECK — PROOFS.md

**Judges' verification file.** Every hash below is copied character-for-character from the evidence JSONs in `evidence/` (qa2-e2e-results.json, qa2-failure-results.json, e2e-eurc.json, lifi-swap.json, e2e-v2/txlog.jsonl) or from `contracts/deployments/arc-5042.json`. Build history (not proof) lives in HISTORY.md. Chain: Arc mainnet, chainId 5042, RPC https://rpc.mainnet.arc.io.

## 1. Contract deployments

| Instance | Address | Deploy tx | Block | Sourcify |
|---|---|---|---|---|
| V1 USDC (production) | `0x97f233865ae84DC7475F6D7CA404930654580CB5` | [`0xebd2e3fbbf805ba36fe0c1173f655b10aa769fd6809ccdfec5e61cef5213aa51`](https://explorer.arc.io/tx/0xebd2e3fbbf805ba36fe0c1173f655b10aa769fd6809ccdfec5e61cef5213aa51) | 25956323 | [`exact_match`](https://sourcify.dev/server/v2/contract/5042/0x97f233865ae84DC7475F6D7CA404930654580CB5) |
| V1 EURC (production) | `0x3ceba2fbeb27162bfc4888f6b61e48bd359c1e0a` | [`0x34f7240f5c074fa082ad4e6b672d0fbd2542792459e5f09d51ee2ebc586a4094`](https://explorer.arc.io/tx/0x34f7240f5c074fa082ad4e6b672d0fbd2542792459e5f09d51ee2ebc586a4094) | 25962288 | [`exact_match`](https://sourcify.dev/server/v2/contract/5042/0x3ceba2fbeb27162bfc4888f6b61e48bd359c1e0a) |
| V2 (experimental) | `0x3795b865f7fc84a14ab60456be9fc6dd0cb56f0c` | [`0x046f1744296e87e006ce1a48318cad992ac3d4cd3a22b5302db26f0b3d7cdcae`](https://explorer.arc.io/tx/0x046f1744296e87e006ce1a48318cad992ac3d4cd3a22b5302db26f0b3d7cdcae) | 25962342 | [`exact_match`](https://sourcify.dev/server/v2/contract/5042/0x3795b865f7fc84a14ab60456be9fc6dd0cb56f0c) |

On-chain checks passed (all three): `challengeWindow()` = 300 (0x12c); constructor token matches the token listed for the instance; non-empty runtime code (7270 / 7270 / 8196 bytes); deploy tx status 1.

Reference tokens: USDC `0x3600000000000000000000000000000000000000`; EURC `0xbEf5f6d51CB62b58e6A8f77868681825C6fe21c1` (correct EIP-55 checksum — the founder's stated form had a bad checksum on identical 20 bytes); Memo `0x5294E9927c3306DcBaDb03fe70b92e01cCede505` (existing infra, reused for receipt anchoring).

## 2. Foundry tests

**38/38 pass** (`contracts/test/`): 14 lifecycle + 13 edge/fuzz + 11 V2-delta. No separate coverage artifact recorded — the 38 tests include the state-machine and delta assertions; coverage was not published.

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
- Sourcify `exact_match` (creation + runtime) on all three instances, chain 5042.

**SPECIFIED — NOT YET LIVE:**
- **T0-O oracle tier:** fully specified (bible §4.5) — never deployed, no mainnet txs.
- **V2 in the production app:** contract proven on mainnet but experimental — unwired in the UI, not audited, explicitly "do NOT integrate."
- **In-app CCTP execution:** guide only — contract-initiated CCTP burns are chain-gated on Arc (proven with minimal test contracts); direct EOA burns work.
- **Circle Onramp Kit:** mentioned as a fiat fallback only — no integration executed.
- **Third-party volume:** zero. All proofs are first-party dust; no real buyer/seller has used the product.

**Quirks (documented, not hidden):**
- Revert reasons surface in the `eth_call` message text, not as clean return data.
- Memo-wrapped calls can't be `eth_call`-previewed; revert reasons need direct-call replay.
- EURC checksum correction (§1): same 20 bytes, only the case encoding was fixed.

**Bottom line:** everything on this page either has a tx hash and an explorer link, or is labeled specified-not-live. No volume, no third parties, no unaudited code in the app — that is the current, complete state.
