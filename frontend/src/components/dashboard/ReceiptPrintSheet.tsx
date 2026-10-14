import { createPortal } from "react-dom";
import type { PrintModel } from "../../lib/printReceipt";
import "./ReceiptPrintSheet.css";

/**
 * ReceiptPrintSheet — the print-optimized receipt record.
 *
 * Rendered into a portal on document.body and hidden on screen; the
 * `@media print` stylesheet shows ONLY this sheet and hides the app, so
 * window.print() / "Save as PDF" produces a clean paper record with no app
 * chrome. Black on white, full URLs (paper can't click), every section from
 * the live print model — paymentId, parties, amounts, token, status timeline
 * with tx hashes + explorer links, delivery evidence, and the oracle block
 * when the indexer served one.
 */
export default function ReceiptPrintSheet({
  model,
}: {
  model: PrintModel | null;
}) {
  if (typeof document === "undefined" || !model) return null;
  return createPortal(
    <article className="rc-print-sheet" aria-hidden="true">
      <header className="rcp-head">
        <p className="rcp-brand">RAINCHECK — Receipt record</p>
        <h1>Receipt {model.paymentId.slice(0, 18)}…</h1>
        <p className="rcp-sub">
          Printed {model.printedAtIso} · Arc mainnet (chain 5042) · Generated
          from the receipt API and on-chain reads — verify any entry at
          https://explorer.arc.io
        </p>
      </header>

      <section className="rcp-section" aria-label="Summary">
        <h2>Summary</h2>
        <table className="rcp-table">
          <tbody>
            <Row label="paymentId" value={model.paymentId} mono />
            <Row
              label="Status"
              value={
                model.statusMeaning
                  ? `${model.status} — ${model.statusMeaning}`
                  : model.status
              }
            />
            <Row
              label="Amount"
              value={`${model.amount} ${model.token} (${model.amountBaseUnits} base units)`}
              mono
            />
            <Row label="Buyer" value={model.buyer} mono />
            <Row label="Seller" value={model.seller} mono />
            <Row
              label="Delivery deadline"
              value={model.deadlineIso ?? "not set"}
              mono
            />
            <Row label="termsHash" value={model.termsHash} mono />
            {model.escrow && <Row label="Escrow contract" value={model.escrow} mono />}
          </tbody>
        </table>
      </section>

      {model.termsJson && (
        <section className="rcp-section" aria-label="Terms">
          <h2>Signed terms</h2>
          <pre className="rcp-pre">{model.termsJson}</pre>
        </section>
      )}

      <section className="rcp-section" aria-label="Delivery">
        <h2>Delivery</h2>
        {model.outputHash ? (
          <table className="rcp-table">
            <tbody>
              <Row label="outputHash (sha256 of delivered bytes)" value={model.outputHash} mono />
              {model.attestedAtIso && (
                <Row label="Confirmed at" value={model.attestedAtIso} mono />
              )}
            </tbody>
          </table>
        ) : (
          <p className="rcp-note">No delivery confirmed on this receipt.</p>
        )}
        {model.flagReasonHash && (
          <table className="rcp-table">
            <tbody>
              <Row label="Disputed by" value={model.flaggedBy ?? "—"} mono />
              <Row label="reasonHash" value={model.flagReasonHash} mono />
            </tbody>
          </table>
        )}
      </section>

      {model.oraclePresent && (
        <section className="rcp-section" aria-label="Oracle">
          <h2>Oracle attestation</h2>
          <pre className="rcp-pre">{model.oracleJson}</pre>
        </section>
      )}

      <section className="rcp-section" aria-label="Timeline">
        <h2>Timeline — every state transition</h2>
        {model.timeline.length === 0 ? (
          <p className="rcp-note">No transitions recorded yet.</p>
        ) : (
          <table className="rcp-table rcp-timeline">
            <thead>
              <tr>
                <th>Event</th>
                <th>Time (UTC)</th>
                <th>Transaction</th>
              </tr>
            </thead>
            <tbody>
              {model.timeline.map((e, i) => (
                <tr key={`${e.txHash}-${i}`}>
                  <td>
                    {e.label}
                    <br />
                    <span className="rcp-dim">{e.event}</span>
                    {e.memoIndex !== null && (
                      <>
                        <br />
                        <span className="rcp-dim">Memo #{e.memoIndex}</span>
                      </>
                    )}
                  </td>
                  <td className="rcp-mono">{e.blockTimeIso ?? "—"}</td>
                  <td>
                    <span className="rcp-mono">{e.txHash}</span>
                    <br />
                    <span className="rcp-dim rcp-url">{e.explorerUrl}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <footer className="rcp-foot">
        <p>
          This record was generated from the receipt indexer (a cache over
          chain events) and direct on-chain reads. The chain is the source of
          truth — if this printout ever disagrees with explorer.arc.io, the
          explorer wins.
        </p>
      </footer>
    </article>,
    document.body,
  );
}

function Row({
  label,
  value,
  mono,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <tr>
      <th scope="row">{label}</th>
      <td className={mono ? "rcp-mono" : undefined}>{value}</td>
    </tr>
  );
}
