/**
 * F7 — Verify logic (build bible §8.1 S4, the "don't trust me, check" screen).
 *
 * Everything here is read-only and wallet-less: it recomputes the receipt
 * fingerprint locally and reads the Memo anchor straight from the Arc RPC.
 *
 * Memo log layout (matches backend/src/indexer/config.ts + matcher.ts):
 *   Memo(address indexed sender, address indexed target,
 *        bytes32 indexed callDataHash, bytes32 memoId, bytes memo,
 *        uint256 memoIndex)
 *   topics = [sig, sender, target, callDataHash]
 *   data   = memoId(32B) | offset(32B) | memoIndex(32B) | memo bytes…
 * Binding rule: topics[3] MUST equal keccak256(tx.input) — the annotation is
 * cryptographically bound to the exact calldata that executed.
 */
import { keccak256, toHex } from "viem";
import { jcs, receiptHash, txFromAnchor } from "./jcs";
import { envVar, MEMO_ADDRESS, publicClient, tokenSymbolForEscrow } from "./chain";

const MEMO_TOPIC = keccak256(
  toHex("Memo(address,address,bytes32,bytes32,bytes,uint256)"),
).toLowerCase();
const BEFORE_MEMO_TOPIC = keccak256(toHex("BeforeMemo(uint256)")).toLowerCase();
const MEMO_ADDR = MEMO_ADDRESS.toLowerCase();

const ESCROW_EVENT_SIGS = [
  "RaincheckOpened(bytes32,address,address,bytes32,uint256,uint256)",
  "DeliveryAttested(bytes32,bytes32,uint256)",
  "RaincheckCaptured(bytes32,uint256)",
  "NonDeliveryFlagged(bytes32,bytes32)",
  "RaincheckVoided(bytes32,uint256,address)",
] as const;

const ESCROW_TOPICS: Record<string, string> = Object.fromEntries(
  ESCROW_EVENT_SIGS.map((s) => [
    keccak256(toHex(s)).toLowerCase(),
    s.slice(0, s.indexOf("(")),
  ]),
);

export interface InnerEvent {
  name: string;
  paymentId: string | null;
  logIndex: number;
}

export interface MemoAnchor {
  memoIndex: number | null;
  sender: string | null;
  target: string | null;
  memoId: string | null;
  loggedCallDataHash: string | null;
  recomputedCallDataHash: string | null;
  bindingOk: boolean;
  memoAscii: string | null;
  innerEvents: InnerEvent[];
}

export interface VerifyCheck {
  label: string;
  pass: boolean;
  detail: string;
}

export interface VerifyReport {
  /** recomputed lowercase-hex(SHA-256(JCS(receipt))) — the local ground truth */
  receiptHash: string;
  canonicalBytes: number;
  /** receiptHash claimed by the pasted view (if it included one) */
  claimedHash: string | null;
  /** payment-token symbol from the pasted API view (null = view didn't say) */
  token: string | null;
  txHash: string;
  txFound: boolean;
  txStatus: "success" | "reverted" | null;
  anchors: string[];
  memo: MemoAnchor | null;
  memoCount: number;
  verdict: "MATCH" | "MISMATCH";
  checks: VerifyCheck[];
  fatalError: string | null;
}

function topicAddr(topic: string | undefined): string | null {
  if (!topic) return null;
  return ("0x" + topic.slice(-40)).toLowerCase();
}

function memoIndexFromData(data: string): number | null {
  try {
    if (data && data.length >= 2 + 192) {
      return Number(BigInt("0x" + data.slice(2 + 128, 2 + 192)));
    }
  } catch {
    /* fall through */
  }
  return null;
}

function memoBytesFromData(data: string): { id: string | null; ascii: string | null } {
  try {
    if (data && data.length >= 2 + 192) {
      const id = "0x" + data.slice(2, 2 + 64);
      const off = Number(BigInt("0x" + data.slice(2 + 64, 2 + 128)));
      const len = Number(BigInt("0x" + data.slice(2 + off * 2, 2 + off * 2 + 64)));
      const bytesHex = data.slice(2 + off * 2 + 64, 2 + off * 2 + 64 + len * 2);
      const bytes = new Uint8Array(
        bytesHex.match(/../g)?.map((b) => parseInt(b, 16)) ?? [],
      );
      let ascii = "";
      for (const b of bytes) ascii += b >= 32 && b < 127 ? String.fromCharCode(b) : "·";
      return { id, ascii: ascii || null };
    }
  } catch {
    /* fall through */
  }
  return { id: null, ascii: null };
}

