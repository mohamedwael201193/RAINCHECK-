// RAINCHECK tx builders — src/lib/tx.ts
//
// ZERO-DEPENDENCY. No viem/ethers import: the frontend's node_modules has a
// broken partial viem install, and these builders must work regardless. All
// crypto (keccak256, sha256) and ABI/EIP-712 encoding is implemented below and
// verified against test vectors (see the self-test at the bottom of this file).
//
// Every on-chain action is Memo-wrapped per build-bible §4.2 / §9.1:
//   memo(target, callData, memoId, memoData) on
//   0x5294E9927c3306DcBaDb03fe70b92e01cCede505
// The Memo contract REVERTS under eth_call / eth_estimateGas, so every builder
// sets a MANUAL gas limit (bible §9.1) — never eth_estimateGas.
//
// Each builder returns the EXACT calldata that will be sent; the UI previews it
// before signing. Nothing here touches the network or any secret.
//
// User-facing strings follow design-standard §7.8 (vocabulary): plain user
// words on screen; technical detail rides along separately for a collapsible
// debug element. No implementation jargon in copy.
//
// Consumed by: hooks/useTx.ts (send + wait) and the F5/F6 product flows.

export type Hex = `0x${string}`;
export type Address = `0x${string}`;

// ---------------------------------------------------------------- addresses

export const CHAIN_ID = 5042;
export const ARC_RPC_URL = "https://rpc.mainnet.arc.io";
export const ARC_EXPLORER = "https://explorer.arc.io";

// RaincheckEscrow PRODUCTION V1 (contracts/deployments/arc-5042.json,
// Sourcify exact_match, block 25956323).
export const ESCROW_ADDRESS = "0x97f233865ae84DC7475F6D7CA404930654580CB5" as Address;
// RaincheckEscrow PRODUCTION V1 EURC instance (contracts/deployments/
// arc-5042.json -> eurcEscrow, Sourcify exact_match, block 25962288).
// SAME V1 source — constructor arg changed to EURC only. Multi-asset = one
// escrow instance per token.
export const ESCROW_ADDRESS_EURC = "0x3ceba2fbeb27162bfc4888f6b61e48bd359c1e0a" as Address;

/**
 * RaincheckEscrowV2 — EXPERIMENTAL instance (Sourcify exact_match, Arc 5042).
 * USDC-only. The app may authorize on V2 ONLY through buildAuthorizeV2 below,
 * which targets the exact 7-parameter signature from
 * contracts/src/RaincheckEscrowV2.sol:
 *   authorize(bytes32,bytes32,address,uint256,uint256,bytes32,bytes32)
 * (paymentId, termsHash, seller, amount, deadline, policyRef, fundingRef).
 */
export const V2_ESCROW_ADDRESS =
  "0x3795b865f7fc84a14ab60456be9fc6dd0cb56f0c" as Address;
export const MEMO_ADDRESS = "0x5294E9927c3306DcBaDb03fe70b92e01cCede505" as Address;
export const USDC_ADDRESS = "0x3600000000000000000000000000000000000000" as Address;
/** Arc EURC — ERC-20 face (6 decimals), the EURC escrow's token. */
export const EURC_ADDRESS = "0xbEf5f6d51CB62b58e6A8f77868681825C6fe21c1" as Address;

/** Payment-token symbol for a token contract address (both are 6-decimal). */
export function tokenSymbolForAddress(token: string): "USDC" | "EURC" {
  return token.toLowerCase() === EURC_ADDRESS.toLowerCase() ? "EURC" : "USDC";
}

/** Payment-token symbol for an escrow instance address (module-private;
 *  the app-level config map lives in lib/chain.ts). */
function tokenSymbolForEscrowAddr(escrow: string): "USDC" | "EURC" {
  return escrow.toLowerCase() === ESCROW_ADDRESS_EURC.toLowerCase() ? "EURC" : "USDC";
}

/** Manual gas limits (bible §9.1). Measured mainnet costs sit comfortably below. */
export const GAS_LIMITS = {
  authorize: 250_000n,
  // 7-param authorize writes 2 extra storage slots (policyRef, fundingRef):
  // measured 249,066 on mainnet (evidence/e2e-v2/PROOFS.md) — 300k headroom.
  authorizeV2: 300_000n,
  attestDelivery: 150_000n,
  capture: 120_000n,
  flagNonDelivery: 120_000n,
  void: 120_000n,
  voidAfterDeadline: 120_000n,
  approve: 120_000n,
} as const;

// ================================================================ byte utils

const HEX_RE = /^0x(?:[0-9a-fA-F]{2})*$/;
const ADDR_RE = /^0x[0-9a-fA-F]{40}$/;
const B32_RE = /^0x[0-9a-fA-F]{64}$/;

export function isHex(v: unknown): v is Hex {
  return typeof v === "string" && HEX_RE.test(v);
}

export function isAddress(v: unknown): v is Address {
  return typeof v === "string" && ADDR_RE.test(v);
}

function hexToBytes(hex: string): Uint8Array {
  const h = hex.startsWith("0x") ? hex.slice(2) : hex;
  if (h.length % 2 !== 0) throw new Error(`odd-length hex: ${hex.slice(0, 20)}…`);
  const out = new Uint8Array(h.length / 2);
  for (let i = 0; i < out.length; i++) {
    const b = parseInt(h.slice(i * 2, i * 2 + 2), 16);
    if (Number.isNaN(b)) throw new Error(`invalid hex: ${hex.slice(0, 20)}…`);
    out[i] = b;
  }
  return out;
}

function bytesToHex(bytes: Uint8Array): Hex {
  let s = "0x";
  for (let i = 0; i < bytes.length; i++) s += bytes[i].toString(16).padStart(2, "0");
  return s as Hex;
}

