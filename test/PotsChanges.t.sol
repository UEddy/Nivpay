// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {NivPayPots} from "../src/NivPayPots.sol";
import {NivPayPotsV2} from "../src/NivPayPotsV2.sol";
import {PotsV2TestBase} from "./PotsV2TestBase.sol";

/// @notice Every rule NivPayPotsV2 adds, one at a time: changes to a pot's
/// payees, limits and closing date, the exit window before a widening one
/// applies, and what payments may use meanwhile.
contract PotsChangesTest is PotsV2TestBase {
    uint256 internal constant WINDOW = 72 hours;
    uint256 internal constant APPLY = 7 days;

    // ---------------------------------------------------------------------
    // The constants
    // ---------------------------------------------------------------------

    function test_constants() public view {
        assertEq(pots.EXIT_WINDOW(), 72 hours);
        assertEq(pots.APPLY_PERIOD(), 7 days);
        assertEq(pots.MAX_OPEN_CHANGES(), 5);
    }

    // ---------------------------------------------------------------------
    // Who may propose and what
    // ---------------------------------------------------------------------

    function test_propose_onlyDecidersMay() public {
        vm.startPrank(stranger);
        vm.expectRevert(NivPayPots.NotApprover.selector);
        pots.proposeAddPayee(potId, dj, "DJ", 300 * ONE);
        vm.expectRevert(NivPayPots.NotApprover.selector);
        pots.proposeRaiseLimit(potId, CATERER, 700 * ONE);
        vm.expectRevert(NivPayPots.NotApprover.selector);
        pots.proposeLaterClose(potId, endTime + 1 days);
        vm.expectRevert(NivPayPots.NotApprover.selector);
        pots.proposeLowerLimit(potId, CATERER, 500 * ONE);
        vm.expectRevert(NivPayPots.NotApprover.selector);
        pots.proposeRemovePayee(potId, HALL);
        vm.stopPrank();
    }

    function test_propose_aFunderWhoIsNotADeciderMayNot() public {
        _fund(dave, 100 * ONE);
        vm.prank(dave);
        vm.expectRevert(NivPayPots.NotApprover.selector);
        pots.proposeAddPayee(potId, dj, "DJ", 300 * ONE);
    }

    function test_propose_noSuchPot() public {
        vm.prank(ana);
        vm.expectRevert(NivPayPots.NoSuchPot.selector);
        pots.proposeAddPayee(potId + 1, dj, "DJ", 300 * ONE);
    }

    function test_addPayee_refusesNoAddressItselfAndNoLimit() public {
        vm.startPrank(ana);
        vm.expectRevert(NivPayPots.ZeroAddress.selector);
        pots.proposeAddPayee(potId, address(0), "DJ", 300 * ONE);
        vm.expectRevert(NivPayPots.ZeroAddress.selector);
        pots.proposeAddPayee(potId, address(pots), "DJ", 300 * ONE);
        vm.expectRevert(NivPayPots.ZeroCap.selector);
        pots.proposeAddPayee(potId, dj, "DJ", 0);
        vm.stopPrank();
    }

    function test_addPayee_refusedOnceThePotHasTenPayees() public {
        for (uint256 i = 2; i < 10; ++i) {
            vm.prank(ana);
            uint256 id = pots.proposeAddPayee(potId, makeAddr(vm.toString(i)), "P", ONE);
            _agreed(id);
            vm.warp(block.timestamp + WINDOW);
            pots.applyChange(id);
        }
        assertEq(pots.getDestinations(potId).length, 10);
        vm.prank(ana);
        vm.expectRevert(NivPayPots.BadDestinationCount.selector);
        pots.proposeAddPayee(potId, dj, "DJ", ONE);
    }

    function test_raise_mustRaise() public {
        vm.startPrank(ana);
        vm.expectRevert(NivPayPotsV2.NotWider.selector);
        pots.proposeRaiseLimit(potId, CATERER, 600 * ONE);
        vm.expectRevert(NivPayPotsV2.NotWider.selector);
        pots.proposeRaiseLimit(potId, CATERER, 500 * ONE);
        vm.expectRevert(NivPayPots.NoSuchDestination.selector);
        pots.proposeRaiseLimit(potId, 2, 700 * ONE);
        vm.stopPrank();
    }

    function test_lower_mustLowerAndStayAboveWhatWasPaid() public {
        _fund(dave, 1_000 * ONE);
        _pay(CATERER, 400 * ONE);
        vm.startPrank(ana);
        vm.expectRevert(NivPayPotsV2.NotNarrower.selector);
        pots.proposeLowerLimit(potId, CATERER, 600 * ONE);
        vm.expectRevert(NivPayPotsV2.NotNarrower.selector);
        pots.proposeLowerLimit(potId, CATERER, 700 * ONE);
        vm.expectRevert(NivPayPotsV2.LimitBelowSpent.selector);
        pots.proposeLowerLimit(potId, CATERER, 400 * ONE - 1);
        vm.expectRevert(NivPayPots.ZeroCap.selector);
        pots.proposeLowerLimit(potId, HALL, 0);
        vm.expectRevert(NivPayPots.NoSuchDestination.selector);
        pots.proposeLowerLimit(potId, 2, ONE);
        // Exactly what was paid is allowed: nothing more can go to the caterer.
        pots.proposeLowerLimit(potId, CATERER, 400 * ONE);
        vm.stopPrank();
    }

    function test_laterClose_mustBeLater() public {
        vm.startPrank(ana);
        vm.expectRevert(NivPayPotsV2.NotWider.selector);
        pots.proposeLaterClose(potId, endTime);
        vm.expectRevert(NivPayPotsV2.NotWider.selector);
        pots.proposeLaterClose(potId, endTime - 1);
        vm.stopPrank();
    }

    function test_remove_noSuchPayee() public {
        vm.prank(ana);
        vm.expectRevert(NivPayPots.NoSuchDestination.selector);
        pots.proposeRemovePayee(potId, 2);
    }

    // ---------------------------------------------------------------------
    // Yeses: the same number as a payment
    // ---------------------------------------------------------------------

    function test_oneYesOfTwoChangesNothing() public {
        vm.prank(ana);
        uint256 id = pots.proposeLowerLimit(potId, CATERER, 500 * ONE);
        assertEq(uint8(_status(id)), uint8(NivPayPotsV2.ChangeStatus.Pending));
        assertEq(_cap(CATERER), 600 * ONE, "one yes is not enough");
        assertEq(pots.changeInfo(id).approvals, 1);
        assertEq(pots.changeInfo(id).threshold, 2);
    }

    function test_yeses_aThreeOfThreePotNeedsAllThree() public {
        address[] memory deciders = new address[](3);
        deciders[0] = ana;
        deciders[1] = ben;
        deciders[2] = cleo;
        address[] memory payees = new address[](1);
        payees[0] = caterer;
        bytes32[] memory labels = new bytes32[](1);
        labels[0] = "Caterer";
        uint256[] memory caps = new uint256[](1);
        caps[0] = 600 * ONE;
        uint256 all = pots.createPot("All", deciders, 3, payees, labels, caps, endTime);

        vm.prank(ana);
        uint256 lower = pots.proposeLowerLimit(all, 0, 500 * ONE);
        vm.prank(ana);
        uint256 raise = pots.proposeRaiseLimit(all, 0, 700 * ONE);
        vm.prank(ben);
        pots.approveChange(lower);
        vm.prank(ben);
        pots.approveChange(raise);
        (,, uint256 cap,,) = pots.getDestination(all, 0);
        assertEq(cap, 600 * ONE, "two of three change nothing");
        assertEq(uint8(_status(lower)), uint8(NivPayPotsV2.ChangeStatus.Pending));
        assertEq(uint8(_status(raise)), uint8(NivPayPotsV2.ChangeStatus.Pending));

        vm.prank(cleo);
        pots.approveChange(lower);
        (,, cap,,) = pots.getDestination(all, 0);
        assertEq(cap, 500 * ONE, "the third yes applies the narrowing one");
        vm.prank(cleo);
        pots.approveChange(raise);
        assertEq(uint8(_status(raise)), uint8(NivPayPotsV2.ChangeStatus.Waiting), "and starts the wide one's wait");
    }

    function test_approve_onlyDecidersAndOnlyOnce() public {
        vm.prank(ana);
        uint256 id = pots.proposeAddPayee(potId, dj, "DJ", 300 * ONE);
        vm.prank(stranger);
        vm.expectRevert(NivPayPots.NotApprover.selector);
        pots.approveChange(id);
        vm.prank(ana);
        vm.expectRevert(NivPayPots.AlreadyApproved.selector);
        pots.approveChange(id);
        vm.expectRevert(NivPayPotsV2.NoSuchChange.selector);
        pots.approveChange(id + 1);
    }

    function test_approve_aDeciderOfAnotherPotMayNot() public {
        address[] memory others = new address[](1);
        others[0] = dave;
        address[] memory payees = new address[](1);
        payees[0] = dj;
        bytes32[] memory labels = new bytes32[](1);
        labels[0] = "DJ";
        uint256[] memory caps = new uint256[](1);
        caps[0] = ONE;
        pots.createPot("Other", others, 1, payees, labels, caps, endTime);

        vm.prank(ana);
        uint256 id = pots.proposeAddPayee(potId, dj, "DJ", 300 * ONE);
        vm.prank(dave);
        vm.expectRevert(NivPayPots.NotApprover.selector);
        pots.approveChange(id);
    }

    function test_revoke_takesAYesBack() public {
        vm.prank(ana);
        uint256 id = pots.proposeLowerLimit(potId, CATERER, 500 * ONE);
        vm.prank(ana);
        pots.revokeChangeYes(id);
        assertEq(pots.changeInfo(id).approvals, 0);
        assertFalse(pots.hasApprovedChange(id, ana));
        vm.prank(ana);
        vm.expectRevert(NivPayPots.NotApproved.selector);
        pots.revokeChangeYes(id);
        // Ben's yes alone is now one of two.
        vm.prank(ben);
        pots.approveChange(id);
        assertEq(_cap(CATERER), 600 * ONE);
    }

    function test_noYesCountsOnceAgreed() public {
        vm.prank(ana);
        uint256 id = pots.proposeAddPayee(potId, dj, "DJ", 300 * ONE);
        _agreed(id);
        vm.prank(cleo);
        vm.expectRevert(NivPayPotsV2.ChangeNotPending.selector);
        pots.approveChange(id);
        vm.prank(ben);
        vm.expectRevert(NivPayPotsV2.ChangeNotPending.selector);
        pots.revokeChangeYes(id);
    }

    function test_unagreedChangeExpiresAfterSevenDays() public {
        vm.prank(ana);
        uint256 id = pots.proposeAddPayee(potId, dj, "DJ", 300 * ONE);
        vm.warp(block.timestamp + 7 days);
        assertEq(uint8(_status(id)), uint8(NivPayPotsV2.ChangeStatus.Pending), "the last second still counts");
        vm.warp(block.timestamp + 1);
        assertEq(uint8(_status(id)), uint8(NivPayPotsV2.ChangeStatus.Expired));
        vm.prank(ben);
        vm.expectRevert(NivPayPots.ProposalExpired.selector);
        pots.approveChange(id);
        vm.expectRevert(NivPayPotsV2.ChangeNotReady.selector);
        pots.applyChange(id);
    }

    // ---------------------------------------------------------------------
    // Narrowing: applies with the yes that agrees it
    // ---------------------------------------------------------------------

    function test_lower_appliesAtOnce() public {
        vm.prank(ana);
        uint256 id = pots.proposeLowerLimit(potId, CATERER, 500 * ONE);
        vm.expectEmit(true, true, false, true, address(pots));
        emit NivPayPotsV2.ChangeApproved(id, potId, uint64(block.timestamp), uint64(block.timestamp));
        vm.expectEmit(true, true, false, true, address(pots));
        emit NivPayPotsV2.ChangeApplied(id, potId, NivPayPotsV2.ChangeKind.LowerLimit, CATERER, 500 * ONE, 0);
        _agreed(id);
        assertEq(_cap(CATERER), 500 * ONE);
        assertEq(uint8(_status(id)), uint8(NivPayPotsV2.ChangeStatus.Applied));
        assertEq(pots.openChanges(potId).length, 0);
    }

    function test_remove_appliesAtOnceAndThePayeeIsPaidNothingMore() public {
        _fund(dave, 1_000 * ONE);
        _pay(HALL, 100 * ONE);
        vm.prank(ana);
        uint256 id = pots.proposeRemovePayee(potId, HALL);
        _agreed(id);
        assertTrue(pots.isRemoved(potId, HALL));
        assertFalse(pots.isRemoved(potId, CATERER));
        assertEq(pots.getDestinations(potId).length, 2, "kept at its index");

        vm.prank(ana);
        vm.expectRevert(NivPayPotsV2.PayeeRemoved.selector);
        pots.proposePayout(potId, HALL, ONE);
        vm.startPrank(ana);
        vm.expectRevert(NivPayPotsV2.PayeeRemoved.selector);
        pots.proposeRemovePayee(potId, HALL);
        vm.expectRevert(NivPayPotsV2.PayeeRemoved.selector);
        pots.proposeRaiseLimit(potId, HALL, 400 * ONE);
        vm.expectRevert(NivPayPotsV2.PayeeRemoved.selector);
        pots.proposeLowerLimit(potId, HALL, 200 * ONE);
        vm.stopPrank();
    }

    function test_narrowing_appliesWhileFrozen() public {
        vm.prank(cleo);
        pots.freeze(potId);
        vm.prank(ana);
        uint256 id = pots.proposeLowerLimit(potId, CATERER, 500 * ONE);
        _agreed(id);
        assertEq(_cap(CATERER), 500 * ONE);
    }

    function test_lower_thatNoLongerFitsWaitsForItsYes() public {
        _fund(dave, 1_000 * ONE);
        vm.prank(ana);
        uint256 id = pots.proposeLowerLimit(potId, CATERER, 300 * ONE);
        _pay(CATERER, 400 * ONE);
        // The caterer has had 400 since: lowering to 300 would be below it.
        vm.prank(ben);
        vm.expectRevert(NivPayPotsV2.LimitBelowSpent.selector);
        pots.approveChange(id);
        assertEq(uint8(_status(id)), uint8(NivPayPotsV2.ChangeStatus.Pending), "still there to withdraw");
    }

    function test_lower_thatWouldNowRaiseIsRefused() public {
        vm.prank(ana);
        uint256 first = pots.proposeLowerLimit(potId, CATERER, 500 * ONE);
        vm.prank(ana);
        uint256 second = pots.proposeLowerLimit(potId, CATERER, 200 * ONE);
        _agreed(second);
        assertEq(_cap(CATERER), 200 * ONE);
        vm.prank(ben);
        vm.expectRevert(NivPayPotsV2.NotNarrower.selector);
        pots.approveChange(first);
    }

    // ---------------------------------------------------------------------
    // Widening: waits 72 hours from the yes that agrees it
    // ---------------------------------------------------------------------

    function test_widening_waitsSeventyTwoHours() public {
        vm.prank(ana);
        uint256 id = pots.proposeAddPayee(potId, dj, "DJ", 300 * ONE);
        uint64 at = uint64(block.timestamp);
        vm.expectEmit(true, true, false, true, address(pots));
        emit NivPayPotsV2.ChangeApproved(id, potId, at + uint64(WINDOW), at + uint64(WINDOW + APPLY));
        _agreed(id);

        assertEq(uint8(_status(id)), uint8(NivPayPotsV2.ChangeStatus.Waiting));
        assertEq(pots.getDestinations(potId).length, 2, "nothing added yet");
        NivPayPotsV2.ChangeView memory v = pots.changeInfo(id);
        assertEq(v.appliesAt, at + WINDOW);
        assertEq(v.lapsesAt, at + WINDOW + APPLY);

        vm.warp(at + WINDOW - 1);
        vm.expectRevert(NivPayPotsV2.ChangeNotReady.selector);
        pots.applyChange(id);

        vm.warp(at + WINDOW);
        assertEq(uint8(_status(id)), uint8(NivPayPotsV2.ChangeStatus.Ready));
        vm.expectEmit(true, true, false, true, address(pots));
        emit NivPayPotsV2.ChangeApplied(id, potId, NivPayPotsV2.ChangeKind.AddPayee, 2, 300 * ONE, 0);
        vm.prank(stranger);
        pots.applyChange(id);

        NivPayPotsV2.Destination[] memory ds = pots.getDestinations(potId);
        assertEq(ds.length, 3);
        assertEq(ds[2].to, dj);
        assertEq(ds[2].label, "DJ");
        assertEq(ds[2].cap, 300 * ONE);
        assertEq(pots.changeInfo(id).destIndex, 2);
    }

    function test_widening_theWaitIsFromTheYesThatAgreedIt() public {
        vm.prank(ana);
        uint256 id = pots.proposeRaiseLimit(potId, CATERER, 660 * ONE);
        vm.warp(block.timestamp + 2 days);
        uint256 agreedAt = block.timestamp;
        _agreed(id);
        vm.warp(agreedAt + WINDOW - 1);
        vm.expectRevert(NivPayPotsV2.ChangeNotReady.selector);
        pots.applyChange(id);
        vm.warp(agreedAt + WINDOW);
        pots.applyChange(id);
        assertEq(_cap(CATERER), 660 * ONE);
    }

    function test_widening_aOneOfNPotStillWaits() public {
        address[] memory one = new address[](1);
        one[0] = ana;
        address[] memory payees = new address[](1);
        payees[0] = caterer;
        bytes32[] memory labels = new bytes32[](1);
        labels[0] = "Caterer";
        uint256[] memory caps = new uint256[](1);
        caps[0] = 600 * ONE;
        uint256 solo = pots.createPot("Solo", one, 1, payees, labels, caps, endTime);

        vm.prank(ana);
        uint256 id = pots.proposeRaiseLimit(solo, 0, 1_000 * ONE);
        assertEq(uint8(_status(id)), uint8(NivPayPotsV2.ChangeStatus.Waiting), "agreed by its proposal, then waits");
        (,, uint256 cap,,) = pots.getDestination(solo, 0);
        assertEq(cap, 600 * ONE);
        vm.expectRevert(NivPayPotsV2.ChangeNotReady.selector);
        pots.applyChange(id);
    }

    function test_widening_lapsesSevenDaysAfterItsWait() public {
        vm.prank(ana);
        uint256 id = pots.proposeLaterClose(potId, endTime + 10 days);
        uint256 at = block.timestamp;
        _agreed(id);

        vm.warp(at + WINDOW + APPLY);
        assertEq(uint8(_status(id)), uint8(NivPayPotsV2.ChangeStatus.Ready), "the last second still counts");
        vm.warp(at + WINDOW + APPLY + 1);
        assertEq(uint8(_status(id)), uint8(NivPayPotsV2.ChangeStatus.Lapsed));
        vm.expectRevert(NivPayPotsV2.ChangeNotReady.selector);
        pots.applyChange(id);

        vm.expectEmit(true, true, false, true, address(pots));
        emit NivPayPotsV2.ChangeLapsed(id, potId);
        vm.prank(stranger);
        pots.lapseChange(id);
        assertEq(pots.openChanges(potId).length, 0);
        vm.expectRevert(NivPayPotsV2.ChangeNotOpen.selector);
        pots.lapseChange(id);
        assertEq(pots.getPot(potId).endTime, endTime, "never applied");
    }

    function test_lapse_refusedBeforeItHasLapsed() public {
        vm.prank(ana);
        uint256 id = pots.proposeAddPayee(potId, dj, "DJ", 300 * ONE);
        vm.expectRevert(NivPayPotsV2.ChangeNotLapsed.selector);
        pots.lapseChange(id);
        _agreed(id);
        vm.expectRevert(NivPayPotsV2.ChangeNotLapsed.selector);
        pots.lapseChange(id);
        vm.warp(block.timestamp + WINDOW);
        vm.expectRevert(NivPayPotsV2.ChangeNotLapsed.selector);
        pots.lapseChange(id);
    }

    function test_widening_notWhileFrozen() public {
        vm.prank(ana);
        uint256 id = pots.proposeRaiseLimit(potId, CATERER, 660 * ONE);
        _agreed(id);
        vm.warp(block.timestamp + WINDOW);
        vm.prank(cleo);
        pots.freeze(potId);
        vm.expectRevert(NivPayPots.PotFrozen.selector);
        pots.applyChange(id);

        vm.prank(ana);
        uint256 un = pots.proposeUnfreeze(potId);
        vm.prank(ben);
        pots.approve(un);
        pots.applyChange(id);
        assertEq(_cap(CATERER), 660 * ONE);
    }

    function test_widening_mayBeProposedAndAgreedWhileFrozen() public {
        vm.prank(cleo);
        pots.freeze(potId);
        vm.prank(ana);
        uint256 id = pots.proposeAddPayee(potId, dj, "DJ", 300 * ONE);
        _agreed(id);
        assertEq(uint8(_status(id)), uint8(NivPayPotsV2.ChangeStatus.Waiting));
    }

    function test_raise_thatNoLongerRaisesIsRefused() public {
        vm.prank(ana);
        uint256 small = pots.proposeRaiseLimit(potId, CATERER, 650 * ONE);
        vm.prank(ana);
        uint256 big = pots.proposeRaiseLimit(potId, CATERER, 900 * ONE);
        _agreed(small);
        _agreed(big);
        vm.warp(block.timestamp + WINDOW);
        pots.applyChange(big);
        vm.expectRevert(NivPayPotsV2.NotWider.selector);
        pots.applyChange(small);
        assertEq(_cap(CATERER), 900 * ONE);
    }

    function test_raise_ofAPayeeRemovedMeanwhileIsRefused() public {
        vm.prank(ana);
        uint256 raise = pots.proposeRaiseLimit(potId, HALL, 400 * ONE);
        _agreed(raise);
        vm.prank(ana);
        uint256 remove = pots.proposeRemovePayee(potId, HALL);
        _agreed(remove);
        vm.warp(block.timestamp + WINDOW);
        vm.expectRevert(NivPayPotsV2.PayeeRemoved.selector);
        pots.applyChange(raise);
    }

    function test_add_whenTheLastPlaceWasTakenMeanwhileIsRefused() public {
        for (uint256 i = 2; i < 9; ++i) {
            vm.prank(ana);
            uint256 x = pots.proposeAddPayee(potId, makeAddr(vm.toString(i)), "P", ONE);
            _agreed(x);
            vm.warp(block.timestamp + WINDOW);
            pots.applyChange(x);
        }
        vm.prank(ana);
        uint256 a = pots.proposeAddPayee(potId, dj, "DJ", ONE);
        vm.prank(ana);
        uint256 b = pots.proposeAddPayee(potId, stranger, "Band", ONE);
        _agreed(a);
        _agreed(b);
        vm.warp(block.timestamp + WINDOW);
        pots.applyChange(a);
        vm.expectRevert(NivPayPots.BadDestinationCount.selector);
        pots.applyChange(b);
    }

    function test_laterClose_keepsThePotOpenPastItsOldDate() public {
        _fund(dave, 1_000 * ONE);
        vm.prank(ana);
        uint256 id = pots.proposeLaterClose(potId, endTime + 10 days);
        _agreed(id);
        vm.warp(block.timestamp + WINDOW);
        pots.applyChange(id);
        assertEq(pots.getPot(potId).endTime, endTime + 10 days);

        vm.warp(endTime + 1);
        assertFalse(pots.getPot(potId).closed);
        _pay(CATERER, 100 * ONE);
        vm.warp(endTime + 10 days);
        assertTrue(pots.getPot(potId).closed);
    }

    // ---------------------------------------------------------------------
    // Payments use the pot as it is now
    // ---------------------------------------------------------------------

    function test_pay_aPayeeNotYetAppliedIsNotThere() public {
        _fund(dave, 1_000 * ONE);
        vm.prank(ana);
        uint256 id = pots.proposeAddPayee(potId, dj, "DJ", 300 * ONE);
        _agreed(id);
        vm.prank(ana);
        vm.expectRevert(NivPayPots.NoSuchDestination.selector);
        pots.proposePayout(potId, 2, ONE);
        vm.warp(block.timestamp + WINDOW);
        pots.applyChange(id);
        _pay(2, 300 * ONE);
        assertEq(token.balanceOf(dj), 300 * ONE);
    }

    function test_pay_aRaiseNotYetAppliedGivesNothing() public {
        _fund(dave, 2_000 * ONE);
        vm.prank(ana);
        uint256 id = pots.proposeRaiseLimit(potId, CATERER, 660 * ONE);
        _agreed(id);

        vm.prank(ana);
        uint256 pay = pots.proposePayout(potId, CATERER, 660 * ONE);
        vm.prank(ben);
        vm.expectRevert(NivPayPots.CapExceeded.selector);
        pots.approve(pay);

        vm.warp(block.timestamp + WINDOW);
        pots.applyChange(id);
        vm.prank(ben);
        pots.approve(pay);
        assertEq(token.balanceOf(caterer), 660 * ONE);
    }

    function test_pay_aPendingPaymentToAPayeeRemovedMeanwhileIsRefused() public {
        _fund(dave, 1_000 * ONE);
        vm.prank(ana);
        uint256 pay = pots.proposePayout(potId, HALL, 100 * ONE);
        vm.prank(ana);
        uint256 remove = pots.proposeRemovePayee(potId, HALL);
        _agreed(remove);
        vm.prank(ben);
        vm.expectRevert(NivPayPotsV2.PayeeRemoved.selector);
        pots.approve(pay);
        assertEq(token.balanceOf(hall), 0);
    }

    function test_pay_aPendingPaymentAboveALoweredLimitIsRefused() public {
        _fund(dave, 1_000 * ONE);
        vm.prank(ana);
        uint256 pay = pots.proposePayout(potId, CATERER, 550 * ONE);
        vm.prank(ana);
        uint256 lower = pots.proposeLowerLimit(potId, CATERER, 500 * ONE);
        _agreed(lower);
        vm.prank(ben);
        vm.expectRevert(NivPayPots.CapExceeded.selector);
        pots.approve(pay);
    }

    // ---------------------------------------------------------------------
    // Exits during the wait
    // ---------------------------------------------------------------------

    function test_exit_worksAllThroughTheWait() public {
        _fund(dave, 500 * ONE);
        _fund(ana, 500 * ONE);
        _pay(CATERER, 400 * ONE);
        vm.prank(ana);
        uint256 id = pots.proposeAddPayee(potId, dj, "DJ", 300 * ONE);
        _agreed(id);

        vm.warp(block.timestamp + 1 hours);
        (uint256 shares, uint256 worth) = pots.funderInfo(potId, dave);
        uint256 before = token.balanceOf(dave);
        vm.prank(dave);
        uint256 got = pots.exit(potId, shares);
        assertEq(got, worth, "the contract's own number");
        assertEq(token.balanceOf(dave), before + worth);

        vm.prank(cleo);
        pots.freeze(potId);
        (shares,) = pots.funderInfo(potId, ana);
        vm.prank(ana);
        pots.exit(potId, shares);
        assertEq(pots.sharesOf(potId, ana), 0, "a freeze during the wait stops nobody leaving");
    }

    // ---------------------------------------------------------------------
    // Closed pots take no change
    // ---------------------------------------------------------------------

    function test_closed_takesNoChange() public {
        vm.prank(ana);
        uint256 waiting = pots.proposeAddPayee(potId, dj, "DJ", 300 * ONE);
        _agreed(waiting);
        vm.prank(ana);
        uint256 pending = pots.proposeLowerLimit(potId, CATERER, 500 * ONE);

        vm.prank(ana);
        uint256 close = pots.proposeClose(potId);
        vm.prank(ben);
        pots.approve(close);

        vm.startPrank(ana);
        vm.expectRevert(NivPayPots.PotClosed.selector);
        pots.proposeAddPayee(potId, dj, "DJ", 300 * ONE);
        vm.expectRevert(NivPayPots.PotClosed.selector);
        pots.proposeRaiseLimit(potId, CATERER, 700 * ONE);
        vm.expectRevert(NivPayPots.PotClosed.selector);
        pots.proposeLaterClose(potId, endTime + 1 days);
        vm.expectRevert(NivPayPots.PotClosed.selector);
        pots.proposeLowerLimit(potId, CATERER, 400 * ONE);
        vm.expectRevert(NivPayPots.PotClosed.selector);
        pots.proposeRemovePayee(potId, HALL);
        vm.stopPrank();

        vm.prank(ben);
        vm.expectRevert(NivPayPots.PotClosed.selector);
        pots.approveChange(pending);
        vm.warp(block.timestamp + WINDOW);
        vm.expectRevert(NivPayPots.PotClosed.selector);
        pots.applyChange(waiting);
    }

    function test_closed_byItsDateTakesNoChange() public {
        uint64 soon = uint64(block.timestamp + 5 days);
        uint256 short = _birthday(soon);
        vm.prank(ana);
        uint256 id = pots.proposeLaterClose(short, soon + 10 days);
        vm.prank(ben);
        pots.approveChange(id);
        vm.warp(soon);
        // The wait ended before the old date, but nobody applied it in time.
        assertEq(uint8(_status(id)), uint8(NivPayPotsV2.ChangeStatus.Ready));
        vm.expectRevert(NivPayPots.PotClosed.selector);
        pots.applyChange(id);
    }

    // ---------------------------------------------------------------------
    // At most five open, and the proposer can withdraw
    // ---------------------------------------------------------------------

    function test_open_atMostFive() public {
        uint256[] memory ids = new uint256[](5);
        for (uint256 i = 0; i < 5; ++i) {
            vm.prank(ana);
            ids[i] = pots.proposeRaiseLimit(potId, CATERER, (700 + i) * ONE);
        }
        assertEq(pots.openChanges(potId).length, 5);
        vm.prank(ben);
        vm.expectRevert(NivPayPotsV2.TooManyOpenChanges.selector);
        pots.proposeAddPayee(potId, dj, "DJ", ONE);

        vm.prank(ana);
        pots.withdrawChange(ids[2]);
        vm.prank(ben);
        pots.proposeAddPayee(potId, dj, "DJ", ONE);
        assertEq(pots.openChanges(potId).length, 5);
    }

    function test_open_agreedAndWaitingStillCounts() public {
        for (uint256 i = 0; i < 5; ++i) {
            vm.prank(ana);
            uint256 id = pots.proposeRaiseLimit(potId, CATERER, (700 + i) * ONE);
            _agreed(id);
        }
        vm.prank(ana);
        vm.expectRevert(NivPayPotsV2.TooManyOpenChanges.selector);
        pots.proposeAddPayee(potId, dj, "DJ", ONE);
    }

    function test_open_expiredAndLapsedFreeTheirPlaces() public {
        vm.startPrank(ana);
        for (uint256 i = 0; i < 3; ++i) {
            pots.proposeRaiseLimit(potId, CATERER, (700 + i) * ONE);
        }
        uint256 a = pots.proposeAddPayee(potId, dj, "DJ", ONE);
        uint256 b = pots.proposeLaterClose(potId, endTime + 1 days);
        vm.stopPrank();
        _agreed(a);
        _agreed(b);

        // The three never agreed expire after 7 days; the two agreed lapse 7 days after their wait.
        vm.warp(block.timestamp + WINDOW + APPLY + 1);
        vm.expectEmit(true, true, false, true, address(pots));
        emit NivPayPotsV2.ChangeLapsed(b, potId);
        vm.expectEmit(true, true, false, true, address(pots));
        emit NivPayPotsV2.ChangeLapsed(a, potId);
        vm.prank(ana);
        pots.proposeRemovePayee(potId, HALL);
        assertEq(pots.openChanges(potId).length, 1, "only the new one");
    }

    function test_open_aOneOfNNarrowingHoldsNoPlace() public {
        address[] memory one = new address[](1);
        one[0] = ana;
        address[] memory payees = new address[](1);
        payees[0] = caterer;
        bytes32[] memory labels = new bytes32[](1);
        labels[0] = "Caterer";
        uint256[] memory caps = new uint256[](1);
        caps[0] = 600 * ONE;
        uint256 solo = pots.createPot("Solo", one, 1, payees, labels, caps, endTime);
        for (uint256 i = 0; i < 10; ++i) {
            vm.prank(ana);
            pots.proposeLowerLimit(solo, 0, (590 - i) * ONE);
        }
        assertEq(pots.openChanges(solo).length, 0);
    }

    function test_withdraw_onlyTheProposerAndOnlyWhileOpen() public {
        vm.prank(ana);
        uint256 id = pots.proposeAddPayee(potId, dj, "DJ", 300 * ONE);
        _agreed(id);
        vm.prank(ben);
        vm.expectRevert(NivPayPots.NotProposer.selector);
        pots.withdrawChange(id);

        vm.expectEmit(true, true, true, true, address(pots));
        emit NivPayPotsV2.ChangeWithdrawn(id, potId, ana);
        vm.prank(ana);
        pots.withdrawChange(id);
        assertEq(uint8(_status(id)), uint8(NivPayPotsV2.ChangeStatus.Withdrawn));

        vm.prank(ana);
        vm.expectRevert(NivPayPotsV2.ChangeNotOpen.selector);
        pots.withdrawChange(id);
        vm.warp(block.timestamp + WINDOW);
        vm.expectRevert(NivPayPotsV2.ChangeNotReady.selector);
        pots.applyChange(id);
        vm.prank(cleo);
        vm.expectRevert(NivPayPotsV2.ChangeNotPending.selector);
        pots.approveChange(id);
    }

    function test_withdraw_whileReady() public {
        vm.prank(ana);
        uint256 id = pots.proposeAddPayee(potId, dj, "DJ", 300 * ONE);
        _agreed(id);
        vm.warp(block.timestamp + WINDOW + 1 days);
        vm.prank(ana);
        pots.withdrawChange(id);
        vm.expectRevert(NivPayPotsV2.ChangeNotReady.selector);
        pots.applyChange(id);
    }

    function test_withdraw_notOnceAppliedOrLapsed() public {
        vm.prank(ana);
        uint256 lower = pots.proposeLowerLimit(potId, CATERER, 500 * ONE);
        _agreed(lower);
        vm.prank(ana);
        vm.expectRevert(NivPayPotsV2.ChangeNotOpen.selector);
        pots.withdrawChange(lower);

        vm.prank(ana);
        uint256 add = pots.proposeAddPayee(potId, dj, "DJ", 300 * ONE);
        _agreed(add);
        vm.warp(block.timestamp + WINDOW + APPLY + 1);
        vm.prank(ana);
        vm.expectRevert(NivPayPotsV2.ChangeNotOpen.selector);
        pots.withdrawChange(add);
    }

    // ---------------------------------------------------------------------
    // Events and views
    // ---------------------------------------------------------------------

    function test_events_proposedAndEachYes() public {
        vm.expectEmit(true, true, true, true, address(pots));
        emit NivPayPotsV2.ChangeProposed(
            0, potId, ana, NivPayPotsV2.ChangeKind.AddPayee, 0, dj, "DJ", 300 * ONE, 0, uint64(block.timestamp + 7 days)
        );
        vm.expectEmit(true, true, true, true, address(pots));
        emit NivPayPotsV2.ChangeYes(0, potId, ana, 1);
        vm.prank(ana);
        uint256 id = pots.proposeAddPayee(potId, dj, "DJ", 300 * ONE);

        vm.expectEmit(true, true, true, true, address(pots));
        emit NivPayPotsV2.ChangeYes(id, potId, ben, 2);
        _agreed(id);

        vm.prank(ana);
        uint256 lower = pots.proposeLowerLimit(potId, HALL, 200 * ONE);
        vm.expectEmit(true, true, true, true, address(pots));
        emit NivPayPotsV2.ChangeYesRevoked(lower, potId, ana, 0);
        vm.prank(ana);
        pots.revokeChangeYes(lower);
    }

    function test_changeInfo_saysEverything() public {
        vm.prank(ana);
        uint256 id = pots.proposeRaiseLimit(potId, HALL, 400 * ONE);
        NivPayPotsV2.ChangeView memory v = pots.changeInfo(id);
        assertEq(v.potId, potId);
        assertEq(uint8(v.kind), uint8(NivPayPotsV2.ChangeKind.RaiseLimit));
        assertEq(v.destIndex, HALL);
        assertEq(v.to, hall);
        assertEq(v.limit, 400 * ONE);
        assertEq(v.proposer, ana);
        assertEq(v.createdAt, block.timestamp);
        assertEq(v.expiresAt, block.timestamp + 7 days);
        assertEq(v.appliesAt, 0, "not agreed yet");
        assertEq(v.approvedBy.length, 1);
        assertEq(v.approvedBy[0], ana);

        vm.prank(ana);
        uint256 later = pots.proposeLaterClose(potId, endTime + 1 days);
        assertEq(pots.changeInfo(later).to, address(0));
        assertEq(pots.changeInfo(later).endTime, endTime + 1 days);
        vm.expectRevert(NivPayPotsV2.NoSuchChange.selector);
        pots.changeInfo(later + 1);
        vm.expectRevert(NivPayPots.NoSuchDestination.selector);
        pots.isRemoved(potId, 2);
        vm.expectRevert(NivPayPots.NoSuchPot.selector);
        pots.openChanges(potId + 1);
    }

    function test_isolation_aChangeTouchesOnlyItsOwnPot() public {
        uint256 other = _birthday(endTime);
        vm.prank(ana);
        uint256 id = pots.proposeRemovePayee(potId, CATERER);
        _agreed(id);
        assertTrue(pots.isRemoved(potId, CATERER));
        assertFalse(pots.isRemoved(other, CATERER));
        (,, uint256 cap,,) = pots.getDestination(other, CATERER);
        assertEq(cap, 600 * ONE);
    }

    function test_noWayToChangeDecidersThresholdOrPurpose() public view {
        // What a change can do is the five kinds; none of them touches these.
        assertEq(uint8(type(NivPayPotsV2.ChangeKind).max), 4);
        NivPayPots.PotView memory p = NivPayPots(address(pots)).getPot(potId);
        assertEq(p.threshold, 2);
        assertEq(p.approverCount, 3);
        assertEq(p.purpose, "Birthday");
    }
}
