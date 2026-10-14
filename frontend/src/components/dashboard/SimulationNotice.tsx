import { SIMULATION_LABEL, type SimulationOutcome } from "../../lib/simulate";

export type SimPhase = "idle" | "checking" | "passed" | "blocked" | "unavailable";

/**
 * SimulationNotice — the pre-send check status shown next to every action
 * sign button.
 *
 * - checking: the eth_call is in flight; the sign button stays disabled.
 * - passed: chain should accept it; button enabled.
 * - blocked: the call REVERTED — reason in user words, sign button DISABLED
 *   so the user can't burn gas on a doomed tx. Technical detail rides in a
 *   collapsible <details>, never as headline copy (design-standard §7.8).
 * - unavailable: our RPC was unreachable — advisory only, signing stays
 *   enabled, and the copy says exactly that.
 *
 * The honest label is always visible: this previews the escrow step only;
 * the memo wrapper is applied at signing.
 */
export default function SimulationNotice({
  phase,
  outcome,
  onRerun,
}: {
  phase: SimPhase;
  outcome?: SimulationOutcome;
  onRerun: () => void;
}) {
  if (phase === "idle") return null;

  if (phase === "checking") {
    return (
      <p className="rc-sim rc-sim-checking" role="status">
        <span className="rc-btn-spinner" aria-hidden="true" /> Running the
        pre-send check… <span className="rc-muted">{SIMULATION_LABEL}</span>
      </p>
    );
  }

  if (phase === "passed") {
    return (
      <p className="rc-sim rc-sim-passed" role="status">
        ✓ Pre-send check passed — the chain should accept this transaction.{" "}
        <span className="rc-muted">{SIMULATION_LABEL}</span>
      </p>
    );
  }

  if (phase === "blocked" && outcome && !outcome.ok) {
    return (
      <div className="rc-sim rc-sim-blocked" role="alert">
        <p className="rc-sim-title">Pre-send check failed — signing is disabled.</p>
        <p className="rc-sim-msg">{outcome.userMessage}</p>
        <p className="rc-muted">
          The chain would reject this transaction, so the sign button stays
          off — signing it would burn gas for nothing.{" "}
          {SIMULATION_LABEL}
        </p>
        <details className="rc-details">
          <summary>Technical details</summary>
          <p className="rc-muted">
            <code>{outcome.technical}</code>
          </p>
        </details>
        <button className="rc-btn rc-btn-ghost" onClick={onRerun} type="button">
          Re-run the check
        </button>
      </div>
    );
  }

  // unavailable — advisory, signing stays enabled.
  return (
    <div className="rc-sim rc-sim-unavailable" role="note">
      <p className="rc-sim-title">Pre-send check couldn&apos;t run.</p>
      <p className="rc-sim-msg">
        {outcome && !outcome.ok ? outcome.userMessage : "The check couldn't reach the network."}
      </p>
      <details className="rc-details">
        <summary>Technical details</summary>
        <p className="rc-muted">
          <code>
            {outcome && !outcome.ok ? outcome.technical : "no detail"}
          </code>
        </p>
      </details>
      <button className="rc-btn rc-btn-ghost" onClick={onRerun} type="button">
        Try the check again
      </button>
    </div>
  );
}
