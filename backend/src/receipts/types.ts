/**
 * RAINCHECK canonical receipt types.
 *
 * Source of truth: ~/workspace/your_files/raincheck-build-bible.md §4.6.
 * The receipt object must contain EXACTLY the schema keys — no invented
 * fields. Every field traces to chain data (escrow events / tx records) or
 * to the indexer row assembled from them.
 */

export type Hex = string;

/** Receipt status by NAME (bible §4.6). On-chain FLAGGED (interim) maps to
 *  "ATTESTED" + the nonDelivery block until the void lands. */
export type ReceiptStatusName = "OPEN" | "ATTESTED" | "CAPTURED" | "VOIDED";

/**
 * Indexer-assembled input row for buildReceipt().
 *
 * MERGE NOTE (B1/B2): the indexer is a cache over eth_getLogs. If your
 * indexer lands its own row/event types, map them onto this interface (or
 * rename this one) — the field set here is exactly what §4.6 needs, nothing
 * more. Provenance per field is documented below.
 */
export interface ReceiptInput {
  /** bytes32 paymentId from the RaincheckOpened event (0x + 64 hex). */
  paymentId: Hex;
  /** Tx hash of the authorize() call — the RaincheckOpened transition that locked funds. */
  settleTx: Hex;
  /**
   * True when the buyer's token authorization was verified used: the public
   * EIP-3009 AuthorizationUsed event on Arc USDC, or the Transfer(buyer →
   * escrow, amount) leg inside the settle tx receipt. False = not observed.
   */
  authorizationState: boolean;
  /** Buyer address (payer) from RaincheckOpened. */
  payer: Hex;
  /** Escrowed amount, 6-decimal USDC base units (bigint/number/decimal-string). */
  amount: bigint | number | string;
  /** bytes32 termsHash from authorize() — binds the off-chain terms. */
  termsHash: Hex;
  /**
   * What is being delivered (endpoint URL or description). From the off-chain
   * terms payload whose keccak256 is termsHash; the buyer supplies it when
   * opening the receipt. Must be non-empty — a receipt is never built from
   * an unknown terms payload.
   */
  endpoint: string;
  /** Agreed price, 6-decimal USDC base units (may equal amount). */
  price: bigint | number | string;
  /** Delivery deadline, unix seconds, from RaincheckOpened. */
  deadline: bigint | number;
  /**
   * Delivery evidence — exactly one variant.
   *
   * attested: DeliveryAttested event (outputHash, attestedAt). sellerSig is
   * the 65-byte ECDSA signature (r || s || v-parity) of the attestDelivery
   * transaction itself — traceable from chain via eth_getTransactionByHash —
   * proving the seller signed the exact attestation calldata. Null when an
   * oracle fires the attestation (T0-O, not live in v1).
   *
   * flagged: NonDeliveryFlagged event (reasonHash) + the flag tx sender.
   */
  delivery:
    | {
        kind: "attested";
        /** sha256 of the exact delivered bytes, from DeliveryAttested. */
        outputHash: Hex;
        /** unix seconds, from DeliveryAttested. */
        attestedAt: bigint | number;
        /** 65-byte ECDSA sig of the attestDelivery tx (0x + 130 hex). */
        sellerSig: Hex;
        /** Tx hash carrying the DeliveryAttested event. */
        attestedTx: Hex;
      }
    | {
        kind: "flagged";
        /** Address that sent flagNonDelivery (the buyer), from the tx record. */
        flaggedBy: Hex;
        /** reasonHash from NonDeliveryFlagged. */
        reasonHash: Hex;
        /** Tx hash carrying the NonDeliveryFlagged event. */
        flaggedTx: Hex;
      };
  /** Status by NAME. */
  status: ReceiptStatusName;
  /**
   * Tx hashes of every transition anchoring this receipt (open, attest/flag,
   * capture/void, Memo anchors). buildReceipt() also guarantees settleTx and
   * the delivery tx are present, formats each as `eip155:5042:0x…`, and
   * dedupes, preserving first-seen order.
   */
  anchorTxs: Hex[];
}

/** Payment-leg proof: the settlement transaction and the payer. */
export interface ReceiptPaymentProof {
  settleTx: string;
  authorizationState: boolean;
  payer: string;
  /** 6-decimal base-unit integer, as a decimal string. */
  amount: string;
}

/** Terms leg: the hashed agreement plus its human-readable face. */
export interface ReceiptTerms {
  termsHash: string;
  endpoint: string;
  /** 6-decimal base-unit integer, as a decimal string. */
  price: string;
  /** unix seconds. */
  deadline: number;
}

/** Delivery leg — exactly one variant. */
export type ReceiptDelivery =
  | { outputHash: string; attestedAt: number; sellerSig: string }
  | { nonDelivery: { flaggedBy: string; reasonHash: string } };

/**
 * The canonical receipt — EXACTLY bible §4.6. Keys are present even when
 * null: oracle/policy/funding are trust-stack composition refs, null in
 * standalone v1 deployments (oracle = T0-O, not live; policy/funding =
 * standalone), tamper-evident inside the hashed JSON when set.
 */
export interface RaincheckReceipt {
  specVersion: "raincheck-receipt/v1";
  paymentId: string;
  paymentProof: ReceiptPaymentProof;
  terms: ReceiptTerms;
  delivery: ReceiptDelivery;
  oracle: null;
  policy: null;
  funding: null;
  status: ReceiptStatusName;
  /** CAIP-2 style refs: `eip155:5042:0x…`. */
  anchors: string[];
}
