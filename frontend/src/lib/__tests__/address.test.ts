import { describe, expect, it } from "vitest";
import { isAddress } from "../tx";

/**
 * Address validation — bible §5.2: Arc addresses are 0x + 40 hex chars.
 * Tests the real `isAddress` from src/lib/tx.ts (the shared chain-primitive
 * module); no test-only copy.
 */
describe("isAddress", () => {
  it("accepts lowercase 0x + 40 hex", () => {
    expect(isAddress("0x3600000000000000000000000000000000000000")).toBe(true);
  });

  it("accepts checksummed mixed-case", () => {
    expect(isAddress("0x41099436c5f18eA916B9ca3B835fdc4B5c758Deb")).toBe(true);
  });

  it("accepts all-uppercase hex", () => {
    expect(isAddress("0xBDFCEE82BD42FEFA58EE850B3709636A8B6B0034")).toBe(true);
  });

  it("accepts the zero address shape", () => {
    expect(isAddress("0x0000000000000000000000000000000000000000")).toBe(true);
  });

  it("rejects missing 0x prefix", () => {
    expect(isAddress("3600000000000000000000000000000000000000")).toBe(false);
  });

  it("rejects 39 and 41 hex chars", () => {
    expect(isAddress("0x360000000000000000000000000000000000000")).toBe(false);
    expect(isAddress("0x36000000000000000000000000000000000000000")).toBe(false);
  });

  it("rejects non-hex characters", () => {
    expect(isAddress("0x360000000000000000000000000000000000000g")).toBe(false);
    expect(isAddress("0xZZ00000000000000000000000000000000000000")).toBe(false);
  });

  it("rejects surrounding whitespace (no silent trim)", () => {
    expect(isAddress("  0x3600000000000000000000000000000000000000")).toBe(false);
    expect(isAddress("0x3600000000000000000000000000000000000000\n")).toBe(false);
  });

  it("rejects empty, non-strings, and tx-hash-length input", () => {
    expect(isAddress("")).toBe(false);
    expect(isAddress("0x")).toBe(false);
    expect(isAddress(null)).toBe(false);
    expect(isAddress(undefined)).toBe(false);
    expect(isAddress(123)).toBe(false);
    // 64 hex chars = a tx/payment id, not an address
    expect(
      isAddress("0xacec97a227d2e3529f7e44018499f35f0177dfbf57dbffb7d403f4bfc6d88bee"),
    ).toBe(false);
  });

  it("rejects embedded spaces", () => {
    expect(isAddress("0x3600 000000000000000000000000000000000000")).toBe(false);
  });
});
