import { useMemo } from "react";
import TokenIcon from "../TokenIcon";
import { NumberTicker } from "../vendor/magicui/NumberTicker";
import {
  downloadFile,
  exportFilename,
  receiptsToCsv,
  receiptsToJson,
} from "../../lib/export";
import { type Receipt } from "../../lib/receipts";
import "./StatsStrip.css";

/**
 * StatsStrip — the honest aggregate row, relay "TAPE" style.
 *
 * Every figure is computed from the live receipt list. While loading, cells
 * show "—" — never a placeholder number. Export buttons download the exact
 * receipts on screen as CSV/JSON; they render only when there is data to
 * export (nothing to fake, nothing to download).
 */

function sumLocked(receipts: Receipt[], token: "USDC" | "EURC"): bigint {
  let total = 0n;
  for (const r of receipts) {
    const s = String(r.status);
    if (s !== "OPEN" && s !== "ATTESTED" && s !== "FLAGGED") continue;
    if ((r.token === "EURC") !== (token === "EURC")) continue;
    try {
      total += BigInt(r.amount);
    } catch {
      /* malformed amount — skip, never invent */
    }
  }
  return total;
}

function Cell({
  label,
  value,
  sub,
  icon,
  title,
}: {
  label: string;
  /** Rendered figure — "—" while loading, NumberTicker once live. */
  value: React.ReactNode;
  sub: string;
  icon?: React.ReactNode;
  title?: string;
}) {
  return (
    <div className="rcss-cell">
      <div className="rcss-label">{label}</div>
      <div className="rcss-value" title={title}>
        {icon}
        <span className="rcss-num">{value}</span>
      </div>
      <div className="rcss-sub">{sub}</div>
    </div>
  );
}

export default function StatsStrip({
  receipts,
}: {
  receipts: Receipt[] | null;
}) {
  const stats = useMemo(() => {
    if (!receipts) return null;
    const list = receipts;
    return {
      open: list.filter((r) => String(r.status) === "OPEN").length,
      escrowedUsdc: sumLocked(list, "USDC").toString(),
      escrowedEurc: sumLocked(list, "EURC").toString(),
      disputes: list.filter((r) => String(r.status) === "FLAGGED").length,
    };
  }, [receipts]);

  const hasData = !!receipts && receipts.length > 0;

  // NumberTicker needs plain numbers; base units are 6-decimal.
  const toFloat = (base: string): number => {
    try {
      return Number(BigInt(base)) / 1e6;
    } catch {
      return 0;
    }
  };

  const onExportCsv = () => {
    if (!receipts) return;
    downloadFile(exportFilename("csv"), receiptsToCsv(receipts), "text/csv");
  };
  const onExportJson = () => {
    if (!receipts) return;
    downloadFile(
      exportFilename("json"),
      receiptsToJson(receipts),
      "application/json",
    );
  };

  return (
    <section className="rcss" aria-label="Escrow statistics">
      <div className="rcss-grid">
        <Cell
          label="Open receipts"
          value={
            stats === null ? (
              "—"
            ) : (
              <NumberTicker value={stats.open} decimalPlaces={0} />
            )
          }
          sub="money locked, waiting for delivery"
        />
        <Cell
          label="Escrowed · USDC"
          value={
            stats === null ? (
              "—"
            ) : (
              <NumberTicker
                value={toFloat(stats.escrowedUsdc)}
                decimalPlaces={2}
              />
            )
          }
          sub="locked in open receipts"
          icon={<TokenIcon token="USDC" size={26} />}
          title={
            stats === null
              ? undefined
              : `${stats.escrowedUsdc} base units (6 decimals)`
          }
        />
        <Cell
          label="Escrowed · EURC"
          value={
            stats === null ? (
              "—"
            ) : (
              <NumberTicker
                value={toFloat(stats.escrowedEurc)}
                decimalPlaces={2}
              />
            )
          }
          sub="locked in open receipts"
          icon={<TokenIcon token="EURC" size={26} />}
          title={
            stats === null
              ? undefined
              : `${stats.escrowedEurc} base units (6 decimals)`
          }
        />
        <Cell
          label="Disputes"
          value={
            stats === null ? (
              "—"
            ) : (
              <NumberTicker value={stats.disputes} decimalPlaces={0} />
            )
          }
          sub="flagged, awaiting resolution"
        />
      </div>
      {hasData && (
        <div className="rcss-export">
          <span className="rcss-export-label">Export this list</span>
          <button
            type="button"
            className="rcss-export-btn"
            onClick={onExportCsv}
          >
            CSV
          </button>
          <button
            type="button"
            className="rcss-export-btn"
            onClick={onExportJson}
          >
            JSON
          </button>
        </div>
      )}
      <p className="rcss-note">
        Read from on-chain escrow activity — anything here can be checked
        against the chain itself.
      </p>
    </section>
  );
}
