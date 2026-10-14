// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "forge-std/Test.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
// Selective import: src/RaincheckEscrow.sol declares a file-level IERC20 that
// would collide with OpenZeppelin's IERC20 on a plain import.
import {RaincheckEscrowV2} from "../src/RaincheckEscrowV2.sol";

/// @notice Real ERC20 standing in for Arc USDC (6 decimals, production balance/allowance
/// accounting via OpenZeppelin's ERC20). This is NOT a mock of the system under test:
/// the escrow is exercised against real token logic; only the mint is test-only.
contract TestUSDC is ERC20 {
    constructor() ERC20("USD Coin", "USDC") {}

    function decimals() public pure override returns (uint8) {
        return 6;
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}

/// @title RaincheckCore — full state-machine tests for RaincheckEscrowV2 (production)
/// @notice Source of truth: ~/workspace/your_files/raincheck-build-bible.md §§4.1, 6.
/// @notice Target: src/RaincheckEscrowV2.sol — the production contract (bible §4.1 spec:
///         challengeWindow = 300s constant, plus the three trust-stack deltas).
///         src/RaincheckEscrow.sol is the verified R9 experiment artifact and is NOT
///         modified by these tests.
///
/// CHALLENGE-WINDOW NOTE: the task brief asked for a SHORT window "for test speed".
/// V2 pins challengeWindow = 300 as a spec constant (not configurable by design —
/// the window is a consensus safety parameter, not a deployment knob). Test speed
/// is unaffected: every window wait is a vm.warp, i.e. virtual time, so the full
/// OPEN -> ATTESTED -> CAPTURED lifecycle runs in milliseconds. All window math
/// below reads the on-chain constant via escrow.challengeWindow().
///
/// ORDINAL CAUTION (bible §4.1): the Status enum ordinals are a source-layout
/// detail. These tests compare against named enum members
/// (RaincheckEscrowV2.Status.OPEN, ...) and NEVER hardcode numeric ordinals.
contract RaincheckCoreTest is Test {
    RaincheckEscrowV2 internal escrow;
    TestUSDC internal usdc;

    address internal buyer;
    address internal seller;
    address internal stranger; // unrelated third party: exercises the permissionless paths

    uint256 internal constant AMOUNT = 1_000_000; // 1.00 USDC, 6 decimals
    uint256 internal constant BUYER_START = 10_000_000; // 10.00 USDC

    function setUp() public {
        usdc = new TestUSDC();
        // Production contract: challengeWindow = 300s (spec value). Warped in tests.
        escrow = new RaincheckEscrowV2(address(usdc));

        buyer = makeAddr("buyer");
        seller = makeAddr("seller");
        stranger = makeAddr("stranger");

        usdc.mint(buyer, BUYER_START);
    }

    // ---------------------------------------------------------------- helpers

    /// @dev Opens a receipt as `buyer` (approves + 5-param authorize). Returns the deadline.
    function _open(bytes32 paymentId, uint256 amount) internal returns (uint256 deadline) {
        deadline = block.timestamp + 1 days;
        vm.startPrank(buyer);
        usdc.approve(address(escrow), amount);
        escrow.authorize(paymentId, keccak256("terms"), seller, amount, deadline);
        vm.stopPrank();
    }

    /// @dev Opens a receipt and attests delivery as `seller`. Returns attestedAt.
    function _openAndAttest(bytes32 paymentId, uint256 amount) internal returns (uint256 attestedAt) {
        _open(paymentId, amount);
        vm.prank(seller);
        escrow.attestDelivery(paymentId, keccak256("delivered-bytes"));
        attestedAt = block.timestamp;
    }

    function _status(bytes32 paymentId) internal view returns (RaincheckEscrowV2.Status) {
        // getPayment returns 4 values (not the 11 of receipts()): no stack pressure.
        (RaincheckEscrowV2.Status status,,,) = escrow.getPayment(paymentId);
        return status;
    }

    /// @dev Reads the trust-stack composition refs. The public receipts() getter
    /// returns 11 values, which trips solc "stack too deep" (optimizer OFF) when
    /// destructured inside a busy test function — hence this dedicated helper
    /// with minimal live locals.
    function _refs(bytes32 paymentId) internal view returns (bytes32 policyRef, bytes32 fundingRef) {
        (,,,,,,,, policyRef, fundingRef,) = escrow.receipts(paymentId);
    }

    // ------------------------------------------------------------- the window

    function test_ChallengeWindow_IsSpecValue() public view {
        // Production spec value per bible §4.1: 300s. Not a test deviation.
        assertEq(escrow.challengeWindow(), 300, "challengeWindow must be the 300s spec value");
    }

    // ------------------------------------------------------- 1. happy path

    function test_HappyPath_OpenAttestCapture_ExactAccounting() public {
        bytes32 paymentId = keccak256("happy-path");
        uint256 window = escrow.challengeWindow();
        bytes32 termsHash = keccak256("terms");
        uint256 deadline = block.timestamp + 1 days;

        // OPEN: funds are pulled exactly, receipt fields recorded, refs zeroed (standalone).
        vm.startPrank(buyer);
        usdc.approve(address(escrow), AMOUNT);
        vm.expectEmit(true, true, true, true);
        emit RaincheckEscrowV2.RaincheckOpened(paymentId, buyer, seller, termsHash, AMOUNT, deadline);
        escrow.authorize(paymentId, termsHash, seller, AMOUNT, deadline);
        vm.stopPrank();

        // Receipt core fields, read via the 4-value getPayment view (see _status note).
        // buyer/deadline are proven by the exact RaincheckOpened event above and by
        // the refund landing on the buyer in the void tests.
        (RaincheckEscrowV2.Status rStatus, address rSeller, uint256 rAmount, bytes32 rTerms) =
            escrow.getPayment(paymentId);
        assertTrue(rStatus == RaincheckEscrowV2.Status.OPEN, "status should be OPEN");
        assertEq(rTerms, termsHash, "termsHash not recorded");
        assertEq(rSeller, seller, "seller not recorded");
        assertEq(rAmount, AMOUNT, "amount not recorded");
        (bytes32 rPolicyRef, bytes32 rFundingRef) = _refs(paymentId);
        assertEq(rPolicyRef, bytes32(0), "5-param authorize must zero policyRef");
        assertEq(rFundingRef, bytes32(0), "5-param authorize must zero fundingRef");
        assertEq(usdc.balanceOf(buyer), BUYER_START - AMOUNT, "buyer not debited exactly");
        assertEq(usdc.balanceOf(address(escrow)), AMOUNT, "escrow not credited exactly");

        // ATTESTED: seller posts the output hash; window opens.
        bytes32 outputHash = keccak256("delivered-bytes");
        vm.prank(seller);
        vm.expectEmit(true, false, false, true);
        emit RaincheckEscrowV2.DeliveryAttested(paymentId, outputHash, block.timestamp);
        escrow.attestDelivery(paymentId, outputHash);
        uint256 attestedAt = block.timestamp;
        assertTrue(_status(paymentId) == RaincheckEscrowV2.Status.ATTESTED, "status should be ATTESTED");

        // capture one second before the window closes must revert.
        vm.warp(attestedAt + window - 1);
        vm.expectRevert("challenge window open");
        escrow.capture(paymentId);

        // CAPTURED: anyone may finalize once the window closes (boundary inclusive).
        // Payout goes to the RECORDED seller — attest carries no payout address,
        // so attest cannot redirect funds (payout-address discipline).
        vm.warp(attestedAt + window);
        vm.prank(stranger);
        vm.expectEmit(true, false, false, true);
        emit RaincheckEscrowV2.RaincheckCaptured(paymentId, AMOUNT);
        escrow.capture(paymentId);

        assertTrue(_status(paymentId) == RaincheckEscrowV2.Status.CAPTURED, "status should be CAPTURED");
        assertEq(usdc.balanceOf(seller), AMOUNT, "seller not paid exactly");
        assertEq(usdc.balanceOf(address(escrow)), 0, "escrow not drained");
        assertEq(usdc.balanceOf(buyer), BUYER_START - AMOUNT, "buyer balance moved unexpectedly");
    }

    // ------------------------------------------------------- 2. dispute path

    function test_DisputePath_OpenFlagVoid_FullRefund() public {
        bytes32 paymentId = keccak256("dispute-path");
        uint256 window = escrow.challengeWindow();
        uint256 attestedAt = _openAndAttest(paymentId, AMOUNT);

        // FLAGGED: buyer flags inside the challenge window.
        bytes32 reasonHash = keccak256("garbage-bytes");
        vm.warp(attestedAt + window / 2);
        vm.prank(buyer);
        vm.expectEmit(true, false, false, true);
        emit RaincheckEscrowV2.NonDeliveryFlagged(paymentId, reasonHash);
        escrow.flagNonDelivery(paymentId, reasonHash);
        assertTrue(_status(paymentId) == RaincheckEscrowV2.Status.FLAGGED, "status should be FLAGGED");

        // a flagged receipt can never be captured.
        vm.expectRevert("not ATTESTED");
        escrow.capture(paymentId);

        // VOIDED: void is permissionless; the buyer is refunded IN FULL.
        // DELTA: the seller's dispute counter increments exactly once.
        vm.prank(stranger);
        vm.expectEmit(true, true, false, true);
        emit RaincheckEscrowV2.RaincheckVoided(paymentId, AMOUNT, buyer);
        escrow.void(paymentId);

        assertTrue(_status(paymentId) == RaincheckEscrowV2.Status.VOIDED, "status should be VOIDED");
        assertEq(escrow.disputes(seller), 1, "void() must increment disputesBySeller once");
        assertEq(usdc.balanceOf(buyer), BUYER_START, "buyer not refunded in full");
        assertEq(usdc.balanceOf(seller), 0, "seller received funds on voided receipt");
        assertEq(usdc.balanceOf(address(escrow)), 0, "escrow not drained");
    }

    // ------------------------------------------------------- 3. deadline void

    function test_VoidAfterDeadline_SellerNeverAttests_FullRefund() public {
        bytes32 paymentId = keccak256("deadline-void");
        uint256 deadline = _open(paymentId, AMOUNT);
        assertTrue(_status(paymentId) == RaincheckEscrowV2.Status.OPEN, "status should be OPEN");

        // before the deadline the refund path is closed.
        vm.expectRevert("deadline not passed");
        escrow.voidAfterDeadline(paymentId);

        // after the deadline, anyone can trigger the full refund — funds never trap.
        // DELTA: the dispute counter is NOT touched (liveness != dishonesty).
        vm.warp(deadline + 1);
        vm.prank(stranger);
        vm.expectEmit(true, true, false, true);
        emit RaincheckEscrowV2.RaincheckVoided(paymentId, AMOUNT, buyer);
        escrow.voidAfterDeadline(paymentId);

        assertTrue(_status(paymentId) == RaincheckEscrowV2.Status.VOIDED, "status should be VOIDED");
        assertEq(escrow.disputes(seller), 0, "voidAfterDeadline must NOT increment disputesBySeller");
        assertEq(usdc.balanceOf(buyer), BUYER_START, "buyer not refunded in full");
        assertEq(usdc.balanceOf(address(escrow)), 0, "escrow not drained");
    }

    // ------------------------------------------------------- 4. idempotency

    function test_PaymentIdReuse_Reverts_Idempotency() public {
        // reuse while OPEN
        bytes32 pidOpen = keccak256("reuse-open");
        _open(pidOpen, AMOUNT);
        vm.startPrank(buyer);
        usdc.approve(address(escrow), AMOUNT);
        vm.expectRevert("paymentId already used");
        escrow.authorize(pidOpen, keccak256("terms"), seller, AMOUNT, block.timestamp + 1 days);
        vm.stopPrank();

        // reuse after a FULL lifecycle (OPEN -> ATTESTED -> CAPTURED): a retried
        // task can never double-charge.
        bytes32 pidDone = keccak256("reuse-done");
        uint256 attestedAt = _openAndAttest(pidDone, AMOUNT);
        vm.warp(attestedAt + escrow.challengeWindow());
        escrow.capture(pidDone);
        assertTrue(_status(pidDone) == RaincheckEscrowV2.Status.CAPTURED, "setup: should be CAPTURED");

        vm.startPrank(buyer);
        usdc.approve(address(escrow), AMOUNT);
        vm.expectRevert("paymentId already used");
        escrow.authorize(pidDone, keccak256("terms"), seller, AMOUNT, block.timestamp + 1 days);
        vm.stopPrank();
    }

    // ------------------------------------------------------- 5. attest authz

    function test_AttestDelivery_OnlyRecordedSeller() public {
        bytes32 paymentId = keccak256("attest-seller-only");
        _open(paymentId, AMOUNT);
        bytes32 outputHash = keccak256("delivered-bytes");

        vm.prank(buyer);
        vm.expectRevert("seller only");
        escrow.attestDelivery(paymentId, outputHash);

        vm.prank(stranger);
        vm.expectRevert("seller only");
        escrow.attestDelivery(paymentId, outputHash);

        // the recorded seller succeeds.
        vm.prank(seller);
        escrow.attestDelivery(paymentId, outputHash);
        assertTrue(_status(paymentId) == RaincheckEscrowV2.Status.ATTESTED, "status should be ATTESTED");

        // even the seller cannot attest past the deadline.
        bytes32 pidLate = keccak256("attest-past-deadline");
        uint256 deadline = _open(pidLate, AMOUNT);
        vm.warp(deadline + 1);
        vm.prank(seller);
        vm.expectRevert("past deadline");
        escrow.attestDelivery(pidLate, outputHash);
    }

    // ------------------------------------------------------- 6. flag authz

    function test_FlagNonDelivery_OnlyRecordedBuyer() public {
        bytes32 paymentId = keccak256("flag-buyer-only");
        _openAndAttest(paymentId, AMOUNT);
        bytes32 reasonHash = keccak256("garbage");

        vm.prank(seller);
        vm.expectRevert("buyer only");
        escrow.flagNonDelivery(paymentId, reasonHash);

        vm.prank(stranger);
        vm.expectRevert("buyer only");
        escrow.flagNonDelivery(paymentId, reasonHash);

        // the recorded buyer succeeds.
        vm.prank(buyer);
        escrow.flagNonDelivery(paymentId, reasonHash);
        assertTrue(_status(paymentId) == RaincheckEscrowV2.Status.FLAGGED, "status should be FLAGGED");
    }

    // ------------------------------------------------------- 7. early capture

    function test_Capture_Reverts_BeforeWindowCloses() public {
        uint256 window = escrow.challengeWindow();
        uint256 attestedAt = _openAndAttest(keccak256("capture-early"), AMOUNT);

        // capture on an OPEN (never attested) receipt reverts.
        _open(keccak256("capture-open-state"), AMOUNT);
        vm.expectRevert("not ATTESTED");
        escrow.capture(keccak256("capture-open-state"));

        // capture one second before the window closes reverts.
        vm.warp(attestedAt + window - 1);
        vm.expectRevert("challenge window open");
        escrow.capture(keccak256("capture-early"));
    }

    // ------------------------------------------------------- 8. late flag

    function test_Flag_Reverts_OutsideWindow() public {
        uint256 window = escrow.challengeWindow();

        // flag with no attestation at all (OPEN) reverts.
        _open(keccak256("flag-open-state"), AMOUNT);
        vm.prank(buyer);
        vm.expectRevert("not ATTESTED");
        escrow.flagNonDelivery(keccak256("flag-open-state"), keccak256("r"));

        // flag at the exact window boundary is still allowed (window is inclusive).
        bytes32 pidEdge = keccak256("flag-window-edge");
        uint256 attestedAtEdge = _openAndAttest(pidEdge, AMOUNT);
        vm.warp(attestedAtEdge + window);
        vm.prank(buyer);
        escrow.flagNonDelivery(pidEdge, keccak256("r"));
        assertTrue(_status(pidEdge) == RaincheckEscrowV2.Status.FLAGGED, "edge flag should succeed");

        // flag after the window closed reverts.
        bytes32 pidLate = keccak256("flag-late");
        uint256 attestedAt = _openAndAttest(pidLate, AMOUNT);
        vm.warp(attestedAt + window + 1);
        vm.prank(buyer);
        vm.expectRevert("challenge window closed");
        escrow.flagNonDelivery(pidLate, keccak256("r"));
    }

    // ------------------------------------------------------- 9. void authz

    function test_Void_Reverts_WhenNotFlagged() public {
        // NONE: receipt never opened.
        vm.expectRevert("not FLAGGED");
        escrow.void(keccak256("void-none"));

        // OPEN
        _open(keccak256("void-open"), AMOUNT);
        vm.expectRevert("not FLAGGED");
        escrow.void(keccak256("void-open"));

        // ATTESTED
        _openAndAttest(keccak256("void-attested"), AMOUNT);
        vm.expectRevert("not FLAGGED");
        escrow.void(keccak256("void-attested"));

        // CAPTURED (terminal): voiding a paid receipt is impossible.
        bytes32 pidCap = keccak256("void-captured");
        uint256 attestedAt = _openAndAttest(pidCap, AMOUNT);
        vm.warp(attestedAt + escrow.challengeWindow());
        escrow.capture(pidCap);
        vm.expectRevert("not FLAGGED");
        escrow.void(pidCap);
    }

    // ------------------------------------------------------- authorize checks

    function test_Authorize_Validation_ExactPull_AndEvents() public {
        uint256 deadline = block.timestamp + 1 days;
        bytes32 terms = keccak256("terms");

        vm.prank(buyer);
        vm.expectRevert("seller zero");
        escrow.authorize(keccak256("auth-v1"), terms, address(0), AMOUNT, deadline);

        vm.prank(buyer);
        vm.expectRevert("amount zero");
        escrow.authorize(keccak256("auth-v2"), terms, seller, 0, deadline);

        vm.prank(buyer);
        vm.expectRevert("deadline not in future");
        escrow.authorize(keccak256("auth-v3"), terms, seller, AMOUNT, block.timestamp);

        // without approval the pull fails: funds are actually moved, never assumed.
        vm.prank(buyer);
        vm.expectRevert();
        escrow.authorize(keccak256("auth-v4"), terms, seller, AMOUNT, deadline);

        // with approval: exact pull + event.
        bytes32 paymentId = keccak256("auth-v5");
        vm.startPrank(buyer);
        usdc.approve(address(escrow), AMOUNT);
        vm.expectEmit(true, true, true, true);
        emit RaincheckEscrowV2.RaincheckOpened(paymentId, buyer, seller, terms, AMOUNT, deadline);
        escrow.authorize(paymentId, terms, seller, AMOUNT, deadline);
        vm.stopPrank();

        assertEq(usdc.balanceOf(buyer), BUYER_START - AMOUNT, "buyer not debited exactly");
        assertEq(usdc.balanceOf(address(escrow)), AMOUNT, "escrow not credited exactly");
    }

    // ------------------------------------------------------- trust-stack deltas

    function test_GetPayment_ReturnsNamedFields() public {
        bytes32 paymentId = keccak256("get-payment");
        bytes32 termsHash = keccak256("terms");
        uint256 deadline = block.timestamp + 1 days;

        vm.startPrank(buyer);
        usdc.approve(address(escrow), AMOUNT);
        escrow.authorize(paymentId, termsHash, seller, AMOUNT, deadline);
        vm.stopPrank();

        (RaincheckEscrowV2.Status status, address gotSeller, uint256 gotAmount, bytes32 gotTerms) =
            escrow.getPayment(paymentId);
        assertTrue(status == RaincheckEscrowV2.Status.OPEN, "getPayment status should be OPEN");
        assertEq(gotSeller, seller, "getPayment seller mismatch");
        assertEq(gotAmount, AMOUNT, "getPayment amount mismatch");
        assertEq(gotTerms, termsHash, "getPayment termsHash mismatch");

        // unknown paymentId reports NONE.
        (RaincheckEscrowV2.Status unknownStatus,,,) = escrow.getPayment(keccak256("nope"));
        assertTrue(unknownStatus == RaincheckEscrowV2.Status.NONE, "unknown payment should be NONE");
    }

    function test_Authorize_WithRefs_StoresPolicyAndFundingRefs() public {
        bytes32 paymentId = keccak256("auth-refs");
        bytes32 policyRef = keccak256("policy:cap-100");
        bytes32 fundingRef = keccak256("daybook:ref-7");
        uint256 deadline = block.timestamp + 1 days;

        vm.startPrank(buyer);
        usdc.approve(address(escrow), AMOUNT);
        escrow.authorize(paymentId, keccak256("terms"), seller, AMOUNT, deadline, policyRef, fundingRef);
        vm.stopPrank();

        (bytes32 rPolicyRef, bytes32 rFundingRef) = _refs(paymentId);
        assertTrue(_status(paymentId) == RaincheckEscrowV2.Status.OPEN, "status should be OPEN");
        assertEq(rPolicyRef, policyRef, "policyRef not recorded");
        assertEq(rFundingRef, fundingRef, "fundingRef not recorded");
        // refs do not change the money path: full lifecycle still works.
        vm.prank(seller);
        escrow.attestDelivery(paymentId, keccak256("bytes"));
        vm.warp(block.timestamp + escrow.challengeWindow());
        escrow.capture(paymentId);
        assertTrue(_status(paymentId) == RaincheckEscrowV2.Status.CAPTURED, "ref'd receipt should capture");
        assertEq(usdc.balanceOf(seller), AMOUNT, "seller not paid on ref'd receipt");
    }

    function test_Disputes_IncrementedOnVoidOnly() public {
        uint256 window = escrow.challengeWindow();

        // path A: flag -> void => counter goes to 1.
        bytes32 pidA = keccak256("disputes-a");
        uint256 attestedAt = _openAndAttest(pidA, AMOUNT);
        vm.warp(attestedAt + window / 2);
        vm.prank(buyer);
        escrow.flagNonDelivery(pidA, keccak256("r"));
        escrow.void(pidA);
        assertEq(escrow.disputes(seller), 1, "void() must increment disputesBySeller");

        // path B: voidAfterDeadline => counter UNCHANGED (liveness != dishonesty).
        bytes32 pidB = keccak256("disputes-b");
        uint256 deadline = _open(pidB, AMOUNT);
        vm.warp(deadline + 1);
        escrow.voidAfterDeadline(pidB);
        assertEq(escrow.disputes(seller), 1, "voidAfterDeadline must not touch disputesBySeller");

        // path C: capture => counter UNCHANGED.
        bytes32 pidC = keccak256("disputes-c");
        uint256 attestedAtC = _openAndAttest(pidC, AMOUNT);
        vm.warp(attestedAtC + window);
        escrow.capture(pidC);
        assertEq(escrow.disputes(seller), 1, "capture must not touch disputesBySeller");

        // second void against the same seller => counter goes to 2 (per-seller tally).
        bytes32 pidD = keccak256("disputes-d");
        uint256 attestedAtD = _openAndAttest(pidD, AMOUNT);
        vm.warp(attestedAtD + window / 2);
        vm.prank(buyer);
        escrow.flagNonDelivery(pidD, keccak256("r"));
        escrow.void(pidD);
        assertEq(escrow.disputes(seller), 2, "second void must increment again");
    }
}
