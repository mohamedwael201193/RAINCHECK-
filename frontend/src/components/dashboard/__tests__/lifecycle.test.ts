import { describe, expect, it } from "vitest";
import { lifecycleSteps } from "../Lifecycle";

/**
 * Lifecycle position — the escrow state machine made visible.
 * Tests the pure `lifecycleSteps` from the vendored-adjacent dashboard
 * Lifecycle component. The machine: OPEN → ATTESTED → CAPTURED,
 * ATTESTED → FLAGGED → VOIDED, OPEN → VOIDED on deadline.
 */
function states(status: string): Record<string, string> {
  return Object.fromEntries(
    lifecycleSteps(status).map((s) => [s.key, s.state]),
  );
}

describe("lifecycleSteps", () => {
  it("OPEN: authorized done, attest current, settle todo", () => {
    expect(states("OPEN")).toEqual({
      authorize: "done",
      attest: "current",
      capture: "todo",
      void: "todo",
    });
  });

  it("ATTESTED: capture and void both current (challenge open)", () => {
    expect(states("ATTESTED")).toEqual({
      authorize: "done",
      attest: "done",
      capture: "current",
      void: "current",
    });
  });

  it("FLAGGED: capture skipped, void current", () => {
    const s = states("FLAGGED");
    expect(s.capture).toBe("skipped");
    expect(s.void).toBe("current");
    expect(s.attest).toBe("done");
  });

  it("CAPTURED: capture done, void skipped", () => {
    const s = states("CAPTURED");
    expect(s.capture).toBe("done");
    expect(s.void).toBe("skipped");
  });

  it("VOIDED: void done, capture skipped", () => {
    const s = states("VOIDED");
    expect(s.void).toBe("done");
    expect(s.capture).toBe("skipped");
  });

  it("always returns the four flow steps in order", () => {
    const keys = lifecycleSteps("OPEN").map((s) => s.key);
    expect(keys).toEqual(["authorize", "attest", "capture", "void"]);
  });

  it("is case-insensitive and never throws on unknown input", () => {
    expect(states("open").attest).toBe("current");
    expect(lifecycleSteps("SOMETHING_ELSE")).toHaveLength(4);
  });
});
