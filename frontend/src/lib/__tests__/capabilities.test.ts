import { describe, expect, it } from "vitest";
import {
  canAttest,
  canCapture,
  canFlag,
  canVoid,
  canVoidAfterDeadline,
} from "../capabilities";

/**
 * Capability-gating truth table — bible §4.1 contract permissions as pure UI
 * enablement rules (src/lib/capabilities.ts):
 *   flagNonDelivery: BUYER ONLY, ATTESTED, inside the challenge window
 *   capture: PERMISSIONLESS, ATTESTED, window closed
 *   void: PERMISSIONLESS, FLAGGED
 *   voidAfterDeadline: PERMISSIONLESS, OPEN, past deadline
 *   attestDelivery: SELLER ONLY, OPEN, before deadline
 *
 * "Connected" = a signing wallet is attached (UI requirement even for the
 * permissionless calls). Unknown statuses deny everything.
 */
const BUYER = "0xBDfCeE82Bd42FEfA58ee850B3709636a8B6b0034";
const SELLER = "0xc3b183D5e4436C20282650348BE2D6c94c4142dc";
const OTHER = "0x3600000000000000000000000000000000000000";

describe("canFlag(buyer, connected, status, windowOpen)", () => {
  it("allows the buyer, connected, ATTESTED, window open", () => {
    expect(canFlag(BUYER, BUYER, "ATTESTED", true)).toBe(true);
  });

  it("compares addresses case-insensitively", () => {
    expect(canFlag(BUYER.toLowerCase(), BUYER.toUpperCase(), "ATTESTED", true)).toBe(true);
  });

  it("denies: no wallet connected", () => {
    expect(canFlag(BUYER, null, "ATTESTED", true)).toBe(false);
    expect(canFlag(BUYER, "", "ATTESTED", true)).toBe(false);
  });

  it("denies: connected wallet is not the buyer (seller, stranger)", () => {
    expect(canFlag(BUYER, SELLER, "ATTESTED", true)).toBe(false);
    expect(canFlag(BUYER, OTHER, "ATTESTED", true)).toBe(false);
  });

  it("denies: wrong status (OPEN, FLAGGED, CAPTURED, VOIDED, unknown)", () => {
    for (const s of ["OPEN", "FLAGGED", "CAPTURED", "VOIDED", "NONE", "bogus"]) {
      expect(canFlag(BUYER, BUYER, s, true)).toBe(false);
    }
  });

  it("denies: challenge window closed", () => {
    expect(canFlag(BUYER, BUYER, "ATTESTED", false)).toBe(false);
  });
});

describe("canCapture(connected, status, windowOpen) — permissionless on-chain", () => {
  it("allows any connected signer once the window closes with no flag", () => {
    expect(canCapture(OTHER, "ATTESTED", false)).toBe(true);
    expect(canCapture(SELLER, "ATTESTED", false)).toBe(true);
  });

  it("denies while the window is still open", () => {
    expect(canCapture(OTHER, "ATTESTED", true)).toBe(false);
  });

  it("denies when not connected, or status is not ATTESTED", () => {
    expect(canCapture(null, "ATTESTED", false)).toBe(false);
    expect(canCapture(OTHER, "OPEN", false)).toBe(false);
    expect(canCapture(OTHER, "FLAGGED", false)).toBe(false);
    expect(canCapture(OTHER, "CAPTURED", false)).toBe(false);
  });
});

describe("canVoid(connected, status) — permissionless on-chain", () => {
  it("allows any connected signer when FLAGGED", () => {
    expect(canVoid(OTHER, "FLAGGED")).toBe(true);
  });

  it("denies when not connected or not FLAGGED", () => {
    expect(canVoid(null, "FLAGGED")).toBe(false);
    expect(canVoid(OTHER, "ATTESTED")).toBe(false);
    expect(canVoid(OTHER, "OPEN")).toBe(false);
  });
});

describe("canVoidAfterDeadline(connected, status, pastDeadline)", () => {
  it("allows any connected signer for OPEN past deadline (funds never trap)", () => {
    expect(canVoidAfterDeadline(OTHER, "OPEN", true)).toBe(true);
  });

  it("denies before the deadline", () => {
    expect(canVoidAfterDeadline(OTHER, "OPEN", false)).toBe(false);
  });

  it("denies when not connected or status is not OPEN", () => {
    expect(canVoidAfterDeadline(null, "OPEN", true)).toBe(false);
    expect(canVoidAfterDeadline(OTHER, "ATTESTED", true)).toBe(false);
  });
});

describe("canAttest(seller, connected, status, beforeDeadline)", () => {
  it("allows the seller, connected, OPEN, before deadline", () => {
    expect(canAttest(SELLER, SELLER, "OPEN", true)).toBe(true);
  });

  it("denies: buyer or stranger cannot attest", () => {
    expect(canAttest(SELLER, BUYER, "OPEN", true)).toBe(false);
    expect(canAttest(SELLER, OTHER, "OPEN", true)).toBe(false);
  });

  it("denies: past the deadline, wrong status, not connected", () => {
    expect(canAttest(SELLER, SELLER, "OPEN", false)).toBe(false);
    expect(canAttest(SELLER, SELLER, "ATTESTED", true)).toBe(false);
    expect(canAttest(SELLER, null, "OPEN", true)).toBe(false);
  });
});

describe("lifecycle sanity — the full truth table moves one way", () => {
  it("OPEN: only seller may attest; nobody may flag/capture/void", () => {
    expect(canAttest(SELLER, SELLER, "OPEN", true)).toBe(true);
    expect(canFlag(BUYER, BUYER, "OPEN", true)).toBe(false);
    expect(canCapture(BUYER, "OPEN", false)).toBe(false);
    expect(canVoid(BUYER, "OPEN")).toBe(false);
    expect(canVoidAfterDeadline(BUYER, "OPEN", false)).toBe(false);
  });

  it("ATTESTED+window open: only buyer may flag", () => {
    expect(canFlag(BUYER, BUYER, "ATTESTED", true)).toBe(true);
    expect(canCapture(BUYER, "ATTESTED", true)).toBe(false);
    expect(canAttest(SELLER, SELLER, "ATTESTED", true)).toBe(false);
  });

  it("FLAGGED: only void is enabled", () => {
    expect(canVoid(OTHER, "FLAGGED")).toBe(true);
    expect(canFlag(BUYER, BUYER, "FLAGGED", true)).toBe(false);
    expect(canCapture(OTHER, "FLAGGED", false)).toBe(false);
  });

  it("terminal states (CAPTURED/VOIDED): nothing is enabled", () => {
    for (const s of ["CAPTURED", "VOIDED"]) {
      expect(canFlag(BUYER, BUYER, s, true)).toBe(false);
      expect(canCapture(OTHER, s, false)).toBe(false);
      expect(canVoid(OTHER, s)).toBe(false);
      expect(canVoidAfterDeadline(OTHER, s, true)).toBe(false);
      expect(canAttest(SELLER, SELLER, s, true)).toBe(false);
    }
  });
});
