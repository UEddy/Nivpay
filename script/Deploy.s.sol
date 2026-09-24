// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Script, console} from "forge-std/Script.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {NivPayPots} from "../src/NivPayPots.sol";

/// @notice Deploys NivPayPots against AUSD on Monad testnet.
///
/// Everything this contract will ever do is fixed by these four constructor
/// arguments, so the script checks them against the live chain before it lets
/// a broadcast happen. Run it without --broadcast first: that is a dry run
/// that performs every check and deploys nothing.
///
///     forge script script/Deploy.s.sol:Deploy --rpc-url monad_testnet_public
///
/// See the README for the keystore and broadcast commands.
contract Deploy is Script {
    address internal constant AUSD = 0xa9012a055bd4e0eDfF8Ce09f960291C09D5322dC;
    uint256 internal constant MONAD_TESTNET_CHAIN_ID = 10143;

    function run() external returns (NivPayPots pots) {
        // Fee settings. Defaults are deliberately conservative: 50 bps with a
        // 50 AUSD ceiling on any one payout. MAX_FEE_BPS is 100 and the
        // contract rejects anything above it, permanently.
        uint256 feeBps = vm.envOr("FEE_BPS", uint256(50));
        uint256 feeCap = vm.envOr("FEE_CAP", uint256(50_000000));
        address feeRecipient = vm.envAddress("FEE_RECIPIENT");

        require(block.chainid == MONAD_TESTNET_CHAIN_ID, "not Monad testnet, chain id must be 10143");
        require(feeRecipient != address(0), "FEE_RECIPIENT must be set");
        require(feeBps <= 100, "fee bps above the contract's own hard ceiling");

        // Confirm the token really is the six decimal AUSD, on this chain, at
        // this block. A deployment against the wrong address cannot be undone.
        require(AUSD.code.length > 0, "no contract at the AUSD address");
        require(
            keccak256(bytes(IERC20Metadata(AUSD).symbol())) == keccak256(bytes("AUSD")), "token symbol is not AUSD"
        );
        require(IERC20Metadata(AUSD).decimals() == 6, "AUSD must be a six decimal token");

        console.log("chain id      ", block.chainid);
        console.log("token         ", AUSD);
        console.log("token symbol  ", IERC20Metadata(AUSD).symbol());
        console.log("token decimals", IERC20Metadata(AUSD).decimals());
        console.log("fee bps       ", feeBps);
        console.log("fee cap       ", feeCap);
        console.log("fee recipient ", feeRecipient);

        vm.startBroadcast();
        pots = new NivPayPots(IERC20(AUSD), feeBps, feeCap, feeRecipient);
        vm.stopBroadcast();

        console.log("NivPayPots    ", address(pots));

        // Read the deployed state back, so the log is evidence rather than a
        // restatement of the arguments.
        require(address(pots.token()) == AUSD, "deployed token mismatch");
        require(pots.feeBps() == feeBps, "deployed feeBps mismatch");
        require(pots.feeCap() == feeCap, "deployed feeCap mismatch");
        require(pots.feeRecipient() == feeRecipient, "deployed feeRecipient mismatch");
    }
}
