import { describe, expect, it, vi } from "vitest";
import {
  SIMULATION_LABEL,
  builtTxToSimulationTarget,
  previewToSimulationTarget,
  simulate,
  type SimulationTarget,
} from "../simulate";
import { encodeFunctionCall } from "../tx";
import type { ActionTxPreview } from "../chain";

/**
 * Pre-send eth_call simulation — src/lib/simulate.ts with a mocked fetch.
 * fetchImpl is the module's own test seam: the tests assert what the REAL
 * eth_call request would carry (unwrapped inner calldata against the escrow
 * contract — never the memo wrapper) and how each RPC outcome maps to the
 * UI states (pass / block-with-reason / advisory-unavailable).
 */

const ESCROW = "0x97f233865ae84DC7475F6D7CA404930654580CB5" as `0x${string}`;
const MEMO = "0x5294E9927c3306DcBaDb03fe70b92e01cCede505" as `0x${string}`;
const INNER = ("0xabcdef" + "00".repeat(100)) as `0x${string}`;
const OUTER = ("0x123456" + "ff".repeat(200)) as `0x${string}`;
const FROM = "0x1111111111111111111111111111111111111111" as `0x${string}`;

const PREVIEW = {
  kind: "capture",
  label: "Capture",
  to: MEMO,
  data: OUTER,
  value: "0x0",
  gas: "150000",
  gasHex: "0x249f0",
  chainId: 5042,
  inner: {
    target: ESCROW,
    function: "capture(bytes32)",
    args: ["0xpid"],
  },
  innerData: INNER,
  memoId: "0xmid" as `0x${string}`,
} as unknown as ActionTxPreview;

function okResponse(result: string) {
  return { json: async () => ({ result }) } as Response;
}
function errResponse(error: unknown) {
  return { json: async () => ({ error }) } as Response;
}

/** Error(string) revert data for a contract require string. */
function errorStringData(reason: string): string {
  return encodeFunctionCall("Error(string)", ["string"], [reason]);
}

describe("SIMULATION_LABEL", () => {
  it("states the memo wrapper exclusion honestly", () => {
    expect(SIMULATION_LABEL).toContain("memo wrapper excluded");
    expect(SIMULATION_LABEL).toContain("applied at signing");
  });
});

describe("previewToSimulationTarget", () => {
  it("targets the INNER escrow calldata — never the memo wrapper", () => {
    const t = previewToSimulationTarget(PREVIEW);
    expect(t.to).toBe(ESCROW); // escrow, NOT the Memo contract
    expect(t.data).toBe(INNER); // inner calldata, NOT the wrapped bytes
    expect(t.data).not.toBe(OUTER);
    expect(t.to).not.toBe(MEMO);
    expect(t.kind).toBe("capture");
  });
  it("maps every ActionKind to its tx.ts TxKind for per-action copy", () => {
    const kinds = ["attest", "flag", "void", "voidAfterDeadline"] as const;
    const expected = ["attestDelivery", "flagNonDelivery", "void", "voidAfterDeadline"] as const;
    kinds.forEach((k, i) => {
      expect(
        previewToSimulationTarget({ ...PREVIEW, kind: k }).kind,
      ).toBe(expected[i]);
    });
  });
});

describe("builtTxToSimulationTarget", () => {
  it("uses the F1 BuiltTx inner fields", () => {
    const t = builtTxToSimulationTarget({
      kind: "authorize",
      innerTarget: ESCROW,
      innerCalldata: INNER,
    } as never);
    expect(t).toEqual({ to: ESCROW, data: INNER, kind: "authorize" });
  });
});

describe("simulate — request shape", () => {
  it("eth_calls the unwrapped escrow step with the wallet as from", async () => {
    const fetchImpl = vi.fn(async () => okResponse("0x"));
    const target: SimulationTarget = { to: ESCROW, data: INNER, kind: "capture" };
    const out = await simulate(target, { from: FROM, fetchImpl });
    expect(out).toEqual({ ok: true });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(typeof url).toBe("string");
    const payload = JSON.parse(String(init.body));
    expect(payload.method).toBe("eth_call");
    expect(payload.params[1]).toBe("latest");
    const call = payload.params[0];
    expect(call.to).toBe(ESCROW);
    expect(call.data).toBe(INNER);
    expect(call.from).toBe(FROM);
  });

  it("omits from when no wallet is connected (permissionless actions)", async () => {
    const fetchImpl = vi.fn(async () => okResponse("0x"));
    await simulate({ to: ESCROW, data: INNER, kind: "void" }, { fetchImpl });
    const [, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    const call = JSON.parse(String(init.body)).params[0];
    expect("from" in call).toBe(false);
  });
});

describe("simulate — outcomes", () => {
  it("ok:true when eth_call returns data", async () => {
    const out = await simulate(
      { to: ESCROW, data: INNER, kind: "capture" },
      { fetchImpl: async () => okResponse("0x") },
    );
    expect(out.ok).toBe(true);
  });

  it("blocks with user words when the escrow step reverts with a known require string", async () => {
    const out = await simulate(
      { to: ESCROW, data: INNER, kind: "capture" },
      {
        fetchImpl: async () =>
          errResponse({
            code: 3,
            message: "execution reverted",
            data: errorStringData("challenge window open"),
          }),
      },
    );
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.kind).toBe("revert");
    expect(out.requireString).toBe("challenge window open");
    // Per-action user words for capture (not the generic copy).
    expect(out.userMessage).toContain("buyer still has time");
    expect(out.technical).toContain("challenge window open");
  });

  it("decodes nested error.data objects (viem-style RPC errors)", async () => {
    const out = await simulate(
      { to: ESCROW, data: INNER, kind: "voidAfterDeadline" },
      {
        fetchImpl: async () =>
          errResponse({
            code: 3,
            message: "execution reverted",
            data: { data: errorStringData("deadline not passed") },
          }),
      },
    );
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.kind).toBe("revert");
    expect(out.requireString).toBe("deadline not passed");
    expect(out.userMessage).toContain("hasn't passed yet");
  });

  it("maps a bare 'execution reverted: <reason>' message to user words", async () => {
    const out = await simulate(
      { to: ESCROW, data: INNER, kind: "flagNonDelivery" },
      {
        fetchImpl: async () =>
          errResponse({ code: 3, message: "execution reverted: not ATTESTED" }),
      },
    );
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.kind).toBe("revert");
    expect(out.requireString).toBe("not ATTESTED");
    expect(out.userMessage).toContain("hasn't delivered yet");
  });

  it("falls back to the no-reason copy when nothing is decodable", async () => {
    const out = await simulate(
      { to: ESCROW, data: INNER, kind: "attestDelivery" },
      { fetchImpl: async () => errResponse({ code: -32000, message: "boom" }) },
    );
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.kind).toBe("revert");
    expect(out.userMessage).toContain("no reason was returned");
    expect(out.requireString).toBeNull();
  });

  it("is advisory (unavailable, never blocking) when the RPC can't be reached", async () => {
    const out = await simulate(
      { to: ESCROW, data: INNER, kind: "capture" },
      {
        fetchImpl: async () => {
          throw new Error("fetch failed");
        },
      },
    );
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.kind).toBe("unavailable");
    expect(out.userMessage).toContain("couldn't reach");
    expect(out.userMessage).toContain("can still sign");
  });
});