function concatBytes(parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

function utf8Bytes(s: string): Uint8Array {
  return new TextEncoder().encode(s);
}

function utf8FromBytes(bytes: Uint8Array): string {
  return new TextDecoder().decode(bytes);
}

// ================================================================ keccak256
// Ethereum keccak256 (Keccak-f[1600], pad 0x01). Verified against the
// reference vectors keccak("") and keccak("hello") / keccak("abc").

const KECCAK_RC = [
  0x0000000000000001n, 0x0000000000008082n, 0x800000000000808an,
  0x8000000080008000n, 0x000000000000808bn, 0x0000000080000001n,
  0x8000000080008081n, 0x8000000000008009n, 0x000000000000008an,
  0x0000000000000088n, 0x0000000080008009n, 0x000000008000000an,
  0x000000008000808bn, 0x800000000000008bn, 0x8000000000008089n,
  0x8000000000008003n, 0x8000000000008002n, 0x8000000000000080n,
  0x000000000000800an, 0x800000008000000an, 0x8000000080008081n,
  0x8000000000008080n, 0x0000000080000001n, 0x8000000080008008n,
];
const KECCAK_ROTC = [
  0, 1, 62, 28, 27, 36, 44, 6, 55, 20, 3, 10, 43, 25, 39, 41, 45, 15, 21, 8, 18, 2,
  61, 56, 14,
];
const MASK64 = (1n << 64n) - 1n;

function rotl64(x: bigint, n: number): bigint {
  const s = BigInt(n % 64);
  return s === 0n ? x & MASK64 : (((x << s) | (x >> (64n - s))) & MASK64);
}

function keccakF1600(A: bigint[]): void {
  const C = new Array<bigint>(5);
  const D = new Array<bigint>(5);
  const B = new Array<bigint>(25);
  for (let round = 0; round < 24; round++) {
    for (let x = 0; x < 5; x++) C[x] = A[x] ^ A[x + 5] ^ A[x + 10] ^ A[x + 15] ^ A[x + 20];
    for (let x = 0; x < 5; x++) D[x] = C[(x + 4) % 5] ^ rotl64(C[(x + 1) % 5], 1);
    for (let x = 0; x < 5; x++)
      for (let y = 0; y < 5; y++) A[x + 5 * y] = (A[x + 5 * y] ^ D[x]) & MASK64;
    for (let x = 0; x < 5; x++)
      for (let y = 0; y < 5; y++)
        B[y + 5 * (((2 * x + 3 * y) % 5))] = rotl64(A[x + 5 * y], KECCAK_ROTC[x + 5 * y]);
    for (let x = 0; x < 5; x++)
      for (let y = 0; y < 5; y++)
        A[x + 5 * y] =
          (B[x + 5 * y] ^ ((~B[((x + 1) % 5) + 5 * y] & MASK64) & B[((x + 2) % 5) + 5 * y])) &
          MASK64;
    A[0] = (A[0] ^ KECCAK_RC[round]) & MASK64;
  }
}

function keccak256Bytes(msg: Uint8Array): Uint8Array {
  const rate = 136;
  const A = new Array<bigint>(25).fill(0n);
  const paddedLen = Math.ceil((msg.length + 1) / rate) * rate;
  const p = new Uint8Array(paddedLen);
  p.set(msg);
  p[msg.length] ^= 0x01;
  p[paddedLen - 1] ^= 0x80;
  for (let off = 0; off < paddedLen; off += rate) {
    for (let i = 0; i < rate / 8; i++) {
      let lane = 0n;
      for (let b = 0; b < 8; b++) lane |= BigInt(p[off + i * 8 + b]) << BigInt(8 * b);
      A[i] = (A[i] ^ lane) & MASK64;
    }
    keccakF1600(A);
  }
  const out = new Uint8Array(32);
  for (let i = 0; i < 4; i++) {
    let lane = A[i];
    for (let b = 0; b < 8; b++) {
      out[i * 8 + b] = Number(lane & 0xffn);
      lane >>= 8n;
    }
  }
  return out;
}

export function keccak256(data: Hex | Uint8Array | string): Hex {
  const bytes =
    typeof data === "string"
      ? data.startsWith("0x")
        ? hexToBytes(data)
        : utf8Bytes(data)
      : data;
  return bytesToHex(keccak256Bytes(bytes));
}

// =================================================================== sha256
// Standard FIPS 180-4 SHA-256. Verified against node:crypto test vectors.

const SHA256_K = [
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1,
  0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3,
  0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786,
  0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147,
  0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
  0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b,
  0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a,
  0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
  0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
];

function rotr32(x: number, n: number): number {
  return (x >>> n) | (x << (32 - n));
}

function sha256Bytes(msg: Uint8Array): Uint8Array {
  const H = [
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a,
    0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
  ];
  const ml = msg.length;
  const bitLenHi = Math.floor(ml / 0x20000000);
  const bitLenLo = (ml << 3) >>> 0;
  const paddedLen = Math.ceil((ml + 9) / 64) * 64;
  const p = new Uint8Array(paddedLen);
  p.set(msg);
  p[ml] = 0x80;
  const dv = new DataView(p.buffer);
  dv.setUint32(paddedLen - 8, bitLenHi);
  dv.setUint32(paddedLen - 4, bitLenLo);
  const w = new Array<number>(64);
  for (let off = 0; off < paddedLen; off += 64) {
    for (let i = 0; i < 16; i++) w[i] = dv.getUint32(off + i * 4);
    for (let i = 16; i < 64; i++) {
      const s0 = rotr32(w[i - 15], 7) ^ rotr32(w[i - 15], 18) ^ (w[i - 15] >>> 3);
      const s1 = rotr32(w[i - 2], 17) ^ rotr32(w[i - 2], 19) ^ (w[i - 2] >>> 10);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) | 0;
    }
    let a = H[0], b = H[1], c = H[2], d = H[3];
    let e = H[4], f = H[5], g = H[6], h = H[7];
    for (let i = 0; i < 64; i++) {
      const S1 = rotr32(e, 6) ^ rotr32(e, 11) ^ rotr32(e, 25);
      const ch = (e & f) ^ (~e & g);
      const t1 = (h + S1 + ch + SHA256_K[i] + w[i]) | 0;
      const S0 = rotr32(a, 2) ^ rotr32(a, 13) ^ rotr32(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const t2 = (S0 + maj) | 0;
      h = g; g = f; f = e; e = (d + t1) | 0;
      d = c; c = b; b = a; a = (t1 + t2) | 0;
    }
    H[0] = (H[0] + a) | 0; H[1] = (H[1] + b) | 0;
    H[2] = (H[2] + c) | 0; H[3] = (H[3] + d) | 0;
    H[4] = (H[4] + e) | 0; H[5] = (H[5] + f) | 0;
    H[6] = (H[6] + g) | 0; H[7] = (H[7] + h) | 0;
  }
  const out = new Uint8Array(32);
  const odv = new DataView(out.buffer);
  for (let i = 0; i < 8; i++) odv.setUint32(i * 4, H[i] >>> 0);
  return out;
}

export function sha256(data: Hex | Uint8Array | string): Hex {
  const bytes =
    typeof data === "string"
      ? data.startsWith("0x")
        ? hexToBytes(data)
        : utf8Bytes(data)
      : data;
  return bytesToHex(sha256Bytes(bytes));
}

// ============================================================ ABI encoding
// Supports the types this file needs: address, uint256/uint64, bytes32,
// bytes, string. Function selectors = first 4 bytes of keccak256(signature).

function padLeft32(bytes: Uint8Array): Uint8Array {
  if (bytes.length > 32) throw new Error("value exceeds 32 bytes");
  const out = new Uint8Array(32);
  out.set(bytes, 32 - bytes.length);
  return out;
}

function padRight32(bytes: Uint8Array): Uint8Array {
  const len = Math.ceil(bytes.length / 32) * 32;
  const out = new Uint8Array(len || 32);
  out.set(bytes);
  return out;
}

function encodeUint(v: bigint | number | string): Uint8Array {
  const b = BigInt(v);
  if (b < 0n) throw new Error("uint cannot be negative");
  if (b >= 1n << 256n) throw new Error("uint exceeds 256 bits");
  const out = new Uint8Array(32);
  let x = b;
  for (let i = 31; i >= 0; i--) {
    out[i] = Number(x & 0xffn);
    x >>= 8n;
  }
  return out;
}

function encodeAddressValue(a: string): Uint8Array {
  if (!isAddress(a)) throw new Error(`not an address: ${String(a).slice(0, 24)}…`);
  return padLeft32(hexToBytes(a));
}

function encodeBytes32Value(h: string): Uint8Array {
  if (!B32_RE.test(h)) throw new Error(`not bytes32: ${String(h).slice(0, 24)}…`);
  return hexToBytes(h);
}

type AbiValue = bigint | number | string | Uint8Array;

function isDynamicType(t: string): boolean {
  return t === "bytes" || t === "string";
}

function encodeStatic(t: string, v: AbiValue): Uint8Array {
  if (t === "address") return encodeAddressValue(String(v));
  if (t === "uint256" || t === "uint64" || t === "uint") return encodeUint(v as bigint);
  if (t === "bytes32") return encodeBytes32Value(String(v));
  throw new Error(`unsupported static type: ${t}`);
}

function encodeDynamic(t: string, v: AbiValue): Uint8Array {
  const bytes = t === "string" ? utf8Bytes(String(v)) : (v as Uint8Array);
  return concatBytes([encodeUint(bytes.length), padRight32(bytes)]);
}

/** Encode a function call: selector + head/tail ABI encoding. */
export function encodeFunctionCall(
  signature: string,
  argTypes: string[],
  args: AbiValue[],
): Hex {
  if (argTypes.length !== args.length) throw new Error("argTypes/args length mismatch");
  const selector = keccak256Bytes(utf8Bytes(signature)).slice(0, 4);
  const heads: Uint8Array[] = [];
  const tails: Uint8Array[] = [];
  let dynOffset = argTypes.length * 32;
  for (let i = 0; i < argTypes.length; i++) {
    const t = argTypes[i];
    if (isDynamicType(t)) {
      heads.push(encodeUint(dynOffset));
      const tail = encodeDynamic(t, args[i]);
      tails.push(tail);
      dynOffset += tail.length;
    } else {
      heads.push(encodeStatic(t, args[i]));
    }
  }
  return bytesToHex(concatBytes([selector, ...heads, ...tails]));
}

// ================================================================ EIP-712
// Minimal typed-data encoder for the structs this file signs.
// Supports: address, uint256/uint64, bytes32, string, nested structs.

export interface TypedField {
  name: string;
  type: string;
}
export type TypesMap = Record<string, TypedField[]>;

const EIP712_DOMAIN_TYPES: TypesMap = {
  EIP712Domain: [
    { name: "name", type: "string" },
    { name: "version", type: "string" },
    { name: "chainId", type: "uint256" },
    { name: "verifyingContract", type: "address" },
  ],
};

function findDependencies(
  primaryType: string,
  types: TypesMap,
  found: Set<string> = new Set(),
): Set<string> {
  if (found.has(primaryType)) return found;
  const fields = types[primaryType];
  if (!fields) throw new Error(`unknown EIP-712 type: ${primaryType}`);
  found.add(primaryType);
  for (const f of fields) {
    if (types[f.type]) findDependencies(f.type, types, found);
  }
  return found;
}

function encodeType(primaryType: string, types: TypesMap): string {
  const deps = [...findDependencies(primaryType, types)];
  deps.sort((a, b) => (a === primaryType ? -1 : b === primaryType ? 1 : a.localeCompare(b)));
  return deps
    .map((t) => `${t}(${types[t].map((f) => `${f.type} ${f.name}`).join(",")})`)
    .join("");
}

function typeHash(primaryType: string, types: TypesMap): Uint8Array {
  return keccak256Bytes(utf8Bytes(encodeType(primaryType, types)));
}

function encodeFieldValue(
  fieldType: string,
  value: unknown,
  types: TypesMap,
): Uint8Array {
  if (types[fieldType]) {
    return encodeDataHash(fieldType, types, value as Record<string, unknown>);
  }
  switch (fieldType) {
    case "address":
      return encodeAddressValue(String(value));
    case "uint256":
    case "uint64":
    case "uint":
      return encodeUint(value as bigint);
    case "bytes32":
      return encodeBytes32Value(String(value));
    case "string":
      return keccak256Bytes(utf8Bytes(String(value)));
    case "bytes":
      return keccak256Bytes(value as Uint8Array);
    default:
      throw new Error(`unsupported EIP-712 field type: ${fieldType}`);
  }
}

function encodeDataHash(
  primaryType: string,
  types: TypesMap,
  message: Record<string, unknown>,
): Uint8Array {
  const parts: Uint8Array[] = [typeHash(primaryType, types)];
  for (const f of types[primaryType]) {
    if (!(f.name in message)) throw new Error(`missing EIP-712 field: ${f.name}`);
    parts.push(encodeFieldValue(f.type, message[f.name], types));
  }
  return keccak256Bytes(concatBytes(parts));
}

/** EIP-712 digest: keccak256(0x1901 ‖ domainSeparator ‖ structHash(message)). */
export function hashEIP712(
  domain: Record<string, unknown>,
  types: TypesMap,
  primaryType: string,
  message: Record<string, unknown>,
): Hex {
  const allTypes = { ...EIP712_DOMAIN_TYPES, ...types };
  const domainSeparator = encodeDataHash("EIP712Domain", allTypes, domain);
  const structHash = encodeDataHash(primaryType, allTypes, message);
  return bytesToHex(keccak256Bytes(concatBytes([new Uint8Array([0x19, 0x01]), domainSeparator, structHash])));
}

// ============================================================ tx plumbing

export type TxKind =
  | "approve"
  | "authorize"
  | "attestDelivery"
  | "capture"
  | "flagNonDelivery"
  | "void"
  | "voidAfterDeadline"
  | "cctpBurn";

/** A fully-built transaction: exact calldata, manual gas limit, memo metadata. */
export interface BuiltTx {
  kind: TxKind;
  /** Outer tx target — always the Memo contract for state transitions. */
  to: Address;
  /** The EXACT bytes that go on the wire. UI previews this. */
  data: Hex;
  /** Manual gas limit — never estimated (bible §9.1). */
  gas: bigint;
  /** Inner call this Memo wraps (same data minus the memo envelope). */
  innerTarget: Address;
  innerCalldata: Hex;
  memoId: Hex;
  memoData: string;
  /** Human-readable one-liner for the UI confirm screen (user words, §7.8). */
  description: string;
  /** Raw JSON stored in the memo (public on-chain; never secret data). */
  memoJson: Record<string, unknown>;
}

// ----------------------------------------------------------------- helpers

function requireBytes32(name: string, v: unknown): Hex {
  if (typeof v !== "string" || !B32_RE.test(v))
    throw new Error(`${name} must be a 0x-prefixed 32-byte hex string`);
  return v as Hex;
}

function requireAddress(name: string, v: unknown): Address {
  if (!isAddress(v))
    throw new Error(`${name} must be a valid Ethereum address`);
  return v as Address;
}

function requirePositiveBigint(name: string, v: unknown): bigint {
  const b = typeof v === "bigint" ? v : BigInt(String(v));
  if (b <= 0n) throw new Error(`${name} must be greater than zero`);
  return b;
}

/** keccak256("raincheck:<label>:v1") — memoId convention, bible §4.2. */
export function memoIdFor(label: string): Hex {
  return keccak256(utf8Bytes(`raincheck:${label}:v1`));
}

function shortId(id: Hex): string {
  return `${id.slice(0, 10)}…`;
}

/**
 * Wrap an inner call in memo(target, callData, memoId, memoData).
 * memoData must be <= 1 KB (Memo contract hard constraint).
 */
export function wrapInMemo(
  kind: TxKind,
  innerTarget: Address,
  innerCalldata: Hex,
  label: string,
  memoJson: Record<string, unknown>,
  gas: bigint,
  description: string,
): BuiltTx {
  const memoData = JSON.stringify(memoJson);
  const memoBytes = utf8Bytes(memoData);
  if (memoBytes.length > 1024)
    throw new Error(`memo data ${memoBytes.length} bytes exceeds the 1 KB Memo limit`);
  const memoId = memoIdFor(label);
  const data = encodeFunctionCall(
    "memo(address,bytes,bytes32,bytes)",
    ["address", "bytes", "bytes32", "bytes"],
    [innerTarget, hexToBytes(innerCalldata), memoId, memoBytes],
  );
  return {
    kind,
    to: MEMO_ADDRESS,
    data,
    gas,
    innerTarget,
    innerCalldata,
    memoId,
    memoData,
    description,
    memoJson,
  };
}

/** Random fresh paymentId (32 random bytes). */
export function randomPaymentId(): Hex {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return bytesToHex(bytes);
}

/** USDC base units (6 decimals) from a decimal string like "1.50". */
export function usdcToBase(amount: string | number): bigint {
  const s = String(amount).trim();
  if (!/^\d+(\.\d{1,6})?$/.test(s)) throw new Error(`bad USDC amount: ${s}`);
  const [w, f = ""] = s.split(".");
  return BigInt(w) * 1_000_000n + BigInt(f.padEnd(6, "0"));
}

/** 6-decimal USDC base units → display string. */
export function baseToUsdc(base: bigint): string {
  const neg = base < 0n;
  const abs = neg ? -base : base;
  const whole = abs / 1_000_000n;
  const frac = (abs % 1_000_000n).toString().padStart(6, "0").replace(/0+$/, "");
  return `${neg ? "-" : ""}${whole.toString()}${frac ? "." + frac : ""}`;
}

// ----------------------------------------------------------------- builders

/** Step 0: approve the escrow to pull the payment token. Memo-wrapped like everything else. */
export function buildApprove(
  amount: bigint | string | number,
  opts?: { escrow?: Address; token?: Address },
): BuiltTx {
  const a = requirePositiveBigint("amount", amount);
  const escrow = opts?.escrow ?? ESCROW_ADDRESS;
  const token = opts?.token ?? USDC_ADDRESS;
  const symbol = tokenSymbolForAddress(token);
  const inner = encodeFunctionCall("approve(address,uint256)", ["address", "uint256"], [
    escrow,
    a,
  ]);
  return wrapInMemo(
    "approve",
    token,
    inner,
    "approve",
    {
      spec: "raincheck-receipt/v1",
      action: "approve",
      token,
      spender: escrow,
      amount: a.toString(),
      note: `${symbol} approval for the RaincheckEscrow pull on authorize()`,
    },
    GAS_LIMITS.approve,
    `Let the receipt pull ${baseToUsdc(a)} ${symbol} from your wallet`,
  );
}

export function buildAuthorize(
  paymentId: Hex | string,
  termsHash: Hex | string,
  seller: string,
  amount: bigint | string | number,
  deadline: number | bigint,
  escrow: Address = ESCROW_ADDRESS,
): BuiltTx {
  const pid = requireBytes32("paymentId", paymentId);
  const th = requireBytes32("termsHash", termsHash);
  const s = requireAddress("seller", seller);
  const a = requirePositiveBigint("amount", amount);
  const dl = BigInt(deadline);
  const now = BigInt(Math.floor(Date.now() / 1000));
  if (dl <= now)
    throw new Error(
      `deadline is not in the future — the contract will reject this (deadline not in future)`,
    );
  const inner = encodeFunctionCall(
    "authorize(bytes32,bytes32,address,uint256,uint256)",
    ["bytes32", "bytes32", "address", "uint256", "uint256"],
    [pid, th, s, a, dl],
  );
  const symbol = tokenSymbolForEscrowAddr(escrow);
  return wrapInMemo(
    "authorize",
    escrow,
    inner,
    "authorize",
    {
      spec: "raincheck-receipt/v1",
      action: "authorize",
      paymentId: pid,
      termsHash: th,
      seller: s,
      amount: a.toString(),
      deadline: dl.toString(),
      note: `Buyer locks ${symbol} in escrow; receipt state -> OPEN`,
    },
    GAS_LIMITS.authorize,
    `Create the receipt and lock ${baseToUsdc(a)} ${symbol} · ${shortId(pid)}`,
  );
}

/**
 * buildAuthorizeV2 — authorize on the experimental V2 escrow with the exact
 * 7-parameter signature from contracts/src/RaincheckEscrowV2.sol:
 *   authorize(bytes32 paymentId, bytes32 termsHash, address seller,
 *             uint256 amount, uint256 deadline,
 *             bytes32 policyRef, bytes32 fundingRef)
 *
 * policyRef / fundingRef are trust-stack composition refs; zeroed = standalone
 * behavior identical to V1. Accepts ""/undefined as zeroed. V2 is USDC-only;
 * the memo spec is "raincheck-receipt/v2".
 */
export function buildAuthorizeV2(
  paymentId: Hex | string,
  termsHash: Hex | string,
  seller: string,
  amount: bigint | string | number,
  deadline: number | bigint,
  policyRef: Hex | string = "0x0000000000000000000000000000000000000000000000000000000000000000",
  fundingRef: Hex | string = "0x0000000000000000000000000000000000000000000000000000000000000000",
  escrow: Address = V2_ESCROW_ADDRESS,
): BuiltTx {
  const pid = requireBytes32("paymentId", paymentId);
  const th = requireBytes32("termsHash", termsHash);
  const s = requireAddress("seller", seller);
  const a = requirePositiveBigint("amount", amount);
  const dl = BigInt(deadline);
  const now = BigInt(Math.floor(Date.now() / 1000));
  if (dl <= now)
    throw new Error(
      `deadline is not in the future — the contract will reject this (deadline not in future)`,
    );
  const pr =
    policyRef === ""
      ? "0x0000000000000000000000000000000000000000000000000000000000000000"
      : requireBytes32("policyRef", policyRef);
  const fr =
    fundingRef === ""
      ? "0x0000000000000000000000000000000000000000000000000000000000000000"
      : requireBytes32("fundingRef", fundingRef);
  const inner = encodeFunctionCall(
    "authorize(bytes32,bytes32,address,uint256,uint256,bytes32,bytes32)",
    ["bytes32", "bytes32", "address", "uint256", "uint256", "bytes32", "bytes32"],
    [pid, th, s, a, dl, pr, fr],
  );
  return wrapInMemo(
    "authorize",
    escrow,
    inner,
    "authorize-v2",
    {
      spec: "raincheck-receipt/v2",
      action: "authorize",
      protocol: "v2",
      experimental: true,
      paymentId: pid,
      termsHash: th,
      seller: s,
      amount: a.toString(),
      deadline: dl.toString(),
      policyRef: pr,
      fundingRef: fr,
      note: `Buyer locks USDC in the EXPERIMENTAL V2 escrow; receipt state -> OPEN. V2 is unaudited.`,
    },
    GAS_LIMITS.authorizeV2,
    `Create the receipt on V2 (experimental) and lock ${baseToUsdc(a)} USDC · ${shortId(pid)}`,
  );
}

export function buildAttestDelivery(
  paymentId: Hex | string,
  outputHash: Hex | string,
  escrow: Address = ESCROW_ADDRESS,
): BuiltTx {
  const pid = requireBytes32("paymentId", paymentId);
  const oh = requireBytes32("outputHash", outputHash);
  const inner = encodeFunctionCall(
    "attestDelivery(bytes32,bytes32)",
    ["bytes32", "bytes32"],
    [pid, oh],
  );
  return wrapInMemo(
    "attestDelivery",
    escrow,
    inner,
    "attest",
    {
      spec: "raincheck-receipt/v1",
      action: "attestDelivery",
      paymentId: pid,
      outputHash: oh,
      note: "Seller attests delivery; challenge window opens; receipt state -> ATTESTED",
    },
    GAS_LIMITS.attestDelivery,
    `Confirm the delivery · receipt ${shortId(pid)}`,
  );
}

export function buildCapture(paymentId: Hex | string, escrow: Address = ESCROW_ADDRESS): BuiltTx {
  const pid = requireBytes32("paymentId", paymentId);
  const inner = encodeFunctionCall("capture(bytes32)", ["bytes32"], [pid]);
  const symbol = tokenSymbolForEscrowAddr(escrow);
  return wrapInMemo(
    "capture",
    escrow,
    inner,
    "capture",
    {
      spec: "raincheck-receipt/v1",
      action: "capture",
      paymentId: pid,
      note: `Permissionless finalization: challenge window passed, ${symbol} paid to seller`,
    },
    GAS_LIMITS.capture,
    `Release the payment to the seller · receipt ${shortId(pid)}`,
  );
}

export function buildFlagNonDelivery(
  paymentId: Hex | string,
  reasonHash: Hex | string,
  escrow: Address = ESCROW_ADDRESS,
): BuiltTx {
  const pid = requireBytes32("paymentId", paymentId);
  const rh = requireBytes32("reasonHash", reasonHash);
  const inner = encodeFunctionCall(
    "flagNonDelivery(bytes32,bytes32)",
    ["bytes32", "bytes32"],
    [pid, rh],
  );
  return wrapInMemo(
    "flagNonDelivery",
    escrow,
    inner,
    "flag",
    {
      spec: "raincheck-receipt/v1",
      action: "flagNonDelivery",
      paymentId: pid,
      reasonHash: rh,
      note: "Buyer disputes delivery inside the challenge window; receipt state -> FLAGGED",
    },
    GAS_LIMITS.flagNonDelivery,
    `Dispute the delivery · receipt ${shortId(pid)}`,
  );
}

export function buildVoid(paymentId: Hex | string, escrow: Address = ESCROW_ADDRESS): BuiltTx {
  const pid = requireBytes32("paymentId", paymentId);
  const inner = encodeFunctionCall("void(bytes32)", ["bytes32"], [pid]);
  const symbol = tokenSymbolForEscrowAddr(escrow);
  return wrapInMemo(
    "void",
    escrow,
    inner,
    "void",
    {
      spec: "raincheck-receipt/v1",
      action: "void",
      paymentId: pid,
      note: `Permissionless: flagged receipt, full ${symbol} refund to buyer`,
    },
    GAS_LIMITS.void,
    `Refund the buyer · receipt ${shortId(pid)}`,
  );
}

export function buildVoidAfterDeadline(
  paymentId: Hex | string,
  escrow: Address = ESCROW_ADDRESS,
): BuiltTx {
  const pid = requireBytes32("paymentId", paymentId);
  const inner = encodeFunctionCall("voidAfterDeadline(bytes32)", ["bytes32"], [pid]);
  const symbol = tokenSymbolForEscrowAddr(escrow);
  return wrapInMemo(
    "voidAfterDeadline",
    escrow,
    inner,
    "void-deadline",
    {
      spec: "raincheck-receipt/v1",
      action: "voidAfterDeadline",
      paymentId: pid,
      note: `Permissionless: seller never attested by deadline, full ${symbol} refund to buyer`,
    },
    GAS_LIMITS.voidAfterDeadline,
    `Refund the buyer — the deadline passed · receipt ${shortId(pid)}`,
  );
}

/** Hash of a human/machine-readable reason → keccak256 for flagNonDelivery. */
export function reasonHash(reason: string): Hex {
  return keccak256(utf8Bytes(reason));
}

// ------------------------------------------------- EIP-712 (Privy snake_case)

/**
 * Arc workaround #2 (bible §9.1): Privy's EIP-712 endpoint expects
 * `primary_type` in snake_case, NOT `primaryType`. Every typed-data payload
 * below carries `primary_type`.
 */

export interface TermsInput {
  buyer: string;
  seller: string;
  /** Where the service is served (URL / resource id). */
  endpoint: string;
  /** Price in 6-decimal base units of the selected payment token (USDC/EURC). */
  price: bigint | string | number;
  /** Unix seconds — seller must attest by this time. */
  deadline: number | bigint;
}

export interface PrivyTypedData {
  domain: Record<string, unknown>;
  types: TypesMap;
  /** snake_case per Arc workaround #2 (NOT `primaryType`). */
  primary_type: string;
  message: Record<string, unknown>;
}

/** Canonical JSON (RFC 8785-style: sorted keys) → sha256 → lowercase hex. */
export function canonicalSha256(value: unknown): Hex {
  return sha256(utf8Bytes(JSON.stringify(sortKeys(value))));
}

function sortKeys(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(sortKeys);
  if (v !== null && typeof v === "object") {
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(v as Record<string, unknown>).sort())
      out[k] = sortKeys((v as Record<string, unknown>)[k]);
    return out;
  }
  return v;
}

