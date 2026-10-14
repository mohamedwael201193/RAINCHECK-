
const INK = '#0B1220';
const PAPER = '#F4EFE6';
const GREEN = '#35E0FF';

const STEPS = [
  {
    n: '01',
    title: 'Lock',
    line: 'The buyer locks USDC in the on-chain escrow. The money stops being spendable by anyone until the terms resolve.',
  },
  {
    n: '02',
    title: 'Attest',
    line: 'The seller delivers the work, then posts a sha256 of the exact bytes delivered — a signed claim, anchored on-chain.',
  },
  {
    n: '03',
    title: 'Challenge',
    line: 'A window opens. The buyer inspects what arrived and can flag garbage, wrong, or missing delivery before a cent moves.',
  },
  {
    n: '04',
    title: 'Capture / Void',
    line: 'Window closes with no flag: the seller is paid. Flagged: anyone can void it and the buyer is refunded in full, on-chain.',
  },
];

export default function HowItWorks() {
  return (
    <section
      id="how-it-works"
      style={{ background: PAPER, color: INK, padding: '96px 24px' }}
      aria-label="How RAINCHECK works"
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
          FOUR STEPS. NO &ldquo;TRUST ME.&rdquo;
        </p>
        <h2
          style={{
            fontSize: 'clamp(32px, 5vw, 56px)',
            lineHeight: 1.05,
            fontWeight: 800,
            letterSpacing: '-0.02em',
            margin: '0 0 64px',
            maxWidth: 800,
          }}
        >
          Every paid API call gets a receipt. The receipt decides who keeps the
          money.
        </h2>

        <ol
          style={{
            listStyle: 'none',
            margin: 0,
            padding: 0,
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
            gap: 32,
          }}
        >
          {STEPS.map((s) => (
            <li
              key={s.n}
              style={{
                borderTop: `3px solid ${INK}`,
                paddingTop: 20,
                position: 'relative',
              }}
            >
              <span
                style={{
                  display: 'inline-block',
                  fontSize: 13,
                  fontWeight: 800,
                  letterSpacing: '0.2em',
                  color: PAPER,
                  background: INK,
                  padding: '4px 10px',
                  borderRadius: 999,
                  marginBottom: 14,
                }}
              >
                {s.n}
              </span>
              <h3
                style={{
                  fontSize: 24,
                  fontWeight: 800,
                  margin: '0 0 10px',
                  letterSpacing: '-0.01em',
                }}
              >
                {s.title}
              </h3>
              <p style={{ fontSize: 16, lineHeight: 1.6, margin: 0, opacity: 0.85 }}>
                {s.line}
              </p>
            </li>
          ))}
        </ol>

        <p
          style={{
            marginTop: 56,
            fontSize: 14,
            lineHeight: 1.6,
            opacity: 0.7,
            maxWidth: 720,
          }}
        >
          Finalization is permissionless: capture and void can be submitted by
          the buyer, the seller, a stranger, or a keeper. No admin, no allowlist,
          no &ldquo;contact us to proceed.&rdquo; Funds can never trap — every
          terminal state is reachable by anyone.
        </p>
      </div>
    </section>
  );
}
