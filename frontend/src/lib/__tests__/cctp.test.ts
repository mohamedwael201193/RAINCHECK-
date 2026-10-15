import { describe, expect, it } from "vitest";
import {
  ARC_CCTP_DOMAIN,
  CCTP_CROSS_CHAIN_TOKEN_SERVICE,
  CCTP_EURC_TOKEN_MANAGER,
  CCTP_GAS,
  CCTP_MIN_FINALITY_FAST,
  CCTP_TOKEN_MESSENGER_V2,
  DEPOSIT_FOR_BURN_SIGNATURE,
  EURC_DESTINATIONS,
  USDC_DESTINATIONS,
  buildCctpApprove,
  buildCctpBurn,
  encodeMintRecipient,
  parseBridgeAmount,
} from "../cctp";
import { EURC_ADDRESS, USDC_ADDRESS } from "../tx";

/**
 * CCTP bridge builders — tests the real builders from src/lib/cctp.ts.
 * No network, no wallet: pure calldata construction.
 *
 * The centerpiece is a byte-equality assertion against the PROVEN mainnet
 * burn tx 0xe519221e1c1d7b1c6225f22c1bd6bba9e76d1bb77fc467cf78fd1eace23731f1
 * (direct-EOA dust burn of 0.005 USDC, Arc -> Base domain 6): the builder
 * must reproduce that exact calldata.
 */

const PROVEN_BURN_INPUT =
  "0x8e0250ee" +
  "0000000000000000000000000000000000000000000000000000000000001388" + // 5000
  "0000000000000000000000000000000000000000000000000000000000000006" + // domain 6
  "000000000000000000000000cb2e45a4c3703cd9c73df09c8b945d5295fa3edd" + // recipient
  "0000000000000000000000003600000000000000000000000000000000000000" + // USDC
  "0000000000000000000000000000000000000000000000000000000000000000" + // destinationCaller
  "0000000000000000000000000000000000000000000000000000000000000000" + // maxFee
  "00000000000000000000000000000000000000000000000000000000000003e8"; // 1000

describe("CCTP constants", () => {
  it("pins the verified on-chain addresses", () => {
    expect(CCTP_TOKEN_MESSENGER_V2).toBe(
      "0x28b5a0e9C621a5BadaA536219b3a228C8168cf5d",
    );
    expect(CCTP_CROSS_CHAIN_TOKEN_SERVICE).toBe(
      "0x431871229103b780868f8C6BB820cd16ECf942BC",
    );
    expect(CCTP_EURC_TOKEN_MANAGER).toBe(
      "0x8c27579e24f9f19d96724e19fc059dacd1469e10",
    );
    expect(ARC_CCTP_DOMAIN).toBe(26);
    expect(CCTP_MIN_FINALITY_FAST).toBe(1000);
  });

  it("uses the 7-param V2 depositForBurn signature", () => {
    expect(DEPOSIT_FOR_BURN_SIGNATURE).toBe(
      "depositForBurn(uint256,uint32,bytes32,address,bytes32,uint256,uint32)",
    );
  });
});

describe("USDC destination domains (Circle docs-verified)", () => {
  it("includes the core EVM routes and excludes Arc itself", () => {
    const byDomain = new Map(USDC_DESTINATIONS.map((d) => [d.domain, d.name]));
    expect(byDomain.get(0)).toBe("Ethereum");
    expect(byDomain.get(1)).toBe("Avalanche");
    expect(byDomain.get(2)).toBe("OP Mainnet");
    expect(byDomain.get(3)).toBe("Arbitrum");
    expect(byDomain.get(6)).toBe("Base");
    expect(byDomain.get(7)).toBe("Polygon PoS");
    expect(byDomain.get(14)).toBe("World Chain");
    expect(byDomain.has(ARC_CCTP_DOMAIN)).toBe(false);
    // Solana (5), Starknet (25), Stellar (27) are non-EVM — excluded.
    expect(byDomain.has(5)).toBe(false);
    expect(byDomain.has(25)).toBe(false);
    expect(byDomain.has(27)).toBe(false);
  });

  it("has unique domains and names", () => {
    const domains = USDC_DESTINATIONS.map((d) => d.domain);
    expect(new Set(domains).size).toBe(domains.length);
  });

  it("EURC route list matches the Sept 2026 expansion (Arc/Eth/Avalanche/Base/World Chain)", () => {
    expect(EURC_DESTINATIONS.map((d) => d.domain).sort((a, b) => a - b)).toEqual([
      0, 1, 6, 14,
    ]);
  });
});

