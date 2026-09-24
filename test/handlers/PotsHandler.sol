// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {NivPayPots} from "../../src/NivPayPots.sol";
import {MockAUSD} from "../mocks/MockAUSD.sol";

/// @notice Drives NivPayPots through random but legal sequences of funding,
/// exiting, claiming, proposing, approving, revoking, cancelling, freezing,
/// closing and fee collection, keeping a shadow set of books as it goes.
///
/// The handler owns three pots that share an approver set but have their own
/// destinations, which is what lets the invariants say something about pot
/// isolation rather than just about one pot.
contract PotsHandler is Test {
    NivPayPots public immutable pots;
    MockAUSD public immutable token;

    address[] public actors;
    address[] public approvers;
    uint256[] public potIds;

    /// Every destination address the handler ever created, across all pots.
    address[] public allDestinations;

    uint256[] public proposalIds;
    uint256[] public executedPayouts;

    // Shadow books, kept per pot.
    mapping(uint256 => uint256) public gFunded;
    mapping(uint256 => uint256) public gPaidOut;
    mapping(uint256 => uint256) public gFees;
    mapping(uint256 => uint256) public gExited;
    mapping(uint256 => uint256) public gClaimed;

    /// What each destination should have received, by our own count.
    mapping(address => uint256) public gDestReceived;

    uint256 public gFeesCollected;

    /// The largest amount by which any funder's redeemable value has been seen
    /// to fall because somebody else funded or exited. Should never exceed one.
    uint256 public worstCollateralLoss;


    uint64 public immutable endTime;

    uint256 private constant MAX_FUND = 1_000_000_000000;

    constructor(NivPayPots pots_, MockAUSD token_) {
        pots = pots_;
        token = token_;
        endTime = uint64(block.timestamp + 3650 days);

        for (uint256 i = 0; i < 4; ++i) {
            address a = address(uint160(uint256(keccak256(abi.encodePacked("actor", i)))));
            actors.push(a);
            token.mint(a, type(uint128).max);
            vm.prank(a);
            token.approve(address(pots), type(uint256).max);
        }
        for (uint256 i = 0; i < 3; ++i) {
            approvers.push(address(uint160(uint256(keccak256(abi.encodePacked("approver", i))))));
        }

        for (uint256 p = 0; p < 3; ++p) {
            address[] memory ds = new address[](2);
            bytes32[] memory labels = new bytes32[](2);
            uint256[] memory caps = new uint256[](2);
            for (uint256 d = 0; d < 2; ++d) {
                address dest = address(uint160(uint256(keccak256(abi.encodePacked("dest", p, d)))));
                ds[d] = dest;
                labels[d] = bytes32(uint256(d + 1));
                // Deliberately tight so the cap invariant has something to bite
                // on rather than never being approached.
                caps[d] = (d == 0 ? 500_000000 : 5_000_000000);
                allDestinations.push(dest);
            }
            potIds.push(pots.createPot("Handler", approvers, 2, ds, labels, caps, endTime));
        }
    }

    function actorCount() external view returns (uint256) {
        return actors.length;
    }

    function potCount() external view returns (uint256) {
        return potIds.length;
    }

    function destinationCount() external view returns (uint256) {
        return allDestinations.length;
    }

    function executedPayoutCount() external view returns (uint256) {
        return executedPayouts.length;
    }

    function _actor(uint256 seed) internal view returns (address) {
        return actors[seed % actors.length];
    }

    function _approver(uint256 seed) internal view returns (address) {
        return approvers[seed % approvers.length];
    }

    function _pot(uint256 seed) internal view returns (uint256) {
        return potIds[seed % potIds.length];
    }

    /// @dev Snapshot every funder's redeemable value in every pot, so an action
    /// can be checked for collateral damage to people who took no part in it.
    function _snapshotValues() internal view returns (uint256[12] memory out) {
        uint256 n = 0;
        for (uint256 p = 0; p < potIds.length; ++p) {
            for (uint256 a = 0; a < actors.length; ++a) {
                (, uint256 value) = pots.funderInfo(potIds[p], actors[a]);
                out[n++] = value;
            }
        }
    }

    function _recordCollateralDamage(uint256[12] memory before, address mover, uint256 movedPot) internal {
        uint256 n = 0;
        for (uint256 p = 0; p < potIds.length; ++p) {
            for (uint256 a = 0; a < actors.length; ++a) {
                (, uint256 nowValue) = pots.funderInfo(potIds[p], actors[a]);
                uint256 wasValue = before[n++];
                bool isTheMover = (actors[a] == mover && potIds[p] == movedPot);
                if (!isTheMover && nowValue < wasValue) {
                    uint256 loss = wasValue - nowValue;
                    if (loss > worstCollateralLoss) worstCollateralLoss = loss;
                }
            }
        }
    }

    // ---------------------------------------------------------------------
    // Actions
    // ---------------------------------------------------------------------

    function fund(uint256 actorSeed, uint256 potSeed, uint256 amount) external {
        address who = _actor(actorSeed);
        uint256 potId = _pot(potSeed);
        amount = bound(amount, 1_000000, MAX_FUND);

        NivPayPots.PotView memory p = pots.getPot(potId);
        if (p.closed || p.frozen) return;

        uint256[12] memory before = _snapshotValues();
        vm.prank(who);
        pots.fund(potId, amount);
        gFunded[potId] += amount;
        _recordCollateralDamage(before, who, potId);
    }

    function exitSome(uint256 actorSeed, uint256 potSeed, uint256 pct) external {
        address who = _actor(actorSeed);
        uint256 potId = _pot(potSeed);
        uint256 held = pots.sharesOf(potId, who);
        if (held == 0) return;

        uint256 burn = (held * bound(pct, 1, 100)) / 100;
        if (burn == 0) burn = 1;

        bool closed = pots.getPot(potId).closed;
        uint256[12] memory before = _snapshotValues();
        vm.prank(who);
        uint256 got = pots.exit(potId, burn);
        if (closed) {
            gClaimed[potId] += got;
        } else {
            gExited[potId] += got;
        }
        _recordCollateralDamage(before, who, potId);
    }

    function claimAll(uint256 actorSeed, uint256 potSeed) external {
        address who = _actor(actorSeed);
        uint256 potId = _pot(potSeed);
        if (!pots.getPot(potId).closed) return;
        if (pots.sharesOf(potId, who) == 0) return;

        vm.prank(who);
        gClaimed[potId] += pots.claim(potId);
    }

    function proposePayout(uint256 approverSeed, uint256 potSeed, uint256 destSeed, uint256 amount) external {
        uint256 potId = _pot(potSeed);
        NivPayPots.PotView memory p = pots.getPot(potId);
        if (p.closed || p.frozen) return;

        uint16 destIndex = uint16(destSeed % p.destinationCount);

        // Aim the amount at the room actually left under the destination's cap
        // and at what the pot can plausibly afford. Without this the amounts
        // sit far above both, every approval declines to execute, and the
        // payout, cap and threshold invariants pass vacuously.
        (,, uint256 cap, uint256 spent,) = pots.getDestination(potId, destIndex);
        uint256 room = cap - spent;
        uint256 affordable = (p.totalAssets * 90) / 100;
        uint256 hi = room < affordable ? room : affordable;
        if (hi == 0) return;
        amount = bound(amount, 1, hi);

        vm.prank(_approver(approverSeed));
        uint256 id = pots.proposePayout(potId, destIndex, amount);
        proposalIds.push(id);
        _afterPossibleExecution(id);
    }

    /// @dev Closing is terminal. Proposing it on every call closed all three
    /// pots within a few steps and no payout ever ran, so it happens on
    /// roughly one call in eight.
    /// @notice The whole agreed payout flow in one call: somebody funds, an
    /// approver proposes, a second approver approves and it pays out. The
    /// granular actions above still explore every interleaving, but leaving
    /// payouts to chance meant most runs executed none at all and the payout,
    /// cap and threshold invariants had nothing to check.
    function executePayoutCycle(uint256 potSeed, uint256 destSeed, uint256 amount, uint256 topUp) external {
        uint256 potId = _pot(potSeed);
        NivPayPots.PotView memory p = pots.getPot(potId);
        if (p.closed || p.frozen) return;

        // Make sure the pot can afford something.
        uint256 add = bound(topUp, 10_000000, MAX_FUND);
        vm.prank(actors[potSeed % actors.length]);
        pots.fund(potId, add);
        gFunded[potId] += add;

        p = pots.getPot(potId);
        uint16 destIndex = uint16(destSeed % p.destinationCount);
        (,, uint256 cap, uint256 spent,) = pots.getDestination(potId, destIndex);
        uint256 room = cap - spent;
        uint256 affordable = (p.totalAssets * 90) / 100;
        uint256 hi = room < affordable ? room : affordable;
        if (hi == 0) return;
        amount = bound(amount, 1, hi);

        vm.prank(approvers[0]);
        uint256 id = pots.proposePayout(potId, destIndex, amount);
        proposalIds.push(id);

        vm.prank(approvers[1]);
        pots.approve(id);
        _afterPossibleExecution(id);
    }

    function proposeClose(uint256 approverSeed, uint256 potSeed) external {
        if (potSeed % 8 != 0) return;
        uint256 potId = _pot(potSeed);
        if (pots.getPot(potId).closed) return;
        vm.prank(_approver(approverSeed));
        proposalIds.push(pots.proposeClose(potId));
    }

    function proposeUnfreeze(uint256 approverSeed, uint256 potSeed) external {
        uint256 potId = _pot(potSeed);
        if (!pots.getPot(potId).frozen) return;
        vm.prank(_approver(approverSeed));
        proposalIds.push(pots.proposeUnfreeze(potId));
    }

    /// @dev Scan up to 32 proposals from a random offset for one that `who`
    /// could approve right now.
    function _findActionable(address who, uint256 seed) internal view returns (bool, uint256) {
        uint256 n = proposalIds.length;
        uint256 start = seed % n;
        uint256 limit = n < 32 ? n : 32;
        // Two passes: payouts first, then anything. A close proposal ends a
        // pot for good, so letting those win the race starved the payout
        // invariants just as badly as picking blindly did.
        for (uint256 pass = 0; pass < 2; ++pass) {
            for (uint256 i = 0; i < limit; ++i) {
                uint256 id = proposalIds[(start + i) % n];
                NivPayPots.ProposalView memory v = pots.proposalInfo(id);
                if (v.status != NivPayPots.ProposalStatus.Pending) continue;
                if (pots.hasApproved(id, who)) continue;
                if (pass == 0 && v.kind != NivPayPots.ProposalKind.Payout) continue;
                return (true, id);
            }
        }
        return (false, 0);
    }

    function approveProposal(uint256 approverSeed, uint256 proposalSeed) external {
        if (proposalIds.length == 0) return;
        address who = _approver(approverSeed);

        // Seek out a proposal this approver can actually act on. Picking one
        // index blindly almost always lands on an executed, cancelled or
        // expired proposal once the list grows, which starved the payout,
        // cap and threshold invariants of anything to check.
        (bool found, uint256 id) = _findActionable(who, proposalSeed);
        if (!found) return;

        NivPayPots.ProposalView memory v = pots.proposalInfo(id);
        NivPayPots.PotView memory p = pots.getPot(v.potId);
        if (v.kind == NivPayPots.ProposalKind.Payout && (p.closed || p.frozen)) return;
        if (v.kind == NivPayPots.ProposalKind.Close && p.closed) return;
        if (v.kind == NivPayPots.ProposalKind.Unfreeze && !p.frozen) return;

        // A payout that the pot cannot afford, or that would break a cap,
        // reverts by design and leaves the proposal pending. That path is
        // covered by the unit tests; here we only take the legal branch.
        if (v.kind == NivPayPots.ProposalKind.Payout && v.approvals + 1 >= p.threshold) {
            (,, uint256 cap, uint256 spent,) = pots.getDestination(v.potId, v.destIndex);
            if (spent + v.amount > cap) return;
            if (p.totalAssets < v.amount + v.fee) return;
        }

        vm.prank(who);
        pots.approve(id);
        _afterPossibleExecution(id);
    }

    function revoke(uint256 approverSeed, uint256 proposalSeed) external {
        if (proposalIds.length == 0) return;
        uint256 id = proposalIds[proposalSeed % proposalIds.length];
        address who = _approver(approverSeed);
        if (pots.proposalInfo(id).status != NivPayPots.ProposalStatus.Pending) return;
        if (!pots.hasApproved(id, who)) return;
        vm.prank(who);
        pots.revokeApproval(id);
    }

    function cancel(uint256 proposalSeed) external {
        if (proposalIds.length == 0) return;
        uint256 id = proposalIds[proposalSeed % proposalIds.length];
        NivPayPots.ProposalView memory v = pots.proposalInfo(id);
        if (v.status != NivPayPots.ProposalStatus.Pending) return;
        vm.prank(v.proposer);
        pots.cancelProposal(id);
    }

    /// @dev Freezing is sticky: it takes a threshold approved proposal to lift,
    /// so freezing on every call left all three pots frozen almost immediately
    /// and no payout ever ran. Freeze on roughly one call in four instead.
    function freezePot(uint256 approverSeed, uint256 potSeed) external {
        if (potSeed % 4 != 0) return;
        uint256 potId = _pot(potSeed);
        if (pots.getPot(potId).frozen) return;
        vm.prank(_approver(approverSeed));
        pots.freeze(potId);
    }

    function closeByTime(uint256 potSeed) external {
        uint256 potId = _pot(potSeed);
        if (block.timestamp < pots.getPot(potId).endTime) return;
        vm.prank(_actor(potSeed));
        pots.closePot(potId);
    }

    function collectFees() external {
        if (pots.feesAccrued() == 0) return;
        vm.prank(pots.feeRecipient());
        gFeesCollected += pots.collectFees();
    }

    /// @dev Kept well under the seven day proposal window most of the time, so
    /// that proposals survive long enough to be approved. A 30 day step
    /// expired every proposal before it could execute.
    function warp(uint256 secs) external {
        vm.warp(block.timestamp + bound(secs, 1 hours, 3 days));
    }

    function _afterPossibleExecution(uint256 id) internal {
        NivPayPots.ProposalView memory v = pots.proposalInfo(id);
        if (v.status != NivPayPots.ProposalStatus.Executed) return;
        if (v.kind != NivPayPots.ProposalKind.Payout) return;

        // Only count a payout once, however many times this is reached.
        for (uint256 i = 0; i < executedPayouts.length; ++i) {
            if (executedPayouts[i] == id) return;
        }
        executedPayouts.push(id);
        gPaidOut[v.potId] += v.amount;
        gFees[v.potId] += v.fee;
        gDestReceived[v.destination] += v.amount;
    }
}
