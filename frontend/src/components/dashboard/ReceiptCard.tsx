import { Link } from "react-router-dom";
import TokenIcon from "../TokenIcon";
import {
  Receipt,
  formatExact,
  formatRelative,
  formatUSDC,
  shortHex,
  statusMeaning,
} from "../../lib/receipts";

/**
 * One receipt as a dashboard card — shadcn anatomy per the design standard:
 * CardHeader = label + status badge, CardContent = value (amount).
 * No glow, no tilt, no marketing effects. All values come from the Receipt
 * API (GET /api/receipts) — nothing here is fabricated. The whole card links
 * to the receipt detail screen at /dashboard/r/<id>.
 */
export default function ReceiptCard({ receipt }: { receipt: Receipt }) {
  const to = `/dashboard/r/${receipt.paymentId}`;
  const pill = `rc-pill rc-pill-${String(receipt.status).toLowerCase()}`;
  const symbol = receipt.token === "EURC" ? "EURC" : "USDC";
  const exactAmount = `${formatUSDC(receipt.amount)} ${symbol}`;
  return (
    <Link
      to={to}
      className="rc-card"
      aria-label={`Receipt ${receipt.paymentId}, ${receipt.status}, ${exactAmount}`}
    >
      <div className="rc-card-head">
        <span className="rc-card-label">Receipt</span>
        <span
          className={pill}
          title={`${receipt.status} — ${statusMeaning(receipt.status)}`}
        >
          {receipt.status}
        </span>
      </div>

      <div
        className="rc-card-value"
        title={`Exact amount locked: ${receipt.amount} of 6-decimal ${symbol}`}
      >
        {formatUSDC(receipt.amount)}
        <span className="rc-card-unit">
          <TokenIcon token={symbol} size={16} />
          {symbol}
        </span>
      </div>

      <div className="rc-card-meta">
        <span className="rc-mono" title={receipt.paymentId}>
          {shortHex(receipt.paymentId)}
        </span>
      </div>
      <div className="rc-card-meta-dim">
        seller{" "}
        <span className="rc-mono" title={receipt.seller}>
          {shortHex(receipt.seller)}
        </span>
        {" · "}
        <span title={formatExact(receipt.updatedAt)}>
          {formatRelative(receipt.updatedAt)}
        </span>
      </div>
    </Link>
  );
}
