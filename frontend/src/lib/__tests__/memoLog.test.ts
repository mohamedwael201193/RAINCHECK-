/**
 * Regression test for the Memo log layout fix (2026-10-15).
 *
 * The Memo contract does NOT emit what an earlier revision of verify.ts
 * assumed. Proven against real Arc mainnet logs:
 *   topics = [sig, sender, target, memoId]        (topics[3] is the memoId —
 *              keccak256("raincheck:authorize:v1") for this fixture)
 *   data   = callDataHash | offset | memoIndex | memo bytes…
 *            (word0 = keccak256 of the INNER calldata the Memo contract
 *             forwarded — NOT keccak256 of the outer tx input)
 *
 * Fixture: real Memo log from V1 authorize tx
 * 0x068c97c13f9e3aeda3516fccaa09ab1ccc816e684d130d927f0ec17fe820ffe0
 * (Arc mainnet, chain 5042).
 */
import { describe, expect, it } from "vitest";
import { keccak256, toHex } from "viem";
import { memoBytesFromData, memoIndexFromData } from "../verify";
import fixture from "./memo-log-fixture.json";

describe("Memo log parsing (on-chain layout)", () => {
  it("reads topics[3] as the memoId", () => {
    const memoId = (fixture.topics[3] as string).toLowerCase();
    expect(memoId).toBe(
      keccak256(toHex("raincheck:authorize:v1")).toLowerCase(),
    );
    const { id } = memoBytesFromData(fixture.data, fixture.topics[3] as string);
    expect(id).toBe(memoId);
  });

  it("reads word0 as the inner-calldata hash, not the outer input hash", () => {
    const word0 = ("0x" + (fixture.data as string).slice(2, 66)).toLowerCase();
    // keccak256 of the inner authorize() calldata for this tx (decoded from
    // the memo() envelope on-chain) — the value the Memo contract committed to.
    expect(word0).toBe(
      "0x6ca9609ac42354c5ec4e93f7f4f364a346dcb2ded71f75a50c1271c29eb4e6b7",
    );
    // It must NOT equal keccak256 of the outer memo() input: the old code
    // compared topics[3] against that and failed for every real receipt.
    expect(word0).not.toBe((fixture.topics[3] as string).toLowerCase());
  });

  it("reads the memoIndex from word2", () => {
    expect(memoIndexFromData(fixture.data)).toBe(1209);
  });

  it("decodes the memo JSON bytes", () => {
    const { ascii } = memoBytesFromData(fixture.data, fixture.topics[3] as string);
    expect(ascii).toContain("raincheck-receipt/v1");
    expect(ascii).toContain("authorize");
  });
});