/**
 * Accept either the canonical receipt JSON or the full API view
 * ({receipt, receiptHash, timeline}). Returns the canonical receipt object,
 * the claimed hash (if present), anchor tx hashes and timeline tx hashes.
 */
export function unwrapPasted(
  text: string,
): {
  receipt: Record<string, unknown>;
  claimedHash: string | null;
  /** Payment-token symbol from the pasted API view (null = the pasted JSON didn't say). */
  token: string | null;
  anchors: string[];
  timelineTxs: string[];
} {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error(
      "That doesn't look like JSON — it couldn't be parsed. Copy the receipt JSON exactly as the API served it.",
    );
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("The pasted text isn't a receipt object.");
  }
  const obj = parsed as Record<string, unknown>;
  const receipt =
    obj.receipt && typeof obj.receipt === "object" && !Array.isArray(obj.receipt)
      ? (obj.receipt as Record<string, unknown>)
      : obj;
  if (!receipt.paymentId || typeof receipt.paymentId !== "string") {
    throw new Error(
      "No paymentId found — this doesn't look like a RAINCHECK receipt. Expected the canonical receipt JSON with a paymentId field.",
    );
  }
  const claimedHash =
    typeof obj.receiptHash === "string" && /^0x?[0-9a-fA-F]{64}$/.test(obj.receiptHash)
      ? obj.receiptHash.replace(/^0x/, "").toLowerCase()
      : null;
  const anchors: string[] = [];
  if (Array.isArray(receipt.anchors)) {
    for (const a of receipt.anchors) {
      const t = typeof a === "string" ? txFromAnchor(a) : null;
      if (t) anchors.push(t);
    }
  }
  const timelineTxs: string[] = [];
  if (Array.isArray(obj.timeline)) {
    for (const t of obj.timeline) {
      const h =
        t && typeof t === "object" ? (t as Record<string, unknown>).txHash : null;
      if (typeof h === "string" && /^0x[0-9a-fA-F]{64}$/.test(h)) timelineTxs.push(h);
    }
  }
  // Payment token: the full API view serves `token` (derived from the
  // originating escrow address); fall back to deriving from `escrow`.
  // The canonical receipt itself is token-blind by design (§4.6).
  let token: string | null = null;
  if (obj.token === "USDC" || obj.token === "EURC") token = obj.token;
  else if (typeof obj.escrow === "string") token = tokenSymbolForEscrow(obj.escrow);
  return { receipt, claimedHash, token, anchors, timelineTxs };
}

/**
 * Run the full verification against the chain. Throws only on fatal,
 * user-fixable problems (bad input, RPC unreachable); returns a report with
 * per-check results otherwise. Verdict is MATCH only when every check passes.
 */
