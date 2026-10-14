import { describe, expect, it } from "vitest";
import { jcs, receiptHash } from "../jcs";
import golden from "../__fixtures__/receiptHash.golden.json";

/**
 * SHARED GOLDEN TEST VECTOR — frontend F10 / backend B3.
 *
 * Algorithm: receiptHash = lowercase-hex(SHA-256(JCS(receipt))), JCS = RFC 8785
 * subset in frontend/src/lib/jcs.ts, byte-identical to backend/src/api/jcs.ts
 * (see the CONSISTENCY CONTRACT header there). The /verify page (bible §8.1 S4)
 * recomputes this client-side and compares against the Memo anchor — if this
 * vector ever drifts from the backend's, cross-verification breaks silently.
 *
 * Vector provenance is documented in the fixture's _meta block: real
 * Arc-mainnet (5042) R9-W1C values where the chain produced them,
 * keccak256 of documented preimages where the bible gives the preimage,
 * bible §4.6 schema-example constants for timestamps.
 *
 * SYNC RULE: changing backend/src/api/jcs.ts or frontend/src/lib/jcs.ts
 * requires regenerating and re-pinning expectedJcs/expectedReceiptHash here.
 */
describe("receiptHash golden vector (shared with backend B3)", () => {
  const receipt = (golden as { receipt: unknown }).receipt;

  it("JCS canonicalization is byte-stable on the golden receipt", () => {
    expect(jcs(receipt)).toBe((golden as { expectedJcs: string }).expectedJcs);
  });

  it("receiptHash matches the pinned golden hash", () => {
    expect(receiptHash(receipt)).toBe(
      (golden as { expectedReceiptHash: string }).expectedReceiptHash,
    );
  });

  it("receiptHash is 64 lowercase hex chars (no 0x)", () => {
    const h = receiptHash(receipt);
    expect(h).toMatch(/^[0-9a-f]{64}$/);
  });

  it("is order-independent: key insertion order of the input does not matter", () => {
    const deepReverse = (v: unknown): unknown => {
      if (Array.isArray(v)) return v.map(deepReverse);
      if (v && typeof v === "object") {
        const out: Record<string, unknown> = {};
        for (const k of Object.keys(v).reverse())
          out[k] = deepReverse((v as Record<string, unknown>)[k]);
        return out;
      }
      return v;
    };
    expect(receiptHash(deepReverse(receipt))).toBe(receiptHash(receipt));
  });

  it("any byte change in the receipt changes the hash (tamper-evidence)", () => {
    const tampered = JSON.parse(JSON.stringify(receipt)) as Record<string, unknown>;
    tampered["status"] = "CAPTURED";
    expect(receiptHash(tampered)).not.toBe(receiptHash(receipt));
  });
});

describe("jcs edge cases (RFC 8785 subset)", () => {
  it("sorts object keys by UTF-16 code-unit order", () => {
    expect(jcs({ b: 1, a: 2, B: 3 })).toBe('{"B":3,"a":2,"b":1}');
  });

  it("serializes nested structures without whitespace", () => {
    expect(jcs({ x: [1, null, true, "s"], y: {} })).toBe(
      '{"x":[1,null,true,"s"],"y":{}}',
    );
  });

  it("rejects non-integer numbers, NaN, Infinity", () => {
    expect(() => jcs(1.5)).toThrow();
    expect(() => jcs(NaN)).toThrow();
    expect(() => jcs(Infinity)).toThrow();
  });

  it("rejects undefined, bigint, functions — never hash a lossy form", () => {
    expect(() => jcs(undefined)).toThrow();
    expect(() => jcs(10n)).toThrow();
    expect(() => jcs(() => 0)).toThrow();
  });
});
