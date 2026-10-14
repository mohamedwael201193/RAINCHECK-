/**
 * RAINCHECK indexer — self-test against the bible's KNOWN mainnet txs (§6).
 *
 * Indexes the real R9 experiment transactions on Arc mainnet (5042) and checks
 * that receipts reconstruct correctly from chain logs alone:
 *   deliver path (escrow 0x4109…): authorize 0x0e0edcb4… → attest 0x09d42eb4…
 *       → capture 0x78d48f08…   (expect CAPTURED, memo idx 1144/1145)
 *   void path (escrow 0x4435…):   authorize 0xa5c889b7… → attest 0xc496c6a0…
 *       → flag 0x57959284… → void 0xf8ecf05d…
 *       (expect VOIDED, memo idx 1140–1143, garbage reasonHash)
 *
 * Run: npm run indexer   (node --experimental-strip-types src/indexer/selftest.ts)
 * Exits non-zero on any failure. Reads chain state only; writes a temp DB.
 */
import { createHash } from 'node:crypto';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  decodeFunctionData,
  keccak256,
  toHex,
  type Hex,
} from 'viem';
import {
  BEFORE_MEMO_TOPIC,
  MEMO_TOPIC,
  PRODUCTION_ESCROW_CONFIG,
  R9_VOID_ESCROW_CONFIG,
} from './config.js';import { createClient, pollRange } from './poller.js';
import { openStore } from './store.js';

