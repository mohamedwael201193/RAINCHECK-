import { describe, expect, it } from "vitest";
import {
  buildQuoteUrl,
  buildSwapSteps,
  formatBaseUnits,
  gasWithBuffer,
  parseLifiQuoteResponse,
  type LifiQuote,
} from "../lifi";

/**
 * LI.FI quote-state machine — pure logic, no network.
 * Fixtures mirror LI.FI's documented v1 /quote shape:
 * transactionRequest { from, to, value, data, gasPrice, gasLimit, chainId },
 * estimate { approvalAddress, executionDuration }, toAmount, priceImpact.
 */

const TX_REQ = {
  from: "0xf76e6B0920e9332fF4410f6dD53F01722AbC71a3",
  to: "0x2222222222222222222222222222222222222222",
  value: "0x0",
  data: "0x1234567890abcdef",
  gasPrice: "0x3b9aca00",
  gasLimit: "0x30d40", // 200_000
  chainId: 5042,
};

function quoteBody(overrides: Record<string, unknown> = {}) {
  return {
    id: "quote-1",
    fromChainId: 5042,
    toChainId: 5042,
    fromToken: {
      address: "0x3600000000000000000000000000000000000000",
      symbol: "USDC",
      decimals: 6,
    },
    toToken: {
      address: "0xbEf5f6d51CB62b58e6A8f77868681825C6fe21c1",
      symbol: "EURC",
      decimals: 6,
    },
    fromAmount: "500000",
    toAmount: "446300",
    toAmountMin: "444000",
    priceImpact: "0.5",
    tool: "lifi",
    estimate: {
      tool: "lifi",
      approvalAddress: "0x1111111111111111111111111111111111111111",
      approvalAmount: "500000",
      executionDuration: 27,
    },
    transactionRequest: TX_REQ,
    ...overrides,
  };
}

function asQuote(): LifiQuote {
  const s = parseLifiQuoteResponse(200, quoteBody());
  if (s.status !== "quote") throw new Error("fixture did not parse as a quote");
  return s.quote;
}

describe("buildQuoteUrl", () => {
  it("targets li.quest v1/quote on Arc 5042 with USDC -> EURC", () => {
    const url = buildQuoteUrl("500000", "0xf76e6B0920e9332fF4410f6dD53F01722AbC71a3");
    expect(url.startsWith("https://li.quest/v1/quote?")).toBe(true);
    const u = new URL(url);
    expect(u.searchParams.get("fromChain")).toBe("5042");
    expect(u.searchParams.get("toChain")).toBe("5042");
    expect(u.searchParams.get("fromToken")).toBe(
      "0x3600000000000000000000000000000000000000",
    );
    expect(u.searchParams.get("toToken")).toBe(
      "0xbEf5f6d51CB62b58e6A8f77868681825C6fe21c1",
    );
    expect(u.searchParams.get("fromAmount")).toBe("500000");
    expect(u.searchParams.get("fromAddress")).toBe(
      "0xf76e6B0920e9332fF4410f6dD53F01722AbC71a3",
    );
  });
});

describe("parseLifiQuoteResponse", () => {
  it("200 + full shape -> quote with formatted amounts and approval", () => {
    const s = parseLifiQuoteResponse(200, quoteBody());
    expect(s.status).toBe("quote");
    if (s.status !== "quote") return;
    expect(s.quote.toAmount).toBe("446300");
    expect(s.quote.toAmountFormatted).toBe("0.4463");
    expect(s.quote.fromAmountFormatted).toBe("0.5");
    expect(s.quote.approvalAddress).toBe("0x1111111111111111111111111111111111111111");
    expect(s.quote.estimatedSeconds).toBe(27);
    expect(s.quote.priceImpactPct).toBe("0.5");
    expect(s.quote.transactionRequest.gasLimit).toBe("0x30d40");
  });

  it("404 -> no-route (the panel hides the swap button)", () => {
    const s = parseLifiQuoteResponse(
      404,
      { message: "No available quotes", code: 1002 },
    );
    expect(s).toEqual({ status: "no-route" });
  });

  it("code 1002 on any status -> no-route", () => {
    const s = parseLifiQuoteResponse(200, {
      message: "No available quotes for the requested tokens",
      code: 1002,
    });
    expect(s).toEqual({ status: "no-route" });
  });

  it("429 -> retryable error (rate limit is not 'no route')", () => {
    const s = parseLifiQuoteResponse(429, {
      message: "Rate limit exceeded, retry in 29 minutes",
      code: 1005,
    });
    expect(s.status).toBe("error");
    if (s.status !== "error") return;
    expect(s.retryable).toBe(true);
    expect(s.message).toContain("Rate limit exceeded");
  });

  it("500 with message -> retryable error", () => {
    const s = parseLifiQuoteResponse(500, { message: "Internal error" });
    expect(s.status).toBe("error");
    if (s.status !== "error") return;
    expect(s.retryable).toBe(true);
  });

  it("200 without transactionRequest -> error, never a quote", () => {
    const body = quoteBody({ transactionRequest: undefined });
    const s = parseLifiQuoteResponse(200, body);
    expect(s.status).toBe("error");
  });

  it("200 with missing toAmount -> error", () => {
    const body = quoteBody({ toAmount: undefined });
    const s = parseLifiQuoteResponse(200, body);
    expect(s.status).toBe("error");
  });

  it("network-shaped null body on 200 -> error", () => {
    expect(parseLifiQuoteResponse(200, null).status).toBe("error");
  });

  it("missing executionDuration -> estimatedSeconds null, still a quote", () => {
    const body = quoteBody({
      estimate: { approvalAddress: "0x1111111111111111111111111111111111111111" },
    });
    const s = parseLifiQuoteResponse(200, body);
    expect(s.status).toBe("quote");
    if (s.status !== "quote") return;
    expect(s.quote.estimatedSeconds).toBeNull();
  });
});

