// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Script, console} from "forge-std/Script.sol";
import {NivPayNames} from "../src/NivPayNames.sol";

/// @notice Deploys NivPayNames, the username registry, on Monad testnet.
///
/// It takes no constructor arguments: the name rules, the reserved names and
/// the 90 day hold are fixed in the source, and nobody can change them after
/// deployment. Run it without --broadcast first: that is a dry run that
/// performs every check and deploys nothing.
///
///     forge script script/DeployNames.s.sol:DeployNames --rpc-url https://testnet-rpc.monad.xyz -g 105
///
/// See the README for the keystore and broadcast commands.
contract DeployNames is Script {
    uint256 internal constant MONAD_TESTNET_CHAIN_ID = 10143;

    function run() external returns (NivPayNames names) {
        require(block.chainid == MONAD_TESTNET_CHAIN_ID, "not Monad testnet, chain id must be 10143");

        vm.startBroadcast();
        names = new NivPayNames();
        vm.stopBroadcast();

        console.log("chain id      ", block.chainid);
        console.log("NivPayNames   ", address(names));
        console.log("hold period s ", uint256(names.HOLD_PERIOD()));

        // Read the deployed rules back, so the log is evidence rather than a
        // restatement of the source.
        require(names.HOLD_PERIOD() == 90 days, "deployed hold period mismatch");
        require(names.MIN_LENGTH() == 3 && names.MAX_LENGTH() == 20, "deployed length rules mismatch");
        require(names.isWellFormed("idara") && !names.isWellFormed("Idara"), "deployed name check mismatch");
        require(names.isReserved("nivpay") && names.isReserved("support") && names.isReserved("the_nivpay_team"), "deployed reserved names mismatch");
        require(names.availableAt("idara") == 0, "a fresh registry should have every allowed name free");
    }
}