/**
 * Compute the termsHash bound on-chain at authorize(): sha256 over the
 * canonical terms JSON. Must be identical for buyer and seller.
 */
export function computeTermsHash(terms: TermsInput): Hex {
  const buyer = requireAddress("buyer", terms.buyer);
  const seller = requireAddress("seller", terms.seller);
  const price = requirePositiveBigint("price", terms.price);
  const deadline = BigInt(terms.deadline);
  return canonicalSha256({
    buyer,
    seller,
    endpoint: String(terms.endpoint),
    price: price.toString(),
    deadline: deadline.toString(),
  });
}

const RAINCHECK_TERMS_TYPES: TypesMap = {
  RaincheckTerms: [
    { name: "buyer", type: "address" },
    { name: "seller", type: "address" },
    { name: "endpoint", type: "string" },
    { name: "price", type: "uint256" },
    { name: "deadline", type: "uint256" },
    { name: "termsHash", type: "bytes32" },
  ],
};

const DELIVERY_ATTESTATION_TYPES: TypesMap = {
  DeliveryAttestation: [
    { name: "paymentId", type: "bytes32" },
    { name: "termsHash", type: "bytes32" },
    { name: "outputHash", type: "bytes32" },
    { name: "artifactURI", type: "string" },
    { name: "attestedAt", type: "uint64" },
  ],
};

