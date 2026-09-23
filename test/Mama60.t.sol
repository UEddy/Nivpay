// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {PotsTestBase} from "./PotsTestBase.sol";
import {NivPayPots} from "../src/NivPayPots.sol";

/// @notice The reference scenario, replayed exactly, with every balance
/// asserted to the unit.
///
/// Idara, Ubong and Aniekan are throwing their mother a sixtieth birthday
/// party. They are the approvers, 2 of 3. The money can only ever reach the
/// caterer or the event hall, each with its own spending cap, and nothing in
/// the contract can add a third destination later.
///
///   Idara puts in    500 AUSD
///   Ubong puts in    400 AUSD
///   Aniekan puts in  100 AUSD
///
///   Aniekan proposes paying the caterer 600. Ubong approves, and that
///   approval is the second of the two needed, so the caterer is paid in the
///   same transaction.
///
///   Later, the hall is paid 270 the same way.
///
///   The pot closes and each sibling claims their share of what is left.
///
/// At 1 percent the two payouts cost 6 and 2.7 in fees, so 878.7 of the 1000
/// leaves the pot and 121.3 remains. Split by contribution that is 60.65 to
/// Idara, 48.52 to Ubong and 12.13 to Aniekan, which happens to divide with no
/// dust at all.
contract Mama60Test is PotsTestBase {
    address internal idara = makeAddr("idara");
    address internal ubong = makeAddr("ubong");
    address internal aniekan = makeAddr("aniekan");

    address internal caterer = makeAddr("caterer");
    address internal hall = makeAddr("eventHall");

    uint256 internal potId;
    uint64 internal endTime;

    uint16 internal constant CATERER = 0;
    uint16 internal constant HALL = 1;

    function setUp() public override {
        super.setUp();
        endTime = uint64(block.timestamp + 30 days);

        potId = pots.createPot(
            "Mama's 60th",
            _three(idara, ubong, aniekan),
            2,
            _two(caterer, hall),
            _labels2("Caterer", "Event hall"),
            _caps2(700 * ONE, 300 * ONE),
            endTime
        );

        _fundAccount(idara, 500 * ONE);
        _fundAccount(ubong, 400 * ONE);
        _fundAccount(aniekan, 100 * ONE);
    }

    function test_mamas60th_endToEnd() public {
        // -----------------------------------------------------------------
        // The pot is exactly what was asked for, and nothing can change it.
        // -----------------------------------------------------------------
        NivPayPots.PotView memory p = pots.getPot(potId);
        assertEq(p.purpose, "Mama's 60th", "purpose");
        assertEq(p.threshold, 2, "threshold is 2 of 3");
        assertEq(p.approverCount, 3, "three approvers");
        assertEq(p.destinationCount, 2, "two destinations");
        assertEq(p.endTime, endTime, "end time");
        assertFalse(p.closed, "open at the start");
        assertFalse(p.frozen, "not frozen");

        // -----------------------------------------------------------------
        // The three siblings fund.
        // -----------------------------------------------------------------
        vm.prank(idara);
        pots.fund(potId, 500 * ONE);
        vm.prank(ubong);
        pots.fund(potId, 400 * ONE);
        vm.prank(aniekan);
        pots.fund(potId, 100 * ONE);

        assertEq(token.balanceOf(idara), 0, "idara paid in full");
        assertEq(token.balanceOf(ubong), 0, "ubong paid in full");
        assertEq(token.balanceOf(aniekan), 0, "aniekan paid in full");
        assertEq(token.balanceOf(address(pots)), 1000 * ONE, "contract holds 1000");
        assertEq(pots.getPot(potId).totalAssets, 1000 * ONE, "pot assets 1000");

        // Shares are proportional to what each of them put in, with no
        // advantage to funding first or last.
        assertEq(pots.sharesOf(potId, idara), 500_000000000, "idara shares");
        assertEq(pots.sharesOf(potId, ubong), 400_000000000, "ubong shares");
        assertEq(pots.sharesOf(potId, aniekan), 100_000000000, "aniekan shares");

        (, uint256 idaraValue) = pots.funderInfo(potId, idara);
        (, uint256 ubongValue) = pots.funderInfo(potId, ubong);
        (, uint256 aniekanValue) = pots.funderInfo(potId, aniekan);
        assertEq(idaraValue, 500 * ONE, "idara redeemable before spending");
        assertEq(ubongValue, 400 * ONE, "ubong redeemable before spending");
        assertEq(aniekanValue, 100 * ONE, "aniekan redeemable before spending");

        // -----------------------------------------------------------------
        // Aniekan proposes paying the caterer 600. That is one approval, one
        // short of the threshold, so nothing moves yet.
        // -----------------------------------------------------------------
        vm.prank(aniekan);
        uint256 catererProposal = pots.proposePayout(potId, CATERER, 600 * ONE);

        NivPayPots.ProposalView memory pv = pots.proposalInfo(catererProposal);
        assertEq(uint8(pv.status), uint8(NivPayPots.ProposalStatus.Pending), "pending on one approval");
        assertEq(pv.approvals, 1, "proposing is one approval");
        assertEq(pv.approvedBy.length, 1, "only aniekan so far");
        assertEq(pv.approvedBy[0], aniekan, "aniekan approved by proposing");
        assertEq(pv.destination, caterer, "destination is the caterer");
        assertEq(pv.amount, 600 * ONE, "amount 600");
        assertEq(pv.fee, 6 * ONE, "fee 6 at 1 percent");
        assertEq(token.balanceOf(caterer), 0, "caterer not paid on one approval");

        // Ubong approves. That is the second of two, so the caterer is paid in
        // this very transaction.
        vm.expectEmit(true, true, true, true, address(pots));
        emit NivPayPots.PayoutExecuted(catererProposal, potId, caterer, CATERER, 600 * ONE, 6 * ONE);
        vm.prank(ubong);
        pots.approve(catererProposal);

        assertEq(token.balanceOf(caterer), 600 * ONE, "caterer paid 600");
        assertEq(pots.feesAccrued(), 6 * ONE, "fee 6 accrued");
        assertEq(pots.getPot(potId).totalAssets, 394 * ONE, "1000 less 600 less 6");
        assertEq(
            uint8(pots.proposalInfo(catererProposal).status),
            uint8(NivPayPots.ProposalStatus.Executed),
            "caterer proposal executed"
        );

        (,, uint256 catererCap, uint256 catererSpent, uint256 catererLeft) = pots.getDestination(potId, CATERER);
        assertEq(catererCap, 700 * ONE, "caterer cap");
        assertEq(catererSpent, 600 * ONE, "caterer spent excludes the fee");
        assertEq(catererLeft, 100 * ONE, "caterer has 100 of cap left");

        // -----------------------------------------------------------------
        // Later, the hall is paid 270 the same way.
        // -----------------------------------------------------------------
        vm.warp(block.timestamp + 3 days);

        vm.prank(idara);
        uint256 hallProposal = pots.proposePayout(potId, HALL, 270 * ONE);
        assertEq(token.balanceOf(hall), 0, "hall not paid on one approval");

        vm.expectEmit(true, true, true, true, address(pots));
        emit NivPayPots.PayoutExecuted(hallProposal, potId, hall, HALL, 270 * ONE, 2_700000);
        vm.prank(aniekan);
        pots.approve(hallProposal);

        assertEq(token.balanceOf(hall), 270 * ONE, "hall paid 270");
        assertEq(pots.feesAccrued(), 8_700000, "fees now 6 plus 2.7");
        assertEq(pots.getPot(potId).totalAssets, 121_300000, "121.3 left in the pot");

        // Spending is borne in proportion. Nobody's stake was diluted by it.
        (, idaraValue) = pots.funderInfo(potId, idara);
        (, ubongValue) = pots.funderInfo(potId, ubong);
        (, aniekanValue) = pots.funderInfo(potId, aniekan);
        assertEq(idaraValue, 60_650000, "idara bears 50 percent of the spend");
        assertEq(ubongValue, 48_520000, "ubong bears 40 percent of the spend");
        assertEq(aniekanValue, 12_130000, "aniekan bears 10 percent of the spend");

        // -----------------------------------------------------------------
        // The pot reaches its end time and closes.
        // -----------------------------------------------------------------
        vm.warp(endTime);

        vm.expectEmit(true, true, true, true, address(pots));
        emit NivPayPots.Closed(potId, false, 121_300000);
        pots.closePot(potId);

        assertTrue(pots.getPot(potId).closed, "pot is closed");

        // -----------------------------------------------------------------
        // Each sibling claims what is left of their own contribution.
        // -----------------------------------------------------------------
        vm.prank(idara);
        uint256 idaraGot = pots.claim(potId);
        vm.prank(ubong);
        uint256 ubongGot = pots.claim(potId);
        vm.prank(aniekan);
        uint256 aniekanGot = pots.claim(potId);

        assertEq(idaraGot, 60_650000, "idara claims 60.65");
        assertEq(ubongGot, 48_520000, "ubong claims 48.52");
        assertEq(aniekanGot, 12_130000, "aniekan claims 12.13");

        assertEq(token.balanceOf(idara), 60_650000, "idara holds 60.65");
        assertEq(token.balanceOf(ubong), 48_520000, "ubong holds 48.52");
        assertEq(token.balanceOf(aniekan), 12_130000, "aniekan holds 12.13");

        assertEq(pots.sharesOf(potId, idara), 0, "idara has no shares left");
        assertEq(pots.sharesOf(potId, ubong), 0, "ubong has no shares left");
        assertEq(pots.sharesOf(potId, aniekan), 0, "aniekan has no shares left");

        // -----------------------------------------------------------------
        // The books close to the unit. Nothing is stranded and nothing is
        // conjured.
        // -----------------------------------------------------------------
        NivPayPots.PotView memory endState = pots.getPot(potId);
        assertEq(endState.totalAssets, 0, "no dust stranded in the pot");
        assertEq(endState.totalShares, 0, "every share burned");

        uint256 paidOut = 600 * ONE + 270 * ONE;
        uint256 fees = 8_700000;
        uint256 claimed = idaraGot + ubongGot + aniekanGot;
        assertEq(paidOut + fees + claimed, 1000 * ONE, "funded equals paid out plus fees plus claimed");

        // The contract is holding exactly the uncollected fees, nothing more.
        assertEq(token.balanceOf(address(pots)), fees, "contract holds only the accrued fees");

        vm.prank(feeRecipient);
        uint256 collected = pots.collectFees();
        assertEq(collected, fees, "fee recipient collects 8.7");
        assertEq(token.balanceOf(feeRecipient), fees, "fee recipient holds 8.7");
        assertEq(token.balanceOf(address(pots)), 0, "contract is empty");
    }

    /// @notice The same party, but Aniekan's mother changes her mind about the
    /// hall halfway through. Aniekan wants out. He can leave with his share of
    /// what is unspent without asking anyone, and the party carries on.
    function test_mamas60th_aniekanExitsMidway() public {
        vm.prank(idara);
        pots.fund(potId, 500 * ONE);
        vm.prank(ubong);
        pots.fund(potId, 400 * ONE);
        vm.prank(aniekan);
        pots.fund(potId, 100 * ONE);

        vm.prank(aniekan);
        uint256 catererProposal = pots.proposePayout(potId, CATERER, 600 * ONE);
        vm.prank(ubong);
        pots.approve(catererProposal);

        // 394 unspent, Aniekan holds 10 percent of the shares. Read the share
        // balance before pranking, since the view call would otherwise consume
        // the prank.
        uint256 aniekanShares = pots.sharesOf(potId, aniekan);
        vm.prank(aniekan);
        uint256 got = pots.exit(potId, aniekanShares);
        assertEq(got, 39_400000, "aniekan leaves with 10 percent of 394");
        assertEq(pots.sharesOf(potId, aniekan), 0, "aniekan is out");
        assertEq(pots.getPot(potId).totalAssets, 354_600000, "354.6 left for the other two");

        // The other two are untouched by his leaving.
        (, uint256 idaraValue) = pots.funderInfo(potId, idara);
        (, uint256 ubongValue) = pots.funderInfo(potId, ubong);
        assertEq(idaraValue, 197 * ONE, "idara still holds 50 percent of 394");
        assertEq(ubongValue, 157_600000, "ubong still holds 40 percent of 394");

        // And the party still pays the hall.
        vm.prank(idara);
        uint256 hallProposal = pots.proposePayout(potId, HALL, 270 * ONE);
        vm.prank(ubong);
        pots.approve(hallProposal);
        assertEq(token.balanceOf(hall), 270 * ONE, "hall still paid");
    }
}
