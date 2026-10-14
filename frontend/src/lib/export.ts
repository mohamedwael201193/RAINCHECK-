/**
 * Receipt export — CSV + JSON downloads of the live receipt list.
 *
 * Everything exported comes from the receipts already loaded on the page
 * (chain-derived via the Receipt API). Nothing is invented, nothing is
 * fetched twice. Pure functions so they stay unit-testable.
 */
import type { Receipt } from "./receipts";

export const EXPORT_COLUMNS = [
  "paymentId",
  "seller",
  "buyer",
  "amount_base_units",
  "token",
  "status",
  "updatedAt_iso",
] as const;

function csvCell(v: string): string {
  // Quote when the value contains a comma, quote, or newline.
  return /[",\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

/** One CSV row per receipt, newest first (the list is already sorted). */
export function receiptsToCsv(receipts: Receipt[]): string {
  const rows = receipts.map((r) =>
    [
      r.paymentId,
      r.seller,
      r.buyer ?? "",
      r.amount,
      r.token === "EURC" ? "EURC" : "USDC",
      String(r.status),
      r.updatedAt ? new Date(r.updatedAt).toISOString() : "",
    ]
      .map(csvCell)
      .join(","),
  );
  return [EXPORT_COLUMNS.join(","), ...rows].join("\n") + "\n";
}

/** Pretty JSON of the receipts as loaded — a verbatim snapshot. */
export function receiptsToJson(receipts: Receipt[]): string {
  return JSON.stringify(receipts, null, 2) + "\n";
}

/** Trigger a browser download. No-op outside a DOM environment. */
export function downloadFile(
  filename: string,
  content: string,
  mime: string,
): void {
  if (typeof document === "undefined" || typeof URL === "undefined") return;
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Revoke on the next tick so the download has started.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** raincheck-receipts-20261015.csv — local date, no timezone games. */
export function exportFilename(ext: "csv" | "json"): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `raincheck-receipts-${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}.${ext}`;
}
