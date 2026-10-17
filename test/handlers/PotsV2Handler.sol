// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {NivPayPotsV2} from "../../src/NivPayPotsV2.sol";
import {MockAUSD} from "../mocks/MockAUSD.sol";

/// @notice Drives NivPayPotsV2 through random sequences of funding, exits,
/// claims, payments, freezes, closes and every kind of change: proposed,
/// agreed, applied early and late, withdrawn and lapsed. It keeps its own
/// books of every pot's payees and limits, changed only when it has seen a
/// change apply, and checks every payment against those books, not the
/// contract's: a payment the contract let through to a payee or above a
/// limit the handler never saw applied is a violation.
///
/// Violations are counted, not asserted, because fail_on_revert is off and an
/// assertion inside a handler action would be swallowed.
contract PotsV2Handler is Test {
    NivPayPotsV2 public immutable pots;
    MockAUSD public immutable token;

    address[] public funders;
    address[] public deciders;
    uint256[] public potIds;

    uint256 public constant POTS = 2;
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
    }

    uint256[] public changeIds;
    mapping(uint256 => Known) public known;

    uint256 public paidToUnapplied;
    uint256 public paidAboveLimit;
    uint256 public appliedEarly;
    uint256 public appliedLate;
    uint256 public appliedWhileFrozenOrClosed;
    uint256 public changedClosedPot;
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
        for (uint256 i = 0; i < 3; ++i) {
            deciders.push(makeAddr(string.concat("decider", vm.toString(i))));
        }
        for (uint256 p = 0; p < POTS; ++p) {
            address[] memory ds = new address[](2);
            bytes32[] memory labels = new bytes32[](2);
            uint256[] memory caps = new uint256[](2);
            for (uint256 i = 0; i < 2; ++i) {
                ds[i] = makeAddr(string.concat("payee", vm.toString(p), "-", vm.toString(i)));
                labels[i] = "Payee";
                caps[i] = 50_000_000000;
            }
            uint64 end = uint64(block.timestamp + 120 days);
            uint256 id = pots.createPot("Handler", deciders, 2, ds, labels, caps, end);
            potIds.push(id);
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

    function _pot(uint256 seed) internal view returns (uint256) {
        return potIds[seed % potIds.length];
    }

    function _decider(uint256 seed) internal view returns (address) {
        return deciders[seed % deciders.length];
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
        vm.prank(deciders[0]);
        uint256 id;
        try pots.proposePayout(potId, index, amount) returns (uint256 x) {
            id = x;
        } catch {
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
        vm.prank(deciders[1]);
        try pots.approve(id) {
            payments++;
            uint256 fee = assetsBefore - pots.getPot(potId).totalAssets - amount;
            if (index >= gPayees[potId] || gRemoved[potId][index]) paidToUnapplied++;
            else if (gSpent[potId][index] + amount > gCap[potId][index]) paidAboveLimit++;
            gSpent[potId][index] += amount;
            gPaid[potId] += amount;
            gFees[potId] += fee;
        } catch {}
    }

    /// @notice Unfreezes a frozen pot; freezes one only one time in four, so
    /// pots spend most of a run unfrozen and the freeze rules still come up.
    function freezeOrUnfreeze(uint256 potSeed, uint256 dice) external {
        uint256 potId = _pot(potSeed);
        if (!pots.getPot(potId).frozen) {
            if (dice % 4 != 0) return;
            vm.prank(deciders[2]);
            try pots.freeze(potId) {} catch {}
            return;
        }
        vm.prank(deciders[0]);
        try pots.proposeUnfreeze(potId) returns (uint256 id) {
            vm.prank(deciders[1]);
            try pots.approve(id) {} catch {}
        } catch {}
    }

    /// @notice Rarely, so most runs keep their pots open for changes.
    function closeEarly(uint256 potSeed, uint256 dice) external {
        if (dice % 25 != 0) return;
        uint256 potId = _pot(potSeed);
        vm.prank(deciders[0]);
        try pots.proposeClose(potId) returns (uint256 id) {
            vm.prank(deciders[1]);
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
        address d = _decider(deciderSeed);
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
        vm.prank(d);
        uint256 id;
        if (kind == 0) {
            try pots.proposeAddPayee(potId, to, "New", limit) returns (uint256 x) {
                id = x;
            } catch {
                return;
            }
        } else if (kind == 1) {
            try pots.proposeRaiseLimit(potId, index, limit) returns (uint256 x) {
                id = x;
            } catch {
                return;
            }
        } else if (kind == 2) {
            try pots.proposeLaterClose(potId, end) returns (uint256 x) {
                id = x;
            } catch {
                return;
            }
        } else if (kind == 3) {
            try pots.proposeLowerLimit(potId, index, limit) returns (uint256 x) {
                id = x;
            } catch {
                return;
            }
        } else {
            try pots.proposeRemovePayee(potId, index) returns (uint256 x) {
                id = x;
            } catch {
                return;
            }
        }
        if (closed) changedClosedPot++;
        changeIds.push(id);
        known[id] = Known({
            potId: potId,
            kind: NivPayPotsV2.ChangeKind(kind),
            destIndex: index,
            to: to,
            limit: limit,
            endTime: end,
            proposer: d,
            agreed: false,
            agreedAt: 0
        });
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
        address d = _decider(deciderSeed);
        if (pots.hasApprovedChange(id, d)) d = _decider(deciderSeed + 1);
        if (pots.hasApprovedChange(id, d)) d = _decider(deciderSeed + 2);
        bool closed = pots.getPot(known[id].potId).closed;
        vm.prank(d);
        try pots.approveChange(id) {
            if (closed) changedClosedPot++;
            NivPayPotsV2.ChangeView memory v = pots.changeInfo(id);
            if (v.status == NivPayPotsV2.ChangeStatus.Applied) {
                _booked(id, v.destIndex);
            } else if (v.status == NivPayPotsV2.ChangeStatus.Waiting) {
                known[id].agreed = true;
                known[id].agreedAt = block.timestamp;
            }
        } catch {}
    }

    /// @notice Mostly a change that is ready; sometimes any change, so early,
    /// late, withdrawn and narrowing ones are tried too.
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
        } else {
            gCap[potId][k.destIndex] = k.limit;
        }
    }
}
