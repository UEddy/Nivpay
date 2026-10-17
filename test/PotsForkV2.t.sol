// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {NivPayPotsV2} from "../src/NivPayPotsV2.sol";

/// @notice A V2 pot's whole life against the real AUSD on Monad testnet:
/// made, money in, a payment, a change proposed and agreed, someone taking
/// their part out during the window, the change applied after it, a payment
/// only the change allows, and every unit accounted for. Nothing here rests
/// on the mock token behaving like AUSD.
///
/// Skipped automatically when the fork cannot be created.
///
///     forge test --match-path test/PotsForkV2.t.sol -vv
contract PotsForkV2Test is Test {
    address internal constant AUSD = 0xa9012a055bd4e0eDfF8Ce09f960291C09D5322dC;
    uint256 internal constant MONAD_TESTNET_CHAIN_ID = 10143;
    uint256 internal constant ONE = 1_000000;

    IERC20 internal ausd = IERC20(AUSD);
    NivPayPotsV2 internal pots;
    bool internal forked;

    address internal idara = makeAddr("v2-idara");
    address internal ubong = makeAddr("v2-ubong");
    address internal aniekan = makeAddr("v2-aniekan");
    address internal caterer = makeAddr("v2-caterer");
    address internal feeRecipient = makeAddr("v2-feeRecipient");

    function setUp() public {
        try vm.createSelectFork("monad_testnet_public") {
            forked = true;
        } catch {
            return;
        }
        assertEq(block.chainid, MONAD_TESTNET_CHAIN_ID, "forked the wrong chain");
        assertEq(IERC20Metadata(AUSD).symbol(), "AUSD");
        // The real deployment's settings: 50 bps, a 50 AUSD fee cap, 72 hours.
        pots = new NivPayPotsV2(ausd, 50, 50 * ONE, feeRecipient, 72 hours, 7 days);
    }

    modifier onlyForked() {
        if (!forked) {
            vm.skip(true);
            return;
        }
        _;
    }

    // The run's books, kept here rather than on the stack.
    uint256 internal potId;
    uint256 internal raise;
    uint256 internal over;
    uint256 internal funded;
    uint256 internal paid;
    uint256 internal out;
    uint256 internal agreedAt;

    function test_fork_v2_wholeLifeOnRealAusd() public onlyForked {
        _make();
        _moneyInAndAPayment();
        _agreeARaise();
        _leaveDuringTheWindow();
        _applyAfterTheWindow();
        _everyUnitAccountedFor();
    }

    function _make() internal {
        address[] memory deciders = new address[](3);
        deciders[0] = idara;
        deciders[1] = ubong;
        deciders[2] = aniekan;
        address[] memory payees = new address[](1);
        payees[0] = caterer;
        bytes32[] memory labels = new bytes32[](1);
        labels[0] = "Caterer";
        uint256[] memory caps = new uint256[](1);
        caps[0] = 1000 * ONE;
        potId = pots.createPot("Mama's 60th", deciders, 2, payees, labels, caps, uint64(block.timestamp + 30 days));
    }

    function _moneyInAndAPayment() internal {
        _fund(idara, 900 * ONE);
        _fund(ubong, 400 * ONE);
        _fund(aniekan, 300 * ONE);
        funded = 1600 * ONE;
        paid = _pay(300 * ONE);
        assertEq(ausd.balanceOf(caterer), 300 * ONE);
    }

    /// A raise of the caterer to 1,200, agreed: it waits 72 hours, and a payment past the old limit is refused meanwhile.
    function _agreeARaise() internal {
        vm.prank(idara);
        raise = pots.proposeRaiseLimit(potId, 0, 1200 * ONE);
        vm.prank(ubong);
        pots.approveChange(raise);
        agreedAt = block.timestamp;
        assertEq(uint8(pots.changeInfo(raise).status), uint8(NivPayPotsV2.ChangeStatus.Waiting));
        vm.prank(idara);
        over = pots.proposePayout(potId, 0, 800 * ONE);
        vm.prank(ubong);
        vm.expectRevert(NivPayPotsV2.CapExceeded.selector);
        pots.approve(over);
    }

    /// Aniekan, who disagrees, takes their part out a day into the window.
    function _leaveDuringTheWindow() internal {
        vm.warp(agreedAt + 24 hours);
        (uint256 shares, uint256 worth) = pots.funderInfo(potId, aniekan);
        uint256 before = ausd.balanceOf(aniekan);
        vm.prank(aniekan);
        out = pots.exit(potId, shares);
        assertEq(out, worth, "the contract's own number");
        assertEq(ausd.balanceOf(aniekan) - before, out, "real AUSD arrived, to the unit");
    }

    function _applyAfterTheWindow() internal {
        // Not a second early.
        vm.warp(agreedAt + 72 hours - 1);
        vm.expectRevert(NivPayPotsV2.ChangeNotReady.selector);
        pots.applyChange(raise);
        // Applied at the window's end, by someone who doesn't decide.
        vm.warp(agreedAt + 72 hours);
        vm.prank(caterer);
        pots.applyChange(raise);
        (,, uint256 cap,,) = pots.getDestination(potId, 0);
        assertEq(cap, 1200 * ONE);
        // Now the payment the change allows goes through.
        vm.prank(ubong);
        pots.approve(over);
        paid += 800 * ONE;
    }

    function _everyUnitAccountedFor() internal {
        uint256 fees = pots.feesAccrued();
        assertEq(fees, _feeOf(300 * ONE) + _feeOf(800 * ONE), "fees");
        uint256 held = pots.getPot(potId).totalAssets;
        assertEq(funded, paid + fees + out + held, "in = paid + fees + out + held, to the unit");
        assertEq(ausd.balanceOf(address(pots)), held + fees, "the contract holds exactly the pot and the fees");
        assertEq(ausd.balanceOf(caterer), paid, "the caterer got exactly what was paid");
        // Whoever is left takes the rest out; at most rounding dust stays, and it stays in the pot.
        _exitAll(idara);
        _exitAll(ubong);
        uint256 dust = pots.getPot(potId).totalAssets;
        assertLe(dust, 2, "at most rounding dust stays, never more");
        assertEq(ausd.balanceOf(address(pots)), dust + fees);
    }

    function _fund(address who, uint256 amount) internal {
        _dealAusd(who, amount);
        vm.prank(who);
        ausd.approve(address(pots), amount);
        vm.prank(who);
        pots.fund(potId, amount);
    }

    function _pay(uint256 amount) internal returns (uint256) {
        vm.prank(idara);
        uint256 id = pots.proposePayout(potId, 0, amount);
        vm.prank(ubong);
        pots.approve(id);
        return amount;
    }

    function _exitAll(address who) internal {
        (uint256 shares, uint256 worth) = pots.funderInfo(potId, who);
        uint256 before = ausd.balanceOf(who);
        vm.prank(who);
        pots.exit(potId, shares);
        assertEq(ausd.balanceOf(who) - before, worth);
    }

    function _feeOf(uint256 amount) internal pure returns (uint256 fee) {
        fee = (amount * 50) / 10_000;
        if (fee > 50 * ONE) fee = 50 * ONE;
    }

    /// The same way test/PotsFork.t.sol credits real AUSD: find the balance slot and write it.
    function _dealAusd(address to, uint256 amount) internal {
        require(ausd.balanceOf(to) != amount, "pick a fresh address");
        vm.record();
        ausd.balanceOf(to);
        (bytes32[] memory reads,) = vm.accesses(AUSD);
        for (uint256 i = 0; i < reads.length; ++i) {
            bytes32 slot = reads[i];
            bytes32 previous = vm.load(AUSD, slot);
            if (_tryWrite(slot, bytes32((amount << 8) | (uint256(previous) & 0xff)), to, amount)) return;
            if (_tryWrite(slot, bytes32(amount), to, amount)) return;
            vm.store(AUSD, slot, previous);
        }
        revert("could not locate the AUSD balance slot");
    }

    function _tryWrite(bytes32 slot, bytes32 value, address to, uint256 amount) private returns (bool) {
        vm.store(AUSD, slot, value);
        (bool ok, bytes memory ret) = AUSD.staticcall(abi.encodeWithSignature("balanceOf(address)", to));
        return ok && ret.length == 32 && abi.decode(ret, (uint256)) == amount;
    }
}
