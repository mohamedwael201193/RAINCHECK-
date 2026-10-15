import Reveal from "./Reveal";
import "./FirstScreenTrust.css";

/**
 * FirstScreenTrust — the bible-rule compact trust block, mounted DIRECTLY
 * below the hero (first screen, never buried in a FAQ).
 *
 * Short bullets, plain language. Nothing here hedges with weasel words:
 * what the product cannot guarantee is said out loud.
 */
const BULLETS: { head: string; tail: string }[] = [
  {
    head: "In T0 mode the seller attests their own delivery.",
    tail: "The hash proves *something* was delivered — not that it is what you paid for. Delivery-oracle limits are real.",
  },
  {
    head: "The challenge window is your only leverage.",
    tail: "If you don't inspect what arrived before the window closes, the money releases automatically. The looking is on you.",
  },
  {
    head: "No third-party volume yet.",
    tail: "Every on-chain proof so far is our own first-party dust, run on mainnet. Real buyer/seller flow hasn't been observed — and we won't claim otherwise.",
  },
  {
    head: "Contracts are verified by proof, not by a firm.",
    tail: "Sourcify exact_match on Arc mainnet — anyone can re-verify the bytecode. No security-firm audit exists.",
  },
];

export default function FirstScreenTrust() {
  return (
    <section
      className="rc-fst"
      aria-label="What you have to trust — the short version"
    >
      <div className="rc-fst-wrap">
        <Reveal>
          <p className="rc-fst-eyebrow">What you have to trust · read this first</p>
        </Reveal>
        <ul className="rc-fst-list">
          {BULLETS.map((b, i) => (
            <li key={i} className="rc-fst-item">
              <Reveal delay={Math.min(i, 3) * 70}>
                <span className="rc-fst-bullet" aria-hidden="true">
                  —
                </span>
                <p className="rc-fst-text">
                  <strong>{b.head}</strong> {b.tail}
                </p>
              </Reveal>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
