// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

////////////////////////////////////////////////////////////////////////////////
// SPECIFIED-NOT-LIVE — NOT AUDITED — NOT DEPLOYED
//
// This contract is an EXTENSION specification, not a production artifact.
// It has NOT been executed on mainnet, NOT been audited, and MUST NOT be
// deployed or relied upon until: (1) it passes the full Forge test suite
// here, (2) it is reviewed line-by-line against src/RaincheckEscrow.sol,
// (3) it is deployed to Arc mainnet and exercised with real transactions,
// and (4) Sourcify exact_match verification succeeds for that deployment.
//
// Proven core: src/RaincheckEscrow.sol (deployed, exact_match at
// 0x41099436c5f18eA916B9ca3B835fdc4B5c758Deb) — DO NOT MODIFY THAT FILE.
// This V2 file carries the state machine IDENTICAL to V1, plus ONLY the
// trust-stack deltas specified in §4.1 of the RAINCHECK build bible:
//   (1) mapping(address => uint256) public disputesBySeller — incremented on
//       void() ONLY. Never on voidAfterDeadline: liveness ≠ dishonesty.
//   (2) getPayment(bytes32) view returning (status, seller, amount, termsHash)
//       for policy consumers.
//   (3) authorize() gains optional bytes32 policyRef and bytes32 fundingRef.
//       Zeroed refs = standalone behavior. The original 5-parameter
//       authorize() is kept as an overload, fully backward compatible.
//
// V2 note: the V1 functions below could not inherit-and-override because V1
// declares them non-virtual; the extension is a full self-contained copy so
// V1 stays byte-identical to the verified deployment. IERC20 is imported
// from V1 to avoid a duplicate symbol.
////////////////////////////////////////////////////////////////////////////////

import {IERC20} from "./RaincheckEscrow.sol";

