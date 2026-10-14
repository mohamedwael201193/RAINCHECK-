#!/usr/bin/env python3
"""E2E-V2 stage 5 (bonus): recover T3 principal via voidAfterDeadline once the
short deadline passes. Anyone-can-call; proves the liveness escape hatch."""
import sys, time, json
sys.path.insert(0, "/home/hatch/workspace/raincheck-build/evidence/e2e-v2")
from e2e_v2 import *

D = "/home/hatch/workspace/raincheck-build/evidence/e2e-v2"
priv = load_key()
st = json.load(open(f"{D}/t3-state.json"))
pid3, deadline3 = st["pid3"], st["deadline3"]
logf = open(f"{D}/txlog.jsonl", "a")

gp = v_get_payment(pid3)
print(f"pid3 status now: {STATUS[gp['status']]} (deadline3={deadline3})")
assert gp["status"] == 1, "pid3 not OPEN anymore, nothing to recover"

print("waiting for deadline to pass...")
while True:
    b = rpc("eth_getBlockByNumber", ["latest", False])
    ct = int(b["timestamp"], 16)
    if ct > deadline3:
        print(f"chain time {ct} > deadline {deadline3}: escape hatch open")
        break
    print(f"chain time {ct}: {deadline3 - ct}s to go...", flush=True)
    time.sleep(min(deadline3 - ct + 2, 30))

bal_before = v_usdc_balance(EXPECTED_ADDR)
nonce = int(rpc("eth_getTransactionCount", [EXPECTED_ADDR, "pending"]), 16)
inner = sel("voidAfterDeadline(bytes32)") + wb32(pid3)
txh = send_raw(priv, MEMO, memo_wrap(V2, inner, "void-deadline", {
    "spec": "raincheck-receipt/v2", "action": "voidAfterDeadline", "paymentId": pid3,
    "note": "bonus recovery: seller never attested by deadline, refund to buyer"}),
    GAS["voidAfterDeadline"], nonce)
print(f"[t3-voidAfterDeadline] nonce={nonce} tx={txh}")
r = wait_receipt(txh)
s = int(r["status"], 16); gu = int(r["gasUsed"], 16)
eff = int(r.get("effectiveGasPrice", "0x0"), 16); blk = int(r["blockNumber"], 16)
print(f"  -> status={s} gasUsed={gu} effGasPrice={eff} block={blk}")
assert s == 1
logf.write(json.dumps({"label": "t3-voidAfterDeadline", "tx": txh, "status": s,
                       "gasUsed": gu, "effGasPrice": eff, "block": blk,
                       "url": f"{EXPLORER}/tx/{txh}"}) + "\n")
gp = v_get_payment(pid3)
assert gp["status"] == 4
d = v_disputes(EXPECTED_ADDR)
bal_after = v_usdc_balance(EXPECTED_ADDR)
print(f"final: status={STATUS[gp['status']]} disputes(seller)={d} (must stay 1: liveness != dishonesty)")
print(f"buyer USDC: before={bal_before} after={bal_after}")
assert d == 1, "voidAfterDeadline must NOT increment disputes!"
print("STAGE5 DONE — T3 principal recovered, disputes untouched")
