// Derivation adapter — TEST-LOCAL.
// Folds fixture event logs into the PRODUCTION receipt builder
// (src/api/chainStore.ts buildCanonicalReceipt), mirroring that module's fold
// exactly: canonical chain order (blockNumber, logIndex), lowercased ids,
// last-event-wins status, anchors pushed per log in canonical order.
// TODO(B2): run the re-derivability assertions against the real IndexerStore
// once src/indexer/ compiles; this adapter keeps the contract tested on the
// real construction path until then.
import { buildCanonicalReceipt } from "../../src/api/chainStore.js";
import type { CanonicalReceipt, ReceiptStatus, ReceiptView } from "../../src/api/types.js";

export interface FixtureLog {
  name:
    | "RaincheckOpened"
    | "DeliveryAttested"
    | "RaincheckCaptured"
    | "NonDeliveryFlagged"
    | "RaincheckVoided"
    | "Transfer";
  txHash: string;
  blockNumber: number;
  logIndex: number;
  args: Record<string, unknown>;
}

export function canonicalLogOrder(logs: FixtureLog[]): FixtureLog[] {
  return [...logs].sort((a, b) => a.blockNumber - b.blockNumber || a.logIndex - b.logIndex);
}

export function deriveReceiptFromLogs(logs: FixtureLog[]): CanonicalReceipt {
  const ordered = canonicalLogOrder(logs);
  let paymentId: string | null = null;
  let buyer = "";
  let seller = "";
  let termsHash = "";
  let amountBase = "";
  let deadline = 0;
  let settleTx = "";
  let status: ReceiptStatus = "OPEN";
  let outputHash: string | null = null;
  let attestedAt: number | null = null;
  let flagReasonHash: string | null = null;
  const anchorTxs: string[] = [];

  for (const log of ordered) {
    const pid = String(log.args.paymentId).toLowerCase();
    if (paymentId === null) paymentId = pid;
    else if (pid !== paymentId) throw new Error(`re-derivation failed: mixed paymentIds (${paymentId} vs ${pid})`);
    anchorTxs.push(log.txHash);

    switch (log.name) {
      case "RaincheckOpened":
        buyer = String(log.args.buyer).toLowerCase();
        seller = String(log.args.seller).toLowerCase();
        termsHash = String(log.args.termsHash).toLowerCase();
        amountBase = String(log.args.amount);
        deadline = Number(log.args.deadline);
        settleTx = log.txHash;
        status = "OPEN";
        break;
      case "DeliveryAttested":
        status = "ATTESTED";
        outputHash = String(log.args.outputHash).toLowerCase();
        attestedAt = Number(log.args.attestedAt);
        break;
      case "NonDeliveryFlagged":
        status = "FLAGGED";
        flagReasonHash = String(log.args.reasonHash).toLowerCase();
        break;
      case "RaincheckCaptured":
        status = "CAPTURED";
        break;
      case "RaincheckVoided":
        status = "VOIDED";
        break;
      case "Transfer":
        break; // value leg; bound via the anchoring tx, never via memo alone
    }
  }
  if (paymentId === null || !settleTx) throw new Error("re-derivation failed: no RaincheckOpened in log set");

  return buildCanonicalReceipt({
    paymentId,
    buyer,
    seller,
    termsHash,
    amountBase,
    deadline,
    outputHash,
    attestedAt,
    flagReasonHash,
    status,
    settleTx,
    anchorTxs,
  });
}

export function deriveViewFromLogs(logs: FixtureLog[], openedAt: number, updatedAt: number): ReceiptView {
  const receipt = deriveReceiptFromLogs(logs);
  const ordered = canonicalLogOrder(logs);
  return {
    receipt,
    receiptHash: "", // filled by the seeder via production receiptHashOf
    timeline: ordered.map((l) => ({
      event: l.name,
      txHash: l.txHash,
      explorerUrl: `https://explorer.arc.io/tx/${l.txHash}`,
      memoIndex: null,
      blockTime: openedAt,
      blockNumber: l.blockNumber,
    })),
    openedAt,
    updatedAt,
    buyer: receipt.paymentProof.payer,
    seller: ordered.length > 0 ? String(ordered[0]!.args.seller).toLowerCase() : "",
  };
}
