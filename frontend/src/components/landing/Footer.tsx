import TokenIcon from "../TokenIcon";
import Reveal from "./Reveal";
import "./Footer.css";

const EXPLORER_URL = "https://explorer.arc.io";
const USDC_ESCROW = "0x97f233865ae84DC7475F6D7CA404930654580CB5";
const EURC_ESCROW = "0x3ceba2fbeb27162bfc4888f6b61e48bd359c1e0a";

const LINKS = [
  { label: "Verify a receipt", href: "/verify" },
  { label: "Dashboard", href: "/dashboard" },
  { label: "Arc explorer", href: EXPLORER_URL, external: true },
];

const ESCROWS = [
  { token: "USDC" as const, address: USDC_ESCROW },
  { token: "EURC" as const, address: EURC_ESCROW },
];

export default function Footer() {
  return (
    <footer className="rc-footer" aria-label="Footer">
      <div className="rc-footer-wrap">
        <Reveal>
          <div className="rc-footer-top">
            <div className="rc-footer-brand">
              <p className="rc-footer-wordmark">
                RAINCHECK<span className="rc-footer-dot">.</span>
              </p>
              <p className="rc-footer-tag">
                Delivery-attested receipts for agent commerce. Every paid API
                call gets an anchored, on-chain receipt — proof of delivery, or
                your money back.
              </p>
              <div className="rc-footer-tokens" aria-label="Settlement tokens">
                <TokenIcon token="USDC" size={22} />
                <TokenIcon token="EURC" size={22} />
                <span>Settles in USDC &amp; EURC · Arc mainnet</span>
              </div>
            </div>

            <nav aria-label="Footer links">
              <ul className="rc-footer-links">
                {LINKS.map((l) => (
                  <li key={l.label}>
                    <a
                      href={l.href}
                      {...(l.external
                        ? { target: "_blank", rel: "noopener noreferrer" }
                        : {})}
                      className="rc-footer-link"
                    >
                      {l.label}
                      {l.external && (
                        <span aria-hidden="true" className="rc-footer-ext">
                          ↗
                        </span>
                      )}
                    </a>
                  </li>
                ))}
              </ul>
            </nav>
          </div>
        </Reveal>

        <div className="rc-footer-bottom">
          <div className="rc-footer-contracts">
            <span className="rc-footer-contracts-label">
              Escrow contracts · Sourcify exact_match · chain 5042
            </span>
            {ESCROWS.map((e) => (
              <span key={e.address} className="rc-footer-contract">
                <TokenIcon token={e.token} size={14} />
                <a
                  href={`${EXPLORER_URL}/address/${e.address}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="rc-footer-addr"
                >
                  {e.address}
                </a>
              </span>
            ))}
          </div>
          <span className="rc-footer-signoff">
            RAINCHECK — receipts that decide who keeps the money.
          </span>
        </div>
      </div>
    </footer>
  );
}
