// E2E-EURC2: mainnet dust tests for the RAINCHECK EURC escrow (V1 source).
// Deployer = buyer = seller. Dust 0.01 EURC principal per path.
// Calldata built ONLY via frontend/src/lib/tx.ts builders (Memo-wrapped).
// Manual gas limits from the builders; NEVER eth_estimateGas.
// One retry max on transient RPC failure; never on reverts.
import { ethers } from 'ethers';
import { readFileSync, writeFileSync } from 'fs';
import * as tx from '/home/hatch/workspace/raincheck-build/frontend/src/lib/tx.ts';

const EXPECTED = '0xf76e6B0920e9332fF4410f6dD53F01722AbC71a3';
const ESCROW = ethers.getAddress(tx.ESCROW_ADDRESS_EURC.toLowerCase()); // 0x3ceba2fbeb27162bfc4888f6b61e48bd359c1e0a
const MEMO = ethers.getAddress(tx.MEMO_ADDRESS.toLowerCase());
const EURC = ethers.getAddress('0xbEf5f6d51CB62b58e6A8f77868681825C6fe21c1'); // canonical EIP-55 per task
const RPC = 'https://rpc.mainnet.arc.io';
const EXPLORER = 'https://explorer.arc.io';
const AMOUNT = 10000n;                   // 0.01 EURC (6 decimals)
const STATUS = ['NONE', 'OPEN', 'ATTESTED', 'CAPTURED', 'VOIDED', 'FLAGGED'];
const EVIDENCE = '/home/hatch/workspace/raincheck-build/evidence/e2e-eurc.json';

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
  return { ...rec, receipt };
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

const receiptsAbi = new ethers.Interface([
  'function receipts(bytes32) view returns (bytes32 termsHash, address buyer, address seller, uint256 amount, uint256 deadline, bytes32 outputHash, uint256 attestedAt, bytes32 flagReasonHash, uint8 status)',
  'function balanceOf(address) view returns (uint256)',
]);
async function getReceipt(pid) {
  const raw = await provider.call({ to: ESCROW, data: receiptsAbi.encodeFunctionData('receipts', [pid]) });
  const d = receiptsAbi.decodeFunctionResult('receipts', raw);
  return { termsHash: d[0], buyer: d[1], seller: d[2], amount: d[3], deadline: d[4], outputHash: d[5], attestedAt: d[6], flagReasonHash: d[7], status: Number(d[8]) };
}
async function bal() {
  const raw = await provider.call({ to: EURC, data: receiptsAbi.encodeFunctionData('balanceOf', [DEPLOYER]) });
  return BigInt(receiptsAbi.decodeFunctionResult('balanceOf', raw)[0]);
}
async function assertStatus(pid, want, where) {
  const r = await getReceipt(pid);
  const got = STATUS[r.status];
  if (got !== want) throw new Error(`${where}: expected ${want}, got ${got} (pid ${pid.slice(0, 18)}…)`);
  console.log(`  [${where}] status=${got} OK`);
  return r;
}
// deepest revert node from debug_traceTransaction
async function traceRevert(hash) {
  try {
    const tr = await rpc('debug_traceTransaction', [hash, { tracer: 'callTracer' }]);
    const find = n => (n.error ? n : (n.calls || []).map(find).find(Boolean));
    const fr = find(tr);
    return fr ? { error: fr.error, revertReason: fr.revertReason || null } : null;
  } catch (e) { return { unavailable: String(e.message || e).slice(0, 120) }; }
}

const nowS = () => Math.floor(Date.now() / 1000);
const fmt = b => (Number(b) / 1e6).toFixed(6);

console.log('== E2E-EURC2 start ==', new Date().toISOString());
const balBefore = await bal();
console.log('deployer EURC before:', fmt(balBefore));

// ================= TEST 1: HAPPY PATH =================
console.log('\n--- TEST 1: happy path ---');
const pid1 = tx.randomPaymentId();
const deadline1 = nowS() + 3600;
const terms1 = tx.computeTermsHash({ buyer: DEPLOYER, seller: DEPLOYER, endpoint: 'e2e-eurc/happy', price: AMOUNT, deadline: deadline1 });
const out1 = tx.keccak256('e2e-eurc-happy');
console.log('pid1:', pid1);

