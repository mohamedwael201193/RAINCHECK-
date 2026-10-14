// Re-derivability tests — bible §5.4: "every receipt it serves must be re-derivable
// from logs + Memo anchors alone" (Forge/CI test: "receipt re-derivable from logs alone").
// These run the PRODUCTION receipt construction path (src/api chainStore
// buildCanonicalReceipt + receiptHashOf) via the test-local fold in lib/derive.ts:
// build the same receipt from the SAME fixture logs twice, each time into a FRESH
// database (two independent in-memory SQLite instances), and require identical
// receiptHash values. Also requires order-independence: log delivery order must not
// change the derived receipt.
// TODO(B2): run these assertions against the real IndexerStore once src/indexer/
// compiles; the fold here mirrors that module's production logic exactly.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { createHash } from "node:crypto";
import { jcs } from "../src/api/jcs.js";
import { receiptHashOf } from "../src/api/chainStore.js";
import { deriveReceiptFromLogs, type FixtureLog } from "./lib/derive.js";
import { voidPathLogs, deliverPathLogs } from "./fixtures/logs.js";

function deriveFromFreshDb(logs: FixtureLog[]): string {
  const db = new Database(":memory:"); // fresh DB per derivation, as the indexer would use
  db.exec("CREATE TABLE logs (payload TEXT NOT NULL)");
  const insert = db.prepare("INSERT INTO logs (payload) VALUES (?)");
  for (const log of logs) insert.run(JSON.stringify(log));
  // Read back in rowid order (arbitrary w.r.t. chain order) — derivation must not care.
  const rows = db.prepare("SELECT payload FROM logs").all() as Array<{ payload: string }>;
  db.close();
  const readBack = rows.map((r) => JSON.parse(r.payload) as FixtureLog);
  return receiptHashOf(deriveReceiptFromLogs(readBack));
}

function shuffled<T>(arr: T[], seed: number): T[] {
  const out = [...arr];
  let s = seed;
  const rand = () => ((s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    const tmp = out[i]!;
    out[i] = out[j]!;
    out[j] = tmp;
  }
  return out;
}

describe("receipt re-derivable from logs alone", () => {
  it("void-path fixture: two fresh-DB derivations yield identical receiptHash", () => {
    const h1 = deriveFromFreshDb(voidPathLogs);
    const h2 = deriveFromFreshDb(voidPathLogs);
    assert.equal(h1, h2);
    assert.match(h1, /^[0-9a-f]{64}$/, "receiptHash must be lowercase hex sha256");
  });

  it("deliver-path fixture: two fresh-DB derivations yield identical receiptHash", () => {
    const h1 = deriveFromFreshDb(deliverPathLogs);
    const h2 = deriveFromFreshDb(deliverPathLogs);
    assert.equal(h1, h2);
    assert.match(h1, /^[0-9a-f]{64}$/);
  });

  it("derivation is independent of log delivery order", () => {
    const baseline = receiptHashOf(deriveReceiptFromLogs(voidPathLogs));
    for (const seed of [1, 7, 42]) {
      const hash = receiptHashOf(deriveReceiptFromLogs(shuffled(voidPathLogs, seed)));
      assert.equal(hash, baseline, `shuffled order (seed ${seed}) changed the receipt`);
    }
  });

  it("receiptHash == lowercase-hex(SHA-256(JCS(receipt))) by explicit recomputation", () => {
    const receipt = deriveReceiptFromLogs(voidPathLogs);
    const expected = createHash("sha256").update(jcs(receipt), "utf8").digest("hex");
    assert.equal(receiptHashOf(receipt), expected);
  });

  it("derived void-path receipt carries the bible §4.6 field shape and terminal VOIDED status", () => {
    const receipt = deriveReceiptFromLogs(voidPathLogs);
    assert.equal(receipt.specVersion, "raincheck-receipt/v1");
    assert.equal(receipt.status, "VOIDED");
    assert.ok(
      receipt.delivery && "outputHash" in receipt.delivery,
      "voided receipt preserves the delivery attestation evidence",
    );
    assert.equal(receipt.paymentProof.payer, "0xbdfcee82bd42fefa58ee850b3709636a8b6b0034");
    assert.ok(
      receipt.anchors.every((a) => /^eip155:5042:0x[0-9a-f]{64}$/.test(a)),
      "anchors are <caip2>:<tx> refs",
    );
    assert.ok(
      receipt.anchors.includes("eip155:5042:0xf8ecf05d35d2c9b18675d48274877d4e569e6b72908bb2aad31ad8769b4fd60c"),
      "anchors bind the voiding tx",
    );
    assert.equal(receipt.oracle, null);
    assert.equal(receipt.policy, null);
    assert.equal(receipt.funding, null);
  });

  it("flagged mid-state derives FLAGGED status with nonDelivery evidence", () => {
    const receipt = deriveReceiptFromLogs(voidPathLogs.slice(0, 4));
    assert.equal(receipt.status, "FLAGGED");
    assert.ok(receipt.delivery && "nonDelivery" in receipt.delivery);
    assert.equal(receipt.delivery.nonDelivery.flaggedBy, "0xbdfcee82bd42fefa58ee850b3709636a8b6b0034");
  });

  it("deliver-path fixture derives terminal CAPTURED status", () => {
    const receipt = deriveReceiptFromLogs(deliverPathLogs);
    assert.equal(receipt.status, "CAPTURED");
    assert.ok(receipt.delivery && "outputHash" in receipt.delivery);
  });
});
