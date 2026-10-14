import { describe, expect, it } from "vitest";
import { baseToUsdc, usdcToBase } from "../tx";

/**
 * USDC amount parsing — bible §4.1/§5.2: payment math is 6-decimal base units
 * (the ERC-20 face; never 18-decimal gas math). Tests the real `usdcToBase` /
 * `baseToUsdc` from src/lib/tx.ts; no test-only copies.
 */
describe("usdcToBase", () => {
  it('parses "1.5" to 1500000 base units', () => {
    expect(usdcToBase("1.5")).toBe(1500000n);
  });

  it("handles whole units and dust", () => {
    expect(usdcToBase("1")).toBe(1000000n);
    expect(usdcToBase("0.000001")).toBe(1n);
    expect(usdcToBase("100")).toBe(100000000n);
  });

  it("trims surrounding whitespace", () => {
    expect(usdcToBase("  2.5 ")).toBe(2500000n);
  });

  it("maps zero to 0n (callers decide whether zero is allowed)", () => {
    expect(usdcToBase("0")).toBe(0n);
  });

  it("rejects more than 6 decimals", () => {
    expect(() => usdcToBase("1.0000001")).toThrow();
  });

  it("rejects negatives", () => {
    expect(() => usdcToBase("-1")).toThrow();
  });

  it("rejects non-numeric and exotic formats", () => {
    expect(() => usdcToBase("")).toThrow();
    expect(() => usdcToBase("abc")).toThrow();
    expect(() => usdcToBase("1,000")).toThrow();
    expect(() => usdcToBase("1e3")).toThrow();
    expect(() => usdcToBase(".5")).toThrow();
    expect(() => usdcToBase("1.")).toThrow();
  });
});

describe("baseToUsdc round-trip", () => {
  it("formats base units back to display strings", () => {
    expect(baseToUsdc(1500000n)).toBe("1.5");
    expect(baseToUsdc(1n)).toBe("0.000001");
    expect(baseToUsdc(1000000n)).toBe("1");
  });

  it("round-trips parse -> format for representative values", () => {
    for (const s of ["0.001", "1.5", "250", "0.000001", "999999.999999"]) {
      expect(baseToUsdc(usdcToBase(s))).toBe(s);
    }
  });
});
