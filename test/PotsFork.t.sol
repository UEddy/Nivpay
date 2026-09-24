// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC20Permit} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Permit.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {NivPayPots} from "../src/NivPayPots.sol";

interface IAgoraFaucet {
    function requestFunds(address to) external;
    function token() external view returns (address);
    function faucetDripAmount() external view returns (uint256);
    function maxDripFrequency() external view returns (uint256);
    function maxAmountToOwn() external view returns (uint256);
}

/// @notice Runs the whole pot lifecycle against the real AUSD contract on Monad
/// testnet, so that none of it rests on the mock behaving like the token.
///
/// Skipped automatically when the fork cannot be created, so the suite still
/// passes with no network.
///
///     forge test --match-path test/PotsFork.t.sol -vv
contract PotsForkTest is Test {
    /// AUSD on Monad testnet, per docs.agora.finance.
    address internal constant AUSD = 0xa9012a055bd4e0eDfF8Ce09f960291C09D5322dC;
    /// Agora's testnet faucet for that token.
    address internal constant FAUCET = 0xd236c18D274E54FAccC3dd9DDA4b27965a73ee6C;
    uint256 internal constant MONAD_TESTNET_CHAIN_ID = 10143;
    /// The faucet's own error when its stock is down to a single drip.
    bytes4 internal constant INSUFFICIENT_FUNDS = 0x356680b7;

    IERC20 internal ausd = IERC20(AUSD);
    NivPayPots internal pots;

    address internal idara;
    uint256 internal idaraKey;
    address internal ubong = makeAddr("ubong");
    address internal aniekan = makeAddr("aniekan");
    address internal caterer = makeAddr("caterer");
    address internal feeRecipient = makeAddr("feeRecipient");

    uint256 internal constant ONE = 1_000000;
    bool internal forked;

    function setUp() public {
        try vm.createSelectFork("monad_testnet_public") {
            forked = true;
        } catch {
            return;
        }

        assertEq(block.chainid, MONAD_TESTNET_CHAIN_ID, "forked the wrong chain");

        (idara, idaraKey) = makeAddrAndKey("idara");
        pots = new NivPayPots(ausd, 100, 50 * ONE, feeRecipient);
    }

    modifier onlyForked() {
        if (!forked) {
            vm.skip(true);
            return;
        }
        _;
    }

    /// @notice The token really is the six decimal AUSD we think it is.
    function test_fork_tokenIsAusd() public onlyForked {
        assertEq(IERC20Metadata(AUSD).symbol(), "AUSD", "symbol");
        assertEq(IERC20Metadata(AUSD).decimals(), 6, "AUSD is a six decimal token");
        assertGt(ausd.totalSupply(), 0, "the token is live");
    }

    /// @notice How to get test AUSD: call requestFunds on Agora's faucet with
    /// the address that should receive it. This proves the call and records
    /// the terms it enforces.
    function test_fork_faucetDispensesAusd() public onlyForked {
        IAgoraFaucet faucet = IAgoraFaucet(FAUCET);

        // The terms the faucet enforces, read from the live contract. These are
        // what the README quotes.
        assertEq(faucet.token(), AUSD, "the faucet dispenses the same AUSD");
        uint256 drip = faucet.faucetDripAmount();
        assertGt(drip, 0, "there is a drip amount");
        assertGt(faucet.maxDripFrequency(), 0, "there is a cooldown between drips");
        assertGt(faucet.maxAmountToOwn(), 0, "there is a ceiling on what a claimer may already hold");

        // Whether the faucet can actually pay is a property of the public
        // testnet, not of this code. It reverts with InsufficientFunds while
        // its stock is down to a single drip, so a dry faucet skips rather
        // than failing the suite. The skip has to be decided before anything
        // else happens in the test.
        uint256 stock = ausd.balanceOf(FAUCET);
        if (stock <= drip) {
            emit log_named_uint("faucet is dry, stock", stock);
            vm.skip(true);
            return;
        }

        address newcomer = makeAddr("newcomer");
        uint256 before = ausd.balanceOf(newcomer);
        faucet.requestFunds(newcomer);
        assertEq(ausd.balanceOf(newcomer) - before, drip, "the faucet paid out one drip");
    }

    /// @notice Create, fund with a real EIP-2612 permit, pay out, close and
    /// claim, all against the deployed AUSD.
    function test_fork_fullLifecycleOnRealAusd() public onlyForked {
        uint64 endTime = uint64(block.timestamp + 30 days);

        uint256 potId = pots.createPot(
            "Mama's 60th",
            _three(idara, ubong, aniekan),
            2,
            _one(caterer),
            _labels1("Caterer"),
            _caps1(1000 * ONE),
            endTime
        );

        // ---------------------------------------------------------------
        // Fund with a permit signed against the real token's domain.
        // ---------------------------------------------------------------
        uint256 amount = 500 * ONE;
        _dealAusd(idara, amount);
        assertEq(ausd.balanceOf(idara), amount, "credited real AUSD");
        assertEq(ausd.allowance(idara, address(pots)), 0, "no allowance beforehand");

        uint256 deadline = block.timestamp + 1 hours;
        (uint8 v, bytes32 r, bytes32 s) = _signPermit(idaraKey, idara, address(pots), amount, deadline);

        vm.prank(idara);
        pots.fundWithPermit(potId, amount, deadline, v, r, s);

        assertEq(pots.getPot(potId).totalAssets, amount, "the permit funded the pot");
        assertEq(ausd.balanceOf(address(pots)), amount, "the contract holds real AUSD");
        assertEq(ausd.balanceOf(idara), 0, "idara's AUSD moved");

        // ---------------------------------------------------------------
        // Pay the caterer, two of three.
        // ---------------------------------------------------------------
        uint256 payout = 300 * ONE;
        uint256 fee = pots.feeOn(payout);

        vm.prank(aniekan);
        uint256 proposalId = pots.proposePayout(potId, 0, payout);
        assertEq(ausd.balanceOf(caterer), 0, "not paid on one approval");

        vm.prank(ubong);
        pots.approve(proposalId);

        assertEq(ausd.balanceOf(caterer), payout, "the caterer holds real AUSD");
        assertEq(pots.feesAccrued(), fee, "the fee accrued");
        assertEq(pots.getPot(potId).totalAssets, amount - payout - fee, "the pot was debited amount plus fee");

        // ---------------------------------------------------------------
        // Close by proposal, then claim.
        // ---------------------------------------------------------------
        vm.prank(idara);
        uint256 closeId = pots.proposeClose(potId);
        vm.prank(ubong);
        pots.approve(closeId);
        assertTrue(pots.getPot(potId).closed, "closed by proposal");

        uint256 expected = pots.previewExit(potId, pots.sharesOf(potId, idara));
        vm.prank(idara);
        uint256 claimed = pots.claim(potId);

        assertEq(claimed, expected, "claim matched the preview");
        assertEq(claimed, amount - payout - fee, "the sole funder takes the whole remainder");
        assertEq(ausd.balanceOf(idara), claimed, "idara holds real AUSD again");

        // ---------------------------------------------------------------
        // And the fee recipient collects.
        // ---------------------------------------------------------------
        vm.prank(feeRecipient);
        assertEq(pots.collectFees(), fee, "fees collected");
        assertEq(ausd.balanceOf(feeRecipient), fee, "in real AUSD");
        assertEq(ausd.balanceOf(address(pots)), 0, "the contract is empty");
    }

    /// @notice A funder who exits mid life gets real AUSD back, on the real
    /// token, without any approver taking part.
    function test_fork_exitNeedsNobodysPermission() public onlyForked {
        uint64 endTime = uint64(block.timestamp + 30 days);
        uint256 potId = pots.createPot(
            "Exit", _three(idara, ubong, aniekan), 3, _one(caterer), _labels1("Caterer"), _caps1(1000 * ONE), endTime
        );

        _dealAusd(idara, 200 * ONE);
        vm.startPrank(idara);
        ausd.approve(address(pots), 200 * ONE);
        pots.fund(potId, 200 * ONE);
        vm.stopPrank();

        // Every approver freezes and walks away.
        vm.prank(ubong);
        pots.freeze(potId);

        uint256 shares = pots.sharesOf(potId, idara);
        vm.prank(idara);
        assertEq(pots.exit(potId, shares), 200 * ONE, "idara leaves with her own money");
        assertEq(ausd.balanceOf(idara), 200 * ONE, "in real AUSD");
    }

    /// @dev forge's deal cheatcode cannot credit AUSD. The token keeps
    /// balances in namespaced storage behind a proxy, and it does not store a
    /// balance as a plain word: the live contract holds a balance of 1e10 as
    /// 0x2540be40000, which is the amount shifted left by one byte, with the
    /// low byte reserved for the account's own flags. Writing a raw amount
    /// there would set a balance 256 times too small and clobber those flags.
    ///
    /// So find the slot a balanceOf call actually reads, then try each
    /// plausible encoding and keep the one that makes balanceOf return the
    /// number asked for. Nothing here is assumed: every write is verified
    /// through the token's own accessor, and an unrecognised layout fails
    /// loudly rather than quietly crediting the wrong amount.
    function _dealAusd(address to, uint256 amount) internal {
        require(amount > 0, "deal a positive amount");
        require(ausd.balanceOf(to) != amount, "pick a fresh address");
        require(amount < type(uint256).max >> 8, "amount must survive the shift");

        vm.record();
        ausd.balanceOf(to);
        (bytes32[] memory reads,) = vm.accesses(AUSD);

        for (uint256 i = 0; i < reads.length; ++i) {
            bytes32 slot = reads[i];
            bytes32 previous = vm.load(AUSD, slot);

            // Balance shifted up by a byte, preserving the flag byte below it,
            // which is the layout the live token uses.
            bytes32 packed = bytes32((amount << 8) | (uint256(previous) & 0xff));
            if (_tryWrite(slot, packed, to, amount)) return;

            // A plain word, in case the layout ever changes to the usual one.
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

    function _signPermit(uint256 pk, address owner, address spender, uint256 value, uint256 deadline)
        internal
        view
        returns (uint8 v, bytes32 r, bytes32 s)
    {
        bytes32 structHash = keccak256(
            abi.encode(
                keccak256("Permit(address owner,address spender,uint256 value,uint256 nonce,uint256 deadline)"),
                owner,
                spender,
                value,
                IERC20Permit(AUSD).nonces(owner),
                deadline
            )
        );
        bytes32 digest =
            keccak256(abi.encodePacked("\x19\x01", IERC20Permit(AUSD).DOMAIN_SEPARATOR(), structHash));
        (v, r, s) = vm.sign(pk, digest);
    }

    function _one(address a) internal pure returns (address[] memory out) {
        out = new address[](1);
        out[0] = a;
    }

    function _three(address a, address b, address c) internal pure returns (address[] memory out) {
        out = new address[](3);
        out[0] = a;
        out[1] = b;
        out[2] = c;
    }

    function _labels1(bytes32 a) internal pure returns (bytes32[] memory out) {
        out = new bytes32[](1);
        out[0] = a;
    }

    function _caps1(uint256 a) internal pure returns (uint256[] memory out) {
        out = new uint256[](1);
        out[0] = a;
    }
}