export async function verifyReceipt(
  receiptText: string,
  txHashInput: string,
): Promise<VerifyReport> {
  const { receipt, claimedHash, token, anchors, timelineTxs } = unwrapPasted(receiptText);

  let canonical: string;
  let hash: string;
  try {
    canonical = jcs(receipt);
    hash = receiptHash(receipt);
  } catch (e) {
    throw new Error(
      `The receipt couldn't be canonicalized: ${(e as Error).message}. ` +
        "Receipts only use strings, integers, booleans, null, arrays and objects.",
    );
  }

  const input = txHashInput.trim();
  const txHash =
    input || anchors[0] || timelineTxs[0] || "";
  if (!/^0x[0-9a-fA-F]{64}$/.test(txHash)) {
    throw new Error(
      "No anchor transaction to check. Enter a 0x-prefixed transaction hash, or paste a receipt whose anchors list one (eip155:5042:0x…).",
    );
  }

  const checks: VerifyCheck[] = [];
  const allAnchors = [...anchors, ...timelineTxs.filter((t) => !anchors.includes(t))];

  if (claimedHash !== null) {
    const pass = claimedHash === hash;
    checks.push({
      label: "Receipt fingerprint matches what was served",
      pass,
      detail: pass
        ? "The JSON you pasted hashes to the receiptHash it came with — nothing was edited in transit."
        : "The JSON you pasted does NOT hash to the receiptHash it came with. The receipt was altered after it was issued.",
    });
  }

  // --- chain reads (read-only; no wallet) ---
  let tx: { input: `0x${string}` } | null = null;
  let receiptLogs:
    | { address: string; topics: string[]; data: string; logIndex: number }[]
    | null = null;
  let status: "success" | "reverted" | null = null;
  try {
    const [t, r] = await Promise.all([
      publicClient.getTransaction({ hash: txHash as `0x${string}` }),
      publicClient.getTransactionReceipt({ hash: txHash as `0x${string}` }),
    ]);
    tx = t;
    status = r.status;
    receiptLogs = r.logs.map((l) => ({
      address: l.address,
      topics: [...l.topics],
      data: l.data,
      logIndex: Number(l.logIndex),
    }));
  } catch (e) {
    const msg = String((e as Error)?.message ?? e);
    if (/not found|unknown|does not exist/i.test(msg)) {
      return fail(hash, canonical.length, claimedHash, token, txHash, allAnchors, [
        ...checks,
        {
          label: "Anchor transaction exists on Arc",
          pass: false,
          detail:
            "No transaction with that hash was found on Arc mainnet. Check the hash for typos.",
        },
      ]);
    }
    throw new Error(
      `Couldn't reach the Arc RPC to read the transaction (${msg.slice(0, 160)}). Check your connection and try again.`,
    );
  }

  const txFoundCheck: VerifyCheck = {
    label: "Anchor transaction exists on Arc",
    pass: true,
    detail: "The transaction was found on Arc mainnet (chain 5042).",
  };
  const statusCheck: VerifyCheck = {
    label: "Anchor transaction succeeded",
    pass: status === "success",
    detail:
      status === "success"
        ? "The transaction executed successfully — its Memo anchor is real."
        : "The transaction reverted on-chain, so it anchored nothing.",
  };
  checks.push(txFoundCheck, statusCheck);
  if (status !== "success" || !tx || !receiptLogs) {
    return fail(hash, canonical.length, claimedHash, token, txHash, allAnchors, checks);
  }

  // --- find Memo logs and verify the binding ---
  const sorted = [...receiptLogs].sort((a, b) => a.logIndex - b.logIndex);
  const memoLogs = sorted.filter(
    (l) =>
      l.address.toLowerCase() === MEMO_ADDR &&
      l.topics[0]?.toLowerCase() === MEMO_TOPIC,
  );
  const beforeIdx = sorted
    .filter((l) => l.topics[0]?.toLowerCase() === BEFORE_MEMO_TOPIC)
    .map((l) => l.logIndex);

  const recomputedCallDataHash = keccak256(tx.input).toLowerCase();

  let best: MemoAnchor | null = null;
  for (const log of memoLogs) {
    const loggedCallDataHash = log.topics[3]?.toLowerCase() ?? null;
    const { id, ascii } = memoBytesFromData(log.data);
    const prevBefore = Math.max(-1, ...beforeIdx.filter((i) => i < log.logIndex));
    const innerEvents: InnerEvent[] = sorted
      .filter(
        (l) =>
          l.logIndex > prevBefore &&
          l.logIndex < log.logIndex &&
          l.topics[0] &&
          ESCROW_TOPICS[l.topics[0].toLowerCase()],
      )
      .map((l) => ({
        name: ESCROW_TOPICS[l.topics[0].toLowerCase()],
        paymentId: l.topics[1] ?? null,
        logIndex: l.logIndex,
      }));
    const anchor: MemoAnchor = {
      memoIndex: memoIndexFromData(log.data),
      sender: topicAddr(log.topics[1]),
      target: topicAddr(log.topics[2]),
      memoId: id,
      loggedCallDataHash,
      recomputedCallDataHash,
      bindingOk: loggedCallDataHash === recomputedCallDataHash,
      memoAscii: ascii,
      innerEvents,
    };
    if (!best || anchor.bindingOk) best = anchor;
    if (anchor.bindingOk) break;
  }

  const receiptPaymentId = String(receipt.paymentId).toLowerCase();
  const anchoredPaymentId =
    best?.innerEvents.find((e) => e.paymentId)?.paymentId?.toLowerCase() ?? null;

  checks.push({
    label: "Memo anchor present in the transaction",
    pass: best !== null,
    detail:
      best !== null
        ? `Found the Memo log (memoIndex ${best.memoIndex ?? "unknown"}) emitted by the Memo contract in this transaction.`
        : "This transaction contains no Memo log — it anchored nothing.",
  });
  if (best) {
    checks.push({
      label: "Memo is bound to the exact calldata",
      pass: best.bindingOk,
      detail: best.bindingOk
        ? "The Memo's callDataHash equals keccak256 of the transaction's actual input — the annotation can't be swapped onto different calldata."
        : "The Memo's callDataHash does NOT match this transaction's input. The anchor is not bound to what executed.",
    });
    checks.push({
      label: "Anchor covers this receipt's payment",
      pass: anchoredPaymentId === receiptPaymentId,
      detail:
        anchoredPaymentId === receiptPaymentId
          ? `The anchored escrow event references paymentId ${String(receipt.paymentId).slice(0, 18)}… — the same payment as this receipt.`
          : anchoredPaymentId
            ? "The anchored event references a different paymentId than this receipt — wrong anchor transaction for this receipt."
            : "No escrow event was found between the Memo markers, so the anchor can't be tied to this receipt.",
    });
  }

  const verdict: "MATCH" | "MISMATCH" = checks.every((c) => c.pass)
    ? "MATCH"
    : "MISMATCH";
  return {
    receiptHash: hash,
    canonicalBytes: canonical.length,
    claimedHash,
    token,
    txHash,
    txFound: true,
    txStatus: status,
    anchors: allAnchors,
    memo: best,
    memoCount: memoLogs.length,
    verdict,
    checks,
    fatalError: null,
  };
}

