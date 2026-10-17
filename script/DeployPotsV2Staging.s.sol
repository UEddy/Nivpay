// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Script, console} from "forge-std/Script.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {NivPayPotsV2} from "../src/NivPayPotsV2.sol";

/// @notice A STAGING copy of NivPayPotsV2 on Monad testnet, with a 5 minute
/// exit window, so a change's whole life (agreed, waiting, applied or lapsed)
/// can be run end to end in minutes. It is never the real deployment: the app
/// never points at it except in a local build made for that test, and the
/// README lists its address as staging, unused. The real deployment is
/// script/DeployPotsV2.s.sol, 72 hours, fixed.
///
/// Fees go to the deployer, and are 0: nothing here is meant to earn anything.
///
///     forge script script/DeployPotsV2Staging.s.sol:DeployPotsV2Staging --rpc-url monad_testnet_public -g 105
contract DeployPotsV2Staging is Script {
    uint256 internal constant MONAD_TESTNET_CHAIN_ID = 10143;
    uint256 public constant EXIT_WINDOW = 5 minutes;
    /// Short too, so a change can be seen to lapse in the same run.
    uint256 public constant APPLY_PERIOD = 5 minutes;
    address internal constant AUSD = 0xa9012a055bd4e0eDfF8Ce09f960291C09D5322dC;

    function run() external returns (NivPayPotsV2 pots) {
        require(block.chainid == MONAD_TESTNET_CHAIN_ID, "not Monad testnet, chain id must be 10143");
        require(keccak256(bytes(IERC20Metadata(AUSD).symbol())) == keccak256(bytes("AUSD")), "token symbol is not AUSD");

        vm.startBroadcast();
        address deployer = msg.sender;
        pots = new NivPayPotsV2(IERC20(AUSD), 0, 0, deployer, EXIT_WINDOW, APPLY_PERIOD);
        vm.stopBroadcast();

        console.log("STAGING NivPayPotsV2", address(pots));
        console.log("exit window s       ", pots.EXIT_WINDOW());
        require(pots.EXIT_WINDOW() == 5 minutes, "staging window mismatch");
        require(pots.APPLY_PERIOD() == 5 minutes, "staging apply period mismatch");
        require(address(pots.token()) == AUSD, "staging token mismatch");
    }
}
