import { describe, expect, it } from "vitest";
import {
  exportFilename,
  receiptsToCsv,
  receiptsToJson,
  EXPORT_COLUMNS,
} from "../export";
import type { Receipt } from "../receipts";

/**
 * Receipt export — CSV/JSON of the live list. Tests the real helpers from
 * src/lib/export.ts; no test-only copies. Exported data must be a verbatim
 * snapshot of the input: nothing invented, nothing dropped.
 */
const R1: Receipt = {
  paymentId: "0xaaa",
  seller: "0xsss",
  buyer: "0xbbb",
  amount: "1500000",
  status: "OPEN",
  token: "USDC",
  updatedAt: 1728850000000,
};
const R2: Receipt = {
  paymentId: "0xccc",
  seller: "0xsss",
  amount: "2500",
  status: "VOIDED",
  token: "EURC",
  // no buyer, no updatedAt — columns stay present but empty
};

describe("receiptsToCsv", () => {
  it("emits the header plus one row per receipt, newest first", () => {
    const csv = receiptsToCsv([R1, R2]);
    const lines = csv.trim().split("\n");
    expect(lines[0]).toBe(EXPORT_COLUMNS.join(","));
    expect(lines).toHaveLength(3);
    expect(lines[1]).toContain("0xaaa");
    expect(lines[1]).toContain("1500000");
    expect(lines[1]).toContain("USDC");
    expect(lines[2]).toContain("0xccc");
    expect(lines[2]).toContain("EURC");
  });

  it("keeps every column present even when fields are missing", () => {
    const row = receiptsToCsv([R2]).trim().split("\n")[1];
    // paymentId,seller,buyer,amount_base_units,token,status,updatedAt_iso
    expect(row.split(",")).toHaveLength(EXPORT_COLUMNS.length);
    expect(row).toContain(",,"); // empty buyer
  });

  it("renders updatedAt as ISO-8601", () => {
    const row = receiptsToCsv([R1]).trim().split("\n")[1];
    expect(row).toContain(new Date(1728850000000).toISOString());
  });

  it("quotes cells containing commas or quotes instead of corrupting", () => {
    const tricky: Receipt = {
      ...R1,
      seller: '0x"we,ird"',
    };
    const row = receiptsToCsv([tricky]).trim().split("\n")[1];
    expect(row).toContain('"0x""we,ird"""');
  });

  it("defaults a missing token to USDC (pre-multi-asset receipts)", () => {
    const row = receiptsToCsv([{ ...R1, token: undefined }])
      .trim()
      .split("\n")[1];
    expect(row).toContain(",USDC,");
  });
});

describe("receiptsToJson", () => {
  it("round-trips the receipts verbatim", () => {
    const parsed = JSON.parse(receiptsToJson([R1, R2]));
    expect(parsed).toEqual([R1, R2]);
  });
});

describe("exportFilename", () => {
  it("produces a dated, extension-correct filename", () => {
    expect(exportFilename("csv")).toMatch(/^raincheck-receipts-\d{8}\.csv$/);
    expect(exportFilename("json")).toMatch(/^raincheck-receipts-\d{8}\.json$/);
  });
});
