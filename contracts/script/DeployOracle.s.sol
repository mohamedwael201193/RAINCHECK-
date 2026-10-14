// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Script, console2} from "forge-std/Script.sol";
import {OracleRegistry} from "../src/OracleRegistry.sol";

/// @title DeployOracleRegistry (budget simulation)
/// @notice SIMULATION ONLY for the CREATE: prints the manual gas budget per the
///         repo gas rule (runtimeBytes x 200 + 300_000). The actual mainnet
///         CREATE goes through `cast --create` with that manual limit (DEPLOY.md
///         Path A — the R9 0.03 USDC lesson). Constructor takes no args.
///         Run: forge script script/DeployOracle.s.sol --rpc-url https://rpc.mainnet.arc.io
contract DeployOracleRegistry is Script {
    uint256 internal constant CODE_DEPOSIT_GAS_PER_BYTE = 200;
    uint256 internal constant DEPLOY_MARGIN = 300_000;

    function run() external {
        bytes memory runtime = vm.getDeployedCode("OracleRegistry.sol:OracleRegistry");
        bytes memory creation = type(OracleRegistry).creationCode;
        uint256 codeDepositFloor = runtime.length * CODE_DEPOSIT_GAS_PER_BYTE;
        uint256 manualGasLimit = codeDepositFloor + DEPLOY_MARGIN;

        console2.log("contract            : OracleRegistry");
        console2.log("runtime bytes       :", runtime.length);
        console2.log("creation bytes      :", creation.length);
        console2.log("code-deposit floor  :", codeDepositFloor);
        console2.log("MANUAL GAS LIMIT    :", manualGasLimit);
        console2.log("constructor args    : none");
        console2.log("mode                : SIMULATION (broadcast via cast --create, DEPLOY.md Path A)");
    }
}

/// @title DustTestOracle
/// @notice Mainnet dust test for OracleRegistry (T0-O ECDSA_PINNED tier).
///         Requires env: DEPLOYER_PRIVATE_KEY (owner, pays gas), ORACLE_KEY
///         (throwaway oracle signer — signs only, needs no funds),
///         ORACLE_REGISTRY (deployed address). Broadcasts:
///           1. registerIssuer(keccak256("ecdsa:raincheck-win-oracle"), ECDSA_PINNED, oracleAddr)
///           2. attestWithOracle with a REAL signature from ORACLE_KEY
///           3. revokeKey
///         Run: ORACLE_REGISTRY=0x... ORACLE_KEY=0x... DEPLOYER_PRIVATE_KEY=... \
///              forge script script/DustTestOracle.s.sol --rpc-url https://rpc.mainnet.arc.io --broadcast
contract DustTestOracle is Script {
    function run() external {
        uint256 deployerKey = vm.envUint("DEPLOYER_PRIVATE_KEY");
        uint256 oracleKey = vm.envUint("ORACLE_KEY");
        OracleRegistry reg = OracleRegistry(vm.envAddress("ORACLE_REGISTRY"));

        bytes32 issuerId = keccak256("ecdsa:raincheck-win-oracle");
        address oracleAddr = vm.addr(oracleKey);
        bytes32 paymentId = keccak256("oracle-win-dust-1");
        bytes32 outputHash = keccak256("win-dust-output");
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(oracleKey, reg.oracleDigest(paymentId, outputHash));

        console2.log("registry   :", address(reg));
        console2.log("issuerId   :");
        console2.logBytes32(issuerId);
        console2.log("oracleAddr :", oracleAddr);

        vm.startBroadcast(deployerKey);
        reg.registerIssuer(issuerId, OracleRegistry.OracleKind.ECDSA_PINNED, oracleAddr);
        reg.attestWithOracle(paymentId, outputHash, v, r, s);
        reg.revokeKey(issuerId);
        vm.stopBroadcast();
        console2.log("DUST TEST COMPLETE: register -> attest -> revoke");
    }
}
