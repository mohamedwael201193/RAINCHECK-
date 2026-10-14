// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "forge-std/Test.sol";
import {OracleRegistry} from "../src/OracleRegistry.sol";

/// @title OracleRegistry tests — T0-O ECDSA_PINNED tier (bible §4.5)
/// @notice Digest is signed RAW (no EIP-191 prefix), matching oracleDigest():
///         keccak256("raincheck:5042:oracle:" ‖ paymentId ‖ outputHash).
contract OracleRegistryTest is Test {
    OracleRegistry internal registry;
    address internal owner;
    uint256 internal oraclePrivKey;
    address internal oracleKey;
    bytes32 internal issuerId;

    bytes32 internal constant PAYMENT_ID = keccak256("payment-1");
    bytes32 internal constant OUTPUT_HASH = keccak256("output-1");

    event OracleAttested(bytes32 indexed paymentId, bytes32 issuerId, bytes32 outputHash, uint256 attestedAt);
    event IssuerRegistered(bytes32 indexed issuerId, OracleRegistry.OracleKind kind, address oracleKey);
    event RotationProposed(bytes32 indexed issuerId, address newKey, uint256 readyAt);
    event KeyActivated(bytes32 indexed issuerId, address newKey);
    event KeyRevoked(bytes32 indexed issuerId);

    function setUp() public {
        owner = address(this);
        registry = new OracleRegistry();
        oraclePrivKey = 0xA11CE;
        oracleKey = vm.addr(oraclePrivKey);
        issuerId = keccak256("ecdsa:raincheck-test-oracle");
        registry.registerIssuer(issuerId, OracleRegistry.OracleKind.ECDSA_PINNED, oracleKey);
    }

    function _sign(bytes32 paymentId, bytes32 outputHash, uint256 privKey)
        internal
        view
        returns (uint8 v, bytes32 r, bytes32 s)
    {
        bytes32 digest = registry.oracleDigest(paymentId, outputHash);
        (v, r, s) = vm.sign(privKey, digest);
    }

    // ---------- happy path ----------

    function test_HappyPath_RegisterSignAttest() public {
        (uint8 v, bytes32 r, bytes32 s) = _sign(PAYMENT_ID, OUTPUT_HASH, oraclePrivKey);

        vm.expectEmit(true, false, false, true);
        emit OracleAttested(PAYMENT_ID, issuerId, OUTPUT_HASH, block.timestamp);
        registry.attestWithOracle(PAYMENT_ID, OUTPUT_HASH, v, r, s);

        (bytes32 storedIssuer, bytes32 storedOutput, uint256 attestedAt) = registry.attestations(PAYMENT_ID);
        assertEq(storedIssuer, issuerId, "issuerId stored");
        assertEq(storedOutput, OUTPUT_HASH, "outputHash stored");
        assertEq(attestedAt, block.timestamp, "attestedAt stored");
    }

    function test_VerifyClaim_HappyPath() public {
        (uint8 v, bytes32 r, bytes32 s) = _sign(PAYMENT_ID, OUTPUT_HASH, oraclePrivKey);
        (bool ok, address recovered) =
            registry.verifyClaim(issuerId, PAYMENT_ID, OUTPUT_HASH, v, r, s);
        assertTrue(ok, "verifyClaim ok");
        assertEq(recovered, oracleKey, "recovered == pinned key");
    }

    // ---------- wrong key ----------

    function test_WrongKey_Reverts() public {
        uint256 attackerKey = 0xBAD;
        (uint8 v, bytes32 r, bytes32 s) = _sign(PAYMENT_ID, OUTPUT_HASH, attackerKey);
        vm.expectRevert("unknown signer");
        registry.attestWithOracle(PAYMENT_ID, OUTPUT_HASH, v, r, s);

        (bool ok,) = registry.verifyClaim(issuerId, PAYMENT_ID, OUTPUT_HASH, v, r, s);
        assertFalse(ok, "verifyClaim must be false for wrong key");
    }

    // ---------- revoked issuer ----------

    function test_RevokedIssuer_Reverts() public {
        registry.revokeKey(issuerId);
        (uint8 v, bytes32 r, bytes32 s) = _sign(PAYMENT_ID, OUTPUT_HASH, oraclePrivKey);
        vm.expectRevert("issuer revoked");
        registry.attestWithOracle(PAYMENT_ID, OUTPUT_HASH, v, r, s);

        (bool ok,) = registry.verifyClaim(issuerId, PAYMENT_ID, OUTPUT_HASH, v, r, s);
        assertFalse(ok, "verifyClaim must be false for revoked issuer");
    }

    // ---------- rotation timelock ----------

    function test_RotationTimelock() public {
        uint256 newPrivKey = 0xBEEF;
        address newKey = vm.addr(newPrivKey);
        registry.proposeKeyRotation(issuerId, newKey);

        vm.expectRevert("timelock not elapsed");
        registry.activateKey(issuerId);

        vm.warp(block.timestamp + 3 days - 1);
        vm.expectRevert("timelock not elapsed");
        registry.activateKey(issuerId);

        vm.warp(block.timestamp + 1);
        vm.expectEmit(true, false, false, true);
        emit KeyActivated(issuerId, newKey);
        registry.activateKey(issuerId);

        // New key attests.
        (uint8 v, bytes32 r, bytes32 s) = _sign(PAYMENT_ID, OUTPUT_HASH, newPrivKey);
        registry.attestWithOracle(PAYMENT_ID, OUTPUT_HASH, v, r, s);
        (bytes32 storedIssuer,,) = registry.attestations(PAYMENT_ID);
        assertEq(storedIssuer, issuerId, "post-rotation attestation works");

        // Old key no longer attests.
        (uint8 v2, bytes32 r2, bytes32 s2) = _sign(keccak256("payment-2"), OUTPUT_HASH, oraclePrivKey);
        vm.expectRevert("unknown signer");
        registry.attestWithOracle(keccak256("payment-2"), OUTPUT_HASH, v2, r2, s2);
    }

    // ---------- OIDC tier: registered but not live ----------

    function test_OIDC_RegisterAllowed_VerifyRevertsNotLive() public {
        bytes32 oidcIssuer = keccak256("oidc:accounts.google.com");
        registry.registerIssuer(oidcIssuer, OracleRegistry.OracleKind.OIDC_RS256, address(0));

        uint256 someKey = 0x1234;
        (uint8 v, bytes32 r, bytes32 s) = _sign(PAYMENT_ID, OUTPUT_HASH, someKey);
        vm.expectRevert("OIDC not live");
        registry.verifyClaim(oidcIssuer, PAYMENT_ID, OUTPUT_HASH, v, r, s);
    }

    function test_OIDC_RegisterWithKey_Reverts() public {
        bytes32 oidcIssuer = keccak256("oidc:accounts.google.com");
        vm.expectRevert("OIDC: key must be zero");
        registry.registerIssuer(oidcIssuer, OracleRegistry.OracleKind.OIDC_RS256, address(0x1234));
    }

    // ---------- registration guards ----------

    function test_RegisterECDSAZeroKey_Reverts() public {
        vm.expectRevert("ECDSA: key required");
        registry.registerIssuer(keccak256("ecdsa:bad"), OracleRegistry.OracleKind.ECDSA_PINNED, address(0));
    }

    function test_RegisterDuplicate_Reverts() public {
        vm.expectRevert("already registered");
        registry.registerIssuer(issuerId, OracleRegistry.OracleKind.ECDSA_PINNED, oracleKey);
    }

    function test_RegisterNonOwner_Reverts() public {
        vm.prank(address(0xDEAD));
        vm.expectRevert("not owner");
        registry.registerIssuer(keccak256("ecdsa:evil"), OracleRegistry.OracleKind.ECDSA_PINNED, oracleKey);
    }

    function test_RevokeNonOwner_Reverts() public {
        vm.prank(address(0xDEAD));
        vm.expectRevert("not owner");
        registry.revokeKey(issuerId);
    }

    function test_ActivateWithoutProposal_Reverts() public {
        vm.expectRevert("no rotation pending");
        registry.activateKey(issuerId);
    }

    function test_OracleOnlySignerIdentifiesIssuer() public {
        // Two issuers: signer determines which attestation is recorded.
        uint256 key2 = 0x2222;
        bytes32 issuer2 = keccak256("ecdsa:oracle-two");
        registry.registerIssuer(issuer2, OracleRegistry.OracleKind.ECDSA_PINNED, vm.addr(key2));

        (uint8 v, bytes32 r, bytes32 s) = _sign(PAYMENT_ID, OUTPUT_HASH, key2);
        registry.attestWithOracle(PAYMENT_ID, OUTPUT_HASH, v, r, s);
        (bytes32 storedIssuer,,) = registry.attestations(PAYMENT_ID);
        assertEq(storedIssuer, issuer2, "signer maps to the correct issuer");
    }
}
