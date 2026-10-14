import TokenIcon from "../TokenIcon";
import Reveal from "./Reveal";
import "./HowItWorks.css";

const INK = "#0B1220";
const ACCENT = "#35E0FF";

/**
 * Bespoke line-art iconography for the receipt/attestation theme.
 * Single stroke, ink on paper — no stock, no emoji.
 */
function LockIcon() {
  return (
    <svg viewBox="0 0 48 48" width="44" height="44" fill="none" role="img" aria-label="Lock">
      <rect x="12" y="21" width="24" height="17" rx="3" stroke={INK} strokeWidth="2.4" />
      <path d="M16 21v-5a8 8 0 0 1 16 0v5" stroke={INK} strokeWidth="2.4" strokeLinecap="round" />
      <circle cx="24" cy="29.5" r="2.6" fill={INK} />
      <line x1="24" y1="32.1" x2="24" y2="34.6" stroke={INK} strokeWidth="2.2" strokeLinecap="round" />
    </svg>
  );
}

function SealIcon() {
  return (
    <svg viewBox="0 0 48 48" width="44" height="44" fill="none" role="img" aria-label="Attestation seal">
      <circle cx="24" cy="24" r="15" stroke={INK} strokeWidth="2.4" />
      <circle cx="24" cy="24" r="19.5" stroke={ACCENT} strokeWidth="1.6" strokeDasharray="5 6" />
      <path d="M17.5 24.5l4.8 4.8 8.6-10" stroke={INK} strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function FlagIcon() {
  return (
    <svg viewBox="0 0 48 48" width="44" height="44" fill="none" role="img" aria-label="Challenge flag">
      <line x1="13" y1="7" x2="13" y2="41" stroke={INK} strokeWidth="2.4" strokeLinecap="round" />
      <path d="M13 9h20l-4.5 6.5L33 22H13" stroke={INK} strokeWidth="2.4" strokeLinejoin="round" />
      <line x1="8" y1="41" x2="18" y2="41" stroke={INK} strokeWidth="2.4" strokeLinecap="round" />
    </svg>
  );
}

function ForkIcon() {
  return (
    <svg viewBox="0 0 48 48" width="44" height="44" fill="none" role="img" aria-label="Capture or void">
      <path d="M24 6v12" stroke={INK} strokeWidth="2.4" strokeLinecap="round" />
      <path d="M24 18C24 26 14 24 10 34" stroke={INK} strokeWidth="2.4" strokeLinecap="round" />
      <path d="M24 18c0 8 10 6 14 16" stroke={INK} strokeWidth="2.4" strokeLinecap="round" />
      <path d="M6.5 30.5L10 34l3.5-3.5" stroke={INK} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M34.5 30.5L38 34l3.5-3.5" stroke={ACCENT} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

const STEPS = [
  {
    n: "01",
    title: "Lock",
    Icon: LockIcon,
    line: "The buyer locks funds in the on-chain escrow. The money stops being spendable by anyone until the terms resolve.",
    tokens: true,
  },
  {
    n: "02",
    title: "Attest",
    Icon: SealIcon,
    line: "The seller delivers the work, then posts a sha256 of the exact bytes delivered — a signed claim, anchored on-chain.",
  },
  {
    n: "03",
    title: "Challenge",
    Icon: FlagIcon,
    line: "A window opens. The buyer inspects what arrived and can flag garbage, wrong, or missing delivery before a cent moves.",
  },
  {
    n: "04",
    title: "Capture / Void",
    Icon: ForkIcon,
    line: "Window closes with no flag: the seller is paid. Flagged: anyone can void it and the buyer is refunded in full, on-chain.",
  },
];

export default function HowItWorks() {
  return (
    <section id="how-it-works" className="rc-how" aria-label="How RAINCHECK works">
      <div className="rc-how-wrap">
        <Reveal>
          <p className="rc-eyebrow">The mechanism · 01–04</p>
          <h2 className="rc-section-title">
            Four steps. Zero &ldquo;trust me.&rdquo;
          </h2>
          <p className="rc-parenthetical">
            <em>( lock → attest → challenge → resolve )</em>
          </p>
        </Reveal>

        <ol className="rc-steps">
          {STEPS.map((s) => (
            <li key={s.n} className="rc-step">
              <Reveal>
                <div className="rc-step-row">
                  <span className="rc-step-num" aria-hidden="true">
                    {s.n}
                  </span>
                  <span className="rc-step-icon" aria-hidden="true">
                    <s.Icon />
                  </span>
                  <div className="rc-step-body">
                    <h3 className="rc-step-title">{s.title}</h3>
                    <p className="rc-step-line">{s.line}</p>
                    {s.tokens && (
                      <div className="rc-step-tokens" aria-label="Escrow currencies">
                        <span className="rc-step-token">
                          <TokenIcon token="USDC" size={20} />
                          USDC
                        </span>
                        <span className="rc-step-token">
                          <TokenIcon token="EURC" size={20} />
                          EURC
                        </span>
                      </div>
                    )}
                  </div>
                </div>
              </Reveal>
            </li>
          ))}
        </ol>

        <Reveal>
          <p className="rc-how-note">
            Finalization is permissionless: capture and void can be submitted
            by the buyer, the seller, a stranger, or a keeper. No admin, no
            allowlist, no &ldquo;contact us to proceed.&rdquo; Funds can never
            trap — every terminal state is reachable by anyone.
          </p>
        </Reveal>
      </div>
    </section>
  );
}
