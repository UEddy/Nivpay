// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Script, console} from "forge-std/Script.sol";
import {NivPayTestDollar} from "../src/NivPayTestDollar.sol";

/// @notice Deploys NivPayTestDollar (TESTUSD) on Monad testnet.
///
/// TESTUSD is a worthless, freely mintable test token. It must never be
/// deployed to a mainnet: this script refuses any chain but Monad testnet, and
/// the token's own constructor refuses too, so the check does not depend on
/// this script being the one used.
///
///     forge script script/DeployTestDollar.s.sol:DeployTestDollar --rpc-url monad_testnet_public
///
/// See the README for the keystore and broadcast commands.
contract DeployTestDollar is Script {
    uint256 internal constant MONAD_TESTNET_CHAIN_ID = 10143;

    function run() external returns (NivPayTestDollar token) {
        require(block.chainid == MONAD_TESTNET_CHAIN_ID, "not Monad testnet, chain id must be 10143");

        vm.startBroadcast();
        token = new NivPayTestDollar();
        vm.stopBroadcast();

        // Read the deployed metadata back, so the log is evidence rather than
        // a restatement of the source.
        require(keccak256(bytes(token.name())) == keccak256(bytes("NivPay Test Dollar")), "deployed name mismatch");
        require(keccak256(bytes(token.symbol())) == keccak256(bytes("TESTUSD")), "deployed symbol mismatch");
        require(token.decimals() == 6, "deployed decimals mismatch");
        require(token.DOMAIN_SEPARATOR() != bytes32(0), "no permit domain separator");

        console.log("chain id      ", block.chainid);
        console.log("token name    ", token.name());
        console.log("token symbol  ", token.symbol());
        console.log("token decimals", token.decimals());
        console.log("TESTUSD       ", address(token));
    }
}
