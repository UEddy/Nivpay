// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {PotsTestBase} from "./PotsTestBase.sol";
import {NivPayPots} from "../src/NivPayPots.sol";

/// @notice Fuzzing over funding amounts, join and exit order, payout sizes and
/// fee settings. Every rounding claim here is one sided on purpose: the pot
/// may keep a unit, the caller may never take one.
contract PotsFuzzTest is PotsTestBase {
    address internal alice = makeAddr("alice");
    address internal bob = makeAddr("bob");
    address internal carol = makeAddr("carol");
    address internal destA = makeAddr("destA");

    uint64 internal endTime;

    /// One AUSD up to ten million AUSD, which spans anything a group purse
    /// plausibly holds without the numbers becoming meaningless.
    uint256 internal constant MIN_FUND = 1_000000;
    uint256 internal constant MAX_FUND = 10_000_000_000000;

    function setUp() public override {
        super.setUp();
        endTime = uint64(block.timestamp + 365 days);
        _fundAccount(alice, type(uint128).max);
        _fundAccount(bob, type(uint128).max);
        _fundAccount(carol, type(uint128).max);
    }

    function _newPot() internal returns (uint256) {
        return pots.createPot(
            "Fuzz",
            _three(alice, bob, carol),
            2,
            _one(destA),
            _labels1("A"),
            _caps1(type(uint128).max),
            endTime
        );
    }

    function _pay(uint256 potId, uint256 amount) internal {
        vm.prank(alice);
        uint256 id = pots.proposePayout(potId, 0, amount);
        vm.prank(bob);
        pots.approve(id);
    }

    // ---------------------------------------------------------------------
    // Funding and exiting
    // ---------------------------------------------------------------------

    function testFuzz_fundThenExitNeverReturnsMoreThanWentIn(uint256 amount) public {
        amount = bound(amount, MIN_FUND, MAX_FUND);
        uint256 potId = _newPot();

        vm.prank(alice);
        uint256 shares = pots.fund(potId, amount);
        vm.prank(alice);
        uint256 back = pots.exit(potId, shares);

        assertLe(back, amount, "never more than went in");
        assertEq(back, amount, "a sole funder with no spending gets it all back");
    }

    function testFuzz_fundingNeverDilutesAnExistingFunder(uint256 first, uint256 second) public {
        first = bound(first, MIN_FUND, MAX_FUND);
        second = bound(second, MIN_FUND, MAX_FUND);
        uint256 potId = _newPot();

        vm.prank(alice);
        pots.fund(potId, first);
        (, uint256 aliceBefore) = pots.funderInfo(potId, alice);

        vm.prank(bob);
        pots.fund(potId, second);
        (, uint256 aliceAfter) = pots.funderInfo(potId, alice);
        (, uint256 bobValue) = pots.funderInfo(potId, bob);

        assertGe(aliceAfter, aliceBefore, "somebody else joining never costs alice anything");
        assertLe(bobValue, second, "and bob never gains by joining");
        assertApproxEqAbs(bobValue, second, 1, "bob is worth what he funded, to within rounding");
    }

    function testFuzz_exitingNeverHurtsTheOthersBeyondRounding(uint256 a, uint256 b, uint256 exitPart) public {
        a = bound(a, MIN_FUND, MAX_FUND);
        b = bound(b, MIN_FUND, MAX_FUND);
        uint256 potId = _newPot();

        vm.prank(alice);
        pots.fund(potId, a);
        vm.prank(bob);
        uint256 bobShares = pots.fund(potId, b);

        (, uint256 aliceBefore) = pots.funderInfo(potId, alice);

        uint256 burn = bound(exitPart, 1, bobShares);
        vm.prank(bob);
        pots.exit(potId, burn);

        (, uint256 aliceAfter) = pots.funderInfo(potId, alice);
        assertGe(aliceAfter + 1, aliceBefore, "one funder leaving costs another at most one unit of rounding");
    }

    function testFuzz_joinOrderDoesNotMatter(uint256 a, uint256 b, uint256 c) public {
        a = bound(a, MIN_FUND, MAX_FUND);
        b = bound(b, MIN_FUND, MAX_FUND);
        c = bound(c, MIN_FUND, MAX_FUND);

        uint256 forward = _newPot();
        vm.prank(alice);
        pots.fund(forward, a);
        vm.prank(bob);
        pots.fund(forward, b);
        vm.prank(carol);
        pots.fund(forward, c);

        uint256 reverse = _newPot();
        vm.prank(carol);
        pots.fund(reverse, c);
        vm.prank(bob);
        pots.fund(reverse, b);
        vm.prank(alice);
        pots.fund(reverse, a);

        (, uint256 aForward) = pots.funderInfo(forward, alice);
        (, uint256 aReverse) = pots.funderInfo(reverse, alice);
        (, uint256 cForward) = pots.funderInfo(forward, carol);
        (, uint256 cReverse) = pots.funderInfo(reverse, carol);

        assertApproxEqAbs(aForward, aReverse, 2, "funding first or last is worth the same to alice");
        assertApproxEqAbs(cForward, cReverse, 2, "and the same to carol");
    }

    function testFuzz_exitOrderDoesNotMatter(uint256 a, uint256 b, uint256 spend) public {
        a = bound(a, MIN_FUND, MAX_FUND);
        b = bound(b, MIN_FUND, MAX_FUND);

        // Spend a share of the pot so there is something to divide unevenly.
        uint256 pool = a + b;
        spend = bound(spend, 0, (pool * 90) / 100);

        uint256 forward = _buildAndSpend(a, b, spend);
        uint256 reverse = _buildAndSpend(a, b, spend);

        uint256 aliceForward = _exitAll(forward, alice);
        uint256 bobForward = _exitAll(forward, bob);

        uint256 bobReverse = _exitAll(reverse, bob);
        uint256 aliceReverse = _exitAll(reverse, alice);

        assertApproxEqAbs(aliceForward, aliceReverse, 1, "alice gets the same whoever leaves first");
        assertApproxEqAbs(bobForward, bobReverse, 1, "and so does bob");
        assertLe(aliceForward + bobForward, pool - spend, "the two of them never take out more than was left unspent");
    }

    function _buildAndSpend(uint256 a, uint256 b, uint256 spend) internal returns (uint256 potId) {
        potId = _newPot();
        vm.prank(alice);
        pots.fund(potId, a);
        vm.prank(bob);
        pots.fund(potId, b);
        if (spend > 0) _pay(potId, spend);
    }

    function _exitAll(uint256 potId, address who) internal returns (uint256) {
        uint256 shares = pots.sharesOf(potId, who);
        if (shares == 0) return 0;
        vm.prank(who);
        return pots.exit(potId, shares);
    }

    // ---------------------------------------------------------------------
    // Payout sizes
    // ---------------------------------------------------------------------

    function testFuzz_payoutDebitsExactlyAmountPlusFee(uint256 funded, uint256 amount) public {
        funded = bound(funded, MIN_FUND, MAX_FUND);
        uint256 potId = _newPot();
        vm.prank(alice);
        pots.fund(potId, funded);

        // Keep the payout inside what the pot can afford, fee included.
        uint256 headroom = funded - pots.feeOn(funded);
        amount = bound(amount, 1, headroom > 0 ? headroom : 1);
        uint256 fee = pots.feeOn(amount);
        vm.assume(amount + fee <= funded);

        uint256 feesBefore = pots.feesAccrued();
        _pay(potId, amount);

        assertEq(token.balanceOf(destA), amount, "the destination receives the amount, never less the fee");
        assertEq(pots.getPot(potId).totalAssets, funded - amount - fee, "the pot is debited amount plus fee");
        assertEq(pots.feesAccrued() - feesBefore, fee, "the fee is credited, exactly once");
    }

    function testFuzz_spendingIsBorneInProportion(uint256 a, uint256 b, uint256 amount) public {
        a = bound(a, MIN_FUND, MAX_FUND);
        b = bound(b, MIN_FUND, MAX_FUND);
        uint256 potId = _newPot();

        vm.prank(alice);
        pots.fund(potId, a);
        vm.prank(bob);
        pots.fund(potId, b);

        uint256 total = pots.getPot(potId).totalAssets;
        amount = bound(amount, 1, (total * 90) / 100);
        uint256 fee = pots.feeOn(amount);
        vm.assume(amount + fee <= total);

        uint256 sharesA = pots.sharesOf(potId, alice);
        uint256 sharesB = pots.sharesOf(potId, bob);
        _pay(potId, amount);

        assertEq(pots.sharesOf(potId, alice), sharesA, "spending burns nobody's shares");
        assertEq(pots.sharesOf(potId, bob), sharesB, "spending burns nobody's shares");

        (, uint256 valueA) = pots.funderInfo(potId, alice);
        (, uint256 valueB) = pots.funderInfo(potId, bob);
        uint256 remaining = pots.getPot(potId).totalAssets;

        assertLe(valueA + valueB, remaining, "the pot always covers what it owes");
        // Each funder's share of the remainder tracks their share of the pot,
        // to within the rounding the pot keeps.
        assertApproxEqAbs(
            valueA, _proportionOf(remaining, sharesA, sharesA + sharesB), 2, "alice bears her proportion"
        );
        assertApproxEqAbs(
            valueB, _proportionOf(remaining, sharesB, sharesA + sharesB), 2, "bob bears his proportion"
        );
    }

    /// @dev What a holder of `part` out of `whole` shares is owed from
    /// `assets`, computed independently of the contract so the test is not
    /// checking the implementation against itself.
    function _proportionOf(uint256 assets, uint256 part, uint256 whole) internal pure returns (uint256) {
        return (assets * part) / whole;
    }

    // ---------------------------------------------------------------------
    // Fee settings
    // ---------------------------------------------------------------------

    function testFuzz_feeNeverExceedsBpsOrCap(uint256 bps, uint256 cap, uint256 amount) public {
        bps = bound(bps, 0, 100);
        cap = bound(cap, 0, MAX_FUND);
        amount = bound(amount, MIN_FUND, MAX_FUND);

        NivPayPots p = new NivPayPots(IERC20(address(token)), bps, cap, feeRecipient);
        uint256 fee = p.feeOn(amount);

        assertLe(fee, cap, "never above the per payout cap");
        assertLe(fee, (amount * bps) / 10_000, "never above the basis point rate");
        assertLe(fee, amount, "the fee is never larger than the payout itself at 100 bps");
    }

    function testFuzz_feeSettingsDoNotChangeWhatTheDestinationReceives(uint256 bps, uint256 cap, uint256 amount)
        public
    {
        bps = bound(bps, 0, 100);
        cap = bound(cap, 0, MAX_FUND);
        amount = bound(amount, MIN_FUND, MAX_FUND / 2);

        NivPayPots p = new NivPayPots(IERC20(address(token)), bps, cap, feeRecipient);
        vm.prank(alice);
        token.approve(address(p), type(uint256).max);
        vm.prank(bob);
        token.approve(address(p), type(uint256).max);

        uint256 potId = p.createPot(
            "Fees", _two(alice, bob), 2, _one(destA), _labels1("A"), _caps1(type(uint128).max), endTime
        );

        uint256 funded = amount + p.feeOn(amount);
        vm.prank(alice);
        p.fund(potId, funded);

        uint256 destBefore = token.balanceOf(destA);
        vm.prank(alice);
        uint256 id = p.proposePayout(potId, 0, amount);
        vm.prank(bob);
        p.approve(id);

        assertEq(token.balanceOf(destA) - destBefore, amount, "the destination always receives the full amount");
        assertEq(p.feesAccrued(), p.feeOn(amount), "and the fee comes out of the pot on top");
        assertEq(p.getPot(potId).totalAssets, 0, "funded exactly covered amount plus fee");
    }

    function testFuzz_capIsNeverExceeded(uint256 cap, uint256 first, uint256 second) public {
        cap = bound(cap, MIN_FUND, MAX_FUND);
        first = bound(first, 1, cap);
        second = bound(second, 1, MAX_FUND);

        uint256 potId = pots.createPot(
            "Capped", _two(alice, bob), 2, _one(destA), _labels1("A"), _caps1(cap), endTime
        );
        vm.prank(alice);
        pots.fund(potId, MAX_FUND * 2);

        _pay(potId, first);
        (,,, uint256 spent,) = pots.getDestination(potId, 0);
        assertEq(spent, first, "first payout counted");
        assertLe(spent, cap, "within the cap");

        vm.prank(alice);
        uint256 id = pots.proposePayout(potId, 0, second);
        vm.prank(bob);
        if (first + second > cap) {
            vm.expectRevert(NivPayPots.CapExceeded.selector);
            pots.approve(id);
        } else {
            pots.approve(id);
        }

        (,,, uint256 spentAfter,) = pots.getDestination(potId, 0);
        assertLe(spentAfter, cap, "the lifetime cap is never exceeded");
        assertEq(token.balanceOf(destA), spentAfter, "the destination holds exactly what was counted against it");
    }

    // ---------------------------------------------------------------------
    // Solvency across the lot
    // ---------------------------------------------------------------------

    function testFuzz_contractAlwaysCoversPotAssetsPlusFees(uint256 a, uint256 b, uint256 amount) public {
        a = bound(a, MIN_FUND, MAX_FUND);
        b = bound(b, MIN_FUND, MAX_FUND);
        uint256 potId = _newPot();

        vm.prank(alice);
        pots.fund(potId, a);
        vm.prank(bob);
        pots.fund(potId, b);

        uint256 total = pots.getPot(potId).totalAssets;
        amount = bound(amount, 1, (total * 90) / 100);
        vm.assume(amount + pots.feeOn(amount) <= total);
        _pay(potId, amount);

        assertGe(
            token.balanceOf(address(pots)),
            pots.getPot(potId).totalAssets + pots.feesAccrued(),
            "the contract always holds at least what it owes"
        );

        _exitAll(potId, alice);
        _exitAll(potId, bob);

        assertGe(
            token.balanceOf(address(pots)),
            pots.getPot(potId).totalAssets + pots.feesAccrued(),
            "and still does once everyone has left"
        );
    }
}
