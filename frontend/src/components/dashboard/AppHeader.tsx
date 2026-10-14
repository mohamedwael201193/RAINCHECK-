import { Link, NavLink } from "react-router-dom";
import "../../styles/app.css";

/**
 * AppHeader — the slim top bar shared by every RAINCHECK app screen
 * (dashboard, new receipt, detail, activity, verify). Landing owns its
 * own chrome; this is the calm in-app navigation: wordmark, the three
 * app destinations, one primary CTA. Sticky, no dead ends.
 */

function ReceiptMark() {
  return (
    <span className="rcx-brand-mark" aria-hidden="true">
      <svg width="17" height="17" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path
          d="M6 3h12v18l-2.5-1.7L13 21l-2.5-1.7L8 21l-2-1.3V3z"
          fill="#0B1220"
        />
        <path
          d="M9 8.5l2 2 4-4.5"
          stroke="#35E0FF"
          strokeWidth="2.2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </span>
  );
}

const LINKS = [
  { to: "/dashboard", label: "Receipts", end: true },
  { to: "/dashboard/activity", label: "Activity", end: false },
  { to: "/verify", label: "Verify", end: false },
];

export default function AppHeader() {
  return (
    <header className="rcx-appbar">
      <div className="rcx-appbar-in">
        <Link to="/" className="rcx-brand" aria-label="RAINCHECK home">
          <ReceiptMark />
          RAINCHECK
        </Link>
        <nav className="rcx-nav" aria-label="App">
          {LINKS.map((l) => (
            <NavLink
              key={l.to}
              to={l.to}
              end={l.end}
              className={({ isActive }) =>
                `rcx-navlink${isActive ? " is-active" : ""}`
              }
            >
              {l.label}
            </NavLink>
          ))}
        </nav>
        <Link to="/dashboard/new" className="rcx-appbar-cta">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" aria-hidden="true">
            <path d="M12 5v14M5 12h14" />
          </svg>
          <span>Open receipt</span>
        </Link>
      </div>
    </header>
  );
}
