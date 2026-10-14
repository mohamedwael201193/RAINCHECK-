import { ethers } from 'ethers';
import { readFileSync } from 'fs';

const EXPECTED = '0xf76e6B0920e9332fF4410f6dD53F01722AbC71a3';
const ESCROW = '0x3ceba2fbeb27162bfc4888f6b61e48bd359c1e0a';
const MEMO = '0x5294E9927c3306DcBaDb03fe70b92e01cCede505';
const EURC = '0xbEf5f6d51CB62b58e6A8f77868681825C6fe21c1';
const USDC = '0x3600000000000000000000000000000000000000';
const RPC = 'https://rpc.mainnet.arc.io';

const env = readFileSync('/home/hatch/workspace/user/files/env-3.txt', 'utf8');
const key = env.split('\n').find(l => l.startsWith('DEPLOYER_PRIVATE_KEY=')).split('=')[1].trim();
const wallet = new ethers.Wallet(key);
if (wallet.address.toLowerCase() !== EXPECTED.toLowerCase()) { console.error('ADDRESS MISMATCH — ABORT'); process.exit(1); }
console.log('1. key -> address: MATCH', wallet.address);

const provider = new ethers.JsonRpcProvider(RPC);
const cid = (await provider.getNetwork()).chainId;
if (cid !== 5042n) { console.error('chainId mismatch'); process.exit(1); }
console.log('2. chainId 5042 OK');

for (const [n, a] of [['EURC escrow', ESCROW], ['Memo', MEMO], ['EURC', EURC]]) {
  const code = await provider.getCode(a);
  if (!code || code === '0x') { console.error(n, 'no code'); process.exit(1); }
  console.log(`3. ${n} code ${(code.length - 2) / 2} bytes OK`);
}

const call = (to, data) => provider.call({ to, data });
const cw = parseInt(await call(ESCROW, ethers.id('challengeWindow()').slice(0, 10)), 16);
if (cw !== 300) { console.error('challengeWindow != 300'); process.exit(1); }
console.log('4. challengeWindow:', cw, 's OK');

const tok = '0x' + (await call(ESCROW, ethers.id('usdc()').slice(0, 10))).slice(26);
if (tok.toLowerCase() !== EURC.toLowerCase()) { console.error('escrow token mismatch:', tok); process.exit(1); }
console.log('5. escrow.usdc() == EURC', tok, 'OK');

// getPayment probe — V1 source likely lacks it; fall back to receipts() mapping
const gpProbe = await call(ESCROW, ethers.id('getPayment(bytes32)').slice(0, 10) + '00'.repeat(32)).catch(() => null);
console.log('6. getPayment(bytes32) on V1 escrow:', gpProbe ? 'EXISTS' : 'absent (use receipts() getter)');

// receipts(0x00..) — should decode to all-zero (status NONE=0)
const rc = await call(ESCROW, ethers.id('receipts(bytes32)').slice(0, 10) + '00'.repeat(32));
const dec = ethers.AbiCoder.defaultAbiCoder().decode(
  ['bytes32','address','address','uint256','uint256','bytes32','uint256','bytes32','uint8'], rc);
console.log('7. receipts(0) status:', dec[8].toString(), '(0=NONE expected)');

const erc20 = new ethers.Interface(['function balanceOf(address) view returns (uint256)']);
const eurcBal = await provider.call({ to: EURC, data: erc20.encodeFunctionData('balanceOf', [EXPECTED]) });
const usdcBal = await provider.call({ to: USDC, data: erc20.encodeFunctionData('balanceOf', [EXPECTED]) });
console.log('8. deployer EURC:', (Number(BigInt(eurcBal)) / 1e6).toFixed(6), '| USDC(gas):', (Number(BigInt(usdcBal)) / 1e6).toFixed(6));
if (BigInt(eurcBal) < 50000n) { console.error('insufficient EURC'); process.exit(1); }
if (BigInt(usdcBal) < 100000n) { console.error('insufficient USDC for gas'); process.exit(1); }

const nonce = await provider.getTransactionCount(EXPECTED, 'pending');
console.log('9. pending nonce:', nonce);
const fees = await provider.getFeeData();
console.log('10. feeData gasPrice:', fees.gasPrice?.toString(), 'maxFee:', fees.maxFeePerGas?.toString(), 'prio:', fees.maxPriorityFeePerGas?.toString());

// cross-check tx.ts keccak vs ethers on the happy-path output string
const t = await import('/home/hatch/workspace/raincheck-build/frontend/src/lib/tx.ts');
const a = t.keccak256('e2e-eurc-happy'), b = ethers.keccak256(ethers.toUtf8Bytes('e2e-eurc-happy'));
if (a.toLowerCase() !== b.toLowerCase()) { console.error('keccak mismatch'); process.exit(1); }
console.log('11. tx.ts keccak256 == ethers keccak256 OK:', a);
console.log('PREFLIGHT PASS — safe to broadcast');
