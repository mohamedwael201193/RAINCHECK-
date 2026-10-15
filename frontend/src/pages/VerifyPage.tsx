import { useEffect, useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import AppShell from "../components/dashboard/AppShell";
import AmbientAurora from "../components/dashboard/AmbientAurora";
import { txUrl } from "../lib/chain";
import {
  fetchNewestReceiptView,
  unwrapPasted,
  verifyReceipt,
  type InnerEvent,
  type VerifyCheck,
  type VerifyReport,
} from "../lib/verify";
import { fetchNewestV2ReceiptForVerify } from "../lib/v2";
import "../styles/app.css";
import "./VerifyPage.css";

/**
 * F7 — Verify (build bible §8.1 S4). The "don't trust me, check" screen.
 *
 * No wallet needed: the fingerprint is recomputed in the browser and the
 * anchor transaction is read straight from the Arc RPC. Verdict is MATCH only
 * when every check passes; anything else is MISMATCH with the failing check
 * explained in plain words. No fake data — while the RPC read is in flight
 * the result area shows skeletons, never invented rows.
 */

const formSchema = z.object({
  receiptJson: z
    .string()
    .trim()
    .min(1, "Paste a receipt JSON first — the check needs something to hash."),
  txHash: z
    .string()
    .trim()
    .refine((v) => v === "" || /^0x[0-9a-fA-F]{64}$/.test(v), {
      message:
        "Enter a 0x-prefixed transaction hash (64 hex characters), or leave this empty to use the receipt's first anchor.",
    }),
});
type FormValues = z.infer<typeof formSchema>;

type Phase =
  | { kind: "idle" }
  | { kind: "loading-live" }
  | { kind: "verifying" }
  | { kind: "done"; report: VerifyReport }
  | { kind: "fatal"; message: string };

function Copyable({ value, short }: { value: string; short?: string }) {
  const [copied, setCopied] = useState(false);
  const shown = short ?? value;
  return (
    <span className="rc-code-wrap">
      <code className="rc-code" title={value}>
        {shown}
      </code>
      <button
        type="button"
        className="rc-copy"
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(value);
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          } catch {
            /* clipboard unavailable — the value is still selectable */
          }
        }}
        aria-label={copied ? "Copied" : `Copy ${shown}`}
      >
        {copied ? "Copied" : "Copy"}
      </button>
    </span>
  );
}

function CheckRow({ check }: { check: VerifyCheck }) {
  return (
    <li className={`rc-check ${check.pass ? "is-pass" : "is-fail"}`}>
      <span className="rc-check-mark" aria-hidden="true">
        {check.pass ? "✓" : "✗"}
      </span>
      <div>
        <div className="rc-check-label">{check.label}</div>
        <div className="rc-check-detail">{check.detail}</div>
      </div>
    </li>
  );
}

