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
import AppHeader from "../../components/dashboard/AppHeader";
import "../../styles/app.css";
import "./NewReceiptPage.css";

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

function Spinner({ className = "rc-spin" }: { className?: string }) {
  return <span className={className} aria-hidden="true" />;
}

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
    <div className="rcx rc-new">
      <Toaster theme="dark" position="bottom-right" richColors />
      <AppHeader />
      <div className="rc-new-inner">
        <Link to="/dashboard" className="rc-backlink">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M19 12H5m7-7l-7 7 7 7" />
          </svg>
          All receipts
        </Link>

        <header className="rc-new-head rcx-rise">
          <p className="rcx-eyebrow">New receipt</p>
          <h1 className="rcx-title">Open a receipt</h1>
          <p className="rcx-sub">
            Lock {tokenSymbol} against a signed delivery promise. The seller gets paid
            only if they deliver and the protection window passes — otherwise the
            money comes back to you, on-chain.
          </p>
          <p className="rcx-hint" style={{ marginTop: 8 }}>
            Takes about a minute: 3 wallet prompts (1 free signature + 2 transactions).
          </p>
        </header>

        {/* wallet */}
        <section className="rc-new-card rcx-rise" style={{ ["--rcx-i" as string]: "60ms" }} aria-label="Wallet">
          <div className="rc-new-wallet">
            {buyer ? (
              <>
                <span className="rc-wallet-dot" aria-hidden="true" />
                <p style={{ margin: 0, fontSize: 15 }}>
                  Buying as{" "}
                  <code className="rcx-mono" style={{ fontWeight: 700 }}>{shortHex(buyer)}</code>
                </p>
                <p className="rcx-hint" style={{ margin: 0, width: "100%" }}>
                  Any wallet can open a receipt — no allowlist.
                </p>
              </>
            ) : (
              <>
                <div style={{ flex: "1 1 220px" }}>
                  <p style={{ margin: "0 0 4px", fontSize: 15, fontWeight: 700 }}>Connect a wallet</p>
                  <p className="rcx-hint" style={{ margin: 0 }}>
                    MetaMask or Rabby both work. Nothing is signed until you open the receipt.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={onConnect}
                  disabled={connecting}
                  className="rcx-btn rcx-btn-primary"
                >
                  {connecting && <Spinner />}
                  {connecting ? "Connecting…" : "Connect wallet"}
                </button>
              </>
            )}
          </div>
        </section>

        {/* payment token selector — one escrow instance per token */}
        <section className="rc-new-card rcx-rise" style={{ ["--rcx-i" as string]: "110ms" }} aria-label="Payment token">
          <div className="rc-new-card-head">
            <span className="rc-new-num" aria-hidden="true">01</span>
            <div>
              <h2>Payment token</h2>
              <p>Each token has its own audited escrow instance. Pick the one the deal is priced in.</p>
            </div>
          </div>
          <div className="rc-token-opts" role="radiogroup" aria-label="Payment token">
            {(Object.keys(PAYMENT_TOKENS) as PaymentTokenSymbol[]).map((sym) => {
              const selected = sym === tokenSymbol;
              return (
                <button
                  key={sym}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  onClick={() => setTokenSymbol(sym)}
                  className={`rc-token-opt${selected ? " is-selected" : ""}`}
                >
                  <span className="rc-token-opt-icon" aria-hidden="true">
                    <TokenIcon token={sym} size={34} />
                  </span>
                  <span>
                    <span className="rc-token-opt-name">{sym}</span>
                    <span className="rc-token-opt-sub" style={{ display: "block" }}>
                      {sym === "USDC"
                        ? "USD Coin · the default escrow instance"
                        : "Euro Coin · the second production escrow"}
                    </span>
                  </span>
                  <span className="rc-token-opt-check" aria-hidden="true">
                    <svg width="12" height="12" viewBox="0 0 20 20" fill="none" stroke="#06222B" strokeWidth="3.4" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M4 10.5l4 4 8-9" />
                    </svg>
                  </span>
                </button>
              );
            })}
          </div>
        </section>

        {/* Founder order: a USDC-only user picking EURC is never stranded. */}
        {tokenSymbol === "EURC" && (
          <section className="rc-new-card rcx-rise" style={{ ["--rcx-i" as string]: "140ms" }} aria-label="Get EURC">
            <GetEurcPanel />
          </section>
        )}

        <form onSubmit={handleSubmit(onSubmit)} noValidate>
          <section className="rc-new-card rcx-rise" style={{ ["--rcx-i" as string]: "170ms" }} aria-label="Receipt details">
            <div className="rc-new-card-head">
              <span className="rc-new-num" aria-hidden="true">02</span>
              <div>
                <h2>The deal</h2>
                <p>Who gets paid, how much, for what — and by when. All four become part of the terms you sign.</p>
              </div>
            </div>

            <div className="rc-field">
              <label className="rcx-label" htmlFor="nr-seller">Seller</label>
              {!errors.seller && (
                <p className="rcx-hint">The wallet or service getting paid on delivery.</p>
              )}
              <input
                id="nr-seller"
                type="text"
                placeholder="0x…"
                autoComplete="off"
                spellCheck={false}
                className="rcx-input rcx-mono"
                {...register("seller")}
              />
              {errors.seller && (
                <p className="rcx-field-error" role="alert">
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true"><path d="M12 8v5m0 3.5v.01M10.3 3.9L2.6 17a2 2 0 001.7 3h15.4a2 2 0 001.7-3L13.7 3.9a2 2 0 00-3.4 0z" /></svg>
                  {errors.seller.message}
                </p>
              )}
              {selfBuyWarning && !errors.seller && (
                <p className="rcx-field-error" style={{ color: "#fde68a" }} role="note">{selfBuyWarning}</p>
              )}
            </div>

            <div className="rc-field">
              <label className="rcx-label" htmlFor="nr-amount">Amount</label>
              {!errors.amount && (
                <p className="rcx-hint">{tokenSymbol}. Pulled from your wallet exactly — never more.</p>
              )}
              <input
                id="nr-amount"
                type="text"
                inputMode="decimal"
                placeholder="0.5"
                autoComplete="off"
                className="rcx-input"
                {...register("amount")}
              />
              {errors.amount && (
                <p className="rcx-field-error" role="alert">
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true"><path d="M12 8v5m0 3.5v.01M10.3 3.9L2.6 17a2 2 0 001.7 3h15.4a2 2 0 001.7-3L13.7 3.9a2 2 0 00-3.4 0z" /></svg>
                  {errors.amount.message}
                </p>
              )}
              {dustWarning && !errors.amount && (
                <p className="rcx-field-error" style={{ color: "#fde68a" }} role="note">{dustWarning}</p>
              )}
            </div>

            <div className="rc-field">
              <label className="rcx-label" htmlFor="nr-desc">What are you buying?</label>
              {!errors.description && (
                <p className="rcx-hint">
                  An endpoint URL or plain description. This text goes into the terms you sign —
                  it&apos;s what the seller is held to.
                </p>
              )}
              <textarea
                id="nr-desc"
                rows={3}
                placeholder="e.g. https://api.example.com/v1/summarize — a 500-word summary of the attached document"
                className="rcx-input rcx-textarea"
                style={{ resize: "vertical" }}
                {...register("description")}
              />
              {errors.description && (
                <p className="rcx-field-error" role="alert">
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true"><path d="M12 8v5m0 3.5v.01M10.3 3.9L2.6 17a2 2 0 001.7 3h15.4a2 2 0 001.7-3L13.7 3.9a2 2 0 00-3.4 0z" /></svg>
                  {errors.description.message}
                </p>
              )}
            </div>

            <div className="rc-field">
              <label className="rcx-label" htmlFor="nr-deadline">Delivery deadline</label>
              {!errors.deadline && (
                <p className="rcx-hint">
                  If the seller hasn&apos;t delivered by then, anyone can close the receipt and your
                  {tokenSymbol} returns on-chain.
                </p>
              )}
              <input id="nr-deadline" type="datetime-local" className="rcx-input" {...register("deadline")} />
              {errors.deadline && (
                <p className="rcx-field-error" role="alert">
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true"><path d="M12 8v5m0 3.5v.01M10.3 3.9L2.6 17a2 2 0 001.7 3h15.4a2 2 0 001.7-3L13.7 3.9a2 2 0 00-3.4 0z" /></svg>
                  {errors.deadline.message}
                </p>
              )}
            </div>
          </section>

          {/* what the wallet will be asked to sign */}
          <section className="rc-new-card rcx-rise" style={{ ["--rcx-i" as string]: "200ms" }} aria-label="What your wallet will be asked to sign">
            <div className="rc-new-card-head">
              <span className="rc-new-num" aria-hidden="true">03</span>
              <div>
                <h2>What your wallet will be asked to sign</h2>
                <p>Exactly three prompts, in order. Nothing else — if a fourth appears, reject it.</p>
              </div>
            </div>
            <ol className="rc-roadmap">
              <li>
                <span className="rc-roadmap-num" aria-hidden="true">1</span>
                <div>
                  <p className="rc-roadmap-title">Sign the terms <span className="rc-roadmap-free">— free, off-chain</span></p>
                  <p className="rc-roadmap-desc">
                    Covers what you&apos;re buying, the amount ({amountLabel} {tokenSymbol}), and the deadline.
                    A signature can&apos;t move money.
                  </p>
                </div>
              </li>
              <li>
                <span className="rc-roadmap-num" aria-hidden="true">2</span>
                <div>
                  <p className="rc-roadmap-title">Approve {amountLabel} {tokenSymbol}</p>
                  <p className="rc-roadmap-desc">
                    Lets the escrow pull exactly {amountLabel} {tokenSymbol} from your wallet. On-chain,
                    manual gas limit {GAS_LIMITS.approve.toLocaleString()}.
                  </p>
                </div>
              </li>
              <li>
                <span className="rc-roadmap-num" aria-hidden="true">3</span>
                <div>
                  <p className="rc-roadmap-title">Open the receipt</p>
                  <p className="rc-roadmap-desc">
                    Locks {amountLabel} {tokenSymbol} in escrow. Sent through the Memo contract so the
                    receipt is anchored on-chain. Manual gas limit {GAS_LIMITS.authorize.toLocaleString()}.
                  </p>
                </div>
              </li>
            </ol>

            <div className="rcx-paperband" style={{ marginTop: 20 }}>
              <p className="rcx-eyebrow">Buyer protection window</p>
              <p style={{ margin: "0 0 6px", fontSize: 16, fontWeight: 800 }}>5 minutes, enforced on-chain</p>
              <p style={{ margin: 0, fontSize: 14, lineHeight: 1.6, color: "rgba(11,18,32,.72)" }}>
                After the seller says they delivered, you have 300 seconds on-chain to check
                and dispute. No dispute → the seller gets paid.
              </p>
            </div>

            <details className="rc-new-details">
              <summary>Advanced: exact transaction data</summary>
              <div className="rc-tech">
                <p>token: {tokenSymbol} ({tokenCfg.token})</p>
                <p>escrow: {tokenCfg.escrow}</p>
                <p>approve({shortHex(tokenCfg.escrow)}, {amountUnits !== null ? amountUnits.toString() : "—"} base units)</p>
                <p>
                  authorize(paymentId, termsHash, seller, amount, deadline) via
                  memo(target=escrow, …) — paymentId derived at submit time:
                </p>
                <p>
                  paymentId = keccak256(buyer ‖ seller ‖ amount ‖ termsHash ‖ blockNumber ‖ salt)
                </p>
                <p>
                  termsHash = sha256 of the canonical signed terms JSON (computed at signing).
                </p>
              </div>
            </details>
          </section>

          {/* action bar — ONE primary button per screen (§7.1) */}
          <div className="rc-new-actions">
            {gate.known && !gate.ok && (
              <div className="rcx-note rcx-note-error" role="alert">
                <p style={{ margin: "0 0 6px", fontWeight: 800 }}>Not enough balance to open this receipt.</p>
                <p style={{ margin: 0 }}>{gate.message}</p>
                {gate.shortfall && (
                  <p style={{ margin: "6px 0 0", opacity: 0.8 }}>{gate.shortfall}</p>
                )}
              </div>
            )}
            {balancesLoading && buyer && (
              <div className="rcx-note" aria-label="Checking balance" style={{ display: "grid", gap: 10 }}>
                <div className="rcx-skel" style={{ height: 14, width: "65%" }} />
                <div className="rcx-skel" style={{ height: 14, width: "48%" }} />
              </div>
            )}
            {!buyer ? (
              <>
                <button
                  type="button"
                  onClick={onConnect}
                  disabled={connecting}
                  className="rcx-btn rcx-btn-primary"
                >
                  {connecting && <Spinner />}
                  {connecting ? "Connecting…" : "Connect wallet to open receipt"}
                </button>
                <p className="rcx-hint" style={{ marginTop: 12 }}>
                  Connect a wallet first — any wallet can open a receipt.
                </p>
              </>
            ) : (
              <>
                <button
                  type="submit"
                  disabled={submitDisabled}
                  className="rcx-btn rcx-btn-primary"
                  style={{ minWidth: 220 }}
                >
                  {running && <Spinner />}
                  {running ? "Opening…" : "Open receipt"}
                </button>
                {!isValid && (
                  <p className="rcx-hint" style={{ marginTop: 12 }}>
                    Fill in the highlighted fields above to continue.
                  </p>
                )}
                {buyer && amountUnits !== null && (!gate.known || !gate.ok) && isValid && (
                  <p className="rcx-hint" style={{ marginTop: 12 }}>
                    {gate.known
                      ? "Top up the shortfall above — the button unlocks when the balance covers it."
                      : "Checking your balance…"}
                  </p>
                )}
              </>
            )}
          </div>
        </form>

        {/* progress — every state change announces itself (§7.5) */}
        {showProgress && (
          <section className="rc-new-card rcx-rise" aria-live="polite" aria-label="Progress">
            <div className="rc-new-card-head" style={{ marginBottom: 6 }}>
              <span className="rc-new-num" aria-hidden="true" style={{ borderStyle: "dashed" }}>✓</span>
              <div>
                <h2>Progress</h2>
                <p>Each step announces itself here. Done means mined on-chain — never earlier.</p>
              </div>
            </div>
            <ol className="rc-progress">
              {steps.map((s) => {
                const stateCls =
                  s.phase === "done" ? "is-done"
                  : s.phase === "error" ? "is-error"
                  : s.phase === "signing" || s.phase === "pending" ? "is-active"
                  : "";
                return (
                  <li key={s.n} className={`rc-progress-step ${stateCls}`}>
                    <span className="rc-progress-marker" aria-hidden="true">
                      {s.phase === "done" ? (
                        <svg width="14" height="14" viewBox="0 0 20 20" fill="currentColor">
                          <path fillRule="evenodd" d="M16.7 5.3a1 1 0 010 1.4l-8 8a1 1 0 01-1.4 0l-4-4a1 1 0 111.4-1.4L8 12.6l7.3-7.3a1 1 0 011.4 0z" clipRule="evenodd" />
                        </svg>
                      ) : s.phase === "signing" || s.phase === "pending" ? (
                        <Spinner />
                      ) : s.phase === "error" ? (
                        <svg width="13" height="13" viewBox="0 0 20 20" fill="currentColor">
                          <path fillRule="evenodd" d="M4.3 4.3a1 1 0 011.4 0L10 8.6l4.3-4.3a1 1 0 111.4 1.4L11.4 10l4.3 4.3a1 1 0 01-1.4 1.4L10 11.4l-4.3 4.3a1 1 0 01-1.4-1.4L8.6 10 4.3 5.7a1 1 0 010-1.4z" clipRule="evenodd" />
                        </svg>
                      ) : (
                        s.n
                      )}
                    </span>
                    <div className="rc-progress-body">
                      <p className="rc-progress-title">{s.title}</p>
                      <p className="rc-progress-desc">{s.hint}</p>
                      {s.phase === "pending" && s.txHash && (
                        <p className="rc-progress-tx is-pending">
                          Waiting for confirmation —{" "}
                          <a
                            href={explorerTxUrl(s.txHash)}
                            target="_blank"
                            rel="noreferrer"
                          >
                            {shortHex(s.txHash)} ↗
                          </a>
                        </p>
                      )}
                      {s.phase === "done" && s.txHash && (
                        <p className="rc-progress-tx">
                          <a
                            href={explorerTxUrl(s.txHash)}
                            target="_blank"
                            rel="noreferrer"
                          >
                            {shortHex(s.txHash)} ↗
                          </a>
                        </p>
                      )}
                    </div>
                  </li>
                );
              })}
            </ol>
            {fatal && (
              <div className="rcx-note rcx-note-error" style={{ marginTop: 18 }} role="alert">
                <p style={{ margin: "0 0 6px", fontWeight: 800 }}>That didn&apos;t go through.</p>
                <p style={{ margin: 0 }}>{fatal}</p>
                {paymentIdTaken && openedPaymentId && (
                  <p style={{ margin: "10px 0 0" }}>
                    <Link to={`/dashboard/r/${openedPaymentId}`} style={{ color: "#35E0FF", fontWeight: 700 }}>
                      View the existing receipt →
                    </Link>
                  </p>
                )}
                {!paymentIdTaken && (
                  <p style={{ margin: "6px 0 0", opacity: 0.8 }}>
                    Nothing was locked — only gas for mined transactions was spent. Fix the issue and try again.
                  </p>
                )}
              </div>
            )}
          </section>
        )}

        {/* trust disclosure, first screen — bible §2 learnings */}
        <p className="rc-new-fineprint">
          *What you&apos;re trusting: the seller&apos;s delivery claim is just that — a claim. Your leverage
          is the 5-minute protection window plus the permanent on-chain record. Dispute inside the
          window and anyone can close the receipt with your {tokenSymbol} returned on-chain.
        </p>
      </div>
    </div>
  );
}
