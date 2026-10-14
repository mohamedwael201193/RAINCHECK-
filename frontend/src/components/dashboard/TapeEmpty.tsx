import { Link } from "react-router-dom";
import { BackgroundBeams } from "../vendor/aceternity/BackgroundBeams";
import "./TapeEmpty.css";

/**
 * TapeEmpty — the relay-style honest empty state.
 *
 * Dashed-line SVG illustration (a tape strip / receipt outline, drawn not
 * filled) + headline + ONE plain explanation of what will appear here +
 * ONE optional action. Never a paragraph, never a button grid, never fake
 * preview rows.
 */
export default function TapeEmpty({
  headline,
  sub,
  actionLabel,
  actionTo,
  onAction,
}: {
  headline: string;
  sub: string;
  actionLabel?: string;
  actionTo?: string;
  onAction?: () => void;
}) {
  return (
    <div className="rce" role="status">
      {/* Aceternity beam field, monochrome cyan, behind the illustration. */}
      <BackgroundBeams beamCount={10} opacity={0.32} />
      <svg
        className="rce-art"
        viewBox="0 0 120 84"
        fill="none"
        aria-hidden="true"
      >
        {/* tape strip: dashed rounded frame, the relay motif */}
        <rect
          x="8"
          y="10"
          width="104"
          height="64"
          rx="8"
          stroke="#35E0FF"
          strokeWidth="2"
          strokeDasharray="7 6"
          opacity="0.85"
        />
        {/* receipt glyph inside, also dashed — nothing filled in */}
        <path
          d="M46 26h28v32l-4.7-3.1-4.6 3.1-4.7-3.1-4.7 3.1-4.6-3.1-4.7 3.1V26z"
          stroke="#F4FEFF"
          strokeWidth="2"
          strokeDasharray="5 4"
          strokeLinejoin="round"
          opacity="0.7"
        />
        <path
          d="M52 38l4 4 8-9"
          stroke="#35E0FF"
          strokeWidth="2"
          strokeDasharray="4 3"
          strokeLinecap="round"
          strokeLinejoin="round"
          opacity="0.9"
        />
        {/* perforation ticks top + bottom */}
        <line x1="20" y1="4" x2="100" y2="4" stroke="#F4FEFF" strokeWidth="1.5" strokeDasharray="3 5" opacity="0.35" />
        <line x1="20" y1="80" x2="100" y2="80" stroke="#F4FEFF" strokeWidth="1.5" strokeDasharray="3 5" opacity="0.35" />
      </svg>
      <p className="rce-headline">{headline}</p>
      <p className="rce-sub">{sub}</p>
      {actionLabel && (actionTo || onAction) && (
        <div className="rce-action">
          {actionTo ? (
            <Link to={actionTo} className="rcx-btn rcx-btn-primary">
              {actionLabel}
            </Link>
          ) : (
            <button
              type="button"
              className="rcx-btn rcx-btn-primary"
              onClick={onAction}
            >
              {actionLabel}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