contract RaincheckEscrowV2 {
    enum Status { NONE, OPEN, ATTESTED, CAPTURED, VOIDED, FLAGGED }

    struct Receipt {
        bytes32 termsHash;
        address buyer;
        address seller;
        uint256 amount;
        uint256 deadline;
        bytes32 outputHash;
        uint256 attestedAt;
        bytes32 flagReasonHash;
        bytes32 policyRef;   // DELTA: trust-stack composition ref; bytes32(0) = standalone
        bytes32 fundingRef;  // DELTA: trust-stack composition ref; bytes32(0) = standalone
        Status status;
    }

    /// @dev SPEC value (300s). The R9 V1 experiments used 60s as a documented
    ///      deviation; V2 is new code and follows the spec.
    uint256 public constant challengeWindow = 300;

    IERC20 public immutable usdc;
    mapping(bytes32 => Receipt) public receipts;

    /// @dev DELTA (1): seller dispute counter. Incremented on void() ONLY.
    ///      voidAfterDeadline NEVER touches it: liveness ≠ dishonesty.
    mapping(address => uint256) public disputesBySeller;

    event RaincheckOpened(bytes32 indexed paymentId, address indexed buyer, address indexed seller, bytes32 termsHash, uint256 amount, uint256 deadline);
    event DeliveryAttested(bytes32 indexed paymentId, bytes32 outputHash, uint256 attestedAt);
    event RaincheckCaptured(bytes32 indexed paymentId, uint256 amount);
    event NonDeliveryFlagged(bytes32 indexed paymentId, bytes32 reasonHash);
    event RaincheckVoided(bytes32 indexed paymentId, uint256 amount, address indexed refundedTo);

    constructor(address _usdc) {
        usdc = IERC20(_usdc);
    }

    /// @dev DELTA (1): accessor for the dispute counter (bible: exposed via disputes(address)).
    function disputes(address seller) external view returns (uint256) {
        return disputesBySeller[seller];
    }

    /// @dev DELTA (2): policy-consumer view over a payment.
    ///      State machine is named by NAME, never by ordinal (see bible §4.1).
    function getPayment(bytes32 paymentId)
        external
        view
        returns (Status status, address seller, uint256 amount, bytes32 termsHash)
    {
        Receipt storage r = receipts[paymentId];
        return (r.status, r.seller, r.amount, r.termsHash);
    }

    /// @dev DELTA (3): backward-compatible overload — the exact V1 signature.
    ///      Delegates to the 7-parameter form with zeroed refs.
    function authorize(
        bytes32 paymentId,
        bytes32 termsHash,
        address seller,
        uint256 amount,
        uint256 deadline
    ) external {
        _authorize(paymentId, termsHash, seller, amount, deadline, bytes32(0), bytes32(0));
    }

    /// @dev DELTA (3): authorize gains optional trust-stack composition refs.
    ///      Zeroed refs = standalone behavior identical to V1.
    function authorize(
        bytes32 paymentId,
        bytes32 termsHash,
        address seller,
        uint256 amount,
        uint256 deadline,
        bytes32 policyRef,
        bytes32 fundingRef
    ) external {
        _authorize(paymentId, termsHash, seller, amount, deadline, policyRef, fundingRef);
    }

    function _authorize(
        bytes32 paymentId,
        bytes32 termsHash,
        address seller,
        uint256 amount,
        uint256 deadline,
        bytes32 policyRef,
        bytes32 fundingRef
    ) internal {
        Receipt storage r = receipts[paymentId];
        require(r.status == Status.NONE, "paymentId already used");
        require(seller != address(0), "seller zero");
        require(amount > 0, "amount zero");
        require(deadline > block.timestamp, "deadline not in future");

        r.termsHash = termsHash;
        r.buyer = msg.sender;
        r.seller = seller;
        r.amount = amount;
        r.deadline = deadline;
        r.policyRef = policyRef;   // DELTA
        r.fundingRef = fundingRef; // DELTA
        r.status = Status.OPEN;

        require(usdc.transferFrom(msg.sender, address(this), amount), "transferFrom failed");
        emit RaincheckOpened(paymentId, msg.sender, seller, termsHash, amount, deadline);
    }

    function attestDelivery(bytes32 paymentId, bytes32 outputHash) external {
        Receipt storage r = receipts[paymentId];
        require(r.status == Status.OPEN, "not OPEN");
        require(msg.sender == r.seller, "seller only");
        require(block.timestamp <= r.deadline, "past deadline");

        r.status = Status.ATTESTED;
        r.outputHash = outputHash;
        r.attestedAt = block.timestamp;
        emit DeliveryAttested(paymentId, outputHash, block.timestamp);
    }

    function capture(bytes32 paymentId) external {
        Receipt storage r = receipts[paymentId];
        require(r.status == Status.ATTESTED, "not ATTESTED");
        require(block.timestamp >= r.attestedAt + challengeWindow, "challenge window open");

        r.status = Status.CAPTURED;
        require(usdc.transfer(r.seller, r.amount), "payout failed");
        emit RaincheckCaptured(paymentId, r.amount);
    }

    function flagNonDelivery(bytes32 paymentId, bytes32 reasonHash) external {
        Receipt storage r = receipts[paymentId];
        require(r.status == Status.ATTESTED, "not ATTESTED");
        require(msg.sender == r.buyer, "buyer only");
        require(block.timestamp <= r.attestedAt + challengeWindow, "challenge window closed");

        r.status = Status.FLAGGED;
        r.flagReasonHash = reasonHash;
        emit NonDeliveryFlagged(paymentId, reasonHash);
    }

    function void(bytes32 paymentId) external {
        Receipt storage r = receipts[paymentId];
        require(r.status == Status.FLAGGED, "not FLAGGED");

        r.status = Status.VOIDED;
        // DELTA (1): a void means the buyer flagged non-delivery — count it
        // as a dispute against the seller. No other path increments this.
        disputesBySeller[r.seller] += 1;
        require(usdc.transfer(r.buyer, r.amount), "refund failed");
        emit RaincheckVoided(paymentId, r.amount, r.buyer);
    }

    function voidAfterDeadline(bytes32 paymentId) external {
        Receipt storage r = receipts[paymentId];
        require(r.status == Status.OPEN, "not OPEN");
        require(block.timestamp > r.deadline, "deadline not passed");

        r.status = Status.VOIDED;
        // DELTA (1): deliberately NOT incremented here. The seller never
        // attested — that is liveness (or a dead buyer/seller), not a proven
        // dishonest delivery. Liveness ≠ dishonesty.
        require(usdc.transfer(r.buyer, r.amount), "refund failed");
        emit RaincheckVoided(paymentId, r.amount, r.buyer);
    }
}