/**
 * Off-chain terms signature payload (no gas). Buyer signs this BEFORE
 * approve/authorize; the resulting termsHash is passed to buildAuthorize().
 * The domain's verifyingContract is the escrow instance the receipt will
 * open on (multi-asset) — defaults to the USDC production escrow.
 */
export function signTerms(
  terms: TermsInput,
  escrow: Address = ESCROW_ADDRESS,
): { typedData: PrivyTypedData; termsHash: Hex } {
  const buyer = requireAddress("buyer", terms.buyer);
  const seller = requireAddress("seller", terms.seller);
  const price = requirePositiveBigint("price", terms.price);
  const deadline = BigInt(terms.deadline);
  const termsHash = computeTermsHash(terms);
  return {
    termsHash,
    typedData: {
      domain: {
        name: "Raincheck Terms",
        version: "1",
        chainId: CHAIN_ID,
        verifyingContract: escrow,
      },
      types: RAINCHECK_TERMS_TYPES,
      primary_type: "RaincheckTerms",
      message: {
        buyer,
        seller,
        endpoint: String(terms.endpoint),
        price: price.toString(),
        deadline: deadline.toString(),
        termsHash,
      },
    },
  };
}

/** EIP-712 digest of a snake_case PrivyTypedData payload (for verification). */
export function typedDataDigest(td: PrivyTypedData): Hex {
  return hashEIP712(td.domain, td.types, td.primary_type, td.message);
}

