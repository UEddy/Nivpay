// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {PotsTestBase} from "./PotsTestBase.sol";
import {NivPayPots} from "../src/NivPayPots.sol";
import {MockAUSD} from "./mocks/MockAUSD.sol";

/// @notice Creation, funding, exits and claims: every success path and every
/// revert path each of them can take.
contract PotsCoreTest is PotsTestBase {
    address internal alice = makeAddr("alice");
    address internal bob = makeAddr("bob");
    address internal carol = makeAddr("carol");
    address internal dest = makeAddr("dest");
    address internal stranger = makeAddr("stranger");

    uint64 internal endTime;

    function setUp() public override {
        super.setUp();
        endTime = uint64(block.timestamp + 30 days);
        _fundAccount(alice, 1_000_000 * ONE);
        _fundAccount(bob, 1_000_000 * ONE);
        _fundAccount(carol, 1_000_000 * ONE);
    }

    function _pot() internal returns (uint256) {
        return pots.createPot(
            "Purpose", _two(alice, bob), 2, _one(dest), _labels1("Dest"), _caps1(1_000_000 * ONE), endTime
        );
    }

    // ---------------------------------------------------------------------
    // Constructor
    // ---------------------------------------------------------------------

    function test_constructor_storesImmutables() public view {
        assertEq(address(pots.token()), address(token), "token");
        assertEq(pots.feeBps(), FEE_BPS, "feeBps");
        assertEq(pots.feeCap(), FEE_CAP, "feeCap");
        assertEq(pots.feeRecipient(), feeRecipient, "feeRecipient");
        assertEq(pots.MAX_FEE_BPS(), 100, "fee bps can never exceed 100");
    }

    function test_constructor_revertsOnZeroToken() public {
        vm.expectRevert(NivPayPots.ZeroAddress.selector);
        new NivPayPots(IERC20(address(0)), 100, FEE_CAP, feeRecipient);
    }

    function test_constructor_revertsOnZeroFeeRecipient() public {
        vm.expectRevert(NivPayPots.ZeroAddress.selector);
        new NivPayPots(IERC20(address(token)), 100, FEE_CAP, address(0));
    }

    function test_constructor_revertsAboveMaxFeeBps() public {
        vm.expectRevert(NivPayPots.FeeTooHigh.selector);
        new NivPayPots(IERC20(address(token)), 101, FEE_CAP, feeRecipient);
    }

    function test_constructor_allowsZeroFee() public {
        NivPayPots free = new NivPayPots(IERC20(address(token)), 0, 0, feeRecipient);
        assertEq(free.feeOn(1_000_000 * ONE), 0, "no fee at zero bps");
    }

    // ---------------------------------------------------------------------
    // createPot
    // ---------------------------------------------------------------------

    function test_createPot_storesEverything() public {
        uint256 potId = pots.createPot(
            "Purpose",
            _three(alice, bob, carol),
            2,
            _two(dest, stranger),
            _labels2("A", "B"),
            _caps2(10 * ONE, 20 * ONE),
            endTime
        );

        NivPayPots.PotView memory p = pots.getPot(potId);
        assertEq(p.purpose, "Purpose", "purpose");
        assertEq(p.threshold, 2, "threshold");
        assertEq(p.approverCount, 3, "approver count");
        assertEq(p.destinationCount, 2, "destination count");
        assertEq(p.endTime, endTime, "end time");
        assertEq(p.totalAssets, 0, "no assets yet");
        assertEq(p.totalShares, 0, "no shares yet");
        assertFalse(p.closed, "open");
        assertFalse(p.frozen, "unfrozen");

        address[] memory approvers = pots.getApprovers(potId);
        assertEq(approvers.length, 3, "three approvers returned");
        assertEq(approvers[0], alice, "approver 0");
        assertEq(approvers[2], carol, "approver 2");
        assertTrue(pots.isApprover(potId, bob), "bob is an approver");
        assertFalse(pots.isApprover(potId, stranger), "stranger is not");

        NivPayPots.Destination[] memory ds = pots.getDestinations(potId);
        assertEq(ds.length, 2, "two destinations");
        assertEq(ds[0].to, dest, "destination 0 address");
        assertEq(ds[0].label, "A", "destination 0 label");
        assertEq(ds[0].cap, 10 * ONE, "destination 0 cap");
        assertEq(ds[1].spent, 0, "nothing spent yet");
    }

    function test_createPot_emitsPotCreated() public {
        vm.expectEmit(true, true, true, true, address(pots));
        emit NivPayPots.PotCreated(
            0, address(this), "Purpose", _two(alice, bob), 2, _one(dest), _labels1("Dest"), _caps1(1_000_000 * ONE), endTime
        );
        _pot();
    }

    function test_createPot_idsIncrement() public {
        assertEq(pots.potCount(), 0, "starts empty");
        assertEq(_pot(), 0, "first pot is 0");
        assertEq(_pot(), 1, "second pot is 1");
        assertEq(pots.potCount(), 2, "two pots");
    }

    function test_createPot_anyoneCanCreate() public {
        vm.prank(stranger);
        uint256 potId = _pot();
        assertFalse(pots.isApprover(potId, stranger), "creating does not make you an approver");
    }

    function test_createPot_allowsThresholdEqualToApproverCount() public {
        uint256 potId = pots.createPot(
            "Unanimous", _three(alice, bob, carol), 3, _one(dest), _labels1("D"), _caps1(ONE), endTime
        );
        assertEq(pots.getPot(potId).threshold, 3, "3 of 3 is allowed");
    }

    function test_createPot_allowsMaximumApproversAndDestinations() public {
        address[] memory many = new address[](10);
        bytes32[] memory labels = new bytes32[](10);
        uint256[] memory caps = new uint256[](10);
        for (uint256 i = 0; i < 10; ++i) {
            many[i] = address(uint160(1000 + i));
            labels[i] = bytes32(uint256(i + 1));
            caps[i] = ONE;
        }
        uint256 potId = pots.createPot("Big", many, 10, many, labels, caps, endTime);
        assertEq(pots.getPot(potId).approverCount, 10, "ten approvers");
        assertEq(pots.getPot(potId).destinationCount, 10, "ten destinations");
    }

    function test_createPot_revertsOnEmptyPurpose() public {
        vm.expectRevert(NivPayPots.EmptyPurpose.selector);
        pots.createPot(bytes32(0), _one(alice), 1, _one(dest), _labels1("D"), _caps1(ONE), endTime);
    }

    function test_createPot_revertsOnZeroApprovers() public {
        vm.expectRevert(NivPayPots.BadApproverCount.selector);
        pots.createPot("P", new address[](0), 1, _one(dest), _labels1("D"), _caps1(ONE), endTime);
    }

    function test_createPot_revertsAboveMaxApprovers() public {
        address[] memory many = new address[](11);
        for (uint256 i = 0; i < 11; ++i) {
            many[i] = address(uint160(1000 + i));
        }
        vm.expectRevert(NivPayPots.BadApproverCount.selector);
        pots.createPot("P", many, 1, _one(dest), _labels1("D"), _caps1(ONE), endTime);
    }

    function test_createPot_revertsOnZeroDestinations() public {
        vm.expectRevert(NivPayPots.BadDestinationCount.selector);
        pots.createPot("P", _one(alice), 1, new address[](0), new bytes32[](0), new uint256[](0), endTime);
    }

    function test_createPot_revertsAboveMaxDestinations() public {
        address[] memory many = new address[](11);
        bytes32[] memory labels = new bytes32[](11);
        uint256[] memory caps = new uint256[](11);
        for (uint256 i = 0; i < 11; ++i) {
            many[i] = address(uint160(2000 + i));
            labels[i] = "L";
            caps[i] = ONE;
        }
        vm.expectRevert(NivPayPots.BadDestinationCount.selector);
        pots.createPot("P", _one(alice), 1, many, labels, caps, endTime);
    }

    function test_createPot_revertsOnLabelLengthMismatch() public {
        vm.expectRevert(NivPayPots.ArrayLengthMismatch.selector);
        pots.createPot("P", _one(alice), 1, _two(dest, stranger), _labels1("D"), _caps2(ONE, ONE), endTime);
    }

    function test_createPot_revertsOnCapLengthMismatch() public {
        vm.expectRevert(NivPayPots.ArrayLengthMismatch.selector);
        pots.createPot("P", _one(alice), 1, _two(dest, stranger), _labels2("A", "B"), _caps1(ONE), endTime);
    }

    function test_createPot_revertsOnZeroThreshold() public {
        vm.expectRevert(NivPayPots.BadThreshold.selector);
        pots.createPot("P", _two(alice, bob), 0, _one(dest), _labels1("D"), _caps1(ONE), endTime);
    }

    function test_createPot_revertsOnThresholdAboveApproverCount() public {
        vm.expectRevert(NivPayPots.BadThreshold.selector);
        pots.createPot("P", _two(alice, bob), 3, _one(dest), _labels1("D"), _caps1(ONE), endTime);
    }

    function test_createPot_revertsOnEndTimeInPast() public {
        vm.expectRevert(NivPayPots.EndTimeInPast.selector);
        pots.createPot("P", _one(alice), 1, _one(dest), _labels1("D"), _caps1(ONE), uint64(block.timestamp - 1));
    }

    function test_createPot_revertsOnEndTimeNow() public {
        vm.expectRevert(NivPayPots.EndTimeInPast.selector);
        pots.createPot("P", _one(alice), 1, _one(dest), _labels1("D"), _caps1(ONE), uint64(block.timestamp));
    }

    function test_createPot_revertsOnZeroApprover() public {
        vm.expectRevert(NivPayPots.ZeroAddress.selector);
        pots.createPot("P", _two(alice, address(0)), 1, _one(dest), _labels1("D"), _caps1(ONE), endTime);
    }

    function test_createPot_revertsOnDuplicateApprover() public {
        vm.expectRevert(NivPayPots.DuplicateApprover.selector);
        pots.createPot("P", _two(alice, alice), 1, _one(dest), _labels1("D"), _caps1(ONE), endTime);
    }

    function test_createPot_revertsOnZeroDestination() public {
        vm.expectRevert(NivPayPots.ZeroAddress.selector);
        pots.createPot("P", _one(alice), 1, _one(address(0)), _labels1("D"), _caps1(ONE), endTime);
    }

    function test_createPot_revertsOnDestinationBeingTheContract() public {
        vm.expectRevert(NivPayPots.ZeroAddress.selector);
        pots.createPot("P", _one(alice), 1, _one(address(pots)), _labels1("D"), _caps1(ONE), endTime);
    }

    function test_createPot_revertsOnZeroCap() public {
        vm.expectRevert(NivPayPots.ZeroCap.selector);
        pots.createPot("P", _one(alice), 1, _one(dest), _labels1("D"), _caps1(0), endTime);
    }

    // ---------------------------------------------------------------------
    // fund
    // ---------------------------------------------------------------------

    function test_fund_mintsSharesAndEmits() public {
        uint256 potId = _pot();
        uint256 expected = pots.previewFund(potId, 100 * ONE);

        vm.expectEmit(true, true, true, true, address(pots));
        emit NivPayPots.Funded(potId, alice, 100 * ONE, expected);
        vm.prank(alice);
        uint256 minted = pots.fund(potId, 100 * ONE);

        assertEq(minted, expected, "previewFund matches");
        assertEq(pots.sharesOf(potId, alice), minted, "shares credited");
        assertEq(pots.getPot(potId).totalAssets, 100 * ONE, "pot assets");
        assertEq(token.balanceOf(address(pots)), 100 * ONE, "tokens pulled in");
    }

    function test_fund_anyoneCanFundNotJustApprovers() public {
        uint256 potId = _pot();
        _fundAccount(stranger, 100 * ONE);
        vm.prank(stranger);
        pots.fund(potId, 100 * ONE);
        assertGt(pots.sharesOf(potId, stranger), 0, "a non approver can fund");
    }

    function test_fund_laterFunderDoesNotPayForEarlierSpending() public {
        uint256 potId = _pot();
        vm.prank(alice);
        pots.fund(potId, 1000 * ONE);

        // Spend 500 plus 5 fee before bob arrives.
        vm.prank(alice);
        uint256 id = pots.proposePayout(potId, 0, 500 * ONE);
        vm.prank(bob);
        pots.approve(id);
        assertEq(pots.getPot(potId).totalAssets, 495 * ONE, "pot down to 495");

        vm.prank(bob);
        pots.fund(potId, 495 * ONE);

        // Bob paid 495 and is worth 495, less the single unit that rounding
        // always hands to the pot rather than to the caller. Alice bears the
        // whole of the earlier 505 of spending, and picks up Bob's rounding
        // unit, which is exactly the direction the rounding is meant to go.
        (, uint256 bobValue) = pots.funderInfo(potId, bob);
        (, uint256 aliceValue) = pots.funderInfo(potId, alice);
        assertEq(bobValue, 495 * ONE - 1, "bob is worth what he put in, less one unit of rounding");
        assertEq(aliceValue, 495 * ONE, "alice alone bears the earlier 505, and is not diluted by bob joining");

        // Every holder's redeemable value rounds down independently, so the
        // sum of what the funders can take is never more than the pot holds.
        // The gap is rounding dust that stays in the pot, never a shortfall.
        uint256 potAssets = pots.getPot(potId).totalAssets;
        assertLe(bobValue + aliceValue, potAssets, "the pot is never short of what it owes");
        assertEq(potAssets - (bobValue + aliceValue), 1, "one unit of dust, held by the pot");
    }

    function test_fund_revertsOnUnknownPot() public {
        vm.prank(alice);
        vm.expectRevert(NivPayPots.NoSuchPot.selector);
        pots.fund(0, ONE);
    }

    function test_fund_revertsOnZeroAmount() public {
        uint256 potId = _pot();
        vm.prank(alice);
        vm.expectRevert(NivPayPots.ZeroAmount.selector);
        pots.fund(potId, 0);
    }

    function test_fund_revertsAfterEndTime() public {
        uint256 potId = _pot();
        vm.warp(endTime);
        vm.prank(alice);
        vm.expectRevert(NivPayPots.PotClosed.selector);
        pots.fund(potId, ONE);
    }

    function test_fund_revertsAfterClose() public {
        uint256 potId = _pot();
        vm.prank(alice);
        uint256 id = pots.proposeClose(potId);
        vm.prank(bob);
        pots.approve(id);

        vm.prank(alice);
        vm.expectRevert(NivPayPots.PotClosed.selector);
        pots.fund(potId, ONE);
    }

    function test_fund_revertsWhileFrozen() public {
        uint256 potId = _pot();
        vm.prank(alice);
        pots.freeze(potId);
        vm.prank(alice);
        vm.expectRevert(NivPayPots.PotFrozen.selector);
        pots.fund(potId, ONE);
    }

    function test_fund_revertsWhenTheTokenDeliversLess() public {
        uint256 potId = _pot();
        token.setTransferFeeBps(10);
        vm.prank(alice);
        vm.expectRevert(NivPayPots.TransferAmountMismatch.selector);
        pots.fund(potId, 100 * ONE);
    }

    /// @dev The ZeroShares guard inside _fund is defensive and unreachable
    /// under this accounting, which is worth pinning down rather than
    /// pretending otherwise. Funding always mints at least one share because
    /// the share supply stays at roughly 10**DECIMALS_OFFSET times pot assets:
    /// funding mints proportionally, and payouts only ever push the ratio
    /// higher by shrinking assets without burning shares. This test drives the
    /// ratio as far as the contract allows and shows the smallest possible
    /// funding still mints.
    function test_fund_smallestFundingStillMintsAfterHeavySpending() public {
        uint256 potId = _pot();
        vm.prank(alice);
        pots.fund(potId, 1000 * ONE);

        vm.prank(alice);
        uint256 id = pots.proposePayout(potId, 0, 990 * ONE);
        vm.prank(bob);
        pots.approve(id);

        assertGt(pots.previewFund(potId, 1), 0, "one unit of AUSD still mints a share");
        vm.prank(bob);
        assertGt(pots.fund(potId, 1), 0, "and funding it succeeds");
    }

    // ---------------------------------------------------------------------
    // fundWithPermit
    // ---------------------------------------------------------------------

    function test_fundWithPermit_fundsWithoutPriorApproval() public {
        (address signer, uint256 pk) = makeAddrAndKey("permitSigner");
        token.mint(signer, 100 * ONE);
        uint256 potId = _pot();

        (uint8 v, bytes32 r, bytes32 s) = _signPermit(pk, signer, 100 * ONE, block.timestamp + 1 days);

        assertEq(token.allowance(signer, address(pots)), 0, "no allowance beforehand");
        assertEq(token.nonces(signer), 0, "permit unused beforehand");
        vm.prank(signer);
        pots.fundWithPermit(potId, 100 * ONE, block.timestamp + 1 days, v, r, s);

        // The try/catch around permit would swallow a failure, so prove this
        // permit, and nothing else, supplied the allowance that was spent.
        assertEq(token.nonces(signer), 1, "the permit was consumed");
        assertEq(token.allowance(signer, address(pots)), 0, "and its allowance spent exactly");
        assertEq(pots.getPot(potId).totalAssets, 100 * ONE, "funded through the permit");
        assertEq(token.balanceOf(signer), 0, "signer's tokens moved");
    }

    /// @notice A front run permit must not grief the funder. Somebody else
    /// submits the same signature first, consuming the nonce. The funder's own
    /// call must still go through on the allowance that front run created.
    function test_fundWithPermit_survivesAFrontRunPermit() public {
        (address signer, uint256 pk) = makeAddrAndKey("permitSigner");
        token.mint(signer, 100 * ONE);
        uint256 potId = _pot();
        uint256 deadline = block.timestamp + 1 days;

        (uint8 v, bytes32 r, bytes32 s) = _signPermit(pk, signer, 100 * ONE, deadline);
        assertEq(token.allowance(signer, address(pots)), 0, "no allowance beforehand");
        assertEq(token.nonces(signer), 0, "permit unused beforehand");

        // The griefer replays the permit, which now cannot be used again.
        vm.prank(stranger);
        token.permit(signer, address(pots), 100 * ONE, deadline, v, r, s);
        assertEq(token.nonces(signer), 1, "the front run consumed the permit");
        assertEq(token.allowance(signer, address(pots)), 100 * ONE, "allowance already set");

        // Here, by design, the allowance does the work: the funder's own permit
        // call fails and is swallowed. What must hold is that the allowance is
        // the one this same signature created, not one from elsewhere, and
        // that the swallowed call consumed nothing further.
        vm.prank(signer);
        pots.fundWithPermit(potId, 100 * ONE, deadline, v, r, s);
        assertEq(token.nonces(signer), 1, "the funder's own permit call failed and was swallowed");
        assertEq(token.allowance(signer, address(pots)), 0, "the front run allowance was spent exactly");
        assertEq(pots.getPot(potId).totalAssets, 100 * ONE, "funding still succeeded");
    }

    function test_fundWithPermit_revertsOnClosedPotEvenWithGoodPermit() public {
        (address signer, uint256 pk) = makeAddrAndKey("permitSigner");
        token.mint(signer, 100 * ONE);
        uint256 potId = _pot();
        // The deadline must outlive the warp to endTime below, or the permit
        // is already expired when it is used and the test proves nothing
        // about a good one.
        uint256 deadline = uint256(endTime) + 1 days;
        (uint8 v, bytes32 r, bytes32 s) = _signPermit(pk, signer, 100 * ONE, deadline);

        vm.warp(endTime);
        assertEq(token.allowance(signer, address(pots)), 0, "no allowance beforehand");
        assertEq(token.nonces(signer), 0, "permit unused beforehand");

        vm.prank(signer);
        vm.expectRevert(NivPayPots.PotClosed.selector);
        pots.fundWithPermit(potId, 100 * ONE, deadline, v, r, s);

        // The revert rolled the permit back along with everything else.
        assertEq(token.nonces(signer), 0, "the permit was rolled back, not consumed");
        assertEq(token.allowance(signer, address(pots)), 0, "and left no allowance behind");
        assertEq(token.balanceOf(signer), 100 * ONE, "no tokens moved");

        // Proof the permit was good at that moment: the same signature, at the
        // same timestamp, is accepted by the token directly. So PotClosed, not
        // a bad permit, is what refused the funding.
        token.permit(signer, address(pots), 100 * ONE, deadline, v, r, s);
        assertEq(token.nonces(signer), 1, "the same permit is valid at this time");
        assertEq(token.allowance(signer, address(pots)), 100 * ONE, "and grants the allowance");
    }

    function _signPermit(uint256 pk, address owner, uint256 value, uint256 deadline)
        internal
        view
        returns (uint8 v, bytes32 r, bytes32 s)
    {
        bytes32 structHash = keccak256(
            abi.encode(
                keccak256("Permit(address owner,address spender,uint256 value,uint256 nonce,uint256 deadline)"),
                owner,
                address(pots),
                value,
                token.nonces(owner),
                deadline
            )
        );
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", token.DOMAIN_SEPARATOR(), structHash));
        (v, r, s) = vm.sign(pk, digest);
    }

    // ---------------------------------------------------------------------
    // exit
    // ---------------------------------------------------------------------

    function test_exit_returnsProRataAndEmitsExited() public {
        uint256 potId = _pot();
        vm.prank(alice);
        pots.fund(potId, 100 * ONE);
        uint256 shares = pots.sharesOf(potId, alice);

        vm.expectEmit(true, true, true, true, address(pots));
        emit NivPayPots.Exited(potId, alice, shares, 100 * ONE);
        vm.prank(alice);
        uint256 got = pots.exit(potId, shares);

        assertEq(got, 100 * ONE, "gets it all back");
        assertEq(pots.sharesOf(potId, alice), 0, "shares burned");
        assertEq(pots.getPot(potId).totalAssets, 0, "pot emptied");
    }

    function test_exit_partial() public {
        uint256 potId = _pot();
        vm.prank(alice);
        pots.fund(potId, 100 * ONE);
        uint256 shares = pots.sharesOf(potId, alice);

        vm.prank(alice);
        uint256 got = pots.exit(potId, shares / 4);
        assertEq(got, 25 * ONE, "a quarter out");
        assertEq(pots.sharesOf(potId, alice), shares - shares / 4, "three quarters of the shares left");
        (, uint256 value) = pots.funderInfo(potId, alice);
        assertEq(value, 75 * ONE, "three quarters of the value left");
    }

    function test_exit_worksWhileFrozen() public {
        uint256 potId = _pot();
        vm.prank(alice);
        pots.fund(potId, 100 * ONE);
        vm.prank(alice);
        pots.freeze(potId);

        uint256 shares = pots.sharesOf(potId, alice);
        vm.prank(alice);
        assertEq(pots.exit(potId, shares), 100 * ONE, "freeze never blocks an exit");
    }

    function test_exit_worksAfterCloseAndEmitsClaimed() public {
        uint256 potId = _pot();
        vm.prank(alice);
        pots.fund(potId, 100 * ONE);
        uint256 shares = pots.sharesOf(potId, alice);
        vm.warp(endTime);

        vm.expectEmit(true, true, true, true, address(pots));
        emit NivPayPots.Claimed(potId, alice, shares, 100 * ONE);
        vm.prank(alice);
        pots.exit(potId, shares);
    }

    function test_exit_worksWithAPendingProposal() public {
        uint256 potId = _pot();
        vm.prank(alice);
        pots.fund(potId, 100 * ONE);
        vm.prank(alice);
        pots.proposePayout(potId, 0, 50 * ONE);

        uint256 shares = pots.sharesOf(potId, alice);
        vm.prank(alice);
        assertEq(pots.exit(potId, shares), 100 * ONE, "a pending proposal never blocks an exit");
    }

    function test_exit_revertsOnUnknownPot() public {
        vm.expectRevert(NivPayPots.NoSuchPot.selector);
        pots.exit(0, 1);
    }

    function test_exit_revertsOnZeroShares() public {
        uint256 potId = _pot();
        vm.prank(alice);
        vm.expectRevert(NivPayPots.ZeroShares.selector);
        pots.exit(potId, 0);
    }

    function test_exit_revertsOnMoreSharesThanHeld() public {
        uint256 potId = _pot();
        vm.prank(alice);
        pots.fund(potId, 100 * ONE);
        uint256 shares = pots.sharesOf(potId, alice);

        vm.prank(alice);
        vm.expectRevert(NivPayPots.InsufficientShares.selector);
        pots.exit(potId, shares + 1);
    }

    function test_exit_revertsWhenSomebodyElseHoldsTheShares() public {
        uint256 potId = _pot();
        vm.prank(alice);
        pots.fund(potId, 100 * ONE);

        vm.prank(bob);
        vm.expectRevert(NivPayPots.InsufficientShares.selector);
        pots.exit(potId, 1);
    }

    // ---------------------------------------------------------------------
    // claim
    // ---------------------------------------------------------------------

    function test_claim_burnsEverythingAfterClose() public {
        uint256 potId = _pot();
        vm.prank(alice);
        pots.fund(potId, 100 * ONE);
        vm.warp(endTime);

        vm.prank(alice);
        assertEq(pots.claim(potId), 100 * ONE, "claims the lot");
        assertEq(pots.sharesOf(potId, alice), 0, "no shares left");
    }

    function test_claim_revertsWhileOpen() public {
        uint256 potId = _pot();
        vm.prank(alice);
        pots.fund(potId, 100 * ONE);

        vm.prank(alice);
        vm.expectRevert(NivPayPots.PotNotClosed.selector);
        pots.claim(potId);
    }

    function test_claim_revertsWithNothingToClaim() public {
        uint256 potId = _pot();
        vm.warp(endTime);
        vm.prank(alice);
        vm.expectRevert(NivPayPots.ZeroShares.selector);
        pots.claim(potId);
    }

    function test_claim_revertsOnUnknownPot() public {
        vm.expectRevert(NivPayPots.NoSuchPot.selector);
        pots.claim(0);
    }

    // ---------------------------------------------------------------------
    // Views
    // ---------------------------------------------------------------------

    function test_views_revertOnUnknownIds() public {
        vm.expectRevert(NivPayPots.NoSuchPot.selector);
        pots.getPot(0);
        vm.expectRevert(NivPayPots.NoSuchPot.selector);
        pots.getApprovers(0);
        vm.expectRevert(NivPayPots.NoSuchPot.selector);
        pots.getDestinations(0);
        vm.expectRevert(NivPayPots.NoSuchPot.selector);
        pots.funderInfo(0, alice);
        vm.expectRevert(NivPayPots.NoSuchPot.selector);
        pots.previewFund(0, ONE);
        vm.expectRevert(NivPayPots.NoSuchPot.selector);
        pots.previewExit(0, ONE);
        vm.expectRevert(NivPayPots.NoSuchProposal.selector);
        pots.proposalInfo(0);

        uint256 potId = _pot();
        vm.expectRevert(NivPayPots.NoSuchDestination.selector);
        pots.getDestination(potId, 1);
        vm.expectRevert(NivPayPots.NoSuchPot.selector);
        pots.getDestination(potId + 1, 0);
    }

    function test_views_previewMatchesReality() public {
        uint256 potId = _pot();
        vm.prank(alice);
        pots.fund(potId, 300 * ONE);

        uint256 shares = pots.sharesOf(potId, alice);
        uint256 predicted = pots.previewExit(potId, shares / 3);
        vm.prank(alice);
        assertEq(pots.exit(potId, shares / 3), predicted, "previewExit is exact");
    }

    function test_views_feeOnRespectsTheCap() public view {
        assertEq(pots.feeOn(100 * ONE), ONE, "1 percent below the cap");
        assertEq(pots.feeOn(1_000_000 * ONE), FEE_CAP, "clipped at the per payout cap");
        assertEq(pots.feeOn(0), 0, "no amount, no fee");
    }

    function test_views_hasApprovedAndIsApprover() public {
        uint256 potId = _pot();
        vm.prank(alice);
        uint256 id = pots.proposePayout(potId, 0, ONE);
        assertTrue(pots.hasApproved(id, alice), "proposer has approved");
        assertFalse(pots.hasApproved(id, bob), "bob has not");
        assertFalse(pots.hasApproved(id, stranger), "a stranger never has");
    }
}
