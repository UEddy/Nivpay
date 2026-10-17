// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {NivPayPotsV2} from "../../src/NivPayPotsV2.sol";
import {MockAUSD} from "../mocks/MockAUSD.sol";

/// @notice Drives NivPayPotsV2 through random sequences of funding, exits,
/// claims, payments, freezes, closes and every kind of change: proposed,
/// agreed, taken back, applied early and late, withdrawn, overridden and
/// lapsed, and tried by deciders of other pots. It keeps its own books of
/// every pot's payees and limits, changed only when it has seen a change
/// apply, and checks every payment against those books, not the contract's:
/// a payment the contract let through to a payee or above a limit the handler
/// never saw applied is a violation.
///
/// Three pots, each with its own deciders, so a check made against the wrong
/// pot shows: two of three (pots 0 and 1) and one of two (pot 2), where a
/// proposal agrees, and a narrowing applies, in the call that makes it.
///
/// Violations are counted, not asserted, because fail_on_revert is off and an
/// assertion inside a handler action would be swallowed.
contract PotsV2Handler is Test {
    NivPayPotsV2 public immutable pots;
    MockAUSD public immutable token;

    address[] public funders;
    uint256[] public potIds;
    mapping(uint256 => address[]) internal _deciders;

    uint256 public constant POTS = 3;
    uint256 private constant MAX_FUND = 100_000_000000;

    // Money books, per pot.
    mapping(uint256 => uint256) public gFunded;
    mapping(uint256 => uint256) public gPaid;
    mapping(uint256 => uint256) public gFees;
    mapping(uint256 => uint256) public gOut;

    // Payee books, per pot: only what the handler has seen apply.
    mapping(uint256 => uint256) public gPayees;
    mapping(uint256 => mapping(uint256 => uint256)) public gCap;
    mapping(uint256 => mapping(uint256 => uint256)) public gSpent;
    mapping(uint256 => mapping(uint256 => bool)) public gRemoved;
    mapping(uint256 => mapping(uint256 => address)) public gTo;
    mapping(uint256 => uint64) public gEnd;
    /// Each payee's narrowings (lowered or removed) seen so far, to tell a raise agreed before one from one agreed after.
    mapping(uint256 => mapping(uint256 => uint256)) public gNarrowings;

    struct Known {
        uint256 potId;
        NivPayPotsV2.ChangeKind kind;
        uint16 destIndex;
        address to;
        uint256 limit;
        uint64 endTime;
        address proposer;
        bool agreed;
        uint256 agreedAt;
        uint256 narrowingsAtAgree;
    }

    uint256[] public changeIds;
    mapping(uint256 => Known) public known;

    uint256 public paidToUnapplied;
    uint256 public paidAboveLimit;
    uint256 public appliedEarly;
    uint256 public appliedLate;
    uint256 public appliedWhileFrozenOrClosed;
    uint256 public changedClosedPot;
    uint256 public crossPotAccepted;
    uint256 public raiseUndidNarrowing;
    uint256 public exitsRefused;
    uint256 public payments;
    uint256 public applies;

    constructor(NivPayPotsV2 pots_, MockAUSD token_) {
        pots = pots_;
        token = token_;
        for (uint256 i = 0; i < 4; ++i) {
            address f = makeAddr(string.concat("funder", vm.toString(i)));
            funders.push(f);
            vm.prank(f);
            token.approve(address(pots), type(uint256).max);
        }
        uint8[3] memory sizes = [3, 3, 2];
        uint8[3] memory rules = [2, 2, 1];
        uint256 n;
        for (uint256 p = 0; p < POTS; ++p) {
            address[] memory who = new address[](sizes[p]);
            for (uint256 i = 0; i < sizes[p]; ++i) {
                who[i] = makeAddr(string.concat("decider", vm.toString(n++)));
            }
            address[] memory ds = new address[](2);
            bytes32[] memory labels = new bytes32[](2);
            uint256[] memory caps = new uint256[](2);
            for (uint256 i = 0; i < 2; ++i) {
                ds[i] = makeAddr(string.concat("payee", vm.toString(p), "-", vm.toString(i)));
                labels[i] = "Payee";
                caps[i] = 50_000_000000;
            }
            uint64 end = uint64(block.timestamp + 120 days);
            uint256 id = pots.createPot("Handler", who, rules[p], ds, labels, caps, end);
            potIds.push(id);
            _deciders[id] = who;
            gPayees[id] = 2;
            gEnd[id] = end;
            for (uint256 i = 0; i < 2; ++i) {
                gCap[id][i] = caps[i];
                gTo[id][i] = ds[i];
            }
        }
    }

    function funderCount() external view returns (uint256) {
        return funders.length;
    }

    function changeCount() external view returns (uint256) {
        return changeIds.length;
    }

    function decidersOf(uint256 potId) external view returns (address[] memory) {
        return _deciders[potId];
    }

    function _pot(uint256 seed) internal view returns (uint256) {
        return potIds[seed % potIds.length];
    }

    function _decider(uint256 potId, uint256 seed) internal view returns (address) {
        address[] storage who = _deciders[potId];
        return who[seed % who.length];
    }

    // ---------------------------------------------------------------------
    // Money
    // ---------------------------------------------------------------------

    function fund(uint256 who, uint256 potSeed, uint256 amount) external {
        uint256 potId = _pot(potSeed);
        amount = bound(amount, 1_000000, MAX_FUND);
        address f = funders[who % funders.length];
        token.mint(f, amount);
        vm.prank(f);
        try pots.fund(potId, amount) {
            gFunded[potId] += amount;
        } catch {}
    }

    function exitSome(uint256 who, uint256 potSeed, uint256 pct) external {
        uint256 potId = _pot(potSeed);
        address f = funders[who % funders.length];
        uint256 held = pots.sharesOf(potId, f);
        if (held == 0) return;
        uint256 burn = (held * bound(pct, 1, 100)) / 100;
        if (burn == 0) burn = held;
        vm.prank(f);
        try pots.exit(potId, burn) returns (uint256 got) {
            gOut[potId] += got;
        } catch {
            // Exits are never blocked, in any state, during any wait.
            exitsRefused++;
        }
    }

    function claimAll(uint256 who, uint256 potSeed) external {
        uint256 potId = _pot(potSeed);
        address f = funders[who % funders.length];
        if (!pots.getPot(potId).closed || pots.sharesOf(potId, f) == 0) return;
        vm.prank(f);
        try pots.claim(potId) returns (uint256 got) {
            gOut[potId] += got;
        } catch {
            exitsRefused++;
        }
    }

    /// @notice A payment to any index, applied or not yet, of any amount: the
    /// contract decides, and the handler's own books judge what it decided.
    function pay(uint256 potSeed, uint256 destSeed, uint256 amount) external {
        uint256 potId = _pot(potSeed);
        // Mostly a payee that is there; one in eight is one past the end,
        // where a payee waiting to be added would go.
        uint16 index = uint16(destSeed % 8 == 0 ? gPayees[potId] : destSeed % gPayees[potId]);
        // Mostly payments a pot can make; sometimes far above any limit.
        amount = amount % 8 == 0 ? bound(amount, 1, 200_000_000000) : bound(amount, 1, 5_000_000000);
        uint256 assetsBefore = pots.getPot(potId).totalAssets;
        vm.prank(_deciders[potId][0]);
        uint256 id;
        try pots.proposePayout(potId, index, amount) returns (uint256 x) {
            id = x;
        } catch {
            return;
        }
        // A one of n pot pays in the proposal itself.
        if (pots.proposalInfo(id).status == NivPayPotsV2.ProposalStatus.Executed) {
            _paid(potId, index, amount, assetsBefore);
            return;
        }
        // One in three waits for its second yes (payLater), so changes can
        // land between a payment's proposal and its yes.
        if (amount % 3 == 0) {
            waitingPayments.push(id);
            return;
        }
        _secondYes(id, potId, index, amount);
    }

    uint256[] public waitingPayments;

    /// @notice The second yes for a payment proposed earlier, with whatever
    /// changes have applied since.
    function payLater(uint256 seed) external {
        if (waitingPayments.length == 0) return;
        uint256 id = waitingPayments[seed % waitingPayments.length];
        NivPayPotsV2.ProposalView memory v = pots.proposalInfo(id);
        if (v.status != NivPayPotsV2.ProposalStatus.Pending) return;
        _secondYes(id, v.potId, v.destIndex, v.amount);
    }

    function _secondYes(uint256 id, uint256 potId, uint16 index, uint256 amount) internal {
        uint256 assetsBefore = pots.getPot(potId).totalAssets;
        vm.prank(_deciders[potId][1]);
        try pots.approve(id) {
            _paid(potId, index, amount, assetsBefore);
        } catch {}
    }

    function _paid(uint256 potId, uint16 index, uint256 amount, uint256 assetsBefore) internal {
        payments++;
        uint256 fee = assetsBefore - pots.getPot(potId).totalAssets - amount;
        if (index >= gPayees[potId] || gRemoved[potId][index]) paidToUnapplied++;
        else if (gSpent[potId][index] + amount > gCap[potId][index]) paidAboveLimit++;
        gSpent[potId][index] += amount;
        gPaid[potId] += amount;
        gFees[potId] += fee;
    }

    /// @notice Unfreezes a frozen pot; freezes one only one time in four, so
    /// pots spend most of a run unfrozen and the freeze rules still come up.
    function freezeOrUnfreeze(uint256 potSeed, uint256 dice) external {
        uint256 potId = _pot(potSeed);
        address[] storage who = _deciders[potId];
        if (!pots.getPot(potId).frozen) {
            if (dice % 4 != 0) return;
            vm.prank(who[who.length - 1]);
            try pots.freeze(potId) {} catch {}
            return;
        }
        vm.prank(who[0]);
        try pots.proposeUnfreeze(potId) returns (uint256 id) {
            if (pots.proposalInfo(id).status != NivPayPotsV2.ProposalStatus.Pending) return;
            vm.prank(who[1]);
            try pots.approve(id) {} catch {}
        } catch {}
    }

    /// @notice Rarely, so most runs keep their pots open for changes.
    function closeEarly(uint256 potSeed, uint256 dice) external {
        if (dice % 25 != 0) return;
        uint256 potId = _pot(potSeed);
        vm.prank(_deciders[potId][0]);
        try pots.proposeClose(potId) returns (uint256 id) {
            if (pots.proposalInfo(id).status != NivPayPotsV2.ProposalStatus.Pending) return;
            vm.prank(_deciders[potId][1]);
            try pots.approve(id) {} catch {}
        } catch {}
    }

    function warp(uint256 secs) external {
        vm.warp(block.timestamp + bound(secs, 1 minutes, 4 days));
    }

    // ---------------------------------------------------------------------
    // Changes
    // ---------------------------------------------------------------------

    function propose(uint256 deciderSeed, uint256 potSeed, uint256 kindSeed, uint256 destSeed, uint256 value) external {
        uint256 potId = _pot(potSeed);
        _propose(potId, _decider(potId, deciderSeed), kindSeed, destSeed, value);
    }

    function _propose(uint256 potId, address d, uint256 kindSeed, uint256 destSeed, uint256 value) internal returns (bool ok) {
        uint256 kind = kindSeed % 5;
        uint16 index = uint16(destSeed % (gPayees[potId] + 1));
        // Mostly a limit that fits the kind, so most proposals are real ones;
        // one in eight is any number, so the refusals are tried too.
        uint256 limit = bound(value, 1, 80_000_000000);
        if (value % 8 != 0 && index < gPayees[potId]) {
            uint256 cap = gCap[potId][index];
            if (kind == 1) limit = cap + bound(value, 1, cap);
            if (kind == 3 && cap > gSpent[potId][index] + 1) limit = bound(value, gSpent[potId][index] + 1, cap - 1);
        }
        uint64 end = uint64(gEnd[potId] + bound(value, 1, 30 days));
        address to = makeAddr(string.concat("new", vm.toString(changeIds.length)));

        bool closed = pots.getPot(potId).closed;
        uint256 count = pots.changeCount();
        // Recorded before the call: a one of n narrowing applies inside it, and is booked from this.
        known[count] = Known({
            potId: potId,
            kind: NivPayPotsV2.ChangeKind(kind),
            destIndex: index,
            to: to,
            limit: limit,
            endTime: end,
            proposer: d,
            agreed: false,
            agreedAt: 0,
            narrowingsAtAgree: 0
        });
        vm.prank(d);
        if (kind == 0) {
            try pots.proposeAddPayee(potId, to, "New", limit) {} catch {
                return false;
            }
        } else if (kind == 1) {
            try pots.proposeRaiseLimit(potId, index, limit) {} catch {
                return false;
            }
        } else if (kind == 2) {
            try pots.proposeLaterClose(potId, end) {} catch {
                return false;
            }
        } else if (kind == 3) {
            try pots.proposeLowerLimit(potId, index, limit) {} catch {
                return false;
            }
        } else {
            try pots.proposeRemovePayee(potId, index) {} catch {
                return false;
            }
        }
        if (closed) changedClosedPot++;
        changeIds.push(count);
        _afterYes(count);
        return true;
    }

    /// @dev After a yes that may have agreed the change: book it if it applied, start its wait if it waits.
    function _afterYes(uint256 id) internal {
        NivPayPotsV2.ChangeView memory v = pots.changeInfo(id);
        if (v.status == NivPayPotsV2.ChangeStatus.Applied) {
            _booked(id, v.destIndex);
        } else if (v.status == NivPayPotsV2.ChangeStatus.Waiting) {
            Known storage k = known[id];
            k.agreed = true;
            k.agreedAt = block.timestamp;
            k.narrowingsAtAgree = gNarrowings[k.potId][k.destIndex];
        }
    }

    /// @dev From the seed on, the first change in `status`, so the actions
    /// that need one land on one rather than mostly reverting.
    function _find(uint256 seed, NivPayPotsV2.ChangeStatus status) internal view returns (bool, uint256) {
        uint256 n = changeIds.length;
        for (uint256 j = 0; j < n; ++j) {
            uint256 id = changeIds[(seed + j) % n];
            if (pots.changeInfo(id).status == status) return (true, id);
        }
        return (false, 0);
    }

    function approve(uint256 deciderSeed, uint256 changeSeed) external {
        (bool found, uint256 id) = _find(changeSeed, NivPayPotsV2.ChangeStatus.Pending);
        if (!found) return;
        uint256 potId = known[id].potId;
        address d = _decider(potId, deciderSeed);
        if (pots.hasApprovedChange(id, d)) d = _decider(potId, deciderSeed + 1);
        if (pots.hasApprovedChange(id, d)) d = _decider(potId, deciderSeed + 2);
        bool closed = pots.getPot(potId).closed;
        vm.prank(d);
        try pots.approveChange(id) {
            if (closed) changedClosedPot++;
            _afterYes(id);
        } catch {}
    }

    /// @notice A yes taken back from a change not yet agreed.
    function revoke(uint256 deciderSeed, uint256 changeSeed) external {
        (bool found, uint256 id) = _find(changeSeed, NivPayPotsV2.ChangeStatus.Pending);
        if (!found) return;
        address d = _decider(known[id].potId, deciderSeed);
        if (!pots.hasApprovedChange(id, d)) return;
        vm.prank(d);
        try pots.revokeChangeYes(id) {} catch {}
    }

    /// @notice A decider of another pot tries to propose on this one, and to
    /// say yes to its changes. Neither may ever work.
    function crossPot(uint256 potSeed, uint256 otherSeed, uint256 changeSeed, uint256 value) external {
        uint256 potId = _pot(potSeed);
        uint256 other = _pot(potSeed + 1 + (otherSeed % (POTS - 1)));
        address stranger = _decider(other, otherSeed);
        vm.prank(stranger);
        try pots.proposeLowerLimit(potId, 0, bound(value, 1, 1_000000)) {
            crossPotAccepted++;
        } catch {}
        (bool found, uint256 id) = _find(changeSeed, NivPayPotsV2.ChangeStatus.Pending);
        if (!found || known[id].potId == other) return;
        vm.prank(stranger);
        try pots.approveChange(id) {
            crossPotAccepted++;
        } catch {}
    }

    /// @notice Mostly a change that is ready; sometimes any change, so early,
    /// late, withdrawn, overridden and narrowing ones are tried too.
    function apply_(uint256 changeSeed, uint256 who) external {
        if (changeIds.length == 0) return;
        uint256 id = changeIds[changeSeed % changeIds.length];
        if (who % 4 != 0) {
            (bool found, uint256 ready) = _find(changeSeed, NivPayPotsV2.ChangeStatus.Ready);
            if (found) id = ready;
        }
        NivPayPotsV2.PotView memory before = pots.getPot(known[id].potId);
        vm.prank(funders[who % funders.length]);
        try pots.applyChange(id) {
            Known storage k = known[id];
            if (before.frozen || before.closed) appliedWhileFrozenOrClosed++;
            if (!k.agreed || block.timestamp < k.agreedAt + pots.EXIT_WINDOW()) appliedEarly++;
            if (block.timestamp > k.agreedAt + pots.EXIT_WINDOW() + pots.APPLY_PERIOD()) appliedLate++;
            if (k.kind == NivPayPotsV2.ChangeKind.RaiseLimit && gNarrowings[k.potId][k.destIndex] != k.narrowingsAtAgree) raiseUndidNarrowing++;
            _booked(id, pots.changeInfo(id).destIndex);
        } catch {}
    }

    function withdraw(uint256 changeSeed) external {
        if (changeIds.length == 0) return;
        uint256 id = changeIds[changeSeed % changeIds.length];
        vm.prank(known[id].proposer);
        try pots.withdrawChange(id) {} catch {}
    }

    function lapse(uint256 changeSeed) external {
        if (changeIds.length == 0) return;
        uint256 id = changeIds[changeSeed % changeIds.length];
        try pots.lapseChange(id) {} catch {}
    }

    /// @dev The handler's books change here and only here, from the change as
    /// the handler itself proposed it.
    function _booked(uint256 id, uint16 appliedIndex) internal {
        applies++;
        Known storage k = known[id];
        uint256 potId = k.potId;
        if (k.kind == NivPayPotsV2.ChangeKind.AddPayee) {
            uint256 i = gPayees[potId]++;
            if (i != appliedIndex) paidToUnapplied++;
            gCap[potId][i] = k.limit;
            gTo[potId][i] = k.to;
        } else if (k.kind == NivPayPotsV2.ChangeKind.LaterClose) {
            gEnd[potId] = k.endTime;
        } else if (k.kind == NivPayPotsV2.ChangeKind.RemovePayee) {
            gRemoved[potId][k.destIndex] = true;
            gNarrowings[potId][k.destIndex]++;
        } else {
            gCap[potId][k.destIndex] = k.limit;
            if (k.kind == NivPayPotsV2.ChangeKind.LowerLimit) gNarrowings[potId][k.destIndex]++;
        }
    }
}
