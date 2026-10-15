// E2E-V2: mainnet dust tests for RaincheckEscrowV2 (experimental).
// Deployer = buyer = seller. Dust 0.01 USDC principal per path.
// Calldata built ONLY via frontend/src/lib/tx.ts builders (Memo-wrapped) —
// the SAME builders the UI calls (buildAuthorizeV2 for the 7-param authorize).
// Manual gas limits from the builders; NEVER eth_estimateGas.
// One retry max on transient RPC failure; never on reverts.
//
// Paths:
//   T1: authorize(7-param + policyRef) -> attest -> capture (happy)
//   T2: authorize -> attest -> flag -> void (dispute: disputes(seller) +1)
//   T3: authorize(short deadline) -> voidAfterDeadline (disputes unchanged)
import { ethers } from 'ethers';
import { readFileSync, writeFileSync } from 'fs';
import * as tx from '/home/hatch/workspace/raincheck-build/frontend/src/lib/tx.ts';

const EXPECTED = '0xf76e6B0920e9332fF4410f6dD53F01722AbC71a3';
const V2 = ethers.getAddress(tx.V2_ESCROW_ADDRESS.toLowerCase()); // 0x3795b865f7fc84a14ab60456be9fc6dd0cb56f0c
const MEMO = ethers.getAddress(tx.MEMO_ADDRESS.toLowerCase());
const USDC = ethers.getAddress(tx.USDC_ADDRESS.toLowerCase());
const RPC = 'https://rpc.mainnet.arc.io';
const EXPLORER = 'https://explorer.arc.io';
const AMOUNT = 10000n;                   // 0.01 USDC (6 decimals)
const STATUS = ['NONE', 'OPEN', 'ATTESTED', 'CAPTURED', 'VOIDED', 'FLAGGED'];
const EVIDENCE = '/home/hatch/workspace/raincheck-build/evidence/e2e-v2.json';
const CHALLENGE_WINDOW = 300;

// --- key (NEVER logged) ---
const env = readFileSync('/home/hatch/workspace/user/files/env-3.txt', 'utf8');
const KEY = env.split('\n').find(l => l.startsWith('DEPLOYER_PRIVATE_KEY=')).split('=')[1].trim();
const wallet = new ethers.Wallet(KEY);
if (wallet.address.toLowerCase() !== EXPECTED.toLowerCase()) {
  console.error('FATAL: derived address mismatch — aborting');
  process.exit(1);
}
const DEPLOYER = wallet.address;

const provider = new ethers.JsonRpcProvider(RPC);
const rpc = (m, p) => provider.send(m, p);
const sleep = ms => new Promise(r => setTimeout(r, ms));

const txs = [];
let gasTotal = 0n, costTotal = 0n;

async function feeParams() {
  const [blk, prio] = await Promise.all([
    provider.getBlock('latest'),
    rpc('eth_maxPriorityFeePerGas', []).then(h => BigInt(h)).catch(() => 1000000000n),
  ]);
  const base = blk.baseFeePerGas;
  return { maxFeePerGas: 2n * base + prio, maxPriorityFeePerGas: prio };
}

async function waitReceipt(hash, timeoutMs = 180000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    const r = await rpc('eth_getTransactionReceipt', [hash]).catch(() => null);
    if (r && r.blockNumber) return r;
    await sleep(3000);
  }
  throw new Error(`receipt timeout for ${hash}`);
}

// Broadcast a builder-produced tx. Retries ONCE on transient RPC failure only.
async function broadcast(built, label, proof) {
  const fees = await feeParams();
  const attempt = async () => {
    const nonce = await provider.getTransactionCount(DEPLOYER, 'pending');
    const raw = await wallet.signTransaction({
      to: built.to, data: built.data, gasLimit: built.gas,
      chainId: 5042, nonce, value: 0, ...fees,
    });
    const hash = await rpc('eth_sendRawTransaction', [raw]);
    return { hash, nonce };
  };
  let sent, lastErr;
  for (let i = 0; i < 2; i++) {
    try { sent = await attempt(); break; }
    catch (e) { lastErr = e; console.log(`  [${label}] send attempt ${i + 1} failed: ${String(e.message || e).slice(0, 120)}`); await sleep(3000); }
  }
  if (!sent) throw new Error(`broadcast failed twice for ${label}: ${String(lastErr).slice(0, 200)}`);

  const receipt = await waitReceipt(sent.hash);
  const gasUsed = BigInt(receipt.gasUsed);
  const eff = BigInt(receipt.gasPrice ?? receipt.effectiveGasPrice ?? 0n);
  const cost = gasUsed * eff;
  gasTotal += gasUsed; costTotal += cost;
  const status = receipt.status === 1 || receipt.status === '0x1' ? 'success' : 'reverted';
  const rec = {
    label, kind: built.kind, hash: sent.hash,
    explorer: `${EXPLORER}/tx/${sent.hash}`,
    blockNumber: BigInt(receipt.blockNumber).toString(),
    nonce: sent.nonce, gasUsed: gasUsed.toString(), costWei: cost.toString(),
    status, proof,
  };
  txs.push(rec);
  console.log(`  [${label}] ${sent.hash.slice(0, 18)}… status=${status} gas=${gasUsed} block=${rec.blockNumber}`);
  if (status !== 'success') throw new Error(`TX REVERTED: ${label} ${sent.hash}`);
  return { ...rec, receipt };
}

