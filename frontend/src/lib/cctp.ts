/**
 * CCTP bridge builders — src/lib/cctp.ts
 *
 * Pure tx builders for the in-app CCTP "Bridge" panel. No network, no wallet,
 * no secrets: each builder returns the EXACT calldata that will be sent, and
 * the UI previews it before signing. Encoding uses tx.ts's zero-dependency
 * `encodeFunctionCall` (the frontend's viem install is partial — never import
 * viem here).
 *
 * VERIFIED FACTS (do not re-derive; evidence in the build notes):
 *
 *  1. Arc's CCTP messenger is V2. The shared TokenMessengerV2 lives at
 *     0x28b5a0e9C621a5BadaA536219b3a228C8168cf5d on Arc (domain 26) —
 *     confirmed on Circle's live contract-addresses page, which lists Arc
 *     domain 26 in the mainnet table.
 *  2. The 7-parameter depositForBurn
 *     (uint256,uint32,bytes32,address,bytes32,uint256,uint32) is PROVEN on
 *     Arc mainnet: a direct-EOA dust burn of 0.005 USDC, Arc -> Base (domain
 *     6), succeeded in tx
 *     0xe519221e1c1d7b1c6225f22c1bd6bba9e76d1bb77fc467cf78fd1eace23731f1.
 *     Its calldata selector is 0x8e0250ee (verified from chain data), with
 *     params (5000, 6, <recipient bytes32>, USDC, 0x0, 0, 1000). The unit
 *     test below asserts byte-equality against that exact calldata.
 *  3. Contract-initiated CCTP burns are chain-gated on Arc (proven with
 *     minimal test contracts): the bridge MUST sign from the user's wallet
 *     directly — never through the Memo contract or any wrapper.
 *  4. EURC is NOT a burn token on the Arc TokenMessengerV2: a mainnet-state
 *     simulation of depositForBurn(EURC, ...) reverts with "Burn token not
 *     supported". EURC exits Arc through Circle's CrossChainTokenService
 *     (0x431871229103b780868f8C6BB820cd16ECf942BC), whose
 *     resolveTokenManager(bytes32) entry (selector 0xf1761e84, verified in
 *     the deployed implementation's dispatcher) resolves EURC to TokenManager
 *     0x8c27579e24f9f19d96724e19fc059dacd1469e10. The CrossChainTokenService
 *     burn-entry signature is documented by Circle but has NOT been
 *     mainnet-proven by the team — so the panel shows the EURC route
 *     honestly (addresses + explanation) with NO execute button until a
 *     dust burn proves it. Hard rule: a button that can't execute a real,
 *     verified tx must not exist.
 *  5. USDC approval for depositForBurn goes to the TokenMessengerV2 itself
 *     (it pulls the tokens via transferFrom).
 *
 * Gas: manual limits only (bible §9.1 — never eth_estimateGas). The proven
 * burn used 120,240 gas; the burn limit below carries comfortable headroom.
 */

import {
  EURC_ADDRESS,
  USDC_ADDRESS,
  encodeFunctionCall,
  isAddress,
  usdcToBase,
  type Address,
  type BuiltTx,
  type Hex,
} from "./tx";

// ------------------------------------------------------------- contracts

/** Shared CCTP V2 TokenMessenger on Arc (domain 26). */
export const CCTP_TOKEN_MESSENGER_V2 =
  "0x28b5a0e9C621a5BadaA536219b3a228C8168cf5d" as Address;

/** Circle's non-USDC entry contract on Arc (EURC route — not yet wired). */
export const CCTP_CROSS_CHAIN_TOKEN_SERVICE =
  "0x431871229103b780868f8C6BB820cd16ECf942BC" as Address;

/** EURC's per-token manager on Arc (approve target for the EURC route). */
export const CCTP_EURC_TOKEN_MANAGER =
  "0x8c27579e24f9f19d96724e19fc059dacd1469e10" as Address;

/** Arc's CCTP domain identifier (Circle-issued, not the chain id). */
export const ARC_CCTP_DOMAIN = 26;

