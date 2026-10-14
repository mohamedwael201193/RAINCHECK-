// Re-export the webhook module's public surface for the indexer/API.
export { mountCircleWebhooks } from "./receiver.js";
export { registerEscrowLogHandler, hasEscrowLogHandler, ingestWebhookEvent } from "./ingest.js";
export { verifyCircleSignature, getConfiguredSecret, CIRCLE_SIGNATURE_HEADER } from "./verify.js";
export {
  enqueueHint,
  drainHints,
  isDuplicate,
  markProcessed,
  type WebhookHint,
} from "./state.js";
