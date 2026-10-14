import { useState } from "react";
import { Link } from "react-router-dom";
import "./Hero.css";

/**
 * RAINCHECK hero — DESIGN STANDARD (Phase A) compliant.
 * Order (§3): brand mark → ambient visual → full-bleed marquee ticker →
 *   giant stacked all-caps headline → ONE CTA row (1 primary + 1 ghost) → live-stats row.
 * Live-stats row is rendered by the sibling <LiveStats/> band mounted directly
 * after this hero in LandingPage (real on-chain values only; omitted when the
 * API is unreachable — never faked).
 *
 * Tokens (§9): bg #0B1220 · accent #35E0FF · paper #F4EFE6 · text-on-dark #F4FEFF.
 * No serif anywhere. Accent touches exactly ONE hero word.
 * Animation (§5): word-reveal ≤0.8s · marquee + ONE ambient loop · reduced-motion respected.
 */
const WORDS: { text: string; accent?: boolean }[] = [
  { text: "DELIVERY," },
  { text: "ATTESTED.", accent: true },
];

export default function Hero() {
  const [imgOk, setImgOk] = useState(true);

  return (
    <section className="rc-hero" aria-label="RAINCHECK — delivery, attested">
      {/* 1 — brand mark */}
      <div className="rc-brandmark rc-anim" style={{ animationDelay: "0.05s" }}>
        <img
          src="/logo.webp"
          alt="RAINCHECK"
          className="rc-brandmark-img"
          width={148}
          height={34}
        />
      </div>

      {/* 2 — ambient visual (melts into #0B1220; edge pixels = section bg) */}
      <figure className="rc-ambient rc-anim" style={{ animationDelay: "0.15s" }}>
        {/* CSS fallback: line-art attestation mark on #0B1220. Sits behind the
            brand image; shows only if /hero.png is missing or fails to load. */}
        <div className="rc-melt-fallback" aria-hidden={imgOk}>
          <svg
            viewBox="0 0 320 200"
            width="320"
            height="200"
            role="img"
            aria-label="Attestation mark"
          >
            <circle
              cx="160"
              cy="86"
              r="52"
              fill="none"
              stroke="#35e0ff"
              strokeOpacity="0.55"
              strokeWidth="2"
              strokeDasharray="7 8"
            />
            <path
              d="M138 88l16 16 30-34"
              fill="none"
              stroke="#35e0ff"
              strokeOpacity="0.9"
              strokeWidth="5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            <line x1="96" y1="162" x2="224" y2="162" stroke="#f4feff" strokeOpacity="0.28" strokeWidth="2" strokeDasharray="4 7" />
            <line x1="116" y1="178" x2="204" y2="178" stroke="#f4feff" strokeOpacity="0.18" strokeWidth="2" strokeDasharray="4 7" />
            <text
              x="160"
              y="34"
              textAnchor="middle"
              fill="#f4feff"
              fillOpacity="0.5"
              fontSize="11"
              letterSpacing="6"
              fontFamily="inherit"
            >
              ATTESTED
            </text>
          </svg>
        </div>

        {imgOk && (
          <img
            src="/hero.png"
            alt=""
            aria-hidden="true"
            className="rc-hero-img rc-ambient-float"
            onError={() => setImgOk(false)}
          />
        )}
      </figure>

      {/* 3 — signature marquee ticker */}
      <div className="rc-marquee" aria-hidden="true">
        <div className="rc-marquee-track">
          {[0, 1, 2, 3].map((i) => (
            <span key={i} className="rc-marquee-chunk">
              Delivery, attested.<b>·</b>Receipts, on-chain.<b>·</b>
            </span>
          ))}
        </div>
      </div>

      {/* 4 — headline + subline + CTA row */}
      <div className="rc-hero-inner">
        <h1 className="rc-title" aria-label="Delivery, attested.">
          {WORDS.map((w, i) => (
            <span key={w.text} className="rc-line" aria-hidden="true">
              <span
                className={w.accent ? "rc-word rc-word-accent" : "rc-word"}
                style={{ animationDelay: `${0.1 + i * 0.16}s` }}
              >
                {w.text}
              </span>
            </span>
          ))}
        </h1>

        <p className="rc-sub rc-anim" style={{ animationDelay: "0.6s" }}>
          Delivery-attested receipts for agent commerce — proven on-chain, or
          your money back.
        </p>

        <div className="rc-ctas rc-anim" style={{ animationDelay: "0.72s" }}>
          <Link to="/verify" className="rc-btn rc-btn-primary">
            <span className="rc-sheen" aria-hidden="true" />
            <span className="rc-btn-label">See a live receipt</span>
            <span className="rc-arrow" aria-hidden="true">
              →
            </span>
          </Link>
          <Link to="/dashboard/new" className="rc-btn rc-btn-ghost">
            Open a receipt
          </Link>
        </div>
      </div>
    </section>
  );
}
