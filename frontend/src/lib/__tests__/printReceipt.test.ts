import { describe, expect, it } from "vitest";
import {
  buildPrintModel,
  eventLabel,
  formatBaseUnits,
  formatUnixIso,
  txExplorerUrl,
  type PrintReceiptInput,
} from "../printReceipt";

/**
 * Receipt print model — the data mapping behind the Print / PDF view.
 * Tests the real mapping from src/lib/printReceipt.ts. The print model must
 * be a verbatim, lossless snapshot of the loaded receipt: nothing invented,
 * nothing dropped, optional blocks degrading to null/empty rather than
 * placeholder text.
 */

const PID =
  "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const TX = "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";

function baseInput(over: Partial<PrintReceiptInput> = {}): PrintReceiptInput {
  return {
    paymentId: PID,
    status: "ATTESTED",
    buyer: "0xBuyer000000000000000000000000000000000001",
    seller: "0xSeller00000000000000000000000000000000002",
    amount: "1500000",
    token: "USDC",
    deadline: 1760500000,
    termsHash:
      "0xcccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
    terms: { buyer: "0x1", price: "1500000" },
    outputHash:
      "0xdddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd",
    attestedAt: 1760400000,
    flagReasonHash: null,
    flaggedBy: null,
    escrow: "0x97f233865ae84DC7475F6D7CA404930654580CB5",
    timeline: [
      {
        event: "RaincheckOpened",
        txHash: TX,
        explorerUrl: null,
        memoIndex: 3,
        blockTime: 1760300000,
      },
      {
        event: "RaincheckAttested",
        txHash: TX,
        explorerUrl: "https://explorer.arc.io/tx/" + TX,
        memoIndex: null,
        blockTime: "1760400000",
      },
    ],
    ...over,
  };
}

describe("formatBaseUnits", () => {
  it("converts 6-decimal base units to a display string", () => {
    expect(formatBaseUnits("1500000")).toBe("1.5");
    expect(formatBaseUnits("1000000")).toBe("1");
    expect(formatBaseUnits("1")).toBe("0.000001");
    expect(formatBaseUnits("0")).toBe("0");
  });
  it("passes malformed input through instead of throwing", () => {
    expect(formatBaseUnits("abc")).toBe("abc");
    expect(formatBaseUnits("")).toBe("");
  });
});

describe("formatUnixIso", () => {
  it("formats unix seconds (number or string) as ISO", () => {
    expect(formatUnixIso(1760500000)).toBe("2025-10-15T03:46:40.000Z");
    expect(formatUnixIso("1760500000")).toBe("2025-10-15T03:46:40.000Z");
  });
  it("returns null for missing input", () => {
    expect(formatUnixIso(null)).toBeNull();
    expect(formatUnixIso(undefined)).toBeNull();
    expect(formatUnixIso("")).toBeNull();
  });
});

describe("eventLabel / txExplorerUrl", () => {
  it("maps known chain events to plain-language labels", () => {
    expect(eventLabel("RaincheckOpened")).toBe(
      "Receipt opened — funds locked in escrow",
    );
    expect(eventLabel("RaincheckVoided")).toBe(
      "Receipt voided — buyer refunded",
    );
  });
  it("falls back to the raw event name for unknown events", () => {
    expect(eventLabel("SomeFutureEvent")).toBe("SomeFutureEvent");
  });
  it("builds full explorer URLs (paper can't click short links)", () => {
    expect(txExplorerUrl(TX)).toBe(`https://explorer.arc.io/tx/${TX}`);
  });
});

describe("buildPrintModel", () => {
  it("maps every receipt field verbatim — nothing invented, nothing dropped", () => {
    const m = buildPrintModel(baseInput());
    expect(m.paymentId).toBe(PID);
    expect(m.status).toBe("ATTESTED");
    expect(m.statusMeaning).toBe(
      "seller says delivered, challenge window open",
    );
    expect(m.buyer).toContain("0xBuyer");
    expect(m.seller).toContain("0xSeller");
    expect(m.amount).toBe("1.5");
    expect(m.amountBaseUnits).toBe("1500000");
    expect(m.token).toBe("USDC");
    expect(m.deadlineIso).toBe("2025-10-15T03:46:40.000Z");
    expect(m.outputHash).toContain("0xdddd");
    expect(m.attestedAtIso).toBe("2025-10-14T00:00:00.000Z");
    expect(m.escrow).toBe("0x97f233865ae84DC7475F6D7CA404930654580CB5");
    expect(m.termsJson).toContain('"price": "1500000"');
  });

  it("maps the timeline with labels, full explorer URLs, and memo indexes", () => {
    const m = buildPrintModel(baseInput());
    expect(m.timeline).toHaveLength(2);
    expect(m.timeline[0].label).toBe(
      "Receipt opened — funds locked in escrow",
    );
    expect(m.timeline[0].event).toBe("RaincheckOpened");
    // No explorerUrl served → derived from the tx hash, full URL.
    expect(m.timeline[0].explorerUrl).toBe(`https://explorer.arc.io/tx/${TX}`);
    expect(m.timeline[0].memoIndex).toBe(3);
    expect(m.timeline[0].blockTimeIso).toBe("2025-10-12T20:13:20.000Z");
    // Served explorerUrl is kept as-is.
    expect(m.timeline[1].explorerUrl).toBe(`https://explorer.arc.io/tx/${TX}`);
    expect(m.timeline[1].memoIndex).toBeNull();
  });

  it("defaults the token to USDC when absent (pre-multi-asset receipts)", () => {
    const m = buildPrintModel(baseInput({ token: undefined }));
    expect(m.token).toBe("USDC");
  });

  it("omits the oracle block when the indexer serves none", () => {
    const m = buildPrintModel(baseInput({ oracle: undefined }));
    expect(m.oraclePresent).toBe(false);
    expect(m.oracleJson).toBeNull();
    const m2 = buildPrintModel(baseInput({ oracle: null }));
    expect(m2.oraclePresent).toBe(false);
  });

  it("passes the oracle block through verbatim when present", () => {
    const oracle = {
      attester: "0xOracle00000000000000000000000000000000003",
      reportHash: "0xeeee",
      blockNumber: 25960000,
    };
    const m = buildPrintModel(baseInput({ oracle }));
    expect(m.oraclePresent).toBe(true);
    expect(m.oracleJson).toContain("0xOracle00000000000000000000000000000000003");
    expect(m.oracleJson).toContain("25960000");
  });

  it("degrades optional blocks to null instead of placeholder text", () => {
    const m = buildPrintModel(
      baseInput({
        outputHash: null,
        attestedAt: null,
        terms: null,
        deadline: null,
        timeline: [],
        escrow: null,
      }),
    );
    expect(m.outputHash).toBeNull();
    expect(m.attestedAtIso).toBeNull();
    expect(m.termsJson).toBeNull();
    expect(m.deadlineIso).toBeNull();
    expect(m.timeline).toEqual([]);
    expect(m.escrow).toBeNull();
  });

  it("stamps the print time", () => {
    const before = new Date().toISOString();
    const m = buildPrintModel(baseInput());
    expect(m.printedAtIso >= before).toBe(true);
  });
});
