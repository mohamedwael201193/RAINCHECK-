// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @title RaincheckEscrow
/// @notice Minimal delivery-attested escrow for x402 payments (RAINCHECK experiment).
/// @dev Production value: 300s challenge window (bible §4.1 spec). The R9
///      mainnet experiments used 60s as a DOCUMENTED deviation of this same
///      source; the logic is otherwise byte-identical to the Sourcify
///      exact_match reference 0x41099436c5f18eA916B9ca3B835fdc4B5c758Deb.
interface IERC20 {
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
    function transfer(address to, uint256 amount) external returns (bool);
}

contract RaincheckEscrow {
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
        Status status;
    }

    /// @dev Production spec value: 300s (5 minutes) challenge window.
    uint256 public constant challengeWindow = 300;

    IERC20 public immutable usdc;
    mapping(bytes32 => Receipt) public receipts;

    event RaincheckOpened(bytes32 indexed paymentId, address indexed buyer, address indexed seller, bytes32 termsHash, uint256 amount, uint256 deadline);
    event DeliveryAttested(bytes32 indexed paymentId, bytes32 outputHash, uint256 attestedAt);
    event RaincheckCaptured(bytes32 indexed paymentId, uint256 amount);
    event NonDeliveryFlagged(bytes32 indexed paymentId, bytes32 reasonHash);
    event RaincheckVoided(bytes32 indexed paymentId, uint256 amount, address indexed refundedTo);

    constructor(address _usdc) {
        usdc = IERC20(_usdc);
    }

    function authorize(
        bytes32 paymentId,
        bytes32 termsHash,
        address seller,
        uint256 amount,
        uint256 deadline
    ) external {
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
        require(usdc.transfer(r.buyer, r.amount), "refund failed");
        emit RaincheckVoided(paymentId, r.amount, r.buyer);
    }

    function voidAfterDeadline(bytes32 paymentId) external {
        Receipt storage r = receipts[paymentId];
        require(r.status == Status.OPEN, "not OPEN");
        require(block.timestamp > r.deadline, "deadline not passed");

        r.status = Status.VOIDED;
        require(usdc.transfer(r.buyer, r.amount), "refund failed");
        emit RaincheckVoided(paymentId, r.amount, r.buyer);
    }
}
