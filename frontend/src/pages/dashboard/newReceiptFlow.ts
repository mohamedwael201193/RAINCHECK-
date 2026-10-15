/**
 * New-receipt flow helpers — src/pages/dashboard/newReceiptFlow.ts
 *
 * Only what the shared libs DON'T provide yet:
 *  - the paymentId scheme (task requirement, documented below)
 *  - EIP-712 signing via the injected wallet (primary_type -> primaryType
 *    mapping for eth_signTypedData_v4; bible §9.1 workaround #2)
 *  - a temporary sendTx shim that delegates to F1's signAndBroadcastArc:
 *    eth_signTransaction + eth_sendRawTransaction, with a MetaMask fallback
 *    to the wallet's eth_sendTransaction (the Arc node method still 401s)
 *  - mined-receipt polling (status 1 ONLY counts as success)
 *  - buyer balance reads (native 18dp + ERC-20 6dp)
 *
 * Everything else (buildApprove, buildAuthorize, signTerms, GAS_LIMITS,
 * explorerTxUrl, baseToUsdc, publicClient, RPC_URL) comes from
 * src/lib/tx.ts (F8) and src/lib/chain.ts (F6).
 *
 * MERGE NOTE: delete sendTxShim + waitForMinedStatus1 the moment F1's
 * src/lib/sendTx.ts lands (useTx already expects that import). Delete
 * signTermsWithInjected when F1's Privy provider lands — pass F8's
 * PrivyTypedData (snake_case primary_type) to Privy as-is.
 */

import {
  encodePacked,
  keccak256,
  toHex,
  type Address,
  type Hex,
} from "viem";
import { publicClient } from "../../lib/chain";
import { signAndBroadcastArc } from "../../lib/sendTx";
import { USDC_ADDRESS, type BuiltTx, type PrivyTypedData } from "../../lib/tx";

// ---------------------------------------------------------------------------
// paymentId scheme (documented per task).
// ---------------------------------------------------------------------------
/**
 * paymentId = keccak256(abi.encodePacked(
 *   buyer,        // address — the wallet opening the receipt
 *   seller,       // address — the delivery counterparty
 *   amount,       // uint256 — 6-decimal USDC base units
 *   termsHash,    // bytes32 — F8's sha256(canonical terms JSON), signed off-chain
 *   blockNumber,  // uint256 — latest block at submit time ("block-ish")
 *   salt          // bytes32 — 256-bit random salt, fresh per page load
 * ))
 *
 * Why this shape: the escrow reverts on paymentId reuse, so a retried
 * submission can never double-charge — but two genuinely different receipts
 * must never collide. Binding buyer+seller+amount+termsHash ties the id to
 * this exact deal; the block number + random salt ("block-ish nonce") make
 * every submission unique even if the same deal is opened twice. All inputs
 * are public, non-secret values — the paymentId is a receipt handle, not a
 * credential.
 */
export function derivePaymentId(args: {
  buyer: Address;
  seller: Address;
  amount: bigint;
  termsHash: Hex;
  blockNumber: bigint;
  salt: Hex;
}): Hex {
  return keccak256(
    encodePacked(
      ["address", "address", "uint256", "bytes32", "uint256", "bytes32"],
      [
        args.buyer,
        args.seller,
        args.amount,
        args.termsHash,
        args.blockNumber,
        args.salt,
      ],
    ),
  );
}

/** 256-bit random salt, fresh per page load (the "nonce" half of block-ish). */
export function randomSalt(): Hex {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return toHex(bytes);
}

// ---------------------------------------------------------------------------
// EIP-712 terms signing (injected wallet path)
// ---------------------------------------------------------------------------

interface InjectedEthereum {
  request: (args: { method: string; params?: unknown }) => Promise<unknown>;
}

function getInjected(): InjectedEthereum {
  const w = window as unknown as { ethereum?: InjectedEthereum };
  if (!w.ethereum) throw new Error("No injected wallet found.");
  return w.ethereum;
}

function resolveEth(provider?: InjectedEthereum | null): InjectedEthereum {
  if (provider) return provider;
  return getInjected();
}

/**
 * Sign F8's PrivyTypedData with the connected wallet.
 *
 * SNAKE_CASE NOTE (bible §9.1 workaround #2): Privy's own signing endpoint
 * expects `primary_type` (snake_case). The generic JSON-RPC method
 * eth_signTypedData_v4 expects `primaryType` (camelCase) — MetaMask/Rabby
 * will not find the primary type otherwise. This maps it for the wallet
 * path. Pass the Reown/AppKit provider when that road is connected.
 */