/** Canonical 7-param V2 signature; selector 0x8e0250ee (proven on-chain). */
export const DEPOSIT_FOR_BURN_SIGNATURE =
  "depositForBurn(uint256,uint32,bytes32,address,bytes32,uint256,uint32)";

/** minFinalityThreshold: 1000 = fast transfer (what the proven burn used). */
export const CCTP_MIN_FINALITY_FAST = 1000;

/** Manual gas limits (bible §9.1). */
export const CCTP_GAS = {
  approve: 120_000n,
  burn: 250_000n,
} as const;

// ---------------------------------------------------------------- domains

export interface CctpDomain {
  domain: number;
  name: string;
}

/**
 * USDC destinations. Each domain below is verified on Circle's live
 * CCTP contract-addresses page (mainnet table, fetched 2026-10-15):
 * TokenMessengerV2 is deployed at the shared address on every one of
 * these domains, and Circle's supported-chains docs state USDC is
 * supported on all CCTP domains except BNB Smart Chain. Non-EVM domains
 * (Solana 5, Starknet 25, Stellar 27) are deliberately excluded — their
 * mint-recipient format differs from the EVM bytes32 this panel builds.
 * Arc itself (26) is excluded — bridging to the chain you're on is a no-op.
 */
export const USDC_DESTINATIONS: readonly CctpDomain[] = [
  { domain: 0, name: "Ethereum" },
  { domain: 1, name: "Avalanche" },
  { domain: 2, name: "OP Mainnet" },
  { domain: 3, name: "Arbitrum" },
  { domain: 6, name: "Base" },
  { domain: 7, name: "Polygon PoS" },
  { domain: 10, name: "Unichain" },
  { domain: 11, name: "Linea" },
  { domain: 13, name: "Sonic" },
  { domain: 14, name: "World Chain" },
  { domain: 21, name: "Ink" },
];

/**
 * EURC CCTP routes, per Circle's September 2026 expansion (Arc connects
 * to Ethereum, Avalanche, Base and World Chain for EURC). Informational
 * only — the EURC bridge leg is not mainnet-proven by the team, so the
 * panel renders no execute button for EURC.
 */
export const EURC_DESTINATIONS: readonly CctpDomain[] = [
  { domain: 0, name: "Ethereum" },
  { domain: 1, name: "Avalanche" },
  { domain: 6, name: "Base" },
  { domain: 14, name: "World Chain" },
];

// ------------------------------------------------------------------ pure
// builders (no network)

/** The only token the proven burn path supports. */
export type BridgeableToken = "USDC";

/**
 * Amount parsing — both USDC and EURC are 6-decimal on Arc, so the shared
 * 6-decimal parser applies. Throws on zero / negative / >6 decimals /
 * non-numeric input (usdcToBase enforces the format).
 */
export function parseBridgeAmount(input: string): bigint {
  const base = usdcToBase(input.trim());
  if (base <= 0n) throw new Error("Amount must be greater than zero.");
  return base;
}

/**
 * mintRecipient encoding: the raw 20-byte EVM address, left-padded to
 * bytes32 — exactly the format of the proven mainnet burn's recipient
 * word (0x0000...<20-byte address>).
 */
export function encodeMintRecipient(recipient: string): Hex {
  if (!isAddress(recipient)) {
    throw new Error("Recipient must be a valid 0x EVM address.");
  }
  return (`0x${"0".repeat(24)}${recipient.slice(2).toLowerCase()}`) as Hex;
}

/**
 * Step 1 for the USDC route: approve the TokenMessengerV2 to pull the
 * burn amount. A plain (non-memo-wrapped) tx — the messenger must see the
 * USER as msg.sender, because contract-initiated burns are chain-gated.
 */
