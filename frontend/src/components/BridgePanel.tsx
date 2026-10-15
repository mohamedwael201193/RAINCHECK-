/**
 * BridgePanel — the in-app CCTP "bridge out" panel (BRIDGE).
 *
 * Burns USDC on Arc via Circle's CCTP V2 TokenMessengerV2.depositForBurn
 * (7-param, selector 0x8e0250ee — proven on Arc mainnet in tx
 * 0xe519221e1c1d7b1c6225f22c1bd6bba9e76d1bb77fc467cf78fd1eace23731f1)
 * and has it minted natively on the destination chain. Two real on-chain
 * transactions, both signed by the USER'S wallet:
 *
 *   1. approve USDC -> TokenMessengerV2 (the messenger pulls the burn amount)
 *   2. depositForBurn(amount, destinationDomain, mintRecipient, USDC,
 *      bytes32(0), 0, 1000) — fast transfer, permissionless relay
 *
 * The txs go DIRECTLY to the token/messenger contracts — never through
 * the Memo contract or any wrapper, because contract-initiated CCTP burns
 * are blocked at chain level on Arc (proven with minimal test contracts).
 * Manual gas limits only (bible §9.1); F1's pipeline (eth_signTransaction
 * + own-RPC eth_sendRawTransaction). Done = mined receipt with status 1.
 *
 * EURC: the Arc TokenMessengerV2 reverts "Burn token not supported" for
 * EURC (simulated on mainnet state). EURC exits Arc through Circle's
 * CrossChainTokenService — the contract addresses are verified on Arc,
 * but the burn entry is not mainnet-proven by the team, so the EURC
 * section is honest copy + copyable addresses with NO execute button.
 * Hard rule: a button that can't execute a real, verified tx must not
 * exist.
 *
 * No mocks: disconnected -> connect prompt, everything disabled with a
 * reason. No fake quotes — there is no price here at all, just the burn.
 */

import { useEffect, useMemo, useState } from "react";
import TokenIcon from "./TokenIcon";
import ActionButton from "./ui/ActionButton";
import { AddressLink, TxLink } from "./ui/ExplorerLink";
import { useWallet } from "./dashboard/WalletContext";
import {
  ARC_CCTP_DOMAIN,
  CCTP_CROSS_CHAIN_TOKEN_SERVICE,
  CCTP_EURC_TOKEN_MANAGER,
  CCTP_TOKEN_MESSENGER_V2,
  EURC_DESTINATIONS,
  USDC_DESTINATIONS,
  buildCctpApprove,
  buildCctpBurn,
  parseBridgeAmount,
  type CctpDomain,
} from "../lib/cctp";
import { baseToUsdc, isAddress } from "../lib/tx";
import { publicClient } from "../lib/chain";
import { sendTx } from "../lib/sendTx";
import { waitForReceipt } from "../hooks/useTx";
import type { TokenSymbol } from "./TokenIcon";
import "./BridgePanel.css";

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

const USDC_TOKEN = "0x3600000000000000000000000000000000000000" as const;
const PROVEN_BURN_TX =
  "0xe519221e1c1d7b1c6225f22c1bd6bba9e76d1bb77fc467cf78fd1eace23731f1";

