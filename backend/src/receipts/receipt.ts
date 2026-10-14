/**
 * RAINCHECK canonical receipt builder + hasher.
 *
 *   buildReceipt(row) -> RaincheckReceipt   (EXACTLY bible §4.6)
 *   hashReceipt(receipt) -> receiptHash     (lowercase-hex SHA-256 of JCS(receipt))
 *
 * Rules (hard):
 *  - No invented fields: every receipt field traces to the indexer row, which
 *    traces to chain (escrow events / tx records). hashReceipt() additionally
 *    rejects any receipt whose key set differs from the schema.
 *  - Canonical form lowercases all hex (addresses, hashes, signatures): the
 *    hash must be deterministic regardless of EIP-55 checksum casing in the
 *    input. Verifiers lowercase before comparing.
 *  - Amounts are 6-decimal base-unit INTEGER strings ("1000", never "1.5",
 *    never floats).
 *  - Never prints secrets: there are no secrets in receipts (all fields are
 *    on-chain/indexer data). Error messages truncate long values anyway.
 */

import { createHash } from "node:crypto";
import { canonicalizeJson } from "./jcs.js";
import type {
  Hex,
  RaincheckReceipt,
  ReceiptInput,
  ReceiptStatusName,
} from "./types.js";

/** Chain ref used in anchors: Arc mainnet. Never 5042002 (testnet). */
export const ANCHOR_CHAIN_REF = "eip155:5042";

export const SPEC_VERSION = "raincheck-receipt/v1" as const;

export class ReceiptError extends Error {
  constructor(message: string) {
    super(`receipt: ${message}`);
    this.name = "ReceiptError";
  }
}

/** Truncate long values in error messages (defense in depth; receipts hold no secrets). */
function trunc(v: unknown): string {
  const s = String(v);
  return s.length > 24 ? `${s.slice(0, 12)}…${s.slice(-8)}` : s;
}

function isHex(v: unknown): v is string {
  return typeof v === "string" && /^0x[0-9a-fA-F]+$/.test(v);
}

/** Validate 0x-hex and return the canonical lowercase form. */
function hexOf(field: string, value: unknown, bytes: number): string {
  if (!isHex(value)) {
    throw new ReceiptError(`${field} must be 0x-hex, got ${trunc(value)}`);
  }
  const hex = value.slice(2);
  if (hex.length !== bytes * 2) {
    throw new ReceiptError(
      `${field} must be ${bytes} bytes (${bytes * 2} hex chars), got ${hex.length} chars (${trunc(value)})`,
    );
  }
  return `0x${hex.toLowerCase()}`;
}

function paymentIdOf(value: unknown): string {
  return hexOf("paymentId", value, 32);
}

function txHashOf(field: string, value: unknown): string {
  return hexOf(field, value, 32);
}

function addressOf(field: string, value: unknown): string {
  return hexOf(field, value, 20);
}

/** 65-byte ECDSA signature (r || s || v-parity), 0x + 130 hex chars. */
function sig65Of(field: string, value: unknown): string {
  return hexOf(field, value, 65);
}

/** 6-decimal base-unit amount -> canonical integer decimal string. */
function baseUnitsOf(field: string, value: unknown): string {
  let n: bigint;
  if (typeof value === "bigint") {
    n = value;
  } else if (typeof value === "number") {
    if (!Number.isInteger(value)) {
      throw new ReceiptError(`${field} must be an integer number of base units, got ${value}`);
    }
    n = BigInt(value);
  } else if (typeof value === "string") {
    if (!/^(0|[1-9][0-9]*)$/.test(value)) {
      throw new ReceiptError(
        `${field} must be a non-negative integer base-unit string, got ${trunc(value)}`,
      );
    }
    n = BigInt(value);
  } else {
    throw new ReceiptError(`${field} must be bigint | number | string, got ${typeof value}`);
  }
  if (n < 0n) {
    throw new ReceiptError(`${field} must be non-negative, got ${n}`);
  }
  return n.toString(10);
}

/** Unix timestamp -> safe integer number. */
function unixTimeOf(field: string, value: unknown): number {
  let n: number;
  if (typeof value === "bigint") {
    if (value > BigInt(Number.MAX_SAFE_INTEGER)) {
      throw new ReceiptError(`${field} exceeds MAX_SAFE_INTEGER`);
    }
    n = Number(value);
  } else if (typeof value === "number") {
    n = value;
  } else {
    throw new ReceiptError(`${field} must be bigint | number, got ${typeof value}`);
  }
  if (!Number.isInteger(n) || n <= 0) {
    throw new ReceiptError(`${field} must be a positive integer unix timestamp, got ${trunc(value)}`);
  }
  return n;
}

const STATUS_NAMES: readonly ReceiptStatusName[] = ["OPEN", "ATTESTED", "CAPTURED", "VOIDED"];

function statusOf(value: unknown): ReceiptStatusName {
  if (typeof value !== "string" || !(STATUS_NAMES as readonly string[]).includes(value)) {
    throw new ReceiptError(`status must be one of ${STATUS_NAMES.join(" | ")}, got ${trunc(value)}`);
  }
  return value as ReceiptStatusName;
}

function endpointOf(value: unknown): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new ReceiptError("endpoint must be a non-empty string (from the terms payload hashed by termsHash)");
  }
  return value;
}

