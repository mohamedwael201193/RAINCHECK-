/**
 * S2 — Open a receipt (bible §8.1). React + Vite + Tailwind.
 *
 * Default export: React.lazy-loaded by the router (route owned by F10).
 *
 * Design law applied (design-standard.md): RAINCHECK tokens
 * (#0B1220 / #35E0FF / #F4EFE6 / #F4FEFF), react-hook-form + zod as the only
 * form pattern, sonner toasts (success ONLY on mined status 1), user-words
 * vocabulary ("Open receipt", "Amount" — paymentId/termsHash live in the
 * <details> advanced area only), skeletons for loading, spinner inside the
 * button during submit, disabled-with-reason preserved.
 *
 * Flow (bible §7.1 steps 1-3), in the user's words:
 *  1. Sign the terms — free, off-chain (EIP-712, snake_case primary_type)
 *  2. Approve {amount} {token} — on-chain, manual gas
 *  3. Open the receipt — authorize(...) Memo-wrapped, manual gas
 *
 * Hard rules (bible §8.2): the submit button is disabled with the exact
 * numbers when the balance is short; pending shows the tx hash + "waiting
 * for confirmation"; "done" only on a mined receipt with status 1.
 */

import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Toaster, toast } from "sonner";
import type { Address, Hex } from "viem";
import {
  connectWallet,
  publicClient,
  shortHex,
  PAYMENT_TOKENS,
  type PaymentTokenSymbol,
} from "../../lib/chain";
import {
  buildApprove,
  buildAuthorize,
  signTerms,
  usdcToBase,
  baseToUsdc,
  explorerTxUrl,
  GAS_LIMITS,
} from "../../lib/tx";
import {
  derivePaymentId,
  randomSalt,
  signTermsWithInjected,
  sendTxShim,
  waitForMinedStatus1,
  readBuyerBalances,
} from "./newReceiptFlow";
import TokenIcon from "../../components/TokenIcon";
import GetEurcPanel from "../../components/GetEurcPanel";

// ---------------------------------------------------------------------------
// Form schema — react-hook-form + zod is the ONLY form pattern (§6).
// One input = one fact; a field is required only if the purpose fails
// without it (all four are required: no terms, no receipt).
// ---------------------------------------------------------------------------

const schema = z.object({
  seller: z
    .string()
    .trim()
    .regex(/^0x[0-9a-fA-F]{40}$/, {
      message: "Enter a valid seller address: 0x followed by 40 hex characters.",
    }),
  amount: z
    .string()
    .trim()
    .regex(/^\d+(\.\d{1,6})?$/, {
      message: "Enter an amount like 0.5 (up to 6 decimals).",
    })
    .refine(
      (s) => {
        try {
          return usdcToBase(s) > 0n;
        } catch {
          return false;
        }
      },
      { message: "Amount must be greater than zero." },
    ),
  description: z
    .string()
    .trim()
    .min(1, {
      message: "Describe what you're buying — it becomes part of the signed terms.",
    }),
  deadline: z
    .string()
    .min(1, { message: "Pick a delivery deadline." })
    .refine(
      (s) => {
        const t = new Date(s).getTime();
        return !Number.isNaN(t) && t > Date.now() + 120_000;
      },
      {
        message:
          "Pick a deadline at least 2 minutes in the future, so it's still future when the transaction is mined.",
      },
    ),
});

type FormValues = z.infer<typeof schema>;