function CopyRow({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false);
  const onCopy = async () => {
    try {
      await navigator.clipboard.writeText(value);
    } catch {
      const ta = document.createElement("textarea");
      ta.value = value;
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
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };
  return (
    <div className="bp-copy-row">
      <code className="bp-addr" title={value}>
        {value}
      </code>
      <button
        type="button"
        className="bp-copy-btn"
        onClick={onCopy}
        aria-label={`Copy ${label} address`}
      >
        {copied ? "Copied ✓" : "Copy"}
      </button>
      <AddressLink address={value} className="bp-explorer-link" />
    </div>
  );
}

type Phase =
  | "idle"
  | "review"
  | "approving"
  | "approve-done"
  | "burning"
  | "done"
  | "error";

export default function BridgePanel() {
  const { address: wallet, connecting, connect, canSign } = useWallet();

  const [token, setToken] = useState<TokenSymbol>("USDC");
  const [amount, setAmount] = useState("0.5");
  const [amountTouched, setAmountTouched] = useState(false);
  const [domain, setDomain] = useState<number>(6);
  const [recipient, setRecipient] = useState("");
  const [recipientTouched, setRecipientTouched] = useState(false);

  const [phase, setPhase] = useState<Phase>("idle");
  const [approveHash, setApproveHash] = useState<string | null>(null);
  const [burnHash, setBurnHash] = useState<string | null>(null);
  const [execError, setExecError] = useState<string | null>(null);
  const [execTechnical, setExecTechnical] = useState<string | null>(null);
  /** null = not checked yet; true = approval leg required. */
  const [needsApproval, setNeedsApproval] = useState<boolean | null>(null);

  const domains: readonly CctpDomain[] =
    token === "USDC" ? USDC_DESTINATIONS : EURC_DESTINATIONS;

  // Default the recipient to the connected wallet.
  useEffect(() => {
    if (wallet && !recipientTouched) setRecipient(wallet);
  }, [wallet, recipientTouched]);

  // Switching tokens resets the flow and picks a valid domain.
  useEffect(() => {
    const list = token === "USDC" ? USDC_DESTINATIONS : EURC_DESTINATIONS;
    setDomain(list[0].domain);
    setPhase("idle");
    setApproveHash(null);
    setBurnHash(null);
    setExecError(null);
    setExecTechnical(null);
    setNeedsApproval(null);
  }, [token]);

  const amountBase: bigint | null = useMemo(() => {
    try {
      return parseBridgeAmount(amount);
    } catch {
      return null;
    }
  }, [amount]);
  const amountError =
    amountTouched && amountBase === null
      ? "Enter an amount like 0.5 — numbers only, up to 6 decimals."
      : null;

  const recipientValid = isAddress(recipient.trim());
  const recipientError =
    recipientTouched && !recipientValid
      ? "Enter a valid 0x EVM address for the destination chain."
      : null;

  const formValid =
    !!wallet && canSign && amountBase !== null && recipientValid;

  // Check whether the approval leg is needed (allowance already covers it).
  useEffect(() => {
    setNeedsApproval(null);
    if (phase !== "review" || !wallet || token !== "USDC" || amountBase === null)
      return;
    let cancelled = false;
    (async () => {
      try {
        const allowance = (await publicClient.readContract({
          address: USDC_TOKEN as `0x${string}`,
          abi: ERC20_ALLOWANCE_ABI,
          functionName: "allowance",
          args: [wallet, CCTP_TOKEN_MESSENGER_V2 as `0x${string}`],
        })) as bigint;
        if (!cancelled) setNeedsApproval(allowance < amountBase);
      } catch {
        if (!cancelled) setNeedsApproval(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [phase, wallet, token, amountBase]);

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

  async function executeBuilt(
    built: Parameters<typeof sendTx>[0],
    mineError: string,
  ): Promise<string> {
    if (!wallet) throw new Error("Wallet not connected.");
    const hash = await sendTx(built, { from: wallet });
    const receipt = await waitForReceipt(hash);
    if (receipt.status !== "0x1") {
      const err = new Error(mineError) as Error & { technical?: string };
      err.technical = `tx ${hash} mined with status 0 (reverted)`;
      throw err;
    }
    return hash;
  }

  const onApprove = async () => {
    if (amountBase === null) return;
    setPhase("approving");
    setExecError(null);
    try {
      const hash = await executeBuilt(
        buildCctpApprove(amountBase),
        "The approval was mined but failed on-chain. Nothing was approved.",
      );
      setApproveHash(hash);
      setPhase("approve-done");
    } catch (err) {
      fail(err);
    }
  };

  const onBurn = async () => {
    if (amountBase === null) return;
    setPhase("burning");
    setExecError(null);
    try {
      const hash = await executeBuilt(
        buildCctpBurn({
          amountBase,
          destinationDomain: domain,
          mintRecipient: recipient.trim(),
        }),
        "The burn was mined but failed on-chain. Nothing was burned.",
      );
      setBurnHash(hash);
      setPhase("done");
    } catch (err) {
      fail(err);
    }
  };

  const startOver = () => {
    setPhase("idle");
    setApproveHash(null);
    setBurnHash(null);
    setExecError(null);
    setExecTechnical(null);
    setNeedsApproval(null);
  };

  const domainName =
    domains.find((d) => d.domain === domain)?.name ?? `domain ${domain}`;
  const showApprovalStep = token === "USDC" && needsApproval === true;
  const approvalUnknown =
    token === "USDC" && phase !== "idle" && needsApproval === null;
  const approvalDone = phase === "approve-done" || phase === "done";
  const inReview =
    phase === "review" ||
    phase === "approving" ||
    phase === "approve-done" ||
    phase === "burning";

  return (
    <section className="bp" aria-labelledby="bp-title">
      <div className="bp-head">
        <p className="bp-kicker">Bridge out</p>
        <h2 id="bp-title" className="bp-title">
          Take it <span className="bp-accent">cross-chain</span>.
        </h2>
        <p className="bp-sub">
          Burn on Arc, mint natively on the destination — Circle&apos;s CCTP.
          No wrapped tokens, no liquidity pools. Two transactions, both
          signed by your wallet directly: contract-initiated burns are
          blocked at chain level on Arc, so nothing here goes through a
          contract on your behalf.
        </p>
      </div>

      {/* ------------------------------------------------ token select */}
      <div className="bp-tokens" role="group" aria-label="Token to bridge">
        {(["USDC", "EURC"] as TokenSymbol[]).map((t) => (
          <button
            key={t}
            type="button"
            className={`bp-token${token === t ? " is-active" : ""}`}
            onClick={() => setToken(t)}
            aria-pressed={token === t}
          >
            <TokenIcon token={t} size={26} />
            <span>{t}</span>
            {t === "USDC" && <span className="bp-token-tag">Live</span>}
            {t === "EURC" && <span className="bp-token-tag is-soon">Guide</span>}
          </button>
        ))}
      </div>

      {!wallet ? (
        <div className="bp-connect">
          <p>Connect your wallet to bridge. The burn signs from your address.</p>
          <ActionButton
            variant="primary"
            onClick={() => void connect().catch(() => undefined)}
            loading={connecting}
            loadingLabel="Connecting…"
          >
            Connect wallet
          </ActionButton>
        </div>
      ) : token === "EURC" ? (
        <EurcGuide />
      ) : (
        <>
          {/* -------------------------------------------------- form */}
          <div className="bp-form">
            <div className="bp-field">
              <label htmlFor="bp-amount">Amount to bridge</label>
              <div className="bp-amount-row">
                <TokenIcon token="USDC" size={28} />
                <input
                  id="bp-amount"
                  inputMode="decimal"
                  autoComplete="off"
                  placeholder="0.5"
                  value={amount}
                  onChange={(e) => {
                    setAmount(e.target.value);
                    setAmountTouched(true);
                  }}
                />
                <span className="bp-amount-sym">USDC</span>
              </div>
              {amountError && (
                <p className="bp-field-error" role="alert">
                  {amountError}
                </p>
              )}
            </div>

            <div className="bp-field">
              <label htmlFor="bp-domain">Destination chain</label>
              <select
                id="bp-domain"
                value={domain}
                onChange={(e) => setDomain(Number(e.target.value))}
                className="bp-select"
              >
                {domains.map((d) => (
                  <option key={d.domain} value={d.domain}>
                    {d.name} (domain {d.domain})
                  </option>
                ))}
              </select>
              <p className="bp-field-hint">
                Every domain listed is verified on Circle&apos;s CCTP docs —
                the messenger contract is live there.
              </p>
            </div>

            <div className="bp-field">
              <label htmlFor="bp-recipient">
                Recipient on {domainName}
              </label>
              <input
                id="bp-recipient"
                autoComplete="off"
                spellCheck={false}
                placeholder="0x…"
                value={recipient}
                onChange={(e) => {
                  setRecipient(e.target.value);
                  setRecipientTouched(true);
                }}
                className="bp-input-mono"
              />
              {recipientError && (
                <p className="bp-field-error" role="alert">
                  {recipientError}
                </p>
              )}
              <p className="bp-field-hint">
                Defaults to your connected wallet. Double-check it — a burn
                can&apos;t be undone.
              </p>
            </div>
          </div>

          {/* ------------------------------------------------ execution */}
          {phase === "idle" && (
            <div className="bp-cta">
              <ActionButton
                variant="primary"
                onClick={() => setPhase("review")}
                disabledReason={
                  !canSign
                    ? "This wallet can't sign through the app's transaction path — connect MetaMask, Rabby, or a Privy wallet with an injected provider."
                    : !formValid
                      ? "Enter a valid amount and recipient to review the bridge."
                      : null
                }
              >
                Review bridge
              </ActionButton>
            </div>
          )}

          {inReview && (
            <div className="bp-steps">
              {approvalUnknown && (
                <p className="bp-hint" aria-live="polite">
                  Checking your current approval…
                </p>
              )}

              {showApprovalStep && (
                <div className="bp-step">
                  <p className="bp-step-title">
                    Step 1 — let the messenger use your USDC
                  </p>
                  <p className="bp-step-desc">
                    Approve exactly {amountBase !== null ? baseToUsdc(amountBase) : ""} USDC
                    to the CCTP messenger. One transaction.
                  </p>
                  <details className="bp-tech">
                    <summary>Technical details</summary>
                    <p>approve(messenger, amount) on the USDC token.</p>
                    <p>
                      To: <AddressLink address={CCTP_TOKEN_MESSENGER_V2} />
                    </p>
                  </details>
                  {approvalDone ? (
                    <p className="bp-step-done">
                      Approved ✓ {approveHash && <TxLink hash={approveHash} />}
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

              <div className="bp-step">
                <p className="bp-step-title">
                  Step {showApprovalStep ? "2" : "1"} — burn on Arc
                </p>
                <p className="bp-step-desc">
                  Burn {amountBase !== null ? baseToUsdc(amountBase) : ""} USDC
                  on Arc. Circle&apos;s attestation service signs the burn
                  (usually a few minutes), then the same amount is minted to
                  your recipient on {domainName} — permissionlessly, by
                  anyone. Nothing left for you to do after this transaction
                  is mined.
                </p>
                <details className="bp-tech">
                  <summary>Technical details</summary>
                  <p>
                    depositForBurn(amount, {domain}, mintRecipient, USDC,
                    0x0, 0, 1000) on the TokenMessengerV2 — the 7-param V2
                    call, fast transfer, permissionless relay.
                  </p>
                  <p>
                    To: <AddressLink address={CCTP_TOKEN_MESSENGER_V2} />
                  </p>
                </details>
                <ActionButton
                  variant={showApprovalStep ? "outline-ice" : "primary"}
                  onClick={onBurn}
                  loading={phase === "burning"}
                  loadingLabel="Burning…"
                  disabledReason={
                    approvalUnknown
                      ? "Checking your current approval — one moment."
                      : showApprovalStep && !approvalDone
                        ? "Approve the USDC first — the burn needs that permission."
                        : null
                  }
                >
                  {showApprovalStep ? "2" : "1"} · Burn &amp; bridge
                </ActionButton>
                <p className="bp-fee-note">
                  Fast transfer: if {domainName} charges a fast-transfer fee,
                  Circle deducts it from the minted amount — you may receive
                  slightly less than you burned.
                </p>
              </div>
            </div>
          )}

          {phase === "done" && burnHash && (
            <div className="bp-done" role="status">
              <p className="bp-done-title">Burned ✓</p>
              <p>
                {amountBase !== null ? baseToUsdc(amountBase) : ""} USDC burned
                on Arc. Watch Circle&apos;s attestation, then your recipient
                on {domainName} — the mint needs no action from you.
              </p>
              <p>
                Burn: <TxLink hash={burnHash} />
              </p>
              {approveHash && (
                <p>
                  Approval: <TxLink hash={approveHash} />
                </p>
              )}
              <div className="bp-cta">
                <ActionButton variant="outline-ice" onClick={startOver}>
                  Bridge again
                </ActionButton>
              </div>
            </div>
          )}

          {phase === "error" && (
            <div className="bp-error" role="alert">
              <p>{execError ?? "The transaction didn't go through."}</p>
              {execTechnical && (
                <details className="bp-tech">
                  <summary>Technical details</summary>
                  <p>{execTechnical}</p>
                </details>
              )}
              <div className="bp-cta">
                <ActionButton variant="outline-ice" onClick={startOver}>
                  Try again
                </ActionButton>
              </div>
            </div>
          )}

          <p className="bp-proof">
            This exact call is proven on Arc mainnet —{" "}
            <TxLink hash={PROVEN_BURN_TX} /> (0.005 USDC, Arc → Base).
          </p>
        </>
      )}
    </section>
  );
}

/**
 * EURC — honest guide, no execute button. The Arc messenger reverts
 * "Burn token not supported" for EURC (simulated on mainnet state);
 * EURC exits via Circle's CrossChainTokenService, whose burn entry the
 * team hasn't mainnet-proven yet. Addresses verified on Arc mainnet.
 */
function EurcGuide() {
  return (
    <div className="bp-eurc">
      <h3>Bridging EURC out of Arc</h3>
      <p>
        EURC doesn&apos;t go through the USDC messenger — it leaves Arc
        through Circle&apos;s <strong>CrossChainTokenService</strong>, a
        different contract with its own per-token manager. We&apos;ve
        verified the contract addresses on Arc, but our team hasn&apos;t
        proven a EURC burn on mainnet yet — so there&apos;s no bridge
        button here until a dust burn proves the exact call. No button is
        better than a button that might misfire.
      </p>
      <p className="bp-eurc-routes">
        EURC CCTP routes (per Circle&apos;s September 2026 expansion):{" "}
        {EURC_DESTINATIONS.map((d) => `${d.name} (${d.domain})`).join(" · ")}.
      </p>
      <div className="bp-eurc-addrs">
        <p className="bp-eurc-label">CrossChainTokenService</p>
        <CopyRow
          value={CCTP_CROSS_CHAIN_TOKEN_SERVICE}
          label="CrossChainTokenService"
        />
        <p className="bp-eurc-label">EURC TokenManager (approve target)</p>
        <CopyRow value={CCTP_EURC_TOKEN_MANAGER} label="EURC TokenManager" />
      </div>
      <p className="bp-eurc-note">
        Arc CCTP domain: {ARC_CCTP_DOMAIN}. When the EURC leg is proven,
        it will appear here exactly like the USDC flow above.
      </p>
    </div>
  );
}
