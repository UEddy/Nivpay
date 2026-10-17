// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Script, console} from "forge-std/Script.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {NivPayPots} from "../src/NivPayPots.sol";
import {NivPayPotsV2} from "../src/NivPayPotsV2.sol";

/// @notice Deploys NivPayPotsV2 on Monad testnet next to a live NivPayPots,
/// on the same token and with the same fee settings, read off that NivPayPots
/// on the chain rather than typed in again. NivPayPots itself is not touched:
/// its pots stay where they are and keep working exactly as before.
///
/// The exit window is EXIT_WINDOW below, 72 hours, and the apply period
/// APPLY_PERIOD, 7 days, and nothing else: neither is read from the
/// environment, and test/DeployPotsV2.t.sol fails if either is ever anything
/// else. A short window is only for a staging copy
/// (script/DeployPotsV2Staging.s.sol).
///
/// POTS_TOKEN picks which: "ausd" (the default) or "testusd". Run it without
/// --broadcast first: that is a dry run that performs every check and
/// deploys nothing.
///
///     $env:POTS_TOKEN = "ausd"
///     forge script script/DeployPotsV2.s.sol:DeployPotsV2 --rpc-url monad_testnet_public -g 105
///
/// See the README for the keystore and broadcast commands.
contract DeployPotsV2 is Script {
    uint256 internal constant MONAD_TESTNET_CHAIN_ID = 10143;

    /// The exit window and apply period of the real deployment.
    uint256 public constant EXIT_WINDOW = 72 hours;
    uint256 public constant APPLY_PERIOD = 7 days;

    /// The live NivPayPots instances (app/src/lib/config.ts, broadcast/).
    address internal constant POTS_AUSD = 0xB9E68db3117Db149dF56F5Aa29CF6adaA2369EfB;
    address internal constant POTS_TESTUSD = 0xe80FBB5F77Cb87d4f588A3F21bf9Eae34fC996aA;
    address internal constant AUSD = 0xa9012a055bd4e0eDfF8Ce09f960291C09D5322dC;
    address internal constant TESTUSD = 0x9FD60818e0DFee982d677cd72FbC3601Cc2eB6f7;

    function run() external returns (NivPayPotsV2 pots) {
        string memory which = vm.envOr("POTS_TOKEN", string("ausd"));
        bool ausd = keccak256(bytes(which)) == keccak256("ausd");
        require(ausd || keccak256(bytes(which)) == keccak256("testusd"), "POTS_TOKEN must be ausd or testusd");

        require(block.chainid == MONAD_TESTNET_CHAIN_ID, "not Monad testnet, chain id must be 10143");

        NivPayPots v1 = NivPayPots(ausd ? POTS_AUSD : POTS_TESTUSD);
        address token = ausd ? AUSD : TESTUSD;
        require(address(v1).code.length > 0, "no NivPayPots at the expected address");
        require(address(v1.token()) == token, "that NivPayPots is not on the expected token");
        require(token.code.length > 0, "no contract at the token address");
        require(
            keccak256(bytes(IERC20Metadata(token).symbol())) == keccak256(bytes(ausd ? "AUSD" : "TESTUSD")),
            "token symbol mismatch"
        );
        require(IERC20Metadata(token).decimals() == 6, "the token must have six decimals");

        uint256 feeBps = v1.feeBps();
        uint256 feeCap = v1.feeCap();
        address feeRecipient = v1.feeRecipient();

        console.log("chain id      ", block.chainid);
        console.log("next to       ", address(v1));
        console.log("token         ", token);
        console.log("token symbol  ", IERC20Metadata(token).symbol());
        console.log("fee bps       ", feeBps);
        console.log("fee cap       ", feeCap);
        console.log("fee recipient ", feeRecipient);
        console.log("exit window s ", EXIT_WINDOW);
        console.log("apply period s", APPLY_PERIOD);

        vm.startBroadcast();
        pots = deploy(IERC20(token), feeBps, feeCap, feeRecipient);
        vm.stopBroadcast();

        console.log("NivPayPotsV2  ", address(pots));
        check(pots, IERC20(token), feeBps, feeCap, feeRecipient);
    }

    /// The deployment itself, with this script's EXIT_WINDOW. A test calls it too.
    function deploy(IERC20 token, uint256 feeBps, uint256 feeCap, address feeRecipient) public returns (NivPayPotsV2) {
        return new NivPayPotsV2(token, feeBps, feeCap, feeRecipient, EXIT_WINDOW, APPLY_PERIOD);
    }

    /// Reads the deployed state back, so the log is evidence rather than a
    /// restatement of the arguments.
    function check(NivPayPotsV2 pots, IERC20 token, uint256 feeBps, uint256 feeCap, address feeRecipient) public view {
        require(address(pots.token()) == address(token), "deployed token mismatch");
        require(pots.feeBps() == feeBps, "deployed feeBps mismatch");
        require(pots.feeCap() == feeCap, "deployed feeCap mismatch");
        require(pots.feeRecipient() == feeRecipient, "deployed feeRecipient mismatch");
        require(pots.EXIT_WINDOW() == 72 hours, "deployed exit window is not 72 hours");
        require(pots.APPLY_PERIOD() == 7 days, "deployed apply period is not 7 days");
        require(pots.MAX_OPEN_CHANGES() == 5, "deployed open change limit mismatch");
        require(pots.potCount() == 0 && pots.changeCount() == 0, "a fresh contract should have no pots and no changes");
    }
}
