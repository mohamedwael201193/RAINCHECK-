import { describe, expect, it } from "vitest";
import {
  ESCROW_ADDRESS,
  ESCROW_ADDRESS_EURC,
  PAYMENT_TOKENS,
  tokenSymbolForEscrow,
} from "../chain";
import {
  buildApprove,
  buildAuthorize,
  signTerms,
  EURC_ADDRESS,
  USDC_ADDRESS,
  ESCROW_ADDRESS_EURC as TX_EURC_ESCROW,
  type Address,
} from "../tx";

/**
 * Multi-asset: one escrow instance per payment token (USDC default, EURC
 * second). Builders take the escrow/token as parameters with USDC-era
 * defaults, so every existing call site keeps working unchanged.
 */

const PID = ("0x" + "ab".repeat(32)) as `0x${string}`;
const TH = ("0x" + "cd".repeat(32)) as `0x${string}`;
const SELLER = ("0x" + "22".repeat(20)) as Address;
const BUYER = ("0x" + "11".repeat(20)) as Address;
const EURC_ESCROW = ESCROW_ADDRESS_EURC as Address;

describe("payment token config map", () => {
  it("USDC is the default instance", () => {
    expect(PAYMENT_TOKENS.USDC.escrow).toBe(ESCROW_ADDRESS);
    expect(PAYMENT_TOKENS.USDC.token).toBe(USDC_ADDRESS);
    expect(PAYMENT_TOKENS.USDC.decimals).toBe(6);
  });

  it("EURC is the second production instance (same 6 decimals)", () => {
    expect(PAYMENT_TOKENS.EURC.escrow).toBe(ESCROW_ADDRESS_EURC);
    expect(PAYMENT_TOKENS.EURC.token).toBe(EURC_ADDRESS);
    expect(PAYMENT_TOKENS.EURC.decimals).toBe(6);
  });

  it("tokenSymbolForEscrow derives the symbol from the escrow address", () => {
    expect(tokenSymbolForEscrow(ESCROW_ADDRESS)).toBe("USDC");
    expect(tokenSymbolForEscrow(ESCROW_ADDRESS_EURC)).toBe("EURC");
    expect(tokenSymbolForEscrow(ESCROW_ADDRESS.toLowerCase())).toBe("USDC");
    expect(tokenSymbolForEscrow("0x0000000000000000000000000000000000000000")).toBeNull();
    expect(tokenSymbolForEscrow(null)).toBeNull();
  });
});

describe("builders target the selected escrow instance", () => {
  it("buildApprove defaults to the USDC token + USDC escrow", () => {
    const b = buildApprove(1_000_000n);
    expect(b.innerTarget).toBe(USDC_ADDRESS);
    expect(b.memoJson["spender"]).toBe(ESCROW_ADDRESS);
    expect(b.memoJson["token"]).toBe(USDC_ADDRESS);
  });

  it("buildApprove with EURC opts approves the EURC token for the EURC escrow", () => {
    const b = buildApprove(1_000_000n, { token: EURC_ADDRESS, escrow: EURC_ESCROW });
    expect(b.innerTarget).toBe(EURC_ADDRESS);
    expect(b.memoJson["spender"]).toBe(EURC_ESCROW);
    expect(b.memoJson["token"]).toBe(EURC_ADDRESS);
    expect(b.description).toContain("EURC");
  });

  it("buildAuthorize defaults to the USDC escrow, accepts the EURC escrow", () => {
    const future = BigInt(Math.floor(Date.now() / 1000) + 3600);
    const d = buildAuthorize(PID, TH, SELLER, 1_000_000n, future);
    expect(d.innerTarget).toBe(ESCROW_ADDRESS);
    const e = buildAuthorize(PID, TH, SELLER, 1_000_000n, future, TX_EURC_ESCROW);
    expect(e.innerTarget).toBe(TX_EURC_ESCROW);
    // Same action, different instance: calldata differs only in the target.
    expect(e.data).not.toBe(d.data);
    expect(e.innerCalldata).toBe(d.innerCalldata);
  });

  it("signTerms binds the EIP-712 domain to the selected escrow", () => {
    const future = BigInt(Math.floor(Date.now() / 1000) + 3600);
    const terms = { buyer: BUYER, seller: SELLER, endpoint: "https://x", price: 1_000_000n, deadline: future };
    const d = signTerms(terms);
    expect(d.typedData.domain["verifyingContract"]).toBe(ESCROW_ADDRESS);
    const e = signTerms(terms, EURC_ESCROW);
    expect(e.typedData.domain["verifyingContract"]).toBe(EURC_ESCROW);
    // The termsHash itself is token-blind: identical terms, identical hash.
    expect(e.termsHash).toBe(d.termsHash);
  });
});