let failures = 0;
function check(name: string, cond: boolean, detail?: string) {
  if (cond) console.log(`  PASS ${name}`);
  else {
    failures += 1;
    console.error(`  FAIL ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

const sha256hex = (s: string) =>
  '0x' + createHash('sha256').update(s).digest('hex');

const KNOWN = {
  deliverPaymentId: '0x2afce53583a7e57afb16d95f0b606d7d12109cebf95ff10a2c952166530d55ad',
  // On-chain truth (all four void-path txs emit this). NOTE: bible §6.2 prints
  // …ef653b9 (b9); keccak256("raincheck-w1c-void-path-v1") and every on-chain
  // log agree on …ef653b1 (b1) — the bible has a transcription typo.
  voidPaymentId: '0x9b56d7caaeb6a25e77760afb249a9ce69d176c47802b283c7127b0940ef653b1',
  voidPaymentIdBibleTypo: '0x9b56d7caaeb6a25e77760afb249a9ce69d176c47802b283c7127b0940ef653b9',
  voidBuyer: '0xbdfcee82bd42fefa58ee850b3709636a8b6b0034',
  voidSeller: '0xc3b183d5e4436c20282650348be2d6c94c4142dc',
  voidTx: '0xf8ecf05d35d2c9b18675d48274877d4e569e6b72908bb2aad31ad8769b4fd60c' as Hex,
  deliverOutputPreimage: 'RAINCHECK-R9-W1B2-DELIVERED-PAYLOAD-0001',
  flagReasonPreimage: 'garbage delivery: paid call returned HTTP 400, output bytes are random',
  voidPaymentIdPreimage: 'raincheck-w1c-void-path-v1',
  voidMemoIdPreimage: 'memo-raincheck:v1',
};

async function main() {
  const client = createClient();
  const dbPath = join(mkdtempSync(join(tmpdir(), 'raincheck-selftest-')), 'test.db');
  const store = openStore(dbPath);

  console.log('[1] topic0 hypotheses vs live void-tx logs');
  check(
    'BeforeMemo(uint256) topic0 == 0xb252e055…',
    BEFORE_MEMO_TOPIC.toLowerCase() ===
      '0xb252e055da754c72fbf7542cf424b190808a9b541e912894c5e15b4238c41501',
    BEFORE_MEMO_TOPIC,
  );
  check(
    'Memo(address,address,bytes32,bytes32,bytes,uint256) topic0 == 0xeb15ee72…',
    MEMO_TOPIC.toLowerCase() ===
      '0xeb15ee720798341c37739df41be53acfbbf70ae6802dade35457beec6e47a5e4',
    MEMO_TOPIC,
  );

  console.log('[1b] R9 void-variant ABI topic0s vs observed chain logs');
  const variantTopic = (name: string) => {
    const ev = R9_VOID_ESCROW_CONFIG.abi.find((e) => e.name === name)!;
    const sig = `${ev.name}(${(ev.inputs ?? []).map((i) => i.type).join(',')})`;
    return keccak256(toHex(sig)).toLowerCase();
  };
  check(
    'variant RaincheckOpened topic0 == 0xa57c1c86… (w1c source)',
    variantTopic('RaincheckOpened') ===
      '0xa57c1c864e25ebb44d0ae62cc61653cd69376c0d37e05c6c742724038e4199d7',
    variantTopic('RaincheckOpened'),
  );
  check(
    'variant NonDeliveryFlagged topic0 == 0x88c0dcc9… (w1c source)',
    variantTopic('NonDeliveryFlagged') ===
      '0x88c0dcc985659f110dce548ad56b02e25e61fe0f1f3461205f3fad7b100ba7c2',
    variantTopic('NonDeliveryFlagged'),
  );
  check(
    'variant RaincheckVoided topic0 == 0x9f392e88… (w1c source)',
    variantTopic('RaincheckVoided') ===
      '0x9f392e8810a3c19cee0e25628b3a9c6960a6cef6ef63e24473e7801f936b5715',
    variantTopic('RaincheckVoided'),
  );
  const res = await pollRange(client, store, {
    escrows: [PRODUCTION_ESCROW_CONFIG, R9_VOID_ESCROW_CONFIG],
    fromBlock: 25_867_600,
    toBlock: 25_868_900,
  });
  console.log(
    `  indexed blocks ${res.fromBlock}..${res.toBlock}: ${res.logsSeen} logs, ${res.transitionsWritten} transitions, ${res.receiptsTouched} receipts touched`,
  );
  if (res.warnings.length) {
    console.log('  warnings:');
    for (const w of res.warnings) console.log(`    - ${w}`);
  }
  check('logs seen >= 7 (3 deliver + 4 void events)', res.logsSeen >= 7, String(res.logsSeen));
  check('no indexer warnings on known-good txs', res.warnings.length === 0, res.warnings.join(' | '));

  console.log('[3] DELIVER path receipt (0x2afce5…)');
  const d = store.getReceipt(KNOWN.deliverPaymentId);
  check('receipt exists', !!d);
  if (d) {
    check('status == CAPTURED', d.status === 'CAPTURED', d.status);
    check('amount == 1000 base units', d.amount === '1000', String(d.amount));
    check(
      'outputHash == sha256(delivered payload)',
      d.outputHash === sha256hex(KNOWN.deliverOutputPreimage),
      d.outputHash ?? 'null',
    );
    check('attestedAt set', typeof d.attestedAt === 'number' && d.attestedAt > 0, String(d.attestedAt));
    check('buyer/seller/termsHash present', !!(d.buyer && d.seller && d.termsHash));
    check('createdBlock <= updatedBlock', d.createdBlock <= d.updatedBlock);
  }
  const dt = store.getTransitions(KNOWN.deliverPaymentId);
  check(
    'transition sequence == Opened/Attested/Captured',
    JSON.stringify(dt.map((t) => t.event)) ===
      JSON.stringify(['RaincheckOpened', 'DeliveryAttested', 'RaincheckCaptured']),
    dt.map((t) => t.event).join(','),
  );
  const dMemos = dt.map((t) => t.memoIndex);
  check(
    'memo indexes == [null|n, 1144, 1145] (attest=1144, capture=1145)',
    dMemos[1] === 1144 && dMemos[2] === 1145,
    JSON.stringify(dMemos),
  );

  console.log('[4] VOID path receipt (0x9b56d7…b1 — on-chain truth)');
  check(
    'keccak256(void preimage) == on-chain paymentId (bible §6.2 has a b9/b1 typo)',
    keccak256(toHex(KNOWN.voidPaymentIdPreimage)).toLowerCase() ===
      KNOWN.voidPaymentId &&
      KNOWN.voidPaymentId !== KNOWN.voidPaymentIdBibleTypo,
    keccak256(toHex(KNOWN.voidPaymentIdPreimage)),
  );
  const v = store.getReceipt(KNOWN.voidPaymentId);
  check('receipt exists', !!v);
  if (v) {
    check('status == VOIDED', v.status === 'VOIDED', v.status);
    check('amount == 1000 base units', v.amount === '1000', String(v.amount));
    check('buyer == real buyer key', v.buyer === KNOWN.voidBuyer, v.buyer ?? 'null');
    check('seller == real seller key', v.seller === KNOWN.voidSeller, v.seller ?? 'null');
    check(
      'flagReasonHash == keccak256(garbage reason)',
      v.flagReasonHash === keccak256(toHex(KNOWN.flagReasonPreimage)),
      v.flagReasonHash ?? 'null',
    );
  }
  const vt = store.getTransitions(KNOWN.voidPaymentId);
  check(
    'transition sequence == Opened/Attested/Flagged/Voided',
    JSON.stringify(vt.map((t) => t.event)) ===
      JSON.stringify([
        'RaincheckOpened',
        'DeliveryAttested',
        'NonDeliveryFlagged',
        'RaincheckVoided',
      ]),
    vt.map((t) => t.event).join(','),
  );
  check(
    'memo indexes == [1140,1141,1142,1143]',
    JSON.stringify(vt.map((t) => t.memoIndex)) === JSON.stringify([1140, 1141, 1142, 1143]),
    JSON.stringify(vt.map((t) => t.memoIndex)),
  );

  console.log('[5] callDataHash + memoId binding (multi-transfer rule, §4.2)');
  // The void tx's Memo log carries callDataHash as data[0:32] and the indexed
  // memoId as topics[3]. Both must bind: callDataHash == keccak256 of the
  // exact calldata passed to memo(); memoId == keccak256("memo-raincheck:v1").
  const tx = await client.getTransaction({ hash: KNOWN.voidTx });
  const receipt = await client.getTransactionReceipt({ hash: KNOWN.voidTx });
  const memoLog = receipt.logs.find(
    (l) => l.topics[0]?.toLowerCase() === MEMO_TOPIC.toLowerCase(),
  );
  const loggedCallDataHash =
    memoLog && memoLog.data.length >= 66
      ? ('0x' + memoLog.data.slice(2, 66)).toLowerCase()
      : null;
  const loggedMemoId = memoLog?.topics[3]?.toLowerCase() ?? null;
  const MEMO_FN_ABI = [
    {
      type: 'function',
      name: 'memo',
      inputs: [
        { name: 'target', type: 'address' },
        { name: 'callData', type: 'bytes' },
        { name: 'memoId', type: 'bytes32' },
        { name: 'memoData', type: 'bytes' },
      ],
      outputs: [],
      stateMutability: 'nonpayable',
    },
  ] as const;
  const { args } = decodeFunctionData({ abi: MEMO_FN_ABI, data: tx.input });
  const recomputed = keccak256(args[1] as Hex).toLowerCase();
  check(
    'Memo.callDataHash == keccak256(exact calldata)',
    loggedCallDataHash === recomputed,
    `log=${loggedCallDataHash} recomputed=${recomputed}`,
  );
  check(
    'Memo.memoId == keccak256("memo-raincheck:v1") (bible §4.2 convention)',
    loggedMemoId === keccak256(toHex(KNOWN.voidMemoIdPreimage)).toLowerCase(),
    `log=${loggedMemoId}`,
  );
  check(
    'Memo sender == real buyer signer',
    (memoLog?.topics[1]?.slice(-40).toLowerCase() ?? '') === KNOWN.voidBuyer.slice(2),
    memoLog?.topics[1] ?? 'no memo log',
  );

  console.log('[6] idempotency: re-index same range writes nothing new');
  const res2 = await pollRange(client, store, {
    escrows: [PRODUCTION_ESCROW_CONFIG, R9_VOID_ESCROW_CONFIG],
    fromBlock: 25_867_600,
    toBlock: 25_868_900,
  });
  check('replay writes 0 new transitions', res2.transitionsWritten === 0, String(res2.transitionsWritten));
  check(
    'receipt state unchanged after replay',
    store.getReceipt(KNOWN.deliverPaymentId)?.status === 'CAPTURED' &&
      store.getReceipt(KNOWN.voidPaymentId)?.status === 'VOIDED',
  );

  store.close();
  console.log(failures === 0 ? '\nSELF-TEST: ALL PASS' : `\nSELF-TEST: ${failures} FAILURE(S)`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error('SELF-TEST ERROR:', e);
  process.exit(1);
});
