export * from "./config.js";
import escrowAbi from "./abi/RaincheckEscrow.json" with { type: "json" };

// RaincheckEscrow ABI: the 5 events + 6 functions from the spec (§4.1).
// C1's compiled artifact (contracts/out) replaces this file verbatim when available.
export const RAINCHECK_ESCROW_ABI = escrowAbi;