// V2 receipts() — 11 fields: termsHash, buyer, seller, amount, deadline,
// outputHash, attestedAt, flagReasonHash, policyRef, fundingRef, status.
const v2Abi = new ethers.Interface([
  'function receipts(bytes32) view returns (bytes32 termsHash, address buyer, address seller, uint256 amount, uint256 deadline, bytes32 outputHash, uint256 attestedAt, bytes32 flagReasonHash, bytes32 policyRef, bytes32 fundingRef, uint8 status)',
  'function disputes(address) view returns (uint256)',
  'function challengeWindow() view returns (uint256)',
  'function usdc() view returns (address)',
  'function balanceOf(address) view returns (uint256)',
]);
const call = (to, data) => provider.call({ to, data });
async function getV2Receipt(pid) {
  const raw = await call(V2, v2Abi.encodeFunctionData('receipts', [pid]));
  const d = v2Abi.decodeFunctionResult('receipts', raw);
  return {
    termsHash: d[0], buyer: d[1], seller: d[2], amount: d[3], deadline: d[4],
    outputHash: d[5], attestedAt: d[6], flagReasonHash: d[7],
    policyRef: d[8], fundingRef: d[9], status: Number(d[10]),
  };
}
async function disputesOf(addr) {
  const raw = await call(V2, v2Abi.encodeFunctionData('disputes', [addr]));
  return BigInt(v2Abi.decodeFunctionResult('disputes', raw)[0]);
}
async function bal() {
  const raw = await call(USDC, v2Abi.encodeFunctionData('balanceOf', [DEPLOYER]));
  return BigInt(v2Abi.decodeFunctionResult('balanceOf', raw)[0]);
}
async function assertStatus(pid, want, where) {
  const r = await getV2Receipt(pid);
  const got = STATUS[r.status];
  if (got !== want) throw new Error(`${where}: expected ${want}, got ${got} (pid ${pid.slice(0, 18)}…)`);
  console.log(`  [${where}] status=${got} OK`);
  return r;
}

const nowS = () => Math.floor(Date.now() / 1000);
const fmt = b => (Number(b) / 1e6).toFixed(6);

console.log('== E2E-V2 start ==', new Date().toISOString());

// ---- preflight: V2 on-chain facts ----
const codeLen = (await provider.getCode(V2)).length;
if (codeLen <= 2) throw new Error('V2 has no code — abort');
console.log('preflight: V2 code present');
const cw = BigInt(await call(V2, v2Abi.encodeFunctionData('challengeWindow', [])));
if (cw !== BigInt(CHALLENGE_WINDOW)) throw new Error(`challengeWindow != ${CHALLENGE_WINDOW}`);
console.log('preflight: challengeWindow =', cw.toString());
const v2usdc = ethers.getAddress('0x' + (await call(V2, v2Abi.encodeFunctionData('usdc', []))).slice(-40));
if (v2usdc.toLowerCase() !== USDC.toLowerCase()) throw new Error('V2 usdc mismatch');
console.log('preflight: V2 usdc = USDC OK');

const balBefore = await bal();
console.log('deployer USDC before:', fmt(balBefore));
const disputesBefore = await disputesOf(DEPLOYER);
console.log('disputes(seller) before:', disputesBefore.toString());

// ================= T1: HAPPY PATH (7-param authorize + capture) =================
console.log('\n--- T1: happy path ---');
const pid1 = tx.randomPaymentId();
const deadline1 = nowS() + 3600;
const terms1 = tx.computeTermsHash({ buyer: DEPLOYER, seller: DEPLOYER, endpoint: 'e2e-v2/happy', price: AMOUNT, deadline: deadline1 });
const policy1 = tx.keccak256('raincheck-v2-e2e:T1');
const out1 = tx.keccak256('e2e-v2-happy');
console.log('pid1:', pid1, '\npolicyRef:', policy1);

await broadcast(tx.buildApprove(AMOUNT, { escrow: V2, token: USDC }), 't1-approve',
  'approve(V2, 0.01 USDC): deployer allows the V2 escrow to pull principal');
