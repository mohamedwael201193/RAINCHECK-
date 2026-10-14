// Shared webhook/polling reconciliation state.
//
// The invariant that keeps push and poll consistent:
//
//   * Polling (eth_getLogs) is AUTHORITATIVE. On every restart the poller
//     re-scans from the checkpoint (last fully-scanned block) to the chain
//     tip. Any event the webhooks missed (downtime, failed delivery,
//     dropped signature) is found here. This is the recount path.
//   * Webhooks are LOW-LATENCY HINTS. They never advance the checkpoint and
//     never mutate index state directly. A webhook hint causes an immediate,
//     targeted re-read of the named transaction's logs from the chain via
//     RPC; the parsed on-chain logs then go through the same ingest handler
//     the poller uses.
//
// Checkpoint persistence is owned by the poller (it owns the scan loop).
// This module keeps the in-memory view the receiver needs: dedupe of
// Circle notificationIds and the pending-hint queue the poller drains.

export interface WebhookHint {
  /** Circle notification id — dedupe key. */
  notificationId: string;
  /** Tx hash the event monitor flagged. */
  txHash: `0x${string}`;
  /** Block number the event was confirmed in. */
  blockNumber: bigint;
  /** Event signature the monitor fired on (for logging). */
  eventSignature: string;
  /** True when the HMAC signature verified against CIRCLE_WEBHOOK_SECRET. */
  verified: boolean;
}

const seenNotificationIds = new Set<string>();
const MAX_SEEN = 50_000;

const pendingHints: WebhookHint[] = [];

/** True if this notification was already processed (at-least-once delivery safe). */
export function isDuplicate(notificationId: string): boolean {
  return seenNotificationIds.has(notificationId);
}

/** Record a notification as processed. Oldest entries are evicted past the cap. */
export function markProcessed(notificationId: string): void {
  seenNotificationIds.add(notificationId);
  if (seenNotificationIds.size > MAX_SEEN) {
    const it = seenNotificationIds.values();
    for (let i = 0; i < seenNotificationIds.size - MAX_SEEN; i++) {
      const v = it.next().value;
      if (v !== undefined) seenNotificationIds.delete(v);
    }
  }
}

/** Queue a low-latency hint for the poller to reconcile (chain re-read). */
export function enqueueHint(hint: WebhookHint): void {
  pendingHints.push(hint);
}

/** Drain the hint queue (called by the poller before/after each scan pass). */
export function drainHints(): WebhookHint[] {
  return pendingHints.splice(0, pendingHints.length);
}
