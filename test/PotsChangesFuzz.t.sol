// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {NivPayPots} from "../src/NivPayPots.sol";
import {NivPayPotsV2} from "../src/NivPayPotsV2.sol";
import {PotsV2TestBase} from "./PotsV2TestBase.sol";

/// @notice The change rules against random numbers and random timing.
contract PotsChangesFuzzTest is PotsV2TestBase {
    /// @notice A widening change applies exactly when its wait is over and
    /// it has not lapsed: never a second early, never a second late.
    function testFuzz_wideningAppliesOnlyInsideItsWindow(uint256 kindSeed, uint256 agreeAfter, uint256 applyAfter)
        public
    {
        agreeAfter = bound(agreeAfter, 0, 7 days);
        applyAfter = bound(applyAfter, 0, 12 days);
        uint256 kind = kindSeed % 3;

        // A pot that stays open longer than any wait here.
        uint256 pot = _birthday(uint64(block.timestamp + 365 days));
        vm.prank(ana);
        uint256 id = kind == 0
            ? pots.proposeAddPayee(pot, dj, "DJ", 300 * ONE)
            : kind == 1
                ? pots.proposeRaiseLimit(pot, CATERER, 900 * ONE)
                : pots.proposeLaterClose(pot, uint64(block.timestamp + 400 days));
        vm.warp(block.timestamp + agreeAfter);
        vm.prank(ben);
        pots.approveChange(id);
        uint256 agreedAt = block.timestamp;

        vm.warp(agreedAt + applyAfter);
        bool inside = applyAfter >= pots.EXIT_WINDOW() && applyAfter <= pots.EXIT_WINDOW() + pots.APPLY_PERIOD();
        if (!inside) vm.expectRevert(NivPayPotsV2.ChangeNotReady.selector);
        pots.applyChange(id);
        assertEq(uint8(pots.changeInfo(id).status) == uint8(NivPayPotsV2.ChangeStatus.Applied), inside);
    }

    /// @notice Lowering a limit is allowed exactly when it lowers, is not zero
    /// and stays at or above what was paid, and it applies at once.
    function testFuzz_lowerLimit(uint256 paid, uint256 limit) public {
        paid = bound(paid, 0, 600 * ONE);
        limit = bound(limit, 0, 800 * ONE);
        _fund(dave, 1_000 * ONE);
        if (paid > 0) _pay(CATERER, paid);

        bool ok = limit > 0 && limit < 600 * ONE && limit >= paid;
        vm.prank(ana);
        if (!ok) {
            vm.expectRevert();
            pots.proposeLowerLimit(potId, CATERER, limit);
            return;
        }
        uint256 id = pots.proposeLowerLimit(potId, CATERER, limit);
        _agreed(id);
        assertEq(_cap(CATERER), limit);

        // Nothing more than the new limit can ever go out.
        uint256 room = limit - paid;
        vm.prank(ana);
        uint256 over = pots.proposePayout(potId, CATERER, room + 1);
        vm.prank(ben);
        vm.expectRevert(NivPayPots.CapExceeded.selector);
        pots.approve(over);
    }

    /// @notice Whatever was raised, whenever it was paid: a payment never goes
    /// above the limit in force when it is made.
    function testFuzz_paymentsNeverPassTheLimitInForce(uint256 raiseTo, uint256 amount, uint256 payAfter) public {
        raiseTo = bound(raiseTo, 600 * ONE + 1, 2_000 * ONE);
        amount = bound(amount, 1, 2_000 * ONE);
        payAfter = bound(payAfter, 0, 5 days);
        _fund(dave, 3_000 * ONE);

        vm.prank(ana);
        uint256 id = pots.proposeRaiseLimit(potId, CATERER, raiseTo);
        _agreed(id);
        uint256 agreedAt = block.timestamp;
        vm.warp(agreedAt + payAfter);
        if (payAfter >= pots.EXIT_WINDOW()) pots.applyChange(id);

        uint256 inForce = _cap(CATERER);
        assertEq(inForce, payAfter >= pots.EXIT_WINDOW() ? raiseTo : 600 * ONE);
        vm.prank(ana);
        uint256 pay = pots.proposePayout(potId, CATERER, amount);
        vm.prank(ben);
        if (amount > inForce) vm.expectRevert(NivPayPots.CapExceeded.selector);
        pots.approve(pay);
        (,,, uint256 spent,) = pots.getDestination(potId, CATERER);
        assertLe(spent, inForce);
    }

    /// @notice During any wait, any funder takes out exactly what the contract
    /// says their part is worth, frozen or not.
    function testFuzz_exitsDuringTheWait(uint256 a, uint256 b, uint256 paid, uint256 after_, bool frozen) public {
        a = bound(a, ONE, 5_000 * ONE);
        b = bound(b, ONE, 5_000 * ONE);
        _fund(dave, a);
        _fund(cleo, b);
        paid = bound(paid, 0, a + b > 700 * ONE ? 600 * ONE : (a + b) / 2);
        if (paid > 0) _pay(CATERER, paid);

        vm.prank(ana);
        uint256 id = pots.proposeAddPayee(potId, dj, "DJ", 300 * ONE);
        _agreed(id);
        vm.warp(block.timestamp + bound(after_, 0, pots.EXIT_WINDOW() - 1));
        if (frozen) {
            vm.prank(cleo);
            pots.freeze(potId);
        }

        (uint256 shares, uint256 worth) = pots.funderInfo(potId, dave);
        uint256 before = token.balanceOf(dave);
        vm.prank(dave);
        assertEq(pots.exit(potId, shares), worth);
        assertEq(token.balanceOf(dave) - before, worth);
        assertEq(uint8(pots.changeInfo(id).status), uint8(NivPayPotsV2.ChangeStatus.Waiting));
    }

    /// @notice However many changes are proposed, withdrawn and applied, no
    /// more than five are ever open on a pot.
    function testFuzz_neverMoreThanFiveOpen(uint8[24] memory moves) public {
        uint256[] memory mine = new uint256[](24);
        uint256 made;
        // Open past every warp below, so only the five-change rule can refuse.
        uint256 pot = _birthday(uint64(block.timestamp + 365 days));
        for (uint256 i = 0; i < moves.length; ++i) {
            uint8 m = moves[i] % 4;
            if (m == 0 || m == 1) {
                vm.prank(ana);
                try pots.proposeRaiseLimit(pot, CATERER, (700 + i) * ONE) returns (uint256 id) {
                    mine[made++] = id;
                } catch (bytes memory err) {
                    assertEq(bytes4(err), NivPayPotsV2.TooManyOpenChanges.selector);
                }
            } else if (m == 2 && made > 0) {
                vm.prank(ana);
                try pots.withdrawChange(mine[moves[i] % made]) {} catch {}
            } else {
                vm.warp(block.timestamp + uint256(moves[i]) * 1 hours);
            }
            assertLe(pots.openChanges(pot).length, 5);
        }
    }
}