/** Format one anchor ref. Accepts a raw tx hash or an already-formatted ref. */
function anchorOf(value: unknown): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new ReceiptError(`anchor must be a tx hash or anchor ref, got ${trunc(value)}`);
  }
  if (value.startsWith(`${ANCHOR_CHAIN_REF}:`)) {
    const tx = value.slice(ANCHOR_CHAIN_REF.length + 1);
    return `${ANCHOR_CHAIN_REF}:${txHashOf("anchor", tx)}`;
  }
  return `${ANCHOR_CHAIN_REF}:${txHashOf("anchor", value)}`;
}

/** The exact schema key set — hashReceipt() rejects anything else. */
const SCHEMA_KEYS = [
  "specVersion",
  "paymentId",
  "paymentProof",
  "terms",
  "delivery",
  "oracle",
  "policy",
  "funding",
  "status",
  "anchors",
] as const;

function assertSchemaShape(receipt: unknown): asserts receipt is RaincheckReceipt {
  if (typeof receipt !== "object" || receipt === null) {
    throw new ReceiptError("receipt must be an object");
  }
  const keys = Object.keys(receipt).sort();
  const want = [...SCHEMA_KEYS].sort();
  if (keys.length !== want.length || keys.some((k, i) => k !== want[i])) {
    throw new ReceiptError(
      `receipt keys must be exactly the §4.6 schema [${want.join(", ")}], got [${keys.join(", ")}]`,
    );
  }
}

/**
 * Build the canonical receipt for one escrow payment from the indexer row.
 * Every field traces to chain/indexer data; oracle/policy/funding are null
 * in standalone v1 (T0-O not live).
 */
export function buildReceipt(row: ReceiptInput): RaincheckReceipt {
  if (typeof row !== "object" || row === null) {
    throw new ReceiptError("row must be an object");
  }

  const paymentId = paymentIdOf(row.paymentId);
  const settleTx = txHashOf("settleTx", row.settleTx);
  if (typeof row.authorizationState !== "boolean") {
    throw new ReceiptError(`authorizationState must be boolean, got ${trunc(row.authorizationState)}`);
  }
  const payer = addressOf("payer", row.payer);
  const amount = baseUnitsOf("amount", row.amount);
  const termsHash = hexOf("termsHash", row.termsHash, 32);
  const endpoint = endpointOf(row.endpoint);
  const price = baseUnitsOf("price", row.price);
  const deadline = unixTimeOf("deadline", row.deadline);
  const status = statusOf(row.status);

  if (typeof row.delivery !== "object" || row.delivery === null) {
    throw new ReceiptError("delivery must be an object");
  }
  let delivery: RaincheckReceipt["delivery"];
  let deliveryTx: string;
  if (row.delivery.kind === "attested") {
    delivery = {
      outputHash: hexOf("delivery.outputHash", row.delivery.outputHash, 32),
      attestedAt: unixTimeOf("delivery.attestedAt", row.delivery.attestedAt),
      sellerSig: sig65Of("delivery.sellerSig", row.delivery.sellerSig),
    };
    deliveryTx = txHashOf("delivery.attestedTx", row.delivery.attestedTx);
  } else if (row.delivery.kind === "flagged") {
    delivery = {
      nonDelivery: {
        flaggedBy: addressOf("delivery.flaggedBy", row.delivery.flaggedBy),
        reasonHash: hexOf("delivery.reasonHash", row.delivery.reasonHash, 32),
      },
    };
    deliveryTx = txHashOf("delivery.flaggedTx", row.delivery.flaggedTx);
  } else {
    throw new ReceiptError(
      `delivery.kind must be "attested" | "flagged", got ${trunc((row.delivery as { kind?: unknown }).kind)}`,
    );
  }

  if (!Array.isArray(row.anchorTxs)) {
    throw new ReceiptError("anchorTxs must be an array of tx hashes");
  }
  // Settle + delivery txs always anchor the receipt; caller-supplied extras
  // (Memo anchors, capture/void txs) follow. Dedupe, first-seen order.
  const seen = new Set<string>();
  const anchors: string[] = [];
  for (const raw of [settleTx, deliveryTx, ...row.anchorTxs]) {
    const a = anchorOf(raw);
    if (!seen.has(a)) {
      seen.add(a);
      anchors.push(a);
    }
  }

  return {
    specVersion: SPEC_VERSION,
    paymentId,
    paymentProof: {
      settleTx,
      authorizationState: row.authorizationState,
      payer,
      amount,
    },
    terms: {
      termsHash,
      endpoint,
      price,
      deadline,
    },
    delivery,
    oracle: null, // T0-O not live in v1 — §4.6
    policy: null, // trust-stack composition ref — null standalone
    funding: null, // trust-stack composition ref — null standalone
    status,
    anchors,
  };
}

/** JCS (RFC 8785) canonical JSON of a receipt — the exact bytes that get hashed. */
export function canonicalReceipt(receipt: RaincheckReceipt): string {
  assertSchemaShape(receipt);
  return canonicalizeJson(receipt);
}

/**
 * receiptHash = lowercase-hex(SHA-256(JCS(receipt))) — bible §4.6.
 * Rejects receipts whose key set deviates from the schema (fail-closed:
 * extra keys would silently change the hash).
 */
export function hashReceipt(receipt: RaincheckReceipt): string {
  return createHash("sha256").update(canonicalReceipt(receipt), "utf8").digest("hex");
}
