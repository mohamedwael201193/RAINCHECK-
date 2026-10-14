import { createPublicClient, http, type PublicClient } from "viem";
import { CHAIN_ID, RPC_URL, EXPLORER, ESCROW_ADDRESS, MEMO_ADDRESS, USDC_ADDRESS } from "./config.js";
import { RAINCHECK_ESCROW_ABI } from "./index.js";

// Public read client for Arc mainnet. No private key, no signing — reads only.
// Memo-wrapped writes are signed client-side by the user's wallet; they always use
// a manual gas limit because the Memo contract reverts under eth_call/gas estimation.
export const publicClient: PublicClient = createPublicClient({
  chain: {
    id: CHAIN_ID,
    name: "Arc",
    nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 },
    rpcUrls: { default: { http: [RPC_URL] }, public: { http: [RPC_URL] } },
  },
  transport: http(RPC_URL),
});

export const ESCROW_ABI = RAINCHECK_ESCROW_ABI;

export function txUrl(txHash: `0x${string}`): string {
  return `${EXPLORER}/tx/${txHash}`;
}

export { CHAIN_ID, RPC_URL, EXPLORER, ESCROW_ADDRESS, MEMO_ADDRESS, USDC_ADDRESS };
