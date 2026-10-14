# RAINCHECK — Deploy Runbook (Arc mainnet, chain 5042)

Deploy target: `RaincheckEscrowV2` (production contract: `challengeWindow = 300` +
trust-stack deltas, bible §4.1). `src/RaincheckEscrow.sol` (V1, 60s) is the
Sourcify-verified reference — **do not modify it**; it must stay byte-identical
to `0x41099436c5f18eA916B9ca3B835fdc4B5c758Deb`.

Source of truth: `~/workspace/your_files/raincheck-build-bible.md` (§5.3, §6.1, §6.4).

## 0. Safety rules (non-negotiable)

- **No private keys in the repo, ever.** No keys on the command line where they
  land in shell history — load from a file outside the repo (`~/.raincheck-deploy.env`,
  mode 600) with `set -a; source ~/.raincheck-deploy.env; set +a`.
- **Never print a key.** The deploy script reads `DEPLOYER_PRIVATE_KEY` from the
  environment and never logs it.
- **Nothing broadcasts unless you pass `--broadcast`** (forge script) or run
  `cast send` explicitly. Simulation is the default.

## 1. Build

```bash
cd ~/workspace/raincheck-build/contracts
forge build
```

Compiler profile (pinned in `foundry.toml`, part of the Sourcify exact_match
profile — do not change without redeploy + reverify):

- `solc = "0.8.24"` (resolves to 0.8.24+commit.e11b9ed9)
- `optimizer = false`

Verified working with forge 1.8.5. Confirm `out/RaincheckEscrowV2.sol/RaincheckEscrowV2.json`
exists before proceeding.

## 2. Gas-budget the deploy FIRST (the R9 0.03 USDC burn lesson)

On Arc, **never use `eth_estimateGas` for the CREATE**. Compute the manual limit as

```
manualGasLimit = runtimeBytes × 200 + 300_000
```

The 200 is the EIP-170 code-deposit cost per runtime byte; the 300_000 margin covers
the 21k intrinsic cost, calldata (~16 gas/byte of creation code), and constructor
execution. R9-W1B burned 0.03 USDC on a 1.5M manual limit against an 8,056-byte
runtime that needs ≥1.61M for code deposit alone.

The deploy script prints the budget for the current bytecode — run it in
simulation mode (no key needed):

```bash
forge script script/Deploy.s.sol:DeployRaincheckEscrow \
  --rpc-url https://rpc.mainnet.arc.io
```

Expected output (current `RaincheckEscrowV2` bytecode):

```
contract            : RaincheckEscrowV2
runtime bytes       : 8196
creation bytes      : 8511
code-deposit floor  : 1639200
MANUAL GAS LIMIT    : 1939200
challengeWindow spec: 300
usdc                : 0x3600000000000000000000000000000000000000
mode                : SIMULATION (no DEPLOYER_PRIVATE_KEY; use --dry-run)
```

Sanity check the margin yourself: 8,511 creation bytes × 16 ≈ 136k calldata +
21k intrinsic + ~5k constructor + 1,639,200 code deposit ≈ 1.80M < 1,939,200. ✓

