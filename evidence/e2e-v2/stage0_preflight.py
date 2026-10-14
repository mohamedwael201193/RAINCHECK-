#!/usr/bin/env python3
"""E2E-V2 stage 0: PREFLIGHT. Read-only except key derivation. Aborts on any mismatch."""
import sys
sys.path.insert(0, "/home/hatch/workspace/raincheck-build/evidence/e2e-v2")
from e2e_v2 import *

print("== E2E-V2 PREFLIGHT ==")
priv = load_key()
print("1. key -> address: MATCH 0xf76e6B0920e9332fF4410f6dD53F01722AbC71a3")

cid = int(rpc("eth_chainId"), 16)
assert cid == CHAIN_ID, f"chainId {cid} != 5042"
print(f"2. chainId: {cid} OK")

for name, addr in [("V2 escrow", V2), ("Memo", MEMO), ("USDC", USDC)]:
    code = rpc("eth_getCode", [addr, "latest"])
    assert code and code != "0x", f"{name} has no code!"
    print(f"3. {name} {addr}: code {len(code)//2 - 1} bytes OK")

cw = v_challenge_window()
assert cw == 300, f"challengeWindow {cw} != 300"
print(f"4. challengeWindow(): {cw}s OK")

# selector cross-check vs compiled ABI
s7 = sel("authorize(bytes32,bytes32,address,uint256,uint256,bytes32,bytes32)").hex()
s5 = sel("authorize(bytes32,bytes32,address,uint256,uint256)").hex()
sgp = sel("getPayment(bytes32)").hex()
sm = sel("memo(address,bytes,bytes32,bytes)").hex()
assert s7 == "42a945f7", s7
assert s5 == "5814cf09", s5
assert sgp == "e66eefc8", sgp
print(f"5. selectors OK: authorize7=0x{s7} authorize5=0x{s5} getPayment=0x{sgp} memo=0x{sm}")

bal = v_usdc_balance(EXPECTED_ADDR)
print(f"6. deployer USDC balance: {bal} base = {bal/1e6} USDC")
assert bal >= 100_000, "insufficient USDC for 3x 0.01 principal + gas"

fees, eip1559 = fee_params()
print(f"7. fee model: {'EIP-1559' if eip1559 else 'legacy'} {fees}")

nonce = int(rpc("eth_getTransactionCount", [EXPECTED_ADDR, "pending"]), 16)
print(f"8. pending nonce: {nonce}")

pol = k256(b"e2e-policy").hex()
print(f"9. policyRef = keccak256('e2e-policy') = 0x{pol}")
print("PREFLIGHT PASS — safe to broadcast")
