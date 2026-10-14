import { parseAbi } from "viem";

/**
 * Event ABIs for the RaincheckEscrow + Memo contracts (bible §4.1, §4.2).
 * Status transitions are derived from event NAMES, never enum ordinals
 * (the bible's ordinal caution: ordinals differ across deployments).
 */
export const ESCROW_EVENTS = parseAbi([
  "event RaincheckOpened(bytes32 indexed paymentId, address indexed buyer, address indexed seller, bytes32 termsHash, uint256 amount, uint256 deadline)",
  "event DeliveryAttested(bytes32 indexed paymentId, bytes32 outputHash, uint256 attestedAt)",
  "event RaincheckCaptured(bytes32 indexed paymentId, uint256 amount)",
  "event NonDeliveryFlagged(bytes32 indexed paymentId, bytes32 reasonHash)",
  "event RaincheckVoided(bytes32 indexed paymentId, uint256 amount, address indexed refundedTo)",
]);

export const MEMO_EVENTS = parseAbi([
  "event Memo(address sender, address target, bytes32 callDataHash, bytes32 memoId, bytes memo, uint256 memoIndex)",
  "event BeforeMemo(uint256 memoIndex)",
]);