export interface DeliveryAttestationInput {
  paymentId: Hex | string;
  termsHash: Hex | string;
  /** sha256 of the EXACT delivered bytes. */
  outputHash: Hex | string;
  /** Where the delivered bytes live (URL / content ref). */
  artifactURI: string;
  /** Unix seconds the seller made the claim. */
  attestedAt: number | bigint;
}

/**
 * EIP-712 DeliveryAttestation (bible §4.4) — structured off-chain oracle
 * evidence. Domain: { name: "Raincheck Delivery Attestation", version: "1",
 * chainId: 5042, verifyingContract: <escrow> }. The attestation MUST reference
 * the same paymentId+termsHash bound on-chain at authorize().
 */
export function buildDeliveryAttestation(
  att: DeliveryAttestationInput,
  escrow: Address = ESCROW_ADDRESS,
): { typedData: PrivyTypedData; digest: Hex } {
  const paymentId = requireBytes32("paymentId", att.paymentId);
  const termsHash = requireBytes32("termsHash", att.termsHash);
  const outputHash = requireBytes32("outputHash", att.outputHash);
  const typedData: PrivyTypedData = {
    domain: {
      name: "Raincheck Delivery Attestation",
      version: "1",
      chainId: CHAIN_ID,
      verifyingContract: escrow,
    },
    types: DELIVERY_ATTESTATION_TYPES,
    primary_type: "DeliveryAttestation",
    message: {
      paymentId,
      termsHash,
      outputHash,
      artifactURI: String(att.artifactURI),
      attestedAt: BigInt(att.attestedAt).toString(),
    },
  };
  return { typedData, digest: typedDataDigest(typedData) };
}