await broadcast(tx.buildAuthorizeV2(pid1, terms1, DEPLOYER, AMOUNT, deadline1, policy1), 't1-authorize',
  'authorize(7-param, policyRef=keccak256("raincheck-v2-e2e:T1")): V2 pulls 0.01 USDC; receipt -> OPEN');
const r1open = await assertStatus(pid1, 'OPEN', 't1-authorize');
if (r1open.policyRef.toLowerCase() !== policy1.toLowerCase())
  throw new Error(`policyRef not stored: got ${r1open.policyRef}`);
console.log('  policyRef stored on-chain OK');
await broadcast(tx.buildAttestDelivery(pid1, out1, V2), 't1-attest',
  'attestDelivery(pid1, keccak256("e2e-v2-happy")): seller attests; receipt -> ATTESTED, 300s challenge window opens');
const r1 = await assertStatus(pid1, 'ATTESTED', 't1-attest');
console.log('  attestedAt:', r1.attestedAt.toString());
const balPreCapture = await bal();

// ================= T2: DISPUTE PATH (flag -> void, disputes +1) =================
console.log('\n--- T2: dispute path ---');
const pid2 = tx.randomPaymentId();
const deadline2 = nowS() + 3600;
const terms2 = tx.computeTermsHash({ buyer: DEPLOYER, seller: DEPLOYER, endpoint: 'e2e-v2/dispute', price: AMOUNT, deadline: deadline2 });
const out2 = tx.keccak256('e2e-v2-dispute');
const reason2 = tx.reasonHash('e2e v2 test');
console.log('pid2:', pid2);

await broadcast(tx.buildApprove(AMOUNT, { escrow: V2, token: USDC }), 't2-approve',
  'approve(V2, 0.01 USDC): allowance for the dispute-path receipt');
await broadcast(tx.buildAuthorizeV2(pid2, terms2, DEPLOYER, AMOUNT, deadline2), 't2-authorize',
  'authorize(7-param, zeroed refs): standalone mode identical to V1; receipt -> OPEN');
await assertStatus(pid2, 'OPEN', 't2-authorize');
await broadcast(tx.buildAttestDelivery(pid2, out2, V2), 't2-attest',
  'attestDelivery(pid2): receipt -> ATTESTED (so the buyer can dispute inside the window)');
await assertStatus(pid2, 'ATTESTED', 't2-attest');
await broadcast(tx.buildFlagNonDelivery(pid2, reason2, V2), 't2-flag',
  'flagNonDelivery(pid2, keccak256("e2e v2 test")): buyer disputes inside challenge window; receipt -> FLAGGED');
await assertStatus(pid2, 'FLAGGED', 't2-flag');
const balPreVoid = await bal();
await broadcast(tx.buildVoid(pid2, V2), 't2-void',
  'void(pid2): permissionless void of flagged receipt; full 0.01 USDC refund; disputes(seller) +1; receipt -> VOIDED');
await assertStatus(pid2, 'VOIDED', 't2-void');
const balPostVoid = await bal();
// USDC gas-model note: Arc gas is the SAME asset as the ERC-20 face
// (18-dec native vs 6-dec face), so the balance delta = refund - gas.
// Adjust with the void tx's own measured gas cost (wei -> 6-dec units).
const voidCost6 = BigInt(txs[txs.length - 1].costWei) / 1_000_000_000_000n;
const refund2 = balPostVoid - balPreVoid;
const expected2 = AMOUNT - voidCost6;
if (refund2 < expected2 - 10n || refund2 > expected2 + 10n)
  throw new Error(`void refund mismatch: got ${refund2}, want ~${expected2} (10000 - ${voidCost6} gas)`);
const disputesAfterT2 = await disputesOf(DEPLOYER);
if (disputesAfterT2 !== disputesBefore + 1n)
  throw new Error(`disputes not incremented: before=${disputesBefore} after=${disputesAfterT2}`);
console.log(`T2 PASS: OPEN -> ATTESTED -> FLAGGED -> VOIDED; refunded +${fmt(refund2)} USDC; disputes ${disputesBefore} -> ${disputesAfterT2}`);

// ================= T3: VOID-AFTER-DEADLINE (disputes unchanged) =================
console.log('\n--- T3: voidAfterDeadline path ---');
const pid3 = tx.randomPaymentId();
const deadline3 = nowS() + 150; // short deadline: attest never happens
const terms3 = tx.computeTermsHash({ buyer: DEPLOYER, seller: DEPLOYER, endpoint: 'e2e-v2/voidafterdeadline', price: AMOUNT, deadline: deadline3 });
console.log('pid3:', pid3, 'deadline in ~150s');

await broadcast(tx.buildApprove(AMOUNT, { escrow: V2, token: USDC }), 't3-approve',
  'approve(V2, 0.01 USDC): allowance for the voidAfterDeadline receipt');
await broadcast(tx.buildAuthorizeV2(pid3, terms3, DEPLOYER, AMOUNT, deadline3), 't3-authorize',
  'authorize(7-param): receipt -> OPEN; seller never attests');