Cost estimate at 20 gwei (what the reference deploy paid; Arc's gas token is USDC):
`1,939,200 × 20 gwei ≈ 0.0388 USDC` worst case.

## 3. Dry-run (simulation — no key, nothing broadcast)

In forge ≥1.8 the `--dry-run` flag is gone: **simulation is the default**; only
`--broadcast` sends transactions.

```bash
forge script script/Deploy.s.sol:DeployRaincheckEscrow \
  --rpc-url https://rpc.mainnet.arc.io -vvv
```

Verify in the output before any broadcast:

1. `MANUAL GAS LIMIT` matches your hand computation from §2.
2. `usdc : 0x3600000000000000000000000000000000000000` (the script **refuses**
   any other constructor arg).
3. `challengeWindow() : 300` — the script asserts this on the deployed instance
   and reverts otherwise.
4. `SIMULATION COMPLETE` and **no** `--broadcast` in the command.

The script writes its simulation record to
`broadcast/Deploy.s.sol/5042/dry-run/run-latest.json` (git-ignored scratch —
never an integration record).

## 4. Broadcast (real mainnet transaction)

**Preconditions:** V2 has passed the full Forge suite, a line-by-line review
against V1 is done, and the deployer key + ≥0.05 USDC for gas are ready.
Fund the deployer with a small, explicit amount — the gas budget from §2 is the
ceiling, not a suggestion.

### Path A — recommended (exact bible compliance: manual gas limit)

`forge script` in 1.8.5 has no per-transaction `--gas-limit` (the flag is the
*block* gas limit), so the manual CREATE limit goes through `cast`:

```bash
set -a; source ~/.raincheck-deploy.env; set +a   # provides DEPLOYER_PRIVATE_KEY
# DEPLOYER_PRIVATE_KEY is read from the environment only — never echoed, never committed.

CREATION=$(jq -r '.bytecode.object' out/RaincheckEscrowV2.sol/RaincheckEscrowV2.json)
ARGS=$(cast abi-encode "constructor(address)" 0x3600000000000000000000000000000000000000)
INIT_CODE="${CREATION}${ARGS#0x}"

GAS_LIMIT=1939200   # from §2 — recompute if the bytecode changed
GAS_PRICE=$(cast gas-price --rpc-url https://rpc.mainnet.arc.io)

# cast 1.8.5: every flag must come BEFORE --create, or the parse fails.
cast send --gas-limit "$GAS_LIMIT" \
  --gas-price "$GAS_PRICE" \
  --rpc-url https://rpc.mainnet.arc.io \
  --private-key "$DEPLOYER_PRIVATE_KEY" \
  --create "$INIT_CODE"
```

Record from the receipt: transaction hash, contract address, `gasUsed`.
**If `gasUsed` is anywhere near `gasLimit`, stop** — the §2 margin was wrong;
recompute, do not blindly bump.

### Path B — forge script broadcast (alternative)

```bash
set -a; source ~/.raincheck-deploy.env; set +a

forge script script/Deploy.s.sol:DeployRaincheckEscrow \
  --rpc-url https://rpc.mainnet.arc.io \
  --broadcast -vvv
```

Caveat: forge assigns the broadcast transaction's gas limit from its own
simulation, not from the §2 manual rule. Prefer Path A on Arc.

## 5. Post-deploy checks (before announcing the address)

```bash
ADDR=<deployed-address>

cast code --rpc-url https://rpc.mainnet.arc.io "$ADDR" | wc -c        # non-empty
cast call --rpc-url https://rpc.mainnet.arc.io "$ADDR" "challengeWindow()"   # 300
cast call --rpc-url https://rpc.mainnet.arc.io "$ADDR" "usdc()"               # 0x3600…0000
```

## 6. Sourcify exact_match verification (mandatory)

Chain 5042 is served by Sourcify. The reference deployment's live record
(checked 2026-10-14):

```
GET https://sourcify.dev/server/v2/contract/5042/0x41099436c5f18eA916B9ca3B835fdc4B5c758Deb
→ {"match":"exact_match","creationMatch":"exact_match","runtimeMatch":"exact_match",
   "verifiedAt":"2026-10-14T04:54:08Z","chainId":"5042", ...}
```

**What to submit:** the exact sources compiled by `forge build` —
`src/RaincheckEscrowV2.sol` (+ its import `src/RaincheckEscrow.sol` for `IERC20`)
— with **solc 0.8.24+commit.e11b9ed9, optimizer OFF**, exactly as pinned in
`foundry.toml`. Constructor args are part of the creation match
(`address _usdc = 0x3600000000000000000000000000000000000000`; the dry-run
transaction input in `broadcast/.../dry-run/run-latest.json` shows the exact
encoding — its tail is the ABI-encoded USDC address).

```bash
forge verify-contract \
  --chain 5042 \
  --verifier sourcify \
  --compiler-version v0.8.24 \
  "$ADDR" src/RaincheckEscrowV2.sol:RaincheckEscrowV2
```

If the CLI verifier is unavailable, use the Sourcify web verifier
(`sourcify.dev` → Verifier, chain 5042) or `POST /server/v2/verify` with the
standard JSON input — same compiler settings.

**How to confirm creation + runtime match:**

```bash
curl -s "https://sourcify.dev/server/v2/contract/5042/$ADDR" | jq .
# require: .creationMatch == "exact_match" AND .runtimeMatch == "exact_match"
```

Accept nothing less than `exact_match` on **both**. A `partial_match` means the
metadata/settings differ from the deployed bytecode — find the difference,
do not ship.

## 7. Record the deployment

Update `deployments/arc-mainnet.json` **by hand** (human-reviewed; scripts never
auto-overwrite it): address, deploy tx, deployer, block, compiler, Sourcify
URLs, `challengeWindow`, and the gas actually used. See the existing file for
the reference-deployment entry format.

## 8. Known failure modes

| Symptom | Cause | Fix |
|---|---|---|
| `OutOfGas` on the CREATE, `gasUsed == gasLimit` | Manual limit below the §2 rule (R9-W1B: 1.5M vs ≥1.61M needed) | Recompute `runtimeBytes × 200 + 300_000` from the **current** artifact; never reuse a stale limit |
| `refusing to deploy against non-canonical USDC` | `RAINCHECK_USDC` set to something else | Unset it; production deploys only against `0x3600…0000` |
| `challengeWindow mismatch` | Wrong contract selected | Deploy `RaincheckEscrowV2`, not V1 |
| `partial_match` on Sourcify | Compiler settings drift (optimizer on, wrong solc) | Rebuild from the pinned `foundry.toml` profile and resubmit |
