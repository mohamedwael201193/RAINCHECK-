#!/usr/bin/env python3
"""E2E-V2: mainnet dust tests for RaincheckEscrowV2 (experimental).
Reads the deployer key ONLY from ~/workspace/user/files/env-3.txt.
Never prints/logs the key. Aborts if derived address != expected.
"""
import json, re, sys, time, urllib.request

from Crypto.Hash import keccak

RPC = "https://rpc.mainnet.arc.io"
EXPLORER = "https://explorer.arc.io"
CHAIN_ID = 5042
EXPECTED_ADDR = "0xf76e6b0920e9332ff4410f6dd53f01722abc71a3".lower()

V2 = "0x3795b865f7fc84a14ab60456be9fc6dd0cb56f0c"
MEMO = "0x5294e9927c3306DcBaDb03fe70b92e01cCede505"
USDC = "0x3600000000000000000000000000000000000000"

GAS = {"approve": 120_000, "authorize": 300_000, "attest": 150_000,
       "capture": 120_000, "flag": 120_000, "void": 120_000,
       "voidAfterDeadline": 120_000}

# ---------------------------------------------------------------- keccak
def k256(b: bytes) -> bytes:
    return keccak.new(data=b, digest_bits=256).digest()

def sel(sig: str) -> bytes:
    return k256(sig.encode())[:4]

# ---------------------------------------------------------------- ABI
def w256(x: int) -> bytes:
    return x.to_bytes(32, "big")

def waddr(a: str) -> bytes:
    return bytes(12) + bytes.fromhex(a[2:])

def wb32(h: str) -> bytes:
    h = h[2:] if h.startswith("0x") else h
    return bytes.fromhex(h)

def enc_bytes_dyn(b: bytes) -> bytes:
    return w256(len(b)) + b + bytes((-len(b)) % 32)

def fn_call(signature: str, head_parts: list, dyn_parts: list = []) -> bytes:
    # head_parts: list of 32-byte words or ('dyn',) markers in order
    head = b""
    tails = b""
    offset = 32 * len(head_parts)
    for p in head_parts:
        if p == "dyn":
            head += w256(offset)
            offset += len(dyn_parts[0])
            tails += dyn_parts.pop(0)
        else:
            head += p
    return sel(signature) + head + tails

def memo_wrap(target: str, inner: bytes, label: str, memo_json: dict) -> bytes:
    memo_data = json.dumps(memo_json, separators=(",", ":")).encode()
    assert len(memo_data) <= 1024, "memo data exceeds 1KB"
    memo_id = k256(f"raincheck-v2:{label}:v1".encode())
    return (sel("memo(address,bytes,bytes32,bytes)")
            + waddr(target) + w256(128) + memo_id + w256(128 + len(enc_bytes_dyn(inner)))
            + enc_bytes_dyn(inner) + enc_bytes_dyn(memo_data))