await broadcast(tx.buildApprove(AMOUNT, { escrow: ESCROW, token: EURC }), 't1-approve',
  'approve(escrow, 0.01 EURC): deployer allows the EURC escrow to pull principal');
await broadcast(tx.buildAuthorize(pid1, terms1, DEPLOYER, AMOUNT, deadline1, ESCROW), 't1-authorize',
  'authorize(pid1, 0.01 EURC): escrow pulls 0.01 EURC from buyer via transferFrom; receipt -> OPEN');
await assertStatus(pid1, 'OPEN', 't1-authorize');
await broadcast(tx.buildAttestDelivery(pid1, out1, ESCROW), 't1-attest',
  'attestDelivery(pid1, keccak256("e2e-eurc-happy")): seller attests; receipt -> ATTESTED, 300s challenge window opens');
const r1 = await assertStatus(pid1, 'ATTESTED', 't1-attest');
console.log('  attestedAt:', r1.attestedAt.toString());

// wait out the challenge window
for (;;) {
  const blk = await provider.getBlock('latest');
  const remain = Number(r1.attestedAt) + 300 - Number(blk.timestamp);
  if (remain <= 0) break;
  console.log(`  challenge window: ${remain}s remaining…`);
  await sleep(Math.min(remain, 60) * 1000 + 2000);
}
await broadcast(tx.buildCapture(pid1, ESCROW), 't1-capture',
  'capture(pid1) after 300s window: permissionless finalize; 0.01 EURC paid to seller (=deployer); receipt -> CAPTURED');
await assertStatus(pid1, 'CAPTURED', 't1-capture');
console.log('TEST 1 PASS: OPEN -> ATTESTED -> CAPTURED');

// ================= TEST 2: VOID PATH =================
console.log('\n--- TEST 2: void path ---');
const pid2 = tx.randomPaymentId();
const deadline2 = nowS() + 3600;
const terms2 = tx.computeTermsHash({ buyer: DEPLOYER, seller: DEPLOYER, endpoint: 'e2e-eurc/void', price: AMOUNT, deadline: deadline2 });
const out2 = tx.keccak256('e2e-eurc-void');
const reason2 = tx.reasonHash('e2e test');
console.log('pid2:', pid2);

await broadcast(tx.buildApprove(AMOUNT, { escrow: ESCROW, token: EURC }), 't2-approve',
  'approve(escrow, 0.01 EURC): allowance for the void-path receipt');
await broadcast(tx.buildAuthorize(pid2, terms2, DEPLOYER, AMOUNT, deadline2, ESCROW), 't2-authorize',
  'authorize(pid2, 0.01 EURC): receipt -> OPEN');
await assertStatus(pid2, 'OPEN', 't2-authorize');
await broadcast(tx.buildAttestDelivery(pid2, out2, ESCROW), 't2-attest',
  'attestDelivery(pid2): receipt -> ATTESTED (so the buyer can dispute inside the window)');
await assertStatus(pid2, 'ATTESTED', 't2-attest');
const balPreVoid = await bal();
await broadcast(tx.buildFlagNonDelivery(pid2, reason2, ESCROW), 't2-flag',
  'flagNonDelivery(pid2, keccak256("e2e test")): buyer disputes inside challenge window; receipt -> FLAGGED');
await assertStatus(pid2, 'FLAGGED', 't2-flag');
await broadcast(tx.buildVoid(pid2, ESCROW), 't2-void',
  'void(pid2): permissionless void of flagged receipt; full 0.01 EURC refund to buyer; receipt -> VOIDED');
await assertStatus(pid2, 'VOIDED', 't2-void');
const balPostVoid = await bal();
const refund = balPostVoid - balPreVoid;
if (refund !== AMOUNT) throw new Error(`void refund mismatch: got ${refund}, want ${AMOUNT}`);
console.log(`TEST 2 PASS: OPEN -> ATTESTED -> FLAGGED -> VOIDED; buyer refunded +${fmt(refund)} EURC`);

// ================= TEST 3: FAILURE PATH =================
console.log('\n--- TEST 3: failure path (capture before attestation MUST revert) ---');
const pid3 = tx.randomPaymentId();
const deadline3 = nowS() + 3600;
const terms3 = tx.computeTermsHash({ buyer: DEPLOYER, seller: DEPLOYER, endpoint: 'e2e-eurc/fail', price: AMOUNT, deadline: deadline3 });
console.log('pid3:', pid3);