/** The typehash from bible §4.4 — sanity anchor for indexers/verifiers. */
export const DELIVERY_ATTESTATION_TYPEHASH: Hex = keccak256(
  "DeliveryAttestation(bytes32 paymentId,bytes32 termsHash,bytes32 outputHash,string artifactURI,uint64 attestedAt)",
);

// ----------------------------------------------------- revert explanations
// Design-standard §7.8: revert reasons surfaced to users are in USER WORDS.
// The technical detail (require string / raw data) is exposed separately for
// a collapsible debug element — never as headline copy.

/** The exact require strings in the verified RaincheckEscrow source. */
const KNOWN_REQUIRE_STRINGS = new Set([
  "paymentId already used",
  "seller zero",
  "amount zero",
  "deadline not in future",
  "transferFrom failed",
  "not OPEN",
  "seller only",
  "past deadline",
  "not ATTESTED",
  "challenge window open",
  "buyer only",
  "challenge window closed",
  "payout failed",
  "refund failed",
  "not FLAGGED",
  "deadline not passed",
]);

const REVERT_USER_WORDS: Record<string, string> = {
  "paymentId already used":
    "This receipt ID is already taken — nothing was charged. Start a fresh receipt.",
  "seller zero": "That seller address isn't valid. Check the address and try again.",
  "amount zero": "The amount has to be more than zero.",
  "deadline not in future": "That deadline has already passed — pick a later one.",
  "transferFrom failed":
    "Couldn't pull the money from the buyer's wallet. Approve this payment first and make sure there's enough USDC.",
  "not OPEN":
    "This receipt is closed or doesn't exist — this step isn't available right now.",
  "seller only": "Only the seller named on this receipt can confirm delivery.",
  "past deadline":
    "The delivery deadline passed before the seller confirmed. Anyone can now close this receipt and send the money back to the buyer.",
  "not ATTESTED": "The seller hasn't delivered yet.",
  "challenge window open":
    "The buyer still has time to check the delivery. The payment releases once that time is up.",
  "buyer only": "Only the buyer named on this receipt can dispute the delivery.",
  "challenge window closed":
    "The dispute window has closed — the delivery can no longer be disputed.",
  "payout failed": "The payment to the seller didn't go through.",
  "refund failed": "The refund to the buyer didn't go through.",
  "not FLAGGED":
    "This receipt wasn't disputed, so there's nothing to refund through a dispute.",
  "deadline not passed":
    "The deadline hasn't passed yet — the refund option unlocks after it.",
};

