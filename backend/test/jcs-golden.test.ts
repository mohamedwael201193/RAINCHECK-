// JCS golden test — RFC 8785 canonicalization pinned to an exact expected string.
// Uses the PRODUCTION jcs implementation (src/api/jcs.ts) — the same function
// receiptHashOf() hashes with — so the golden pins the live hashing path.
// The expected string below was computed BY HAND (key sort order, separators,
// escaping) so it is independent of the implementation; it must never be
// regenerated from code.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { jcs } from "../src/api/jcs.js";

const GOLDEN_FIXTURE = {
  status: "ATTESTED",
  anchors: ["eip155:5042:0xabc", "eip155:5042:0xdef"],
  paymentId: "0x2afce53583a7e57afb16d95f0b606d7d12109cebf95ff10a2c952166530d55ad",
  terms: {
    price: "1000",
    endpoint: "https://api.example.com/v1/render",
    termsHash: "0xaaaa",
    deadline: 1791957337,
  },
  delivery: {
    outputHash: "0xe3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    attestedAt: 1791953860,
  },
};

// Hand-computed JCS: keys sorted per level (anchors < delivery < paymentId < status < terms;
// attestedAt < outputHash; deadline < endpoint < price < termsHash), no whitespace,
// arrays in document order.
const GOLDEN_JCS =
  '{"anchors":["eip155:5042:0xabc","eip155:5042:0xdef"],' +
  '"delivery":{"attestedAt":1791953860,"outputHash":"0xe3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"},' +
  '"paymentId":"0x2afce53583a7e57afb16d95f0b606d7d12109cebf95ff10a2c952166530d55ad",' +
  '"status":"ATTESTED",' +
  '"terms":{"deadline":1791957337,"endpoint":"https://api.example.com/v1/render","price":"1000","termsHash":"0xaaaa"}}';

describe("JCS golden", () => {
  it("canonicalizes the nested fixture to the exact expected string", () => {
    assert.equal(jcs(GOLDEN_FIXTURE), GOLDEN_JCS);
  });

  it("key insertion order does not change canonical output", () => {
    const reordered = {
      delivery: { attestedAt: 1791953860, outputHash: GOLDEN_FIXTURE.delivery.outputHash },
      terms: { deadline: 1791957337, price: "1000", termsHash: "0xaaaa", endpoint: "https://api.example.com/v1/render" },
      anchors: ["eip155:5042:0xabc", "eip155:5042:0xdef"],
      status: "ATTESTED",
      paymentId: GOLDEN_FIXTURE.paymentId,
    };
    assert.equal(jcs(reordered), GOLDEN_JCS);
  });

  it("UTF-16 code-unit key order: '10' sorts before '9'", () => {
    assert.equal(jcs({ "9": "a", "10": "b" }), '{"10":"b","9":"a"}');
  });

  it("escapes control characters per JSON string encoding", () => {
    assert.equal(jcs({ s: "a\nb\tc\x01d\"e\\f" }), '{"s":"a\\nb\\tc\\u0001d\\"e\\\\f"}');
  });

  it("integers serialize plainly; non-integers are rejected, never lossy-hashed", () => {
    assert.equal(jcs({ a: 1000, b: 0, c: -42 }), '{"a":1000,"b":0,"c":-42}');
    assert.throws(() => jcs({ x: 1.5 }), /non-integer/);
    assert.throws(() => jcs(NaN), /non-finite/);
  });

  it("null/boolean/nested arrays round-trip deterministically", () => {
    assert.equal(jcs({ n: null, t: true, f: false, arr: [1, [2, 3], { z: 1, a: 2 }] }),
      '{"arr":[1,[2,3],{"a":2,"z":1}],"f":false,"n":null,"t":true}');
  });

  it("rejects non-JSON values instead of silently hashing a lossy form", () => {
    assert.throws(() => jcs({ u: undefined }), /unsupported type/);
    assert.throws(() => jcs(10n), /BigInt|unsupported type/);
  });
});
