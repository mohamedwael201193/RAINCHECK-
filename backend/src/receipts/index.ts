/**
 * RAINCHECK canonical receipts — bible §4.6.
 *
 *   buildReceipt(row)      indexer row  -> canonical receipt JSON (schema-exact)
 *   hashReceipt(receipt)   receipt      -> lowercase-hex SHA-256 of JCS(receipt)
 *   canonicalReceipt(r)    receipt      -> the JCS bytes that get hashed
 *   canonicalizeJson(v)    any JSON     -> RFC 8785 canonical string
 *
 * MERGE NOTE (B1/B2): ReceiptInput (types.ts) is the indexer's contract with
 * this module. If the indexer lands its own row types first, map them here —
 * the field set is exactly what §4.6 needs.
 */

export { canonicalizeJson } from "./jcs.js";
export {
  ANCHOR_CHAIN_REF,
  SPEC_VERSION,
  ReceiptError,
  buildReceipt,
  canonicalReceipt,
  hashReceipt,
} from "./receipt.js";
export type {
  Hex,
  RaincheckReceipt,
  ReceiptDelivery,
  ReceiptInput,
  ReceiptPaymentProof,
  ReceiptStatusName,
  ReceiptTerms,
} from "./types.js";
