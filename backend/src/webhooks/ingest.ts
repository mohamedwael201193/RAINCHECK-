// Webhook → indexer ingest bridge.
//
// The Circle event-monitor webhook payload (notificationType "contracts.eventLog")
// carries topics/data for one event log. This module NEVER trusts those fields
// as index state. Instead, for every accepted webhook it:
//
//   1. Validates the payload shape: notificationType, contract address (must be
//      the RaincheckEscrow deployment), blockchain, txHash, blockHeight.
//   2. Dedupes on notificationId (Circle may retry deliveries).
//   3. Enqueues a hint (state.ts) so the poller reconciles it on its pass.
//   4. Immediately re-reads the named transaction's receipt from the chain via
//      RPC, extracts the escrow contract logs, and feeds each through the SAME
//      handler the eth_getLogs poller uses.
//
// Step 4 is what makes even an unverified-signature webhook safe: an attacker
// who forges a payload without a matching on-chain log gets nothing — the
// handler only ever sees logs the chain actually emitted.
//
// The ingest handler is registered by the indexer (B2):
//
//   import { registerEscrowLogHandler } from "./webhooks/ingest.js";
//   registerEscrowLogHandler(async (log) => { /* build/refresh receipt */ });
//
// If no handler is registered, webhook events are logged and reconciled via
// hints only; the polling recount path remains fully functional.

import type { Log } from "viem";
import { publicClient } from "../chain.js";
import { ESCROW_ADDRESS } from "../config.js";
import { enqueueHint, isDuplicate, markProcessed } from "./state.js";

export const EXPECTED_NOTIFICATION_TYPE = "contracts.eventLog" as const;

export interface CircleEventNotification {
  notificationId: string;
  notificationType: string;
  timestamp: string;
  notification: {
    contractAddress: string;
    blockchain: string;
    txHash: `0x${string}`;
    blockHash: string;
    blockHeight: number;
    eventSignature: string;
    eventSignatureHash: string;
    topics: string[];
    data: string;
    firstConfirmDate?: string;
  };
}

/** A handler for a single chain-verified escrow log (registered by the indexer). */
export type EscrowLogHandler = (log: Log) => Promise<void> | void;

let handler: EscrowLogHandler | undefined;

export function registerEscrowLogHandler(fn: EscrowLogHandler): void {
  handler = fn;
}

export function hasEscrowLogHandler(): boolean {
  return handler !== undefined;
}

function isValidNotificationShape(body: unknown): body is CircleEventNotification {
  if (typeof body !== "object" || body === null) return false;
  const b = body as Record<string, unknown>;
  if (typeof b.notificationId !== "string" || typeof b.notificationType !== "string") return false;
  const n = b.notification as Record<string, unknown> | undefined;
  return (
    !!n &&
    typeof n.contractAddress === "string" &&
    typeof n.txHash === "string" &&
    typeof n.blockHeight === "number" &&
    typeof n.eventSignature === "string" &&
    Array.isArray(n.topics) &&
    typeof n.data === "string"
  );
}

/**
 * Process one verified-or-hint webhook payload. Returns an outcome string for logging.
 * Never throws for bad payloads — it returns "rejected:<reason>".
 */
export async function ingestWebhookEvent(
  body: unknown,
  verified: boolean,
): Promise<string> {
  if (!isValidNotificationShape(body)) return "rejected:malformed-payload";
  const n = body.notification;

  if (body.notificationType !== EXPECTED_NOTIFICATION_TYPE) {
    return `rejected:unexpected-notification-type:${body.notificationType}`;
  }
  if (n.contractAddress.toLowerCase() !== ESCROW_ADDRESS.toLowerCase()) {
    return `rejected:foreign-contract:${n.contractAddress}`;
  }
  if (isDuplicate(body.notificationId)) return "duplicate:skipped";

  markProcessed(body.notificationId);

  // Hint for the poller — the authoritative recount will pick this block up.
  enqueueHint({
    notificationId: body.notificationId,
    txHash: n.txHash,
    blockNumber: BigInt(n.blockHeight),
    eventSignature: n.eventSignature,
    verified,
  });

  if (!handler) {
    return "accepted:hint-only(no-ingest-handler-registered)";
  }

  // Low-latency path: re-read the tx receipt from chain, feed real logs to the handler.
  let receipt: Awaited<ReturnType<typeof publicClient.getTransactionReceipt>>;
  try {
    receipt = await publicClient.getTransactionReceipt({ hash: n.txHash });
  } catch (err) {
    return `hint-only:receipt-fetch-failed:${err instanceof Error ? err.message : String(err)}`;
  }

  const escrowLogs = receipt.logs.filter(
    (log) => log.address.toLowerCase() === ESCROW_ADDRESS.toLowerCase(),
  );
  if (escrowLogs.length === 0) {
    return "hint-only:no-escrow-logs-in-receipt";
  }
  for (const log of escrowLogs) {
    // The receipt came from the chain itself — these logs are authoritative,
    // regardless of whether the webhook signature verified.
    await handler(log as Log);
  }
  return `ingested:${escrowLogs.length}-logs(verified=${verified})`;
}
