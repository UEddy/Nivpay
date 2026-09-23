// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {NivPayPots} from "../src/NivPayPots.sol";
import {MockAUSD} from "./mocks/MockAUSD.sol";

/// @notice Shared rig for the NivPayPots suites.
abstract contract PotsTestBase is Test {
    MockAUSD internal token;
    NivPayPots internal pots;

    address internal feeRecipient = makeAddr("feeRecipient");

    /// 1 percent, which is also MAX_FEE_BPS, so the fee path is always live.
    uint256 internal constant FEE_BPS = 100;
    /// 50 AUSD, high enough that the reference scenario never hits it.
    uint256 internal constant FEE_CAP = 50_000000;

    uint256 internal constant ONE = 1_000000;

    function setUp() public virtual {
        token = new MockAUSD();
        pots = new NivPayPots(IERC20(address(token)), FEE_BPS, FEE_CAP, feeRecipient);
    }

    function _fundAccount(address who, uint256 amount) internal {
        token.mint(who, amount);
        vm.prank(who);
        token.approve(address(pots), type(uint256).max);
    }

    function _one(address a) internal pure returns (address[] memory out) {
        out = new address[](1);
        out[0] = a;
    }

    function _two(address a, address b) internal pure returns (address[] memory out) {
        out = new address[](2);
        out[0] = a;
        out[1] = b;
    }

    function _three(address a, address b, address c) internal pure returns (address[] memory out) {
        out = new address[](3);
        out[0] = a;
        out[1] = b;
        out[2] = c;
    }

    function _labels2(bytes32 a, bytes32 b) internal pure returns (bytes32[] memory out) {
        out = new bytes32[](2);
        out[0] = a;
        out[1] = b;
    }

    function _caps2(uint256 a, uint256 b) internal pure returns (uint256[] memory out) {
        out = new uint256[](2);
        out[0] = a;
        out[1] = b;
    }

    function _labels1(bytes32 a) internal pure returns (bytes32[] memory out) {
        out = new bytes32[](1);
        out[0] = a;
    }

    function _caps1(uint256 a) internal pure returns (uint256[] memory out) {
        out = new uint256[](1);
        out[0] = a;
    }
}
