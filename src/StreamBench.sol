// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {MockStable} from "./MockStable.sol";

/// @title StreamBench
/// @notice Benchmark harness for NivPay settlement strategies. Three settlement
///         variants sit on top of one shared stream data model and one shared
///         accrual routine, so the only variable between them is where the
///         accrued value lands.
///
///         Variant A: push. ERC-20 transfer to the payee inside the loop.
///         Variant B: pull. Credit an internal balance per stream, payee withdraws.
///         Variant C: pull, grouped. Same as B, but the batch arrives grouped by
///                    payee so each payee balance slot is written once per batch
///                    instead of once per stream.
///
/// @dev This is not product code. There is no access control on settle, no
///      solvency check against the payer deposit, and no stream lifecycle beyond
///      an active flag. Adding those would add the same cost to all three
///      variants and would not change the comparison, so they are omitted to
///      keep the measurement clean.
contract StreamBench {
    /// @dev Two storage slots per stream.
    ///      slot 0: payer (160) + lastSettled (40) + active (8) = 208 bits
    ///      slot 1: payee (160) + ratePerSecond (96)            = 256 bits
    ///      Both slots are read on every settlement and slot 0 is written back,
    ///      so the floor cost per stream is 2 SLOAD + 1 SSTORE regardless of
    ///      which variant delivers the value.
    struct Stream {
        address payer;
        uint40 lastSettled;
        bool active;
        address payee;
        uint96 ratePerSecond;
    }

    MockStable public immutable token;

    mapping(uint256 => Stream) public streams;
    mapping(address => uint256) public balances;

    uint256 public nextStreamId;

    event StreamCreated(uint256 indexed id, address indexed payer, address indexed payee);
    event Settled(uint256 indexed id, uint256 amount);
    event Withdrawn(address indexed payee, uint256 amount);

    constructor(MockStable token_) {
        token = token_;
    }

    // -----------------------------------------------------------------------
    // Stream lifecycle
    // -----------------------------------------------------------------------

    function createStream(address payer, address payee, uint96 ratePerSecond) public returns (uint256 id) {
        id = nextStreamId++;
        streams[id] =
            Stream({payer: payer, lastSettled: uint40(block.timestamp), active: true, payee: payee, ratePerSecond: ratePerSecond});
        emit StreamCreated(id, payer, payee);
    }

    /// @notice Bulk creation helper so the test can stand up 10k streams without
    ///         10k separate transactions. Not part of any variant being measured.
    function createStreams(address payer, address[] calldata payees, uint96 ratePerSecond) external {
        uint256 len = payees.length;
        for (uint256 i = 0; i < len; ++i) {
            createStream(payer, payees[i], ratePerSecond);
        }
    }

    // -----------------------------------------------------------------------
    // Shared accrual. Identical for A, B and C.
    // -----------------------------------------------------------------------

    /// @dev Reads both stream slots, computes the amount owed since the last
    ///      settlement, and stamps the new settlement time. Returns the payee and
    ///      the amount so each variant can decide only where to put the value.
    ///      Every variant calls exactly this function, so accrual cost is a
    ///      constant across the three measurements.
    function _accrue(uint256 id) internal returns (address payee, uint256 amount) {
        Stream storage s = streams[id];
        if (!s.active) {
            return (address(0), 0);
        }
        uint256 last = s.lastSettled;
        uint256 nowTs = block.timestamp;
        unchecked {
            amount = (nowTs - last) * s.ratePerSecond;
        }
        payee = s.payee;
        s.lastSettled = uint40(nowTs);
    }

    // -----------------------------------------------------------------------
    // Variant A: eager push, one ERC-20 transfer per stream
    // -----------------------------------------------------------------------

    function settleA(uint256[] calldata ids) external {
        uint256 len = ids.length;
        for (uint256 i = 0; i < len; ++i) {
            (address payee, uint256 amount) = _accrue(ids[i]);
            if (amount != 0) {
                token.transfer(payee, amount);
            }
        }
    }

    // -----------------------------------------------------------------------
    // Variant B: lazy credit, one internal balance write per stream
    // -----------------------------------------------------------------------

    function settleB(uint256[] calldata ids) external {
        uint256 len = ids.length;
        for (uint256 i = 0; i < len; ++i) {
            (address payee, uint256 amount) = _accrue(ids[i]);
            if (amount != 0) {
                balances[payee] += amount;
            }
        }
    }

    // -----------------------------------------------------------------------
    // Variant C: lazy credit, batch pre-grouped by payee
    // -----------------------------------------------------------------------

    /// @notice Same as settleB, but expects `ids` to arrive grouped by payee so
    ///         that runs of consecutive ids share a payee. The accumulator is
    ///         flushed to storage only when the payee changes, so a payee with k
    ///         streams in the batch costs one balance write instead of k.
    /// @dev Grouping is a caller side responsibility. If the batch is ungrouped
    ///      the result is still correct, because every flush is an addition, but
    ///      the gas saving disappears and the cost converges on variant B.
    function settleC(uint256[] calldata ids) external {
        uint256 len = ids.length;
        if (len == 0) return;

        address current = address(0);
        uint256 pending = 0;

        for (uint256 i = 0; i < len; ++i) {
            (address payee, uint256 amount) = _accrue(ids[i]);
            if (payee == address(0)) continue;

            if (payee != current) {
                if (pending != 0) {
                    balances[current] += pending;
                }
                current = payee;
                pending = amount;
            } else {
                unchecked {
                    pending += amount;
                }
            }
        }

        if (pending != 0) {
            balances[current] += pending;
        }
    }

    // -----------------------------------------------------------------------
    // Withdrawal path for variants B and C
    // -----------------------------------------------------------------------

    function withdraw() external returns (uint256 amount) {
        amount = balances[msg.sender];
        if (amount == 0) return 0;
        balances[msg.sender] = 0;
        token.transfer(msg.sender, amount);
        emit Withdrawn(msg.sender, amount);
    }
}
