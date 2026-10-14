// Multi-asset indexer store tests — one escrow instance per token.
//
// Covers the Phase-2 store changes: escrowAddress bookkeeping on receipts +
// transitions, the cross-escrow paymentId collision guard (paymentId
// uniqueness is enforced per escrow CONTRACT, so the same 32 bytes can open
// on both instances and must never be silently merged), and the migration
// that backfills pre-multi-asset databases to the USDC production escrow.
//
// These run the PRODUCTION IndexerStore (better-sqlite3, in-memory or tmp
// file). No chain access.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { IndexerStore } from "../src/indexer/store.js";
import { ESCROW_ADDRESS, ESCROW_ADDRESS_EURC } from "../src/config.js";

const USDC_ESCROW = ESCROW_ADDRESS.toLowerCase();
const EURC_ESCROW = ESCROW_ADDRESS_EURC.toLowerCase();
const PID = "0x" + "ab".repeat(32);

function openArgs(paymentId: string = PID): Record<string, unknown> {
  return {
    paymentId,
    buyer: "0x" + "11".repeat(20),
    seller: "0x" + "22".repeat(20),
    termsHash: "0x" + "33".repeat(32),
    amount: "1000000",
    deadline: 1791957337,
  };
}

describe("multi-asset indexer store", () => {
  it("records the originating escrow address on RaincheckOpened", () => {
    const store = new IndexerStore(":memory:");
    const r = store.applyEvent("RaincheckOpened", "OPEN", openArgs(), 25_962_300, EURC_ESCROW);
    assert.equal(r.ok, true);
    const row = store.getReceipt(PID)!;
    assert.equal(row.escrowAddress, EURC_ESCROW);
    assert.equal(row.status, "OPEN");
    store.close();
  });

  it("refuses a cross-escrow open for the same paymentId (no silent merge)", () => {
    const store = new IndexerStore(":memory:");
    assert.equal(
      store.applyEvent("RaincheckOpened", "OPEN", openArgs(), 25_956_400, USDC_ESCROW).ok,
      true,
    );
    const second = store.applyEvent(
      "RaincheckOpened",
      "OPEN",
      openArgs(),
      25_962_300,
      EURC_ESCROW,
    );
    assert.equal(second.ok, false);
    assert.match(second.reason ?? "", /cross-escrow/);
    // First-wins: the row still belongs to the USDC escrow, untouched.
    const row = store.getReceipt(PID)!;
    assert.equal(row.escrowAddress, USDC_ESCROW);
    assert.equal(row.createdBlock, 25_956_400);
    store.close();
  });

  it("refuses cross-escrow lifecycle events for a known paymentId", () => {
    const store = new IndexerStore(":memory:");
    store.applyEvent("RaincheckOpened", "OPEN", openArgs(), 25_956_400, USDC_ESCROW);
    const r = store.applyEvent(
      "DeliveryAttested",
      "ATTESTED",
      { paymentId: PID, outputHash: "0x" + "44".repeat(32), attestedAt: 1791957400 },
      25_962_310,
      EURC_ESCROW,
    );
    assert.equal(r.ok, false);
    assert.match(r.reason ?? "", /cross-escrow/);
    assert.equal(store.getReceipt(PID)!.status, "OPEN");
    // Same-escrow lifecycle events still apply.
    const ok = store.applyEvent(
      "DeliveryAttested",
      "ATTESTED",
      { paymentId: PID, outputHash: "0x" + "44".repeat(32), attestedAt: 1791957400 },
      25_956_410,
      USDC_ESCROW,
    );
    assert.equal(ok.ok, true);
    assert.equal(store.getReceipt(PID)!.status, "ATTESTED");
    store.close();
  });

  it("transitions carry the originating escrow address", () => {
    const store = new IndexerStore(":memory:");
    store.applyEvent("RaincheckOpened", "OPEN", openArgs(), 25_962_300, EURC_ESCROW);
    assert.equal(
      store.insertTransition({
        paymentId: PID,
        event: "RaincheckOpened",
        txHash: "0x" + "55".repeat(32),
        blockNumber: 25_962_300,
        logIndex: 7,
        memoIndex: 1144,
        escrowAddress: EURC_ESCROW,
      }),
      true,
    );
    const t = store.getTransitions(PID);
    assert.equal(t.length, 1);
    assert.equal(t[0]!.escrowAddress, EURC_ESCROW);
    store.close();
  });

  it("migrates pre-multi-asset databases: backfills the USDC escrow", () => {
    // Build a database with the OLD schema (no escrowAddress columns), the
    // way it existed before multi-asset support.
    const dir = mkdtempSync(join(tmpdir(), "raincheck-migrate-"));
    const dbPath = join(dir, "old.db");
    const raw = new Database(dbPath);
    raw.exec(`
      CREATE TABLE receipts (
        paymentId TEXT PRIMARY KEY, buyer TEXT, seller TEXT, termsHash TEXT,
        amount TEXT, deadline INTEGER, outputHash TEXT, attestedAt INTEGER,
        flagReasonHash TEXT, status TEXT NOT NULL,
        createdBlock INTEGER NOT NULL, updatedBlock INTEGER NOT NULL
      );
      CREATE TABLE transitions (
        id INTEGER PRIMARY KEY AUTOINCREMENT, paymentId TEXT NOT NULL,
        event TEXT NOT NULL, txHash TEXT NOT NULL, blockNumber INTEGER NOT NULL,
        logIndex INTEGER NOT NULL, memoIndex INTEGER, UNIQUE (txHash, logIndex)
      );
      CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    `);
    raw
      .prepare(
        "INSERT INTO receipts (paymentId, buyer, seller, termsHash, amount, deadline, status, createdBlock, updatedBlock) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
      )
      .run(PID, "0x" + "11".repeat(20), "0x" + "22".repeat(20), "0x" + "33".repeat(32), "1000", 1791957337, "OPEN", 25_956_400, 25_956_400);
    raw
      .prepare(
        "INSERT INTO transitions (paymentId, event, txHash, blockNumber, logIndex, memoIndex) VALUES (?, ?, ?, ?, ?, ?)",
      )
      .run(PID, "RaincheckOpened", "0x" + "66".repeat(32), 25_956_400, 3, null);
    raw.close();

    // Opening through the production store runs the migration.
    const store = new IndexerStore(dbPath);
    const row = store.getReceipt(PID)!;
    assert.equal(row.status, "OPEN", "old row survives the migration");
    assert.equal(row.escrowAddress, USDC_ESCROW, "old row backfilled to the USDC escrow");
    const t = store.getTransitions(PID);
    assert.equal(t[0]!.escrowAddress, USDC_ESCROW, "old transition backfilled too");
    store.close();
  });
});