export async function signTermsWithInjected(
  buyer: Address,
  typedData: PrivyTypedData,
  provider?: InjectedEthereum | null,
): Promise<Hex> {
  const eth = resolveEth(provider);
  // eth_signTypedData_v4 rejects unknown keys. The stored payload keeps
  // snake_case primary_type for Privy; the wallet call sends primaryType only.
  const { primary_type, ...rest } = typedData;
  const payload = { ...rest, primaryType: primary_type };
  let sig: string;
  try {
    sig = (await eth.request({
      method: "eth_signTypedData_v4",
      params: [buyer, JSON.stringify(payload)],
    })) as string;
  } catch (err) {
    const message =
      err instanceof Error
        ? err.message
        : typeof err === "object" && err && "message" in err
          ? String((err as { message: unknown }).message)
          : "The wallet rejected the terms signature.";
    throw new Error(message);
  }
  if (!sig || !sig.startsWith("0x"))
    throw new Error("The wallet did not return a signature.");
  return sig as Hex;
}

// ---------------------------------------------------------------------------
// sendTx shim — DELETE when F1's src/lib/sendTx.ts lands
// ---------------------------------------------------------------------------

/**
 * F1-contract-compatible sendTx: (built: BuiltTx) => Promise<txHash>.
 * Delegates to signAndBroadcastArc. Manual gas limit comes from the BuiltTx
 * (Memo txs revert under estimation).
 */
export async function sendTxShim(
  built: BuiltTx,
  from: Address,
  provider?: InjectedEthereum | null,
): Promise<Hex> {
  const eth = resolveEth(provider);
  const [gasPrice, nonce] = await Promise.all([
    publicClient.getGasPrice(),
    publicClient.getTransactionCount({ address: from }),
  ]);
  return signAndBroadcastArc(eth, {
    from,
    to: built.to,
    data: built.data,
    gas: built.gas,
    value: 0n,
    gasPrice,
    nonce,
  });
}

/**
 * Poll eth_getTransactionReceipt until mined. Resolves ONLY on status 0x1.
 * Throws with a plain-language message on status 0x0 or timeout —
 * a revert is NEVER reported as success (bible §8.2).
 */
export async function waitForMinedStatus1(
  txHash: Hex,
  timeoutMs = 180_000,
): Promise<void> {
  const start = Date.now();
  for (;;) {
    // getTransactionReceipt THROWS while the tx is unmined — that is the
    // "still pending" signal, not a failure. Only swallow the not-found
    // case; anything else propagates.
    let receipt: { status: string } | null = null;
    try {
      receipt = await publicClient.getTransactionReceipt({ hash: txHash });
    } catch (e) {
      if (
        !(e instanceof Error && e.name === "TransactionReceiptNotFoundError")
      )
        throw e;
    }
    if (receipt) {
      if (receipt.status === "success") return;
      throw new Error(
        "The transaction was mined but reverted on-chain (status 0). " +
          "Nothing was locked — only gas was spent. Check the explorer for details.",
      );
    }
    if (Date.now() - start > timeoutMs)
      throw new Error(
        "Timed out waiting for confirmation. The transaction may still mine — " +
          "check the explorer before trying again, to avoid a duplicate.",
      );
    await new Promise((r) => setTimeout(r, 2000));
  }
}

// ---------------------------------------------------------------------------
// Buyer balances (the capability gate)
// ---------------------------------------------------------------------------

const ERC20_MIN_ABI = [
  {
    type: "function",
    name: "balanceOf",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
] as const;

export interface BuyerBalances {
  /** 18-decimal native gas-USDC */
  nativeWei: bigint;
  /** 6-decimal ERC-20 face of the SELECTED payment token */
  erc20Units: bigint;
}

export async function readBuyerBalances(
  buyer: Address,
  token: Address = USDC_ADDRESS,
): Promise<BuyerBalances> {
  const [nativeWei, erc20Units] = await Promise.all([
    publicClient.getBalance({ address: buyer }),
    publicClient.readContract({
      address: token,
      abi: ERC20_MIN_ABI,
      functionName: "balanceOf",
      args: [buyer],
    }) as Promise<bigint>,
  ]);
  return { nativeWei, erc20Units };
}
