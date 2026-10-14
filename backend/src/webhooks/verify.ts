// RAINCHECK webhook signature verification (Circle, Developer Console webhooks).
//
// Per Circle's webhook signature scheme: every webhook POST carries the raw
// request body signed as HMAC-SHA256 with the webhook secret registered in the
// Developer Console. The hex-encoded digest arrives in the
// `X-Circle-Signature` header. Comparison is timing-safe.
//
// If CIRCLE_WEBHOOK_SECRET is not configured, verification is impossible.
// The receiver still accepts the request as an *unverified low-latency hint* —
// see ingest.ts: no state is ever derived from the payload itself; the handler
// re-reads the transaction's logs from the chain via RPC before doing anything.
// Signature failures are rejected with 401.

import { createHmac, timingSafeEqual } from "node:crypto";

export const CIRCLE_SIGNATURE_HEADER = "x-circle-signature";

export function verifyCircleSignature(
  rawBody: Buffer,
  signature: string,
  secret: string,
): boolean {
  if (!signature || !secret) return false;
  let expected: Buffer;
  let actual: Buffer;
  try {
    expected = Buffer.from(createHmac("sha256", secret).update(rawBody).digest("hex"), "utf8");
    actual = Buffer.from(signature.trim().toLowerCase(), "utf8");
  } catch {
    return false;
  }
  if (expected.length !== actual.length) return false;
  return timingSafeEqual(expected, actual);
}

export function getConfiguredSecret(): string | undefined {
  const s = process.env.CIRCLE_WEBHOOK_SECRET;
  return s && s.length > 0 ? s : undefined;
}
