// Seeded in-memory SQLite for API tests — TEST-LOCAL.
// Every row is derived from fixture logs through the PRODUCTION receipt builder
// (derive.ts -> src/api chainStore.buildCanonicalReceipt + receiptHashOf), so all
// seeded receiptHashes are reproducible from the fixtures. The API tests then run
// the REAL Express app (src/api/app.ts) over a ReceiptSource backed by this DB.
import Database from "better-sqlite3";
import { receiptHashOf } from "../../src/api/chainStore.js";
import { deriveViewFromLogs, type FixtureLog } from "./derive.js";
import { voidPathLogs, deliverPathLogs } from "../fixtures/logs.js";

// Deep-clone a fixture log set under a fresh synthetic paymentId + tx hashes,
// so each seed row is a distinct payment.
function remapIds(logs: FixtureLog[], paymentId: string, salt: number): FixtureLog[] {
  const txMap = new Map<string, string>();
  const txFor = (tx: string): string => {
    let mapped = txMap.get(tx);
    if (!mapped) {
      mapped = tx.slice(0, 64) + salt.toString(16).padStart(2, "0");
      txMap.set(tx, mapped);
    }
    return mapped;
  };
  return logs.map((l) => ({
    ...l,
    txHash: txFor(l.txHash),
    args: { ...l.args, paymentId },
  }));
}

export function buildSeedDb(): Database.Database {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE receipts (
      paymentId   TEXT PRIMARY KEY,
      receipt     TEXT NOT NULL,
      receiptHash TEXT NOT NULL,
      openedAt    INTEGER NOT NULL,
      updatedAt   INTEGER NOT NULL,
      buyer       TEXT NOT NULL,
      seller      TEXT NOT NULL,
      timeline    TEXT NOT NULL
    )
  `);

  // Truncations of the fixture log sets give the earlier lifecycle states.
  const seeds: Array<{ logs: FixtureLog[]; openedAt: number }> = [
    { logs: voidPathLogs, openedAt: 1791957000 }, // VOIDED, newest
    { logs: deliverPathLogs, openedAt: 1791956000 }, // CAPTURED
    { logs: deliverPathLogs.slice(0, 3), openedAt: 1791955000 }, // ATTESTED
    { logs: deliverPathLogs.slice(0, 1), openedAt: 1791954000 }, // OPEN, oldest
  ];
  const paymentIds = ["0x" + "d0".repeat(32), "0x" + "d1".repeat(32), "0x" + "d2".repeat(32), "0x" + "d3".repeat(32)];

  const insert = db.prepare(
    "INSERT INTO receipts (paymentId, receipt, receiptHash, openedAt, updatedAt, buyer, seller, timeline) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
  );
  seeds.forEach((s, i) => {
    const view = deriveViewFromLogs(remapIds(s.logs, paymentIds[i]!, i), s.openedAt, s.openedAt);
    const receiptHash = receiptHashOf(view.receipt);
    insert.run(
      view.receipt.paymentId,
      JSON.stringify(view.receipt),
      receiptHash,
      view.openedAt,
      view.updatedAt,
      view.buyer,
      view.seller,
      JSON.stringify(view.timeline),
    );
  });
  return db;
}
