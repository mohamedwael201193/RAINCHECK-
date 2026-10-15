import Reveal from "./Reveal";
import { AddressLink } from "../ui/ExplorerLink";
import "./OracleTeaser.css";

/**
 * OracleTeaser — T0-O oracle tier, forward-compatible placeholder.
 *
 * Build-time detection (NOT runtime guessing): Vite resolves
 * import.meta.glob at build time, so if the contracts worker's
 * src/lib/oracle.ts isn't in the build, this renders an honest
 * "deploying" state — never a fake "live".
 *
 * When the module IS present, the registry address is read from it and
 * linked to the explorer. The deployment itself was verified independently:
 * OracleRegistry has code on Arc mainnet and Sourcify exact_match.
 */
const oracleModules = import.meta.glob("./../../lib/*.ts", { eager: true });
const oracleKey = Object.keys(oracleModules).find((k) =>
  k.replace(/\\/g, "/").endsWith("/lib/oracle.ts"),
);
const oracleMod = (
  oracleKey ? oracleModules[oracleKey] : undefined
) as { ORACLE_REGISTRY_ADDRESS?: unknown } | undefined;

const registryAddress =
  typeof oracleMod?.ORACLE_REGISTRY_ADDRESS === "string" &&
  /^0x[0-9a-fA-F]{40}$/.test(oracleMod.ORACLE_REGISTRY_ADDRESS)
    ? oracleMod.ORACLE_REGISTRY_ADDRESS
    : null;

export default function OracleTeaser() {
  return (
    <section id="oracle" className="rc-oracle" aria-label="Oracle attestation tier">
      <div className="rc-oracle-wrap">
        <Reveal>
          <p className="rc-oracle-eyebrow">Coming to receipts</p>
          <h2 className="rc-section-title rc-oracle-title">
            Third-party oracle attestation{" "}
            <span className="rc-oracle-tier">(ECDSA_PINNED)</span>
          </h2>
          <p className="rc-parenthetical rc-oracle-sub">
            <em>( the T0-O tier )</em>
          </p>
        </Reveal>

        {registryAddress ? (
          <Reveal delay={80}>
            <div className="rc-oracle-card rc-oracle-card--live">
              <p className="rc-oracle-status">
                <span className="rc-oracle-dot" aria-hidden="true" />
                Live on mainnet
              </p>
              <p className="rc-oracle-copy">
                The OracleRegistry contract is deployed on Arc mainnet and
                Sourcify-verified (exact_match) — third-party attesters can
                anchor delivery claims under the{" "}
                <code>raincheck:5042:oracle:</code> domain today. Receipt-level
                oracle display in this app is being wired now.
              </p>
              <p className="rc-oracle-addr">
                <AddressLink address={registryAddress} />
              </p>
            </div>
          </Reveal>
        ) : (
          <Reveal delay={80}>
            <div className="rc-oracle-card rc-oracle-card--deploying">
              <p className="rc-oracle-status">
                <span className="rc-oracle-dot" aria-hidden="true" />
                Deploying
              </p>
              <p className="rc-oracle-copy">
                The oracle attestation module isn&apos;t in this build yet.
                This section will read its live state from the chain the
                moment it ships — nothing here will pretend otherwise.
              </p>
            </div>
          </Reveal>
        )}
      </div>
    </section>
  );
}
