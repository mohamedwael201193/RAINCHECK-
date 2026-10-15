/**
 * V2 (experimental) chain-direct data access — src/lib/v2.ts
 *
 * The Receipt API indexer only tracks the V1 production escrows, so every
 * V2 surface reads the chain directly (eth_getLogs + eth_call). This is the
 * same "chain wins" principle the dashboard already applies to time-sensitive
 * gating — here it is the whole data source.
 *
 * Nothing here invents state: a receipt appears only when a RaincheckOpened
 * event exists on the V2 contract, and its status comes from an eth_call to
 * the V2 receipts() mapping.
 */
import { parseAbiItem } from "viem";
import {
  V2_DEPLOY_BLOCK,
  V2_ESCROW_ADDRESS,
  publicClient,
  readV2ReceiptFromChain,
} from "./chain";
import { normalizeStatusForV2 } from "./receipts";
import type { Receipt } from "./receipts";

const RAINCHECK_OPENED = parseAbiItem(
  "event RaincheckOpened(bytes32 indexed paymentId, address indexed buyer, address indexed seller, bytes32 termsHash, uint256 amount, uint256 deadline)",
);

type OpenedLog = {
  args: { paymentId?: `0x${string}` };
  blockNumber: bigint;
  transactionHash: `0x${string}`;
};

/**
 * Chunked eth_getLogs for the V2 RaincheckOpened event. The public Arc RPC
 * rejects wide ranges ("requested range too large"), so the scan walks
 * from the V2 deploy block in small chunks with one retry per chunk.
 * A chunk that fails twice throws — the caller surfaces it honestly.
 */
const LOG_CHUNK_SPAN = 4000n;

async function getV2OpenedLogs(): Promise<OpenedLog[]> {
  const latest = await publicClient.getBlockNumber();
  const out: OpenedLog[] = [];
  for (let from = V2_DEPLOY_BLOCK; from <= latest; from += LOG_CHUNK_SPAN) {
    const to = from + LOG_CHUNK_SPAN - 1n > latest ? latest : from + LOG_CHUNK_SPAN - 1n;
    let lastErr: unknown = null;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const logs = await publicClient.getLogs({
          address: V2_ESCROW_ADDRESS,
          event: RAINCHECK_OPENED,
          fromBlock: from,
          toBlock: to,
        });
        out.push(...(logs as unknown as OpenedLog[]));
        lastErr = null;
        break;
      } catch (e) {
        lastErr = e;
        await new Promise((r) => setTimeout(r, 1200));
      }
    }
    if (lastErr) {
      throw new Error(
        `V2 log scan failed for blocks ${from}–${to}: ${lastErr instanceof Error ? lastErr.message.slice(0, 140) : String(lastErr).slice(0, 140)}`,
      );
    }
  }
  return out;
}

/**
 * List every receipt ever opened on the V2 escrow, newest first.
 * Each entry is read from chain — no indexer, no cache.
 */
export async function fetchV2ReceiptsFromChain(): Promise<Receipt[]> {
  const logs = await getV2OpenedLogs();

  const receipts: Receipt[] = [];
  for (const log of logs) {
    const paymentId = log.args.paymentId as `0x${string}`;
    if (!paymentId) continue;
    try {
      const view = await readV2ReceiptFromChain(paymentId);
      let updatedAt: number | undefined;
      try {
        const block = await publicClient.getBlock({
          blockNumber: log.blockNumber,
        });
        updatedAt = Number(block.timestamp) * 1000;
      } catch {
        /* block timestamp optional — receipt still listed, sorts last */
      }
      receipts.push({
        paymentId,
        seller: view.seller,
        buyer: view.buyer,
        amount: view.amount.toString(),
        status: normalizeStatusForV2(view.statusName),
        token: "USDC",
        protocol: "V2",
        escrow: V2_ESCROW_ADDRESS,
        updatedAt,
      });
    } catch {
      // A receipt whose struct read fails is not listed — never guessed.
    }
  }
  receipts.sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0));
  return receipts;
}

/**
 * Newest V2 receipt for the Verify page's "load a live receipt" helper.
 * Returns canonical-ish receipt JSON (built from chain fields) plus the
 * authorize transaction hash as the anchor. The verify report will show
 * exactly which checks ran — the fingerprint check is skipped when no
 * claimed hash is present.
 */
export async function fetchNewestV2ReceiptForVerify(): Promise<{
  text: string;
  txHash: string;
}> {
  const logs = await getV2OpenedLogs();
  if (logs.length === 0) {
    throw new Error(
      "No V2 receipts exist on-chain yet — the experimental tier is empty. Open one from the dashboard's V2 tab first.",
    );
  }
  const newest = logs[logs.length - 1];
  const paymentId = newest.args.paymentId as string;
  const view = await readV2ReceiptFromChain(paymentId as `0x${string}`);
  const receipt = {
    paymentId,
    buyer: view.buyer,
    seller: view.seller,
    amount: view.amount.toString(),
    deadline: view.deadline.toString(),
    termsHash: view.termsHash,
    policyRef: view.policyRef,
    fundingRef: view.fundingRef,
    status: view.statusName,
    token: "USDC",
    protocol: "V2",
    escrow: V2_ESCROW_ADDRESS,
  };
  return {
    text: JSON.stringify(receipt, null, 2),
    txHash: newest.transactionHash,
  };
}