await broadcast(tx.buildApprove(AMOUNT, { escrow: ESCROW, token: EURC }), 't3-approve',
  'approve(escrow, 0.01 EURC): allowance for the failure-path receipt');
await broadcast(tx.buildAuthorize(pid3, terms3, DEPLOYER, AMOUNT, deadline3, ESCROW), 't3-authorize',
  'authorize(pid3, 0.01 EURC): receipt -> OPEN (never attested — capture must fail)');
await assertStatus(pid3, 'OPEN', 't3-authorize');

const fail = await broadcast(tx.buildCapture(pid3, ESCROW), 't3-capture-FAIL',
  'INTENTIONAL FAILURE: capture(pid3) on OPEN (never attested) receipt — MUST revert with "not ATTESTED" (receipt status 0)');
if (fail.status !== 'reverted') throw new Error('FAILURE PATH DID NOT REVERT — unexpected success!');
console.log('  -> reverted as required (status 0)');
await assertStatus(pid3, 'OPEN', 't3-post-fail (state unchanged)');
const trace = await traceRevert(fail.hash);
console.log('  revert trace:', JSON.stringify(trace).slice(0, 300));

// recover the dust: attest -> flag -> void (flag requires ATTESTED)
await broadcast(tx.buildAttestDelivery(pid3, tx.keccak256('e2e-eurc-recover'), ESCROW), 't3-recover-attest',
  'recovery: attestDelivery(pid3) so the dust can be flagged+voided');
await broadcast(tx.buildFlagNonDelivery(pid3, tx.reasonHash('e2e test'), ESCROW), 't3-recover-flag',
  'recovery: flagNonDelivery(pid3); receipt -> FLAGGED');
await broadcast(tx.buildVoid(pid3, ESCROW), 't3-recover-void',
  'recovery: void(pid3); 0.01 EURC dust refunded to buyer; receipt -> VOIDED');
await assertStatus(pid3, 'VOIDED', 't3-recover-void');
console.log('TEST 3 PASS: premature capture reverted; dust recovered via attest -> flag -> void');

const balAfter = await bal();
const evidence = {
  suite: 'E2E-EURC2', chainId: 5042, rpc: RPC,
  escrow: ESCROW, escrowSource: 'RaincheckEscrow V1 (Sourcify exact_match, challengeWindow=300)',
  token: EURC, tokenSymbol: 'EURC', tokenDecimals: 6,
  memo: MEMO, deployer: DEPLOYER, deployerRole: 'buyer = seller = deployer',
  amountPerPath: '10000 (0.01 EURC)',
  paymentIds: { happy: pid1, void: pid2, failure: pid3 },
  termsHashes: { happy: terms1, void: terms2, failure: terms3 },
  outputHashes: { happy: out1, void: out2 },
  flagReasonHash: reason2,
  failureTx: { hash: fail.hash, explorer: fail.explorer, revertTrace: trace,
    proof: 'capture() on an OPEN (never-attested) receipt reverts; receipt status 0 on-chain, payment state unchanged (still OPEN)' },
  txs,
  gas: { totalGasUsed: gasTotal.toString(), totalCostWei: costTotal.toString(),
         totalCostUSDC: (Number(costTotal) / 1e6).toFixed(6) },
  balances: { eurcBefore: balBefore.toString(), eurcBeforeDisplay: fmt(balBefore),
              eurcAfter: balAfter.toString(), eurcAfterDisplay: fmt(balAfter),
              eurcDeltaDisplay: fmt(balAfter - balBefore),
              note: 'principal net ~0: deployer is buyer AND seller, and all dust was refunded/voided' },
  completedAt: new Date().toISOString(),
};
writeFileSync(EVIDENCE, JSON.stringify(evidence, null, 2));
console.log('\n== ALL TESTS PASS ==');
console.log('evidence:', EVIDENCE);
console.log('tx count:', txs.length, '| total gas:', gasTotal.toString(), '| cost (USDC):', (Number(costTotal) / 1e6).toFixed(6));
console.log('EURC before/after:', fmt(balBefore), '->', fmt(balAfter));
