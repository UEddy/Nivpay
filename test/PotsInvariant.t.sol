// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test, console} from "forge-std/Test.sol";
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

        bytes4[] memory selectors = new bytes4[](14);
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
        selectors[13] = PotsHandler.attackSweep.selector;
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
            for (uint256 a = 0; a < handler.holderCount(); ++a) {
                address who = handler.holderAt(a);
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
            for (uint256 a = 0; a < handler.holderCount(); ++a) {
                address who = handler.holderAt(a);
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
            for (uint256 a = 0; a < handler.holderCount(); ++a) {
                sum += pots.sharesOf(potId, handler.holderAt(a));
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
            for (uint256 a = 0; a < handler.holderCount(); ++a) {
                (, uint256 value) = pots.funderInfo(potId, handler.holderAt(a));
                owed += value;
            }
            assertLe(owed, pots.getPot(potId).totalAssets, "the pot covers every claim on it");
        }
    }


    // ---------------------------------------------------------------------
    // Adversarial invariants
    // ---------------------------------------------------------------------

    /// @notice Nothing the attacker tried ever worked. `breached` counts
    /// attempts that were neither refused nor harmless, so it must stay at
    /// zero in every category.
    function invariant_noAttackEverSucceeded() public view {
        string[10] memory names = [
            "non approver proposing",
            "payout to an unlisted destination",
            "payout over a destination cap",
            "the same approver approving twice",
            "approving a cancelled or expired proposal",
            "unfreezing alone below the threshold",
            "closing alone below the threshold",
            "exiting more shares than held",
            "funding a closed or frozen pot",
            "spending one pot's shares against another"
        ];
        for (uint8 i = 0; i < handler.ATTACK_CATEGORIES(); ++i) {
            assertEq(handler.breached(i), 0, names[i]);
        }
    }

    /// @notice Runs the whole attack set against whatever state this run
    /// happened to reach, then proves the run was not vacuous. Every category
    /// must have been attempted at least once, and every attempt must have
    /// been either refused outright or left the protected state untouched.
    ///
    /// This runs once per invariant run, after the random call sequence, so no
    /// category can sit at zero merely because the fuzzer never picked its
    /// selector.
    function afterInvariant() public {
        handler.attackSweep(uint256(keccak256(abi.encodePacked(block.timestamp, block.number))));

        string[10] memory names = [
            "non approver proposing",
            "payout to an unlisted destination",
            "payout over a destination cap",
            "the same approver approving twice",
            "approving a cancelled or expired proposal",
            "unfreezing alone below the threshold",
            "closing alone below the threshold",
            "exiting more shares than held",
            "funding a closed or frozen pot",
            "spending one pot's shares against another"
        ];

        uint256 totalTried;
        uint256 totalBlocked;
        uint256 totalNoEffect;

        for (uint8 i = 0; i < handler.ATTACK_CATEGORIES(); ++i) {
            uint256 tried = handler.attempted(i);
            uint256 refused = handler.blocked(i);
            uint256 harmless = handler.hadNoEffect(i);

            console.log(names[i]);
            console.log("    attempted", tried);
            console.log("    refused  ", refused);
            console.log("    harmless ", harmless);

            assertGt(tried, 0, string.concat("never attempted, so it proves nothing: ", names[i]));
            assertEq(handler.breached(i), 0, string.concat("an attack succeeded: ", names[i]));
            assertEq(refused + harmless, tried, string.concat("unaccounted attempt: ", names[i]));

            totalTried += tried;
            totalBlocked += refused;
            totalNoEffect += harmless;
        }

        console.log("attacks attempted", totalTried);
        console.log("  refused        ", totalBlocked);
        console.log("  harmless       ", totalNoEffect);
        console.log("  succeeded      ", handler.totalBreached());
    }

    /// @notice Every real fund and exit the run performed returned the
    /// conversion rounded down, in the pot's favour.
    ///
    /// The stateful suite used to be blind to this. Flipping share minting to
    /// round in the caller's favour survived all 24,576 calls and was caught by
    /// exactly one hand written unit test. Checking the previews does not help
    /// either, because they are a different call site into the same
    /// conversion: a version of this that asked previewFund passed happily
    /// against that mutant.
    ///
    /// So the handler now checks the value returned by the funds and exits it
    /// was going to make anyway. Doing it that way rather than performing extra
    /// calls inside the invariant keeps the suite fast: a snapshot, a fund and
    /// an exit on every one of 24,576 calls took longer than every other test
    /// put together.
    function invariant_conversionsAlwaysRoundToThePot() public view {
        assertEq(handler.roundingViolations(), 0, "a conversion rounded in the caller's favour");
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