describe("formatBaseUnits", () => {
  it("formats 6-decimal amounts", () => {
    expect(formatBaseUnits("500000", 6)).toBe("0.5");
    expect(formatBaseUnits("446300", 6)).toBe("0.4463");
    expect(formatBaseUnits("1000000", 6)).toBe("1");
    expect(formatBaseUnits("0", 6)).toBe("0");
  });
});

describe("gasWithBuffer", () => {
  it("adds a 20% buffer to LI.FI's gasLimit", () => {
    expect(gasWithBuffer("0x30d40")).toBe(240_000n); // 200_000 * 1.2
  });

  it("caps at LIFI_GAS_CAP", () => {
    expect(gasWithBuffer("0xF4240")).toBe(1_000_000n); // 1_000_000 * 1.2 -> capped
  });
});

describe("buildSwapSteps", () => {
  it("builds approval + swap when the route names an approvalAddress", () => {
    const { approval, swap } = buildSwapSteps(asQuote(), "0xf76e6B0920e9332fF4410f6dD53F01722AbC71a3");
    expect(approval).not.toBeNull();
    expect(approval!.kind).toBe("approve");
    expect(approval!.to.toLowerCase()).toBe(
      "0x3600000000000000000000000000000000000000",
    );
    // approve(address,uint256) selector + encoded spender + amount
    expect(approval!.data.startsWith("0x095ea7b3")).toBe(true);
    expect(approval!.data.slice(10, 74)).toBe(
      "0000000000000000000000001111111111111111111111111111111111111111",
    );
    expect(approval!.data.slice(74, 138)).toBe(
      "000000000000000000000000000000000000000000000000000000000007a120",
    ); // 500_000
    expect(approval!.gas).toBe(120_000n);
    expect(approval!.description).toContain("0.5 USDC");

    expect(swap.kind).toBe("swap");
    expect(swap.to).toBe(TX_REQ.to);
    expect(swap.data).toBe(TX_REQ.data);
    expect(swap.gas).toBe(240_000n); // 200_000 + 20%
    expect(swap.description).toContain("0.5 USDC");
    expect(swap.description).toContain("0.4463 EURC");
  });

  it("omits the approval step when the route needs none", () => {
    const body = quoteBody({ estimate: { executionDuration: 12 } });
    const s = parseLifiQuoteResponse(200, body);
    if (s.status !== "quote") throw new Error("fixture broken");
    const { approval } = buildSwapSteps(s.quote, "0xf76e6B0920e9332fF4410f6dD53F01722AbC71a3");
    expect(approval).toBeNull();
  });

  it("refuses routes that require native value", () => {
    const body = quoteBody({
      transactionRequest: { ...TX_REQ, value: "0x1" },
    });
    const s = parseLifiQuoteResponse(200, body);
    if (s.status !== "quote") throw new Error("fixture broken");
    expect(() =>
      buildSwapSteps(s.quote, "0xf76e6B0920e9332fF4410f6dD53F01722AbC71a3"),
    ).toThrow(/native value/);
  });

  it("never eth_estimateGas: gas is derived from LI.FI's gasLimit only", () => {
    const { swap } = buildSwapSteps(asQuote(), "0xf76e6B0920e9332fF4410f6dD53F01722AbC71a3");
    // 200_000 gasLimit -> exactly 240_000 with the buffer; estimation would
    // produce a different, chain-dependent number.
    expect(swap.gas).toBe((BigInt(TX_REQ.gasLimit) * 120n) / 100n);
  });
});
