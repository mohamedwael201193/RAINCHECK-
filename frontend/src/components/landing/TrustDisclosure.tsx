import Reveal from "./Reveal";
import "./TrustDisclosure.css";

/**
 * "What you have to trust" — first-screen block.
 * From the build bible §2 learnings + §4.4 trust residuals.
 * Plain language, never buried in an FAQ.
 */
const DISCLOSURES = [
  {
    title: "An attestation is a claim, not proof.",
    line: "Anyone can post the sha256 of garbage bytes. The seller\u2019s hash proves they delivered *something* — it does not prove they delivered what you paid for.",
  },
  {
    title: "The challenge window is the leverage.",
    line: "If the buyer doesn\u2019t look at what arrived before the window closes, garbage ships and gets paid. The receipt gives you the time and the evidence; the looking is on you.",
  },
  {
    title: "Quality you can\u2019t hash stays human.",
    line: "A hash can\u2019t measure taste, tone, or \u201cgood enough.\u201d Subjective delivery quality is arbitrated by evidence and judgment, not by math.",
  },
  {
    title: "The record is permanent.",
    line: "Every state change is anchored on-chain with a transaction memo. History can\u2019t be rewritten, and anyone — a marketplace, an auditor, a stranger — can re-derive any receipt from chain logs alone.",
  },
  {
    title: "This site\u2019s numbers are a cache, not the truth.",
    line: "The indexer only replays on-chain events. If it disagrees with the chain, the chain wins. Every statistic below is re-derivable from logs.",
  },
];

export default function TrustDisclosure() {
  return (
    <section id="trust" className="rc-trust" aria-label="What you have to trust">
      <div className="rc-trust-wrap">
        <Reveal>
          <p className="rc-trust-eyebrow">Read this first. Not a FAQ.</p>
          <h2 className="rc-section-title rc-trust-title">
            What you have to trust.
          </h2>
          <p className="rc-parenthetical rc-trust-sub">
            <em>( the fine print, up front )</em>
          </p>
          <p className="rc-trust-lede">
            RAINCHECK doesn&apos;t ask for blind trust. It tells you exactly
            where trust lives — so you can decide where it doesn&apos;t belong.
          </p>
        </Reveal>

        <ol className="rc-trust-list">
          {DISCLOSURES.map((d, i) => (
            <li key={i} className="rc-trust-row">
              <Reveal delay={Math.min(i, 4) * 60}>
                <div className="rc-trust-row-inner">
                  <span className="rc-trust-num" aria-hidden="true">
                    {String(i + 1).padStart(2, "0")}
                  </span>
                  <div>
                    <h3 className="rc-trust-h">{d.title}</h3>
                    <p className="rc-trust-p">{d.line}</p>
                  </div>
                </div>
              </Reveal>
            </li>
          ))}
        </ol>

        <Reveal>
          <p className="rc-trust-close">
            What you do <em>not</em> have to trust: the seller&apos;s word
            alone, any keeper&apos;s honesty, or this website. Capture and void
            are permissionless, and every terminal state is verifiable from
            chain state without us.
          </p>
        </Reveal>
      </div>
    </section>
  );
}
