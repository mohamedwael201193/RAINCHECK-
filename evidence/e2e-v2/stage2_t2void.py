#!/usr/bin/env python3
"""E2E-V2 stage 2: T2 void path — approve, 7-param authorize, attest, flag, void."""
import sys, time, secrets, json
sys.path.insert(0, "/home/hatch/workspace/raincheck-build/evidence/e2e-v2")
from e2e_v2 import *

D = "/home/hatch/workspace/raincheck-build/evidence/e2e-v2"
priv = load_key()
AMOUNT = 10000
now = int(time.time())

pid2 = "0x" + secrets.token_hex(32)
terms2 = "0x" + k256(b"e2e-v2-t2-terms").hex()
out2 = "0x" + k256(b"e2e-v2-t2-output").hex()
reason2 = "0x" + k256(b"e2e-v2-t2-reason: delivery did not match terms").hex()
deadline2 = now + 7200
policyRef = "0x" + k256(b"e2e-policy").hex()
fundingRef = "0x" + "00" * 32
logf = open(f"{D}/txlog.jsonl", "a")
nonce = int(rpc("eth_getTransactionCount", [EXPECTED_ADDR, "pending"]), 16)
print(f"start nonce={nonce} pid2={pid2}")
bal_before = v_usdc_balance(EXPECTED_ADDR)
print(f"buyer USDC before: {bal_before}")

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
    return txh

inner_ap = sel("approve(address,uint256)") + waddr(V2) + w256(AMOUNT)
bcast("t2-approve", memo_wrap(USDC, inner_ap, "approve", {
    "spec": "raincheck-receipt/v2", "action": "approve", "token": USDC,
    "spender": V2, "amount": str(AMOUNT), "paymentId": pid2}), GAS["approve"])

inner_au = (sel("authorize(bytes32,bytes32,address,uint256,uint256,bytes32,bytes32)")
            + wb32(pid2) + wb32(terms2) + waddr(EXPECTED_ADDR) + w256(AMOUNT)
            + w256(deadline2) + wb32(policyRef) + wb32(fundingRef))
bcast("t2-authorize7", memo_wrap(V2, inner_au, "authorize", {
    "spec": "raincheck-receipt/v2", "action": "authorize", "contract": "RaincheckEscrowV2",
    "escrow": V2, "paymentId": pid2, "termsHash": terms2, "seller": EXPECTED_ADDR,
    "amount": str(AMOUNT), "deadline": str(deadline2),
    "policyRef": policyRef, "fundingRef": fundingRef}), GAS["authorize"])
assert v_get_payment(pid2)["status"] == 1

inner_at = sel("attestDelivery(bytes32,bytes32)") + wb32(pid2) + wb32(out2)
bcast("t2-attest", memo_wrap(V2, inner_at, "attest", {
    "spec": "raincheck-receipt/v2", "action": "attestDelivery",
    "paymentId": pid2, "outputHash": out2}), GAS["attest"])
assert v_get_payment(pid2)["status"] == 2

inner_fl = sel("flagNonDelivery(bytes32,bytes32)") + wb32(pid2) + wb32(reason2)
bcast("t2-flag", memo_wrap(V2, inner_fl, "flag", {
    "spec": "raincheck-receipt/v2", "action": "flagNonDelivery",
    "paymentId": pid2, "reasonHash": reason2,
    "note": "buyer disputes inside challenge window; state -> FLAGGED"}), GAS["flag"])
assert v_get_payment(pid2)["status"] == 5, "expected FLAGGED"

inner_v = sel("void(bytes32)") + wb32(pid2)
bcast("t2-void", memo_wrap(V2, inner_v, "void", {
    "spec": "raincheck-receipt/v2", "action": "void", "paymentId": pid2,
    "note": "permissionless: flagged receipt, full refund to buyer"}), GAS["void"])

gp = v_get_payment(pid2)
assert gp["status"] == 4, f"expected VOIDED, got {STATUS[gp['status']]}"
print(f"final: status={STATUS[gp['status']]}")
d = v_disputes(EXPECTED_ADDR)
print(f"disputes(seller)={d} (delta-1 proof: void increments seller dispute counter)")
assert d == 1, f"expected disputes=1, got {d}"
bal_after = v_usdc_balance(EXPECTED_ADDR)
print(f"buyer USDC after: {bal_after} (delta vs before: {bal_after - bal_before}, principal 10000 refunded minus gas)")
assert bal_after - bal_before > 9000, "refund not received!"
print("STAGE2 DONE — void path proven: OPEN->ATTESTED->FLAGGED->VOIDED, refund landed, disputes=1")
