// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {NivPayPotsV2} from "../src/NivPayPotsV2.sol";
import {MockAUSD} from "./mocks/MockAUSD.sol";

/// @notice Shared rig for the suites that test what NivPayPotsV2 adds: a
/// birthday pot with three deciders, two yeses needed, a caterer and a hall.
abstract contract PotsV2TestBase is Test {
    MockAUSD internal token;
    NivPayPotsV2 internal pots;

    address internal feeRecipient = makeAddr("feeRecipient");
    address internal ana = makeAddr("ana");
    address internal ben = makeAddr("ben");
    address internal cleo = makeAddr("cleo");
    address internal dave = makeAddr("dave");
    address internal stranger = makeAddr("stranger");
    address internal caterer = makeAddr("caterer");
    address internal hall = makeAddr("hall");
    address internal dj = makeAddr("dj");

    uint256 internal constant FEE_BPS = 100;
    uint256 internal constant FEE_CAP = 50_000000;
    uint256 internal constant ONE = 1_000000;

    uint256 internal potId;
    uint64 internal endTime;

    uint16 internal constant CATERER = 0;
    uint16 internal constant HALL = 1;

    function setUp() public virtual {
        vm.warp(1_760_000_000);
        token = new MockAUSD();
        pots = new NivPayPotsV2(IERC20(address(token)), FEE_BPS, FEE_CAP, feeRecipient, 72 hours, 7 days);
        endTime = uint64(block.timestamp + 30 days);
        potId = _birthday(endTime);
        _fundAccount(ana, 10_000 * ONE);
        _fundAccount(ben, 10_000 * ONE);
        _fundAccount(cleo, 10_000 * ONE);
        _fundAccount(dave, 10_000 * ONE);
    }

    function _birthday(uint64 end) internal returns (uint256) {
        address[] memory deciders = new address[](3);
        deciders[0] = ana;
        deciders[1] = ben;
        deciders[2] = cleo;
        address[] memory payees = new address[](2);
        payees[0] = caterer;
        payees[1] = hall;
        bytes32[] memory labels = new bytes32[](2);
        labels[0] = "Caterer";
        labels[1] = "Hall";
        uint256[] memory caps = new uint256[](2);
        caps[0] = 600 * ONE;
        caps[1] = 300 * ONE;
        return pots.createPot("Birthday", deciders, 2, payees, labels, caps, end);
    }

    function _fundAccount(address who, uint256 amount) internal {
        token.mint(who, amount);
        vm.prank(who);
        token.approve(address(pots), type(uint256).max);
    }

    function _fund(address who, uint256 amount) internal {
        vm.prank(who);
        pots.fund(potId, amount);
    }

    /// Ana proposes and Ben agrees: two yeses, the pot's threshold.
    function _agreed(uint256 changeId) internal {
        vm.prank(ben);
        pots.approveChange(changeId);
    }

    function _cap(uint16 index) internal view returns (uint256 cap) {
        (,, cap,,) = pots.getDestination(potId, index);
    }

    function _status(uint256 changeId) internal view returns (NivPayPotsV2.ChangeStatus) {
        return pots.changeInfo(changeId).status;
    }

    /// Pays `amount` to `index` with Ana's and Ben's yeses.
    function _pay(uint16 index, uint256 amount) internal returns (uint256 id) {
        vm.prank(ana);
        id = pots.proposePayout(potId, index, amount);
        vm.prank(ben);
        pots.approve(id);
    }
}
