import { STATUS_MEANING, type ReceiptStatus } from "../../lib/receipts";
import "./Lifecycle.css";

/**
 * Lifecycle — the escrow state machine, made visible.
 *
 * OPEN → ATTESTED → CAPTURED
 * ATTESTED → FLAGGED → VOIDED
 * OPEN → VOIDED (on deadline)
 *
 * StatusBadge: the state pill (color + plain-meaning tooltip).
 * LifecycleSteps: the authorize → attest → capture/void stepper for detail
 *   views, with the current position marked.
 * LifecycleDots: the 3-dot position marker for cards.
 */

type StepState = "done" | "current" | "todo" | "skipped";

export interface FlowStep {
  key: string;
  label: string;
  caption: string;
  state: StepState;
}

/** Pure: position of a receipt in the flow. Unit-tested. */
export function lifecycleSteps(status: string): FlowStep[] {
  const s = String(status).toUpperCase();
  const authorize: FlowStep = {
    key: "authorize",
    label: "Authorize",
    caption: "buyer locks funds on-chain",
    state: "done",
  };
  const attest: FlowStep = {
    key: "attest",
    label: "Attest",
    caption: "seller signs delivery",
    state: "todo",
  };
  const capture: FlowStep = {
    key: "capture",
    label: "Capture",
    caption: "seller gets paid",
    state: "todo",
  };
  const voidStep: FlowStep = {
    key: "void",
    label: "Void",
    caption: "buyer refunded on-chain",
    state: "todo",
  };

  switch (s) {
    case "OPEN":
      attest.state = "current";
      break;
    case "ATTESTED":
      attest.state = "done";
      capture.state = "current";
      voidStep.state = "current";
      break;
    case "FLAGGED":
      attest.state = "done";
      capture.state = "skipped";
      voidStep.state = "current";
      break;
    case "CAPTURED":
      attest.state = "done";
      capture.state = "done";
      voidStep.state = "skipped";
      break;
    case "VOIDED":
      attest.state = "skipped";
      capture.state = "skipped";
      voidStep.state = "done";
      break;
    default:
      break;
  }
  return [authorize, attest, capture, voidStep];
}

const PILL_CLASS: Record<string, string> = {
  OPEN: "rcx-pill rcx-pill-open",
  ATTESTED: "rcx-pill rcx-pill-attested",
  FLAGGED: "rcx-pill rcx-pill-flagged",
  CAPTURED: "rcx-pill rcx-pill-captured",
  VOIDED: "rcx-pill rcx-pill-voided",
};

export function StatusBadge({ status }: { status: string }) {
  const key = String(status).toUpperCase();
  const cls = PILL_CLASS[key] ?? "rcx-pill rcx-pill-unknown";
  const meaning =
    STATUS_MEANING[key as ReceiptStatus] ?? "state reported by the indexer";
  return (
    <span className={cls} title={`${key} — ${meaning}`}>
      {key}
    </span>
  );
}

function StepDot({ step }: { step: FlowStep }) {
  return (
    <span
      className={`rcl-dot is-${step.state}`}
      title={`${step.label}: ${step.caption}`}
      aria-hidden="true"
    />
  );
}

/** Full stepper: authorize → attest → capture / void. */
export function LifecycleSteps({ status }: { status: string }) {
  const steps = lifecycleSteps(status);
  const [authorize, attest, capture, voidStep] = steps;
  return (
    <ol className="rcl-steps" aria-label="Receipt lifecycle">
      {[authorize, attest].map((step, i) => (
        <li key={step.key} className={`rcl-step is-${step.state}`}>
          <StepDot step={step} />
          <div className="rcl-step-text">
            <span className="rcl-step-label">{step.label}</span>
            <span className="rcl-step-caption">{step.caption}</span>
          </div>
          {i === 0 && <span className="rcl-link" aria-hidden="true" />}
        </li>
      ))}
      <li className="rcl-branch" aria-label="Settlement: capture or void">
        <span className="rcl-link" aria-hidden="true" />
        <div className="rcl-branch-options">
          {[capture, voidStep].map((step) => (
            <div key={step.key} className={`rcl-step is-${step.state}`}>
              <StepDot step={step} />
              <div className="rcl-step-text">
                <span className="rcl-step-label">{step.label}</span>
                <span className="rcl-step-caption">{step.caption}</span>
              </div>
            </div>
          ))}
        </div>
      </li>
    </ol>
  );
}

/** Compact 3-dot position marker for cards: authorize · attest · settle. */
export function LifecycleDots({ status }: { status: string }) {
  const steps = lifecycleSteps(status);
  // Collapse capture+void into one "settle" dot: done if either is done,
  // current if either is current, skipped only if both skipped.
  const settle: StepState =
    steps[2].state === "done" || steps[3].state === "done"
      ? "done"
      : steps[2].state === "current" || steps[3].state === "current"
        ? "current"
        : steps[2].state === "skipped" && steps[3].state === "skipped"
          ? "skipped"
          : "todo";
  const dots: FlowStep[] = [steps[0], steps[1], { ...steps[2], key: "settle", label: "Settle", state: settle }];
  return (
    <span
      className="rcl-dots"
      role="img"
      aria-label={`Lifecycle position: ${String(status).toLowerCase()} — authorize, attest, settle`}
      title="Position in the authorize → attest → capture/void flow"
    >
      {dots.map((d, i) => (
        <span key={d.key} className="rcl-dots-item">
          <StepDot step={d} />
          {i < dots.length - 1 && (
            <span className="rcl-dots-link" aria-hidden="true" />
          )}
        </span>
      ))}
    </span>
  );
}
