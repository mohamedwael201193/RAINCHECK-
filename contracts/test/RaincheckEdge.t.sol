// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import {RaincheckEscrow} from "../src/RaincheckEscrow.sol";

/// @notice Minimal 6-decimal ERC20 with a REAL balance ledger (genuine
///         accounting on every transfer, no canned return values) used as the
///         USDC stand-in for these edge tests. This is a real token
///         implementation, not a mocked stub — the escrow pulls and pushes
///         actual balances through it.
contract EdgeTestUSDC {
    string public name = "USD Coin";
    string public symbol = "USDC";
    uint8 public decimals = 6;

    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    event Transfer(address indexed from, address indexed to, uint256 amount);
    event Approval(address indexed owner, address indexed spender, uint256 amount);

    function mint(address to, uint256 amount) external {
        balanceOf[to] += amount;
        emit Transfer(address(0), to, amount);
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        emit Approval(msg.sender, spender, amount);
        return true;
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        require(balanceOf[msg.sender] >= amount, "insufficient balance");
        balanceOf[msg.sender] -= amount;
        balanceOf[to] += amount;
        emit Transfer(msg.sender, to, amount);
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        require(balanceOf[from] >= amount, "insufficient balance");
        require(allowance[from][msg.sender] >= amount, "insufficient allowance");
        if (allowance[from][msg.sender] != type(uint256).max) {
            allowance[from][msg.sender] -= amount;
        }
        balanceOf[from] -= amount;
        balanceOf[to] += amount;
        emit Transfer(from, to, amount);
        return true;
    }
}

