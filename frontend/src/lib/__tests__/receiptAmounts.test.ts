import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchReceipts } from "../receipts";

/**
 * P2 regression: the Receipt API serves the ORIGINAL escrowed amount as
 * `amountUSDCBase` for every status. The dashboard must show that amount
 * on voided/captured receipts — never a bare "0".
 */
const API_ROW = {
  paymentId: "0xabc",
  seller: "0xsss",
  buyer: "0xbbb",
  amountUSDCBase: "10000",
  amountUSDC: "0.010000",
  status: "VOIDED",
  token: "EURC",
  updatedAt: 1728850000000,
};

function stubApi(body: unknown) {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      statusText: "OK",
      json: () => Promise.resolve(body),
    }),
  );
  vi.stubEnv("VITE_API_URL", "http://localhost:3000");
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("fetchReceipts amount coercion (P2)", () => {
  it("maps amountUSDCBase to amount for settled receipts", async () => {
    stubApi({ receipts: [API_ROW] });
    const [r] = await fetchReceipts();
    expect(r.amount).toBe("10000");
    expect(r.status).toBe("VOIDED");
    expect(r.token).toBe("EURC");
  });

  it("falls back to legacy `amount` when amountUSDCBase is absent", async () => {
    const { amountUSDCBase: _drop, ...legacy } = API_ROW;
    stubApi({ receipts: [{ ...legacy, amount: "2500" }] });
    const [r] = await fetchReceipts();
    expect(r.amount).toBe("2500");
  });

  it("never yields a bare zero when the API reports a real amount", async () => {
    stubApi({
      receipts: [
        { ...API_ROW, status: "CAPTURED" },
        { ...API_ROW, paymentId: "0xdef", status: "OPEN" },
      ],
    });
    const receipts = await fetchReceipts();
    for (const r of receipts) {
      expect(r.amount).not.toBe("0");
    }
  });
});
