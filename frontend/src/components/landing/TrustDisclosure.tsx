
const INK = '#0B1220';
const PAPER = '#F4EFE6';
const GREEN = '#35E0FF';

/**
 * "What you have to trust" — first-screen block.
 * From the build bible §2 learnings + §4.4 trust residuals.
 * Plain language, never buried in an FAQ.
 */
const DISCLOSURES = [
  {
    title: 'An attestation is a claim, not proof.',
    line: 'Anyone can post the sha256 of garbage bytes. The seller\u2019s hash proves they delivered *something* — it does not prove they delivered what you paid for.',
  },
  {
    title: 'The challenge window is the leverage.',
    line: 'If the buyer doesn\u2019t look at what arrived before the window closes, garbage ships and gets paid. The receipt gives you the time and the evidence; the looking is on you.',
  },
  {
    title: 'Quality you can\u2019t hash stays human.',
    line: 'A hash can\u2019t measure taste, tone, or \u201cgood enough.\u201d Subjective delivery quality is arbitrated by evidence and judgment, not by math.',
  },
  {
    title: 'The record is permanent.',
    line: 'Every state change is anchored on-chain with a transaction memo. History can\u2019t be rewritten, and anyone — a marketplace, an auditor, a stranger — can re-derive any receipt from chain logs alone.',
  },
  {
    title: 'This site\u2019s numbers are a cache, not the truth.',
    line: 'The indexer only replays on-chain events. If it disagrees with the chain, the chain wins. Every statistic below is re-derivable from logs.',
  },
];

export default function TrustDisclosure() {
  return (
    <section
      id="trust"
      style={{ background: INK, color: PAPER, padding: '96px 24px' }}
      aria-label="What you have to trust"
    >
      <div style={{ maxWidth: 1120, margin: '0 auto' }}>
        <p
          style={{
            fontSize: 12,
            letterSpacing: '0.28em',
            fontWeight: 700,
            color: GREEN,
            margin: '0 0 16px',
          }}
        >
          READ THIS FIRST. NOT A FAQ.
        </p>
        <h2
          style={{
            fontSize: 'clamp(32px, 5vw, 56px)',
            lineHeight: 1.05,
            fontWeight: 800,
            letterSpacing: '-0.02em',
            margin: '0 0 20px',
            maxWidth: 800,
          }}
        >
          What you have to trust.
        </h2>
        <p
          style={{
            fontSize: 18,
            lineHeight: 1.6,
            opacity: 0.8,
            maxWidth: 720,
            margin: '0 0 56px',
          }}
        >
          RAINCHECK doesn&apos;t ask for blind trust. It tells you exactly where
          trust lives — so you can decide where it doesn&apos;t belong.
        </p>

        <ul
          style={{
            listStyle: 'none',
            margin: 0,
            padding: 0,
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
            gap: 24,
          }}
        >
          {DISCLOSURES.map((d, i) => (
            <li
              key={i}
              style={{
                border: `1px solid ${PAPER}33`,
                borderRadius: 12,
                padding: '24px 22px',
                background: `${PAPER}08`,
              }}
            >
              <h3
                style={{
                  fontSize: 18,
                  fontWeight: 700,
                  margin: '0 0 10px',
                  lineHeight: 1.3,
                }}
              >
                <span style={{ color: GREEN, marginRight: 8 }} aria-hidden="true">
                  ▸
                </span>
                {d.title}
              </h3>
              <p
                style={{
                  fontSize: 15,
                  lineHeight: 1.65,
                  margin: 0,
                  opacity: 0.78,
                }}
              >
                {d.line}
              </p>
            </li>
          ))}
        </ul>

        <p
          style={{
            marginTop: 48,
            fontSize: 14,
            lineHeight: 1.6,
            opacity: 0.6,
            maxWidth: 720,
          }}
        >
          What you do <em>not</em> have to trust: the seller&apos;s word alone,
          any keeper&apos;s honesty, or this website. Capture and void are
          permissionless, and every terminal state is verifiable from chain
          state without us.
        </p>
      </div>
    </section>
  );
}
