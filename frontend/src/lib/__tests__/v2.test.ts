import { describe, expect, it } from "vitest";
import { keccak256, toBytes } from "viem";
import {
  V2_ESCROW_ADDRESS,
  buildAuthorizeV2,
  GAS_LIMITS,
} from "../tx";
import { isV2Escrow, tokenSymbolForEscrow, V2_DEPLOY_BLOCK } from "../chain";
import { normalizeStatusForV2 } from "../receipts";

/**
 * V2 builder tests — the experimental tier must be built with the EXACT
 * 7-parameter signature from contracts/src/RaincheckEscrowV2.sol:
 *   authorize(bytes32,bytes32,address,uint256,uint256,bytes32,bytes32)
 * No chain calls here; these test the builder output only.
 */

const PID = "0x" + "11".repeat(32);
const TH = "0x" + "22".repeat(32);
const SELLER = "0xf76e6B0920e9332fF4410f6dD53F01722AbC71a3";
const POLICY = "0x" + "33".repeat(32);
const FUTURE = BigInt(Math.floor(Date.now() / 1000) + 3600);

const SELECTOR_7PARAM = keccak256(
  toBytes("authorize(bytes32,bytes32,address,uint256,uint256,bytes32,bytes32)"),
).slice(0, 10);

describe("buildAuthorizeV2", () => {
  it("targets the V2 experimental escrow by default", () => {
    const built = buildAuthorizeV2(PID, TH, SELLER, 10_000, FUTURE, POLICY);
    expect(built.innerTarget.toLowerCase()).toBe(
      V2_ESCROW_ADDRESS.toLowerCase(),
    );
    expect(V2_ESCROW_ADDRESS.toLowerCase()).toBe(
      "0x3795b865f7fc84a14ab60456be9fc6dd0cb56f0c",
    );
  });

  it("encodes the exact 7-param selector from RaincheckEscrowV2.sol", () => {
    const built = buildAuthorizeV2(PID, TH, SELLER, 10_000, FUTURE, POLICY);
    expect(built.innerCalldata.slice(0, 10)).toBe(SELECTOR_7PARAM);
  });

  it("is Memo-wrapped with the v2 spec and policyRef in the memo", () => {
    const built = buildAuthorizeV2(PID, TH, SELLER, 10_000, FUTURE, POLICY);
    expect(built.kind).toBe("authorize");
    expect(built.memoJson.spec).toBe("raincheck-receipt/v2");
    expect(built.memoJson.protocol).toBe("v2");
    expect(built.memoJson.experimental).toBe(true);
    expect(built.memoJson.policyRef).toBe(POLICY);
  });

  it("zeroes refs when omitted or empty", () => {
    const zero = "0x" + "00".repeat(32);
    const built = buildAuthorizeV2(PID, TH, SELLER, 10_000, FUTURE);
    expect(built.memoJson.policyRef).toBe(zero);
    expect(built.memoJson.fundingRef).toBe(zero);
    const builtEmpty = buildAuthorizeV2(PID, TH, SELLER, 10_000, FUTURE, "");
    expect(builtEmpty.memoJson.policyRef).toBe(zero);
  });

  it("rejects a past deadline and malformed refs", () => {
    const past = BigInt(Math.floor(Date.now() / 1000) - 10);
    expect(() => buildAuthorizeV2(PID, TH, SELLER, 10_000, past, POLICY)).toThrow(
      /not in the future/,
    );
    expect(() => buildAuthorizeV2(PID, TH, SELLER, 10_000, FUTURE, "nope")).toThrow(
      /policyRef/,
    );
  });

  it("uses a manual gas limit, never an estimate", () => {
    const built = buildAuthorizeV2(PID, TH, SELLER, 10_000, FUTURE, POLICY);
    expect(built.gas).toBe(GAS_LIMITS.authorizeV2);
    expect(built.gas).toBeGreaterThan(0n);
  });
});

describe("V2 chain helpers", () => {
  it("isV2Escrow identifies the experimental instance only", () => {
    expect(isV2Escrow(V2_ESCROW_ADDRESS)).toBe(true);
    expect(isV2Escrow(V2_ESCROW_ADDRESS.toUpperCase())).toBe(true);
    expect(isV2Escrow("0x97f233865ae84DC7475F6D7CA404930654580CB5")).toBe(false);
    expect(isV2Escrow(null)).toBe(false);
  });

  it("tokenSymbolForEscrow maps V2 to USDC", () => {
    expect(tokenSymbolForEscrow(V2_ESCROW_ADDRESS)).toBe("USDC");
  });

  it("V2 deploy block is the recorded mainnet block", () => {
    expect(V2_DEPLOY_BLOCK).toBe(25962342n);
  });

  it("normalizeStatusForV2 passes through known statuses", () => {
    expect(normalizeStatusForV2("OPEN")).toBe("OPEN");
    expect(normalizeStatusForV2("captured")).toBe("CAPTURED");
    expect(normalizeStatusForV2("BOGUS")).toBe("OPEN");
  });
});
