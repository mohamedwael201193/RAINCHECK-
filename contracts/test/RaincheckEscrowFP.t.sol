// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "forge-std/Test.sol";
import {RaincheckEscrowFP} from "../src/RaincheckEscrowFP.sol";
import {PausableTestToken} from "../src/PausableTestToken.sol";

/// @title RaincheckEscrowFP freeze-proof tests
/// @notice Uses a pausable mock token to simulate a FROZEN token: when paused,
///         every transfer reverts. On V1 (RaincheckEscrow) this bricks the
///         receipt; on FP the state transition completes and funds land in
///         `owed[]` for later permissionless withdrawal.
contract RaincheckEscrowFPTest is Test {
    RaincheckEscrowFP internal escrow;
    PausableTestToken internal token;
    address internal buyer = address(0xB0B);
    address internal seller = address(0x5E11);

    bytes32 internal constant PAYMENT_ID = keccak256("fp-payment-1");
    bytes32 internal constant TERMS = keccak256("fp-terms");
    uint256 internal constant AMOUNT = 10_000; // 0.01 token

    event PaymentHeld(bytes32 indexed paymentId, address indexed to, uint256 amount);
    event RaincheckCaptured(bytes32 indexed paymentId, uint256 amount);
    event RaincheckVoided(bytes32 indexed paymentId, uint256 amount, address indexed refundedTo);

    function setUp() public {
        token = new PausableTestToken(1_000_000_000);
        escrow = new RaincheckEscrowFP(address(token));
        token.transfer(buyer, 1_000_000);
        vm.prank(buyer);
        token.approve(address(escrow), type(uint256).max);
    }

    function _authorize(bytes32 paymentId) internal {
        vm.prank(buyer);
        escrow.authorize(paymentId, TERMS, seller, AMOUNT, block.timestamp + 1 days);
    }

    function _attest(bytes32 paymentId) internal {
        vm.prank(seller);
        escrow.attestDelivery(paymentId, keccak256("output"));
    }

    // ---------- happy path unchanged ----------

    function test_HappyPath_Unchanged() public {
        uint256 sellerBefore = token.balanceOf(seller);
        _authorize(PAYMENT_ID);
        _attest(PAYMENT_ID);
        vm.warp(block.timestamp + 301);

        vm.expectEmit(true, false, false, true);
        emit RaincheckCaptured(PAYMENT_ID, AMOUNT);
        escrow.capture(PAYMENT_ID);

        assertEq(token.balanceOf(seller), sellerBefore + AMOUNT, "seller paid directly");
        assertEq(escrow.owed(seller), 0, "nothing held");
    }

    function test_ChallengeWindow_Still300() public {
        assertEq(escrow.challengeWindow(), 300, "V1.1 keeps 300s window");
    }

    function test_PreAttestationCapture_StillReverts() public {
        _authorize(PAYMENT_ID);
        vm.expectRevert("not ATTESTED");
        escrow.capture(PAYMENT_ID);
    }

    // ---------- freeze: capture path ----------

    function test_FrozenCapture_DoesNotRevert_HoldsPayment() public {
        _authorize(PAYMENT_ID);
        _attest(PAYMENT_ID);
        token.pause(); // token freezes AFTER escrow pulled the principal in
        vm.warp(block.timestamp + 301);

        vm.expectEmit(true, true, false, true);
        emit PaymentHeld(PAYMENT_ID, seller, AMOUNT);
        escrow.capture(PAYMENT_ID); // must NOT revert

        assertEq(escrow.owed(seller), AMOUNT, "owed[seller] credited");
        assertEq(token.balanceOf(seller), 0, "seller not paid while frozen");
    }

    function test_WithdrawAfterUnpause_PaysOut() public {
        _authorize(PAYMENT_ID);
        _attest(PAYMENT_ID);
        token.pause();
        vm.warp(block.timestamp + 301);
        escrow.capture(PAYMENT_ID);
        assertEq(escrow.owed(seller), AMOUNT);

        token.unpause();
        uint256 sellerBefore = token.balanceOf(seller);
        vm.prank(seller);
        escrow.withdraw();

        assertEq(token.balanceOf(seller), sellerBefore + AMOUNT, "withdraw pays out");
        assertEq(escrow.owed(seller), 0, "owed cleared");
    }

    function test_WithdrawWhileFrozen_ReHolds() public {
        _authorize(PAYMENT_ID);
        _attest(PAYMENT_ID);
        token.pause();
        vm.warp(block.timestamp + 301);
        escrow.capture(PAYMENT_ID);

        vm.prank(seller);
        escrow.withdraw(); // must NOT revert; re-holds

        assertEq(escrow.owed(seller), AMOUNT, "re-held on failed withdraw");
    }

    function test_WithdrawNothing_Reverts() public {
        vm.prank(seller);
        vm.expectRevert("nothing owed");
        escrow.withdraw();
    }

    // ---------- freeze: void path ----------

    function test_FrozenVoid_HoldsRefund() public {
        bytes32 pid = keccak256("fp-payment-void");
        _authorize(pid);
        _attest(pid);
        vm.prank(buyer);
        escrow.flagNonDelivery(pid, keccak256("reason"));
        token.pause();
        uint256 buyerBefore = token.balanceOf(buyer);

        vm.expectEmit(true, true, false, true);
        emit PaymentHeld(pid, buyer, AMOUNT);
        escrow.void(pid); // must NOT revert

        assertEq(escrow.owed(buyer), AMOUNT, "owed[buyer] credited");
        assertEq(token.balanceOf(buyer), buyerBefore, "buyer not refunded while frozen");

        token.unpause();
        vm.prank(buyer);
        escrow.withdraw();
        assertEq(token.balanceOf(buyer), buyerBefore + AMOUNT, "refund recovered via withdraw");
    }

    function test_FrozenVoidAfterDeadline_HoldsRefund() public {
        bytes32 pid = keccak256("fp-payment-deadline");
        vm.prank(buyer);
        escrow.authorize(pid, TERMS, seller, AMOUNT, block.timestamp + 100);
        token.pause();
        vm.warp(block.timestamp + 101);

        escrow.voidAfterDeadline(pid); // must NOT revert
        assertEq(escrow.owed(buyer), AMOUNT, "deadline-void refund held");
    }
}
