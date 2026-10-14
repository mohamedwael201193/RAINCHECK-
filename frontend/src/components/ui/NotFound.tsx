import { Link } from "react-router-dom";
import { addressUrl } from "./ExplorerLink";

// RaincheckEscrow PRODUCTION V1 on Arc mainnet 5042 (build bible §10).
const ESCROW = "0x97f233865ae84DC7475F6D7CA404930654580CB5";

/**
 * NotFound — honest 404. Bible §8.2: no dead ends. A missing route explains
 * itself and offers exactly two live exits: home, or the escrow on the
 * explorer. Never a bare "404".
 */
export default function NotFound() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-ink px-6 text-ice">
      <div className="w-full max-w-xl text-center">
        <p className="mb-4 font-display text-sm font-bold uppercase tracking-[0.3em] text-rain">
          Nowhere to file this
        </p>
        <h1 className="mb-4 font-display text-5xl font-black uppercase leading-[0.95] sm:text-6xl">
          No receipt here.
        </h1>
        <p className="mx-auto mb-8 max-w-md text-base leading-relaxed text-ice/70">
          This page doesn&apos;t exist — or isn&apos;t built yet. The chain is
          still there if you want proof instead.
        </p>
        <div className="flex flex-wrap items-center justify-center gap-4">
          <Link to="/" className="rc-btn-primary">
            Back home
          </Link>
          <a
            href={addressUrl(ESCROW)}
            target="_blank"
            rel="noopener noreferrer"
            className="rc-btn-outline-ice"
          >
            Escrow on explorer <span aria-hidden="true">↗</span>
          </a>
        </div>
      </div>
    </main>
  );
}
