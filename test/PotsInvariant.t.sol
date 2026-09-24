// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {NivPayPots} from "../src/NivPayPots.sol";
import {MockAUSD} from "./mocks/MockAUSD.sol";
import {PotsHandler} from "./handlers/PotsHandler.sol";

/// @notice The properties that have to hold after any sequence of legal calls,
/// whatever order they arrive in.
contract PotsInvariantTest is Test {
    MockAUSD internal token;
    NivPayPots internal pots;
    PotsHandler internal handler;

    address internal feeRecipient = makeAddr("feeRecipient");

    function setUp() public {
        token = new MockAUSD();
        pots = new NivPayPots(IERC20(address(token)), 100, 50_000000, feeRecipient);
        handler = new PotsHandler(pots, token);

        targetContract(address(handler));

        bytes4[] memory selectors = new bytes4[](13);
        selectors[0] = PotsHandler.fund.selector;
        selectors[1] = PotsHandler.exitSome.selector;
        selectors[2] = PotsHandler.claimAll.selector;
        selectors[3] = PotsHandler.proposePayout.selector;
        selectors[4] = PotsHandler.proposeClose.selector;
        selectors[5] = PotsHandler.proposeUnfreeze.selector;
        selectors[6] = PotsHandler.approveProposal.selector;
        selectors[7] = PotsHandler.revoke.selector;
        selectors[8] = PotsHandler.cancel.selector;
        selectors[9] = PotsHandler.freezePot.selector;
        selectors[10] = PotsHandler.collectFees.selector;
        selectors[11] = PotsHandler.warp.selector;
        selectors[12] = PotsHandler.executePayoutCycle.selector;
        targetSelector(FuzzSelector({addr: address(handler), selectors: selectors}));
    }

    /// @notice The contract is never short of what it owes: its token balance
    /// covers every pot's assets plus the fees it has taken but not paid out.
    function invariant_contractCoversAllPotAssetsPlusFees() public view {
        uint256 owed = pots.feesAccrued();
        for (uint256 i = 0; i < handler.potCount(); ++i) {
            owed += pots.getPot(handler.potIds(i)).totalAssets;
        }
        assertGe(token.balanceOf(address(pots)), owed, "contract is solvent");
        assertEq(token.balanceOf(address(pots)), owed, "and holds nothing beyond what it owes");
    }

    /// @notice Per pot, every unit that went in is accounted for: it was paid
    /// to a destination, taken as a fee, exited, claimed, or is still there.
    function invariant_everyPotBalances() public view {
        for (uint256 i = 0; i < handler.potCount(); ++i) {
            uint256 potId = handler.potIds(i);
            uint256 out = handler.gPaidOut(potId) + handler.gFees(potId) + handler.gExited(potId)
                + handler.gClaimed(potId) + pots.getPot(potId).totalAssets;
            assertEq(handler.gFunded(potId), out, "funded equals paid out plus fees plus exited plus claimed plus rest");
        }
    }

    /// @notice Money only ever reached addresses that were on a pot's
    /// destination list when it was created, in the amounts we counted.
    function invariant_onlyListedDestinationsAreEverPaid() public view {
        uint256 totalToDestinations;
        for (uint256 i = 0; i < handler.destinationCount(); ++i) {
            address dest = handler.allDestinations(i);
            assertEq(token.balanceOf(dest), handler.gDestReceived(dest), "destination holds exactly what it was paid");
            totalToDestinations += handler.gDestReceived(dest);
        }

        uint256 totalPaidOut;
        for (uint256 i = 0; i < handler.potCount(); ++i) {
            totalPaidOut += handler.gPaidOut(handler.potIds(i));
        }
        assertEq(totalToDestinations, totalPaidOut, "every unit paid out landed on a listed destination");
    }

    /// @notice Each destination that was paid was listed on the pot that paid
    /// it, and no pot ever paid another pot's destination.
    function invariant_destinationsBelongToTheirOwnPot() public view {
        for (uint256 i = 0; i < handler.executedPayoutCount(); ++i) {
            NivPayPots.ProposalView memory v = pots.proposalInfo(handler.executedPayouts(i));
            NivPayPots.Destination[] memory ds = pots.getDestinations(v.potId);
            bool found;
            for (uint256 d = 0; d < ds.length; ++d) {
                if (ds[d].to == v.destination) found = true;
            }
            assertTrue(found, "the paid address was listed on the pot that paid it");
        }
    }

    /// @notice No payout ever executed on fewer approvals than the threshold.
    function invariant_noPayoutWithoutThresholdApprovals() public view {
        for (uint256 i = 0; i < handler.executedPayoutCount(); ++i) {
            NivPayPots.ProposalView memory v = pots.proposalInfo(handler.executedPayouts(i));
            assertGe(v.approvals, v.threshold, "executed only at or above the threshold");
            assertGe(v.threshold, 1, "the threshold is never zero");
        }
    }

    /// @notice A destination's lifetime spend never exceeds the cap it was
    /// created with.
    function invariant_destinationCapsAreNeverExceeded() public view {
        for (uint256 i = 0; i < handler.potCount(); ++i) {
            uint256 potId = handler.potIds(i);
            NivPayPots.Destination[] memory ds = pots.getDestinations(potId);
            for (uint256 d = 0; d < ds.length; ++d) {
                assertLe(ds[d].spent, ds[d].cap, "spend is within the cap");
            }
        }
    }

    /// @notice Nobody's stake is damaged by somebody else funding or exiting,
    /// beyond the single unit that rounding can move.
    function invariant_nobodyIsDilutedByAnotherFunder() public view {
        assertLe(handler.worstCollateralLoss(), 1, "at most one unit of rounding, ever");
    }

    /// @notice Whatever state a pot is in, every holder can get their money
    /// out. This actually performs the exit on a snapshot and rolls it back,
    /// rather than reasoning about whether it would have worked.
    function invariant_exitsAlwaysSucceedForHolders() public {
        uint256 snap = vm.snapshotState();
        for (uint256 i = 0; i < handler.potCount(); ++i) {
            uint256 potId = handler.potIds(i);
            for (uint256 a = 0; a < handler.actorCount(); ++a) {
                address who = handler.actors(a);
                uint256 shares = pots.sharesOf(potId, who);
                if (shares == 0) continue;

                uint256 expected = pots.previewExit(potId, shares);
                uint256 balanceBefore = token.balanceOf(who);
                vm.prank(who);
                uint256 got = pots.exit(potId, shares);
                assertEq(got, expected, "the exit paid exactly what it previewed");
                assertEq(token.balanceOf(who) - balanceBefore, got, "and the tokens actually arrived");
            }
        }
        vm.revertToState(snap);
    }

    /// @notice Freezing halts payouts and funding, never exits, and a frozen
    /// pot still lets every holder out.
    function invariant_freezeNeverTrapsFunds() public {
        uint256 snap = vm.snapshotState();
        for (uint256 i = 0; i < handler.potCount(); ++i) {
            uint256 potId = handler.potIds(i);
            if (!pots.getPot(potId).frozen) continue;
            for (uint256 a = 0; a < handler.actorCount(); ++a) {
                address who = handler.actors(a);
                uint256 shares = pots.sharesOf(potId, who);
                if (shares == 0) continue;
                vm.prank(who);
                pots.exit(potId, shares);
            }
        }
        vm.revertToState(snap);
    }

    /// @notice The share supply and the per funder balances never drift apart.
    function invariant_sharesAddUp() public view {
        for (uint256 i = 0; i < handler.potCount(); ++i) {
            uint256 potId = handler.potIds(i);
            uint256 sum;
            for (uint256 a = 0; a < handler.actorCount(); ++a) {
                sum += pots.sharesOf(potId, handler.actors(a));
            }
            assertEq(sum, pots.getPot(potId).totalShares, "the share supply is exactly what the funders hold");
        }
    }

    /// @notice What every funder can redeem never adds up to more than the pot
    /// actually has.
    function invariant_potAlwaysCoversWhatItOwesItsFunders() public view {
        for (uint256 i = 0; i < handler.potCount(); ++i) {
            uint256 potId = handler.potIds(i);
            uint256 owed;
            for (uint256 a = 0; a < handler.actorCount(); ++a) {
                (, uint256 value) = pots.funderInfo(potId, handler.actors(a));
                owed += value;
            }
            assertLe(owed, pots.getPot(potId).totalAssets, "the pot covers every claim on it");
        }
    }

    /// @notice Creation parameters are immutable. Nothing in any sequence of
    /// calls can change an approver set, a threshold, a destination or an end
    /// time.
    function invariant_creationParametersNeverChange() public view {
        for (uint256 i = 0; i < handler.potCount(); ++i) {
            uint256 potId = handler.potIds(i);
            NivPayPots.PotView memory p = pots.getPot(potId);
            assertEq(p.purpose, "Handler", "purpose is fixed");
            assertEq(p.threshold, 2, "threshold is fixed");
            assertEq(p.approverCount, 3, "approver count is fixed");
            assertEq(p.destinationCount, 2, "destination count is fixed");
            assertEq(p.endTime, handler.endTime(), "end time is fixed");

            NivPayPots.Destination[] memory ds = pots.getDestinations(potId);
            assertEq(ds[0].cap, 500_000000, "the first cap is fixed");
            assertEq(ds[1].cap, 5_000_000000, "the second cap is fixed");
        }
    }
}
