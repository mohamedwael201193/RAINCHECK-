// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

/// @title OracleRegistry
/// @notice T0-O oracle tier (bible §4.5): ECDSA_PINNED issuer registry + attestation
///         store. This contract NEVER holds funds — it only stores issuer trust
///         anchors and oracle attestations. Wire-up into RaincheckEscrow
///         (ORACLE_ONLY/ORACLE_PREFERRED modes) is specified-not-live; the
///         ECDSA_PINNED tier here is live and independently provable.
/// @dev Oracle digest (domain-separated): keccak256("raincheck:5042:oracle:")
///      ‖ paymentId ‖ outputHash. The chain id is baked into the domain string
///      so a pinned-key signature can never replay on another chain.
///      OIDC_RS256 issuers can be REGISTERED (kind is recorded honestly) but any
///      verification path reverts with "OIDC not live" — the RS256 tier is
///      specified-not-live and this contract does not pretend otherwise.
contract OracleRegistry {
    enum OracleKind {
        NONE, // unset / never valid for a registered issuer
        OIDC_RS256, // registration allowed; verification reverts "OIDC not live"
        ECDSA_PINNED // live: pinned signer, ecrecover verification
    }

    struct Issuer {
        OracleKind kind;
        address oracleKey; // ECDSA_PINNED: pinned signer; OIDC: address(0)
        bool revoked;
        address pendingKey; // rotation target, 0 when none pending
        uint256 rotationReadyAt; // earliest activateKey time, 0 when none pending
    }

    struct Attestation {
        bytes32 issuerId;
        bytes32 outputHash;
        uint256 attestedAt;
    }

    /// @dev Rotation timelock (bible §4.5). A compromised rotation proposal is
    ///      visible for 3 days before it can take effect.
    uint256 public constant ROTATION_TIMELOCK = 3 days;

    address public owner;

    mapping(bytes32 => Issuer) public issuers; // issuerId => Issuer
    mapping(address => bytes32) public issuerByKey; // pinned signer => issuerId
    mapping(bytes32 => Attestation) public attestations; // paymentId => attestation

    event IssuerRegistered(bytes32 indexed issuerId, OracleKind kind, address oracleKey);
    event RotationProposed(bytes32 indexed issuerId, address newKey, uint256 readyAt);
    event KeyActivated(bytes32 indexed issuerId, address newKey);
    event KeyRevoked(bytes32 indexed issuerId);
    event OracleAttested(bytes32 indexed paymentId, bytes32 issuerId, bytes32 outputHash, uint256 attestedAt);
    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);

    modifier onlyOwner() {
        require(msg.sender == owner, "not owner");
        _;
    }

    constructor() {
        owner = msg.sender;
        emit OwnershipTransferred(address(0), msg.sender);
    }

    /// @notice Register an issuer's trust anchor. Owner-only.
    /// @param issuerId keccak256("ecdsa:<name>") or keccak256("oidc:<iss>")
    /// @param kind ECDSA_PINNED requires a nonzero key; OIDC_RS256 requires key == address(0)
    /// @param oracleKey pinned signer for ECDSA_PINNED; must be address(0) for OIDC
    function registerIssuer(bytes32 issuerId, OracleKind kind, address oracleKey) external onlyOwner {
        require(issuerId != bytes32(0), "issuerId zero");
        Issuer storage iss = issuers[issuerId];
        require(iss.kind == OracleKind.NONE, "already registered");
        if (kind == OracleKind.ECDSA_PINNED) {
            require(oracleKey != address(0), "ECDSA: key required");
        } else if (kind == OracleKind.OIDC_RS256) {
            require(oracleKey == address(0), "OIDC: key must be zero");
        } else {
            revert("kind NONE invalid");
        }
        iss.kind = kind;
        iss.oracleKey = oracleKey;
        if (oracleKey != address(0)) {
            require(issuerByKey[oracleKey] == bytes32(0), "key already pinned");
            issuerByKey[oracleKey] = issuerId;
        }
        emit IssuerRegistered(issuerId, kind, oracleKey);
    }

    /// @notice Propose a key rotation. Only ECDSA_PINNED keys rotate (OIDC has no
    ///         key to rotate). Takes effect 3 days later via activateKey.
    function proposeKeyRotation(bytes32 issuerId, address newKey) external onlyOwner {
        Issuer storage iss = issuers[issuerId];
        require(iss.kind == OracleKind.ECDSA_PINNED, "not ECDSA_PINNED");
        require(!iss.revoked, "issuer revoked");
        require(newKey != address(0), "newKey zero");
        require(newKey != iss.oracleKey, "same key");
        require(issuerByKey[newKey] == bytes32(0), "key already pinned");
        iss.pendingKey = newKey;
        iss.rotationReadyAt = block.timestamp + ROTATION_TIMELOCK;
        emit RotationProposed(issuerId, newKey, iss.rotationReadyAt);
    }

    /// @notice Activate a proposed rotation after the 3-day timelock. Owner-only.
    function activateKey(bytes32 issuerId) external onlyOwner {
        Issuer storage iss = issuers[issuerId];
        require(iss.kind == OracleKind.ECDSA_PINNED, "not ECDSA_PINNED");
        require(!iss.revoked, "issuer revoked");
        require(iss.pendingKey != address(0), "no rotation pending");
        require(block.timestamp >= iss.rotationReadyAt, "timelock not elapsed");
        address oldKey = iss.oracleKey;
        iss.oracleKey = iss.pendingKey;
        iss.pendingKey = address(0);
        iss.rotationReadyAt = 0;
        if (oldKey != address(0)) {
            delete issuerByKey[oldKey];
        }
        issuerByKey[iss.oracleKey] = issuerId;
        emit KeyActivated(issuerId, iss.oracleKey);
    }

    /// @notice Revoke an issuer immediately. Owner-only. The key→issuer mapping
    ///         is KEPT so that post-revocation attest attempts revert with an
    ///         explicit "issuer revoked" (not a confusing "unknown signer").
    function revokeKey(bytes32 issuerId) external onlyOwner {
        Issuer storage iss = issuers[issuerId];
        require(iss.kind != OracleKind.NONE, "not registered");
        require(!iss.revoked, "already revoked");
        iss.revoked = true;
        iss.oracleKey = address(0);
        iss.pendingKey = address(0);
        iss.rotationReadyAt = 0;
        emit KeyRevoked(issuerId);
    }

    /// @notice Build the oracle digest for (paymentId, outputHash).
    function oracleDigest(bytes32 paymentId, bytes32 outputHash) public pure returns (bytes32) {
        return keccak256(abi.encodePacked("raincheck:5042:oracle:", paymentId, outputHash));
    }

    /// @notice Attest delivery output for a payment with a pinned-key signature.
    ///         Permissionless — anyone can relay a valid oracle signature.
    /// @dev EOA-signed digests are NOT EIP-191 prefixed: the digest is the raw
    ///      contract-domain message and must be signed as such (eth_sign would
    ///      prefix it; use raw signing, e.g. cast wallet sign --no-hash or
    ///      forge vm.sign).
    function attestWithOracle(bytes32 paymentId, bytes32 outputHash, uint8 v, bytes32 r, bytes32 s)
        external
    {
        bytes32 digest = oracleDigest(paymentId, outputHash);
        address recovered = ecrecover(digest, v, r, s);
        require(recovered != address(0), "bad signature");
        bytes32 issuerId = issuerByKey[recovered];
        require(issuerId != bytes32(0), "unknown signer");
        Issuer storage iss = issuers[issuerId];
        require(iss.kind == OracleKind.ECDSA_PINNED, "issuer not ECDSA_PINNED");
        require(!iss.revoked, "issuer revoked");
        require(iss.oracleKey == recovered, "signer mismatch");
        attestations[paymentId] =
            Attestation({issuerId: issuerId, outputHash: outputHash, attestedAt: block.timestamp});
        emit OracleAttested(paymentId, issuerId, outputHash, block.timestamp);
    }

    /// @notice Verify an oracle claim off-chain style (view). Returns ok=false
    ///         for anything that would not attest; reverts for OIDC issuers
    ///         because that tier is specified-not-live.
    function verifyClaim(
        bytes32 issuerId,
        bytes32 paymentId,
        bytes32 outputHash,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) external view returns (bool ok, address recovered) {
        Issuer storage iss = issuers[issuerId];
        if (iss.kind == OracleKind.OIDC_RS256) {
            revert("OIDC not live");
        }
        if (iss.kind != OracleKind.ECDSA_PINNED || iss.revoked) {
            return (false, address(0));
        }
        recovered = ecrecover(oracleDigest(paymentId, outputHash), v, r, s);
        ok = recovered != address(0) && recovered == iss.oracleKey;
    }

    /// @notice Transfer ownership. Owner-only.
    function transferOwnership(address newOwner) external onlyOwner {
        require(newOwner != address(0), "newOwner zero");
        address previous = owner;
        owner = newOwner;
        emit OwnershipTransferred(previous, newOwner);
    }
}
