import { Link } from "react-router-dom";
import TokenIcon from "../TokenIcon";
import {
  Receipt,
  formatRelative,
  formatUSDC,
  shortHex,
  statusMeaning,
} from "../../lib/receipts";

/**
 * One receipt as a dashboard ticket — the RAINCHECK motif: a receipt you
 * can hold. Dark stub (status + amount) up top, a perforation tear, then
 * the warm-paper stub with the machine facts (paymentId, seller, time).
 * All values come from the Receipt API — nothing here is fabricated.
 * The whole ticket links to /dashboard/r/<id>.
 */

function Pill({ status }: { status: string }) {
  const key = String(status).toLowerCase();
  const cls =
    key === "open" ||
    key === "attested" ||
    key === "flagged" ||
    key === "captured" ||
    key === "voided"
      ? `rcx-pill rcx-pill-${key}`
      : "rcx-pill rcx-pill-unknown";
  return (
    <span className={cls} title={`${status} — ${statusMeaning(status)}`}>
      {status}
    </span>
  );
}

function TicketMark() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M6 3h12v18l-2.5-1.7L13 21l-2.5-1.7L8 21l-2-1.3V3z" />
      <path d="M9.5 12.5h5M9.5 15.5h3.5" />
    </svg>
  );
}

export default function ReceiptCard({ receipt }: { receipt: Receipt }) {
  const to = `/dashboard/r/${receipt.paymentId}`;
  const symbol = receipt.token === "EURC" ? "EURC" : "USDC";
  const exactAmount = `${formatUSDC(receipt.amount)} ${symbol}`;
  return (
    <Link
      to={to}
      className="rc-ticket rcx-rise"
      aria-label={`Receipt ${receipt.paymentId}, ${receipt.status}, ${exactAmount}`}
    >
      <div className="rc-ticket-top">
        <span className="rc-ticket-label">
          <TicketMark />
          Receipt
        </span>
        <Pill status={String(receipt.status)} />
      </div>

      <div
        className="rc-ticket-amount"
        title={`Exact amount locked: ${receipt.amount} of 6-decimal ${symbol}`}
      >
        <span className="rc-token-ring" aria-hidden="true">
          <TokenIcon token={symbol} size={30} />
        </span>
        <span className="rc-ticket-figure">
          <span className="rc-ticket-value">{formatUSDC(receipt.amount)}</span>
          <span className="rc-ticket-sym">{symbol} · locked</span>
        </span>
      </div>

      <div className="rc-ticket-perf" aria-hidden="true" />

      <div className="rc-ticket-stub">
        <div className="rc-ticket-row">
          <span className="rc-ticket-k">paymentId</span>
          <span className="rc-ticket-v" title={receipt.paymentId}>
            {shortHex(receipt.paymentId)}
          </span>
        </div>
        <div className="rc-ticket-row">
          <span className="rc-ticket-k">seller</span>
          <span className="rc-ticket-v" title={receipt.seller}>
            {shortHex(receipt.seller)}
          </span>
        </div>
        <div className="rc-ticket-row">
          <span className="rc-ticket-k">updated</span>
          <span className="rc-ticket-v-dim">
            {formatRelative(receipt.updatedAt)}
          </span>
        </div>
      </div>
    </Link>
  );
}