function defaultDeadline(): string {
  const d = new Date(Date.now() + 24 * 3600 * 1000);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** 18-decimal native wei -> "0.0074" style display string. */
function formatUsdc18(wei: bigint): string {
  const neg = wei < 0n;
  const abs = neg ? -wei : wei;
  const whole = abs / 1_000_000_000_000_000_000n;
  const frac = (abs % 1_000_000_000_000_000_000n)
    .toString()
    .padStart(18, "0")
    .slice(0, 6)
    .replace(/0+$/, "");
  return `${neg ? "-" : ""}${whole.toString()}${frac ? "." + frac : ""}`;
}

// ---------------------------------------------------------------------------
// Progress steps (user words; hashes stay in the advanced area)
// ---------------------------------------------------------------------------

type Phase = "idle" | "signing" | "pending" | "done" | "error";

interface Step {
  n: 1 | 2 | 3;
  title: string;
  hint: string;
  phase: Phase;
  txHash?: Hex;
}

function freshSteps(amountLabel: string, symbol: string): Step[] {
  return [
    {
      n: 1,
      title: "Sign the terms",
      hint: "Free, off-chain. Your signature covers what you're buying, the amount, and the deadline — it can't move money.",
      phase: "idle",
    },
    {
      n: 2,
      title: `Approve ${amountLabel} ${symbol}`,
      hint: `Lets the escrow pull exactly ${amountLabel} ${symbol} from your wallet. Manual gas limit ${GAS_LIMITS.approve.toLocaleString()}.`,
      phase: "idle",
    },
    {
      n: 3,
      title: "Open the receipt",
      hint: `Locks ${amountLabel} ${symbol} in escrow. Sent through the Memo contract so the receipt is anchored on-chain. Manual gas limit ${GAS_LIMITS.authorize.toLocaleString()}.`,
      phase: "idle",
    },
  ];
}

function Spinner({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg className={`${className} animate-spin`} viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-90" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
    </svg>
  );
}

function Skeleton({ className = "" }: { className?: string }) {
  return <div className={`animate-pulse rounded bg-white/10 ${className}`} aria-hidden />;
}

const inputCls =
  "mt-1 block w-full rounded-lg border border-white/15 bg-white/5 px-3 py-2.5 text-[15px] text-[#F4FEFF] placeholder:text-[#F4FEFF]/30 focus:border-[#35E0FF] focus:outline-none focus:ring-1 focus:ring-[#35E0FF]";
const labelCls = "block text-[15px] font-medium text-[#F4FEFF]";
const errCls = "mt-1 text-sm text-red-400";
const hintCls = "mt-1 text-[13px] leading-5 text-[#F4FEFF]/55";

export default function NewReceiptPage() {
  const navigate = useNavigate();

  // The 256-bit salt is half of the "block-ish nonce" in the paymentId
  // scheme (see newReceiptFlow.ts) — fresh per page load.
  const [salt] = useState<Hex>(() => randomSalt());

  // Multi-asset: one escrow instance per payment token. USDC is the default;
  // the selector below switches the escrow + ERC-20 token for every step.
  const [tokenSymbol, setTokenSymbol] = useState<PaymentTokenSymbol>("USDC");
  const tokenCfg = PAYMENT_TOKENS[tokenSymbol];

  const [buyer, setBuyer] = useState<Address | null>(null);
  const [connecting, setConnecting] = useState(false);

  const {
    register,
    handleSubmit,
    watch,
    formState: { errors, isValid },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    mode: "onTouched",
    defaultValues: {
      seller: "",
      amount: "",
      description: "",
      deadline: defaultDeadline(),
    },
  });

  const sellerVal = watch("seller");
  const amountVal = watch("amount");

  const amountUnits: bigint | null = useMemo(() => {
    try {
      const u = usdcToBase(amountVal.trim());
      return u > 0n ? u : null;
    } catch {
      return null;
    }
  }, [amountVal]);

  const amountLabel = amountUnits !== null ? baseToUsdc(amountUnits) : "—";

  // Warn (never block) below 0.01 USDC — bible §8.1 S2.
  const dustWarning =
    amountUnits !== null && amountUnits < 10_000n
      ? `Heads up: below 0.01 ${tokenSymbol}. Gas will cost more than the receipt itself — fine for testing, just so you know.`
      : null;
  const selfBuyWarning =
    buyer && sellerVal.trim() && sellerVal.trim().toLowerCase() === buyer.toLowerCase()
      ? "The seller is your own wallet — you'd be buying from yourself."
      : null;

  // ---- balances + the capability gate ----
  const [balances, setBalances] = useState<{
    nativeWei: bigint;
    erc20Units: bigint;
    gasPriceWei: bigint;
  } | null>(null);
  const [balancesLoading, setBalancesLoading] = useState(false);

  useEffect(() => {
    if (!buyer || amountUnits === null) {
      setBalances(null);
      return;
    }
    let cancelled = false;
    setBalancesLoading(true);
    const t = setTimeout(() => {
      Promise.all([readBuyerBalances(buyer, tokenCfg.token), publicClient.getGasPrice()])
        .then(([b, gasPriceWei]) => {
          if (!cancelled) setBalances({ ...b, gasPriceWei });
        })
        .catch(() => {
          if (!cancelled) setBalances(null);
        })
        .finally(() => {
          if (!cancelled) setBalancesLoading(false);
        });
    }, 350);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [buyer, amountUnits, tokenCfg.token]);

  // Bible §8.2 exact format, adapted for multi-asset: the receipt leg is in
  // the SELECTED token and gas is always native USDC — the two are never
  // summed into one number (different assets). Each leg states its own token.
  const gate = useMemo(() => {
    if (!buyer || !balances || amountUnits === null)
      return { known: false as const, ok: false, message: null as string | null, shortfall: null as string | null };
    const gasUnits = GAS_LIMITS.approve + GAS_LIMITS.authorize;
    const gasCostWei = gasUnits * balances.gasPriceWei;
    const erc20Ok = balances.erc20Units >= amountUnits;
    const gasOk = balances.nativeWei >= gasCostWei;
    const ok = erc20Ok && gasOk;
    if (ok) return { known: true as const, ok, message: null, shortfall: null };
    const y = baseToUsdc(amountUnits);
    const z = formatUsdc18(gasCostWei);
    const legs: string[] = [];
    if (!erc20Ok)
      legs.push(`not enough ${tokenSymbol} for the receipt itself (need ${y}, hold ${baseToUsdc(balances.erc20Units)})`);
    if (!gasOk)
      legs.push(`not enough USDC for gas (need about ${z}, hold ${formatUsdc18(balances.nativeWei)})`);
    return {
      known: true as const,
      ok,
      message: `You need ${y} ${tokenSymbol} for the receipt + about ${z} USDC for gas. Your balance: ${baseToUsdc(balances.erc20Units)} ${tokenSymbol}, ${formatUsdc18(balances.nativeWei)} USDC for gas.`,
      shortfall: legs.join("; "),
    };
  }, [buyer, balances, amountUnits, tokenSymbol]);

  // ---- submit ----
  const [steps, setSteps] = useState<Step[]>(() => freshSteps("—", tokenSymbol));
  const [running, setRunning] = useState(false);
  const [fatal, setFatal] = useState<string | null>(null);
  const [openedPaymentId, setOpenedPaymentId] = useState<Hex | null>(null);

  const setPhase = (n: 1 | 2 | 3, phase: Phase, txHash?: Hex) =>
    setSteps((prev) => prev.map((s) => (s.n === n ? { ...s, phase, txHash } : s)));

  const onConnect = async () => {
    setConnecting(true);
    try {
      const addr = await connectWallet();
      setBuyer(addr);
      toast.success("Wallet connected");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Wallet connection failed.");
    } finally {
      setConnecting(false);
    }
  };

  const onSubmit = async (values: FormValues) => {
    if (!buyer) return;
    const amount = usdcToBase(values.amount.trim());
    const seller = values.seller.trim() as Address;
    const deadline = BigInt(Math.floor(new Date(values.deadline).getTime() / 1000));
    setRunning(true);
    setFatal(null);
    setOpenedPaymentId(null);
    setSteps(freshSteps(baseToUsdc(amount), tokenSymbol));

    try {
      // 1 — Sign the terms (free, off-chain). termsHash = sha256(canonical
      // terms JSON) per F8's signTerms; the signature binds it to the buyer.
      // The EIP-712 domain names the SELECTED escrow instance (multi-asset).
      const { typedData, termsHash } = signTerms(
        {
          buyer,
          seller,
          endpoint: values.description.trim(),
          price: amount,
          deadline,
        },
        tokenCfg.escrow,
      );
      setPhase(1, "signing");
      await signTermsWithInjected(buyer, typedData);
      setPhase(1, "done");

      // 2 — Approve the escrow pull (Memo-wrapped, manual gas): the selected
      // payment token, spender = the selected escrow instance.
      const approveTx = buildApprove(amount, {
        token: tokenCfg.token,
        escrow: tokenCfg.escrow,
      });
      setPhase(2, "signing");
      const approveHash = await sendTxShim(approveTx, buyer);
      setPhase(2, "pending", approveHash);
      await waitForMinedStatus1(approveHash);
      setPhase(2, "done", approveHash);

      // 3 — Open the receipt: authorize(...) Memo-wrapped, manual gas.
      // The paymentId is derived here from the freshest block number.
      const blockNumber = await publicClient.getBlockNumber();
      const paymentId = derivePaymentId({
        buyer,
        seller,
        amount,
        termsHash,
        blockNumber,
        salt,
      });
      setOpenedPaymentId(paymentId);
      const authTx = buildAuthorize(
        paymentId,
        termsHash,
        seller,
        amount,
        deadline,
        tokenCfg.escrow,
      );
      setPhase(3, "signing");
      const authHash = await sendTxShim(authTx, buyer);
      setPhase(3, "pending", authHash);
      await waitForMinedStatus1(authHash);
      setPhase(3, "done", authHash);

      // Success ONLY on the mined status-1 receipt above — never earlier.
      toast.success("Receipt opened — redirecting…");
      navigate(`/dashboard/r/${paymentId}`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Something went wrong.";
      setFatal(msg);
      toast.error(msg);
      setSteps((prev) =>
        prev.map((s) => (s.phase === "signing" || s.phase === "pending" ? { ...s, phase: "error" } : s)),
      );
    } finally {
      setRunning(false);
    }
  };

  const submitDisabled =
    running ||
    !isValid ||
    // The balance gate must have answered before the button enables:
    // a fast click before the check completes must never bypass it.
    (buyer !== null && amountUnits !== null && (!gate.known || !gate.ok));
  const showProgress = running || steps.some((s) => s.phase !== "idle");
  const paymentIdTaken =
    openedPaymentId !== null &&
    fatal !== null &&
    /already (used|taken)/i.test(fatal);

  return (
    <div className="min-h-screen bg-[#0B1220] text-[#F4FEFF]">
      <Toaster theme="dark" position="bottom-right" richColors />
      <div className="mx-auto max-w-3xl px-4 py-8 sm:px-6">
        <Link to="/dashboard" className="text-sm text-[#35E0FF] hover:underline">
          ← All receipts
        </Link>
        <h1 className="mt-3 text-3xl font-extrabold tracking-tight">
          Open a receipt
        </h1>
        <p className="mt-2 max-w-[60ch] text-[16px] leading-6 text-[#F4FEFF]/65">
          Lock {tokenSymbol} against a signed delivery promise. The seller gets paid
          only if they deliver and the protection window passes — otherwise the
          money comes back to you, on-chain.
        </p>
        <p className="mt-1 text-[13px] text-[#F4FEFF]/45">
          Takes about a minute: 3 wallet prompts (1 free signature + 2 transactions).
        </p>

        {/* wallet */}
        <div className="mt-6 rounded-xl border border-white/10 bg-white/[0.03] p-4">
          {buyer ? (
            <p className="text-sm text-[#F4FEFF]/80">
              Buying as <code className="font-mono text-[#35E0FF]">{shortHex(buyer)}</code>
              <span className="ml-2 text-[#F4FEFF]/45">Any wallet can open a receipt — no allowlist.</span>
            </p>
          ) : (
            <p className="text-sm text-[#F4FEFF]/60">
              Connect a wallet to open a receipt. MetaMask or Rabby both work.
            </p>
          )}
        </div>

        {/* payment token selector — one escrow instance per token */}
        <div className="mt-6 rounded-xl border border-white/10 bg-white/[0.03] p-4">
          <p className={labelCls}>Payment token</p>
          <div className="mt-2 flex gap-2" role="radiogroup" aria-label="Payment token">
            {(Object.keys(PAYMENT_TOKENS) as PaymentTokenSymbol[]).map((sym) => {
              const selected = sym === tokenSymbol;
              return (
                <button
                  key={sym}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  onClick={() => setTokenSymbol(sym)}
                  className={`inline-flex min-h-[44px] items-center gap-2 rounded-lg border px-5 py-2 text-[15px] font-bold ${
                    selected
                      ? "border-[#35E0FF] bg-[#35E0FF]/15 text-[#35E0FF]"
                      : "border-white/15 bg-white/5 text-[#F4FEFF]/70 hover:border-white/30"
                  }`}
                >
                  <TokenIcon token={sym} size={22} />
                  {sym}
                </button>
              );
            })}
          </div>
          <p className={hintCls}>
            {tokenSymbol === "USDC"
              ? "USDC — the default escrow instance."
              : "EURC — the second production escrow instance (same audited contract, EURC token only)."}
          </p>
        </div>

        {/* Founder order: a USDC-only user picking EURC is never stranded. */}
        {tokenSymbol === "EURC" && (
          <div className="mt-4">
            <GetEurcPanel />
          </div>
        )}

        <form onSubmit={handleSubmit(onSubmit)} noValidate>
          <div className="mt-6 rounded-xl border border-white/10 bg-white/[0.03] p-5 sm:p-6">
            <label className={labelCls} htmlFor="nr-seller">
              Seller
              <input
                id="nr-seller"
                type="text"
                placeholder="0x…"
                autoComplete="off"
                spellCheck={false}
                className={`${inputCls} font-mono`}
                {...register("seller")}
              />
            </label>
            {errors.seller ? (
              <p className={errCls}>{errors.seller.message}</p>
            ) : (
              <p className={hintCls}>The wallet or service getting paid on delivery.</p>
            )}
            {selfBuyWarning && !errors.seller && (
              <p className="mt-1 text-sm text-amber-300">{selfBuyWarning}</p>
            )}

            <label className={`${labelCls} mt-5`} htmlFor="nr-amount">
              Amount
              <input
                id="nr-amount"
                type="text"
                inputMode="decimal"
                placeholder="0.5"
                autoComplete="off"
                className={inputCls}
                {...register("amount")}
              />
            </label>
            {errors.amount ? (
              <p className={errCls}>{errors.amount.message}</p>
            ) : (
              <p className={hintCls}>{tokenSymbol}. Pulled from your wallet exactly — never more.</p>
            )}
            {dustWarning && !errors.amount && (
              <p className="mt-1 text-sm text-amber-300">{dustWarning}</p>
            )}

            <label className={`${labelCls} mt-5`} htmlFor="nr-desc">
              What are you buying?
              <textarea
                id="nr-desc"
                rows={3}
                placeholder="e.g. https://api.example.com/v1/summarize — a 500-word summary of the attached document"
                className={`${inputCls} resize-y`}
                {...register("description")}
              />
            </label>
            {errors.description ? (
              <p className={errCls}>{errors.description.message}</p>
            ) : (
              <p className={hintCls}>
                An endpoint URL or plain description. This text goes into the terms you sign —
                it's what the seller is held to.
              </p>
            )}

            <label className={`${labelCls} mt-5`} htmlFor="nr-deadline">
              Delivery deadline
              <input id="nr-deadline" type="datetime-local" className={inputCls} {...register("deadline")} />
            </label>
            {errors.deadline ? (
              <p className={errCls}>{errors.deadline.message}</p>
            ) : (
              <p className={hintCls}>
                If the seller hasn't delivered by then, anyone can close the receipt and your
                {tokenSymbol} returns on-chain.
              </p>
            )}
          </div>

          {/* what the wallet will be asked to sign */}
          <div className="mt-6 rounded-xl border border-white/10 bg-white/[0.03] p-5 sm:p-6">
            <h2 className="text-lg font-bold">What your wallet will be asked to sign</h2>
            <p className={hintCls}>Exactly three prompts, in order. Nothing else.</p>
            <ol className="mt-4 space-y-3">
              <li className="rounded-lg bg-white/[0.04] p-3.5">
                <p className="text-[15px] font-semibold">
                  <span className="mr-2 inline-flex h-6 w-6 items-center justify-center rounded-full bg-[#35E0FF]/15 text-[13px] font-bold text-[#35E0FF]">1</span>
                  Sign the terms <span className="font-normal text-[#F4FEFF]/50">— free, off-chain</span>
                </p>
                <p className="mt-1.5 pl-8 text-[13px] leading-5 text-[#F4FEFF]/55">
                  Covers what you're buying, the amount ({amountLabel} {tokenSymbol}), and the deadline.
                  A signature can't move money.
                </p>
              </li>
              <li className="rounded-lg bg-white/[0.04] p-3.5">
                <p className="text-[15px] font-semibold">
                  <span className="mr-2 inline-flex h-6 w-6 items-center justify-center rounded-full bg-[#35E0FF]/15 text-[13px] font-bold text-[#35E0FF]">2</span>
                  Approve {amountLabel} {tokenSymbol}
                </p>
                <p className="mt-1.5 pl-8 text-[13px] leading-5 text-[#F4FEFF]/55">
                  Lets the escrow pull exactly {amountLabel} {tokenSymbol} from your wallet. On-chain,
                  manual gas limit {GAS_LIMITS.approve.toLocaleString()}.
                </p>
              </li>
              <li className="rounded-lg bg-white/[0.04] p-3.5">
                <p className="text-[15px] font-semibold">
                  <span className="mr-2 inline-flex h-6 w-6 items-center justify-center rounded-full bg-[#35E0FF]/15 text-[13px] font-bold text-[#35E0FF]">3</span>
                  Open the receipt
                </p>
                <p className="mt-1.5 pl-8 text-[13px] leading-5 text-[#F4FEFF]/55">
                  Locks {amountLabel} {tokenSymbol} in escrow. Sent through the Memo contract so the
                  receipt is anchored on-chain. Manual gas limit {GAS_LIMITS.authorize.toLocaleString()}.
                </p>
              </li>
            </ol>

            <div className="mt-4 rounded-lg bg-[#F4EFE6] p-3.5 text-[#0B1220]">
              <p className="text-sm font-semibold">Buyer protection window: 5 minutes</p>
              <p className="mt-0.5 text-[13px] leading-5">
                After the seller says they delivered, you have 300 seconds on-chain to check
                and dispute. No dispute → the seller gets paid.
              </p>
            </div>

            <details className="mt-4 text-[13px] text-[#F4FEFF]/55">
              <summary className="cursor-pointer font-medium text-[#F4FEFF]/75">
                Advanced: exact transaction data
              </summary>
              <div className="mt-2 space-y-1.5 font-mono text-[12px] break-all">
                <p>token: {tokenSymbol} ({tokenCfg.token})</p>
                <p>escrow: {tokenCfg.escrow}</p>
                <p>approve({shortHex(tokenCfg.escrow)}, {amountUnits !== null ? amountUnits.toString() : "—"} base units)</p>
                <p>
                  authorize(paymentId, termsHash, seller, amount, deadline) via
                  memo(target=escrow, …) — paymentId derived at submit time:
                </p>
                <p className="text-[#F4FEFF]/40">
                  paymentId = keccak256(buyer ‖ seller ‖ amount ‖ termsHash ‖ blockNumber ‖ salt)
                </p>
                <p className="text-[#F4FEFF]/40">
                  termsHash = sha256 of the canonical signed terms JSON (computed at signing).
                </p>
              </div>
            </details>
          </div>

          {/* action bar — ONE primary button per screen (§7.1) */}
          <div className="mt-6">
            {gate.known && !gate.ok && (
              <div className="mb-3 rounded-lg border border-red-400/30 bg-red-400/10 p-3.5" role="alert">
                <p className="text-sm font-medium text-red-300">{gate.message}</p>
                {gate.shortfall && (
                  <p className="mt-1 text-[13px] text-[#F4FEFF]/55">{gate.shortfall}</p>
                )}
              </div>
            )}
            {balancesLoading && buyer && (
              <div className="mb-3 space-y-2" aria-label="Checking balance">
                <Skeleton className="h-4 w-2/3" />
                <Skeleton className="h-4 w-1/2" />
              </div>
            )}
            {!buyer ? (
              <button
                type="button"
                onClick={onConnect}
                disabled={connecting}
                className="inline-flex min-h-[44px] items-center gap-2 rounded-lg bg-[#35E0FF] px-6 py-2.5 text-[15px] font-bold text-[#0B1220] disabled:opacity-50"
              >
                {connecting && <Spinner />}
                {connecting ? "Connecting…" : "Connect wallet"}
              </button>
            ) : (
              <button
                type="submit"
                disabled={submitDisabled}
                className="inline-flex min-h-[44px] items-center gap-2 rounded-lg bg-[#35E0FF] px-6 py-2.5 text-[15px] font-bold text-[#0B1220] disabled:cursor-not-allowed disabled:opacity-40"
              >
                {running && <Spinner />}
                {running ? "Opening…" : "Open receipt"}
              </button>
            )}
            {!buyer && (
              <p className="mt-2 text-sm text-[#F4FEFF]/50">
                Connect a wallet first — any wallet can open a receipt.
              </p>
            )}
            {buyer && !isValid && (
              <p className="mt-2 text-sm text-[#F4FEFF]/50">
                Fill in the highlighted fields above to continue.
              </p>
            )}
          </div>
        </form>

        {/* progress — every state change announces itself (§7.5) */}
        {showProgress && (
          <div className="mt-6 rounded-xl border border-white/10 bg-white/[0.03] p-5 sm:p-6" aria-live="polite">
            <h2 className="text-lg font-bold">Progress</h2>
            <ol className="mt-4 space-y-4">
              {steps.map((s) => (
                <li key={s.n} className="flex gap-3">
                  <span
                    className={`mt-0.5 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[13px] font-bold ${
                      s.phase === "done"
                        ? "bg-[#35E0FF]/20 text-[#35E0FF]"
                        : s.phase === "error"
                          ? "bg-red-400/20 text-red-300"
                          : "bg-white/10 text-[#F4FEFF]/60"
                    }`}
                    aria-hidden
                  >
                    {s.phase === "done" ? (
                      <svg className="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor">
                        <path fillRule="evenodd" d="M16.7 5.3a1 1 0 010 1.4l-8 8a1 1 0 01-1.4 0l-4-4a1 1 0 111.4-1.4L8 12.6l7.3-7.3a1 1 0 011.4 0z" clipRule="evenodd" />
                      </svg>
                    ) : s.phase === "signing" || s.phase === "pending" ? (
                      <Spinner className="h-3.5 w-3.5" />
                    ) : s.phase === "error" ? (
                      <svg className="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor">
                        <path fillRule="evenodd" d="M4.3 4.3a1 1 0 011.4 0L10 8.6l4.3-4.3a1 1 0 111.4 1.4L11.4 10l4.3 4.3a1 1 0 01-1.4 1.4L10 11.4l-4.3 4.3a1 1 0 01-1.4-1.4L8.6 10 4.3 5.7a1 1 0 010-1.4z" clipRule="evenodd" />
                      </svg>
                    ) : (
                      s.n
                    )}
                  </span>
                  <div className="min-w-0">
                    <p className="text-[15px] font-semibold">{s.title}</p>
                    <p className="text-[13px] leading-5 text-[#F4FEFF]/55">{s.hint}</p>
                    {s.phase === "pending" && s.txHash && (
                      <p className="mt-1 text-[13px] text-amber-300">
                        Waiting for confirmation —{" "}
                        <a
                          href={explorerTxUrl(s.txHash)}
                          target="_blank"
                          rel="noreferrer"
                          className="font-mono underline"
                        >
                          {shortHex(s.txHash)}
                        </a>
                      </p>
                    )}
                    {s.phase === "done" && s.txHash && (
                      <p className="mt-1 text-[13px]">
                        <a
                          href={explorerTxUrl(s.txHash)}
                          target="_blank"
                          rel="noreferrer"
                          className="font-mono text-[#35E0FF] underline"
                        >
                          {shortHex(s.txHash)}
                        </a>
                      </p>
                    )}
                  </div>
                </li>
              ))}
            </ol>
            {fatal && (
              <div className="mt-4 rounded-lg border border-red-400/30 bg-red-400/10 p-3.5" role="alert">
                <p className="text-sm text-red-300">{fatal}</p>
                {paymentIdTaken && openedPaymentId && (
                  <p className="mt-2 text-sm">
                    <Link to={`/dashboard/r/${openedPaymentId}`} className="font-medium text-[#35E0FF] underline">
                      View the existing receipt
                    </Link>
                  </p>
                )}
                {!paymentIdTaken && (
                  <p className="mt-1 text-[13px] text-[#F4FEFF]/55">
                    Nothing was locked — only gas for mined transactions was spent. Fix the issue and try again.
                  </p>
                )}
              </div>
            )}
          </div>
        )}

        {/* trust disclosure, first screen — bible §2 learnings */}
        <p className="mt-6 max-w-[60ch] text-[13px] leading-5 text-[#F4FEFF]/45">
          *What you're trusting: the seller's delivery claim is just that — a claim. Your leverage
          is the 5-minute protection window plus the permanent on-chain record. Dispute inside the
          window and anyone can close the receipt with your {tokenSymbol} returned on-chain.
        </p>
      </div>
    </div>
  );
}
