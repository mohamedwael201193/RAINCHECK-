// API contract tests (supertest) against a seeded in-memory SQLite —
// running the REAL production Express app (src/api/app.ts createApp), not a
// stand-in. The ReceiptSource is backed by the seeded SQLite; every seeded row
// was derived from fixture logs through the production receipt builder, so the
// whole path under test is: fixtures -> production builder -> SQLite ->
// production routes. No mock data in any production path.
import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import { createHash } from "node:crypto";
import type Database from "better-sqlite3";
import { jcs } from "../src/api/jcs.js";
import { createApp } from "../src/api/app.js";
import type { ReceiptSource, ReceiptView } from "../src/api/types.js";
import { ESCROW_ADDRESS } from "../src/config.js";
import { buildSeedDb } from "./lib/seed.js";

/** TEST-LOCAL ReceiptSource over the seeded SQLite (implements the documented interface). */
class SqliteReceiptSource implements ReceiptSource {
  constructor(private db: Database.Database) {}

  private toView(row: any): ReceiptView {
    return {
      receipt: JSON.parse(row.receipt),
      receiptHash: row.receiptHash,
      timeline: JSON.parse(row.timeline),
      openedAt: row.openedAt,
      updatedAt: row.updatedAt,
      buyer: row.buyer,
      seller: row.seller,
    };
  }

  async getReceipt(paymentId: string): Promise<ReceiptView | undefined> {
    const row = this.db.prepare("SELECT * FROM receipts WHERE paymentId = ?").get(paymentId.toLowerCase());
    return row ? this.toView(row) : undefined;
  }

  async listReceipts(): Promise<ReceiptView[]> {
    return (this.db.prepare("SELECT * FROM receipts").all() as any[]).map((r) => this.toView(r));
  }

  latestIndexedBlock(): bigint | null {
    return null;
  }

  async refresh(): Promise<void> {}
}

function hashOfReceipt(receipt: unknown): string {
  return createHash("sha256").update(jcs(receipt), "utf8").digest("hex");
}

let app: ReturnType<typeof createApp>;

before(() => {
  const db = buildSeedDb();
  app = createApp(new SqliteReceiptSource(db));
});

describe("GET /api/receipts", () => {
  it("returns the seeded rows newest-first", async () => {
    const res = await request(app).get("/api/receipts").expect(200);
    assert.equal(res.body.total, 4, "seed has 4 receipts");
    assert.ok(Array.isArray(res.body.receipts));
    assert.equal(res.body.receipts.length, 4);
    const openedAts = res.body.receipts.map((r: any) => r.openedAt);
    assert.deepEqual([...openedAts].sort((a, b) => b - a), openedAts, "must be newest-first by openedAt");
    assert.deepEqual(
      res.body.receipts.map((r: any) => r.status),
      ["VOIDED", "CAPTURED", "ATTESTED", "OPEN"],
    );
    for (const row of res.body.receipts) {
      assert.match(row.paymentId, /^0x[0-9a-f]{64}$/);
      assert.match(row.receiptHash, /^[0-9a-f]{64}$/);
      assert.equal(row.amountUSDCBase, "1000");
      // Multi-asset: every summary names its token + originating escrow.
      // The seeded source predates multi-asset, so all rows are USDC.
      assert.equal(row.token, "USDC");
      assert.equal(row.escrow, ESCROW_ADDRESS.toLowerCase());
    }
  });

  it("served receiptHashes verify against SHA-256(JCS(receipt))", async () => {
    const list = await request(app).get("/api/receipts").expect(200);
    for (const summary of list.body.receipts) {
      const full = await request(app).get(`/api/receipts/${summary.paymentId}`).expect(200);
      assert.equal(full.body.receiptHash, summary.receiptHash, "list and detail hashes must agree");
      assert.equal(hashOfReceipt(full.body.receipt), summary.receiptHash, `hash mismatch for ${summary.paymentId}`);
      assert.equal(full.body.receipt.paymentId, summary.paymentId);
      assert.equal(full.body.token, summary.token, "detail and list must agree on the token");
      assert.equal(full.body.escrow, summary.escrow, "detail and list must agree on the escrow");
    }
  });

  it("status filter returns only matching rows", async () => {
    const res = await request(app).get("/api/receipts").query({ status: "VOIDED" }).expect(200);
    assert.equal(res.body.total, 1);
    assert.equal(res.body.receipts[0].status, "VOIDED");

    const res2 = await request(app).get("/api/receipts").query({ status: "open" }).expect(200);
    assert.equal(res2.body.total, 1, "filter is case-insensitive");
    assert.equal(res2.body.receipts[0].status, "OPEN");
  });

  it("rejects an unknown status filter instead of returning unfiltered data", async () => {
    const res = await request(app).get("/api/receipts").query({ status: "BOGUS" }).expect(400);
    assert.match(res.body.error, /status must be one of/);
  });
});

describe("GET /api/receipts/:paymentId", () => {
  it("returns the full receipt, hash and timeline for a known paymentId", async () => {
    const list = await request(app).get("/api/receipts").expect(200);
    const known = list.body.receipts[0].paymentId as string;
    const res = await request(app).get(`/api/receipts/${known}`).expect(200);
    assert.equal(res.body.receipt.paymentId, known);
    assert.match(res.body.receiptHash, /^[0-9a-f]{64}$/);
    assert.ok(Array.isArray(res.body.timeline) && res.body.timeline.length > 0, "timeline must be present");
    assert.equal(res.body.receipt.specVersion, "raincheck-receipt/v1");
  });

  it("404s on an unknown paymentId and never invents a receipt", async () => {
    const unknown = "0x" + "ff".repeat(32);
    const res = await request(app).get(`/api/receipts/${unknown}`).expect(404);
    assert.equal(res.body.error, "receipt not found");
    assert.ok(
      !("receipt" in res.body) && !("receiptHash" in res.body) && !("timeline" in res.body),
      "404 response must not contain synthesized receipt data",
    );
  });

  it("400s on a malformed paymentId", async () => {
    const res = await request(app).get("/api/receipts/not-a-hash").expect(400);
    assert.match(res.body.error, /paymentId/);
  });
});
