// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console2} from "forge-std/Script.sol";
import {RaincheckEscrowV2} from "../src/RaincheckEscrowV2.sol";

/// @title DeployRaincheckEscrow
/// @notice Production deploy script for RaincheckEscrowV2 (challengeWindow = 300).
/// @dev GAS RULE (bible §5.3, R9-W1B documented failure): never let the CREATE gas
///      limit come from eth_estimateGas on Arc. Compute it as
///          manualGasLimit = runtimeBytes * 200 + DEPLOY_MARGIN
///      and pass it as the manual --gas-limit on the broadcast transaction
///      (see DEPLOY.md — the cast path). An 8,056-byte runtime needs >= 1.61M gas
///      for code deposit ALONE; a 1.5M manual limit burned 0.03 USDC. Do not repeat it.
///
///      --dry-run: no private key needed. Simulates the deploy, prints the gas
///      budget, and asserts the production spec values. Nothing is broadcast.
///      (In forge >= 1.8 simulation is the default: run the script WITHOUT
///      --broadcast. The old --dry-run flag no longer exists.)
///
///      Broadcast: DEPLOYER_PRIVATE_KEY must be set in the environment (never on the
///      command line, never in the repo). See DEPLOY.md for the exact commands.
contract DeployRaincheckEscrow is Script {
    /// @dev Arc mainnet USDC. The script refuses to deploy against any other token.
    address internal constant USDC_ARC_MAINNET = 0x3600000000000000000000000000000000000000;

    /// @dev EIP-170 / code-deposit cost: 200 gas per deployed (runtime) byte.
    uint256 internal constant CODE_DEPOSIT_GAS_PER_BYTE = 200;
    /// @dev Covers the 21k intrinsic cost, calldata (~16 gas/byte of creation code),
    ///      and constructor execution. Sized so an 8,056-byte runtime budgets
    ///      1,611,200 + 300,000 = 1,911,200 — comfortably above the 1,617,045
    ///      the reference deployment actually consumed.
    uint256 internal constant DEPLOY_MARGIN = 300_000;
    /// @dev Production spec value (bible §4.1). Asserted on the deployed instance.
    uint256 internal constant EXPECTED_CHALLENGE_WINDOW = 300;

    function run() external {
        // NOTE: type(X).runtimeCode is unavailable for contracts with immutables
        // (usdc is immutable), so read the artifact bytecode via the cheatcode.
        // getDeployedCode zeroes immutable slots but preserves the exact length,
        // which is all the gas rule needs.
        bytes memory runtime = vm.getDeployedCode("RaincheckEscrowV2.sol:RaincheckEscrowV2");
        bytes memory creation = type(RaincheckEscrowV2).creationCode;
        uint256 codeDepositFloor = runtime.length * CODE_DEPOSIT_GAS_PER_BYTE;
        uint256 manualGasLimit = codeDepositFloor + DEPLOY_MARGIN;

        console2.log("contract            : RaincheckEscrowV2");
        console2.log("runtime bytes       :", runtime.length);
        console2.log("creation bytes      :", creation.length);
        console2.log("code-deposit floor  :", codeDepositFloor);
        console2.log("MANUAL GAS LIMIT    :", manualGasLimit);
        console2.log("challengeWindow spec:", EXPECTED_CHALLENGE_WINDOW);

        // Safety: the constructor arg must be canonical Arc USDC. Override only via
        // RAINCHECK_USDC if you know exactly what you are doing (e.g. a fork test
        // with a mock token) — the equality check below will stop you otherwise.
        address usdc = vm.envOr("RAINCHECK_USDC", USDC_ARC_MAINNET);
        console2.log("usdc                :", usdc);
        require(usdc == USDC_ARC_MAINNET, "refusing to deploy against non-canonical USDC");

        uint256 pk = vm.envOr("DEPLOYER_PRIVATE_KEY", uint256(0));
        if (pk == 0) {
            console2.log("mode                : SIMULATION (no DEPLOYER_PRIVATE_KEY set; nothing is broadcast)");
            vm.startBroadcast(); // default sender; forge simulates, nothing leaves the machine
        } else {
            vm.startBroadcast(pk);
        }

        RaincheckEscrowV2 escrow = new RaincheckEscrowV2(usdc);

        vm.stopBroadcast();

        console2.log("deployed at         :", address(escrow));
        console2.log("usdc()              :", address(escrow.usdc()));
        console2.log("challengeWindow()   :", escrow.challengeWindow());
        require(
            escrow.challengeWindow() == EXPECTED_CHALLENGE_WINDOW,
            "challengeWindow mismatch: not the production spec value"
        );
    }
}