# ---------------------------------------------------------------- RLP
def rlp(x) -> bytes:
    if isinstance(x, int):
        x = b"" if x == 0 else x.to_bytes((x.bit_length() + 7) // 8, "big")
    if isinstance(x, bytes):
        if len(x) == 1 and x[0] < 0x80:
            return x
        return _rlp_len(len(x), 0x80) + x
    payload = b"".join(rlp(i) for i in x)
    return _rlp_len(len(payload), 0xC0) + payload

def _rlp_len(l: int, base: int) -> bytes:
    if l < 56:
        return bytes([base + l])
    bl = l.to_bytes((l.bit_length() + 7) // 8, "big")
    return bytes([base + 55 + len(bl)]) + bl

# ------------------------------------------------- secp256k1 sign/recover
P = 0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEFFFFFC2F
N = 0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364141
Gx = 0x79BE667EF9DCBBAC55A06295CE870B07029BFCDB2DCE28D959F2815B16F81798
Gy = 0x483ADA7726A3C4655DA4FBFC0E1108A8FD17B448A68554199C47D08FFB10D4B8

def _inv(a): return pow(a, P - 2, P)
def _add(p1, p2):
    if p1 is None: return p2
    if p2 is None: return p1
    x1, y1 = p1; x2, y2 = p2
    if x1 == x2 and (y1 + y2) % P == 0: return None
    lam = ((y2 - y1) * _inv((x2 - x1) % P)) % P if p1 != p2 else ((3 * x1 * x1) * _inv(2 * y1)) % P
    x3 = (lam * lam - x1 - x2) % P
    return (x3, (lam * (x1 - x3) - y1) % P)
def _mul(k, p=(Gx, Gy)):
    r = None
    while k:
        if k & 1: r = _add(r, p)
        p = _add(p, p); k >>= 1
    return r

def _rfc6979_k(priv: int, h: bytes) -> int:
    import hmac, hashlib
    pk = priv.to_bytes(32, "big")
    v = b"\x01" * 32
    k = b"\x00" * 32
    k = hmac.new(k, v + b"\x00" + pk + h, hashlib.sha256).digest()
    v = hmac.new(k, v, hashlib.sha256).digest()
    k = hmac.new(k, v + b"\x01" + pk + h, hashlib.sha256).digest()
    v = hmac.new(k, v, hashlib.sha256).digest()
    while True:
        v = hmac.new(k, v, hashlib.sha256).digest()
        cand = int.from_bytes(v, "big")
        if 1 <= cand < N:
            return cand
        k = hmac.new(k, v + b"\x00", hashlib.sha256).digest()
        v = hmac.new(k, v, hashlib.sha256).digest()

def sign_hash(priv: int, h: bytes):
    kk = _rfc6979_k(priv, h)
    R = _mul(kk, (Gx, Gy))
    r = R[0] % N
    assert r != 0
    e = int.from_bytes(h, "big")
    s = (pow(kk, N - 2, N) * (e + r * priv)) % N
    if s > N // 2:
        s = N - s
    # verify by recovery against the expected address
    for recid in (0, 1):
        x = r + (recid // 2) * N
        if x >= P:
            continue
        y2 = (pow(x, 3, P) + 7) % P
        y = pow(y2, (P + 1) // 4, P)
        if (y * y) % P != y2:
            continue
        if (y % 2) != (recid % 2):
            y = P - y
        RR = (x, y)
        rinv = pow(r, N - 2, N)
        sR = _mul(s, RR)
        eG = _mul(e % N, (Gx, Gy))
        Q = _mul(rinv, _add(sR, (eG[0], P - eG[1])))
        if Q is None:
            continue
        addr = "0x" + k256(Q[0].to_bytes(32, "big") + Q[1].to_bytes(32, "big"))[-20:].hex()
        if addr.lower() == EXPECTED_ADDR:
            return r, s, recid
    raise RuntimeError("recovery failed")

def addr_of(priv: int) -> str:
    Q = _mul(priv, (Gx, Gy))
    return "0x" + k256(Q[0].to_bytes(32, "big") + Q[1].to_bytes(32, "big"))[-20:].hex()

# ---------------------------------------------------------------- RPC
_req_id = 0
_session = None
def _sess():
    global _session
    if _session is None:
        import requests
        _session = requests.Session()
        _session.headers.update({
            "Content-Type": "application/json",
            "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36",
        })
    return _session

def rpc(method, params=[]):
    global _req_id
    _req_id += 1
    out = _sess().post(RPC, json={"jsonrpc": "2.0", "id": _req_id,
                                  "method": method, "params": params},
                       timeout=30).json()
    if "error" in out:
        raise RuntimeError(f"RPC {method} error: {out['error']}")
    return out["result"]

def eth_call(to, data: bytes, block="latest"):
    return rpc("eth_call", [{"to": to, "data": "0x" + data.hex()}, block])

# ---------------------------------------------------------------- key load
def load_key() -> int:
    txt = open("/home/hatch/workspace/user/files/env-3.txt").read()
    m = re.search(r"DEPLOYER_PRIVATE_KEY=([0-9a-fA-F]{64})", txt)
    assert m, "key not found in env-3.txt"
    priv = int(m.group(1), 16)
    got = addr_of(priv)
    if got.lower() != EXPECTED_ADDR:
        print(f"ADDRESS MISMATCH: derived={got} expected={EXPECTED_ADDR}", file=sys.stderr)
        sys.exit(2)
    return priv

# ---------------------------------------------------------------- tx send
def fee_params():
    try:
        fh = rpc("eth_feeHistory", ["0x1", "latest", []])
        base = int(fh["baseFeePerGas"][-1], 16)
        try:
            prio = int(rpc("eth_maxPriorityFeePerGas"), 16)
        except Exception:
            prio = 1_000_000_000
        prio = max(prio, 1_000_000_000)
        return {"maxFeePerGas": 2 * base + prio, "maxPriorityFeePerGas": prio}, True
    except Exception:
        return {"gasPrice": int(rpc("eth_gasPrice"), 16)}, False

def send_raw(priv: int, to: str, data: bytes, gas: int, nonce: int):
    fees, eip1559 = fee_params()
    if eip1559:
        tx = [CHAIN_ID, nonce, fees["maxPriorityFeePerGas"], fees["maxFeePerGas"],
              gas, bytes.fromhex(to[2:]), 0, data, []]
        v_base = CHAIN_ID * 2 + 35
def send_raw(priv: int, to: str, data: bytes, gas: int, nonce: int):
    fees, eip1559 = fee_params()
    to_b = bytes.fromhex(to[2:])
    if eip1559:
        fields = [CHAIN_ID, nonce, fees["maxPriorityFeePerGas"], fees["maxFeePerGas"],
                  gas, to_b, 0, data, []]
        h = k256(b"\x02" + rlp(fields))
        r, s, recid = sign_hash(priv, h)
        raw = b"\x02" + rlp(fields + [recid, r, s])
    else:
        fields = [nonce, fees["gasPrice"], gas, to_b, 0, data]
        h = k256(rlp(fields + [CHAIN_ID, 0, 0]))
        r, s, recid = sign_hash(priv, h)
        raw = rlp(fields + [CHAIN_ID * 2 + 35 + recid, r, s])
    txh = "0x" + k256(raw).hex()
    rpc("eth_sendRawTransaction", ["0x" + raw.hex()])
    return txh
    txh = "0x" + k256(raw).hex()
    rpc("eth_sendRawTransaction", ["0x" + raw.hex()])
    return txh

def wait_receipt(txh, timeout=180):
    t0 = time.time()
    while time.time() - t0 < timeout:
        r = rpc("eth_getTransactionReceipt", [txh])
        if r:
            return r
        time.sleep(4)
    raise TimeoutError(f"no receipt for {txh}")

# ---------------------------------------------------------------- views
def v_challenge_window():
    return int(eth_call(V2, sel("challengeWindow()")), 16)

def v_usdc_balance(a):
    return int(eth_call(USDC, sel("balanceOf(address)") + waddr(a)), 16)

def v_get_payment(pid: str):
    d = bytes.fromhex(eth_call(V2, sel("getPayment(bytes32)") + wb32(pid))[2:])
    return {"status": int.from_bytes(d[0:32], "big"),
            "seller": "0x" + d[44:64].hex(),
            "amount": int.from_bytes(d[64:96], "big"),
            "termsHash": "0x" + d[96:128].hex()}

def v_receipt(pid: str):
    d = bytes.fromhex(eth_call(V2, sel("receipts(bytes32)") + wb32(pid))[2:])
    w = [d[i:i+32] for i in range(0, 352, 32)]
    return {"termsHash": "0x" + w[0].hex(), "buyer": "0x" + w[1][12:].hex(),
            "seller": "0x" + w[2][12:].hex(), "amount": int.from_bytes(w[3], "big"),
            "deadline": int.from_bytes(w[4], "big"), "outputHash": "0x" + w[5].hex(),
            "attestedAt": int.from_bytes(w[6], "big"), "flagReasonHash": "0x" + w[7].hex(),
            "policyRef": "0x" + w[8].hex(), "fundingRef": "0x" + w[9].hex(),
            "status": int.from_bytes(w[10], "big")}

def v_disputes(seller):
    return int(eth_call(V2, sel("disputes(address)") + waddr(seller)), 16)

STATUS = {0: "NONE", 1: "OPEN", 2: "ATTESTED", 3: "CAPTURED", 4: "VOIDED", 5: "FLAGGED"}

if __name__ == "__main__":
    print("module loaded ok")
