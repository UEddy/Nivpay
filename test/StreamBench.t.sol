// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test, console} from "forge-std/Test.sol";
import {MockStable} from "../src/MockStable.sol";
import {StreamBench} from "../src/StreamBench.sol";

/// @title StreamBenchGas
/// @notice Measures settlement gas for the three NivPay settlement variants and
///         writes the raw numbers to bench/gas.json for the cost model script.
///
/// Two things this harness is careful about, because both change the answer by
/// more than the difference between the variants:
///
///  1. Cold versus warm destination storage. The first settlement writes a
///     payee balance slot from zero, which costs 20000 gas plus the 2100 cold
///     access surcharge. Every later settlement writes an already nonzero slot,
///     which costs 2900 plus 2100. Quoting the first number would overstate
///     steady state cost by roughly 17000 gas per stream, so both are measured
///     and the steady state number is the one that feeds the cost model.
///
///  2. Calldata. A batch of N stream ids is N words of calldata, which is not
///     free and is not visible in a gasleft() delta around an internal call.
///     Intrinsic gas and calldata gas are computed separately and added, so the
///     reported per stream figure is what a real transaction would be charged.
contract StreamBenchGas is Test {
    address internal constant PAYER = address(0xBEEF);

    /// @dev 3 micro units per second is about 7.78 dollars per 30 day month at 6
    ///      decimals, close enough to the 9 dollar reference subscription. The
    ///      rate value does not affect gas as long as the accrued amount is
    ///      nonzero, which it is at every cadence measured here.
    uint96 internal constant RATE = 3;

    /// @dev Seconds of accrual before each measured settlement.
    uint256 internal constant ELAPSED = 3600;

    /// @dev Monad mainnet block gas limit, confirmed from docs.monad.xyz and
    ///      from eth_getBlockByNumber on https://rpc.monad.xyz (chain id 143).
    uint256 internal constant MONAD_BLOCK_GAS_LIMIT = 150_000_000;

    string internal rows;
    uint256 internal rowCount;

    function setUp() public {
        vm.warp(1_000_000);
    }

    // -----------------------------------------------------------------------
    // Harness
    // -----------------------------------------------------------------------

    function _deploy() internal returns (MockStable token, StreamBench bench) {
        token = new MockStable();
        bench = new StreamBench(token);
        // Variant A pays out of the contract balance. Fund it generously so no
        // measurement is distorted by a balance slot going to zero.
        token.mint(address(bench), type(uint128).max);
    }

    /// @dev Creates `n` streams where each distinct payee owns `fanIn` of them,
    ///      laid out so that ids are already grouped by payee. Variant C needs
    ///      that grouping; giving B and C the identical layout keeps the
    ///      comparison honest.
    function _seed(StreamBench bench, uint256 n, uint256 fanIn) internal returns (uint256[] memory ids) {
        address[] memory payees = new address[](n);
        for (uint256 i = 0; i < n; ++i) {
            payees[i] = address(uint160(0x100000 + (i / fanIn)));
        }
        bench.createStreams(PAYER, payees, RATE);

        ids = new uint256[](n);
        for (uint256 i = 0; i < n; ++i) {
            ids[i] = i;
        }
    }

    function _call(StreamBench bench, uint8 variant, uint256[] memory ids) internal returns (uint256 gasUsed) {
        bytes memory data = _encode(variant, ids);
        address target = address(bench);
        uint256 before = gasleft();
        (bool ok,) = target.call(data);
        gasUsed = before - gasleft();
        require(ok, "settle failed");
    }

    function _encode(uint8 variant, uint256[] memory ids) internal pure returns (bytes memory) {
        if (variant == 0) return abi.encodeWithSelector(StreamBench.settleA.selector, ids);
        if (variant == 1) return abi.encodeWithSelector(StreamBench.settleB.selector, ids);
        return abi.encodeWithSelector(StreamBench.settleC.selector, ids);
    }

    /// @dev Intrinsic calldata cost under the Cancun schedule: 4 gas per zero
    ///      byte, 16 per nonzero byte. Excludes the 21000 base, which is added
    ///      separately in the cost model because it amortises across the batch.
    function _calldataGas(bytes memory data) internal pure returns (uint256 g) {
        for (uint256 i = 0; i < data.length; ++i) {
            g += data[i] == 0 ? 4 : 16;
        }
    }

    function _variantName(uint8 v) internal pure returns (string memory) {
        if (v == 0) return "A_push_transfer";
        if (v == 1) return "B_pull_credit";
        return "C_pull_grouped";
    }

    function _record(
        uint8 variant,
        string memory regime,
        uint256 n,
        uint256 fanIn,
        uint256 execGas,
        uint256 cdGas
    ) internal {
        if (rowCount > 0) rows = string.concat(rows, ",\n");
        rows = string.concat(
            rows,
            '    {"variant": "',
            _variantName(variant),
            '", "regime": "',
            regime,
            '", "n": ',
            vm.toString(n),
            ', "fan_in": ',
            vm.toString(fanIn),
            ', "exec_gas": ',
            vm.toString(execGas),
            ', "calldata_gas": ',
            vm.toString(cdGas),
            "}"
        );
        rowCount++;
    }

    // -----------------------------------------------------------------------
    // Main sweep
    // -----------------------------------------------------------------------

    function test_gasSweep() public {
        uint256[3] memory sizes = [uint256(100), 1000, 10000];
        uint256[2] memory fanIns = [uint256(1), 100];

        for (uint256 f = 0; f < fanIns.length; ++f) {
            for (uint256 s = 0; s < sizes.length; ++s) {
                for (uint8 v = 0; v < 3; ++v) {
                    _measure(v, sizes[s], fanIns[f]);
                }
            }
        }

        _measureWithdraw();

        string memory json = string.concat(
            "{\n",
            '  "elapsed_seconds": ', vm.toString(ELAPSED), ",\n",
            '  "monad_block_gas_limit": ', vm.toString(MONAD_BLOCK_GAS_LIMIT), ",\n",
            '  "tx_base_gas": 21000,\n',
            '  "rows": [\n',
            rows,
            "\n  ]\n}\n"
        );
        vm.writeFile("bench/gas.json", json);
        console.log("wrote bench/gas.json with %s rows", rowCount);
    }

    /// @dev Runs one configuration twice against a fresh deployment. The first
    ///      settlement writes destination slots from zero (cold), the second
    ///      writes them nonzero to nonzero (steady state).
    function _measure(uint8 variant, uint256 n, uint256 fanIn) internal {
        (MockStable token, StreamBench bench) = _deploy();
        uint256[] memory ids = _seed(bench, n, fanIn);
        uint256 cdGas = _calldataGas(_encode(variant, ids));

        // A forge test body is a single transaction, so every slot touched by
        // _seed is still warm under EIP-2929 when the measured call runs. Real
        // settlements are separate transactions that start cold. Without the
        // cool() calls below, every slot reads at 100 gas instead of 2100 and
        // the whole benchmark understates cost by roughly an order of magnitude.
        vm.warp(block.timestamp + ELAPSED);
        vm.cool(address(bench));
        vm.cool(address(token));
        uint256 firstGas = _call(bench, variant, ids);
        _record(variant, "first", n, fanIn, firstGas, cdGas);

        // Steady state: destination slots are now nonzero, but cold again, which
        // is exactly the situation on every settlement after the first.
        vm.warp(block.timestamp + ELAPSED);
        vm.cool(address(bench));
        vm.cool(address(token));
        uint256 steadyGas = _call(bench, variant, ids);
        _record(variant, "steady", n, fanIn, steadyGas, cdGas);

        console.log(
            string.concat(
                _variantName(variant),
                " n=",
                vm.toString(n),
                " fanIn=",
                vm.toString(fanIn),
                " first=",
                vm.toString(firstGas),
                " steady=",
                vm.toString(steadyGas),
                " calldata=",
                vm.toString(cdGas)
            )
        );
    }

    /// @dev The pull variants do not remove the transfer cost, they move it to
    ///      the payee. Measured once so the report can amortise it rather than
    ///      pretend it is zero.
    function _measureWithdraw() internal {
        (MockStable token, StreamBench bench) = _deploy();
        uint256[] memory ids = _seed(bench, 100, 1);
        vm.warp(block.timestamp + ELAPSED);
        bench.settleB(ids);

        address payee = address(uint160(0x100000));
        vm.cool(address(bench));
        vm.cool(address(token));
        vm.prank(payee);
        uint256 before = gasleft();
        bench.withdraw();
        uint256 used = before - gasleft();

        _record(1, "withdraw", 1, 1, used, _calldataGas(abi.encodeWithSelector(StreamBench.withdraw.selector)));
        console.log("withdraw gas = %s", used);
    }

    // -----------------------------------------------------------------------
    // Correctness. The variants must agree, otherwise the gas comparison is
    // comparing three different things.
    // -----------------------------------------------------------------------

    function test_variantsAgreeOnPayout() public {
        uint256 n = 50;
        uint256 fanIn = 10;

        (MockStable tokenA, StreamBench benchA) = _deploy();
        uint256[] memory idsA = _seed(benchA, n, fanIn);
        (, StreamBench benchB) = _deploy();
        _seed(benchB, n, fanIn);
        (, StreamBench benchC) = _deploy();
        _seed(benchC, n, fanIn);

        vm.warp(block.timestamp + ELAPSED);

        benchA.settleA(idsA);
        benchB.settleB(idsA);
        benchC.settleC(idsA);

        uint256 expectedPerStream = ELAPSED * RATE;
        for (uint256 p = 0; p < n / fanIn; ++p) {
            address payee = address(uint160(0x100000 + p));
            uint256 expected = expectedPerStream * fanIn;
            assertEq(tokenA.balanceOf(payee), expected, "A payout");
            assertEq(benchB.balances(payee), expected, "B credit");
            assertEq(benchC.balances(payee), expected, "C credit");
        }
    }

    function test_groupingDoesNotChangeTotals() public {
        // Variant C must be correct even when the batch is not grouped, it just
        // loses the saving. Verifying this stops the grouped measurement from
        // being a measurement of a broken function.
        uint256 n = 20;
        (, StreamBench bench) = _deploy();
        _seed(bench, n, 2);

        uint256[] memory shuffled = new uint256[](n);
        for (uint256 i = 0; i < n; ++i) {
            shuffled[i] = (i * 7) % n;
        }

        vm.warp(block.timestamp + ELAPSED);
        bench.settleC(shuffled);

        uint256 expected = ELAPSED * RATE * 2;
        for (uint256 p = 0; p < n / 2; ++p) {
            assertEq(bench.balances(address(uint160(0x100000 + p))), expected, "ungrouped C total");
        }
    }

    function test_settlementIsIdempotentWithinSameTimestamp() public {
        (, StreamBench bench) = _deploy();
        uint256[] memory ids = _seed(bench, 10, 1);

        vm.warp(block.timestamp + ELAPSED);
        bench.settleB(ids);
        uint256 afterFirst = bench.balances(address(uint160(0x100000)));
        bench.settleB(ids);
        assertEq(bench.balances(address(uint160(0x100000))), afterFirst, "double settle must be a no-op");
    }
}