export function buildCctpApprove(amountBase: bigint): BuiltTx {
  if (amountBase <= 0n) throw new Error("Amount must be greater than zero.");
  const data = encodeFunctionCall(
    "approve(address,uint256)",
    ["address", "uint256"],
    [CCTP_TOKEN_MESSENGER_V2, amountBase],
  );
  return {
    kind: "approve",
    to: USDC_ADDRESS,
    data,
    gas: CCTP_GAS.approve,
    innerTarget: USDC_ADDRESS,
    innerCalldata: data,
    memoId: ("0x" + "0".repeat(64)) as Hex,
    memoData: JSON.stringify({
      spec: "raincheck-cctp-bridge/v1",
      action: "cctp-approve",
      token: USDC_ADDRESS,
      spender: CCTP_TOKEN_MESSENGER_V2,
      amount: amountBase.toString(),
    }),
    memoJson: {
      spec: "raincheck-cctp-bridge/v1",
      action: "cctp-approve",
      token: USDC_ADDRESS,
      spender: CCTP_TOKEN_MESSENGER_V2,
      amount: amountBase.toString(),
    },
    description: `Let the CCTP messenger pull the burn amount of USDC from your wallet`,
  };
}

export interface CctpBurnInput {
  amountBase: bigint;
  destinationDomain: number;
  /** EVM recipient address on the destination chain (0x...). */
  mintRecipient: string;
}

/**
 * Step 2 for the USDC route: the 7-param depositForBurn, byte-identical in
 * shape to the proven mainnet burn (selector 0x8e0250ee). destinationCaller
 * is bytes32(0) = permissionless relay; maxFee = 0; minFinalityThreshold =
 * 1000 (fast transfer, as proven).
 *
 * Deliberately rejects EURC: mainnet-state simulation reverts with
 * "Burn token not supported" for EURC on the Arc messenger. EURC leaves
 * Arc via the CrossChainTokenService, whose burn entry is not yet
 * mainnet-proven by the team — see the module header.
 */
export function buildCctpBurn(input: CctpBurnInput): BuiltTx {
  const { amountBase, destinationDomain, mintRecipient } = input;
  if (amountBase <= 0n) throw new Error("Amount must be greater than zero.");
  if (
    !USDC_DESTINATIONS.some((d) => d.domain === destinationDomain) ||
    destinationDomain === ARC_CCTP_DOMAIN
  ) {
    throw new Error("Destination domain is not a supported USDC route.");
  }
  const recipientBytes32 = encodeMintRecipient(mintRecipient);
  // uint32 params encode identically to uint256 in ABI (32-byte words);
  // the canonical signature string drives the selector.
  const data = encodeFunctionCall(
    DEPOSIT_FOR_BURN_SIGNATURE,
    ["uint256", "uint256", "bytes32", "address", "bytes32", "uint256", "uint256"],
    [
      amountBase,
      BigInt(destinationDomain),
      recipientBytes32,
      USDC_ADDRESS,
      ("0x" + "0".repeat(64)) as Hex,
      0n,
      BigInt(CCTP_MIN_FINALITY_FAST),
    ],
  );
  return {
    kind: "cctpBurn",
    to: CCTP_TOKEN_MESSENGER_V2,
    data,
    gas: CCTP_GAS.burn,
    innerTarget: CCTP_TOKEN_MESSENGER_V2,
    innerCalldata: data,
    memoId: ("0x" + "0".repeat(64)) as Hex,
    memoData: JSON.stringify({
      spec: "raincheck-cctp-bridge/v1",
      action: "cctp-burn",
      token: USDC_ADDRESS,
      amount: amountBase.toString(),
      sourceDomain: ARC_CCTP_DOMAIN,
      destinationDomain,
      mintRecipient,
      minFinalityThreshold: CCTP_MIN_FINALITY_FAST,
    }),
    memoJson: {
      spec: "raincheck-cctp-bridge/v1",
      action: "cctp-burn",
      token: USDC_ADDRESS,
      amount: amountBase.toString(),
      sourceDomain: ARC_CCTP_DOMAIN,
      destinationDomain,
      mintRecipient,
      minFinalityThreshold: CCTP_MIN_FINALITY_FAST,
    },
    description: `Burn USDC on Arc for CCTP delivery to domain ${destinationDomain}`,
  };
}

/** Re-exported for the panel's token copy (both are 6-decimal). */
export { EURC_ADDRESS, USDC_ADDRESS };
