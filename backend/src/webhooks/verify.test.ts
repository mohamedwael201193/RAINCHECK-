// Unit tests for the webhook signature verifier.
// Run with: npm test   (node --test dist/ picks up dist/**/*.test.js)
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import {
  verifyCircleSignature,
  getConfiguredSecret,
  CIRCLE_SIGNATURE_HEADER,
} from "./verify.js";

const SECRET = "test-webhook-secret-not-real";

function sign(body: Buffer, secret: string): string {
  return createHmac("sha256", secret).update(body).digest("hex");
}

describe("verifyCircleSignature", () => {
  it("accepts a correct HMAC-SHA256 hex digest", () => {
    const body = Buffer.from('{"notificationType":"contracts.eventLog"}', "utf8");
    assert.equal(verifyCircleSignature(body, sign(body, SECRET), SECRET), true);
  });

  it("rejects a wrong signature", () => {
    const body = Buffer.from("{}", "utf8");
    assert.equal(verifyCircleSignature(body, "deadbeef".repeat(8), SECRET), false);
  });

  it("rejects a signature made with a different secret", () => {
    const body = Buffer.from("{}", "utf8");
    assert.equal(verifyCircleSignature(body, sign(body, "other-secret"), SECRET), false);
  });

  it("rejects a tampered body", () => {
    const body = Buffer.from('{"a":1}', "utf8");
    const sig = sign(body, SECRET);
    assert.equal(verifyCircleSignature(Buffer.from('{"a":2}', "utf8"), sig, SECRET), false);
  });

  it("rejects empty signature or empty secret", () => {
    const body = Buffer.from("{}", "utf8");
    assert.equal(verifyCircleSignature(body, "", SECRET), false);
    assert.equal(verifyCircleSignature(body, sign(body, SECRET), ""), false);
  });

  it("rejects wrong-length digests without throwing", () => {
    const body = Buffer.from("{}", "utf8");
    assert.equal(verifyCircleSignature(body, "abc", SECRET), false);
  });
});

describe("webhook secret plumbing", () => {
  it("exposes the Circle signature header name", () => {
    assert.equal(CIRCLE_SIGNATURE_HEADER, "x-circle-signature");
  });

  it("getConfiguredSecret reads CIRCLE_WEBHOOK_SECRET and never prints it", () => {
    process.env.CIRCLE_WEBHOOK_SECRET = "s3cr3t-value";
    assert.equal(getConfiguredSecret(), "s3cr3t-value");
    delete process.env.CIRCLE_WEBHOOK_SECRET;
    assert.equal(getConfiguredSecret(), undefined);
    process.env.CIRCLE_WEBHOOK_SECRET = "";
    assert.equal(getConfiguredSecret(), undefined);
    delete process.env.CIRCLE_WEBHOOK_SECRET;
  });
});
