/**
 * RFC 8785 JSON Canonicalization Scheme (JCS) — client-side copy.
 *
 * CONSISTENCY CONTRACT: this implementation is intentionally byte-identical to
 * `backend/src/api/jcs.ts`. Both must serialize a receipt to the exact same
 * bytes, because receiptHash = lowercase-hex(SHA-256(JCS(receipt))) is checked
 * against the Memo anchor on-chain. Rules:
 *   - object keys sorted by UTF-16 code-unit order (JS default sort — the same
 *     comparison the backend uses),
 *   - no whitespace,
 *   - strings via JSON.stringify,
 *   - only safe integers for numbers (receipt amounts are strings of base
 *     units; deadline/attestedAt are unix seconds),
 *   - throws on anything outside JSON data (bigint, undefined, NaN,
 *     functions) so we can never hash a lossy representation.
 *
 * If you change this file, change backend/src/api/jcs.ts the same way and
 * re-run the golden-vector test (same input JSON must produce the same
 * receiptHash on both sides).
 */
import { sha256, stringToHex } from "viem";

export function jcs(value: unknown): string {
  if (value === null) return "null";
  const t = typeof value;
  if (t === "string") return JSON.stringify(value);
  if (t === "number") {
    if (!Number.isFinite(value)) throw new Error("jcs: non-finite number");
    if (!Number.isInteger(value)) throw new Error("jcs: non-integer number");
    return JSON.stringify(value);
  }
  if (t === "boolean") return value ? "true" : "false";
  if (Array.isArray(value)) {
    return "[" + value.map((v) => jcs(v)).join(",") + "]";
  }
  if (t === "object") {
    const keys = Object.keys(value as Record<string, unknown>).sort();
    return (
      "{" +
      keys
        .map(
          (k) =>
            JSON.stringify(k) + ":" + jcs((value as Record<string, unknown>)[k]),
        )
        .join(",") +
      "}"
    );
  }
  throw new Error(`jcs: unsupported type ${t}`);
}

/**
 * receiptHash = lowercase-hex(SHA-256(JCS(receipt))) (build bible §4.6).
 * Returns the 64-char hex string without a 0x prefix, all lowercase.
 */
export function receiptHash(receipt: unknown): string {
  const canonical = jcs(receipt);
  return sha256(stringToHex(canonical)).slice(2).toLowerCase();
}

/** Extract a tx hash from a `eip155:5042:0x…` anchor ref; null when not an anchor. */
export function txFromAnchor(ref: string): `0x${string}` | null {
  const m = /^eip155:5042:(0x[0-9a-fA-F]{64})$/.exec(ref.trim());
  return m ? (m[1] as `0x${string}`) : null;
}
