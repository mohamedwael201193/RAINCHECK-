import { Link } from "react-router-dom";
import Hero from "../components/landing/Hero";
import {
  LiveStats,
  HowItWorks,
  TrustDisclosure,
  Footer,
} from "../components/landing";
import "./LandingPage.css";

/**
 * RAINCHECK landing page — DESIGN STANDARD (Phase A).
 * One continuous vertical scroll (§2). Hero order per §3:
 *   brand mark → ambient visual → marquee → headline → CTA row → live-stats row.
 * The live-stats row is the sibling <LiveStats/> band mounted directly after
 * the hero: real on-chain values only; the section hides itself when the API
 * is unreachable — never faked (§3, §10).
 *
 * Lazy-loaded by src/App.tsx via React.lazy (keep this module side-effect free
 * apart from the CSS import).
 */
export default function LandingPage() {
  return (
    <div className="rc-landing">
      {/* §3: minimal fixed nav — logo left, 2 links, one ghost CTA.
          The single primary CTA per screen lives in the hero (§6). */}
      <header className="rc-nav">
        <Link to="/" className="rc-wordmark" aria-label="RAINCHECK home">
          <span className="rc-mark-dot" aria-hidden="true" />
          Raincheck
        </Link>
        <nav className="rc-nav-links" aria-label="Landing">
          <a href="#how" className="rc-nav-link">
            How it works
          </a>
          <Link to="/verify" className="rc-nav-link">
            Verify
          </Link>
          <Link to="/dashboard/new" className="rc-nav-cta">
            Open a receipt
          </Link>
        </nav>
      </header>

      <main className="rc-sections">
        <Hero />
        <LiveStats />
        <div id="how">
          <HowItWorks />
        </div>
        <TrustDisclosure />
      </main>

      <Footer />
    </div>
  );
}
