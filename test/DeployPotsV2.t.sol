// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {NivPayPotsV2} from "../src/NivPayPotsV2.sol";
import {DeployPotsV2} from "../script/DeployPotsV2.s.sol";
import {DeployPotsV2Staging} from "../script/DeployPotsV2Staging.s.sol";
import {MockAUSD} from "./mocks/MockAUSD.sol";

/// @notice The real deployment's exit window is 72 hours, and only that. If
/// anyone changes the script's window, or the contract stops taking the one
/// it is given, this fails.
contract DeployPotsV2Test is Test {
    function test_theRealDeploymentWaitsSeventyTwoHours() public {
        DeployPotsV2 script = new DeployPotsV2();
        assertEq(script.EXIT_WINDOW(), 72 hours, "the script's window");
        MockAUSD token = new MockAUSD();
        address recipient = makeAddr("feeRecipient");
        NivPayPotsV2 pots = script.deploy(IERC20(address(token)), 50, 50_000000, recipient);
        assertEq(pots.EXIT_WINDOW(), 72 hours, "the deployed window");
        // The script's own read back passes on it, and refuses anything else.
        script.check(pots, IERC20(address(token)), 50, 50_000000, recipient);
        NivPayPotsV2 short = new NivPayPotsV2(IERC20(address(token)), 50, 50_000000, recipient, 71 hours, 7 days);
        vm.expectRevert(bytes("deployed exit window is not 72 hours"));
        script.check(short, IERC20(address(token)), 50, 50_000000, recipient);
    }

    function test_theRealDeploymentAppliesForSevenDays() public {
        DeployPotsV2 script = new DeployPotsV2();
        assertEq(script.APPLY_PERIOD(), 7 days, "the script's apply period");
        MockAUSD token = new MockAUSD();
        address recipient = makeAddr("feeRecipient");
        NivPayPotsV2 pots = script.deploy(IERC20(address(token)), 50, 50_000000, recipient);
        assertEq(pots.APPLY_PERIOD(), 7 days, "the deployed apply period");
        NivPayPotsV2 short = new NivPayPotsV2(IERC20(address(token)), 50, 50_000000, recipient, 72 hours, 6 days);
        vm.expectRevert(bytes("deployed apply period is not 7 days"));
        script.check(short, IERC20(address(token)), 50, 50_000000, recipient);
    }

    function test_stagingIsFiveMinutesAndNeverTheRealOne() public {
        assertEq(new DeployPotsV2Staging().EXIT_WINDOW(), 5 minutes);
        assertEq(new DeployPotsV2Staging().APPLY_PERIOD(), 5 minutes);
        assertTrue(new DeployPotsV2Staging().EXIT_WINDOW() != new DeployPotsV2().EXIT_WINDOW());
    }

    /// An external call, so expectRevert catches the constructor's revert itself.
    function make(address token, uint256 window) external returns (NivPayPotsV2) {
        return new NivPayPotsV2(IERC20(token), 50, 0, makeAddr("feeRecipient"), window, 7 days);
    }

    function makeWithPeriod(address token, uint256 period) external returns (NivPayPotsV2) {
        return new NivPayPotsV2(IERC20(token), 50, 0, makeAddr("feeRecipient"), 72 hours, period);
    }

    function test_theApplyPeriodIsBounded() public {
        address token = address(new MockAUSD());
        for (uint256 i = 0; i < 3; ++i) {
            uint256 bad = [uint256(0), 1 minutes - 1, 30 days + 1][i];
            vm.expectRevert(NivPayPotsV2.BadApplyPeriod.selector);
            this.makeWithPeriod(token, bad);
        }
        assertEq(this.makeWithPeriod(token, 1 minutes).APPLY_PERIOD(), 1 minutes);
        assertEq(this.makeWithPeriod(token, 30 days).APPLY_PERIOD(), 30 days);
    }

    function test_theWindowIsBounded() public {
        address token = address(new MockAUSD());
        for (uint256 i = 0; i < 3; ++i) {
            uint256 bad = [uint256(0), 1 minutes - 1, 30 days + 1][i];
            vm.expectRevert(NivPayPotsV2.BadExitWindow.selector);
            this.make(token, bad);
        }
        assertEq(this.make(token, 1 minutes).EXIT_WINDOW(), 1 minutes);
        assertEq(this.make(token, 30 days).EXIT_WINDOW(), 30 days);
        assertEq(this.make(token, 72 hours).EXIT_WINDOW(), 72 hours);
    }
}
