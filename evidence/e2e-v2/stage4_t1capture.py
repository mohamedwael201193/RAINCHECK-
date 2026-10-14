#!/usr/bin/env python3
"""E2E-V2 stage 4: T1 happy path part B — wait out the 300s challenge window,
then capture. Verify CAPTURED + seller payout."""
import sys, time, json
sys.path.insert(0, "/home/hatch/workspace/raincheck-build/evidence/e2e-v2")
from e2e_v2 import *

D = "/home/hatch/workspace/raincheck-build/evidence/e2e-v2"
priv = load_key()
st = json.load(open(f"{D}/t1-state.json"))
pid1, attestedAt = st["pid1"], st["attestedAt"]
logf = open(f"{D}/txlog.jsonl", "a")
target = attestedAt + 305

print(f"attestedAt={attestedAt} target_capture_at>={attestedAt + 300} (+5s margin -> {target})")
while True:
    b = rpc("eth_getBlockByNumber", ["latest", False])
    ct = int(b["timestamp"], 16)
    if ct >= target:
        print(f"chain time {ct} >= {target}: window closed")
        break
    wait = target - ct
    print(f"chain time {ct}: waiting {wait}s for challenge window...", flush=True)
    time.sleep(min(wait, 30))

# double-check still ATTESTED right before capture
gp = v_get_payment(pid1)
assert gp["status"] == 2, f"expected ATTESTED, got {STATUS[gp['status']]}"
bal_before = v_usdc_balance(EXPECTED_ADDR)

nonce = int(rpc("eth_getTransactionCount", [EXPECTED_ADDR, "pending"]), 16)
inner_cap = sel("capture(bytes32)") + wb32(pid1)
txh = send_raw(priv, MEMO, memo_wrap(V2, inner_cap, "capture", {
    "spec": "raincheck-receipt/v2", "action": "capture", "paymentId": pid1,
    "note": "permissionless finalization: challenge window passed, USDC to seller"}),
    GAS["capture"], nonce)
print(f"[t1-capture] nonce={nonce} tx={txh}")
r = wait_receipt(txh)
s = int(r["status"], 16); gu = int(r["gasUsed"], 16)
eff = int(r.get("effectiveGasPrice", "0x0"), 16); blk = int(r["blockNumber"], 16)
print(f"  -> status={s} gasUsed={gu} effGasPrice={eff} block={blk}")
assert s == 1, "capture failed!"
logf.write(json.dumps({"label": "t1-capture", "tx": txh, "status": s, "gasUsed": gu,
                       "effGasPrice": eff, "block": blk,
                       "url": f"{EXPLORER}/tx/{txh}"}) + "\n")

gp = v_get_payment(pid1)
assert gp["status"] == 3, f"expected CAPTURED, got {STATUS[gp['status']]}"
print(f"final: status={STATUS[gp['status']]} — OPEN->ATTESTED->CAPTURED complete")
bal_after = v_usdc_balance(EXPECTED_ADDR)
print(f"seller(=buyer) USDC: before={bal_before} after={bal_after} delta={bal_after - bal_before}")
print("STAGE4 DONE — happy path proven on mainnet")