await assertStatus(pid3, 'OPEN', 't3-authorize');
const balPreVAD = await bal();
for (;;) {
  const blk = await provider.getBlock('latest');
  const remain = deadline3 - Number(blk.timestamp);
  if (remain <= 0) break;
  console.log(`  deadline: ${remain}s remaining…`);
  await sleep(Math.min(remain, 30) * 1000 + 2000);
}
await broadcast(tx.buildVoidAfterDeadline(pid3, V2), 't3-voidAfterDeadline',
  'voidAfterDeadline(pid3): deadline passed, no attestation; full refund; disputes(seller) NOT incremented; receipt -> VOIDED');
await assertStatus(pid3, 'VOIDED', 't3-voidAfterDeadline');
const balPostVAD = await bal();
const vadCost6 = BigInt(txs[txs.length - 1].costWei) / 1_000_000_000_000n;
const refund3 = balPostVAD - balPreVAD;
const expected3 = AMOUNT - vadCost6;
if (refund3 < expected3 - 10n || refund3 > expected3 + 10n)
  throw new Error(`voidAfterDeadline refund mismatch: got ${refund3}, want ~${expected3} (10000 - ${vadCost6} gas)`);
const disputesAfterT3 = await disputesOf(DEPLOYER);
if (disputesAfterT3 !== disputesAfterT2)
  throw new Error(`voidAfterDeadline incremented disputes: ${disputesAfterT2} -> ${disputesAfterT3}`);
console.log(`T3 PASS: OPEN -> VOIDED via voidAfterDeadline; refunded +${fmt(refund3)} USDC; disputes unchanged at ${disputesAfterT3}`);

// ================= T1 finale: capture after the challenge window =================
console.log('\n--- T1 finale: capture ---');
for (;;) {
  const blk = await provider.getBlock('latest');
  const remain = Number(r1.attestedAt) + CHALLENGE_WINDOW - Number(blk.timestamp);
  if (remain <= 0) break;
  console.log(`  challenge window: ${remain}s remaining…`);
  await sleep(Math.min(remain, 60) * 1000 + 2000);
}
await broadcast(tx.buildCapture(pid1, V2), 't1-capture',
  'capture(pid1) after 300s window: permissionless finalize; 0.01 USDC paid to seller (=deployer); receipt -> CAPTURED');
await assertStatus(pid1, 'CAPTURED', 't1-capture');
const balPostCapture = await bal();
const capCost6 = BigInt(txs[txs.length - 1].costWei) / 1_000_000_000_000n;
const paid1 = balPostCapture - balPreCapture;
const expected1 = AMOUNT - capCost6;
if (paid1 < expected1 - 10n || paid1 > expected1 + 10n)
  throw new Error(`capture payout mismatch: got ${paid1}, want ~${expected1} (10000 - ${capCost6} gas)`);
console.log(`T1 PASS: OPEN -> ATTESTED -> CAPTURED; seller paid +${fmt(paid1)} USDC (net of gas)`);

// ---- evidence ----
const balAfter = await bal();
const evidence = {
  generatedAt: new Date().toISOString(),
  suite: 'E2E-V2',
  escrow: V2,
  escrowNote: 'RaincheckEscrowV2 — EXPERIMENTAL, Sourcify exact_match, NOT audited',
  chainId: 5042,
  rpc: RPC,
  deployer: DEPLOYER,
  amountPerPath: AMOUNT.toString(),
  amountNote: '0.01 USDC dust per path',
  challengeWindow: CHALLENGE_WINDOW,
  paths: {
    T1_happy: { paymentId: pid1, policyRef: policy1, flow: 'authorize(7-param) -> attest -> capture', result: 'CAPTURED, seller paid' },
    T2_dispute: { paymentId: pid2, flow: 'authorize -> attest -> flag -> void', result: 'VOIDED, buyer refunded, disputes +1' },
    T3_voidAfterDeadline: { paymentId: pid3, flow: 'authorize -> voidAfterDeadline', result: 'VOIDED, buyer refunded, disputes unchanged' },
  },
  disputesBefore: disputesBefore.toString(),
  disputesAfter: disputesAfterT3.toString(),
  deployerUsdcBefore: balBefore.toString(),
  deployerUsdcAfter: balAfter.toString(),
  gasTotal: gasTotal.toString(),
  costTotalWei: costTotal.toString(),
  txs,
};
writeFileSync(EVIDENCE, JSON.stringify(evidence, null, 2));
console.log('\n== E2E-V2 COMPLETE == evidence:', EVIDENCE);
console.log('txs:', txs.length, '| gas total:', gasTotal.toString());
for (const t of txs) console.log(`  ${t.label}: ${t.hash} (${t.explorer})`);
