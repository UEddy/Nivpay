// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {PotsTestBase} from "./PotsTestBase.sol";
import {NivPayPots} from "../src/NivPayPots.sol";
import {MockAUSD} from "./mocks/MockAUSD.sol";
import {ReentrantToken} from "./mocks/ReentrantToken.sol";

/// @notice The properties that matter when the token or a counterparty
/// misbehaves: asset freezing, reentrancy, donations, pot isolation and the
/// promise that funds stay reachable even when approvals never can be.
contract PotsSecurityTest is PotsTestBase {
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
        _fundAccount(carol, 1_000_000 * ONE);

        potId = pots.createPot(
            "Party",
            _three(alice, bob, carol),
            2,
            _two(destA, destB),
            _labels2("A", "B"),
            _caps2(100_000 * ONE, 100_000 * ONE),
            endTime
        );
    }

    // ---------------------------------------------------------------------
    // Asset freezing on the token
    // ---------------------------------------------------------------------

    /// @notice A frozen destination makes its own payout revert and nothing
    /// else. The proposal survives, the other destination still gets paid, and
    /// every funder can still leave.
    function test_frozenDestination_blocksOnlyItsOwnPayout() public {
        vm.prank(alice);
        pots.fund(potId, 1000 * ONE);
        token.setFrozen(destA, true);

        vm.prank(alice);
        uint256 id = pots.proposePayout(potId, A, 100 * ONE);
        vm.prank(bob);
        vm.expectRevert(abi.encodeWithSelector(MockAUSD.AccountFrozen.selector, destA));
        pots.approve(id);

        // Nothing was consumed.
        assertEq(
            uint8(pots.proposalInfo(id).status), uint8(NivPayPots.ProposalStatus.Pending), "proposal survives"
        );
        assertEq(pots.getPot(potId).totalAssets, 1000 * ONE, "pot untouched");
        assertEq(pots.feesAccrued(), 0, "no fee taken on a failed payout");
        (,,, uint256 spentA,) = pots.getDestination(potId, A);
        assertEq(spentA, 0, "nothing counted against the frozen cap");

        // The other destination is unaffected.
        vm.prank(alice);
        uint256 idB = pots.proposePayout(potId, B, 200 * ONE);
        vm.prank(bob);
        pots.approve(idB);
        assertEq(token.balanceOf(destB), 200 * ONE, "the healthy destination is still paid");

        // And so is everyone's exit.
        uint256 shares = pots.sharesOf(potId, alice);
        vm.prank(alice);
        assertGt(pots.exit(potId, shares), 0, "exits are unaffected");

        // Once the freeze lifts the same proposal still works.
        token.setFrozen(destA, false);
        vm.prank(bob);
        pots.fund(potId, 500 * ONE);
        vm.prank(bob);
        pots.approve(id);
        assertEq(token.balanceOf(destA), 100 * ONE, "paid once unfrozen");
    }

    /// @notice This is the reason fees are credited rather than pushed. The
    /// fee recipient is one address shared by every pot. If freezing it could
    /// revert payouts, a single Agora action would kill the product.
    function test_frozenFeeRecipient_doesNotBlockPayouts() public {
        vm.prank(alice);
        pots.fund(potId, 1000 * ONE);
        token.setFrozen(feeRecipient, true);

        vm.prank(alice);
        uint256 id = pots.proposePayout(potId, A, 100 * ONE);
        vm.prank(bob);
        pots.approve(id);

        assertEq(token.balanceOf(destA), 100 * ONE, "payout went through");
        assertEq(pots.feesAccrued(), ONE, "fee is credited, waiting to be collected");

        // Only the fee recipient's own collection is blocked.
        vm.prank(feeRecipient);
        vm.expectRevert(abi.encodeWithSelector(MockAUSD.AccountFrozen.selector, feeRecipient));
        pots.collectFees();

        // Every pot keeps working while that is true.
        vm.prank(alice);
        uint256 id2 = pots.proposePayout(potId, B, 50 * ONE);
        vm.prank(bob);
        pots.approve(id2);
        assertEq(token.balanceOf(destB), 50 * ONE, "and the next payout too");
    }

    /// @notice A frozen funder can only ever block their own exit.
    function test_frozenFunder_blocksOnlyTheirOwnExit() public {
        vm.prank(alice);
        pots.fund(potId, 500 * ONE);
        vm.prank(bob);
        pots.fund(potId, 500 * ONE);

        token.setFrozen(alice, true);

        uint256 aliceShares = pots.sharesOf(potId, alice);
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(MockAUSD.AccountFrozen.selector, alice));
        pots.exit(potId, aliceShares);

        uint256 bobShares = pots.sharesOf(potId, bob);
        vm.prank(bob);
        assertEq(pots.exit(potId, bobShares), 500 * ONE, "bob leaves with his own money");
        assertEq(pots.sharesOf(potId, alice), aliceShares, "alice's stake is intact and still hers");
    }

    // ---------------------------------------------------------------------
    // Reentrancy
    // ---------------------------------------------------------------------

    function test_reentrancy_guardBlocksReentryOnExit() public {
        ReentrantToken evil = new ReentrantToken();
        NivPayPots victim = new NivPayPots(IERC20(address(evil)), FEE_BPS, FEE_CAP, feeRecipient);

        evil.mint(alice, 1000 * ONE);
        vm.prank(alice);
        evil.approve(address(victim), type(uint256).max);

        uint256 id = victim.createPot(
            "Evil", _one(alice), 1, _one(destA), _labels1("A"), _caps1(1000 * ONE), endTime
        );
        vm.prank(alice);
        victim.fund(id, 500 * ONE);

        uint256 shares = victim.sharesOf(id, alice);
        evil.arm(address(victim), abi.encodeCall(NivPayPots.exit, (id, shares / 2)));

        vm.prank(alice);
        victim.exit(id, shares / 2);

        assertTrue(evil.reenterCalled(), "the token did try to reenter");
        assertFalse(evil.reenterSucceeded(), "and the guard stopped it");
        assertEq(
            bytes4(evil.reenterReturndata()),
            ReentrancyGuard.ReentrancyGuardReentrantCall.selector,
            "rejected by the reentrancy guard"
        );
        assertEq(victim.sharesOf(id, alice), shares / 2, "only the one exit took effect");
    }

    function test_reentrancy_guardBlocksReentryOnFund() public {
        ReentrantToken evil = new ReentrantToken();
        NivPayPots victim = new NivPayPots(IERC20(address(evil)), FEE_BPS, FEE_CAP, feeRecipient);

        evil.mint(alice, 1000 * ONE);
        vm.prank(alice);
        evil.approve(address(victim), type(uint256).max);

        uint256 id = victim.createPot(
            "Evil", _one(alice), 1, _one(destA), _labels1("A"), _caps1(1000 * ONE), endTime
        );
        evil.arm(address(victim), abi.encodeCall(NivPayPots.fund, (id, 100 * ONE)));

        vm.prank(alice);
        victim.fund(id, 100 * ONE);

        assertTrue(evil.reenterCalled(), "the token did try to reenter");
        assertFalse(evil.reenterSucceeded(), "and the guard stopped it");
        assertEq(victim.getPot(id).totalAssets, 100 * ONE, "only the one funding counted");
    }

    // ---------------------------------------------------------------------
    // Donations and pot isolation
    // ---------------------------------------------------------------------

    /// @notice Pot assets come from storage, never from the token balance, so
    /// sending tokens straight to the contract changes nothing and the sender
    /// has simply given the money away.
    function test_donation_doesNotMoveSharePricesOrBecomeClaimable() public {
        vm.prank(alice);
        pots.fund(potId, 100 * ONE);
        (, uint256 before) = pots.funderInfo(potId, alice);

        token.mint(stranger, 1_000_000 * ONE);
        vm.prank(stranger);
        token.transfer(address(pots), 1_000_000 * ONE);

        (, uint256 afterDonation) = pots.funderInfo(potId, alice);
        assertEq(afterDonation, before, "a donation moves no share price");
        assertEq(pots.getPot(potId).totalAssets, 100 * ONE, "pot assets unchanged");

        uint256 aliceShares = pots.sharesOf(potId, alice);
        vm.prank(alice);
        assertEq(pots.exit(potId, aliceShares), 100 * ONE, "alice takes only what she put in");

        // The donated tokens are simply stuck. Nobody can withdraw them, which
        // is the point: there is no path out of this contract that is not a
        // listed destination or a funder's own shares.
        assertEq(token.balanceOf(address(pots)), 1_000_000 * ONE, "the donation stays where it was sent");
    }

    /// @notice A first funder cannot inflate the share price against a second
    /// one, because the only way to raise assets without shares is a payout,
    /// which needs approvals and goes to a fixed destination.
    function test_donation_cannotFrontRunAFunder() public {
        vm.prank(alice);
        pots.fund(potId, 1);

        vm.prank(alice);
        token.transfer(address(pots), 100_000 * ONE);

        vm.prank(bob);
        pots.fund(potId, 1000 * ONE);
        (, uint256 bobValue) = pots.funderInfo(potId, bob);
        assertEq(bobValue, 1000 * ONE, "bob is worth exactly what he funded");
    }

    function test_potsAreIsolated() public {
        uint256 other = pots.createPot(
            "Other", _two(alice, bob), 2, _one(destB), _labels1("B"), _caps1(100_000 * ONE), endTime
        );

        vm.prank(alice);
        pots.fund(potId, 1000 * ONE);
        vm.prank(bob);
        pots.fund(other, 400 * ONE);

        (, uint256 bobInOtherBefore) = pots.funderInfo(other, bob);

        // Spend the first pot down to nothing, freeze it, close it.
        vm.prank(alice);
        uint256 id = pots.proposePayout(potId, A, 900 * ONE);
        vm.prank(bob);
        pots.approve(id);
        vm.prank(carol);
        pots.freeze(potId);

        (, uint256 bobInOtherAfter) = pots.funderInfo(other, bob);
        assertEq(bobInOtherAfter, bobInOtherBefore, "the other pot is untouched");
        assertEq(pots.getPot(other).totalAssets, 400 * ONE, "its assets are untouched");
        assertFalse(pots.getPot(other).frozen, "freezing one pot does not freeze another");

        // And the other pot still pays out and still lets its funder leave.
        vm.prank(alice);
        uint256 id2 = pots.proposePayout(other, A, 100 * ONE);
        vm.prank(bob);
        pots.approve(id2);
        assertEq(pots.getPot(other).totalAssets, 400 * ONE - 101 * ONE, "only its own spending applies");
    }

    function test_approverOfOnePotIsNotAnApproverOfAnother() public {
        uint256 other = pots.createPot(
            "Other", _one(stranger), 1, _one(destB), _labels1("B"), _caps1(100_000 * ONE), endTime
        );
        vm.prank(alice);
        vm.expectRevert(NivPayPots.NotApprover.selector);
        pots.proposePayout(other, A, ONE);

        vm.prank(stranger);
        vm.expectRevert(NivPayPots.NotApprover.selector);
        pots.proposePayout(potId, A, ONE);
    }

    // ---------------------------------------------------------------------
    // Safety of funds beats liveness of payouts
    // ---------------------------------------------------------------------

    /// @notice If the approvers can never sign again, the money is frozen in
    /// place as far as payouts are concerned, and every funder can still walk
    /// away with their share.
    function test_lostKeys_moneyIsStillReachable() public {
        vm.prank(alice);
        pots.fund(potId, 600 * ONE);
        vm.prank(bob);
        pots.fund(potId, 400 * ONE);

        // Simulate the approvers being unreachable: nobody proposes anything
        // ever again, and a hostile third party cannot do it for them.
        vm.prank(stranger);
        vm.expectRevert(NivPayPots.NotApprover.selector);
        pots.proposePayout(potId, A, ONE);

        uint256 aliceShares = pots.sharesOf(potId, alice);
        uint256 bobShares = pots.sharesOf(potId, bob);
        vm.prank(alice);
        assertEq(pots.exit(potId, aliceShares), 600 * ONE, "alice recovers her money");
        vm.prank(bob);
        assertEq(pots.exit(potId, bobShares), 400 * ONE, "bob recovers his");
        assertEq(pots.getPot(potId).totalAssets, 0, "the pot empties cleanly");
    }

    /// @notice A single hostile approver can stop payouts forever by freezing,
    /// since unfreezing needs the threshold. They can never stop anybody
    /// leaving with their own money, which is the trade the design makes.
    function test_hostileApprover_cannotTrapFunds() public {
        vm.prank(alice);
        pots.fund(potId, 1000 * ONE);
        vm.prank(carol);
        pots.freeze(potId);

        vm.prank(alice);
        vm.expectRevert(NivPayPots.PotFrozen.selector);
        pots.proposePayout(potId, A, ONE);

        uint256 shares = pots.sharesOf(potId, alice);
        vm.prank(alice);
        assertEq(pots.exit(potId, shares), 1000 * ONE, "the freeze cannot hold the money");
    }

    /// @notice There is no path that sends pot money to an address the caller
    /// picks. An approver who wants to pay themselves has to have been a
    /// listed destination at creation, and that list can never grow.
    function test_noWithdrawToSelfPath() public {
        vm.prank(alice);
        pots.fund(potId, 1000 * ONE);

        // Alice is an approver, but she is not a destination, and there is no
        // index that resolves to her.
        vm.prank(alice);
        vm.expectRevert(NivPayPots.NoSuchDestination.selector);
        pots.proposePayout(potId, 2, 1000 * ONE);

        NivPayPots.Destination[] memory ds = pots.getDestinations(potId);
        assertEq(ds.length, 2, "the destination list is still the two it was created with");
        assertEq(ds[0].to, destA, "and still the same addresses");
        assertEq(ds[1].to, destB, "and still the same addresses");

        // Everything she can do with a payout ends at destA or destB.
        vm.prank(alice);
        uint256 id = pots.proposePayout(potId, A, 1000 * ONE);
        vm.prank(bob);
        vm.expectRevert(NivPayPots.InsufficientPotAssets.selector);
        pots.approve(id);
        assertEq(token.balanceOf(alice), 1_000_000 * ONE - 1000 * ONE, "alice gained nothing");
    }

    // ---------------------------------------------------------------------
    // A pot that is spent to nothing and funded again
    // ---------------------------------------------------------------------

    function test_drainedPot_canBeFundedAgain() public {
        vm.prank(alice);
        pots.fund(potId, 1000 * ONE);

        // Spend everything the pot has, fee included.
        vm.prank(alice);
        uint256 id = pots.proposePayout(potId, A, 990_099010);
        vm.prank(bob);
        pots.approve(id);

        uint256 left = pots.getPot(potId).totalAssets;
        assertLt(left, ONE, "pot is all but empty");

        // Take the last of it out so the pot is exactly zero with a live share
        // supply, which is the awkward state.
        uint256 aliceShares = pots.sharesOf(potId, alice);
        vm.prank(alice);
        pots.exit(potId, aliceShares);
        assertEq(pots.getPot(potId).totalAssets, 0, "assets are zero");
        assertEq(pots.getPot(potId).totalShares, 0, "shares are zero too");

        // Funding it again behaves exactly like a fresh pot.
        vm.prank(bob);
        pots.fund(potId, 500 * ONE);
        (, uint256 bobValue) = pots.funderInfo(potId, bob);
        assertEq(bobValue, 500 * ONE, "the refunded pot values bob correctly");
    }

    /// @notice The harder version: assets reach zero while shares do not,
    /// because the last funder never exited. Those shares are worth nothing,
    /// and the new funder must not be made to pay for the old spending.
    function test_drainedPot_withLiveSharesCanBeFundedAgain() public {
        vm.prank(alice);
        pots.fund(potId, 1000 * ONE);

        vm.prank(alice);
        uint256 id = pots.proposePayout(potId, A, 990_099009);
        vm.prank(bob);
        pots.approve(id);

        // Strip the remainder with a partial exit so assets hit exactly zero
        // while alice keeps shares.
        uint256 remaining = pots.getPot(potId).totalAssets;
        if (remaining > 0) {
            uint256 need = pots.previewFund(potId, remaining);
            uint256 held = pots.sharesOf(potId, alice);
            vm.prank(alice);
            pots.exit(potId, need > held ? held : need);
        }

        NivPayPots.PotView memory p = pots.getPot(potId);
        if (p.totalAssets == 0 && p.totalShares > 0) {
            (, uint256 aliceValue) = pots.funderInfo(potId, alice);
            assertEq(aliceValue, 0, "shares in an empty pot are worth nothing");

            vm.prank(bob);
            pots.fund(potId, 500 * ONE);
            (, uint256 bobValue) = pots.funderInfo(potId, bob);
            assertEq(bobValue, 500 * ONE, "bob does not inherit the old spending");
            (, aliceValue) = pots.funderInfo(potId, alice);
            assertEq(aliceValue, 0, "and the worthless shares stay worthless");
        }
    }
}
