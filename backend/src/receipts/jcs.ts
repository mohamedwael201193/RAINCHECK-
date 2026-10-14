/**
 * JCS (RFC 8785) JSON canonicalization for RAINCHECK receipts.
 *
 * Single implementation of record: backend/src/api/jcs.ts — a minimal
 * hand-rolled RFC 8785 subset covering exactly the JSON types receipts use
 * (strings, safe-integer numbers, null, arrays, objects). It is byte-identical
 * to the `canonicalize` npm package on receipt-shaped data (proven by the
 * golden receipt hashes in receipt.test.ts, which were independently verified
 * against that package before it was dropped) and fail-closed on anything
 * else (bigint, undefined, NaN, functions throw instead of hashing a lossy
 * representation).
 *
 * The public name `canonicalizeJson` is preserved so receipt.ts and
 * receipts/index.ts import unchanged.
 */
export { jcs as canonicalizeJson } from "../api/jcs.js";
