/**
 * memo.test.ts — standalone checks for MemoClient.
 *
 * Run: npm test   (tsx memo.test.ts)
 *
 * Vector basis: memoId = keccak256("raincheck:<label>:v1") per build-bible §4.2.
 * The exact vector below was computed once with viem's keccak256 and is
 * asserted byte-for-byte here.
 */
import {
  decodeFunctionData,
  encodeAbiParameters,
  keccak256,
  toEventSelector,
  type Address,
  type Hex,
} from 'viem';
import {
  extractMemoFrames,
  matchFrame,
  matchReceipt,
  MEMO_ABI,
  MEMO_GAS_LIMITS,
  memoIdFor,
  NATIVE_TRANSFER_EMITTER,
  recommendedGasLimit,
  USDC_ERC20_ADDRESS,
  wrapWithMemo,
} from './MemoClient.js';

// ---------------------------------------------------------------------
// Known vectors
// ---------------------------------------------------------------------

/** keccak256("raincheck:authorize:v1"), computed with viem. */
const VECTOR_MEMO_ID_AUTHORIZE: Hex =
  '0x06aadc9472b9455209178bf9b2051a05216ac6add4900c7eea8be19753784e79';

const ESCROW: Address = '0x41099436c5f18eA916B9ca3B835fdc4B5c758Deb';
const BUYER: Address = '0x1234567890123456789012345678901234567890';
const OTHER: Address = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const INNER_CALLDATA = ('0x70c6ca39' + '00'.repeat(96)) as Hex; // placeholder 100-byte inner call

// ---------------------------------------------------------------------
// Tiny runner
// ---------------------------------------------------------------------

let passed = 0;
let failed = 0;

function check(name: string, fn: () => void): void {
  try {
    fn();
    passed++;
    console.log(`ok   - ${name}`);
  } catch (e) {
    failed++;
    const msg = e instanceof Error ? e.message : String(e);
    console.log(`FAIL - ${name}: ${msg}`);
  }
}

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(`assertion failed: ${msg}`);
}

// ---------------------------------------------------------------------
// Synthetic log helpers (ordered exactly as the Memo contract emits them:
// BeforeMemo -> inner logs -> Memo)
// ---------------------------------------------------------------------

type SynthLog = { address: Address; data: Hex; topics: Hex[] };

/** Left-pad a value to a 32-byte topic word. */
const pad32 = (v: bigint | number | Address | Hex): Hex => {
  const hex = typeof v === 'bigint' || typeof v === 'number'
    ? v.toString(16)
    : v.startsWith('0x') ? v.slice(2) : v;
  if (hex.length > 64) throw new Error(`pad32 overflow: ${hex.length} chars`);
  return ('0x' + hex.padStart(64, '0')) as Hex;
};

function beforeMemoLog(memoIndex: bigint): SynthLog {
  return {
    address: '0x5294E9927c3306DcBaDb03fe70b92e01cCede505',
    data: '0x',
    topics: [toEventSelector('BeforeMemo(uint256)'), pad32(memoIndex)],
  };
}

function transferLog(from: Address, to: Address, value: bigint, emitter: Address): SynthLog {
  return {
    address: emitter,
    data: pad32(value),
    topics: [toEventSelector('Transfer(address,address,uint256)'), pad32(from), pad32(to)],
  };
}

function memoLog(args: {
  sender: Address;
  target: Address;
  callDataHash: Hex;
  memoId: Hex;
  memo: Hex;
  memoIndex: bigint;
}): SynthLog {
  // Non-indexed params of Memo(...) in order: bytes32 callDataHash, bytes memo, uint256 memoIndex.
  const data = encodeAbiParameters(
    [{ type: 'bytes32' }, { type: 'bytes' }, { type: 'uint256' }],
    [args.callDataHash, args.memo, args.memoIndex],
  );
  return {
    address: '0x5294E9927c3306DcBaDb03fe70b92e01cCede505',
    data,
    topics: [
      toEventSelector('Memo(address,address,bytes32,bytes32,bytes,uint256)'),
      pad32(args.sender),
      pad32(args.target),
      pad32(args.memoId),
    ],
  };
}

const T = transferLog;

// ---------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------

check('memoIdFor("authorize") matches the known keccak256 vector', () => {
  const got = memoIdFor('authorize');
  assert(got === VECTOR_MEMO_ID_AUTHORIZE, `expected ${VECTOR_MEMO_ID_AUTHORIZE}, got ${got}`);
  assert(/^0x[0-9a-f]{64}$/.test(got), 'must be a 32-byte lowercase hex string');
});

check('memoIdFor labels are unique per transition', () => {
  const ids = new Set(['authorize', 'attest', 'capture', 'flag', 'void', 'voidAfterDeadline'].map(memoIdFor));
  assert(ids.size === 6, 'per-transition memoIds must be unique');
});

check('memoIdFor rejects bad labels', () => {
  let threw = 0;
  for (const bad of ['', 'has space', 'semi;colon', 'x'.repeat(65)]) {
    try { memoIdFor(bad); } catch { threw++; }
  }
  assert(threw === 4, 'all bad labels must throw');
});

