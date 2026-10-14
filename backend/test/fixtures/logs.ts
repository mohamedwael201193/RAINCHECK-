// FIXTURE DATA — synthetic event logs for tests only.
// Log sequences are MODELED ON the real mainnet records in raincheck-build-bible.md
// §6.2 (void path) and §6.3 (deliver path); paymentIds, addresses and tx hashes are
// copied from those experiment tables to keep fixtures realistic, but the log
// sequences themselves are constructed by hand for determinism testing — they are
// NOT live RPC output. Nothing here is presented as chain evidence.
import type { FixtureLog } from "../lib/derive.js";
export type { FixtureLog };

// --- Shared actors (bible §6.2, real mainnet addresses reused as fixture values) ---
export const FIX = {
  buyer: "0xBDfCeE82Bd42FEfA58ee850B3709636a8B6b0034",
  seller: "0xc3b183D5e4436C20282650348BE2D6c94c4142dc",
  escrowVoid: "0x44357E99755705376627542509d8D2eabF02562F",
  escrowDeliver: "0x41099436c5f18eA916B9ca3B835fdc4B5c758Deb",
  amount: "1000",
  termsHash: "0x" + "7a".repeat(32),
  endpoint: "https://api.example.com/v1/render",
  price: "1000",
  deadline: 1791957337,
  reasonHash: "0x" + "9c".repeat(32),
  outputHashVoid: "0x" + "5d".repeat(32), // sha256 of 64 garbage bytes (fixture stand-in)
  outputHashDeliver: "0x" + "b1".repeat(32), // sha256 of the delivered payload (fixture stand-in)
  sellerSig: "0x" + "ab".repeat(65),
};

// --- VOID path logs (bible §6.2 table: authorize 1140 / attest 1141 / flag 1142 / void 1143) ---
const voidPaymentId = "0x9b56d7caaeb6a25e77760afb249a9ce69d176c47802b283c7127b0940ef653b9";
const txAuthorizeVoid = "0xa5c889b7c7a6cffb11e30855e397f3109eac0a540da90b365355f91a33e1f978";
const txAttestVoid = "0xc496c6a04218174019a343f9a19d5b424c7bd38f0b8e1bde7b8021aadc817383";
const txFlagVoid = "0x579592846ee7a558e2bede22e5fadf82bd27210c81b741a254dc59b93364881e";
const txVoid = "0xf8ecf05d35d2c9b18675d48274877d4e569e6b72908bb2aad31ad8769b4fd60c";

export const voidPathLogs: FixtureLog[] = [
  {
    name: "RaincheckOpened",
    txHash: txAuthorizeVoid,
    blockNumber: 25867611,
    logIndex: 5,
    args: {
      paymentId: voidPaymentId,
      buyer: FIX.buyer,
      seller: FIX.seller,
      escrow: FIX.escrowVoid,
      amount: FIX.amount,
      termsHash: FIX.termsHash,
      endpoint: FIX.endpoint,
      price: FIX.price,
      deadline: FIX.deadline,
    },
  },
  {
    name: "Transfer",
    txHash: txAuthorizeVoid,
    blockNumber: 25867611,
    logIndex: 6,
    args: { paymentId: voidPaymentId, from: FIX.buyer, to: FIX.escrowVoid, value: FIX.amount },
  },
  {
    name: "DeliveryAttested",
    txHash: txAttestVoid,
    blockNumber: 25867619,
    logIndex: 3,
    args: {
      paymentId: voidPaymentId,
      outputHash: FIX.outputHashVoid,
      attestedAt: 1791953860,
      sellerSig: FIX.sellerSig,
    },
  },
  {
    name: "NonDeliveryFlagged",
    txHash: txFlagVoid,
    blockNumber: 25867624,
    logIndex: 2,
    args: { paymentId: voidPaymentId, flaggedBy: FIX.buyer, reasonHash: FIX.reasonHash },
  },
  {
    name: "RaincheckVoided",
    txHash: txVoid,
    blockNumber: 25867630,
    logIndex: 4,
    args: { paymentId: voidPaymentId, refundTo: FIX.buyer, amount: FIX.amount },
  },
  {
    name: "Transfer",
    txHash: txVoid,
    blockNumber: 25867630,
    logIndex: 5,
    args: { paymentId: voidPaymentId, from: FIX.escrowVoid, to: FIX.buyer, value: FIX.amount },
  },
];

// --- DELIVER path logs (bible §6.3 table: attest 1144 / capture 1145) ---
const deliverPaymentId = "0x2afce53583a7e57afb16d95f0b606d7d12109cebf95ff10a2c952166530d55ad";
const txAuthorizeDeliver = "0x57522f14068c625b7a47ab2dc84e16139c2ba896acb6b4d2714f8107f3911317";
const txAttestDeliver = "0x09d42eb42bb5bff1fd3a84db739a4e01e196af91b3cef2dc79664bec59c5d900";
const txCapture = "0x78d48f08398031b1d9f3fa1bf389e4ac920f69ca344d51c48b2fd74056e30ae9";

export const deliverPathLogs: FixtureLog[] = [
  {
    name: "RaincheckOpened",
    txHash: txAuthorizeDeliver,
    blockNumber: 25867590,
    logIndex: 4,
    args: {
      paymentId: deliverPaymentId,
      buyer: FIX.buyer,
      seller: FIX.seller,
      escrow: FIX.escrowDeliver,
      amount: FIX.amount,
      termsHash: FIX.termsHash,
      endpoint: FIX.endpoint,
      price: FIX.price,
      deadline: FIX.deadline,
    },
  },
  {
    name: "Transfer",
    txHash: txAuthorizeDeliver,
    blockNumber: 25867590,
    logIndex: 5,
    args: { paymentId: deliverPaymentId, from: FIX.buyer, to: FIX.escrowDeliver, value: FIX.amount },
  },
  {
    name: "DeliveryAttested",
    txHash: txAttestDeliver,
    blockNumber: 25867601,
    logIndex: 3,
    args: {
      paymentId: deliverPaymentId,
      outputHash: FIX.outputHashDeliver,
      attestedAt: 1791954000,
      sellerSig: FIX.sellerSig,
    },
  },
  {
    name: "RaincheckCaptured",
    txHash: txCapture,
    blockNumber: 25867608,
    logIndex: 3,
    args: { paymentId: deliverPaymentId, paidTo: FIX.seller, amount: FIX.amount },
  },
  {
    name: "Transfer",
    txHash: txCapture,
    blockNumber: 25867608,
    logIndex: 4,
    args: { paymentId: deliverPaymentId, from: FIX.escrowDeliver, to: FIX.seller, value: FIX.amount },
  },
];
