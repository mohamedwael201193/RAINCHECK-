
const INK = '#0B1220';
const PAPER = '#F4EFE6';
const GREEN = '#35E0FF';

const EXPLORER_URL = 'https://explorer.arc.io';
const ESCROW_ADDRESS = '0x97f233865ae84DC7475F6D7CA404930654580CB5';

const LINKS = [
  { label: 'Verify a receipt', href: '/verify' },
  { label: 'Dashboard', href: '/dashboard' },
  { label: 'Arc explorer', href: EXPLORER_URL, external: true },
];

export default function Footer() {
  return (
    <footer
      style={{ background: INK, color: PAPER, padding: '72px 24px 40px' }}
      aria-label="Footer"
    >
      <div style={{ maxWidth: 1120, margin: '0 auto' }}>
        <div
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            justifyContent: 'space-between',
            gap: 40,
            paddingBottom: 48,
            borderBottom: `1px solid ${PAPER}22`,
          }}
        >
          <div style={{ maxWidth: 420 }}>
            <p
              style={{
                fontSize: 28,
                fontWeight: 800,
                letterSpacing: '-0.02em',
                margin: '0 0 12px',
              }}
            >
              RAINCHECK<span style={{ color: GREEN }}>.</span>
            </p>
            <p style={{ fontSize: 15, lineHeight: 1.65, opacity: 0.7, margin: 0 }}>
              Delivery-attested receipts for agent commerce. Every paid API
              call gets an anchored, on-chain receipt — proof of delivery, or
              your money back.
            </p>
          </div>

          <nav aria-label="Footer links">
            <ul
              style={{
                listStyle: 'none',
                margin: 0,
                padding: 0,
                display: 'grid',
                gap: 12,
              }}
            >
              {LINKS.map((l) => (
                <li key={l.label}>
                  <a
                    href={l.href}
                    {...(l.external
                      ? { target: '_blank', rel: 'noopener noreferrer' }
                      : {})}
                    style={{
                      color: PAPER,
                      textDecoration: 'none',
                      fontSize: 16,
                      fontWeight: 600,
                      opacity: 0.9,
                    }}
                    onMouseOver={(e) => {
                      (e.currentTarget as HTMLAnchorElement).style.color =
                        GREEN;
                    }}
                    onMouseOut={(e) => {
                      (e.currentTarget as HTMLAnchorElement).style.color =
                        PAPER;
                    }}
                  >
                    {l.label}
                    {l.external && (
                      <span
                        aria-hidden="true"
                        style={{ marginLeft: 6, fontSize: 12, opacity: 0.6 }}
                      >
                        ↗
                      </span>
                    )}
                  </a>
                </li>
              ))}
            </ul>
          </nav>
        </div>

        <div
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            justifyContent: 'space-between',
            gap: 16,
            paddingTop: 28,
            fontSize: 13,
            opacity: 0.55,
            lineHeight: 1.6,
          }}
        >
          <span>
            Escrow contract (Sourcify exact_match, chain 5042):{' '}
            <a
              href={`${EXPLORER_URL}/address/${ESCROW_ADDRESS}`}
              target="_blank"
              rel="noopener noreferrer"
              style={{ color: PAPER, textDecoration: 'underline' }}
            >
              {ESCROW_ADDRESS}
            </a>
          </span>
          <span>RAINCHECK — receipts that decide who keeps the money.</span>
        </div>
      </div>
    </footer>
  );
}