function fail(
  receiptHash_: string,
  canonicalBytes: number,
  claimedHash: string | null,
  token: string | null,
  txHash: string,
  anchors: string[],
  checks: VerifyCheck[],
): VerifyReport {
  return {
    receiptHash: receiptHash_,
    canonicalBytes,
    claimedHash,
    token,
    txHash,
    txFound: checks.some((c) => c.label.includes("exists") && c.pass),
    txStatus: null,
    anchors,
    memo: null,
    memoCount: 0,
    verdict: "MISMATCH",
    checks,
    fatalError: null,
  };
}

/** API base for the "try with a live receipt" helper. Null when not configured. */
export function receiptsApiBase(): string | null {
  const base = envVar("VITE_API_URL")?.replace(/\/+$/, "");
  return base || null;
}

/** Fetch the newest receipt view from the indexer — real data, never invented. */
export async function fetchNewestReceiptView(): Promise<{
  text: string;
  txHash: string;
}> {
  const base = receiptsApiBase();
  if (!base) {
    throw new Error(
      "The receipt API isn't configured in this build (VITE_API_URL is empty), so there's no live receipt to load. Paste one manually instead.",
    );
  }
  const listRes = await fetch(`${base}/api/receipts?limit=1`);
  if (!listRes.ok) throw new Error(`The receipt API answered ${listRes.status}.`);
  const list = (await listRes.json()) as { receipts?: { paymentId: string }[] };
  const first = list.receipts?.[0];
  if (!first) throw new Error("The indexer has no receipts yet — nothing live to load.");
  const viewRes = await fetch(`${base}/api/receipts/${first.paymentId}`);
  if (!viewRes.ok) throw new Error(`Couldn't load receipt ${first.paymentId.slice(0, 18)}….`);
  const view = (await viewRes.json()) as {
    timeline?: { txHash: string }[];
  };
  return {
    text: JSON.stringify(view, null, 2),
    txHash: view.timeline?.[0]?.txHash ?? "",
  };
}
