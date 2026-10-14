// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

/// @title RaincheckEscrowFP
/// @notice V1.1 freeze-proof variant of RaincheckEscrow (bible showdown delta:
///         "no freeze-proof payouts" was our only LOSE).
/// @dev Copy of src/RaincheckEscrow.sol with EXACTLY these deltas — everything
///      else (state machine, 300s challenge window, events, memo-compat) is
///      identical to V1:
///        1. Every fund-moving path (capture → seller, void / voidAfterDeadline
///           → buyer) routes through _sendOrHold: a failing token transfer
///           (frozen/blacklisted token) NEVER reverts the state transition — the
///           amount is credited to `owed[to]` and a PaymentHeld event is emitted.
///           On V1 the same failure bricks the receipt (revert or trapped funds).
///        2. Permissionless withdraw(): anyone owed funds can pull them later; a
///           still-failing transfer re-holds (never bricks, never traps).
///      Trust residual: `owed` is an accounting promise, not custody — the token
///      contract itself decides whether the eventual withdraw succeeds.
interface IFPToken {
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
    function transfer(address to, uint256 amount) external returns (bool);
}

contract RaincheckEscrowFP {
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

    /// @dev Production spec value: 300s (5 minutes) challenge window — same as V1.
    uint256 public constant challengeWindow = 300;

    IFPToken public immutable usdc;
    mapping(bytes32 => Receipt) public receipts;
    /// @dev Freeze-proof ledger: funds that could not be pushed out because the
    ///      token transfer failed (frozen token). Pull-based recovery via withdraw().
    mapping(address => uint256) public owed;

    event RaincheckOpened(bytes32 indexed paymentId, address indexed buyer, address indexed seller, bytes32 termsHash, uint256 amount, uint256 deadline);
    event DeliveryAttested(bytes32 indexed paymentId, bytes32 outputHash, uint256 attestedAt);
    event RaincheckCaptured(bytes32 indexed paymentId, uint256 amount);
    event NonDeliveryFlagged(bytes32 indexed paymentId, bytes32 reasonHash);
    event RaincheckVoided(bytes32 indexed paymentId, uint256 amount, address indexed refundedTo);
    /// @dev NEW (V1.1): emitted whenever a payout/refund could not be pushed
    ///      and was credited to `owed` instead. paymentId is bytes32(0) for
    ///      withdraw() re-holds (no payment context there).
    event PaymentHeld(bytes32 indexed paymentId, address indexed to, uint256 amount);

    constructor(address _usdc) {
        usdc = IFPToken(_usdc);
    }

    /// @dev NEW (V1.1): push-or-hold. A failing transfer (frozen token) credits
    ///      `owed` instead of reverting — the state transition above it always
    ///      completes, so funds are never trapped in a dead receipt.
    function _sendOrHold(bytes32 paymentId, address to, uint256 amount) internal {
        try usdc.transfer(to, amount) returns (bool ok) {
            if (!ok) {
                owed[to] += amount;
                emit PaymentHeld(paymentId, to, amount);
            }
        } catch {
            owed[to] += amount;
            emit PaymentHeld(paymentId, to, amount);
        }
    }

    /// @notice NEW (V1.1): pull any funds held for the caller. Permissionless.
    ///         If the token still refuses the transfer, the amount is re-held
    ///         (never bricks, never traps).
    function withdraw() external {
        uint256 amount = owed[msg.sender];
        require(amount > 0, "nothing owed");
        owed[msg.sender] = 0;
        try usdc.transfer(msg.sender, amount) returns (bool ok) {
            if (!ok) {
                owed[msg.sender] = amount;
                emit PaymentHeld(bytes32(0), msg.sender, amount);
            }
        } catch {
            owed[msg.sender] = amount;
            emit PaymentHeld(bytes32(0), msg.sender, amount);
        }
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
        _sendOrHold(paymentId, r.seller, r.amount); // DELTA (V1.1): was require(usdc.transfer(...))
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

    function _void(bytes32 paymentId, Receipt storage r) internal {
        r.status = Status.VOIDED;
        _sendOrHold(paymentId, r.buyer, r.amount); // DELTA (V1.1): was require(usdc.transfer(...))
        emit RaincheckVoided(paymentId, r.amount, r.buyer);
    }

    function void(bytes32 paymentId) external {
        Receipt storage r = receipts[paymentId];
        require(r.status == Status.FLAGGED, "not FLAGGED");

        _void(paymentId, r);
    }

    function voidAfterDeadline(bytes32 paymentId) external {
        Receipt storage r = receipts[paymentId];
        require(r.status == Status.OPEN, "not OPEN");
        require(block.timestamp > r.deadline, "deadline not passed");

        _void(paymentId, r);
    }
}
