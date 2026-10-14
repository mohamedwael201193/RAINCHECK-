#!/usr/bin/env python3
"""E2E-V2 stage 3: T3 failure path — approve, 7-param authorize, capture BEFORE
attestation must revert (status 0). Then try to extract the revert reason."""
import sys, time, secrets, json
sys.path.insert(0, "/home/hatch/workspace/raincheck-build/evidence/e2e-v2")
from e2e_v2 import *

D = "/home/hatch/workspace/raincheck-build/evidence/e2e-v2"
priv = load_key()
AMOUNT = 10000
now = int(time.time())

pid3 = "0x" + secrets.token_hex(32)
terms3 = "0x" + k256(b"e2e-v2-t3-terms").hex()
deadline3 = now + 900  # short: allows voidAfterDeadline recovery later
policyRef = "0x" + k256(b"e2e-policy").hex()
fundingRef = "0x" + "00" * 32
logf = open(f"{D}/txlog.jsonl", "a")
nonce = int(rpc("eth_getTransactionCount", [EXPECTED_ADDR, "pending"]), 16)
print(f"start nonce={nonce} pid3={pid3}")

def bcast(label, data, gas, expect_ok=True):
    global nonce
    txh = send_raw(priv, MEMO, data, gas, nonce)
    n0 = nonce; nonce += 1
    print(f"[{label}] nonce={n0} tx={txh}", flush=True)
    r = wait_receipt(txh)
    st = int(r["status"], 16); gu = int(r["gasUsed"], 16)
    eff = int(r.get("effectiveGasPrice", "0x0"), 16); blk = int(r["blockNumber"], 16)
    print(f"  -> status={st} gasUsed={gu} effGasPrice={eff} block={blk}")
    assert (st == 1) == expect_ok, f"UNEXPECTED STATUS {st} for {label}"
    logf.write(json.dumps({"label": label, "tx": txh, "status": st, "gasUsed": gu,
                           "effGasPrice": eff, "block": blk,
                           "url": f"{EXPLORER}/tx/{txh}"}) + "\n")
    logf.flush()
    return txh, r

inner_ap = sel("approve(address,uint256)") + waddr(V2) + w256(AMOUNT)
bcast("t3-approve", memo_wrap(USDC, inner_ap, "approve", {
    "spec": "raincheck-receipt/v2", "action": "approve", "token": USDC,
    "spender": V2, "amount": str(AMOUNT), "paymentId": pid3}), GAS["approve"])

inner_au = (sel("authorize(bytes32,bytes32,address,uint256,uint256,bytes32,bytes32)")
            + wb32(pid3) + wb32(terms3) + waddr(EXPECTED_ADDR) + w256(AMOUNT)
            + w256(deadline3) + wb32(policyRef) + wb32(fundingRef))
bcast("t3-authorize7", memo_wrap(V2, inner_au, "authorize", {
    "spec": "raincheck-receipt/v2", "action": "authorize", "contract": "RaincheckEscrowV2",
    "escrow": V2, "paymentId": pid3, "termsHash": terms3, "seller": EXPECTED_ADDR,
    "amount": str(AMOUNT), "deadline": str(deadline3),
    "policyRef": policyRef, "fundingRef": fundingRef}), GAS["authorize"])
assert v_get_payment(pid3)["status"] == 1, "expected OPEN before failure capture"
print("payment is OPEN (never attested) — capture must revert with 'not ATTESTED'")

# --- the intentional failure: capture on an OPEN payment
inner_cap = sel("capture(bytes32)") + wb32(pid3)
txh, r = bcast("t3-capture-FAIL", memo_wrap(V2, inner_cap, "capture", {
    "spec": "raincheck-receipt/v2", "action": "capture", "paymentId": pid3,
    "note": "INTENTIONAL FAILURE: capture before attestation; expect revert"}),
    GAS["capture"], expect_ok=False)
print("FAILURE PATH PROVEN: capture on OPEN payment reverted (status 0)")

# state must be unchanged
gp = v_get_payment(pid3)
assert gp["status"] == 1, "state changed by failed tx!"
print(f"post-failure state still: {STATUS[gp['status']]} (unchanged, as required)")

# --- try to extract the revert reason via trace
reason = None
try:
    tr = rpc("debug_traceTransaction", [txh, {"tracer": "callTracer"}])
    # walk to deepest revert
    def find_revert(n):
        if n.get("error"):
            return n
        for c in n.get("calls", []):
            f = find_revert(c)
            if f: return f
        return None
    fr = find_revert(tr)
    if fr:
        reason = {"error": fr.get("error"), "revertReason": fr.get("revertReason")}
    print("trace:", json.dumps(reason)[:300])
except Exception as e:
    print(f"debug_traceTransaction unavailable: {str(e)[:120]}")

json.dump({"pid3": pid3, "terms3": terms3, "deadline3": deadline3,
           "fail_tx": txh, "trace": reason},
          open(f"{D}/t3-state.json", "w"))
print("STAGE3 DONE")
