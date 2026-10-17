// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {NivPayPots} from "../src/NivPayPots.sol";
import {MockAUSD} from "./mocks/MockAUSD.sol";

/// @notice The ledger vectors that app/src/lib/ledger.test.ts reads too, replayed
/// on the contract: every share minted, every exit and claim, every fee and
/// every person's funderInfo at the end must be the number recorded. The
/// money cards (README, "Where your money went") are worked out from these.
contract PotsLedgerTest is Test {
    uint256 internal constant FUND = 0;
    uint256 internal constant EXIT = 1;
    uint256 internal constant PAY = 2;
    uint256 internal constant CLOSE = 3;
    uint256 internal constant CLAIM = 4;

    address internal decider = makeAddr("decider");
    address internal feeRecipient = makeAddr("feeRecipient");

    struct Recorded {
        uint256[] kind;
        uint256[] who;
        uint256[] amount;
        uint256[] result;
        uint256[] left;
    }

    function test_vectors_everyNumberIsTheContracts() public {
        string memory json = vm.readFile(string.concat(vm.projectRoot(), "/test/vectors/ledger.json"));
        uint256 count = vm.parseJsonUint(json, ".count");
        assertGt(count, 19);
        for (uint256 i = 0; i < count; i++) {
            _replay(json, string.concat(".pots[", vm.toString(i), "]"));
        }
    }

    function _replay(string memory json, string memory at) internal {
        MockAUSD token = new MockAUSD();
        NivPayPots pots = new NivPayPots(
            IERC20(address(token)),
            vm.parseJsonUint(json, string.concat(at, ".feeBps")),
            vm.parseJsonUint(json, string.concat(at, ".feeCap")),
            feeRecipient
        );
        uint256 people = vm.parseJsonUint(json, string.concat(at, ".people"));
        address[] memory funders = new address[](people);
        for (uint256 j = 0; j < people; j++) {
            funders[j] = makeAddr(string.concat("person", vm.toString(j)));
            token.mint(funders[j], 1e15);
            vm.prank(funders[j]);
            token.approve(address(pots), type(uint256).max);
        }
        uint256 potId = _create(pots);

        Recorded memory r = Recorded({
            kind: vm.parseJsonUintArray(json, string.concat(at, ".kind")),
            who: vm.parseJsonUintArray(json, string.concat(at, ".who")),
            amount: vm.parseJsonUintArray(json, string.concat(at, ".amount")),
            result: vm.parseJsonUintArray(json, string.concat(at, ".result")),
            left: vm.parseJsonUintArray(json, string.concat(at, ".left"))
        });
        for (uint256 k = 0; k < r.kind.length; k++) {
            assertEq(_act(pots, potId, funders, r, k), r.result[k], string.concat(at, " action ", vm.toString(k)));
        }
        for (uint256 j = 0; j < people; j++) {
            (, uint256 redeemable) = pots.funderInfo(potId, funders[j]);
            assertEq(redeemable, r.left[j], string.concat(at, " left for person ", vm.toString(j)));
        }
        NivPayPots.PotView memory v = pots.getPot(potId);
        assertEq(v.totalAssets, vm.parseJsonUint(json, string.concat(at, ".totalAssets")), string.concat(at, " assets"));
        assertEq(v.totalShares, vm.parseJsonUint(json, string.concat(at, ".totalShares")), string.concat(at, " shares"));
    }

    function _act(NivPayPots pots, uint256 potId, address[] memory funders, Recorded memory r, uint256 k)
        internal
        returns (uint256)
    {
        uint256 kind = r.kind[k];
        if (kind == FUND) {
            vm.prank(funders[r.who[k]]);
            return pots.fund(potId, r.amount[k]);
        }
        if (kind == EXIT) {
            vm.prank(funders[r.who[k]]);
            return pots.exit(potId, r.amount[k]);
        }
        if (kind == PAY) {
            // One decider at threshold 1: the proposal is its own yes and pays at once. The fee is credited.
            uint256 before = pots.feesAccrued();
            vm.prank(decider);
            pots.proposePayout(potId, uint16(r.who[k]), r.amount[k]);
            return pots.feesAccrued() - before;
        }
        if (kind == CLOSE) {
            vm.prank(decider);
            pots.proposeClose(potId);
            assertTrue(pots.getPot(potId).closed);
            return 0;
        }
        assertEq(kind, CLAIM);
        vm.prank(funders[r.who[k]]);
        return pots.claim(potId);
    }

    function _create(NivPayPots pots) internal returns (uint256) {
        address[] memory deciders = new address[](1);
        deciders[0] = decider;
        address[] memory payees = new address[](3);
        bytes32[] memory labels = new bytes32[](3);
        uint256[] memory caps = new uint256[](3);
        for (uint256 i = 0; i < 3; i++) {
            payees[i] = makeAddr(string.concat("payee", vm.toString(i)));
            labels[i] = bytes32(bytes(string.concat("payee", vm.toString(i))));
            caps[i] = 1e30;
        }
        return pots.createPot("ledger", deciders, 1, payees, labels, caps, uint64(block.timestamp + 30 days));
    }
}