check('wrapWithMemo encodes memo() with the convention memoId', () => {
  const outer = wrapWithMemo(ESCROW, INNER_CALLDATA, 'authorize', '0xdeadbeef');
  const decoded = decodeFunctionData({ abi: MEMO_ABI, data: outer });
  assert(decoded.functionName === 'memo', `function name is ${decoded.functionName}`);
  const [target, callData, memoId, memoData] = decoded.args as [Address, Hex, Hex, Hex];
  assert(target.toLowerCase() === ESCROW.toLowerCase(), 'target must round-trip');
  assert(callData === INNER_CALLDATA, 'callData must round-trip');
  assert(memoId === VECTOR_MEMO_ID_AUTHORIZE, 'memoId must equal keccak256("raincheck:authorize:v1")');
  assert(memoData === '0xdeadbeef', 'memoData must round-trip');
  assert(outer.startsWith('0xc3b2c4f8'), 'selector must be memo(address,bytes,bytes32,bytes)');
});

check('wrapWithMemo accepts Uint8Array memoData and rejects >1KB', () => {
  const ok = wrapWithMemo(ESCROW, '0x1234', 'attest', new Uint8Array([1, 2, 3]));
  assert(typeof ok === 'string' && ok.startsWith('0x'), 'must return hex calldata');
  let threw = false;
  try { wrapWithMemo(ESCROW, '0x1234', 'attest', new Uint8Array(1025)); } catch { threw = true; }
  assert(threw, '1025-byte memoData must throw');
  let badAddr = false;
  try { wrapWithMemo('0xnope' as Address, '0x1234', 'attest', '0x'); } catch { badAddr = true; }
  assert(badAddr, 'invalid target must throw');
});

check('gas-limit guidance matches build-bible §9.1', () => {
  assert(MEMO_GAS_LIMITS.authorize === 250_000n, 'authorize ~250k');
  assert(MEMO_GAS_LIMITS.attest === 150_000n, 'attest ~150k');
  assert(MEMO_GAS_LIMITS.capture === 120_000n, 'capture ~120k');
  assert(MEMO_GAS_LIMITS.void === 120_000n, 'void ~120k');
  assert(MEMO_GAS_LIMITS.flag === 120_000n, 'flag ~120k');
  assert(recommendedGasLimit('authorize') === 250_000n, 'helper must agree');
});

check('extractMemoFrames parses BeforeMemo -> Transfer -> Memo in order', () => {
  const memoId = memoIdFor('authorize');
  const logs = [
    beforeMemoLog(0n),
    T(BUYER, ESCROW, 5_000_000n, USDC_ERC20_ADDRESS),
    memoLog({
      sender: BUYER,
      target: ESCROW,
      callDataHash: keccak256(INNER_CALLDATA),
      memoId,
      memo: '0xdeadbeef',
      memoIndex: 0n,
    }),
  ];
  const frames = extractMemoFrames(logs as never);
  assert(frames.length === 1, `expected 1 frame, got ${frames.length}`);
  const f = frames[0];
  assert(f.complete, 'frame must be complete (BeforeMemo + Memo seen)');
  assert(f.memoIndex === 0n, 'memoIndex must round-trip');
  assert(f.sender.toLowerCase() === BUYER.toLowerCase(), 'sender must round-trip');
  assert(f.target.toLowerCase() === ESCROW.toLowerCase(), 'target must round-trip');
  assert(f.memoId === memoId, 'memoId must round-trip');
  assert(f.transfers.length === 1, 'one inner Transfer expected');
  assert(f.transfers[0].from.toLowerCase() === BUYER.toLowerCase(), 'Transfer from=buyer');
  assert(f.transfers[0].to.toLowerCase() === ESCROW.toLowerCase(), 'Transfer to=escrow');
  assert(f.transfers[0].value === 5_000_000n, 'Transfer value must round-trip');
  assert(!f.transfers[0].isSystemNative, 'USDC-face Transfer is not system-native');
  assert(f.innerLogs.length === 1 && f.innerLogs[0].eventName === 'Transfer', 'innerLogs must list the Transfer');
});

check('system-native Transfer emitter is flagged', () => {
  const logs = [
    beforeMemoLog(3n),
    T(BUYER, ESCROW, 5_000_000_000_000_000_000n, NATIVE_TRANSFER_EMITTER),
    memoLog({
      sender: BUYER, target: ESCROW, callDataHash: keccak256('0x1234'),
      memoId: memoIdFor('capture'), memo: '0x', memoIndex: 3n,
    }),
  ];
  const [f] = extractMemoFrames(logs as never);
  assert(f.transfers[0].isSystemNative, 'native-system emitter must be flagged');
});

