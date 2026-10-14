/**
 * Capability gating — pure functions, no React, no chain calls.
 *
 * Encodes build bible §4.1 contract permissions as UI enablement rules:
 *   - flagNonDelivery: BUYER ONLY, requires ATTESTED, inside the challenge window
 *   - capture: PERMISSIONLESS on-chain, requires ATTESTED + window closed
 *   - void: PERMISSIONLESS on-chain, requires FLAGGED
 *   - voidAfterDeadline: PERMISSIONLESS on-chain, requires OPEN + past deadline
 *   - attestDelivery: SELLER ONLY, requires OPEN, before the deadline
 *
 * "Connected" = a wallet is attached to sign the tx (UI requirement even for
 * the permissionless calls, which anyone may submit on-chain). Status names
 * follow the contract enum (bible ordinal caution: never hardcode ordinals).
 * Unknown statuses deny everything — a control that looks live must never
 * fire against a state the UI does not understand.
 */

export type ReceiptStatusName =
  | "OPEN"
  | "ATTESTED"
  | "FLAGGED"
  | "CAPTURED"
  | "VOIDED";

/** Case-insensitive address equality (0x + 40 hex, trimmed). */
function sameAddress(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return false;
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

function isConnected(connected: string | null | undefined): boolean {
  return typeof connected === "string" && connected.trim().length > 0;
}

export function canFlag(
  buyer: string | null | undefined,
  connected: string | null | undefined,
  status: string,
  windowOpen: boolean,
): boolean {
  return (
    isConnected(connected) &&
    sameAddress(connected, buyer) &&
    status === "ATTESTED" &&
    windowOpen === true
  );
}

export function canCapture(
  connected: string | null | undefined,
  status: string,
  windowOpen: boolean,
): boolean {
  // Permissionless on-chain: any connected signer may finalize once the
  // challenge window has closed with no flag.
  return isConnected(connected) && status === "ATTESTED" && windowOpen === false;
}

export function canVoid(
  connected: string | null | undefined,
  status: string,
): boolean {
  // Permissionless on-chain: anyone may execute the refund once flagged.
  return isConnected(connected) && status === "FLAGGED";
}

export function canVoidAfterDeadline(
  connected: string | null | undefined,
  status: string,
  pastDeadline: boolean,
): boolean {
  // Permissionless on-chain: funds never trap — OPEN past deadline refunds.
  return (
    isConnected(connected) && status === "OPEN" && pastDeadline === true
  );
}

export function canAttest(
  seller: string | null | undefined,
  connected: string | null | undefined,
  status: string,
  beforeDeadline: boolean,
): boolean {
  return (
    isConnected(connected) &&
    sameAddress(connected, seller) &&
    status === "OPEN" &&
    beforeDeadline === true
  );
}
