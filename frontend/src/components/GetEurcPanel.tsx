/**
 * GetEurcPanel — the "Get EURC" panel (GETEURC).
 *
 * Three REAL paths to EURC on Arc, per the founder's order:
 *
 *   (a) SWAP — live LI.FI USDC->EURC quote on Arc 5042. The swap button
 *       renders ONLY when a live quote returned; each leg (approve, then
 *       swap) is previewed and executes exactly one real on-chain tx via
 *       F1's pipeline (eth_signTransaction + own-RPC eth_sendRawTransaction).
 *       Done = mined receipt with status 1. No route -> no button, just the
 *       plain-language line below.
 *   (b) BRIDGE — CCTP guide for EURC held on other chains. Copyable
 *       addresses + explorer links. No execute button: the source-chain
 *       wallet is out of scope (hard rule: a button that can't execute a
 *       real tx must not exist).
 *   (c) BUY — the fiat path is named (Circle Onramp Kit: card / Apple Pay /
 *       Google Pay). No button, no invented URL.
 *
 * Wiring (for INT): render <GetEurcPanel /> beside the token selector in
 * NewReceiptPage when EURC is chosen. No route of its own is needed.
 */

import { useEffect, useMemo, useState } from "react";
import TokenIcon from "./TokenIcon";
import ActionButton from "./ui/ActionButton";
import { AddressLink, TxLink } from "./ui/ExplorerLink";
import {
  LIFI_USDC_ADDRESS,
  buildSwapSteps,
  useLifiQuote,
  type LifiQuote,
  type LifiStep,
} from "../lib/lifi";
import { connectWallet, publicClient } from "../lib/chain";
import { signAndBroadcastArc, type SignerProvider } from "../lib/sendTx";
import { waitForReceipt } from "../hooks/useTx";
import { usdcToBase } from "../lib/tx";
import "./GetEurcPanel.css";

// ------------------------------------------------------------------ CCTP guide
// Addresses verified live on Arc mainnet (founder order, 2026-10-14).

const CCTP_TOKEN_MANAGER = "0x8c27579e24f9f19d96724e19fc059dacd1469e10";
const CCTP_SERVICE = "0x431871229103b780868f8C6BB820cd16ECf942BC";
const ARC_CCTP_DOMAIN = 26;

const ERC20_ALLOWANCE_ABI = [
  {
    name: "allowance",
    type: "function",
    stateMutability: "view",
    inputs: [
      { name: "owner", type: "address" },
      { name: "spender", type: "address" },
    ],
    outputs: [{ name: "", type: "uint256" }],
  },
] as const;

// ------------------------------------------------------------------ helpers

function formatEta(seconds: number): string {
  if (seconds < 60) return `about ${seconds} seconds`;
  const m = Math.round(seconds / 60);
  return m === 1 ? "about a minute" : `about ${m} minutes`;
}

function getInjectedProvider(): SignerProvider | null {
  if (typeof window === "undefined") return null;
  const eth = (window as unknown as { ethereum?: SignerProvider }).ethereum;
  return eth ?? null;
}

async function copyText(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
    return;
  } catch {
    // Clipboard API unavailable (permissions / insecure context) — fallback.
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    try {
      document.execCommand("copy");
    } finally {
      document.body.removeChild(ta);
    }
  }
}

/** Copyable address row: truncated mono address + Copy + explorer link. */
function CopyRow({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false);
  const onCopy = async () => {
    await copyText(value);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };
  return (
    <div className="gep-copy-row">
      <code className="gep-addr" title={value}>
        {value}
      </code>
      <button
        type="button"
        className="gep-copy-btn"
        onClick={onCopy}
        aria-label={`Copy ${label} address`}
      >
        {copied ? "Copied ✓" : "Copy"}
      </button>
      <AddressLink address={value} className="gep-explorer-link" />
    </div>
  );
}

// ------------------------------------------------------------------ panel