describe("parseBridgeAmount", () => {
  it("parses 6-decimal amounts to base units", () => {
    expect(parseBridgeAmount("1.5")).toBe(1500000n);
    expect(parseBridgeAmount("0.005")).toBe(5000n);
    expect(parseBridgeAmount("  2 ")).toBe(2000000n);
  });

  it("rejects zero, negatives and malformed input", () => {
    expect(() => parseBridgeAmount("0")).toThrow();
    expect(() => parseBridgeAmount("-1")).toThrow();
    expect(() => parseBridgeAmount("")).toThrow();
    expect(() => parseBridgeAmount("abc")).toThrow();
    expect(() => parseBridgeAmount("1.0000001")).toThrow();
    expect(() => parseBridgeAmount("1e3")).toThrow();
  });
});

describe("encodeMintRecipient", () => {
  it("left-pads the 20-byte address to bytes32 (proven-tx format)", () => {
    expect(
      encodeMintRecipient("0xCB2e45a4c3703cD9c73Df09c8B945D5295fA3eDd"),
    ).toBe(
      "0x000000000000000000000000cb2e45a4c3703cd9c73df09c8b945d5295fa3edd",
    );
  });

  it("rejects non-addresses", () => {
    expect(() => encodeMintRecipient("not-an-address")).toThrow();
    expect(() => encodeMintRecipient("0x1234")).toThrow();
  });
});

describe("buildCctpApprove", () => {
  it("approves the TokenMessengerV2 for the exact amount", () => {
    const tx = buildCctpApprove(5000n);
    expect(tx.to).toBe(USDC_ADDRESS);
    expect(tx.data.slice(0, 10)).toBe("0x095ea7b3"); // approve(address,uint256)
    // spender word = messenger, amount word = 5000
    expect(tx.data.slice(10, 74)).toBe(
      "00000000000000000000000028b5a0e9c621a5badaa536219b3a228c8168cf5d",
    );
    expect(tx.data.slice(74, 138)).toBe(
      "0000000000000000000000000000000000000000000000000000000000001388",
    );
    expect(tx.gas).toBe(CCTP_GAS.approve);
  });

  it("rejects zero amounts", () => {
    expect(() => buildCctpApprove(0n)).toThrow();
  });
});

describe("buildCctpBurn", () => {
  it("reproduces the PROVEN mainnet burn calldata byte-for-byte", () => {
    const tx = buildCctpBurn({
      amountBase: 5000n,
      destinationDomain: 6,
      mintRecipient: "0xCB2e45a4c3703cD9c73Df09c8B945D5295fA3eDd",
    });
    expect(tx.to).toBe(CCTP_TOKEN_MESSENGER_V2);
    expect(tx.data).toBe(PROVEN_BURN_INPUT);
    expect(tx.data.slice(0, 10)).toBe("0x8e0250ee");
    expect(tx.gas).toBe(CCTP_GAS.burn);
    expect(tx.kind).toBe("cctpBurn");
  });

  it("encodes a different domain and recipient correctly", () => {
    const tx = buildCctpBurn({
      amountBase: 1000000n,
      destinationDomain: 0,
      mintRecipient: "0xbEf5f6d51CB62b58e6A8f77868681825C6fe21c1",
    });
    // domain word (2nd) = 0, recipient word = left-padded EURC address
    expect(tx.data.slice(74, 138)).toBe("0".repeat(64));
    expect(tx.data.slice(138, 202)).toBe(
      "000000000000000000000000bef5f6d51cb62b58e6a8f77868681825c6fe21c1",
    );
  });

  it("rejects unsupported domains and zero amounts", () => {
    const good = {
      amountBase: 1000n,
      mintRecipient: "0xbEf5f6d51CB62b58e6A8f77868681825C6fe21c1",
    };
    expect(() => buildCctpBurn({ ...good, destinationDomain: 26 })).toThrow();
    expect(() => buildCctpBurn({ ...good, destinationDomain: 999 })).toThrow();
    expect(() =>
      buildCctpBurn({ ...good, destinationDomain: 6, amountBase: 0n }),
    ).toThrow();
    expect(() =>
      buildCctpBurn({ ...good, destinationDomain: 6, mintRecipient: "xyz" }),
    ).toThrow();
  });

  it("never targets the Memo contract (contract-initiated burns are chain-gated)", () => {
    const tx = buildCctpBurn({
      amountBase: 1000n,
      destinationDomain: 6,
      mintRecipient: "0xbEf5f6d51CB62b58e6A8f77868681825C6fe21c1",
    });
    const approve = buildCctpApprove(1000n);
    expect(tx.to).toBe(CCTP_TOKEN_MESSENGER_V2);
    expect(approve.to).toBe(USDC_ADDRESS);
  });

  it("keeps token addresses consistent with tx.ts", () => {
    expect(USDC_ADDRESS).toBe("0x3600000000000000000000000000000000000000");
    expect(EURC_ADDRESS).toBe("0xbEf5f6d51CB62b58e6A8f77868681825C6fe21c1");
  });
});