export default function VerifyPage() {
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  const verifyingRef = useRef(false);
  // Which tier the "try with a live receipt" helper loads from.
  // V2 loads straight from chain (the indexer doesn't track it).
  const [liveProto, setLiveProto] = useState<"V1" | "V2">("V1");

  const {
    register,
    handleSubmit,
    setValue,
    watch,
    clearErrors,
    formState: { errors },
  } = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: { receiptJson: "", txHash: "" },
  });

  const receiptJson = watch("receiptJson");
  const txHashValue = watch("txHash");

  // Auto-fill the anchor tx from the receipt's anchors when the user hasn't
  // typed one themselves.
  useEffect(() => {
    if (txHashValue.trim() !== "") return;
    try {
      const { anchors, timelineTxs } = unwrapPasted(receiptJson);
      const first = anchors[0] ?? timelineTxs[0];
      if (first) {
        setValue("txHash", first, { shouldValidate: true });
        clearErrors("txHash");
      }
    } catch {
      /* not parseable yet — user is still typing */
    }
  }, [receiptJson, txHashValue, setValue, clearErrors]);

  const onSubmit = async (values: FormValues) => {
    if (verifyingRef.current) return;
    verifyingRef.current = true;
    setPhase({ kind: "verifying" });
    try {
      const report = await verifyReceipt(values.receiptJson, values.txHash);
      setPhase({ kind: "done", report });
    } catch (e) {
      setPhase({
        kind: "fatal",
        message:
          e instanceof Error ? e.message : "Something went wrong. Please try again.",
      });
    } finally {
      verifyingRef.current = false;
    }
  };

  const loadLive = async () => {
    if (verifyingRef.current) return;
    verifyingRef.current = true;
    setPhase({ kind: "loading-live" });
    try {
      const { text, txHash } =
        liveProto === "V2"
          ? await fetchNewestV2ReceiptForVerify()
          : await fetchNewestReceiptView();
      setValue("receiptJson", text, { shouldValidate: true });
      if (txHash) setValue("txHash", txHash, { shouldValidate: true });
      clearErrors();
      setPhase({ kind: "idle" });
    } catch (e) {
      setPhase({
        kind: "fatal",
        message:
          e instanceof Error ? e.message : "Couldn't load a live receipt. Please try again.",
      });
    } finally {
      verifyingRef.current = false;
    }
  };

  const report = phase.kind === "done" ? phase.report : null;
  const busy = phase.kind === "verifying" || phase.kind === "loading-live";

  return (
    <AppShell title="Verify">
      <div className="rc-verify-inner">
        <header className="rc-verify-head rcx-rise">
          <p className="rcx-eyebrow">Trust, but verify</p>
          {/* CSS aurora glow + CC0 3D shield — the proof motif. */}
          <div className="rc-verify-art" aria-hidden="true">
            <AmbientAurora opacity={1} />
            <img
              src="/assets/3d/shield-3d.webp"
              width="96"
              height="96"
              alt=""
              draggable={false}
              className="rc-verify-shield3d"
            />
          </div>
          <h1 className="rc-display">
            DON&apos;T TRUST.
            <br />
            <span className="rc-display-accent">VERIFY.</span>
          </h1>
          <p className="rc-subline">
            Paste any receipt JSON. This page recomputes its fingerprint in your
            browser and checks it against the on-chain Memo anchor — no wallet
            needed, nothing is signed.
          </p>
          <div className="rc-verify-chips">
            <span className="rc-verify-chip">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6L9 17l-5-5" /></svg>
              No wallet needed
            </span>
            <span className="rc-verify-chip">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6L9 17l-5-5" /></svg>
              Nothing is signed
            </span>
            <span className="rc-verify-chip">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6L9 17l-5-5" /></svg>
              Checked live on Arc 5042
            </span>
          </div>
        </header>

        <form
          className="rc-panel"
          onSubmit={handleSubmit(onSubmit)}
          noValidate
          aria-label="Receipt verification form"
        >
          <div className="rc-field">
            <label htmlFor="rc-receipt-json">Receipt JSON</label>
            <p className="rc-hint">
              The canonical receipt, or the full API view with receiptHash and
              timeline — both work.
            </p>
            <textarea
              id="rc-receipt-json"
              className="rc-textarea"
              rows={10}
              spellCheck={false}
              placeholder='{"specVersion":"raincheck-receipt/v1","paymentId":"0x…",…}'
              {...register("receiptJson")}
            />
            {errors.receiptJson && (
              <p className="rc-field-error" role="alert">
                {errors.receiptJson.message}
              </p>
            )}
          </div>

          <div className="rc-field">
            <label htmlFor="rc-tx-hash">Anchor transaction</label>
            <p className="rc-hint">
              Optional — leave empty to use the first anchor listed in the
              receipt (eip155:5042:0x…).
            </p>
            <input
              id="rc-tx-hash"
              className="rc-input rc-mono"
              spellCheck={false}
              placeholder="0x…"
              {...register("txHash")}
            />
            {errors.txHash && (
              <p className="rc-field-error" role="alert">
                {errors.txHash.message}
              </p>
            )}
          </div>

          <div className="rc-actions">
            <button
              type="submit"
              className="rc-primary"
              disabled={busy}
              aria-busy={busy && phase.kind === "verifying"}
            >
              {phase.kind === "verifying" ? (
                <>
                  <span className="rc-spinner" aria-hidden="true" />
                  Checking on-chain…
                </>
              ) : (
                "Verify receipt"
              )}
            </button>
            <button
              type="button"
              className="rc-ghost"
              disabled={busy}
              onClick={loadLive}
            >
              {phase.kind === "loading-live" ? (
                <>
                  <span className="rc-spinner" aria-hidden="true" />
                  Loading…
                </>
              ) : (
                "Try with the newest live receipt"
              )}
            </button>
            <span
              className="rc-verify-proto"
              role="radiogroup"
              aria-label="Live receipt source"
            >
              <button
                type="button"
                role="radio"
                aria-checked={liveProto === "V1"}
                className={liveProto === "V1" ? "is-on" : ""}
                disabled={busy}
                onClick={() => setLiveProto("V1")}
              >
                V1
              </button>
              <button
                type="button"
                role="radio"
                aria-checked={liveProto === "V2"}
                className={liveProto === "V2" ? "is-on" : ""}
                disabled={busy}
                onClick={() => setLiveProto("V2")}
              >
                V2 <span className="rc-v2-badge">experimental</span>
              </button>
            </span>
          </div>
          {liveProto === "V2" && (
            <p className="rc-muted" style={{ marginTop: 10 }}>
              V2 receipts are loaded straight from chain (the indexer
              doesn&apos;t track the experimental tier). The V2 escrow is
              unaudited.
            </p>
          )}

          {phase.kind === "fatal" && (
            <p className="rc-fatal" role="alert">
              {phase.message}
            </p>
          )}
        </form>

        {/* Result area: skeletons while the RPC read is in flight — never blank,
            never invented rows. */}
        {phase.kind === "verifying" && (
          <section className="rc-panel" aria-label="Verification in progress">
            <div className="rc-skel rc-skel-banner" />
            <div className="rc-skel rc-skel-line" style={{ width: "70%" }} />
            <div className="rc-skel rc-skel-line" style={{ width: "55%" }} />
            <div className="rc-skel rc-skel-line" style={{ width: "62%" }} />
            <p className="rc-muted">Reading the anchor transaction from Arc…</p>
          </section>
        )}

        {report && (
          <section className="rc-panel" aria-live="polite">
            <div
              className={`rc-verdict ${report.verdict === "MATCH" ? "is-match" : "is-mismatch"}`}
            >
              {report.verdict === "MATCH" ? (
                <svg className="rc-verdict-seal" viewBox="0 0 64 64" fill="none" aria-hidden="true">
                  <circle cx="32" cy="32" r="29" stroke="#35E0FF" strokeWidth="3.5" />
                  <path d="M21 33l8 8 14-17" stroke="#35E0FF" strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              ) : (
                <svg className="rc-verdict-seal" viewBox="0 0 64 64" fill="none" aria-hidden="true">
                  <circle cx="32" cy="32" r="29" stroke="#F87171" strokeWidth="3.5" />
                  <path d="M24 24l16 16M40 24L24 40" stroke="#F87171" strokeWidth="5" strokeLinecap="round" />
                </svg>
              )}
              <div>
                <div className="rc-verdict-word">{report.verdict}</div>
                <p className="rc-verdict-line">
                  {report.verdict === "MATCH"
                    ? "The receipt you pasted is exactly what the chain anchored — every check passed."
                    : "Something doesn't line up. Read the failing check below to see what."}
                </p>
              </div>
            </div>

            <h2 className="rc-section-title">What was checked</h2>
            <ul className="rc-checks">
              {report.checks.map((c: VerifyCheck) => (
                <CheckRow key={c.label} check={c} />
              ))}
            </ul>

            <h2 className="rc-section-title">Values</h2>
            <dl className="rc-values">
              <div className="rc-value-row">
                <dt>Recomputed fingerprint</dt>
                <dd>
                  <Copyable value={report.receiptHash} short={`${report.receiptHash.slice(0, 20)}…`} />
                  <span className="rc-muted">
                    {" "}SHA-256 of the canonical receipt ({report.canonicalBytes} bytes)
                  </span>
                </dd>
              </div>
              {report.claimedHash && (
                <div className="rc-value-row">
                  <dt>Fingerprint the receipt came with</dt>
                  <dd>
                    <Copyable value={report.claimedHash} short={`${report.claimedHash.slice(0, 20)}…`} />
                  </dd>
                </div>
              )}
              {report.token && (
                <div className="rc-value-row">
                  <dt>Payment token</dt>
                  <dd>
                    <code className="rc-code">{report.token}</code>
                    <span className="rc-muted">
                      {" "}— from the pasted API view (the canonical receipt itself is token-blind by design)
                    </span>
                  </dd>
                </div>
              )}
              <div className="rc-value-row">
                <dt>Anchor transaction</dt>
                <dd>
                  <Copyable value={report.txHash} short={`${report.txHash.slice(0, 14)}…${report.txHash.slice(-8)}`} />{" "}
                  <a
                    className="rc-link"
                    href={txUrl(report.txHash)}
                    target="_blank"
                    rel="noreferrer"
                  >
                    View on explorer
                  </a>
                </dd>
              </div>
              {report.memo && (
                <>
                  <div className="rc-value-row">
                    <dt>Memo anchor</dt>
                    <dd>
                      memoIndex{" "}
                      <code className="rc-code">{String(report.memo.memoIndex ?? "unknown")}</code>
                      {report.memo.memoId && (
                        <>
                          {" "}· memoId{" "}
                          <Copyable value={report.memo.memoId} short={`${report.memo.memoId.slice(0, 14)}…`} />
                        </>
                      )}
                      {report.memo.memoAscii && (
                        <div className="rc-muted">
                          note: <code className="rc-code">{report.memo.memoAscii}</code>
                        </div>
                      )}
                    </dd>
                  </div>
                  <div className="rc-value-row">
                    <dt>Calldata binding</dt>
                    <dd>
                      <Copyable
                        value={report.memo.loggedCallDataHash ?? "none"}
                        short={report.memo.loggedCallDataHash ? `${report.memo.loggedCallDataHash.slice(0, 14)}…` : "none"}
                      />
                      <span className="rc-muted"> — anchored vs recomputed from the transaction input</span>
                    </dd>
                  </div>
                  {report.memo.innerEvents.length > 0 && (
                    <div className="rc-value-row">
                      <dt>Anchored events</dt>
                      <dd>
                        {report.memo.innerEvents.map((e: InnerEvent) => (
                          <div key={`${e.name}-${e.logIndex}`} className="rc-muted">
                            <code className="rc-code">{e.name}</code>
                            {e.paymentId && (
                              <> payment <code className="rc-code">{e.paymentId.slice(0, 14)}…</code></>
                            )}
                          </div>
                        ))}
                      </dd>
                    </div>
                  )}
                </>
              )}
            </dl>

            <p className="rc-fineprint">
              *Checked live against Arc mainnet at verification time. The fingerprint
              never leaves your browser — only the transaction hash is looked up.
            </p>
          </section>
        )}
      </div>
    </AppShell>
  );
}