/** Per-action user-words overrides (same revert, different user meaning). */
const REVERT_USER_WORDS_BY_KIND: Partial<Record<TxKind, Record<string, string>>> = {
  capture: {
    "not OPEN": "There's no open receipt to finalize here.",
    "not ATTESTED": "There's no confirmed delivery yet — the payment can't be released.",
    "challenge window open":
      "The buyer still has time to check the delivery. The payment releases once that time is up.",
  },
  flagNonDelivery: {
    "not OPEN": "This receipt isn't open, so there's nothing to dispute.",
    "not ATTESTED": "The seller hasn't delivered yet — there's nothing to dispute.",
  },
  attestDelivery: {
    "not OPEN": "The receipt isn't open, so there's no delivery to confirm.",
  },
  void: {
    "not OPEN": "This receipt isn't open, so there's nothing to close out.",
  },
  voidAfterDeadline: {
    "not OPEN": "This receipt isn't open, so there's nothing to refund.",
  },
  authorize: {
    "transferFrom failed":
      "Couldn't pull the money from your wallet. Approve this payment first and make sure you hold enough USDC.",
  },
};

/**
 * The two faces of a revert (design-standard §7.8):
 * - `userMessage`: plain user words, safe to render directly in the UI.
 * - `technical`: the raw on-chain detail for a collapsible debug element.
 */
