/**
 * Golden + unit tests for the RAINCHECK canonical receipt module (bible §4.6).
 *
 * Fixtures are grounded in the R9 mainnet experiments (bible §6):
 *
 *  DELIVER (W1A/W1B2, escrow 0x41099436c5f18eA916B9ca3B835fdc4B5c758Deb):
 *    OPEN -> ATTESTED -> CAPTURED. paymentId = keccak("raincheck-r9-w1a-1")
 *    (w1a-deploy-open.md). authorize tx 0x0e0edcb4… (§6.1). attest tx
 *    0x09d42eb4… + outputHash 0x05f34c31… + attestedAt 1791953860
 *    (w1b2-deliver-fix.md; outputHash recomputed = sha256 of the delivered
 *    payload). capture tx 0x78d48f08… (§6.3). deadline 1791957337.
 *    terms preimage "terms:deliver-test-output-by-deadline" (w1a.py:106);
 *    termsHash recomputed = keccak256 of it. sellerSig = the real 65-byte
 *    ECDSA signature (r||s||v-parity) of the attestDelivery tx, read from
 *    rpc.mainnet.arc.io via eth_getTransactionByHash (v=0x2788 -> parity 1).
 *
 *  VOID (W1C, escrow 0x44357E99755705376627542509d8D2eabF02562F):
 *    authorize -> attest(GARBAGE) -> flagNonDelivery -> void, full refund
 *    (§6.2, w1c-void-path.md, w1c/run.js, w1c/runlog.json).
 *    reasonHash = keccak256("garbage delivery: paid call returned HTTP 400,
 *    output bytes are random") — recomputed, matches run.js. deadline
 *    1791953919 (runlog.json). endpoint from the w1c terms object.
 *
 * The EXPECTED_CANONICAL strings and EXPECTED_HASH values below were
 * verified against two independent implementations before hardcoding:
 *   - JCS: Python json.dumps(sort_keys=True, separators=(",",":")) and the
 *     `canonicalize` npm package CLI both reproduce the canonical bytes.
 *   - SHA-256: Python hashlib reproduces both hashes.
 * Any future change to buildReceipt()/hashReceipt() that alters these bytes
 * fails loudly here — that is the point.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { keccak256, toHex } from "viem";
import {
  buildReceipt,
  canonicalReceipt,
  hashReceipt,
  ReceiptError,
} from "./index.js";
import type { RaincheckReceipt, ReceiptInput } from "./index.js";

const BUYER = "0xBDfCeE82Bd42FEfA58ee850B3709636a8B6b0034";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const DELIVER_ROW: ReceiptInput = {
  paymentId: "0x2afce53583a7e57afb16d95f0b606d7d12109cebf95ff10a2c952166530d55ad",
  settleTx: "0x0e0edcb4ec571dd5d41a817c97d044c0f3a8aacdd43d7f9ea75d6efd6857c528",
  authorizationState: true,
  payer: BUYER,
  amount: 1000n,
  termsHash: "0x0a2757acca787e00df5eba8966c9cef463b2687cff79744526f6f401c664b8a7",
  endpoint: "terms:deliver-test-output-by-deadline",
  price: 1000n,
  deadline: 1791957337,
  delivery: {
    kind: "attested",
    outputHash: "0x05f34c3147aa934c10ff345f87cf5d588866ad5ddc2c11ecf6cd940468039363",
    attestedAt: 1791953860,
    sellerSig:
      "0x1d1acb6e51e7f7cb44a86114e01df82190cbe3a5ab8c88a96a933131420f21b6" +
      "227b4235da36e6ca9570ce89a8568a2413d1ed884a2e97f7ea5f11e06f4159f8" +
      "01",
    attestedTx: "0x09d42eb42bb5bff1fd3a84db739a4e01e196af91b3cef2dc79664bec59c5d900",
  },
  status: "CAPTURED",
  anchorTxs: [
    "0x0e0edcb4ec571dd5d41a817c97d044c0f3a8aacdd43d7f9ea75d6efd6857c528",
    "0x09d42eb42bb5bff1fd3a84db739a4e01e196af91b3cef2dc79664bec59c5d900",
    "0x78d48f08398031b1d9f3fa1bf389e4ac920f69ca344d51c48b2fd74056e30ae9",
  ],
};

const VOID_ROW: ReceiptInput = {
  paymentId: "0x9b56d7caaeb6a25e77760afb249a9ce69d176c47802b283c7127b0940ef653b9",
  settleTx: "0xa5c889b7c7a6cffb11e30855e397f3109eac0a540da90b365355f91a33e1f978",
  authorizationState: true,
  payer: BUYER,
  amount: "1000",
  termsHash: "0x91e1025c94696b3d71fd4c1bd6bf839b9e26f179e5c5259eea21ae47f3732b2a",
  endpoint: "https://x402.example/v1/data",
  price: "1000",
  deadline: 1791953919,
  delivery: {
    kind: "flagged",
    flaggedBy: BUYER,
    reasonHash: "0xacd9018996d297a1b1a629191e030b047d844721a602138b59acb7e52d87ad8f",
    flaggedTx: "0x579592846ee7a558e2bede22e5fadf82bd27210c81b741a254dc59b93364881e",
  },
  status: "VOIDED",
  anchorTxs: [
    "0xa5c889b7c7a6cffb11e30855e397f3109eac0a540da90b365355f91a33e1f978",
    "0xc496c6a04218174019a343f9a19d5b424c7bd38f0b8e1bde7b8021aadc817383",
    "0x579592846ee7a558e2bede22e5fadf82bd27210c81b741a254dc59b93364881e",
    "0xf8ecf05d35d2c9b18675d48274877d4e569e6b72908bb2aad31ad8769b4fd60c",
  ],
};

// ---------------------------------------------------------------------------
// Golden expectations (verified independently — see file header)
// ---------------------------------------------------------------------------

const EXPECTED_DELIVER_RECEIPT: RaincheckReceipt = {
  specVersion: "raincheck-receipt/v1",
  paymentId: "0x2afce53583a7e57afb16d95f0b606d7d12109cebf95ff10a2c952166530d55ad",
  paymentProof: {
    settleTx: "0x0e0edcb4ec571dd5d41a817c97d044c0f3a8aacdd43d7f9ea75d6efd6857c528",
    authorizationState: true,
    payer: "0xbdfcee82bd42fefa58ee850b3709636a8b6b0034",
    amount: "1000",
  },
  terms: {
    termsHash: "0x0a2757acca787e00df5eba8966c9cef463b2687cff79744526f6f401c664b8a7",
    endpoint: "terms:deliver-test-output-by-deadline",
    price: "1000",
    deadline: 1791957337,
  },
  delivery: {
    outputHash: "0x05f34c3147aa934c10ff345f87cf5d588866ad5ddc2c11ecf6cd940468039363",
    attestedAt: 1791953860,
    sellerSig:
      "0x1d1acb6e51e7f7cb44a86114e01df82190cbe3a5ab8c88a96a933131420f21b6" +
      "227b4235da36e6ca9570ce89a8568a2413d1ed884a2e97f7ea5f11e06f4159f8" +
      "01",
  },
  oracle: null,
  policy: null,
  funding: null,
  status: "CAPTURED",
  anchors: [
    "eip155:5042:0x0e0edcb4ec571dd5d41a817c97d044c0f3a8aacdd43d7f9ea75d6efd6857c528",
    "eip155:5042:0x09d42eb42bb5bff1fd3a84db739a4e01e196af91b3cef2dc79664bec59c5d900",
    "eip155:5042:0x78d48f08398031b1d9f3fa1bf389e4ac920f69ca344d51c48b2fd74056e30ae9",
  ],
};

const EXPECTED_DELIVER_CANONICAL =
  '{"anchors":["eip155:5042:0x0e0edcb4ec571dd5d41a817c97d044c0f3a8aacdd43d7f9ea75d6efd6857c528","eip155:5042:0x09d42eb42bb5bff1fd3a84db739a4e01e196af91b3cef2dc79664bec59c5d900","eip155:5042:0x78d48f08398031b1d9f3fa1bf389e4ac920f69ca344d51c48b2fd74056e30ae9"],"delivery":{"attestedAt":1791953860,"outputHash":"0x05f34c3147aa934c10ff345f87cf5d588866ad5ddc2c11ecf6cd940468039363","sellerSig":"0x1d1acb6e51e7f7cb44a86114e01df82190cbe3a5ab8c88a96a933131420f21b6227b4235da36e6ca9570ce89a8568a2413d1ed884a2e97f7ea5f11e06f4159f801"},"funding":null,"oracle":null,"paymentId":"0x2afce53583a7e57afb16d95f0b606d7d12109cebf95ff10a2c952166530d55ad","paymentProof":{"amount":"1000","authorizationState":true,"payer":"0xbdfcee82bd42fefa58ee850b3709636a8b6b0034","settleTx":"0x0e0edcb4ec571dd5d41a817c97d044c0f3a8aacdd43d7f9ea75d6efd6857c528"},"policy":null,"specVersion":"raincheck-receipt/v1","status":"CAPTURED","terms":{"deadline":1791957337,"endpoint":"terms:deliver-test-output-by-deadline","price":"1000","termsHash":"0x0a2757acca787e00df5eba8966c9cef463b2687cff79744526f6f401c664b8a7"}}';

const EXPECTED_DELIVER_HASH =
  "e49da8254b0a9b3552c514b3ae9ebc660619763975d190e3db833d6ead524dae";

const EXPECTED_VOID_CANONICAL =
  '{"anchors":["eip155:5042:0xa5c889b7c7a6cffb11e30855e397f3109eac0a540da90b365355f91a33e1f978","eip155:5042:0x579592846ee7a558e2bede22e5fadf82bd27210c81b741a254dc59b93364881e","eip155:5042:0xc496c6a04218174019a343f9a19d5b424c7bd38f0b8e1bde7b8021aadc817383","eip155:5042:0xf8ecf05d35d2c9b18675d48274877d4e569e6b72908bb2aad31ad8769b4fd60c"],"delivery":{"nonDelivery":{"flaggedBy":"0xbdfcee82bd42fefa58ee850b3709636a8b6b0034","reasonHash":"0xacd9018996d297a1b1a629191e030b047d844721a602138b59acb7e52d87ad8f"}},"funding":null,"oracle":null,"paymentId":"0x9b56d7caaeb6a25e77760afb249a9ce69d176c47802b283c7127b0940ef653b9","paymentProof":{"amount":"1000","authorizationState":true,"payer":"0xbdfcee82bd42fefa58ee850b3709636a8b6b0034","settleTx":"0xa5c889b7c7a6cffb11e30855e397f3109eac0a540da90b365355f91a33e1f978"},"policy":null,"specVersion":"raincheck-receipt/v1","status":"VOIDED","terms":{"deadline":1791953919,"endpoint":"https://x402.example/v1/data","price":"1000","termsHash":"0x91e1025c94696b3d71fd4c1bd6bf839b9e26f179e5c5259eea21ae47f3732b2a"}}';

const EXPECTED_VOID_HASH =
  "9a2e5f420866a0cdb5b5bf292e98eb2181a28a727345a0c80ec480d58f908113";

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("receipts — golden fixtures (bible §4.6)", () => {
  it("deliver path: receipt object matches the schema-exact expectation", () => {
    const receipt = buildReceipt(DELIVER_ROW);
    assert.deepStrictEqual(receipt, EXPECTED_DELIVER_RECEIPT);
  });

  it("deliver path: JCS canonical bytes are byte-exact (golden)", () => {
    const receipt = buildReceipt(DELIVER_ROW);
    assert.strictEqual(canonicalReceipt(receipt), EXPECTED_DELIVER_CANONICAL);
  });

  it("deliver path: receiptHash is the fixed golden value", () => {
    const receipt = buildReceipt(DELIVER_ROW);
    assert.strictEqual(hashReceipt(receipt), EXPECTED_DELIVER_HASH);
    assert.match(hashReceipt(receipt), /^[0-9a-f]{64}$/); // lowercase hex
  });

  it("void path: JCS canonical bytes are byte-exact (golden)", () => {
    const receipt = buildReceipt(VOID_ROW);
    assert.strictEqual(canonicalReceipt(receipt), EXPECTED_VOID_CANONICAL);
  });

  it("void path: receiptHash is the fixed golden value", () => {
    const receipt = buildReceipt(VOID_ROW);
    assert.strictEqual(hashReceipt(receipt), EXPECTED_VOID_HASH);
  });

  it("void path: delivery carries the nonDelivery variant, status VOIDED", () => {
    const receipt = buildReceipt(VOID_ROW);
    assert.ok("nonDelivery" in receipt.delivery);
    assert.deepStrictEqual(receipt.delivery, {
      nonDelivery: {
        flaggedBy: "0xbdfcee82bd42fefa58ee850b3709636a8b6b0034",
        reasonHash: "0xacd9018996d297a1b1a629191e030b047d844721a602138b59acb7e52d87ad8f",
      },
    });
    assert.strictEqual(receipt.status, "VOIDED");
  });

  it("terms provenance: keccak256(endpoint) === termsHash (deliver fixture)", () => {
    // The terms preimage is the exact string hashed by the w1a experiment.
    assert.strictEqual(
      keccak256(toHex(DELIVER_ROW.endpoint)),
      DELIVER_ROW.termsHash,
    );
  });
});

describe("receipts — schema exactness", () => {
  const SCHEMA_KEYS = [
    "anchors",
    "delivery",
    "funding",
    "oracle",
    "paymentId",
    "paymentProof",
    "policy",
    "specVersion",
    "status",
    "terms",
  ];

  it("receipt has exactly the §4.6 key set — no invented fields", () => {
    for (const row of [DELIVER_ROW, VOID_ROW]) {
      const receipt = buildReceipt(row);
      assert.deepStrictEqual(Object.keys(receipt).sort(), SCHEMA_KEYS);
    }
  });

  it("oracle / policy / funding are null in standalone v1", () => {
    for (const row of [DELIVER_ROW, VOID_ROW]) {
      const receipt = buildReceipt(row);
      assert.strictEqual(receipt.oracle, null);
      assert.strictEqual(receipt.policy, null);
      assert.strictEqual(receipt.funding, null);
    }
  });

  it("hashReceipt rejects a receipt with extra keys (fail-closed)", () => {
    const receipt = buildReceipt(DELIVER_ROW) as unknown as Record<string, unknown>;
    receipt.extraField = "invented";
    assert.throws(() => hashReceipt(receipt as unknown as RaincheckReceipt), ReceiptError);
  });

  it("hashReceipt rejects a receipt with a missing key", () => {
    const { status: _dropped, ...rest } = buildReceipt(DELIVER_ROW);
    void _dropped;
    assert.throws(() => hashReceipt(rest as unknown as RaincheckReceipt), ReceiptError);
  });
});

describe("receipts — normalization", () => {
  it("hex is lowercased: checksummed input hashes identically", () => {
    const mixed: ReceiptInput = {
      ...DELIVER_ROW,
      paymentId: "0x2AFCE53583A7E57AFB16D95F0B606D7D12109CEBF95FF10A2C952166530D55AD",
      payer: "0xBDfCeE82Bd42FEfA58ee850B3709636a8B6b0034",
    };
    assert.strictEqual(
      hashReceipt(buildReceipt(mixed)),
      EXPECTED_DELIVER_HASH,
    );
  });

  it("amounts accept bigint | number | string and normalize to base-unit strings", () => {
    for (const amount of [1000n, 1000, "1000"] as const) {
      const r = buildReceipt({ ...DELIVER_ROW, amount });
      assert.strictEqual(r.paymentProof.amount, "1000");
    }
    const r = buildReceipt({ ...DELIVER_ROW, price: "1500000" });
    assert.strictEqual(r.terms.price, "1500000");
    // "1000.0" would be a lie about precision — base units are integers.
    assert.strictEqual(r.paymentProof.amount, "1000");
  });

  it("timestamps accept bigint | number", () => {
    const r = buildReceipt({
      ...DELIVER_ROW,
      deadline: 1791957337n,
      delivery: {
        ...(DELIVER_ROW.delivery as { kind: "attested"; outputHash: string; attestedAt: number; sellerSig: string; attestedTx: string }),
        attestedAt: 1791953860n,
      },
    });
    assert.strictEqual(r.terms.deadline, 1791957337);
    assert.strictEqual(
      (r.delivery as { attestedAt: number }).attestedAt,
      1791953860,
    );
  });

  it("input key insertion order does not change the hash (JCS determinism)", () => {
    const shuffled: ReceiptInput = {
      status: DELIVER_ROW.status,
      anchorTxs: DELIVER_ROW.anchorTxs,
      delivery: DELIVER_ROW.delivery,
      deadline: DELIVER_ROW.deadline,
      price: DELIVER_ROW.price,
      endpoint: DELIVER_ROW.endpoint,
      termsHash: DELIVER_ROW.termsHash,
      amount: DELIVER_ROW.amount,
      payer: DELIVER_ROW.payer,
      authorizationState: DELIVER_ROW.authorizationState,
      settleTx: DELIVER_ROW.settleTx,
      paymentId: DELIVER_ROW.paymentId,
    };
    assert.strictEqual(
      hashReceipt(buildReceipt(shuffled)),
      EXPECTED_DELIVER_HASH,
    );
  });

  it("anchors: settle + delivery txs are guaranteed, refs formatted, deduped", () => {
    const r = buildReceipt({
      ...DELIVER_ROW,
      anchorTxs: [
        // duplicates, pre-formatted ref, and out-of-order extras
        "eip155:5042:0x78d48f08398031b1d9f3fa1bf389e4ac920f69ca344d51c48b2fd74056e30ae9",
        "0x78d48f08398031b1d9f3fa1bf389e4ac920f69ca344d51c48b2fd74056e30ae9",
      ],
    });
    assert.deepStrictEqual(r.anchors, [
      "eip155:5042:0x0e0edcb4ec571dd5d41a817c97d044c0f3a8aacdd43d7f9ea75d6efd6857c528",
      "eip155:5042:0x09d42eb42bb5bff1fd3a84db739a4e01e196af91b3cef2dc79664bec59c5d900",
      "eip155:5042:0x78d48f08398031b1d9f3fa1bf389e4ac920f69ca344d51c48b2fd74056e30ae9",
    ]);
  });

  it("status is carried by NAME for all four states", () => {
    for (const status of ["OPEN", "ATTESTED", "CAPTURED", "VOIDED"] as const) {
      const r = buildReceipt({ ...VOID_ROW, status });
      assert.strictEqual(r.status, status);
    }
  });
});

describe("receipts — validation (fail-closed)", () => {
  const bad = (patch: Partial<ReceiptInput>) =>
    () => buildReceipt({ ...DELIVER_ROW, ...patch });

  it("rejects malformed paymentId / tx hashes / addresses", () => {
    assert.throws(bad({ paymentId: "0x1234" }), ReceiptError);
    assert.throws(bad({ paymentId: "not-hex" }), ReceiptError);
    assert.throws(bad({ settleTx: "0xzzzz" }), ReceiptError);
    assert.throws(
      bad({ payer: "0xbdfcee82bd42fefa58ee850b3709636a8b6b00" }),
      ReceiptError,
    );
  });

  it("rejects non-integer / negative / malformed amounts", () => {
    assert.throws(bad({ amount: "1.5" }), ReceiptError);
    assert.throws(bad({ amount: "-5" }), ReceiptError);
    assert.throws(bad({ amount: 1.5 }), ReceiptError);
    assert.throws(bad({ amount: "abc" }), ReceiptError);
    assert.throws(bad({ price: "" }), ReceiptError);
  });

  it("rejects bad status names (FLAGGED is on-chain interim, not a receipt status)", () => {
    assert.throws(
      bad({ status: "FLAGGED" as unknown as ReceiptInput["status"] }),
      ReceiptError,
    );
    assert.throws(
      bad({ status: "open" as unknown as ReceiptInput["status"] }),
      ReceiptError,
    );
  });

  it("rejects empty endpoint and non-boolean authorizationState", () => {
    assert.throws(bad({ endpoint: "" }), ReceiptError);
    assert.throws(
      bad({ authorizationState: "yes" as unknown as boolean }),
      ReceiptError,
    );
  });

  it("rejects malformed delivery variants", () => {
    const attested = DELIVER_ROW.delivery as {
      kind: "attested";
      outputHash: string;
      attestedAt: number;
      sellerSig: string;
      attestedTx: string;
    };
    assert.throws(
      bad({ delivery: { ...attested, sellerSig: "0x1234" } }),
      ReceiptError,
    );
    assert.throws(
      bad({ delivery: { kind: "bogus" } as unknown as ReceiptInput["delivery"] }),
      ReceiptError,
    );
  });

  it("rejects non-array anchorTxs", () => {
    assert.throws(
      bad({ anchorTxs: "0x1234" as unknown as string[] }),
      ReceiptError,
    );
  });
});