type SwapPhase =
  | "idle"
  | "review"
  | "approving"
  | "approve-done"
  | "swapping"
  | "done"
  | "error";

export default function GetEurcPanel() {
  const [wallet, setWallet] = useState<`0x${string}` | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [connectError, setConnectError] = useState<string | null>(null);

  const [amount, setAmount] = useState("0.5");
  const [amountTouched, setAmountTouched] = useState(false);

  const amountBase: string | null = useMemo(() => {
    try {
      const b = usdcToBase(amount.trim());
      return b > 0n ? b.toString() : null;
    } catch {
      return null;
    }
  }, [amount]);
  const amountError =
    amountTouched && amountBase === null
      ? "Enter an amount like 0.5 — numbers only, up to 6 decimals."
      : null;

  const { state: quoteState, refresh } = useLifiQuote({
    fromAmountBase: amountBase ?? "0",
    fromAddress: wallet,
  });

  // Swap execution state.
  const [phase, setPhase] = useState<SwapPhase>("idle");
  const [approveHash, setApproveHash] = useState<string | null>(null);
  const [swapHash, setSwapHash] = useState<string | null>(null);
  const [execError, setExecError] = useState<string | null>(null);
  const [execTechnical, setExecTechnical] = useState<string | null>(null);
  /** null = not checked yet; true = approval leg required; false = skip it. */
  const [needsApproval, setNeedsApproval] = useState<boolean | null>(null);

  const quote: LifiQuote | null =
    quoteState.status === "quote" ? quoteState.quote : null;

  const [steps, setSteps] = useState<{
    approval: LifiStep | null;
    swap: LifiStep;
  } | null>(null);

  // Fresh quote -> build the steps, reset the flow, and check whether the
  // approval leg is actually needed (allowance already covers the amount ->
  // skip it).
  useEffect(() => {
    setPhase("idle");
    setApproveHash(null);
    setSwapHash(null);
    setExecError(null);
    setExecTechnical(null);
    setNeedsApproval(null);
    setSteps(null);
    if (quoteState.status !== "quote" || !wallet) return;
    let parsed: { approval: LifiStep | null; swap: LifiStep } | null = null;
    try {
      parsed = buildSwapSteps(quoteState.quote, wallet);
    } catch (err) {
      // buildSwapSteps throws only when the route is unsafe (native value).
      setExecError(
        "This route didn't look safe, so it wasn't built. Nothing was sent.",
      );
      setExecTechnical(err instanceof Error ? err.message : String(err));
      setPhase("error");
      return;
    }
    setSteps(parsed);
    if (!parsed.approval || !quoteState.quote.approvalAddress) {
      setNeedsApproval(false);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const allowance = (await publicClient.readContract({
          address: LIFI_USDC_ADDRESS as `0x${string}`,
          abi: ERC20_ALLOWANCE_ABI,
          functionName: "allowance",
          args: [wallet, quoteState.quote.approvalAddress as `0x${string}`],
        })) as bigint;
        if (!cancelled)
          setNeedsApproval(allowance < BigInt(quoteState.quote.fromAmount));
      } catch {
        // Allowance read failed — fail open: show the approval step rather
        // than risk a swap that reverts for missing approval.
        if (!cancelled) setNeedsApproval(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [quoteState, wallet]);

  const onConnect = async () => {
    setConnecting(true);
    setConnectError(null);
    try {
      const addr = await connectWallet();
      setWallet(addr);
    } catch (err) {
      setConnectError(
        err instanceof Error ? err.message : "Couldn't connect the wallet.",
      );
    } finally {
      setConnecting(false);
    }
  };

  async function executeStep(step: LifiStep): Promise<string> {
    const provider = getInjectedProvider();
    if (!provider || !wallet)
      throw new Error("Wallet not connected. Connect it and try again.");
    const [gasPrice, nonce] = await Promise.all([
      publicClient.getGasPrice(),
      publicClient.getTransactionCount({ address: wallet }),
    ]);
    // F1's pipeline: eth_signTransaction + eth_sendRawTransaction to our own
    // Arc RPC (never eth_sendTransaction — Arc answers 401). Manual gas from
    // the LI.FI quote — never estimated.
    const hash = await signAndBroadcastArc(provider, {
      from: wallet,
      to: step.to,
      data: step.data,
      gas: step.gas,
      value: 0n,
      gasPrice,
      nonce: BigInt(nonce),
    });
    const receipt = await waitForReceipt(hash);
    if (receipt.status !== "0x1") {
      const err = new Error(
        `The ${step.kind === "approve" ? "approval" : "swap"} was mined but failed on-chain. Nothing was swapped.`,
      ) as Error & { technical?: string };
      err.technical = `tx ${hash} mined with status 0 (reverted)`;
      throw err;
    }
    return hash;
  }

  const fail = (err: unknown) => {
    const msg =
      err instanceof Error ? err.message : "The transaction didn't go through.";
    const technical =
      (err as { technical?: string })?.technical ??
      (err instanceof Error ? err.stack ?? err.message : String(err));
    setExecError(msg);
    setExecTechnical(technical);
    setPhase("error");
  };

  const onApprove = async () => {
    if (!steps?.approval) return;
    setPhase("approving");
    setExecError(null);
    try {
      const hash = await executeStep(steps.approval);
      setApproveHash(hash);
      setPhase("approve-done");
    } catch (err) {
      fail(err);
    }
  };

  const onSwap = async () => {
    if (!steps?.swap) return;
    setPhase("swapping");
    setExecError(null);
    try {
      const hash = await executeStep(steps.swap);
      setSwapHash(hash);
      setPhase("done");
    } catch (err) {
      fail(err);
    }
  };

  const startOver = () => {
    setPhase("idle");
    setApproveHash(null);
    setSwapHash(null);
    setExecError(null);
    setExecTechnical(null);
    refresh();
  };

  const showApprovalStep = needsApproval === true && steps?.approval;
  const approvalUnknown = !!steps?.approval && needsApproval === null;
  const approvalDone = phase === "approve-done" || phase === "done";

  return (
    <section className="gep" aria-labelledby="gep-title">
      <div className="gep-head">
        <p className="gep-kicker">Out of EURC?</p>
        <h2 id="gep-title" className="gep-title">
          Get <span className="gep-accent">EURC</span>.
        </h2>
        <p className="gep-sub">
          Three real ways to get EURC on Arc. Every button below either moves
          money on-chain — or tells you exactly why it can&apos;t.
        </p>
      </div>

      <div className="gep-paths">
        {/* -------------------------------------------------- (a) SWAP */}
        <div className="gep-path">
          <div className="gep-path-head">
            <span className="gep-path-num" aria-hidden="true">
              A
            </span>
            <h3>Swap USDC → EURC, right here</h3>
          </div>
          <p className="gep-path-desc">
            Live price from LI.FI on Arc. The swap button appears{" "}
            <em>only</em> when a real route exists — if there&apos;s no route,
            there is no button.
          </p>

          {!wallet ? (
            <div className="gep-connect">
              <p>Connect your wallet to get a live price for your address.</p>
              <ActionButton
                variant="primary"
                onClick={onConnect}
                loading={connecting}
                loadingLabel="Connecting…"
              >
                Connect wallet
              </ActionButton>
              {connectError && (
                <p className="gep-field-error" role="alert">
                  {connectError}
                </p>
              )}
            </div>
          ) : (
            <>
              <div className="gep-amount">
                <label htmlFor="gep-amount-input">You pay</label>
                <div className="gep-amount-row">
                  <TokenIcon token="USDC" size={28} />
                  <input
                    id="gep-amount-input"
                    inputMode="decimal"
                    autoComplete="off"
                    placeholder="0.5"
                    value={amount}
                    onChange={(e) => {
                      setAmount(e.target.value);
                      setAmountTouched(true);
                    }}
                  />
                  <span className="gep-amount-sym">USDC</span>
                </div>
                {amountError && (
                  <p className="gep-field-error" role="alert">
                    {amountError}
                  </p>
                )}
              </div>

              {quoteState.status === "loading" && (
                <div className="gep-quote" aria-live="polite">
                  <div className="rc-skel rc-skel-on-ink gep-skel" />
                  <p className="gep-quote-hint">Getting the live price…</p>
                </div>
              )}

              {quoteState.status === "quote" && quote && (
                <div className="gep-quote">
                  <div className="gep-quote-row">
                    <span className="gep-quote-label">You get about</span>
                    <span className="gep-quote-value">
                      <TokenIcon token="EURC" size={28} />
                      {quote.toAmountFormatted} EURC
                    </span>
                  </div>
                  <div className="gep-quote-meta">
                    <span className="gep-live" aria-label="Live price">
                      <span className="gep-live-dot" aria-hidden="true" />
                      Live
                    </span>
                    <span>
                      {quote.estimatedSeconds !== null
                        ? formatEta(quote.estimatedSeconds)
                        : "A few seconds"}
                    </span>
                    {quote.priceImpactPct && (
                      <span>Price impact {quote.priceImpactPct}%</span>
                    )}
                    <span>via LI.FI</span>
                  </div>

                  {phase === "idle" && steps && (
                    <div className="gep-cta">
                      <ActionButton
                        variant="primary"
                        onClick={() => setPhase("review")}
                      >
                        Review swap
                      </ActionButton>
                    </div>
                  )}

                  {(phase === "review" ||
                    phase === "approving" ||
                    phase === "approve-done" ||
                    phase === "swapping") &&
                    steps && (
                      <div className="gep-steps-exec">
                        {steps?.approval && needsApproval === null && (
                          <p className="gep-quote-hint">
                            Checking your current approval…
                          </p>
                        )}
                        {showApprovalStep && (
                          <div className="gep-step">
                            <p className="gep-step-title">
                              Step 1 — let the swap use your USDC
                            </p>
                            <p className="gep-step-desc">
                              {steps.approval!.description}. One transaction,
                              exact amount.
                            </p>
                            <details className="gep-tech">
                              <summary>Technical details</summary>
                              <p>{steps.approval!.technical}</p>
                              <p>
                                To:{" "}
                                <AddressLink address={steps.approval!.to} />
                              </p>
                            </details>
                            {approvalDone ? (
                              <p className="gep-step-done">
                                Approved ✓{" "}
                                {approveHash && <TxLink hash={approveHash} />}
                              </p>
                            ) : (
                              <ActionButton
                                variant="primary"
                                onClick={onApprove}
                                loading={phase === "approving"}
                                loadingLabel="Approving…"
                              >
                                1 · Approve USDC
                              </ActionButton>
                            )}
                          </div>
                        )}

                        <div className="gep-step">
                          <p className="gep-step-title">
                            Step {showApprovalStep ? "2" : "1"} — swap
                          </p>
                          <p className="gep-step-desc">
                            {steps.swap.description}. Done only when the
                            transaction is mined.
                          </p>
                          <details className="gep-tech">
                            <summary>Technical details</summary>
                            <p>{steps.swap.technical}</p>
                            <p>
                              To: <AddressLink address={steps.swap.to} />
                            </p>
                          </details>
                          <ActionButton
                            variant={
                              showApprovalStep ? "outline-ice" : "primary"
                            }
                            onClick={onSwap}
                            loading={phase === "swapping"}
                            loadingLabel="Swapping…"
                            disabledReason={
                              approvalUnknown
                                ? "Checking your current approval — one moment."
                                : showApprovalStep && !approvalDone
                                  ? "Approve the USDC first — the swap needs that permission."
                                  : null
                            }
                          >
                            {showApprovalStep ? "2" : "1"} · Swap USDC → EURC
                          </ActionButton>
                        </div>
                      </div>
                    )}

                  {phase === "done" && swapHash && (
                    <div className="gep-done" role="status">
                      <p className="gep-done-title">Swapped ✓</p>
                      <p>
                        {quote.fromAmountFormatted} USDC → about{" "}
                        {quote.toAmountFormatted} EURC, mined on Arc.
                      </p>
                      <p>
                        Swap: <TxLink hash={swapHash} />
                      </p>
                      {approveHash && (
                        <p>
                          Approval: <TxLink hash={approveHash} />
                        </p>
                      )}
                      <div className="gep-cta">
                        <ActionButton variant="outline-ice" onClick={startOver}>
                          Swap again
                        </ActionButton>
                      </div>
                    </div>
                  )}

                  {phase === "error" && (
                    <div className="gep-error" role="alert">
                      <p>{execError ?? "The transaction didn't go through."}</p>
                      {execTechnical && (
                        <details className="gep-tech">
                          <summary>Technical details</summary>
                          <p>{execTechnical}</p>
                        </details>
                      )}
                      <div className="gep-cta">
                        <ActionButton variant="outline-ice" onClick={startOver}>
                          Try again
                        </ActionButton>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {quoteState.status === "no-route" && (
                <div className="gep-no-route" role="status">
                  <p>
                    No swap route on Arc yet — try the bridge or buy options
                    below.
                  </p>
                </div>
              )}

              {quoteState.status === "error" && (
                <div className="gep-error" role="alert">
                  <p>{quoteState.message}</p>
                  {quoteState.retryable && (
                    <div className="gep-cta">
                      <ActionButton variant="outline-ice" onClick={refresh}>
                        Try again
                      </ActionButton>
                    </div>
                  )}
                </div>
              )}

              {quoteState.status === "idle" && !amountError && (
                <p className="gep-quote-hint">
                  Enter an amount to see the live LI.FI price.
                </p>
              )}
            </>
          )}
        </div>

        {/* ------------------------------------------------ (b) BRIDGE */}
        <div className="gep-path">
          <div className="gep-path-head">
            <span className="gep-path-num" aria-hidden="true">
              B
            </span>
            <h3>Bring EURC from another chain</h3>
          </div>
          <p className="gep-path-desc">
            Holding EURC somewhere else? Circle&apos;s CCTP moves it to Arc in
            three steps. This is a guide — the sending happens in your other
            wallet, so there&apos;s no button here.
          </p>
          <ol className="gep-guide">
            <li>
              <strong>Approve EURC to the TokenManager</strong> on the chain
              where your EURC lives.
              <CopyRow value={CCTP_TOKEN_MANAGER} label="TokenManager" />
            </li>
            <li>
              <strong>
                Call <code>crossChainTransfer</code>
              </strong>{" "}
              on the CrossChainTokenService, with Arc as the destination
              (domain {ARC_CCTP_DOMAIN}).
              <CopyRow
                value={CCTP_SERVICE}
                label="CrossChainTokenService"
              />
            </li>
            <li>
              <strong>Wait about 15 minutes.</strong> Your EURC arrives on Arc
              by itself — nothing left to do.
            </li>
          </ol>
        </div>

        {/* --------------------------------------------------- (c) BUY */}
        <div className="gep-path">
          <div className="gep-path-head">
            <span className="gep-path-num" aria-hidden="true">
              C
            </span>
            <h3>Buy with a card</h3>
          </div>
          <p className="gep-path-desc">
            Starting from cash? The fiat path is Circle&apos;s Onramp Kit —
            card, Apple Pay, or Google Pay straight into your wallet.
          </p>
          <p className="gep-path-desc">
            There&apos;s no button here on purpose: onramp availability depends
            on your region and your wallet, so use your wallet&apos;s own buy
            option.
          </p>
        </div>
      </div>
    </section>
  );
}
