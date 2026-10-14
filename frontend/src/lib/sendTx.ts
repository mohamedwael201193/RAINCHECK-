/**
 * Arc transaction transport — the TWO mandatory Arc workarounds (bible §9.1).
 *
 * Workaround #1: NEVER use eth_sendTransaction on Arc — the chain returns 401
 * (per-chain auth). Sign locally via eth_signTransaction, then broadcast the
 * raw signed tx yourself with eth_sendRawTransaction to our own RPC
 * (https://rpc.mainnet.arc.io). No fallback to eth_sendTransaction: a wallet
 * that cannot eth_signTransaction cannot transact on Arc through this app,
 * and the UI must say exactly that.
 *
 * Workaround #2: Privy's EIP-712 signing endpoint expects the typed-data
 * payload's primary-type field as snake_case `primary_type` — NOT camelCase
 * `primaryType`. Injected wallets (MetaMask/Rabby) use the standard
 * `primaryType`; the snake_case form is ONLY for Privy's endpoint.
 *
 * Also: the Memo contract REVERTS under eth_call / eth_estimateGas — every
 * transaction built here carries a MANUAL gas limit. Never eth_estimateGas.
 */

import { toHex, type Hex } from "viem";
import { CHAIN_ID, RPC_URL, publicClient } from "./chain";
import type { BuiltTx } from "./tx";

/** Minimal EIP-1193 provider surface this module needs. */
export interface SignerProvider {
  request: (args: { method: string; params?: unknown }) => Promise<unknown>;
}

/** Unsigned legacy transaction fields for eth_signTransaction. */
export interface UnsignedArcTx {
  from: `0x${string}`;
  to: `0x${string}`;
  data: Hex;
  /** Manual gas limit — never estimated (Memo reverts under estimation). */
  gas: bigint;
  value?: bigint;
  nonce?: bigint;
  gasPrice?: bigint;
}

export class ArcSignError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ArcSignError";
  }
}

export class UserRejectedError extends Error {
  constructor() {
    super("Signature rejected in wallet. Nothing was sent on-chain.");
    this.name = "UserRejectedError";
  }
}

function isUserRejection(err: unknown): boolean {
  const code = (err as { code?: number | string })?.code;
  return code === 4001 || code === "ACTION_REJECTED";
}

function isMethodMissing(err: unknown): boolean {
  const code = (err as { code?: number })?.code;
  const msg = String((err as Error)?.message ?? err);
  return (
    code === -32601 ||
    code === -32602 ||
    /method.*not.*(found|supported|available)/i.test(msg)
  );
}

/**
 * Sign via eth_signTransaction and broadcast the raw tx with
 * eth_sendRawTransaction to our own Arc RPC. Returns the tx hash.
 * Throws ArcSignError (with a UI-safe message) when the wallet does not
 * support eth_signTransaction — there is no eth_sendTransaction fallback.
 */
export async function signAndBroadcastArc(
  provider: SignerProvider,
  tx: UnsignedArcTx,
): Promise<Hex> {
  const params = [
    {
      from: tx.from,
      to: tx.to,
      data: tx.data,
      gas: toHex(tx.gas),
      value: toHex(tx.value ?? 0n),
      ...(tx.nonce !== undefined ? { nonce: toHex(tx.nonce) } : {}),
      ...(tx.gasPrice !== undefined ? { gasPrice: toHex(tx.gasPrice) } : {}),
      chainId: toHex(CHAIN_ID),
    },
  ];

  let signed: string;
  try {
    signed = (await provider.request({
      method: "eth_signTransaction",
      params,
    })) as string;
  } catch (err) {
    if (isUserRejection(err)) throw new UserRejectedError();
    if (isMethodMissing(err)) {
      throw new ArcSignError(
        "This wallet does not support eth_signTransaction, which Arc requires " +
          "(Arc rejects eth_sendTransaction with 401). Connect MetaMask, Rabby, " +
          "or a Privy embedded wallet instead.",
      );
    }
    throw err;
  }
  if (typeof signed !== "string" || !signed.startsWith("0x")) {
    throw new ArcSignError("Wallet returned an invalid signed transaction.");
  }

  let res: Response;
  try {
    res = await fetch(RPC_URL, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "eth_sendRawTransaction",
        params: [signed],
      }),
    });
  } catch (err) {
    throw new ArcSignError(
      `Could not reach the Arc RPC (${RPC_URL}): ${String(
        (err as Error)?.message ?? err,
      )}`,
    );
  }
  const json = (await res.json()) as {
    result?: Hex;
    error?: { message?: string };
  };
  if (json.error || !json.result) {
    throw new ArcSignError(
      `Broadcast rejected by Arc: ${json.error?.message ?? "no tx hash returned"}`,
    );
  }
  return json.result;
}