check('matchFrame verifies sender and callDataHash', () => {
  const logs = [
    beforeMemoLog(0n),
    T(BUYER, ESCROW, 5_000_000n, USDC_ERC20_ADDRESS),
    memoLog({
      sender: BUYER, target: ESCROW, callDataHash: keccak256(INNER_CALLDATA),
      memoId: memoIdFor('authorize'), memo: '0x', memoIndex: 0n,
    }),
  ];
  const [frame] = extractMemoFrames(logs as never);
  const ok = matchFrame(frame, { expectedSender: BUYER, referenceCallData: INNER_CALLDATA });
  assert(ok.senderVerified, 'sender must verify');
  assert(ok.callDataHashVerified === true, 'callDataHash must verify against exact calldata');
  assert(ok.hasValueEvidence, 'frame with a Transfer has value evidence');
  const wrongSender = matchFrame(frame, { expectedSender: OTHER });
  assert(!wrongSender.senderVerified, 'wrong sender must fail verification');
  assert(wrongSender.callDataHashVerified === null, 'no reference calldata -> null');
  const wrongCall = matchFrame(frame, { expectedSender: BUYER, referenceCallData: '0xdead' });
  assert(wrongCall.callDataHashVerified === false, 'wrong calldata must fail callDataHash check');
});

check('memo alone is never value evidence (the bible matching rule)', () => {
  // Memo wrapping a zero-value call: no Transfer logs between BeforeMemo and Memo.
  const memoId = memoIdFor('flag');
  const zeroCall: Hex = '0xabcdef01';
  const logs = [
    beforeMemoLog(7n),
    memoLog({
      sender: BUYER, target: ESCROW, callDataHash: keccak256(zeroCall),
      memoId, memo: '0x', memoIndex: 7n,
    }),
  ];
  const [frame] = extractMemoFrames(logs as never);
  const m = matchFrame(frame, { expectedSender: BUYER, referenceCallData: zeroCall });
  assert(m.senderVerified, 'sender still verifies');
  assert(m.callDataHashVerified === true, 'hash still verifies');
  assert(!m.hasValueEvidence, 'MUST be false: never match on the memo alone');
});

check('multi-transfer txs disambiguate on callDataHash', () => {
  const callA: Hex = '0xaa'; // e.g. the authorize call this memo wraps
  const memoId = memoIdFor('authorize');
  const logs = [
    T(BUYER, ESCROW, 100_000_000n, NATIVE_TRANSFER_EMITTER), // unrelated native move, outside frame
    beforeMemoLog(1n),
    T(BUYER, ESCROW, 5_000_000n, USDC_ERC20_ADDRESS),
    T(ESCROW, OTHER, 5_000_000n, USDC_ERC20_ADDRESS),
    memoLog({
      sender: BUYER, target: ESCROW, callDataHash: keccak256(callA),
      memoId, memo: '0x', memoIndex: 1n,
    }),
  ];
  const frames = extractMemoFrames(logs as never);
  assert(frames.length === 1, 'one frame expected');
  const f = frames[0];
  assert(f.transfers.length === 2, 'two Transfers inside the frame');
  const m = matchFrame(f, { expectedSender: BUYER, referenceCallData: callA });
  assert(m.callDataHashVerified === true, 'callDataHash binds the memo to THIS call');
  const mOther = matchFrame(f, { expectedSender: BUYER, referenceCallData: '0xbb' as Hex });
  assert(mOther.callDataHashVerified === false, 'different call must not claim the frame');
});

check('matchReceipt runs the full pipeline on one receipt', () => {
  const logs = [
    beforeMemoLog(0n),
    T(BUYER, ESCROW, 5_000_000n, USDC_ERC20_ADDRESS),
    memoLog({
      sender: BUYER, target: ESCROW, callDataHash: keccak256(INNER_CALLDATA),
      memoId: memoIdFor('authorize'), memo: '0x', memoIndex: 0n,
    }),
  ];
  const matches = matchReceipt(
    { logs } as never,
    { expectedSender: BUYER, referenceCallDataByMemoId: { [memoIdFor('authorize').toLowerCase()]: INNER_CALLDATA } },
  );
  assert(matches.length === 1, 'one match expected');
  assert(matches[0].senderVerified && matches[0].hasValueEvidence, 'match must be verified with evidence');
});

check('nested memo frames unwind innermost-first', () => {
  const logs = [
    beforeMemoLog(10n),
    beforeMemoLog(11n),
    T(BUYER, ESCROW, 1_000_000n, USDC_ERC20_ADDRESS),
    memoLog({
      sender: BUYER, target: ESCROW, callDataHash: keccak256('0x11'),
      memoId: memoIdFor('attest'), memo: '0x', memoIndex: 11n,
    }),
    memoLog({
      sender: BUYER, target: ESCROW, callDataHash: keccak256('0x10'),
      memoId: memoIdFor('authorize'), memo: '0x', memoIndex: 10n,
    }),
  ];
  const frames = extractMemoFrames(logs as never);
  assert(frames.length === 2, 'two nested frames expected');
  assert(frames.every((f) => f.complete), 'both frames complete');
  const inner = frames.find((f) => f.memoIndex === 11n);
  assert(inner !== undefined && inner.transfers.length === 1, 'inner frame owns the Transfer');
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
