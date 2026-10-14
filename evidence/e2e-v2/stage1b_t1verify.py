#!/usr/bin/env python3
"""E2E-V2 stage 1b: verify T1 authorize views (pid1 known), then attest."""
import sys, time, json
sys.path.insert(0, "/home/hatch/workspace/raincheck-build/evidence/e2e-v2")
from e2e_v2 import *

D = "/home/hatch/workspace/raincheck-build/evidence/e2e-v2"
priv = load_key()
pid1 = "0x243cddad5b75bfb35ec1ac59fab848fa4fcab9f30a9678958381e9670abcc2ab"
terms1 = "0x" + k256(b"e2e-v2-t1-terms").hex()
out1 = "0x" + k256(b"e2e-v2-t1-output").hex()
policyRef = "0x" + k256(b"e2e-policy").hex()
logf = open(f"{D}/txlog.jsonl", "a")

gp = v_get_payment(pid1)
print(f"getPayment: status={STATUS[gp['status']]} seller={gp['seller']}")
print(f"  amount={gp['amount']} termsHash={gp['termsHash']}")
assert gp["status"] == 1, "not OPEN"
assert gp["seller"].lower() == EXPECTED_ADDR
assert gp["amount"] == 10000
assert gp["termsHash"].lower() == terms1.lower()

rc = v_receipt(pid1)
print(f"receipts: buyer={rc['buyer']} deadline={rc['deadline']}")
print(f"  policyRef ={rc['policyRef']}")
print(f"  fundingRef={rc['fundingRef']}")
assert rc["policyRef"].lower() == policyRef.lower(), "policyRef NOT stored!"
assert rc["fundingRef"] == "0x" + "00" * 32
assert rc["buyer"].lower() == EXPECTED_ADDR
print("DELTA PROOF: 7-param authorize stored policyRef on-chain; getPayment view live")

nonce = int(rpc("eth_getTransactionCount", [EXPECTED_ADDR, "pending"]), 16)
inner_at = sel("attestDelivery(bytes32,bytes32)") + wb32(pid1) + wb32(out1)
txh = send_raw(priv, MEMO, memo_wrap(V2, inner_at, "attest", {
    "spec": "raincheck-receipt/v2", "action": "attestDelivery",
    "paymentId": pid1, "outputHash": out1,
    "note": "seller attests delivery; challenge window opens; state -> ATTESTED"}),
    GAS["attest"], nonce)
print(f"[t1-attest] nonce={nonce} tx={txh}")
r = wait_receipt(txh)
st = int(r["status"], 16); gu = int(r["gasUsed"], 16)
eff = int(r.get("effectiveGasPrice", "0x0"), 16); blk = int(r["blockNumber"], 16)
print(f"  -> status={st} gasUsed={gu} effGasPrice={eff} block={blk}")
assert st == 1
logf.write(json.dumps({"label": "t1-attest", "tx": txh, "status": st, "gasUsed": gu,
                       "effGasPrice": eff, "block": blk,
                       "url": f"{EXPLORER}/tx/{txh}"}) + "\n")

gp = v_get_payment(pid1); rc = v_receipt(pid1)
assert gp["status"] == 2, f"expected ATTESTED, got {STATUS[gp['status']]}"
print(f"post-attest: status={STATUS[gp['status']]} attestedAt={rc['attestedAt']}")
json.dump({"pid1": pid1, "terms1": terms1, "out1": out1,
           "policyRef": policyRef, "attestedAt": rc["attestedAt"]},
          open(f"{D}/t1-state.json", "w"))
print("STAGE1B DONE — capture after attestedAt+300")
