import { useState } from "react";
import { Link } from "react-router-dom";
import TokenIcon from "../TokenIcon";
import "./Hero.css";

/**
 * RAINCHECK hero — premium editorial composition.
 *
 * The hero art (/hero-v2.png, edge-melted to #0B1220) bleeds FULL-BLEED
 * behind the whole hero; the type sits over the art's empty left third.
 * No bordered container around the image — there is no box.
 *
 * Type scale: display max 6rem / body 1rem = 6x ratio (founder cap 6–10x).
 * Tokens: bg #0B1220 · accent #35E0FF · paper #F4EFE6 · text-on-dark #F4FEFF.
 * No serif anywhere. Accent touches exactly ONE hero word.
 * Animation: word-reveal ≤0.8s · marquee + one ambient float loop · reduced-motion respected.
 */
const WORDS: { text: string; accent?: boolean }[] = [
  { text: "DELIVERY," },
  { text: "ATTESTED.", accent: true },
];

export default function Hero() {
  const [imgOk, setImgOk] = useState(true);

  return (
    <section className="rc-hero" aria-label="RAINCHECK — delivery, attested">
      {/* ambient visual: full-bleed, melts into #0B1220 (edge pixels = bg) */}
      <div className="rc-hero-art" aria-hidden="true">
        {imgOk ? (
          <img
            src="/hero-v2.png"
            alt=""
            className="rc-hero-img rc-ambient-float"
            onError={() => setImgOk(false)}
            /* React 18 has no fetchPriority in its DOM whitelist (React 19
               added it); the lowercase attribute passes through cleanly with
               zero console warnings. Set imperatively so tsc stays happy. */
            ref={(el) => {
              if (el) el.setAttribute("fetchpriority", "high");
            }}
          />
        ) : (
          /* CSS fallback: line-art attestation mark on #0B1220. Shows only
             if /hero-v2.png is missing or fails to load. */
          <div className="rc-melt-fallback">
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
        )}
        {/* legibility scrim: deepens the art's empty left third under the type */}
        <div className="rc-hero-scrim" />
      </div>

      {/* type over the empty left third */}
      <div className="rc-hero-inner">
        <p className="rc-hero-eyebrow rc-anim" style={{ animationDelay: "0.05s" }}>
          On-chain escrow · Arc mainnet
        </p>

        <h1 className="rc-title" aria-label="Delivery, attested.">
          {WORDS.map((w, i) => (
            <span key={w.text} className="rc-line" aria-hidden="true">
              <span
                className={w.accent ? "rc-word rc-word-accent" : "rc-word"}
                style={{ animationDelay: `${0.12 + i * 0.16}s` }}
              >
                {w.text}
              </span>
            </span>
          ))}
        </h1>

        <p className="rc-hero-parenthetical rc-anim" style={{ animationDelay: "0.5s" }}>
          <em>( receipts that decide who keeps the money )</em>
        </p>

        <p className="rc-sub rc-anim" style={{ animationDelay: "0.6s" }}>
          Delivery-attested receipts for agent commerce — proven on-chain, or
          your money back.
        </p>

        <div
          className="rc-hero-tokens rc-anim"
          style={{ animationDelay: "0.68s" }}
          aria-label="Escrows settle in USDC and EURC"
        >
          <span className="rc-hero-tokens-label">Settles in</span>
          <span className="rc-token-chip">
            <TokenIcon token="USDC" size={22} />
            USDC
          </span>
          <span className="rc-token-chip">
            <TokenIcon token="EURC" size={22} />
            EURC
          </span>
        </div>

        <div className="rc-ctas rc-anim" style={{ animationDelay: "0.76s" }}>
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

      {/* signature marquee ticker */}
      <div className="rc-marquee" aria-hidden="true">
        <div className="rc-marquee-track">
          {[0, 1, 2, 3].map((i) => (
            <span key={i} className="rc-marquee-chunk">
              Delivery, attested.<b>·</b>Receipts, on-chain.<b>·</b>
            </span>
          ))}
        </div>
      </div>
    </section>
  );
}
