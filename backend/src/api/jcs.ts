/**
 * Minimal RFC 8785 JSON Canonicalization Scheme (JCS) implementation.
 *
 * Needed for receiptHash = lowercase-hex(SHA-256(JCS(receipt))) (bible §4.6).
 * RAINCHECK receipt JSON only uses strings, numbers (safe integers), null,
 * arrays and objects — this implementation covers exactly that subset and
 * throws on anything else (bigint, undefined, NaN, functions) so we can
 * never silently hash a lossy representation.
 */

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
      keys.map((k) => JSON.stringify(k) + ":" + jcs((value as Record<string, unknown>)[k])).join(",") +
      "}"
    );
  }
  throw new Error(`jcs: unsupported type ${t}`);
}
