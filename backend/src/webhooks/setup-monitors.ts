// setup-monitors.ts — register Circle Contracts API event monitors for the
// RaincheckEscrow events, pointing at the WEBHOOK_URL receiver.
//
// Run:  npm run setup:monitors
// Needs: CIRCLE_API_KEY + CIRCLE_ENTITY_SECRET (from Secure Vault in prod;
//        never printed — this script only ever prints monitor IDs).
//        WEBHOOK_URL should already be registered in the Circle Developer
//        Console under Webhooks (manual step per Circle docs) — the script
//        reminds you if it is missing.
//
// If CIRCLE_API_KEY is unset, this is a NO-OP success: the backend works
// fully on the eth_getLogs polling/recount path, which is the default.
// Polling is authoritative; webhooks are a low-latency hint. See WEBHOOKS.md.

import dotenv from "dotenv";
import {
  initiateSmartContractPlatformClient,
  Blockchain,
  type ClientParams,
} from "@circle-fin/smart-contract-platform";
import { ESCROW_ADDRESS, CHAIN_ID } from "../config.js";

dotenv.config();

// Exact event signatures from the build bible §4.1 (RaincheckEscrow).
const EVENT_SIGNATURES = [
  "RaincheckOpened(bytes32,address,address,bytes32,uint256,uint256)",
  "DeliveryAttested(bytes32,bytes32,uint256)",
  "RaincheckCaptured(bytes32,uint256)",
  "NonDeliveryFlagged(bytes32,bytes32)",
  "RaincheckVoided(bytes32,uint256,address)",
] as const;

// Arc mainnet on the Contracts API is the "ARC" blockchain label (chain 5042).
const BLOCKCHAIN: Blockchain = Blockchain.Arc;

function resolveBlockchain(): Blockchain {
  const raw = (process.env.CIRCLE_BLOCKCHAIN ?? "").trim().toUpperCase();
  if (!raw) return BLOCKCHAIN;
  const match = (Object.values(Blockchain) as string[]).find((v) => v === raw);
  if (!match) {
    throw new Error(
      `CIRCLE_BLOCKCHAIN=${process.env.CIRCLE_BLOCKCHAIN} is not a known Contracts API blockchain.`,
    );
  }
  return match as Blockchain;
}

async function main(): Promise<void> {
  const apiKey = process.env.CIRCLE_API_KEY;
  if (!apiKey) {
    console.log(
      "[setup-monitors] CIRCLE_API_KEY not set — skipping monitor creation.\n" +
        "[setup-monitors] The backend runs in polling mode (eth_getLogs), which is the\n" +
        "[setup-monitors] default and authoritative path. No action needed.",
    );
    return;
  }

  const webhookUrl = process.env.WEBHOOK_URL;
  if (!webhookUrl) {
    console.warn(
      "[setup-monitors] WARNING: WEBHOOK_URL is not set. Monitors can still be created\n" +
        "[setup-monitors] (they back the list-event-logs API), but no push notifications will\n" +
        "[setup-monitors] arrive until the receiver URL is registered in the Circle\n" +
        "[setup-monitors] Developer Console → Webhooks and WEBHOOK_URL is exported.",
    );
  } else {
    console.log(`[setup-monitors] Expecting pushes to: ${webhookUrl}/webhooks/circle`);
  }

  const entitySecret = process.env.CIRCLE_ENTITY_SECRET;
  if (!entitySecret) {
    console.error(
      "[setup-monitors] CIRCLE_ENTITY_SECRET is required to initialize the Circle\n" +
        "[setup-monitors] Smart Contract Platform client (it is distinct from the API key).\n" +
        "[setup-monitors] Set it, then re-run. Polling mode remains active meanwhile.",
    );
    process.exit(1);
  }

  const blockchain = resolveBlockchain();
  const client = initiateSmartContractPlatformClient({
    apiKey,
    entitySecret,
  } satisfies ClientParams);

  console.log(
    `[setup-monitors] Creating ${EVENT_SIGNATURES.length} event monitors on ${blockchain} ` +
      `for escrow ${ESCROW_ADDRESS} (chain ${CHAIN_ID})…`,
  );

  const created = new Map<string, string>();
  for (const eventSignature of EVENT_SIGNATURES) {
    try {
      const response = await client.createEventMonitor({
        blockchain,
        contractAddress: ESCROW_ADDRESS,
        eventSignature,
      });
      const id = response.data?.eventMonitor?.id ?? "(unrecognized response shape)";
      created.set(eventSignature, id);
      console.log(`[setup-monitors] ${eventSignature} → monitor ${id}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      // Idempotent re-runs: a monitor that already exists is not a failure.
      if (/already exists/i.test(msg)) {
        console.log(`[setup-monitors] ${eventSignature} → already exists (re-run is safe)`);
        created.set(eventSignature, "existing");
      } else {
        console.error(`[setup-monitors] FAILED for ${eventSignature}: ${msg}`);
      }
    }
  }

  console.log("[setup-monitors] Done. Monitor IDs:");
  for (const [sig, id] of created) console.log(`  ${sig}: ${id}`);
  console.log(
    "[setup-monitors] Check delivery status in the Developer Console → Contracts → Monitoring.",
  );
}

main().catch((err: unknown) => {
  console.error("[setup-monitors] fatal:", err instanceof Error ? err.message : err);
  process.exit(1);
});
