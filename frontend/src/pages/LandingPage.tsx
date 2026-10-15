import { Link } from "react-router-dom";
import Hero from "../components/landing/Hero";
import {
  LiveStats,
  HowItWorks,
  TrustDisclosure,
  ProtocolSection,
  OracleTeaser,
  FirstScreenTrust,
  Footer,
} from "../components/landing";
import "./LandingPage.css";

/**
 * RAINCHECK landing page — premium editorial composition.
 * One continuous vertical scroll. Hero: /hero-v2.png art bled full-bleed
 * behind the section with type over the art's empty left third, then
 * eyebrow → headline → parenthetical → subline → token strip → CTA row →
 * marquee ticker. The live-stats band is the sibling <LiveStats/> section
 * mounted directly after the hero: real on-chain values only; the section
 * hides itself when the API is unreachable — never faked.
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
        {/* Bible rule: "What you have to trust" on the FIRST screen. */}
        <FirstScreenTrust />
        <LiveStats />
        <div id="how">
          <HowItWorks />
        </div>
        <TrustDisclosure />
        <ProtocolSection />
        <OracleTeaser />
      </main>

      <Footer />
    </div>
  );
}
