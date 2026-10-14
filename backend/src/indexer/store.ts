/**
 * RAINCHECK indexer — SQLite store (better-sqlite3).
 *
 * The store is a CACHE over chain logs. Every row is written from decoded
 * eth_getLogs entries (plus tx-receipt log pairing for memo indexes); nothing
 * is invented. rebuildFromScratch() wipes the DB and replays all logs, so any
 * receipt the API serves must be re-derivable from logs + Memo anchors alone.
 */
import Database from 'better-sqlite3';
import { defaultDbPath, ESCROW_ADDRESS } from './config.js';

export interface ReceiptRow {
  paymentId: string;
  buyer: string | null;
  seller: string | null;
  termsHash: string | null;
  amount: string | null; // decimal string, 6-decimal base units
  deadline: number | null; // unix seconds
  outputHash: string | null;
  attestedAt: number | null;
  flagReasonHash: string | null;
  status: string;
  createdBlock: number;
  updatedBlock: number;
  /** Originating escrow instance (lowercase). Internal bookkeeping — the
   *  canonical receipt (§4.6) is token-blind by design and never carries it.
   *  Rows written before multi-asset support are backfilled to the USDC
   *  production escrow on open (see migrate()). */
  escrowAddress: string | null;
}

export interface TransitionRow {
  paymentId: string;
  event: string;
  txHash: string;
  blockNumber: number;
  logIndex: number;
  memoIndex: number | null;
  /** Originating escrow instance (lowercase) — from the log's own address. */
  escrowAddress: string;
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS receipts (
  paymentId     TEXT PRIMARY KEY,
  buyer         TEXT,
  seller        TEXT,
  termsHash     TEXT,
  amount        TEXT,
  deadline      INTEGER,
  outputHash    TEXT,
  attestedAt    INTEGER,
  flagReasonHash TEXT,
  status        TEXT NOT NULL,
  createdBlock  INTEGER NOT NULL,
  updatedBlock  INTEGER NOT NULL,
  escrowAddress TEXT
);
CREATE TABLE IF NOT EXISTS transitions (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  paymentId   TEXT NOT NULL,
  event       TEXT NOT NULL,
  txHash      TEXT NOT NULL,
  blockNumber INTEGER NOT NULL,
  logIndex    INTEGER NOT NULL,
  memoIndex   INTEGER,
  escrowAddress TEXT,
  UNIQUE (txHash, logIndex)
);
CREATE INDEX IF NOT EXISTS idx_transitions_payment ON transitions (paymentId, blockNumber, logIndex);
CREATE TABLE IF NOT EXISTS meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
`;

export class IndexerStore {
  readonly db: Database.Database;

  constructor(dbPath: string = defaultDbPath()) {
    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.exec(SCHEMA);
    this.migrate();
  }

  /**
   * Additive migrations for databases created before a schema extension.
   * Multi-asset (2026-10-14): receipts/transitions gain escrowAddress.
   * Pre-multi-asset rows could only come from the USDC production escrow —
   * backfill them so the token derivation never sees a null it can't explain.
   */
  private migrate(): void {
    const columnsOf = (table: string): Set<string> =>
      new Set(
        (
          this.db
            .prepare(`PRAGMA table_info(${table})`)
            .all() as Array<{ name: string }>
        ).map((c) => c.name),
      );
    const usdc = ESCROW_ADDRESS.toLowerCase();
    if (!columnsOf('receipts').has('escrowAddress')) {
      this.db.exec('ALTER TABLE receipts ADD COLUMN escrowAddress TEXT');
      this.db
        .prepare('UPDATE receipts SET escrowAddress = ? WHERE escrowAddress IS NULL')
        .run(usdc);
    }
    if (!columnsOf('transitions').has('escrowAddress')) {
      this.db.exec('ALTER TABLE transitions ADD COLUMN escrowAddress TEXT');
      this.db
        .prepare('UPDATE transitions SET escrowAddress = ? WHERE escrowAddress IS NULL')
        .run(usdc);
    }
  }

  /** Drop everything — used by rebuildFromScratch() only. */
  wipe(): void {
    this.db.exec(
      'DROP TABLE IF EXISTS transitions; DROP TABLE IF EXISTS receipts; DROP TABLE IF EXISTS meta;',
    );
    this.db.exec(SCHEMA);
  }

  close(): void {
    this.db.close();
  }

  // ---- checkpoint -------------------------------------------------------

  getCheckpoint(): number | null {
    const row = this.db
      .prepare('SELECT value FROM meta WHERE key = ?')
      .get('checkpoint_block') as { value: string } | undefined;
    return row ? Number(row.value) : null;
  }

  setCheckpoint(blockNumber: number): void {
    this.db
      .prepare(
        'INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
      )
      .run('checkpoint_block', String(blockNumber));
  }

  // ---- receipts ---------------------------------------------------------

  getReceipt(paymentId: string): ReceiptRow | undefined {
    return this.db
      .prepare('SELECT * FROM receipts WHERE paymentId = ?')
      .get(paymentId.toLowerCase()) as ReceiptRow | undefined;
  }

  listReceipts(status?: string): ReceiptRow[] {
    if (status) {
      return this.db
        .prepare('SELECT * FROM receipts WHERE status = ? ORDER BY updatedBlock DESC')
        .all(status) as ReceiptRow[];
    }
    return this.db
      .prepare('SELECT * FROM receipts ORDER BY updatedBlock DESC')
      .all() as ReceiptRow[];
  }

  countReceipts(): number {
    return (this.db.prepare('SELECT COUNT(*) AS n FROM receipts').get() as { n: number }).n;
  }

  countTransitions(): number {
    return (this.db.prepare('SELECT COUNT(*) AS n FROM transitions').get() as { n: number })
      .n;
  }

  private upsertReceiptBase(row: ReceiptRow): void {
    this.db
      .prepare(
        `INSERT INTO receipts
           (paymentId, buyer, seller, termsHash, amount, deadline, outputHash,
            attestedAt, flagReasonHash, status, createdBlock, updatedBlock,
            escrowAddress)
         VALUES
           (@paymentId, @buyer, @seller, @termsHash, @amount, @deadline, @outputHash,
            @attestedAt, @flagReasonHash, @status, @createdBlock, @updatedBlock,
            @escrowAddress)
         ON CONFLICT(paymentId) DO UPDATE SET
           buyer=excluded.buyer, seller=excluded.seller, termsHash=excluded.termsHash,
           amount=excluded.amount, deadline=excluded.deadline, outputHash=excluded.outputHash,
           attestedAt=excluded.attestedAt, flagReasonHash=excluded.flagReasonHash,
           status=excluded.status, updatedBlock=excluded.updatedBlock,
           escrowAddress=excluded.escrowAddress`,
      )
      .run(row);
  }

  /** Apply one decoded escrow event to the receipts table. Status comes from the
   *  event NAME via EVENT_TO_STATUS — enum ordinals are never read.
   *
   *  Multi-asset guard: paymentId uniqueness is enforced per escrow CONTRACT,
   *  not per chain — the same 32 bytes can legitimately open on both the USDC
   *  and EURC instances. A row belongs to the escrow that opened it; events
   *  from any other escrow for the same paymentId are refused (never silently
   *  merged across tokens). */
  applyEvent(
    eventName: string,
    status: string,
    args: Record<string, unknown>,
    blockNumber: number,
    escrowAddress?: string,
  ): { ok: boolean; reason?: string } {
    const paymentId = String(args.paymentId).toLowerCase();
    const escrow = (escrowAddress ?? '').toLowerCase() || null;
    const existing = this.getReceipt(paymentId);

    if (eventName === 'RaincheckOpened') {
      if (existing) {
        if (existing.escrowAddress && escrow && existing.escrowAddress !== escrow) {
          // Same paymentId opened on a second escrow instance: distinct
          // receipt, same id bytes. First-wins keeps the row honest; the
          // transition log still records the second open for forensics.
          return {
            ok: false,
            reason: `cross-escrow paymentId collision for ${paymentId} (row: ${existing.escrowAddress}, event: ${escrow}) — kept first, refused to merge`,
          };
        }
        // The contract reverts on paymentId reuse, so this cannot come from a
        // successful tx; keep first-wins and refuse to overwrite.
        return { ok: false, reason: `duplicate RaincheckOpened for ${paymentId}` };
      }
      this.upsertReceiptBase({
        paymentId,
        buyer: String(args.buyer).toLowerCase(),
        seller: String(args.seller).toLowerCase(),
        termsHash: String(args.termsHash).toLowerCase(),
        amount: String(args.amount),
        deadline: Number(args.deadline),
        outputHash: null,
        attestedAt: null,
        flagReasonHash: null,
        status,
        createdBlock: blockNumber,
        updatedBlock: blockNumber,
        escrowAddress: escrow,
      });
      return { ok: true };
    }

    if (!existing) {
      return { ok: false, reason: `${eventName} for unknown paymentId ${paymentId}` };
    }
    if (existing.escrowAddress && escrow && existing.escrowAddress !== escrow) {
      return {
        ok: false,
        reason: `cross-escrow ${eventName} for ${paymentId} (row: ${existing.escrowAddress}, event: ${escrow}) — refused`,
      };
    }
    const patch: Partial<ReceiptRow> = { status, updatedBlock: blockNumber };
    if (eventName === 'DeliveryAttested') {
      patch.outputHash = String(args.outputHash).toLowerCase();
      patch.attestedAt = Number(args.attestedAt);
    } else if (eventName === 'NonDeliveryFlagged') {
      patch.flagReasonHash = String(args.reasonHash).toLowerCase();
    }
    const merged: ReceiptRow = { ...existing, ...patch } as ReceiptRow;
    this.upsertReceiptBase(merged);
    return { ok: true };
  }

  // ---- transitions ------------------------------------------------------

  /** Idempotent: replays of the same (txHash, logIndex) are ignored. */
  insertTransition(row: TransitionRow): boolean {
    const r = this.db
      .prepare(
        `INSERT OR IGNORE INTO transitions
           (paymentId, event, txHash, blockNumber, logIndex, memoIndex, escrowAddress)
         VALUES (@paymentId, @event, @txHash, @blockNumber, @logIndex, @memoIndex, @escrowAddress)`,
      )
      .run(row);
    return r.changes > 0;
  }

  getTransitions(paymentId: string): TransitionRow[] {
    return this.db
      .prepare(
        'SELECT paymentId, event, txHash, blockNumber, logIndex, memoIndex, escrowAddress FROM transitions WHERE paymentId = ? ORDER BY blockNumber, logIndex',
      )
      .all(paymentId.toLowerCase()) as TransitionRow[];
  }
}

export function openStore(dbPath?: string): IndexerStore {
  return new IndexerStore(dbPath ?? defaultDbPath());
}
