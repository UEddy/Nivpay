// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {PotsTestBase} from "./PotsTestBase.sol";
import {NivPayPots} from "../src/NivPayPots.sol";

/// @notice Proposals, payouts, caps, freezing, closing and fees: every success
/// path and every revert path each of them can take.
contract PotsGovernanceTest is PotsTestBase {
    address internal alice = makeAddr("alice");
    address internal bob = makeAddr("bob");
    address internal carol = makeAddr("carol");
    address internal stranger = makeAddr("stranger");

    address internal destA = makeAddr("destA");
    address internal destB = makeAddr("destB");

    uint64 internal endTime;
    uint256 internal potId;

    uint16 internal constant A = 0;
    uint16 internal constant B = 1;

    function setUp() public override {
        super.setUp();
        endTime = uint64(block.timestamp + 30 days);
        _fundAccount(alice, 1_000_000 * ONE);
        _fundAccount(bob, 1_000_000 * ONE);

        potId = pots.createPot(
            "Party",
            _three(alice, bob, carol),
            2,
            _two(destA, destB),
            _labels2("A", "B"),
            _caps2(500 * ONE, 100 * ONE),
            endTime
        );

        vm.prank(alice);
        pots.fund(potId, 1000 * ONE);
    }

    function _pay(uint16 destIndex, uint256 amount) internal returns (uint256 id) {
        vm.prank(alice);
        id = pots.proposePayout(potId, destIndex, amount);
        vm.prank(bob);
        pots.approve(id);
    }

    // ---------------------------------------------------------------------
    // proposePayout
    // ---------------------------------------------------------------------

    function test_propose_countsAsTheProposersApproval() public {
        vm.expectEmit(true, true, true, true, address(pots));
        emit NivPayPots.Proposed(
            0, potId, alice, NivPayPots.ProposalKind.Payout, A, 100 * ONE, uint64(block.timestamp + 7 days)
        );
        vm.expectEmit(true, true, true, true, address(pots));
        emit NivPayPots.Approved(0, potId, alice, 1);
        vm.prank(alice);
        uint256 id = pots.proposePayout(potId, A, 100 * ONE);

        assertTrue(pots.hasApproved(id, alice), "proposing approves");
        assertEq(pots.proposalInfo(id).approvals, 1, "one approval");
    }

    function test_propose_executesImmediatelyAtThresholdOfOne() public {
        uint256 soloPot = pots.createPot(
            "Solo", _one(alice), 1, _one(destA), _labels1("A"), _caps1(500 * ONE), endTime
        );
        vm.prank(alice);
        pots.fund(soloPot, 200 * ONE);

        vm.prank(alice);
        pots.proposePayout(soloPot, A, 100 * ONE);
        assertEq(token.balanceOf(destA), 100 * ONE, "1 of 1 pays out on the proposal itself");
    }

    function test_propose_revertsForNonApprover() public {
        vm.prank(stranger);
        vm.expectRevert(NivPayPots.NotApprover.selector);
        pots.proposePayout(potId, A, ONE);
    }

    function test_propose_revertsOnUnknownPot() public {
        vm.prank(alice);
        vm.expectRevert(NivPayPots.NoSuchPot.selector);
        pots.proposePayout(potId + 1, A, ONE);
    }

    function test_propose_revertsOnUnknownDestination() public {
        vm.prank(alice);
        vm.expectRevert(NivPayPots.NoSuchDestination.selector);
        pots.proposePayout(potId, 2, ONE);
    }

    function test_propose_revertsOnZeroAmount() public {
        vm.prank(alice);
        vm.expectRevert(NivPayPots.ZeroAmount.selector);
        pots.proposePayout(potId, A, 0);
    }

    function test_propose_revertsWhenClosed() public {
        vm.warp(endTime);
        vm.prank(alice);
        vm.expectRevert(NivPayPots.PotClosed.selector);
        pots.proposePayout(potId, A, ONE);
    }

    function test_propose_revertsWhenFrozen() public {
        vm.prank(carol);
        pots.freeze(potId);
        vm.prank(alice);
        vm.expectRevert(NivPayPots.PotFrozen.selector);
        pots.proposePayout(potId, A, ONE);
    }

    // ---------------------------------------------------------------------
    // approve and execution
    // ---------------------------------------------------------------------

    function test_approve_executesAtThresholdAndChargesTheFee() public {
        uint256 id = _pay(A, 100 * ONE);

        assertEq(token.balanceOf(destA), 100 * ONE, "destination paid the amount, not the amount less fee");
        assertEq(pots.feesAccrued(), ONE, "one percent accrued");
        assertEq(pots.getPot(potId).totalAssets, 1000 * ONE - 101 * ONE, "pot pays amount plus fee");
        assertEq(
            uint8(pots.proposalInfo(id).status), uint8(NivPayPots.ProposalStatus.Executed), "executed"
        );
    }

    function test_approve_doesNotBurnShares() public {
        uint256 sharesBefore = pots.sharesOf(potId, alice);
        _pay(A, 100 * ONE);
        assertEq(pots.sharesOf(potId, alice), sharesBefore, "spending never burns anybody's shares");
        (, uint256 value) = pots.funderInfo(potId, alice);
        assertEq(value, 899 * ONE, "the sole funder bears the whole spend");
    }

    function test_approve_revertsForNonApprover() public {
        vm.prank(alice);
        uint256 id = pots.proposePayout(potId, A, ONE);
        vm.prank(stranger);
        vm.expectRevert(NivPayPots.NotApprover.selector);
        pots.approve(id);
    }

    function test_approve_revertsOnUnknownProposal() public {
        vm.prank(alice);
        vm.expectRevert(NivPayPots.NoSuchProposal.selector);
        pots.approve(0);
    }

    function test_approve_revertsWhenAlreadyApproved() public {
        vm.prank(alice);
        uint256 id = pots.proposePayout(potId, A, ONE);
        vm.prank(alice);
        vm.expectRevert(NivPayPots.AlreadyApproved.selector);
        pots.approve(id);
    }

    function test_approve_revertsOnAnExecutedProposal() public {
        uint256 id = _pay(A, 100 * ONE);
        vm.prank(carol);
        vm.expectRevert(NivPayPots.ProposalNotPending.selector);
        pots.approve(id);
    }

    function test_approve_revertsOnACancelledProposal() public {
        vm.prank(alice);
        uint256 id = pots.proposePayout(potId, A, ONE);
        vm.prank(alice);
        pots.cancelProposal(id);

        vm.prank(bob);
        vm.expectRevert(NivPayPots.ProposalNotPending.selector);
        pots.approve(id);
    }

    function test_approve_revertsAfterSevenDays() public {
        vm.prank(alice);
        uint256 id = pots.proposePayout(potId, A, ONE);

        vm.warp(block.timestamp + 7 days + 1);
        assertEq(
            uint8(pots.proposalInfo(id).status), uint8(NivPayPots.ProposalStatus.Expired), "expired after 7 days"
        );
        vm.prank(bob);
        vm.expectRevert(NivPayPots.ProposalExpired.selector);
        pots.approve(id);
    }

    function test_approve_stillWorksAtExactlySevenDays() public {
        vm.prank(alice);
        uint256 id = pots.proposePayout(potId, A, ONE);
        vm.warp(block.timestamp + 7 days);
        vm.prank(bob);
        pots.approve(id);
        assertEq(token.balanceOf(destA), ONE, "the seventh day is still inside the window");
    }

    function test_approve_revertsOnAPayoutWhileFrozen() public {
        vm.prank(alice);
        uint256 id = pots.proposePayout(potId, A, ONE);
        vm.prank(carol);
        pots.freeze(potId);

        vm.prank(bob);
        vm.expectRevert(NivPayPots.PotFrozen.selector);
        pots.approve(id);
        assertEq(
            uint8(pots.proposalInfo(id).status), uint8(NivPayPots.ProposalStatus.Pending), "still pending"
        );
    }

    /// @dev The pot has to end inside the seven day proposal window, otherwise
    /// the proposal expires first and that is the revert that fires.
    function test_approve_revertsWhenThePotClosesUnderAPendingProposal() public {
        uint64 shortEnd = uint64(block.timestamp + 3 days);
        uint256 shortPot = pots.createPot(
            "Short", _two(alice, bob), 2, _one(destA), _labels1("A"), _caps1(500 * ONE), shortEnd
        );
        vm.prank(alice);
        pots.fund(shortPot, 100 * ONE);
        vm.prank(alice);
        uint256 id = pots.proposePayout(shortPot, A, ONE);

        vm.warp(shortEnd);
        assertEq(
            uint8(pots.proposalInfo(id).status), uint8(NivPayPots.ProposalStatus.Pending), "not yet expired"
        );

        vm.prank(bob);
        vm.expectRevert(NivPayPots.PotClosed.selector);
        pots.approve(id);
    }

    // ---------------------------------------------------------------------
    // Caps and solvency
    // ---------------------------------------------------------------------

    function test_payout_revertsAboveTheDestinationCap() public {
        vm.prank(alice);
        uint256 id = pots.proposePayout(potId, B, 101 * ONE);
        vm.prank(bob);
        vm.expectRevert(NivPayPots.CapExceeded.selector);
        pots.approve(id);
    }

    function test_payout_capIsLifetimeNotPerPayout() public {
        _pay(B, 60 * ONE);
        vm.prank(alice);
        uint256 id = pots.proposePayout(potId, B, 41 * ONE);
        vm.prank(bob);
        vm.expectRevert(NivPayPots.CapExceeded.selector);
        pots.approve(id);

        // 40 exactly fills the remaining cap.
        _pay(B, 40 * ONE);
        (,,, uint256 spent, uint256 remaining) = pots.getDestination(potId, B);
        assertEq(spent, 100 * ONE, "cap fully used");
        assertEq(remaining, 0, "nothing left");
    }

    function test_payout_capIgnoresTheFee() public {
        // The cap on B is 100. Paying exactly 100 costs the pot 101 including
        // the fee, and must still be allowed, because the cap governs the
        // amount only.
        _pay(B, 100 * ONE);
        assertEq(token.balanceOf(destB), 100 * ONE, "paid the full cap");
        assertEq(pots.feesAccrued(), ONE, "fee charged on top of the cap");
    }

    function test_payout_revertsWhenThePotCannotCoverAmountPlusFee() public {
        // The pot holds 1000. A payout of 500 to A costs 505 and is fine. A
        // second payout of 500 would cost another 505 and there is only 495
        // left, so the approving transaction reverts and the proposal survives.
        _pay(A, 500 * ONE);
        assertEq(pots.getPot(potId).totalAssets, 495 * ONE, "495 left");

        uint256 bigPot = pots.createPot(
            "Big", _two(alice, bob), 2, _one(destA), _labels1("A"), _caps1(100_000 * ONE), endTime
        );
        vm.prank(alice);
        pots.fund(bigPot, 100 * ONE);

        vm.prank(alice);
        uint256 id = pots.proposePayout(bigPot, A, 100 * ONE);
        vm.prank(bob);
        vm.expectRevert(NivPayPots.InsufficientPotAssets.selector);
        pots.approve(id);

        // The proposal is untouched, and it goes through once the pot is topped
        // up enough to cover the fee as well.
        assertEq(
            uint8(pots.proposalInfo(id).status), uint8(NivPayPots.ProposalStatus.Pending), "proposal survives"
        );
        assertFalse(pots.hasApproved(id, bob), "the failed approval was not recorded");

        vm.prank(bob);
        pots.fund(bigPot, ONE);
        vm.prank(bob);
        pots.approve(id);
        assertEq(token.balanceOf(destA), 600 * ONE, "paid once solvent");
    }

    function test_payout_feeCapAppliesPerPayout() public {
        // FEE_CAP is 50. One percent of 10000 would be 100, so the fee clips.
        uint256 richPot = pots.createPot(
            "Rich", _two(alice, bob), 2, _one(destA), _labels1("A"), _caps1(100_000 * ONE), endTime
        );
        vm.prank(alice);
        pots.fund(richPot, 20_000 * ONE);

        vm.prank(alice);
        uint256 id = pots.proposePayout(richPot, A, 10_000 * ONE);
        vm.prank(bob);
        pots.approve(id);

        assertEq(pots.feesAccrued(), FEE_CAP, "fee clipped at the per payout cap");
        assertEq(pots.getPot(richPot).totalAssets, 20_000 * ONE - 10_000 * ONE - FEE_CAP, "pot charged the capped fee");
    }

    // ---------------------------------------------------------------------
    // revokeApproval and cancelProposal
    // ---------------------------------------------------------------------

    function test_revoke_reducesApprovalsAndBlocksExecution() public {
        vm.prank(alice);
        uint256 id = pots.proposePayout(potId, A, 100 * ONE);

        vm.expectEmit(true, true, true, true, address(pots));
        emit NivPayPots.ApprovalRevoked(id, potId, alice, 0);
        vm.prank(alice);
        pots.revokeApproval(id);

        assertEq(pots.proposalInfo(id).approvals, 0, "back to zero");
        assertFalse(pots.hasApproved(id, alice), "no longer approved");

        // One approval is now not enough, so bob approving does not pay out.
        vm.prank(bob);
        pots.approve(id);
        assertEq(token.balanceOf(destA), 0, "one approval is short of the threshold");
        assertEq(pots.proposalInfo(id).approvals, 1, "one approval");

        // And it pays out when a second approver signs.
        vm.prank(carol);
        pots.approve(id);
        assertEq(token.balanceOf(destA), 100 * ONE, "paid at the threshold");
    }

    function test_revoke_thenReapprove() public {
        vm.prank(alice);
        uint256 id = pots.proposePayout(potId, A, 100 * ONE);
        vm.prank(alice);
        pots.revokeApproval(id);
        vm.prank(alice);
        pots.approve(id);
        assertEq(pots.proposalInfo(id).approvals, 1, "approving again is allowed after a revoke");
    }

    function test_revoke_revertsWhenNotApproved() public {
        vm.prank(alice);
        uint256 id = pots.proposePayout(potId, A, ONE);
        vm.prank(bob);
        vm.expectRevert(NivPayPots.NotApproved.selector);
        pots.revokeApproval(id);
    }

    function test_revoke_revertsOnUnknownProposal() public {
        vm.expectRevert(NivPayPots.NoSuchProposal.selector);
        pots.revokeApproval(0);
    }

    function test_revoke_revertsAfterExecution() public {
        uint256 id = _pay(A, 100 * ONE);
        vm.prank(alice);
        vm.expectRevert(NivPayPots.ProposalNotPending.selector);
        pots.revokeApproval(id);
    }

    function test_cancel_byProposerOnly() public {
        vm.prank(alice);
        uint256 id = pots.proposePayout(potId, A, ONE);

        vm.prank(bob);
        vm.expectRevert(NivPayPots.NotProposer.selector);
        pots.cancelProposal(id);

        vm.expectEmit(true, true, true, true, address(pots));
        emit NivPayPots.ProposalCancelled(id, potId, alice);
        vm.prank(alice);
        pots.cancelProposal(id);
        assertEq(
            uint8(pots.proposalInfo(id).status), uint8(NivPayPots.ProposalStatus.Cancelled), "cancelled"
        );
    }

    function test_cancel_revertsOnUnknownProposal() public {
        vm.expectRevert(NivPayPots.NoSuchProposal.selector);
        pots.cancelProposal(0);
    }

    function test_cancel_revertsTwice() public {
        vm.prank(alice);
        uint256 id = pots.proposePayout(potId, A, ONE);
        vm.prank(alice);
        pots.cancelProposal(id);
        vm.prank(alice);
        vm.expectRevert(NivPayPots.ProposalNotPending.selector);
        pots.cancelProposal(id);
    }

    function test_cancel_revertsAfterExecution() public {
        uint256 id = _pay(A, 100 * ONE);
        vm.prank(alice);
        vm.expectRevert(NivPayPots.ProposalNotPending.selector);
        pots.cancelProposal(id);
    }

    // ---------------------------------------------------------------------
    // freeze and unfreeze
    // ---------------------------------------------------------------------

    function test_freeze_bySingleApprover() public {
        vm.expectEmit(true, true, true, true, address(pots));
        emit NivPayPots.Frozen(potId, carol);
        vm.prank(carol);
        pots.freeze(potId);
        assertTrue(pots.getPot(potId).frozen, "one approver is enough to freeze");
    }

    function test_freeze_revertsForNonApprover() public {
        vm.prank(stranger);
        vm.expectRevert(NivPayPots.NotApprover.selector);
        pots.freeze(potId);
    }

    function test_freeze_revertsWhenAlreadyFrozen() public {
        vm.prank(alice);
        pots.freeze(potId);
        vm.prank(bob);
        vm.expectRevert(NivPayPots.PotFrozen.selector);
        pots.freeze(potId);
    }

    function test_freeze_revertsOnUnknownPot() public {
        vm.prank(alice);
        vm.expectRevert(NivPayPots.NoSuchPot.selector);
        pots.freeze(potId + 1);
    }

    function test_unfreeze_needsTheFullThreshold() public {
        vm.prank(carol);
        pots.freeze(potId);

        vm.prank(alice);
        uint256 id = pots.proposeUnfreeze(potId);
        assertTrue(pots.getPot(potId).frozen, "one approval is not enough");

        vm.expectEmit(true, true, true, true, address(pots));
        emit NivPayPots.Unfrozen(potId, id);
        vm.prank(bob);
        pots.approve(id);
        assertFalse(pots.getPot(potId).frozen, "unfrozen at the threshold");

        // And payouts work again.
        _pay(A, 100 * ONE);
        assertEq(token.balanceOf(destA), 100 * ONE, "payouts resume");
    }

    function test_unfreeze_revertsWhenNotFrozen() public {
        vm.prank(alice);
        vm.expectRevert(NivPayPots.PotNotFrozen.selector);
        pots.proposeUnfreeze(potId);
    }

    function test_unfreeze_revertsForNonApprover() public {
        vm.prank(carol);
        pots.freeze(potId);
        vm.prank(stranger);
        vm.expectRevert(NivPayPots.NotApprover.selector);
        pots.proposeUnfreeze(potId);
    }

    function test_unfreeze_revertsOnUnknownPot() public {
        vm.prank(alice);
        vm.expectRevert(NivPayPots.NoSuchPot.selector);
        pots.proposeUnfreeze(potId + 1);
    }

    function test_unfreeze_revertsIfAlreadyUnfrozenWhenTheThresholdLands() public {
        vm.prank(carol);
        pots.freeze(potId);
        vm.prank(alice);
        uint256 first = pots.proposeUnfreeze(potId);
        vm.prank(carol);
        uint256 second = pots.proposeUnfreeze(potId);

        vm.prank(bob);
        pots.approve(first);
        assertFalse(pots.getPot(potId).frozen, "unfrozen by the first proposal");

        vm.prank(alice);
        vm.expectRevert(NivPayPots.PotNotFrozen.selector);
        pots.approve(second);
    }

    // ---------------------------------------------------------------------
    // close
    // ---------------------------------------------------------------------

    function test_close_byProposal() public {
        vm.prank(alice);
        uint256 id = pots.proposeClose(potId);
        assertFalse(pots.getPot(potId).closed, "one approval is not enough");

        vm.expectEmit(true, true, true, true, address(pots));
        emit NivPayPots.Closed(potId, true, 1000 * ONE);
        vm.prank(bob);
        pots.approve(id);
        assertTrue(pots.getPot(potId).closed, "closed early by proposal");
    }

    function test_close_stopsPayoutsAndFunding() public {
        vm.prank(alice);
        uint256 id = pots.proposeClose(potId);
        vm.prank(bob);
        pots.approve(id);

        vm.prank(alice);
        vm.expectRevert(NivPayPots.PotClosed.selector);
        pots.proposePayout(potId, A, ONE);

        vm.prank(alice);
        vm.expectRevert(NivPayPots.PotClosed.selector);
        pots.fund(potId, ONE);
    }

    function test_close_revertsForNonApprover() public {
        vm.prank(stranger);
        vm.expectRevert(NivPayPots.NotApprover.selector);
        pots.proposeClose(potId);
    }

    function test_close_proposalRevertsWhenAlreadyClosed() public {
        vm.warp(endTime);
        vm.prank(alice);
        vm.expectRevert(NivPayPots.PotClosed.selector);
        pots.proposeClose(potId);
    }

    function test_close_proposalRevertsOnUnknownPot() public {
        vm.prank(alice);
        vm.expectRevert(NivPayPots.NoSuchPot.selector);
        pots.proposeClose(potId + 1);
    }

    function test_close_secondCloseProposalRevertsAtTheThreshold() public {
        vm.prank(alice);
        uint256 first = pots.proposeClose(potId);
        vm.prank(carol);
        uint256 second = pots.proposeClose(potId);

        vm.prank(bob);
        pots.approve(first);

        vm.prank(alice);
        vm.expectRevert(NivPayPots.PotClosed.selector);
        pots.approve(second);
    }

    function test_closePot_isPermissionlessAfterTheEndTime() public {
        vm.warp(endTime);
        vm.expectEmit(true, true, true, true, address(pots));
        emit NivPayPots.Closed(potId, false, 1000 * ONE);
        vm.prank(stranger);
        pots.closePot(potId);
        assertTrue(pots.getPot(potId).closed, "anyone can record the close");
    }

    function test_closePot_revertsBeforeTheEndTime() public {
        vm.expectRevert(NivPayPots.PotNotClosed.selector);
        pots.closePot(potId);
    }

    function test_closePot_revertsTwice() public {
        vm.warp(endTime);
        pots.closePot(potId);
        vm.expectRevert(NivPayPots.PotClosed.selector);
        pots.closePot(potId);
    }

    function test_closePot_revertsOnUnknownPot() public {
        vm.expectRevert(NivPayPots.NoSuchPot.selector);
        pots.closePot(potId + 1);
    }

    function test_close_potPastEndTimeBehavesClosedWithoutTheCall() public {
        vm.warp(endTime);
        assertTrue(pots.getPot(potId).closed, "closed by time alone");
        vm.prank(alice);
        pots.claim(potId);
    }

    // ---------------------------------------------------------------------
    // Fees
    // ---------------------------------------------------------------------

    function test_collectFees_onlyByTheFeeRecipient() public {
        _pay(A, 100 * ONE);

        vm.prank(stranger);
        vm.expectRevert(NivPayPots.NotFeeRecipient.selector);
        pots.collectFees();

        vm.expectEmit(true, true, true, true, address(pots));
        emit NivPayPots.FeesCollected(feeRecipient, ONE);
        vm.prank(feeRecipient);
        assertEq(pots.collectFees(), ONE, "collects the accrued fee");
        assertEq(token.balanceOf(feeRecipient), ONE, "fee recipient holds it");
        assertEq(pots.feesAccrued(), 0, "counter cleared");
    }

    function test_collectFees_revertsWithNothingAccrued() public {
        vm.prank(feeRecipient);
        vm.expectRevert(NivPayPots.NothingToCollect.selector);
        pots.collectFees();
    }

    function test_collectFees_accumulatesAcrossPots() public {
        _pay(A, 100 * ONE);

        uint256 other = pots.createPot(
            "Other", _two(alice, bob), 2, _one(destB), _labels1("B"), _caps1(500 * ONE), endTime
        );
        vm.prank(alice);
        pots.fund(other, 500 * ONE);
        vm.prank(alice);
        uint256 id = pots.proposePayout(other, A, 200 * ONE);
        vm.prank(bob);
        pots.approve(id);

        assertEq(pots.feesAccrued(), ONE + 2 * ONE, "fees from both pots");
        vm.prank(feeRecipient);
        assertEq(pots.collectFees(), 3 * ONE, "collected together");
    }

    function test_noFee_onFundingExitClaimOrClose() public {
        uint256 before = pots.feesAccrued();
        vm.prank(bob);
        pots.fund(potId, 100 * ONE);
        assertEq(pots.feesAccrued(), before, "no fee on funding");

        uint256 shares = pots.sharesOf(potId, bob);
        vm.prank(bob);
        pots.exit(potId, shares);
        assertEq(pots.feesAccrued(), before, "no fee on exit");

        vm.prank(alice);
        uint256 id = pots.proposeClose(potId);
        vm.prank(bob);
        pots.approve(id);
        assertEq(pots.feesAccrued(), before, "no fee on close");

        vm.prank(alice);
        pots.claim(potId);
        assertEq(pots.feesAccrued(), before, "no fee on claim");
    }

    function test_zeroFeeDeployment_chargesNothing() public {
        NivPayPots free = new NivPayPots(IERC20(address(token)), 0, 0, feeRecipient);
        vm.prank(alice);
        token.approve(address(free), type(uint256).max);

        uint256 id = free.createPot(
            "Free", _two(alice, bob), 2, _one(destA), _labels1("A"), _caps1(500 * ONE), endTime
        );
        vm.prank(alice);
        free.fund(id, 100 * ONE);
        vm.prank(alice);
        uint256 p = free.proposePayout(id, A, 100 * ONE);
        vm.prank(bob);
        free.approve(p);

        assertEq(free.feesAccrued(), 0, "no fee accrued");
        assertEq(free.getPot(id).totalAssets, 0, "the whole pot reached the destination");
    }

    // ---------------------------------------------------------------------
    // proposalInfo
    // ---------------------------------------------------------------------

    function test_proposalInfo_listsApprovers() public {
        vm.prank(alice);
        uint256 id = pots.proposePayout(potId, A, 100 * ONE);
        vm.prank(alice);
        pots.revokeApproval(id);
        vm.prank(carol);
        pots.approve(id);

        NivPayPots.ProposalView memory v = pots.proposalInfo(id);
        assertEq(v.potId, potId, "pot id");
        assertEq(uint8(v.kind), uint8(NivPayPots.ProposalKind.Payout), "kind");
        assertEq(v.destination, destA, "destination resolved");
        assertEq(v.amount, 100 * ONE, "amount");
        assertEq(v.fee, ONE, "fee previewed");
        assertEq(v.proposer, alice, "proposer even after revoking");
        assertEq(v.threshold, 2, "threshold");
        assertEq(v.approvals, 1, "one approval");
        assertEq(v.approvedBy.length, 1, "one approver listed");
        assertEq(v.approvedBy[0], carol, "carol is the one who approved");
    }

    function test_proposalInfo_forNonPayoutKinds() public {
        vm.prank(alice);
        uint256 id = pots.proposeClose(potId);
        NivPayPots.ProposalView memory v = pots.proposalInfo(id);
        assertEq(uint8(v.kind), uint8(NivPayPots.ProposalKind.Close), "close kind");
        assertEq(v.destination, address(0), "no destination on a close");
        assertEq(v.fee, 0, "no fee on a close");
        assertEq(v.expiresAt, v.createdAt + 7 days, "same seven day window");
    }
}
