#!/usr/bin/env python3
"""E2E-V2 stage 1: T1 happy path part A — approve, 7-param authorize, views, attest."""
import sys, time, secrets, json
sys.path.insert(0, "/home/hatch/workspace/raincheck-build/evidence/e2e-v2")
from e2e_v2 import *

D = "/home/hatch/workspace/raincheck-build/evidence/e2e-v2"
priv = load_key()
AMOUNT = 10000
now = int(time.time())

pid1 = "0x" + secrets.token_hex(32)
terms1 = "0x" + k256(b"e2e-v2-t1-terms").hex()
out1 = "0x" + k256(b"e2e-v2-t1-output").hex()
deadline1 = now + 7200
policyRef = "0x" + k256(b"e2e-policy").hex()
fundingRef = "0x" + "00" * 32

logf = open(f"{D}/txlog.jsonl", "a")

def bcast(label, data, gas, expect_ok=True):
    global nonce
    txh = send_raw(priv, MEMO, data, gas, nonce)
    used_nonce = nonce
    nonce += 1
    print(f"[{label}] nonce={used_nonce} tx={txh}", flush=True)
    r = wait_receipt(txh)
    st = int(r["status"], 16)
    gu = int(r["gasUsed"], 16)
    eff = int(r.get("effectiveGasPrice", "0x0"), 16)
    blk = int(r["blockNumber"], 16)
    print(f"  -> status={st} gasUsed={gu} effGasPrice={eff} block={blk} cost_base={gu*eff}")
    assert (st == 1) == expect_ok, f"UNEXPECTED STATUS {st} for {label}"
    logf.write(json.dumps({"label": label, "tx": txh, "status": st, "gasUsed": gu,
                           "effGasPrice": eff, "block": blk,
                           "url": f"{EXPLORER}/tx/{txh}"}) + "\n")
    logf.flush()
    return txh, r

nonce = int(rpc("eth_getTransactionCount", [EXPECTED_ADDR, "pending"]), 16)
print(f"start nonce={nonce} pid1={pid1}")

# --- approve (memo-wrapped, V1 pattern)
inner_ap = sel("approve(address,uint256)") + waddr(V2) + w256(AMOUNT)
bcast("t1-approve", memo_wrap(USDC, inner_ap, "approve", {
    "spec": "raincheck-receipt/v2", "action": "approve", "token": USDC,
    "spender": V2, "amount": str(AMOUNT), "paymentId": pid1,
    "note": "USDC approval for the V2 escrow pull on 7-param authorize()"}), GAS["approve"])

# --- 7-param authorize (THE DELTA)
inner_au = (sel("authorize(bytes32,bytes32,address,uint256,uint256,bytes32,bytes32)")
            + wb32(pid1) + wb32(terms1) + waddr(EXPECTED_ADDR) + w256(AMOUNT)
            + w256(deadline1) + wb32(policyRef) + wb32(fundingRef))
assert inner_au[:4].hex() == "42a945f7"
bcast("t1-authorize7", memo_wrap(V2, inner_au, "authorize", {
    "spec": "raincheck-receipt/v2", "action": "authorize",
    "contract": "RaincheckEscrowV2", "escrow": V2, "paymentId": pid1,
    "termsHash": terms1, "seller": EXPECTED_ADDR, "amount": str(AMOUNT),
    "deadline": str(deadline1), "policyRef": policyRef, "fundingRef": fundingRef,
    "note": "7-param authorize: buyer locks 0.01 USDC; state -> OPEN"}), GAS["authorize"])

# --- views: getPayment (delta) + full receipts (policyRef proof)
gp = v_get_payment(pid1)
print(f"getPayment: status={STATUS[gp['status']]} seller={gp['seller']} amount={gp['amount']} termsHash={gp['termsHash'][:18]}...")
assert gp["status"] == 1 and gp["amount"] == AMOUNT
assert gp["seller"].lower() == EXPECTED_ADDR and gp["termsHash"].lower() == terms1.lower()
rc = v_receipt(pid1)
print(f"receipts: policyRef={rc['policyRef'][:18]}... fundingRef={rc['fundingRef'][:18]}... buyer={rc['buyer'][:18]}...")
assert rc["policyRef"].lower() == policyRef.lower(), "policyRef NOT stored!"
assert rc["fundingRef"] == "0x" + "00" * 32
assert rc["buyer"].lower() == EXPECTED_ADDR
print("DELTA PROOF: policyRef stored on-chain, retrievable via receipts(); getPayment view live")

# --- attest (seller = deployer)
inner_at = sel("attestDelivery(bytes32,bytes32)") + wb32(pid1) + wb32(out1)
bcast("t1-attest", memo_wrap(V2, inner_at, "attest", {
    "spec": "raincheck-receipt/v2", "action": "attestDelivery",
    "paymentId": pid1, "outputHash": out1,
    "note": "seller attests delivery; challenge window opens; state -> ATTESTED"}), GAS["attest"])

gp = v_get_payment(pid1)
rc = v_receipt(pid1)
assert gp["status"] == 2, f"expected ATTESTED, got {STATUS[gp['status']]}"
print(f"post-attest: status={STATUS[gp['status']]} attestedAt={rc['attestedAt']}")

json.dump({"pid1": pid1, "terms1": terms1, "out1": out1, "deadline1": deadline1,
           "policyRef": policyRef, "attestedAt": rc["attestedAt"]},
          open(f"{D}/t1-state.json", "w"))
print("STAGE1 DONE — state saved. capture after attestedAt+300")
