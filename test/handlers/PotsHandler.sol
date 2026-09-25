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

    /// @notice Times a real fund or exit returned something other than the
    /// conversion rounded down. Checked on the calls the handler already
    /// makes, so it costs nothing, and recorded rather than asserted here
    /// because fail_on_revert is off and a revert inside a handler action
    /// would be swallowed.
    uint256 public roundingViolations;


    uint64 public immutable endTime;

    uint256 private constant MAX_FUND = 1_000_000_000000;

    // ---------------------------------------------------------------------
    // Adversarial state
    // ---------------------------------------------------------------------

    /// @notice Pots 0 to 2 are driven by the ordinary actions. Pot 3 is
    /// sacrificial: the attacker closes it and then keeps trying to fund it,
    /// so the "funding after close" rule always has a live target.
    uint256 public constant LIVE_POTS = 3;
    uint256 public constant SACRIFICIAL_POT = 3;

    /// @notice Reserved for the adversarial actions. The ordinary actions
    /// never select it and no attack ever closes it, so a run that happens
    /// to close every live pot still puts every rule to the test.
    uint256 public constant ARENA_POT = 4;

    /// @notice Not an approver of any pot, not a destination of any pot.
    address public attacker;

    uint8 public constant A_NON_APPROVER_PROPOSE = 0;
    uint8 public constant A_BAD_DESTINATION = 1;
    uint8 public constant A_OVER_CAP = 2;
    uint8 public constant A_DOUBLE_APPROVE = 3;
    uint8 public constant A_DEAD_PROPOSAL = 4;
    uint8 public constant A_SOLO_UNFREEZE = 5;
    uint8 public constant A_SOLO_CLOSE = 6;
    uint8 public constant A_OVER_EXIT = 7;
    uint8 public constant A_FUND_WHEN_SHUT = 8;
    uint8 public constant A_CROSS_POT_SHARES = 9;
    uint8 public constant ATTACK_CATEGORIES = 10;

    /// @notice How many times each rule was actually put to the test. A
    /// category sitting at zero means the suite proves nothing about that rule.
    mapping(uint8 => uint256) public attempted;
    /// @notice Attempts that reverted.
    mapping(uint8 => uint256) public blocked;
    /// @notice Attempts that were allowed to run but changed nothing they were
    /// not entitled to change.
    mapping(uint8 => uint256) public hadNoEffect;
    /// @notice Attempts that got away with it. Must stay at zero.
    mapping(uint8 => uint256) public breached;

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

        attacker = address(uint160(uint256(keccak256("attacker"))));
        token.mint(attacker, type(uint128).max);
        vm.prank(attacker);
        token.approve(address(pots), type(uint256).max);

        for (uint256 p = 0; p < 5; ++p) {
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

    /// @notice Everyone who can hold shares: the ordinary actors plus the
    /// attacker, which funds pots legitimately in order to try spending
    /// those shares somewhere it should not be able to.
    function holderCount() public view returns (uint256) {
        return actors.length + 1;
    }

    function holderAt(uint256 i) public view returns (address) {
        return i < actors.length ? actors[i] : attacker;
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
        return potIds[seed % LIVE_POTS];
    }

    /// @dev Snapshot every funder's redeemable value in every pot, so an action
    /// can be checked for collateral damage to people who took no part in it.
    function _snapshotValues() internal view returns (uint256[] memory out) {
        out = new uint256[](potIds.length * holderCount());
        uint256 n = 0;
        for (uint256 p = 0; p < potIds.length; ++p) {
            for (uint256 a = 0; a < holderCount(); ++a) {
                (, uint256 value) = pots.funderInfo(potIds[p], holderAt(a));
                out[n++] = value;
            }
        }
    }

    function _recordCollateralDamage(uint256[] memory before, address mover, uint256 movedPot) internal {
        uint256 n = 0;
        for (uint256 p = 0; p < potIds.length; ++p) {
            for (uint256 a = 0; a < holderCount(); ++a) {
                (, uint256 nowValue) = pots.funderInfo(potIds[p], holderAt(a));
                uint256 wasValue = before[n++];
                bool isTheMover = (holderAt(a) == mover && potIds[p] == movedPot);
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

        uint256[] memory before = _snapshotValues();
        uint256 expectedShares = _expectedShares(potId, amount);
        vm.prank(who);
        uint256 minted = pots.fund(potId, amount);
        if (minted != expectedShares) roundingViolations++;
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
        uint256[] memory before = _snapshotValues();
        uint256 expectedAssets = _expectedAssets(potId, burn);
        vm.prank(who);
        uint256 got = pots.exit(potId, burn);
        if (got != expectedAssets) roundingViolations++;
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

    // =====================================================================
    // Adversarial actions
    //
    // Every one of these attempts something the contract is supposed to
    // refuse. Each records that it tried, then checks what happened: either
    // the call reverted, or it was allowed to run and changed nothing it was
    // not entitled to change. Anything else is a breach and fails the run.
    //
    // They set up their own preconditions with legal calls, so a category is
    // never skipped for want of the right state, and they put everything back
    // afterwards so the ordinary actions keep having somewhere to work.
    // =====================================================================

    function _record(uint8 cat, bool reverted, bool stateHeld) private {
        attempted[cat]++;
        if (reverted) {
            blocked[cat]++;
        } else if (stateHeld) {
            hadNoEffect[cat]++;
        } else {
            breached[cat]++;
        }
    }

    /// @dev The share count a funding of `assets` should mint, and the assets a
    /// burn of `shares` should return, both rounded down, computed here from the
    /// pot's reported totals rather than read back off the contract.
    function _expectedShares(uint256 potId, uint256 assets) private view returns (uint256) {
        NivPayPots.PotView memory p = pots.getPot(potId);
        return (assets * (p.totalShares + 10 ** pots.DECIMALS_OFFSET())) / (p.totalAssets + 1);
    }

    function _expectedAssets(uint256 potId, uint256 shares) private view returns (uint256) {
        NivPayPots.PotView memory p = pots.getPot(potId);
        return (shares * (p.totalAssets + 1)) / (p.totalShares + 10 ** pots.DECIMALS_OFFSET());
    }

    /// @dev An open, unfrozen pot: one of the live ones where possible, so
    /// attacks land on realistic state, and the reserved arena otherwise.
    function _openPot(uint256 seed) private view returns (bool, uint256) {
        for (uint256 i = 0; i < LIVE_POTS; ++i) {
            uint256 potId = potIds[(seed + i) % LIVE_POTS];
            NivPayPots.PotView memory p = pots.getPot(potId);
            if (!p.closed && !p.frozen) return (true, potId);
        }
        NivPayPots.PotView memory arena = pots.getPot(potIds[ARENA_POT]);
        if (!arena.closed && !arena.frozen) return (true, potIds[ARENA_POT]);
        return (false, 0);
    }

    /// @dev Put enough in a pot that a payout attempt fails on the rule being
    /// tested rather than on the pot simply being empty.
    function _ensureFunded(uint256 potId, uint256 amount) private {
        if (pots.getPot(potId).totalAssets >= amount) return;
        vm.prank(actors[0]);
        pots.fund(potId, amount);
        gFunded[potId] += amount;
    }

    /// @notice Somebody who is not an approver tries to propose.
    function attackNonApproverProposes(uint256 seed) public {
        (bool ok, uint256 potId) = _openPot(seed);
        if (!ok) return;
        uint256 before = pots.proposalCount();

        bool reverted;
        vm.prank(attacker);
        try pots.proposePayout(potId, 0, 1_000000) {} catch { reverted = true; }
        _record(A_NON_APPROVER_PROPOSE, reverted, pots.proposalCount() == before);

        before = pots.proposalCount();
        reverted = false;
        vm.prank(attacker);
        try pots.proposeClose(potId) {} catch { reverted = true; }
        _record(A_NON_APPROVER_PROPOSE, reverted, pots.proposalCount() == before);

        // An actor who funds a pot still does not get to propose.
        before = pots.proposalCount();
        reverted = false;
        vm.prank(actors[0]);
        try pots.proposePayout(potId, 0, 1_000000) {} catch { reverted = true; }
        _record(A_NON_APPROVER_PROPOSE, reverted, pots.proposalCount() == before);
    }

    /// @notice An approver aims a payout at something that is not on the list.
    function attackPayoutToUnlistedDestination(uint256 seed) public {
        (bool ok, uint256 potId) = _openPot(seed);
        if (!ok) return;
        uint8 destCount = pots.getPot(potId).destinationCount;
        uint256 before = pots.proposalCount();
        uint256 attackerBalance = token.balanceOf(attacker);

        // One past the end of the list.
        bool reverted;
        vm.prank(approvers[0]);
        try pots.proposePayout(potId, destCount, 1_000000) {} catch { reverted = true; }
        _record(
            A_BAD_DESTINATION,
            reverted,
            pots.proposalCount() == before && token.balanceOf(attacker) == attackerBalance
        );

        // Far past the end of the list.
        before = pots.proposalCount();
        reverted = false;
        vm.prank(approvers[0]);
        try pots.proposePayout(potId, type(uint16).max, 1_000000) {} catch { reverted = true; }
        _record(A_BAD_DESTINATION, reverted, pots.proposalCount() == before);

        // The attacker is not reachable through any index that does exist.
        NivPayPots.Destination[] memory ds = pots.getDestinations(potId);
        bool attackerListed;
        for (uint256 i = 0; i < ds.length; ++i) {
            if (ds[i].to == attacker) attackerListed = true;
        }
        _record(A_BAD_DESTINATION, false, !attackerListed);
    }

    /// @notice A payout for more than a destination has left under its cap.
    /// Split across three functions purely to stay under the stack limit.
    function attackPayoutOverCap(uint256 seed) public {
        (bool ok, uint256 potId) = _openPot(seed);
        if (!ok) return;
        _overCapPropose(potId, uint16(seed % pots.getPot(potId).destinationCount));
    }

    function _overCapPropose(uint256 potId, uint16 destIndex) private {
        (address to,, uint256 cap, uint256 spent,) = pots.getDestination(potId, destIndex);
        uint256 over = cap - spent + 1;
        _ensureFunded(potId, over + pots.feeOn(over) + 1_000000);

        vm.prank(approvers[0]);
        uint256 id = pots.proposePayout(potId, destIndex, over);
        proposalIds.push(id);
        _overCapApprove(potId, destIndex, id, to, spent);
    }

    function _overCapApprove(uint256 potId, uint16 destIndex, uint256 id, address to, uint256 spentBefore)
        private
    {
        uint256 destBalance = token.balanceOf(to);
        uint256 assetsBefore = pots.getPot(potId).totalAssets;

        bool reverted;
        vm.prank(approvers[1]);
        try pots.approve(id) {} catch { reverted = true; }

        (,,, uint256 spentAfter,) = pots.getDestination(potId, destIndex);
        _record(
            A_OVER_CAP,
            reverted,
            spentAfter == spentBefore && token.balanceOf(to) == destBalance
                && pots.getPot(potId).totalAssets == assetsBefore
        );

        vm.prank(approvers[0]);
        pots.cancelProposal(id);
    }

    /// @notice The same approver approving twice, trying to reach a threshold
    /// on their own.
    function attackDoubleApprove(uint256 seed) public {
        (bool ok, uint256 potId) = _openPot(seed);
        if (!ok) return;
        _ensureFunded(potId, 10_000000);

        vm.prank(approvers[0]);
        uint256 id = pots.proposePayout(potId, 0, 1_000000);
        proposalIds.push(id);

        uint8 approvalsBefore = pots.proposalInfo(id).approvals;

        bool reverted;
        vm.prank(approvers[0]);
        try pots.approve(id) {} catch { reverted = true; }
        _record(A_DOUBLE_APPROVE, reverted, pots.proposalInfo(id).approvals == approvalsBefore);

        // Revoking and approving again must not stack either.
        vm.prank(approvers[0]);
        pots.revokeApproval(id);
        vm.prank(approvers[0]);
        pots.approve(id);
        _record(A_DOUBLE_APPROVE, false, pots.proposalInfo(id).approvals == approvalsBefore);

        vm.prank(approvers[0]);
        pots.cancelProposal(id);
    }

    /// @notice Approving a proposal that is cancelled, and one that has run
    /// past its seven day window.
    function attackApproveDeadProposal(uint256 seed) public {
        (bool ok, uint256 potId) = _openPot(seed);
        if (!ok) return;
        _ensureFunded(potId, 10_000000);

        // Cancelled.
        vm.prank(approvers[0]);
        uint256 cancelled = pots.proposePayout(potId, 0, 1_000000);
        proposalIds.push(cancelled);
        vm.prank(approvers[0]);
        pots.cancelProposal(cancelled);

        uint256 destBalance = token.balanceOf(allDestinations[potId * 2]);
        bool reverted;
        vm.prank(approvers[1]);
        try pots.approve(cancelled) {} catch { reverted = true; }
        _record(
            A_DEAD_PROPOSAL,
            reverted,
            pots.proposalInfo(cancelled).status == NivPayPots.ProposalStatus.Cancelled
                && token.balanceOf(allDestinations[potId * 2]) == destBalance
        );

        // Expired.
        vm.prank(approvers[0]);
        uint256 stale = pots.proposePayout(potId, 0, 1_000000);
        proposalIds.push(stale);
        vm.warp(block.timestamp + 7 days + 1);

        destBalance = token.balanceOf(allDestinations[potId * 2]);
        reverted = false;
        vm.prank(approvers[1]);
        try pots.approve(stale) {} catch { reverted = true; }
        _record(
            A_DEAD_PROPOSAL,
            reverted,
            pots.proposalInfo(stale).status == NivPayPots.ProposalStatus.Expired
                && token.balanceOf(allDestinations[potId * 2]) == destBalance
        );
    }

    /// @notice One approver trying to lift a freeze alone, when it takes two.
    function attackSoloUnfreeze(uint256 seed) public {
        (bool ok, uint256 potId) = _openPot(seed);
        if (!ok) return;

        vm.prank(approvers[2]);
        pots.freeze(potId);

        // Proposing an unfreeze is legal. Achieving one alone is not.
        vm.prank(approvers[0]);
        uint256 id = pots.proposeUnfreeze(potId);
        proposalIds.push(id);
        _record(A_SOLO_UNFREEZE, false, pots.getPot(potId).frozen);

        // Nor can the attacker help.
        bool reverted;
        vm.prank(attacker);
        try pots.approve(id) {} catch { reverted = true; }
        _record(A_SOLO_UNFREEZE, reverted, pots.getPot(potId).frozen);

        // While frozen, exits must still work for anyone holding shares.
        for (uint256 i = 0; i < holderCount(); ++i) {
            uint256 held = pots.sharesOf(potId, holderAt(i));
            if (held == 0) continue;
            vm.prank(holderAt(i));
            uint256 got = pots.exit(potId, held);
            gExited[potId] += got;
            break;
        }

        // Put it back with a real threshold, so the run continues.
        vm.prank(approvers[1]);
        pots.approve(id);
        require(!pots.getPot(potId).frozen, "threshold unfreeze should have worked");
    }

    /// @notice One approver trying to close early alone, when it takes two.
    function attackSoloClose(uint256 seed) public {
        (bool ok, uint256 potId) = _openPot(seed);
        if (!ok) return;

        vm.prank(approvers[0]);
        uint256 id = pots.proposeClose(potId);
        proposalIds.push(id);
        _record(A_SOLO_CLOSE, false, !pots.getPot(potId).closed);

        bool reverted;
        vm.prank(attacker);
        try pots.approve(id) {} catch { reverted = true; }
        _record(A_SOLO_CLOSE, reverted, !pots.getPot(potId).closed);

        // Nobody can force the end time forward either.
        reverted = false;
        vm.prank(attacker);
        try pots.closePot(potId) {} catch { reverted = true; }
        _record(A_SOLO_CLOSE, reverted, !pots.getPot(potId).closed);

        vm.prank(approvers[0]);
        pots.cancelProposal(id);
    }

    /// @notice Redeeming more than the caller holds. Nothing here may move a
    /// single unit: every attempt asks for more than the caller owns, or asks
    /// as somebody who owns nothing at all.
    function attackOverExit(uint256 seed) public {
        uint256 potId = _pot(seed);

        for (uint256 i = 0; i < holderCount(); ++i) {
            address who = holderAt(i);
            uint256 held = pots.sharesOf(potId, who);
            uint256 assetsBefore = pots.getPot(potId).totalAssets;
            bool reverted;

            if (held == 0) {
                // Owns nothing, so even one share must be refused.
                vm.prank(who);
                try pots.exit(potId, 1) {} catch { reverted = true; }
            } else {
                // Owns something, so one more than that must be refused.
                vm.prank(who);
                try pots.exit(potId, held + 1) {} catch { reverted = true; }
            }

            _record(
                A_OVER_EXIT,
                reverted,
                pots.sharesOf(potId, who) == held && pots.getPot(potId).totalAssets == assetsBefore
            );
        }

        // Claiming as somebody with no shares, which is refused whether the pot
        // is open or closed.
        for (uint256 i = 0; i < holderCount(); ++i) {
            address who = holderAt(i);
            if (pots.sharesOf(potId, who) != 0) continue;
            uint256 assetsBefore = pots.getPot(potId).totalAssets;
            bool reverted;
            vm.prank(who);
            try pots.claim(potId) {} catch { reverted = true; }
            _record(
                A_OVER_EXIT,
                reverted,
                pots.sharesOf(potId, who) == 0 && pots.getPot(potId).totalAssets == assetsBefore
            );
            break;
        }
    }

    /// @notice Funding a pot that is closed, and one that is frozen.
    function attackFundWhenShut(uint256 seed) public {
        // Closed: the sacrificial pot, closed once and then left that way.
        uint256 shut = potIds[SACRIFICIAL_POT];
        if (!pots.getPot(shut).closed) {
            vm.prank(approvers[0]);
            uint256 closeId = pots.proposeClose(shut);
            vm.prank(approvers[1]);
            pots.approve(closeId);
        }
        uint256 assetsBefore = pots.getPot(shut).totalAssets;
        bool reverted;
        vm.prank(attacker);
        try pots.fund(shut, 1_000000) {} catch { reverted = true; }
        _record(A_FUND_WHEN_SHUT, reverted, pots.getPot(shut).totalAssets == assetsBefore);

        // Frozen.
        (bool ok, uint256 potId) = _openPot(seed);
        if (!ok) return;
        vm.prank(approvers[2]);
        pots.freeze(potId);

        assetsBefore = pots.getPot(potId).totalAssets;
        reverted = false;
        vm.prank(attacker);
        try pots.fund(potId, 1_000000) {} catch { reverted = true; }
        _record(A_FUND_WHEN_SHUT, reverted, pots.getPot(potId).totalAssets == assetsBefore);

        // A payout must not slip through a freeze either.
        reverted = false;
        vm.prank(approvers[0]);
        try pots.proposePayout(potId, 0, 1_000000) {} catch { reverted = true; }
        _record(A_FUND_WHEN_SHUT, reverted, pots.getPot(potId).totalAssets == assetsBefore);

        vm.prank(approvers[0]);
        uint256 unfreezeId = pots.proposeUnfreeze(potId);
        vm.prank(approvers[1]);
        pots.approve(unfreezeId);
    }

    /// @notice Spending one pot's shares against another pot.
    ///
    /// Picks a pot the attacker already holds a position in, or funds one it
    /// can, rather than taking whatever the seed lands on. The seed used to
    /// pick blindly and skip whenever that pot happened to be closed or
    /// frozen, which left this rule untested.
    function attackCrossPotShares(uint256 seed) public {
        uint256 from = type(uint256).max;

        // A pot the attacker already holds shares in.
        for (uint256 i = 0; i < LIVE_POTS; ++i) {
            uint256 cand = potIds[(seed + i) % LIVE_POTS];
            if (pots.sharesOf(cand, attacker) > 0) {
                from = cand;
                break;
            }
        }

        if (from == type(uint256).max && pots.sharesOf(potIds[ARENA_POT], attacker) > 0) {
            from = potIds[ARENA_POT];
        }

        // Otherwise take a position in one that will accept funding.
        if (from == type(uint256).max) {
            (bool ok, uint256 openPot) = _openPot(seed);
            if (!ok) return;
            vm.prank(attacker);
            pots.fund(openPot, 100_000000);
            gFunded[openPot] += 100_000000;
            from = openPot;
        }

        uint256 held = pots.sharesOf(from, attacker);
        if (held == 0) return;

        // Any other pot will do as the target, closed ones included: an exit
        // is allowed in every pot state, so the only thing that may stop this
        // is the shares belonging to a different pot.
        uint256 to = type(uint256).max;
        for (uint256 i = 0; i < potIds.length; ++i) {
            uint256 cand = potIds[(seed + i) % potIds.length];
            if (cand != from) {
                to = cand;
                break;
            }
        }
        if (to == type(uint256).max) return;

        uint256 sharesInTarget = pots.sharesOf(to, attacker);
        uint256 targetAssets = pots.getPot(to).totalAssets;
        uint256 sharesInSource = pots.sharesOf(from, attacker);

        // Ask the target pot for everything the attacker owns there plus the
        // whole position it holds in the other pot. If a share in one pot were
        // spendable in another, exactly this would go through. Asking for just
        // the other position would not test anything once the attacker has
        // funded both pots, because that can be a perfectly legal exit of
        // shares it really does own here.
        bool reverted;
        vm.prank(attacker);
        try pots.exit(to, sharesInTarget + held) {} catch { reverted = true; }

        _record(
            A_CROSS_POT_SHARES,
            reverted,
            pots.sharesOf(to, attacker) == sharesInTarget && pots.sharesOf(from, attacker) == sharesInSource
                && pots.getPot(to).totalAssets == targetAssets
        );
    }

    /// @notice Every category in one call. Running the whole set together is
    /// what makes the counts meaningful: a category can never sit at zero just
    /// because the fuzzer happened not to pick its selector.
    function attackSweep(uint256 seed) public {
        attackNonApproverProposes(seed);
        attackPayoutToUnlistedDestination(seed);
        attackPayoutOverCap(seed);
        attackDoubleApprove(seed);
        attackApproveDeadProposal(seed);
        attackSoloUnfreeze(seed);
        attackSoloClose(seed);
        attackOverExit(seed);
        attackFundWhenShut(seed);
        attackCrossPotShares(seed);
    }

    function totalAttempted() external view returns (uint256 total) {
        for (uint8 i = 0; i < ATTACK_CATEGORIES; ++i) {
            total += attempted[i];
        }
    }

    function totalBreached() external view returns (uint256 total) {
        for (uint8 i = 0; i < ATTACK_CATEGORIES; ++i) {
            total += breached[i];
        }
    }
}