// ---------------------------------------------------------------------------
// F1 sendTx contract (consumed by src/hooks/useTx.ts)
// ---------------------------------------------------------------------------

function getInjectedProvider(): SignerProvider | null {
  if (typeof window === "undefined") return null;
  const eth = (window as unknown as { ethereum?: SignerProvider }).ethereum;
  return eth ?? null;
}

/**
 * F1 contract: sendTx(tx: BuiltTx) => Promise<txHash string>.
 *
 * Signs with eth_signTransaction (NEVER eth_sendTransaction — Arc answers 401,
 * bible §9.1 workaround #1) and broadcasts the raw tx to our own RPC via
 * eth_sendRawTransaction. The manual gas limit comes from the BuiltTx (Memo
 * txs revert under estimation). The signer defaults to the injected wallet;
 * pass opts.provider/opts.from for Privy embedded wallets.
 */
export async function sendTx(
  built: BuiltTx,
  opts?: { provider?: SignerProvider; from?: `0x${string}` },
): Promise<string> {
  const provider = opts?.provider ?? getInjectedProvider();
  if (!provider) {
    throw new ArcSignError(
      "No wallet found. Install MetaMask or Rabby, or connect with an embedded wallet.",
    );
  }
  let from = opts?.from;
  if (!from) {
    let accounts: string[];
    try {
      accounts = (await provider.request({
        method: "eth_requestAccounts",
      })) as string[];
    } catch (err) {
      if (isUserRejection(err)) throw new UserRejectedError();
      throw err;
    }
    if (!accounts?.[0]) {
      throw new ArcSignError("Wallet connection was rejected.");
    }
    from = accounts[0] as `0x${string}`;
  }
  const [gasPrice, nonceNumber] = await Promise.all([
    publicClient.getGasPrice(),
    publicClient.getTransactionCount({ address: from }),
  ]);
  const nonce = BigInt(nonceNumber);
  return signAndBroadcastArc(provider, {
    from,
    to: built.to,
    data: built.data,
    gas: built.gas,
    value: 0n,
    gasPrice,
    nonce,
  });
}

// ---------------------------------------------------------------------------
// EIP-712 — snake_case primary_type for Privy's endpoint (workaround #2)
// ---------------------------------------------------------------------------

export interface TypedDataField {
  name: string;
  type: string;
}

export interface SnakeCaseTypedDataInput {
  domain: Record<string, unknown>;
  types: Record<string, TypedDataField[]>;
  /** camelCase here — converted to snake_case for the Privy payload. */
  primaryType: string;
  message: Record<string, unknown>;
}

/**
 * Build the exact JSON payload Privy's EIP-712 endpoint expects:
 * identical to the standard eth_signTypedData_v4 payload except the
 * primary-type field is `primary_type` (snake_case).
 */
export function toPrivyTypedDataPayload(input: SnakeCaseTypedDataInput): string {
  return JSON.stringify({
    domain: input.domain,
    types: input.types,
    primary_type: input.primaryType,
    message: input.message,
  });
}

/**
 * Sign EIP-712 typed data through Privy's endpoint (snake_case) or an
 * injected wallet (standard camelCase `primaryType`).
 *
 * @param viaPrivy true → payload uses `primary_type` (Privy embedded wallets
 *                and Privy's signing endpoint). false → standard
 *                eth_signTypedData_v4 with `primaryType` (MetaMask/Rabby).
 */
export async function signTypedDataArc(
  provider: SignerProvider,
  address: `0x${string}`,
  input: SnakeCaseTypedDataInput,
  viaPrivy: boolean,
): Promise<Hex> {
  const payload = viaPrivy
    ? toPrivyTypedDataPayload(input)
    : JSON.stringify({
        domain: input.domain,
        types: input.types,
        primaryType: input.primaryType,
        message: input.message,
      });
  try {
    const sig = (await provider.request({
      method: "eth_signTypedData_v4",
      params: [address, payload],
    })) as string;
    if (typeof sig !== "string" || !sig.startsWith("0x")) {
      throw new ArcSignError("Wallet returned an invalid signature.");
    }
    return sig as Hex;
  } catch (err) {
    if (isUserRejection(err)) throw new UserRejectedError();
    throw err;
  }
}
