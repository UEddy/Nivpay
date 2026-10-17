// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {NivPayPotsV2} from "../src/NivPayPotsV2.sol";
import {MockAUSD} from "./mocks/MockAUSD.sol";
import {PotsV2Handler} from "./handlers/PotsV2Handler.sol";

/// @notice What has to hold for NivPayPotsV2 after any sequence of calls, in
/// any order: changes proposed, agreed, applied, withdrawn and lapsed among
/// payments, exits, freezes and closes.
contract PotsChangesInvariantTest is Test {
    MockAUSD internal token;
    NivPayPotsV2 internal pots;
    PotsV2Handler internal handler;

    function setUp() public {
        vm.warp(1_760_000_000);
        token = new MockAUSD();
        pots = new NivPayPotsV2(IERC20(address(token)), 100, 50_000000, makeAddr("feeRecipient"), 72 hours, 7 days);
        handler = new PotsV2Handler(pots, token);

        targetContract(address(handler));
        // The change actions are listed twice, so they come up as often as
        // the money ones: a change needs a proposal, a yes and an apply.
        bytes4[] memory selectors = new bytes4[](21);
        selectors[0] = PotsV2Handler.fund.selector;
        selectors[1] = PotsV2Handler.fund.selector;
        selectors[2] = PotsV2Handler.exitSome.selector;
        selectors[3] = PotsV2Handler.claimAll.selector;
        selectors[4] = PotsV2Handler.pay.selector;
        selectors[5] = PotsV2Handler.pay.selector;
        selectors[6] = PotsV2Handler.freezeOrUnfreeze.selector;
        selectors[7] = PotsV2Handler.closeEarly.selector;
        selectors[8] = PotsV2Handler.warp.selector;
        selectors[9] = PotsV2Handler.propose.selector;
        selectors[10] = PotsV2Handler.propose.selector;
        selectors[11] = PotsV2Handler.approve.selector;
        selectors[12] = PotsV2Handler.approve.selector;
        selectors[13] = PotsV2Handler.apply_.selector;
        selectors[14] = PotsV2Handler.apply_.selector;
        selectors[15] = PotsV2Handler.withdraw.selector;
        selectors[16] = PotsV2Handler.lapse.selector;
        selectors[17] = PotsV2Handler.exitSome.selector;
        selectors[18] = PotsV2Handler.payLater.selector;
        selectors[19] = PotsV2Handler.revoke.selector;
        selectors[20] = PotsV2Handler.crossPot.selector;
        targetSelector(FuzzSelector({addr: address(handler), selectors: selectors}));
    }

    /// @notice No payment ever went to a payee, or above a limit, that had
    /// not applied at that moment, judged by the handler's own books.
    function invariant_paymentsOnlyUseWhatHadApplied() public view {
        assertEq(handler.paidToUnapplied(), 0, "a payment went to a payee not applied");
        assertEq(handler.paidAboveLimit(), 0, "a payment went above the limit in force");
    }

    /// @notice The contract's payees, limits, what each was paid and the
    /// closing dates are exactly the handler's books: nothing changed a pot
    /// except a change the handler saw apply.
    function invariant_potsAreExactlyWhatWasApplied() public view {
        for (uint256 p = 0; p < handler.POTS(); ++p) {
            uint256 potId = handler.potIds(p);
            NivPayPotsV2.Destination[] memory ds = pots.getDestinations(potId);
            assertEq(ds.length, handler.gPayees(potId), "payee count");
            for (uint256 i = 0; i < ds.length; ++i) {
                assertEq(ds[i].to, handler.gTo(potId, i), "payee");
                assertEq(ds[i].cap, handler.gCap(potId, i), "limit");
                assertEq(ds[i].spent, handler.gSpent(potId, i), "paid");
                assertEq(pots.isRemoved(potId, i), handler.gRemoved(potId, i), "removed");
                assertLe(ds[i].spent, ds[i].cap, "never above its limit");
            }
            assertEq(pots.getPot(potId).endTime, handler.gEnd(potId), "closing date");
        }
    }

    /// @notice No widening change applied before its 72 hours were up, or
    /// after it had lapsed.
    function invariant_noWideningBeforeItsWindow() public view {
        assertEq(handler.appliedEarly(), 0, "applied inside the exit window");
        assertEq(handler.appliedLate(), 0, "applied after it lapsed");
        assertEq(handler.appliedWhileFrozenOrClosed(), 0, "applied on a frozen or closed pot");
    }

    /// @notice Nobody who doesn't decide on a pot ever proposed a change on it
    /// or said yes to one, and a raise agreed before a payee was lowered or
    /// removed never applied after it.
    function invariant_onlyThePotsOwnDecidersAndNoUndoing() public view {
        assertEq(handler.crossPotAccepted(), 0, "a decider of another pot was heard");
        assertEq(handler.raiseUndidNarrowing(), 0, "a raise undid a later lowering");
    }

    /// @notice Every change's yes count is exactly the deciders who have said
    /// yes to it, however many were given and taken back.
    function invariant_yesCountsAreTheYeses() public view {
        uint256 n = pots.changeCount();
        for (uint256 id = 0; id < n; ++id) {
            NivPayPotsV2.ChangeView memory v = pots.changeInfo(id);
            address[] memory who = handler.decidersOf(v.potId);
            uint256 yes;
            for (uint256 i = 0; i < who.length; ++i) {
                if (pots.hasApprovedChange(id, who[i])) ++yes;
            }
            assertEq(v.approvals, yes, "approvals");
            assertEq(v.approvedBy.length, yes, "approvedBy");
        }
    }

    /// @notice Never more than two open changes from one decider on a pot.
    function invariant_atMostTwoFromOneDecider() public view {
        for (uint256 p = 0; p < handler.POTS(); ++p) {
            uint256 potId = handler.potIds(p);
            uint256[] memory open = pots.openChanges(potId);
            address[] memory who = handler.decidersOf(potId);
            for (uint256 i = 0; i < who.length; ++i) {
                uint256 mine;
                for (uint256 j = 0; j < open.length; ++j) {
                    if (pots.changeInfo(open[j]).proposer == who[i]) ++mine;
                }
                assertLe(mine, 2);
            }
        }
    }

    /// @notice A closed pot took no proposal and no yes for a change.
    function invariant_closedPotsTakeNoChange() public view {
        assertEq(handler.changedClosedPot(), 0);
    }

    /// @notice Every exit the handler tried worked, and right now every
    /// holder of every pot can take all of their part out, whatever is
    /// waiting to apply. Performed on a snapshot and rolled back.
    function invariant_exitsAlwaysWork() public {
        assertEq(handler.exitsRefused(), 0, "an exit or claim was refused");
        uint256 snap = vm.snapshotState();
        for (uint256 p = 0; p < handler.POTS(); ++p) {
            uint256 potId = handler.potIds(p);
            for (uint256 a = 0; a < handler.funderCount(); ++a) {
                address who = handler.funders(a);
                uint256 shares = pots.sharesOf(potId, who);
                if (shares == 0) continue;
                uint256 expected = pots.previewExit(potId, shares);
                uint256 before = token.balanceOf(who);
                vm.prank(who);
                assertEq(pots.exit(potId, shares), expected, "paid what it previewed");
                assertEq(token.balanceOf(who) - before, expected, "and it arrived");
            }
        }
        vm.revertToState(snap);
    }

    /// @notice Money in equals money paid out, plus fees, plus money taken
    /// out, plus what the pot holds; and the contract holds every pot's money
    /// plus the fees it has taken.
    function invariant_moneyAddsUp() public view {
        uint256 held;
        for (uint256 p = 0; p < handler.POTS(); ++p) {
            uint256 potId = handler.potIds(p);
            uint256 assets = pots.getPot(potId).totalAssets;
            assertEq(
                handler.gFunded(potId),
                handler.gPaid(potId) + handler.gFees(potId) + handler.gOut(potId) + assets,
                "in = paid + fees + out + held"
            );
            held += assets;
        }
        assertEq(token.balanceOf(address(pots)), held + pots.feesAccrued(), "the contract holds it all");
    }

    /// @notice Never more than five changes open on a pot.
    function invariant_atMostFiveOpen() public view {
        for (uint256 p = 0; p < handler.POTS(); ++p) {
            assertLe(pots.openChanges(handler.potIds(p)).length, 5);
        }
    }

    /// @notice The handler can reach what the invariants are about: a fixed
    /// walk through it funds, agrees and applies both kinds of change, and
    /// pays a payee it added. Random runs that only revert would prove nothing.
    function test_handlerReachesEveryRule() public {
        handler.fund(0, 0, 10_000_000000);
        // Decider 0 proposes adding a payee (kind 0) and decider 1 agrees it.
        handler.propose(0, 0, 0, 0, 5_000_000000);
        handler.approve(1, 0);
        handler.apply_(0, 0);
        assertEq(handler.applies(), 0, "not inside its window");
        handler.warp(3 days);
        handler.warp(1 hours);
        handler.apply_(0, 0);
        assertEq(handler.applies(), 1, "applied after its window");
        // Lowering payee 0 (kind 3) applies with its second yes.
        handler.propose(0, 0, 3, 0, 1_000_000000);
        handler.approve(1, 1);
        assertEq(handler.applies(), 2, "narrowing applied at once");
        // A payment to the payee just added, index 2.
        handler.pay(0, 2, 100_000000);
        assertEq(handler.payments(), 1);
        invariant_paymentsOnlyUseWhatHadApplied();
        invariant_potsAreExactlyWhatWasApplied();
        invariant_moneyAddsUp();
    }
}
