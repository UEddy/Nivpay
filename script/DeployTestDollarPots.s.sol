// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Script, console} from "forge-std/Script.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {IERC20Permit} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Permit.sol";
import {NivPayPots} from "../src/NivPayPots.sol";

/// @notice Deploys a second NivPayPots on Monad testnet whose immutable token
/// is NivPayTestDollar (TESTUSD) rather than AUSD.
///
/// The AUSD instance and its script, script/Deploy.s.sol, are untouched. This
/// instance exists so the pots can be exercised end to end with a token anyone
/// can mint, without depending on Agora's faucet having stock.
///
/// Fee settings are the AUSD instance's: the same FEE_BPS, FEE_CAP and
/// FEE_RECIPIENT environment variables with the same defaults, so one shell
/// configured for the AUSD deploy produces identical settings here. If the AUSD
/// instance is already live, set AUSD_POTS to its address and the script reads
/// its fee settings off the chain and refuses to proceed unless they match.
///
/// Run it without --broadcast first: that is a dry run that performs every
/// check and deploys nothing.
///
///     $env:TEST_DOLLAR = "0x..."   # from script/DeployTestDollar.s.sol
///     forge script script/DeployTestDollarPots.s.sol:DeployTestDollarPots --rpc-url monad_testnet_public
contract DeployTestDollarPots is Script {
    address internal constant AUSD = 0xa9012a055bd4e0eDfF8Ce09f960291C09D5322dC;
    uint256 internal constant MONAD_TESTNET_CHAIN_ID = 10143;

    function run() external returns (NivPayPots pots) {
        // Identical to script/Deploy.s.sol, deliberately.
        uint256 feeBps = vm.envOr("FEE_BPS", uint256(50));
        uint256 feeCap = vm.envOr("FEE_CAP", uint256(50_000000));
        address feeRecipient = vm.envAddress("FEE_RECIPIENT");
        address testDollar = vm.envAddress("TEST_DOLLAR");
        address ausdPots = vm.envOr("AUSD_POTS", address(0));

        require(block.chainid == MONAD_TESTNET_CHAIN_ID, "not Monad testnet, chain id must be 10143");
        require(feeRecipient != address(0), "FEE_RECIPIENT must be set");
        require(feeBps <= 100, "fee bps above the contract's own hard ceiling");

        // Confirm the token really is the test dollar. A NivPayPots bound to
        // the wrong token cannot be rebound.
        require(testDollar != AUSD, "TEST_DOLLAR is the AUSD address, use script/Deploy.s.sol for AUSD");
        require(testDollar.code.length > 0, "no contract at the TEST_DOLLAR address");
        require(
            keccak256(bytes(IERC20Metadata(testDollar).symbol())) == keccak256(bytes("TESTUSD")),
            "token symbol is not TESTUSD"
        );
        require(
            keccak256(bytes(IERC20Metadata(testDollar).name())) == keccak256(bytes("NivPay Test Dollar")),
            "token name is not NivPay Test Dollar"
        );
        require(IERC20Metadata(testDollar).decimals() == 6, "TESTUSD must be a six decimal token");
        require(IERC20Permit(testDollar).DOMAIN_SEPARATOR() != bytes32(0), "TESTUSD has no permit domain separator");

        // If the AUSD instance exists, prove the fee settings match it rather
        // than trusting that the environment was set the same way twice.
        if (ausdPots != address(0)) {
            require(ausdPots.code.length > 0, "no contract at the AUSD_POTS address");
            NivPayPots reference_ = NivPayPots(ausdPots);
            require(address(reference_.token()) == AUSD, "AUSD_POTS is not the AUSD instance");
            require(reference_.feeBps() == feeBps, "feeBps differs from the AUSD instance");
            require(reference_.feeCap() == feeCap, "feeCap differs from the AUSD instance");
            require(reference_.feeRecipient() == feeRecipient, "feeRecipient differs from the AUSD instance");
            console.log("fee settings match the AUSD instance at", ausdPots);
        } else {
            console.log("AUSD_POTS not set, fee settings not cross-checked against a live AUSD instance");
        }

        console.log("chain id      ", block.chainid);
        console.log("token         ", testDollar);
        console.log("token symbol  ", IERC20Metadata(testDollar).symbol());
        console.log("token decimals", IERC20Metadata(testDollar).decimals());
        console.log("fee bps       ", feeBps);
        console.log("fee cap       ", feeCap);
        console.log("fee recipient ", feeRecipient);

        vm.startBroadcast();
        pots = new NivPayPots(IERC20(testDollar), feeBps, feeCap, feeRecipient);
        vm.stopBroadcast();

        console.log("NivPayPots    ", address(pots));

        // Read the deployed state back, so the log is evidence rather than a
        // restatement of the arguments.
        require(address(pots.token()) == testDollar, "deployed token mismatch");
        require(pots.feeBps() == feeBps, "deployed feeBps mismatch");
        require(pots.feeCap() == feeCap, "deployed feeCap mismatch");
        require(pots.feeRecipient() == feeRecipient, "deployed feeRecipient mismatch");
    }
}
