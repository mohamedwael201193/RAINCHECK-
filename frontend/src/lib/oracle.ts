/**
 * RAINCHECK T0-O oracle tier (bible §4.5) — frontend address registry.
 *
 * Source of truth: contracts/deployments/arc-5042-oracle.json.
 * Addresses are public on-chain data — never secrets.
 */

/** Arc mainnet chain id. */
export const ORACLE_CHAIN_ID = 5042 as const;

/** OracleRegistry — T0-O ECDSA_PINNED tier (Sourcify exact_match, chain 5042). */
export const ORACLE_REGISTRY_ADDRESS =
  "0x61412688aAF14F8A0e94C6665933E5DFA84e405A" as const;

/** RaincheckEscrowFP — V1.1 freeze-proof escrow, USDC instance (Sourcify exact_match). */
export const ESCROW_FP_ADDRESS_USDC =
  "0x54F05A5214d99cA458d142bA9E2f0CB77c1B2470" as const;

/** Oracle domain string baked into the contract digest (keccak256("raincheck:5042:oracle:" ‖ paymentId ‖ outputHash)). */
export const ORACLE_DOMAIN = "raincheck:5042:oracle:" as const;
