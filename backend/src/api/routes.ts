import { Router, type Request, type Response } from "express";
import { toUsdcString, PAYMENT_ID_RE } from "./chainStore.js";
import {
  ALL_STATUSES,
  CHAIN_ID,
  ESCROW_ADDRESS,
  ESCROW_ADDRESS_EURC,
  isReceiptStatus,
  tokenForEscrow,
  type ReceiptSource,
  type ReceiptStatus,
  type ReceiptSummary,
} from "./types.js";

const MAX_LIMIT = 100;
const DEFAULT_LIMIT = 50;

function badRequest(res: Response, message: string) {
  return res.status(400).json({ error: message });
}

function parsePagination(req: Request): { limit: number; offset: number } | { error: string } {
  const rawLimit = req.query.limit ?? String(DEFAULT_LIMIT);
  const rawOffset = req.query.offset ?? "0";
  const limit = Number(rawLimit);
  const offset = Number(rawOffset);
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_LIMIT) {
    return { error: `limit must be an integer between 1 and ${MAX_LIMIT}` };
  }
  if (!Number.isInteger(offset) || offset < 0) {
    return { error: "offset must be a non-negative integer" };
  }
  return { limit, offset };
}

/**
 * Receipt API routes. Every field served here traces to chain logs via the
 * ReceiptSource (a cache); nothing is invented. Source-of-truth rule (§3):
 * the chain decides, the cache reports.
 */
export function createRoutes(store: ReceiptSource): Router {
  const r = Router();

  /**
   * GET /api/receipts — list receipts, newest first.
   * Query: ?status=OPEN|ATTESTED|FLAGGED|VOIDED|CAPTURED &limit= &offset=
   */
  r.get("/receipts", async (req: Request, res: Response) => {
    const statusRaw = req.query.status as string | undefined;
    let status: ReceiptStatus | undefined;
    if (statusRaw !== undefined) {
      if (!isReceiptStatus(statusRaw.toUpperCase())) {
        return badRequest(
          res,
          `status must be one of ${ALL_STATUSES.join("|")}`,
        );
      }
      status = statusRaw.toUpperCase() as ReceiptStatus;
    }

    const page = parsePagination(req);
    if ("error" in page) return badRequest(res, page.error);

    let items = await store.listReceipts();
    if (status) items = items.filter((v) => v.receipt.status === status);
    items = items
      .slice()
      .sort((a, b) => b.openedAt - a.openedAt || b.updatedAt - a.updatedAt);
    const total = items.length;
    const summaries: ReceiptSummary[] = items
      .slice(page.offset, page.offset + page.limit)
      .map((v) => ({
        paymentId: v.receipt.paymentId,
        status: v.receipt.status,
        buyer: v.buyer,
        seller: v.seller,
        // Presentation-only, derived from the originating escrow address via
        // the TOKEN_BY_ESCROW config map — never part of the canonical hash.
        token: tokenForEscrow(v.escrowAddress) ?? "USDC",
        escrow: (v.escrowAddress ?? ESCROW_ADDRESS).toLowerCase(),
        amountUSDC: toUsdcString(BigInt(v.receipt.paymentProof.amount)),
        amountUSDCBase: v.receipt.paymentProof.amount,
        openedAt: v.openedAt,
        updatedAt: v.updatedAt,
        receiptHash: v.receiptHash,
      }));

    return res.json({
      total,
      limit: page.limit,
      offset: page.offset,
      receipts: summaries,
    });
  });

  /**
   * GET /api/receipts/:paymentId — full receipt JSON + receiptHash + timeline.
   */
  r.get("/receipts/:paymentId", async (req: Request, res: Response) => {
    const paymentId = req.params.paymentId as string;
    if (!PAYMENT_ID_RE.test(paymentId)) {
      return badRequest(res, "paymentId must be a 0x-prefixed 32-byte hex string");
    }
    const view = await store.getReceipt(paymentId);
    if (!view) {
      return res.status(404).json({ error: "receipt not found" });
    }
    return res.json({
      receipt: view.receipt,
      receiptHash: view.receiptHash,
      timeline: view.timeline,
      // Presentation-only token + originating escrow (see list endpoint).
      // The /verify page unwraps this full view tolerantly — extra fields
      // never enter the canonical hash it recomputes.
      token: tokenForEscrow(view.escrowAddress) ?? "USDC",
      escrow: (view.escrowAddress ?? ESCROW_ADDRESS).toLowerCase(),
    });
  });

  /**
   * GET /api/stats — all fields derived from events.
   *
   * Multi-asset honesty: USDC and EURC are different assets, so volumes are
   * reported PER TOKEN. The legacy totalVolumeUSDC* names now mean the USDC
   * leg only (they did mean "everything" in the single-token era); the EURC
   * leg has its own fields. Counts (byStatus/byToken) never mix assets.
   */
  r.get("/stats", async (_req: Request, res: Response) => {
    const all = await store.listReceipts();
    const byStatus: Record<ReceiptStatus, number> = {
      OPEN: 0,
      ATTESTED: 0,
      FLAGGED: 0,
      VOIDED: 0,
      CAPTURED: 0,
    };
    const byToken = { USDC: 0, EURC: 0 };
    let volumeUSDCBase = 0n;
    let volumeEURCBase = 0n;
    let totalVoids = 0;
    for (const v of all) {
      byStatus[v.receipt.status] += 1;
      const token = tokenForEscrow(v.escrowAddress) ?? "USDC";
      byToken[token] += 1;
      if (token === "EURC") volumeEURCBase += BigInt(v.receipt.paymentProof.amount);
      else volumeUSDCBase += BigInt(v.receipt.paymentProof.amount);
      if (v.receipt.status === "VOIDED") totalVoids += 1;
    }
    return res.json({
      totalReceipts: all.length,
      byStatus,
      byToken,
      totalVolumeUSDCBase: volumeUSDCBase.toString(),
      totalVolumeUSDC: toUsdcString(volumeUSDCBase),
      totalVolumeEURCBase: volumeEURCBase.toString(),
      totalVolumeEURC: toUsdcString(volumeEURCBase),
      totalVoids,
    });
  });

  /**
   * GET /api/health
   */
  r.get("/health", (_req: Request, res: Response) => {
    const latest = store.latestIndexedBlock();
    return res.json({
      ok: true,
      chainId: CHAIN_ID,
      escrow: (process.env.ESCROW_ADDRESS ?? ESCROW_ADDRESS).toLowerCase(),
      escrows: [
        (process.env.ESCROW_ADDRESS ?? ESCROW_ADDRESS).toLowerCase(),
        (process.env.ESCROW_ADDRESS_EURC ?? ESCROW_ADDRESS_EURC).toLowerCase(),
      ],
      latestIndexedBlock: latest === null ? null : latest.toString(),
    });
  });

  return r;
}
