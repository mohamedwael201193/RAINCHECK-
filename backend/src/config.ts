import dotenv from "dotenv";

dotenv.config();

// Chain identity — Arc mainnet (5042). Never mix with testnet 5042002.
export const CHAIN_ID = 5042;

// Public RPC. Overridable via env; defaults to the public Arc endpoint.
// Never a secret: reading this value is safe anywhere.
export const RPC_URL: string = process.env.RPC_URL ?? "https://rpc.mainnet.arc.io";

// Block explorer base URL (for per-transition receipt links).
export const EXPLORER = "https://explorer.arc.io" as const;

// RaincheckEscrow — PRODUCTION V1, Sourcify exact_match on 5042
// (contracts/deployments/arc-5042.json; deploy tx 0xebd2e3fbbf805ba36fe0c1173f655b10aa769fd6809ccdfec5e61cef5213aa51,
// block 25956323, challengeWindow 300). Supersedes the R9 experiment instance
// 0x41099436c5f18eA916B9ca3B835fdc4B5c758Deb (60s challengeWindow).
export const ESCROW_ADDRESS = "0x97f233865ae84DC7475F6D7CA404930654580CB5" as const;

// RaincheckEscrow — PRODUCTION V1 EURC instance, Sourcify exact_match on 5042
// (contracts/deployments/arc-5042.json -> eurcEscrow; deploy tx
// 0x34f7240f5c074fa082ad4e6b672d0fbd2542792459e5f09d51ee2ebc586a4094,
// block 25962288, challengeWindow 300). SAME V1 source as the USDC instance —
// constructor arg changed to EURC only. Multi-asset = one escrow instance per
// token; this contract is token-agnostic.
export const ESCROW_ADDRESS_EURC =
  "0x3ceba2fbeb27162bfc4888f6b61e48bd359c1e0a" as const;

// Memo contract (existing infrastructure, 1228 bytes of code, verified eth_getCode).
export const MEMO_ADDRESS = "0x5294E9927c3306DcBaDb03fe70b92e01cCede505" as const;

// Arc USDC — gas token (18-decimal native face) and ERC-20 face (6 decimals) share supply.
export const USDC_ADDRESS = "0x3600000000000000000000000000000000000000" as const;

// Arc EURC — ERC-20 face (6 decimals). The second production escrow instance
// above is constructed with this token and nothing else differs.
export const EURC_ADDRESS = "0xbEf5f6d51CB62b58e6A8f77868681825C6fe21c1" as const;

/**
 * Payment token settled by an escrow instance, derived from the log's escrow
 * address. Multi-asset = one escrow instance per token. Presentation-only:
 * the canonical receipt (§4.6) is token-blind by design, so this map lives in
 * config (not in the receipt) and the API derives `token` from it. Keys are
 * lowercase escrow addresses.
 */
export type EscrowToken = "USDC" | "EURC";
export const TOKEN_BY_ESCROW: Record<string, EscrowToken> = {
  [ESCROW_ADDRESS.toLowerCase()]: "USDC",
  [ESCROW_ADDRESS_EURC.toLowerCase()]: "EURC",
};

/** Derive the payment token for a watched escrow address (null = unknown). */
export function tokenForEscrow(escrowAddress: string | null | undefined): EscrowToken | null {
  if (!escrowAddress) return null;
  return TOKEN_BY_ESCROW[escrowAddress.toLowerCase()] ?? null;
}
