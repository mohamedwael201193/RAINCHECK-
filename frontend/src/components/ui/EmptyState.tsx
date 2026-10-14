import { Link } from "react-router-dom";

type Props = {
  /** ONE explanatory line (law §6: no paragraphs). */
  line: string;
  /** Optional single CTA (law §6: one action button, or none). */
  actionLabel?: string;
  actionTo?: string;
  onAction?: () => void;
  dark?: boolean;
};

/**
 * EmptyState — the ONE shared empty-state wrapper (design law §6).
 * Formula: mark + ONE explanatory line + ONE action button (or none).
 * Use everywhere a list can be empty. Never a paragraph, never a button grid.
 */
export default function EmptyState({
  line,
  actionLabel,
  actionTo,
  onAction,
  dark = false,
}: Props) {
  return (
    <div
      className={`flex flex-col items-center rounded-xl border px-6 py-14 text-center ${
        dark ? "border-ice/15 bg-ink text-ice" : "border-ink/15 bg-paper text-ink"
      }`}
    >
      <svg
        width="44"
        height="44"
        viewBox="0 0 44 44"
        fill="none"
        aria-hidden="true"
        className="mb-5"
      >
        <rect
          x="10"
          y="5"
          width="24"
          height="34"
          rx="2"
          stroke="#35E0FF"
          strokeWidth="2.5"
        />
        <line x1="16" y1="14" x2="28" y2="14" stroke="currentColor" strokeWidth="2.5" opacity="0.5" />
        <line x1="16" y1="21" x2="28" y2="21" stroke="currentColor" strokeWidth="2.5" opacity="0.5" />
        <line x1="16" y1="28" x2="24" y2="28" stroke="currentColor" strokeWidth="2.5" opacity="0.5" />
      </svg>
      <p className="mb-6 max-w-sm text-base leading-relaxed opacity-80">{line}</p>
      {actionLabel && (actionTo || onAction) && (
        actionTo ? (
          <Link to={actionTo} className={dark ? "rc-btn-outline-ice" : "rc-btn-primary"}>
            {actionLabel}
          </Link>
        ) : (
          <button type="button" onClick={onAction} className={dark ? "rc-btn-outline-ice" : "rc-btn-primary"}>
            {actionLabel}
          </button>
        )
      )}
    </div>
  );
}