/// @notice Edge-case + invariant tests for RaincheckEscrow (core escrow).
/// @dev STATUS IS ASSERTED BY NAME ONLY. Every status comparison uses the
///      `RaincheckEscrow.Status` enum symbol (e.g. `.FLAGGED`), never a numeric
///      literal — enum ordinals are a source-layout detail (see build bible
///      §4.1: the void-path deployment reported VOIDED at ordinal 5 while the
///      source lists it fourth). If the enum is ever reordered, these tests
///      keep passing as long as the STATE MACHINE (names) is unchanged.
contract RaincheckEdgeTest is Test {
    RaincheckEscrow internal escrow;
    EdgeTestUSDC internal usdc;

    address internal buyer = address(0xB0B);
    address internal seller = address(0x5E11E);
    address internal keeper = address(0xCEEA);

    uint256 internal constant BUYER_FUNDS = 1_000_000_000_000; // 1M USDC in 6-decimal units

    function setUp() public {
        usdc = new EdgeTestUSDC();
        escrow = new RaincheckEscrow(address(usdc));
        usdc.mint(buyer, BUYER_FUNDS);
        vm.prank(buyer);
        usdc.approve(address(escrow), type(uint256).max);
        vm.warp(1_700_000_000); // deterministic chain time for deadlines
    }

    // ------------------------------------------------------------------
    // helpers
    // ------------------------------------------------------------------

    /// @dev Read the recorded status BY NAME (enum symbol, never an ordinal).
    function _statusOf(bytes32 paymentId) internal view returns (RaincheckEscrow.Status) {
        (,,,,,,,, RaincheckEscrow.Status st) = escrow.receipts(paymentId);
        return st;
    }

    function _open(bytes32 paymentId, uint256 amount) internal {
        vm.prank(buyer);
        escrow.authorize(paymentId, keccak256("terms"), seller, amount, block.timestamp + 1 days);
    }

    function _attest(bytes32 paymentId, bytes32 outputHash) internal {
        vm.prank(seller);
        escrow.attestDelivery(paymentId, outputHash);
    }

    function _window() internal view returns (uint256) {
        return escrow.challengeWindow(); // read from the contract, never hardcoded
    }

    // ------------------------------------------------------------------
    // (1) INVARIANT — attestDelivery can NEVER redirect payout
    // ------------------------------------------------------------------

    /// @notice Fuzzed invariant: no caller, no outputHash, can redirect the
    ///         capture payout. Funds must ALWAYS land on the recorded seller.
    function testFuzz_Invariant_AttestNeverRedirectsCapture(
        bytes32 outputHash,
        address attacker,
        uint256 rawAmount
    ) public {
        uint256 amount = bound(rawAmount, 1, 50_000_000); // 0.000001–50 USDC
        bytes32 pid = keccak256("edge-capture-invariant");

        vm.assume(attacker != address(0));
        vm.assume(attacker != buyer && attacker != seller);
        vm.assume(attacker != address(escrow) && attacker != address(usdc));

        _open(pid, amount);

        // Attacker attempts attest before the seller: must always revert.
        vm.prank(attacker);
        vm.expectRevert("seller only");
        escrow.attestDelivery(pid, outputHash);

        uint256 sellerBefore = usdc.balanceOf(seller);
        uint256 buyerBefore = usdc.balanceOf(buyer);
        uint256 escrowBefore = usdc.balanceOf(address(escrow));

        // The real seller attests with a fuzzed outputHash; the hash must not
        // influence WHERE the money goes.
        _attest(pid, outputHash);

        // Attacker tries again after attestation: state no longer OPEN.
        vm.prank(attacker);
        vm.expectRevert("not OPEN");
        escrow.attestDelivery(pid, keccak256("evil-hash"));

        // Challenge window closes; anyone (even the attacker) may finalize.
        vm.warp(block.timestamp + _window() + 1);
        vm.prank(attacker);
        escrow.capture(pid);

        assertTrue(_statusOf(pid) == RaincheckEscrow.Status.CAPTURED, "status not CAPTURED");
        assertEq(usdc.balanceOf(seller), sellerBefore + amount, "INVARIANT VIOLATED: seller not paid exactly amount");
        assertEq(usdc.balanceOf(buyer), buyerBefore, "INVARIANT VIOLATED: buyer balance moved on capture");
        assertEq(usdc.balanceOf(address(escrow)), escrowBefore - amount, "INVARIANT VIOLATED: escrow not drained exactly");
    }

    /// @notice Fuzzed invariant: no caller, no outputHash, can redirect the
    ///         void refund. Funds must ALWAYS land on the recorded buyer.
    function testFuzz_Invariant_AttestNeverRedirectsVoid(
        bytes32 outputHash,
        address attacker,
        uint256 rawAmount
    ) public {
        uint256 amount = bound(rawAmount, 1, 50_000_000);
        bytes32 pid = keccak256("edge-void-invariant");

        vm.assume(attacker != address(0));
        vm.assume(attacker != buyer && attacker != seller);
        vm.assume(attacker != address(escrow) && attacker != address(usdc));

        _open(pid, amount);

        // Attacker attest attempt must revert (not the seller).
        vm.prank(attacker);
        vm.expectRevert("seller only");
        escrow.attestDelivery(pid, outputHash);

        uint256 sellerBefore = usdc.balanceOf(seller);
        uint256 buyerBefore = usdc.balanceOf(buyer);
        uint256 escrowBefore = usdc.balanceOf(address(escrow));

        _attest(pid, outputHash);

        // Attacker tries to flag as non-buyer: must revert.
        vm.prank(attacker);
        vm.expectRevert("buyer only");
        escrow.flagNonDelivery(pid, keccak256("reason"));

        // The recorded buyer flags inside the window; anyone may void.
        vm.prank(buyer);
        escrow.flagNonDelivery(pid, keccak256("garbage bytes"));
        assertTrue(_statusOf(pid) == RaincheckEscrow.Status.FLAGGED, "status not FLAGGED");

        vm.prank(attacker); // permissionless void, submitted by a stranger
        escrow.void(pid);

        assertTrue(_statusOf(pid) == RaincheckEscrow.Status.VOIDED, "status not VOIDED");
        assertEq(usdc.balanceOf(buyer), buyerBefore + amount, "INVARIANT VIOLATED: buyer not refunded exactly amount");
        assertEq(usdc.balanceOf(seller), sellerBefore, "INVARIANT VIOLATED: seller balance moved on void");
        assertEq(usdc.balanceOf(address(escrow)), escrowBefore - amount, "INVARIANT VIOLATED: escrow not drained exactly");
    }

    // ------------------------------------------------------------------
    // (2) double-capture reverts
    // ------------------------------------------------------------------

    function test_DoubleCaptureReverts() public {
        bytes32 pid = keccak256("edge-double-capture");
        _open(pid, 1000);
        _attest(pid, keccak256("delivered-bytes"));
        vm.warp(block.timestamp + _window() + 1);

        vm.prank(keeper);
        escrow.capture(pid);
        assertTrue(_statusOf(pid) == RaincheckEscrow.Status.CAPTURED, "status not CAPTURED");

        vm.prank(keeper);
        vm.expectRevert("not ATTESTED");
        escrow.capture(pid);
    }

    // ------------------------------------------------------------------
    // (3) flag after the challenge window closes reverts
    // ------------------------------------------------------------------

    function test_FlagAfterWindowClosesReverts() public {
        bytes32 pid = keccak256("edge-flag-after-window");
        _open(pid, 1000);
        _attest(pid, keccak256("delivered-bytes"));

        vm.warp(block.timestamp + _window() + 1); // window closed

        vm.prank(buyer);
        vm.expectRevert("challenge window closed");
        escrow.flagNonDelivery(pid, keccak256("too late"));
    }

    // ------------------------------------------------------------------
    // (4) capture before the challenge window closes reverts
    // ------------------------------------------------------------------

    function test_CaptureBeforeWindowClosesReverts() public {
        bytes32 pid = keccak256("edge-capture-early");
        _open(pid, 1000);
        _attest(pid, keccak256("delivered-bytes"));

        vm.warp(block.timestamp + _window() - 1); // still inside the window

        vm.prank(keeper);
        vm.expectRevert("challenge window open");
        escrow.capture(pid);
    }

    // ------------------------------------------------------------------
    // (5) void without FLAGGED reverts
    // ------------------------------------------------------------------

    function test_VoidWithoutFlaggedReverts_FromOpen() public {
        bytes32 pid = keccak256("edge-void-from-open");
        _open(pid, 1000);
        assertTrue(_statusOf(pid) == RaincheckEscrow.Status.OPEN, "status not OPEN");

        vm.prank(keeper);
        vm.expectRevert("not FLAGGED");
        escrow.void(pid);
    }

    function test_VoidWithoutFlaggedReverts_FromAttested() public {
        bytes32 pid = keccak256("edge-void-from-attested");
        _open(pid, 1000);
        _attest(pid, keccak256("delivered-bytes"));
        vm.warp(block.timestamp + _window() + 1);
        assertTrue(_statusOf(pid) == RaincheckEscrow.Status.ATTESTED, "status not ATTESTED");

        vm.prank(keeper);
        vm.expectRevert("not FLAGGED");
        escrow.void(pid);
    }

    // ------------------------------------------------------------------
    // (6) authorize reverts on zero amount, zero seller, past deadline
    // ------------------------------------------------------------------

    function test_AuthorizeRevertsOnZeroAmount() public {
        vm.prank(buyer);
        vm.expectRevert("amount zero");
        escrow.authorize(keccak256("edge-zero-amount"), keccak256("terms"), seller, 0, block.timestamp + 1 days);
    }

    function test_AuthorizeRevertsOnZeroSeller() public {
        vm.prank(buyer);
        vm.expectRevert("seller zero");
        escrow.authorize(keccak256("edge-zero-seller"), keccak256("terms"), address(0), 1000, block.timestamp + 1 days);
    }

    function test_AuthorizeRevertsOnPastDeadline() public {
        vm.prank(buyer);
        vm.expectRevert("deadline not in future");
        escrow.authorize(keccak256("edge-past-deadline"), keccak256("terms"), seller, 1000, block.timestamp);
    }

    // ------------------------------------------------------------------
    // (7) STATUS-BY-NAME — full state machine, names only, never ordinals
    // ------------------------------------------------------------------

    function test_StatusTransitionsByName_DeliverPath() public {
        bytes32 pid = keccak256("edge-status-deliver");

        assertTrue(_statusOf(pid) == RaincheckEscrow.Status.NONE, "fresh pid not NONE");
        _open(pid, 1000);
        assertTrue(_statusOf(pid) == RaincheckEscrow.Status.OPEN, "after authorize not OPEN");
        _attest(pid, keccak256("delivered-bytes"));
        assertTrue(_statusOf(pid) == RaincheckEscrow.Status.ATTESTED, "after attest not ATTESTED");

        vm.warp(block.timestamp + _window() + 1);
        vm.prank(keeper);
        escrow.capture(pid);
        assertTrue(_statusOf(pid) == RaincheckEscrow.Status.CAPTURED, "after capture not CAPTURED");
    }

    function test_StatusTransitionsByName_VoidPath() public {
        bytes32 pid = keccak256("edge-status-void");

        _open(pid, 1000);
        assertTrue(_statusOf(pid) == RaincheckEscrow.Status.OPEN, "after authorize not OPEN");
        _attest(pid, keccak256("garbage-bytes"));
        assertTrue(_statusOf(pid) == RaincheckEscrow.Status.ATTESTED, "after attest not ATTESTED");

        vm.prank(buyer);
        escrow.flagNonDelivery(pid, keccak256("non-delivery"));
        assertTrue(_statusOf(pid) == RaincheckEscrow.Status.FLAGGED, "after flag not FLAGGED");

        vm.prank(keeper);
        escrow.void(pid);
        assertTrue(_statusOf(pid) == RaincheckEscrow.Status.VOIDED, "after void not VOIDED");
    }

    function test_StatusTransitionsByName_DeadlineVoidPath() public {
        bytes32 pid = keccak256("edge-status-deadline-void");

        _open(pid, 1000);
        assertTrue(_statusOf(pid) == RaincheckEscrow.Status.OPEN, "after authorize not OPEN");

        vm.warp(block.timestamp + 1 days + 1); // deadline passed, never attested
        vm.prank(keeper);
        escrow.voidAfterDeadline(pid);
        assertTrue(_statusOf(pid) == RaincheckEscrow.Status.VOIDED, "after voidAfterDeadline not VOIDED");
    }
}