export interface RevertExplanation {
  userMessage: string;
  technical: string;
  /** The contract's exact require string when one was decoded, else null. */
  requireString: string | null;
}

const ERROR_STRING_SELECTOR = "0x08c379a0";
const PANIC_SELECTOR = "0x4e487b71";

const PANIC_REASONS: Record<string, string> = {
  "0x01": "assertion failed",
  "0x11": "arithmetic overflow or underflow",
  "0x12": "division or modulo by zero",
  "0x21": "invalid enum value",
  "0x22": "invalid storage byte array access",
  "0x31": "stack too deep",
  "0x32": "array out of bounds",
  "0x41": "out of memory",
  "0x51": "invalid function call",
};

/** Extract the raw require string from revert data (null when not decodable). */
function extractRequireString(data: Hex | string | null | undefined): string | null {
  if (!data || data === "0x" || data === "0X") return null;
  const d = String(data).toLowerCase();
  if (d.startsWith(ERROR_STRING_SELECTOR)) {
    try {
      // Layout after "0x": selector(8) + offset(64) + length(64) + utf8 bytes.
      const len = parseInt(d.slice(74, 138), 16);
      const bytes = d.slice(138, 138 + len * 2);
      return utf8FromBytes(hexToBytes("0x" + bytes)).replace(/\0+$/, "") || null;
    } catch {
      return null;
    }
  }
  return null;
}

/**
 * Decode raw revert data into its TECHNICAL form (require string, panic code,
 * or raw bytes). For user-facing copy use `explainRevert`; this is for the
 * collapsible debug details element.
 */
export function decodeRevertReason(data: Hex | string | null | undefined): string {
  if (!data || data === "0x" || data === "0X") return "reverted with no reason data";
  const d = String(data).toLowerCase();
  if (d.startsWith(ERROR_STRING_SELECTOR)) {
    const reason = extractRequireString(d);
    return reason ?? "reverted (could not decode the reason string)";
  }
  if (d.startsWith(PANIC_SELECTOR)) {
    const code = "0x" + d.slice(-2);
    const why = PANIC_REASONS[code] ?? "unknown panic";
    return `panic (${code}): ${why}`;
  }
  return `raw reason data: ${d.slice(0, 66)}…`;
}

/**
 * User-words explanation of a revert (design-standard §7.8).
 * Pass `kind` when known — the same revert reads differently depending on
 * which action the user was taking.
 */
export function explainRevert(
  data: Hex | string | null | undefined,
  kind?: TxKind,
): RevertExplanation {
  const technical = decodeRevertReason(data);
  const requireString = extractRequireString(data);
  let userMessage: string;
  if (requireString && KNOWN_REQUIRE_STRINGS.has(requireString)) {
    const override = kind ? REVERT_USER_WORDS_BY_KIND[kind]?.[requireString] : undefined;
    userMessage = override ?? REVERT_USER_WORDS[requireString];
  } else if (requireString) {
    userMessage = "The transaction didn't go through.";
  } else {
    userMessage = "The transaction didn't go through, and no reason was returned.";
  }
  return { userMessage, technical, requireString };
}

/** Build an Arc explorer link for a tx hash. */
export function explorerTxUrl(txHash: string): string {
  return `${ARC_EXPLORER}/tx/${txHash}`;
}
