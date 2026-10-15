import Reveal from "./Reveal";
import { AddressLink } from "../ui/ExplorerLink";
import { ESCROW_ADDRESS, ESCROW_ADDRESS_EURC } from "../../lib/contracts";
import "./ProtocolSection.css";

/**
 * Protocol — honest protocol-versions section.
 *
 * V1/USDC and V1/EURC are production: this app, Sourcify exact_match.
 * V2 (0x3795b865f7fc84a14ab60456be9fc6dd0cb56f0c) is mainnet-proven but
 * EXPERIMENTAL: explicitly not app-wired, not audited. The honest
 * resolution is transparency — a card that says what it is — not wiring.
 * Funds stay on V1.
 */
const V2_ADDRESS = "0x3795b865f7fc84a14ab60456be9fc6dd0cb56f0c";

const INSTANCES = [
  {
    name: "V1 · USDC",
    address: ESCROW_ADDRESS,
    status: "production" as const,
    statusLabel: "Production — this app",
    note: "Sourcify exact_match on Arc mainnet. This is the contract every receipt on this site runs through.",
  },
  {
    name: "V1 · EURC",
    address: ESCROW_ADDRESS_EURC,
    status: "production" as const,
    statusLabel: "Production — this app",
    note: "Sourcify exact_match on Arc mainnet. Same V1 source, EURC instance.",
  },
  {
    name: "V2 · experimental",
    address: V2_ADDRESS,
    status: "experimental" as const,
    statusLabel: "Experimental — opt-in in the app",
    note: "Proven on mainnet (7-param authorize, dispute/void, voidAfterDeadline) and Sourcify exact_match. NOT audited. Usable from the dashboard as an explicit opt-in — funds on V2 are your own risk.",
  },
];

export default function ProtocolSection() {
  return (
    <section id="protocol" className="rc-protocol" aria-label="Protocol versions">
      <div className="rc-protocol-wrap">
        <Reveal>
          <p className="rc-protocol-eyebrow">The contracts behind the receipts</p>
          <h2 className="rc-section-title rc-protocol-title">Protocol.</h2>
          <p className="rc-parenthetical rc-protocol-sub">
            <em>( what&apos;s production, what&apos;s an experiment )</em>
          </p>
        </Reveal>

        <div className="rc-protocol-grid">
          {INSTANCES.map((inst, i) => (
            <div
              key={inst.name}
              className={`rc-protocol-card rc-protocol-card--${inst.status}`}
            >
              <Reveal delay={Math.min(i, 2) * 80}>
                <p
                  className={`rc-protocol-status rc-protocol-status--${inst.status}`}
                >
                  <span
                    className="rc-protocol-dot"
                    aria-hidden="true"
                  />
                  {inst.statusLabel}
                </p>
                <h3 className="rc-protocol-name">{inst.name}</h3>
                <p className="rc-protocol-note">{inst.note}</p>
                <p className="rc-protocol-addr">
                  <AddressLink address={inst.address} />
                </p>
              </Reveal>
            </div>
          ))}
        </div>

        <Reveal>
          <p className="rc-protocol-foot">
            One live vault per token. If an address isn&apos;t on this list,
            it isn&apos;t RAINCHECK — verify before you send anything.
          </p>
        </Reveal>
      </div>
    </section>
  );
}
