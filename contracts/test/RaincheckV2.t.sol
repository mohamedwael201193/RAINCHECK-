// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import {RaincheckEscrowV2} from "../src/RaincheckEscrowV2.sol";
import {RaincheckEscrow} from "../src/RaincheckEscrow.sol";

/// @notice Minimal 6-decimal mock USDC for testing only. Not a mainnet stand-in.
contract MockUSDC {
    string public name = "USD Coin";
    string public symbol = "USDC";
    uint8 public decimals = 6;
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    function mint(address to, uint256 amount) external {
        balanceOf[to] += amount;
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        return true;
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        require(balanceOf[msg.sender] >= amount, "insufficient");
        balanceOf[msg.sender] -= amount;
        balanceOf[to] += amount;
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        require(balanceOf[from] >= amount, "insufficient");
        require(allowance[from][msg.sender] >= amount, "allowance");
        allowance[from][msg.sender] -= amount;
        balanceOf[from] -= amount;
        balanceOf[to] += amount;
        return true;
    }
}

/// @notice Trust-stack delta tests for RaincheckEscrowV2 (SPECIFIED-NOT-LIVE).
/// @dev State machine is asserted by NAME (enum member), never by ordinal —
///      ordinals are a source-layout detail (see build bible §4.1).
contract RaincheckV2Test is Test {
    RaincheckEscrowV2 internal v2;
    RaincheckEscrow internal v1;
    MockUSDC internal usdc;

    address internal buyer = address(0xB0B);
    address internal seller = address(0x5E11E);
    address internal otherSeller = address(0x0E11E);
    address internal keeper = address(0xCEEA);

    uint256 internal constant AMOUNT = 1000_000; // 1.00 USDC in 6-decimal units

    function setUp() public {
        usdc = new MockUSDC();
        v2 = new RaincheckEscrowV2(address(usdc));
        v1 = new RaincheckEscrow(address(usdc));
        usdc.mint(buyer, 100_000_000);
        vm.prank(buyer);
        usdc.approve(address(v2), type(uint256).max);
        vm.prank(buyer);
        usdc.approve(address(v1), type(uint256).max);
    }

    /* ------------------------------------------------------------------ */
    /* helpers                                                            */
    /* ------------------------------------------------------------------ */

    // C2 (contracts-tests-core) 2026-10-14: the public receipts() getter returns
    // 11 values, which trips solc "stack too deep" (optimizer OFF) when
    // destructured inside a busy test function. These slice-readers keep the
    // live locals per call small. No behavior change — same getter, same fields.
    function _readRefs(bytes32 pid) internal view returns (bytes32 policyRef, bytes32 fundingRef) {
        (,,,,,,,, policyRef, fundingRef,) = v2.receipts(pid);
    }

    function _readBuyerDeadline(bytes32 pid) internal view returns (address rBuyer, uint256 rDeadline) {
        (, rBuyer,,, rDeadline,,,,,,) = v2.receipts(pid);
    }

    function _readEvidence(bytes32 pid)
        internal
        view
        returns (bytes32 outputHash, uint256 attestedAt, bytes32 flagReasonHash)
    {
        (,,,,, outputHash, attestedAt, flagReasonHash,,,) = v2.receipts(pid);
    }

    function _open(RaincheckEscrowV2 esc, bytes32 pid, bytes32 terms, address sellr, uint256 amt, uint256 dl) internal {
        vm.prank(buyer);
        esc.authorize(pid, terms, sellr, amt, dl);
    }

    function _fullDisputeCycle(bytes32 pid, address sellr) internal {
        bytes32 terms = keccak256(abi.encode(pid));
        _open(v2, pid, terms, sellr, AMOUNT, block.timestamp + 1 days);
        vm.prank(sellr);
        v2.attestDelivery(pid, keccak256("output-bytes"));
        vm.prank(buyer);
        v2.flagNonDelivery(pid, keccak256("garbage"));
        vm.prank(keeper); // permissionless finalization, like production
        v2.void(pid);
    }

    /* ------------------------------------------------------------------ */
    /* DELTA (1): disputes increment ONLY on void()                        */
    /* ------------------------------------------------------------------ */

    function test_DisputesIncrementOnVoid() public {
        bytes32 pid = keccak256("dispute-1");
        assertEq(v2.disputesBySeller(seller), 0, "counter must start at zero");

        _fullDisputeCycle(pid, seller);

        assertEq(v2.disputesBySeller(seller), 1, "void must increment disputes for seller");
        assertEq(v2.disputes(seller), 1, "disputes() accessor must agree");
    }

    function test_DisputesAccumulatePerSellerNotAcrossSellers() public {
        _fullDisputeCycle(keccak256("d-a"), seller);
        _fullDisputeCycle(keccak256("d-b"), seller);
        _fullDisputeCycle(keccak256("d-c"), otherSeller);

        assertEq(v2.disputesBySeller(seller), 2, "two voids -> two disputes");
        assertEq(v2.disputesBySeller(otherSeller), 1, "other seller's own void counted");
        assertEq(v2.disputesBySeller(address(0xdead)), 0, "unrelated address untouched");
    }

    function test_DisputesNotIncrementedOnVoidAfterDeadline() public {
        // Liveness failure: seller never attests. Buyer is refunded, but the
        // seller must NOT get a dishonesty mark. Liveness != dishonesty.
        bytes32 pid = keccak256("liveness-1");
        _open(v2, pid, keccak256("terms"), seller, AMOUNT, block.timestamp + 60);

        vm.warp(block.timestamp + 61);
        vm.prank(keeper);
        v2.voidAfterDeadline(pid);

        (RaincheckEscrowV2.Status status,,,) = v2.getPayment(pid);
        assertEq(uint256(status), uint256(RaincheckEscrowV2.Status.VOIDED), "must be VOIDED");
        assertEq(v2.disputesBySeller(seller), 0, "voidAfterDeadline must NOT increment disputes");
        assertEq(usdc.balanceOf(buyer), 100_000_000, "buyer must be refunded in full");
    }

    function test_DisputesNotIncrementedOnCaptureOrFlag() public {
        // Flag alone (no void yet) is not a dispute.
        bytes32 pid = keccak256("flag-only");
        _open(v2, pid, keccak256("terms"), seller, AMOUNT, block.timestamp + 1 days);
        vm.prank(seller);
        v2.attestDelivery(pid, keccak256("bytes"));
        vm.prank(buyer);
        v2.flagNonDelivery(pid, keccak256("reason"));
        assertEq(v2.disputesBySeller(seller), 0, "flag alone must not increment");

        // Capture path (honest seller) never increments.
        bytes32 pid2 = keccak256("capture-ok");
        _open(v2, pid2, keccak256("terms"), seller, AMOUNT, block.timestamp + 1 days);
        vm.prank(seller);
        v2.attestDelivery(pid2, keccak256("bytes"));
        vm.warp(block.timestamp + v2.challengeWindow() + 1);
        vm.prank(keeper);
        v2.capture(pid2);
        assertEq(v2.disputesBySeller(seller), 0, "capture must not increment");
    }

    function test_VoidCannotDoubleIncrement() public {
        bytes32 pid = keccak256("double-void");
        _fullDisputeCycle(pid, seller);
        assertEq(v2.disputesBySeller(seller), 1);

        // State is VOIDED; a second void must revert — no double count.
        vm.prank(keeper);
        vm.expectRevert(bytes("not FLAGGED"));
        v2.void(pid);
        assertEq(v2.disputesBySeller(seller), 1, "dispute counter must not double-increment");
    }

    /* ------------------------------------------------------------------ */
    /* DELTA (2): getPayment view                                          */
    /* ------------------------------------------------------------------ */

    function test_GetPaymentReturnsCorrectFields() public {
        bytes32 pid = keccak256("get-payment");
        bytes32 terms = keccak256("the-terms");
        _open(v2, pid, terms, seller, AMOUNT, block.timestamp + 1 days);
        vm.prank(seller);
        v2.attestDelivery(pid, keccak256("bytes"));

        (RaincheckEscrowV2.Status status, address gotSeller, uint256 gotAmount, bytes32 gotTerms) = v2.getPayment(pid);

        assertEq(uint256(status), uint256(RaincheckEscrowV2.Status.ATTESTED), "status must be ATTESTED by name");
        assertEq(gotSeller, seller, "seller mismatch");
        assertEq(gotAmount, AMOUNT, "amount mismatch");
        assertEq(gotTerms, terms, "termsHash mismatch");
    }

    function test_GetPaymentOnUnknownPaymentId() public {
        (RaincheckEscrowV2.Status status, address gotSeller, uint256 gotAmount, bytes32 gotTerms) =
            v2.getPayment(keccak256("never-opened"));
        assertEq(uint256(status), uint256(RaincheckEscrowV2.Status.NONE), "unknown payment must be NONE");
        assertEq(gotSeller, address(0), "unknown payment seller must be zero");
        assertEq(gotAmount, 0, "unknown payment amount must be zero");
        assertEq(gotTerms, bytes32(0), "unknown payment termsHash must be zero");
    }

    function test_GetPaymentTracksStatusAcrossLifecycle() public {
        bytes32 pid = keccak256("lifecycle");
        _open(v2, pid, keccak256("terms"), seller, AMOUNT, block.timestamp + 1 days);
        (RaincheckEscrowV2.Status s1,,,) = v2.getPayment(pid);
        assertEq(uint256(s1), uint256(RaincheckEscrowV2.Status.OPEN), "must read OPEN");

        vm.prank(seller);
        v2.attestDelivery(pid, keccak256("bytes"));
        (RaincheckEscrowV2.Status s2,,,) = v2.getPayment(pid);
        assertEq(uint256(s2), uint256(RaincheckEscrowV2.Status.ATTESTED), "must read ATTESTED");

        vm.warp(block.timestamp + v2.challengeWindow() + 1);
        vm.prank(keeper);
        v2.capture(pid);
        (RaincheckEscrowV2.Status s3,,,) = v2.getPayment(pid);
        assertEq(uint256(s3), uint256(RaincheckEscrowV2.Status.CAPTURED), "must read CAPTURED");
    }

    /* ------------------------------------------------------------------ */
    /* DELTA (3): optional policyRef/fundingRef, backward compatibility    */
    /* ------------------------------------------------------------------ */

    // NOTE (C6): V1-vs-V2 core-field comparison is done field-by-field in
    // scoped blocks inside test_ZeroedRefsBehaveIdenticallyToV1 below, using
    // the slice-reader helpers above. A single 9/11-value destructure plus
    // abi.encode trips solc "stack too deep" with the optimizer OFF, so hash
    // helpers are deliberately NOT used here.

    function test_ZeroedRefsBehaveIdenticallyToV1() public {
        // The 5-parameter V1 signature on the PROVEN core vs the 7-parameter
        // V2 authorize with zeroed refs: same escrow balance movement, same
        // stored core fields, same status, same full happy-path outcome.
        bytes32 pidV1 = keccak256("v1-path");
        bytes32 pidV2 = keccak256("v2-path");
        bytes32 terms = keccak256("same-terms");
        uint256 dl = block.timestamp + 1 days;

        vm.prank(buyer);
        v1.authorize(pidV1, terms, seller, AMOUNT, dl);
        vm.prank(buyer);
        v2.authorize(pidV2, terms, seller, AMOUNT, dl, bytes32(0), bytes32(0));

        // Core receipt fields identical (V1: 9 fields; V2 adds 2 refs before status).
        // C2: compared field-by-field in scoped blocks. Destructuring both
        // receipts at once trips solc "stack too deep" (optimizer OFF); every
        // original assertion is preserved, one scope per field.
        {
            (bytes32 t1,,,,,,,,) = v1.receipts(pidV1);
            (,,, bytes32 t2) = v2.getPayment(pidV2);
            assertEq(t2, t1, "termsHash differs from V1");
        }
        {
            (, address b1,,,,,,,) = v1.receipts(pidV1);
            (address b2,) = _readBuyerDeadline(pidV2);
            assertEq(b2, b1, "buyer differs from V1");
        }
        {
            (,, address s1,,,,,,) = v1.receipts(pidV1);
            (, address s2,,) = v2.getPayment(pidV2);
            assertEq(s2, s1, "seller differs from V1");
        }
        {
            (,,, uint256 a1,,,,,) = v1.receipts(pidV1);
            (,, uint256 a2,) = v2.getPayment(pidV2);
            assertEq(a2, a1, "amount differs from V1");
        }
        {
            (,,,, uint256 d1,,,,) = v1.receipts(pidV1);
            (, uint256 d2) = _readBuyerDeadline(pidV2);
            assertEq(d2, d1, "deadline differs from V1");
        }
        {
            (,,,,, bytes32 o1,,,) = v1.receipts(pidV1);
            (bytes32 o2,,) = _readEvidence(pidV2);
            assertEq(o2, o1, "outputHash differs from V1");
        }
        {
            (,,,,,, uint256 at1,,) = v1.receipts(pidV1);
            (, uint256 at2,) = _readEvidence(pidV2);
            assertEq(at2, at1, "attestedAt differs from V1");
        }
        {
            (,,,,,,, bytes32 f1,) = v1.receipts(pidV1);
            (,, bytes32 f2) = _readEvidence(pidV2);
            assertEq(f2, f1, "flagReasonHash differs from V1");
        }
        {
            (,,,,,,,, RaincheckEscrow.Status st1) = v1.receipts(pidV1);
            (RaincheckEscrowV2.Status st2,,,) = v2.getPayment(pidV2);
            assertEq(uint256(st2), uint256(st1), "status differs from V1");
        }
        {
            (bytes32 p2, bytes32 fn2) = _readRefs(pidV2);
            assertEq(p2, bytes32(0), "zeroed policyRef must be stored as zero");
            assertEq(fn2, bytes32(0), "zeroed fundingRef must be stored as zero");
        }

        assertEq(usdc.balanceOf(address(v2)), usdc.balanceOf(address(v1)), "escrow balances must match V1");
        assertEq(v2.challengeWindow(), 300, "V2 uses the 300s SPEC challenge window");

        // Full happy path through V2 mirrors V1 semantics: attest, capture, payout.
        vm.prank(seller);
        v1.attestDelivery(pidV1, keccak256("bytes"));
        vm.prank(seller);
        v2.attestDelivery(pidV2, keccak256("bytes"));

        uint256 sellerBalBefore = usdc.balanceOf(seller);
        vm.warp(block.timestamp + 301); // spec window + 1
        v1.capture(pidV1);
        vm.warp(block.timestamp + 301);
        v2.capture(pidV2);

        assertEq(usdc.balanceOf(seller) - sellerBalBefore, 2 * AMOUNT, "both payouts must reach the seller");
        assertEq(v2.disputesBySeller(seller), 0, "happy path must not touch disputes");
    }

    function test_FiveParamOverloadIsBackwardCompatible() public {
        // Callers written against the V1 signature work unchanged on V2.
        bytes32 pid = keccak256("overload");
        bytes32 terms = keccak256("terms");
        uint256 dl = block.timestamp + 1 days;

        _open(v2, pid, terms, seller, AMOUNT, dl);

        // C2: was an 11-component destructure (solc "stack too deep"); slice-reader.
        (bytes32 policyRef, bytes32 fundingRef) = _readRefs(pid);
        assertEq(policyRef, bytes32(0), "overload must zero policyRef");
        assertEq(fundingRef, bytes32(0), "overload must zero fundingRef");

        (RaincheckEscrowV2.Status status, address gotSeller, uint256 gotAmount, bytes32 gotTerms) = v2.getPayment(pid);
        assertEq(uint256(status), uint256(RaincheckEscrowV2.Status.OPEN));
        assertEq(gotSeller, seller);
        assertEq(gotAmount, AMOUNT);
        assertEq(gotTerms, terms);
    }

    function test_NonZeroRefsAreStoredAndTamperEvident() public {
        bytes32 pid = keccak256("refs-set");
        bytes32 policyRef = keccak256("policy:plugin:0xabc");
        bytes32 fundingRef = keccak256("funding:daybook:0xdef");

        vm.prank(buyer);
        v2.authorize(pid, keccak256("terms"), seller, AMOUNT, block.timestamp + 1 days, policyRef, fundingRef);

        // C2: was an 11-component destructure (solc "stack too deep"); slice-reader.
        (bytes32 gotPolicy, bytes32 gotFunding) = _readRefs(pid);
        assertEq(gotPolicy, policyRef, "policyRef must be stored");
        assertEq(gotFunding, fundingRef, "fundingRef must be stored");

        // getPayment (policy-consumer view) still reports the core fields.
        (RaincheckEscrowV2.Status status, address gotSeller, uint256 gotAmount, bytes32 gotTerms) = v2.getPayment(pid);
        assertEq(uint256(status), uint256(RaincheckEscrowV2.Status.OPEN));
        assertEq(gotSeller, seller);
        assertEq(gotAmount, AMOUNT);
        assertEq(gotTerms, keccak256("terms"));
    }
}
