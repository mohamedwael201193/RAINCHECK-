import type { ReactNode } from "react";

type Variant = "primary" | "ink" | "outline" | "outline-ice";

type Props = {
  children: ReactNode;
  onClick?: () => void;
  type?: "button" | "submit";
  variant?: Variant;
  /** When set, the button is disabled AND the reason + next action render beside it. */
  disabledReason?: string | null;
  /** The exact next action the user should take to unlock the button. */
  nextAction?: string | null;
  loading?: boolean;
  loadingLabel?: string;
  className?: string;
};

const VARIANT_CLASS: Record<Variant, string> = {
  primary: "rc-btn-primary",
  ink: "rc-btn-ink",
  outline: "rc-btn-outline",
  "outline-ice": "rc-btn-outline-ice",
};

/**
 * ActionButton — the honest button (bible §8.2, design law §7 rule 6).
 * An enabled button always executes. A disabled button ALWAYS renders its
 * reason plus the exact next action beside it — never a grey button with
 * no explanation. During an action, the spinner lives INSIDE the button
 * (law §6: spinner only inside the clicked button).
 */
export default function ActionButton({
  children,
  onClick,
  type = "button",
  variant = "primary",
  disabledReason = null,
  nextAction = null,
  loading = false,
  loadingLabel = "Working…",
  className = "",
}: Props) {
  const disabled = loading || disabledReason !== null;
  return (
    <span className={`inline-flex flex-wrap items-center gap-3 ${className}`}>
      <button
        type={type}
        onClick={onClick}
        disabled={disabled}
        aria-disabled={disabled}
        className={VARIANT_CLASS[variant]}
      >
        {loading && (
          <span
            aria-hidden="true"
            className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent"
          />
        )}
        {loading ? loadingLabel : children}
      </button>
      {!loading && disabledReason && (
        <span className="max-w-xs text-sm leading-snug text-ink/70">
          {disabledReason}
          {nextAction && (
            <>
              {" "}
              <strong className="font-semibold text-ink">{nextAction}</strong>
            </>
          )}
        </span>
      )}
    </span>
  );
}
