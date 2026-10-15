// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {NivPayNames} from "../src/NivPayNames.sol";

/// @notice Every rule of NivPayNames, one at a time, and the shared name
/// vectors that app/src/lib/usernames.test.ts reads too.
contract NamesCoreTest is Test {
    NivPayNames internal names;

    address internal idara = makeAddr("idara");
    address internal ubong = makeAddr("ubong");
    address internal eve = makeAddr("eve");

    event NameClaimed(address indexed account, string name);
    event NameReleased(address indexed account, string name, uint64 availableAt);

    function setUp() public {
        names = new NivPayNames();
    }

    function _claim(address who, string memory name) internal {
        vm.prank(who);
        names.claim(name);
    }

    // ---------------------------------------------------------------------
    // The shared vectors
    // ---------------------------------------------------------------------

    function _vectors(string memory key) internal view returns (string[] memory) {
        string memory json = vm.readFile(string.concat(vm.projectRoot(), "/test/vectors/usernames.json"));
        return vm.parseJsonStringArray(json, key);
    }

    function test_vectors_allowedNamesCanBeClaimed() public {
        string[] memory ok = _vectors(".allowed");
        assertGt(ok.length, 10);
        for (uint256 i = 0; i < ok.length; i++) {
            assertTrue(names.isWellFormed(bytes(ok[i])), ok[i]);
            assertFalse(names.isReserved(bytes(ok[i])), ok[i]);
            assertEq(names.availableAt(ok[i]), 0, ok[i]);
            address who = address(uint160(0x1000 + i));
            _claim(who, ok[i]);
            assertEq(names.accountOf(ok[i]), who, ok[i]);
        }
    }

    function test_vectors_notAllowedNamesAreRefused() public {
        string[] memory bad = _vectors(".notAllowed");
        assertGt(bad.length, 10);
        for (uint256 i = 0; i < bad.length; i++) {
            assertFalse(names.isWellFormed(bytes(bad[i])), bad[i]);
            assertEq(names.availableAt(bad[i]), type(uint64).max, bad[i]);
            vm.prank(idara);
            vm.expectRevert(NivPayNames.NameNotAllowed.selector);
            names.claim(bad[i]);
        }
    }

    function test_vectors_reservedNamesAreRefused() public {
        string[] memory held = _vectors(".reserved");
        assertGt(held.length, 10);
        for (uint256 i = 0; i < held.length; i++) {
            assertTrue(names.isWellFormed(bytes(held[i])), held[i]);
            assertTrue(names.isReserved(bytes(held[i])), held[i]);
            assertEq(names.availableAt(held[i]), type(uint64).max, held[i]);
            vm.prank(idara);
            vm.expectRevert(NivPayNames.NameReserved.selector);
            names.claim(held[i]);
        }
    }

    // ---------------------------------------------------------------------
    // Each character rule
    // ---------------------------------------------------------------------

    function test_rules_lengthIsThreeToTwenty() public view {
        assertFalse(names.isWellFormed("ab"));
        assertTrue(names.isWellFormed("abc"));
        assertTrue(names.isWellFormed("abcdefghijklmnopqrst"));
        assertFalse(names.isWellFormed("abcdefghijklmnopqrstu"));
    }

    function test_rules_onlyLowercaseDigitsAndUnderscore() public view {
        assertTrue(names.isWellFormed("a_1"));
        assertFalse(names.isWellFormed("aBc"));
        assertFalse(names.isWellFormed("a-c"));
        assertFalse(names.isWellFormed("a c"));
        assertFalse(names.isWellFormed(hex"6162c3a9")); // "ab" and an accented e
        assertFalse(names.isWellFormed(hex"616200"));
    }

    function test_rules_startsWithALetter() public view {
        assertFalse(names.isWellFormed("1ab"));
        assertFalse(names.isWellFormed("_ab"));
        assertTrue(names.isWellFormed("a1b"));
    }

    function test_rules_noDoubleUnderscoreAndNoTrailingUnderscore() public view {
        assertFalse(names.isWellFormed("a__b"));
        assertFalse(names.isWellFormed("ab_"));
        assertTrue(names.isWellFormed("a_b_c"));
    }

    function test_rules_reservedExactNamesAndAnythingContainingNivpay() public view {
        assertTrue(names.isReserved("support"));
        assertFalse(names.isReserved("supports"));
        assertTrue(names.isReserved("mynivpayname"));
        assertFalse(names.isReserved("nivpa"));
    }

    // ---------------------------------------------------------------------
    // Claim
    // ---------------------------------------------------------------------

    function test_claim_setsBothDirectionsAndEmits() public {
        vm.expectEmit(true, false, false, true, address(names));
        emit NameClaimed(idara, "idara");
        _claim(idara, "idara");
        assertEq(names.accountOf("idara"), idara);
        assertEq(names.nameOf(idara), "idara");
        assertEq(names.availableAt("idara"), type(uint64).max);
    }

    function test_claim_aNameSomeoneHoldsIsRefused() public {
        _claim(idara, "idara");
        vm.prank(eve);
        vm.expectRevert(NivPayNames.NameTaken.selector);
        names.claim("idara");
        assertEq(names.accountOf("idara"), idara);
    }

    function test_claim_yourOwnNameAgainIsRefused() public {
        _claim(idara, "idara");
        vm.prank(idara);
        vm.expectRevert(NivPayNames.AlreadyYours.selector);
        names.claim("idara");
    }

    function test_claim_aSecondNameReleasesTheFirstInTheSameCall() public {
        _claim(idara, "idara");
        uint64 until = uint64(block.timestamp) + names.HOLD_PERIOD();
        vm.expectEmit(true, false, false, true, address(names));
        emit NameReleased(idara, "idara", until);
        vm.expectEmit(true, false, false, true, address(names));
        emit NameClaimed(idara, "idara_e");
        _claim(idara, "idara_e");
        assertEq(names.nameOf(idara), "idara_e");
        assertEq(names.accountOf("idara_e"), idara);
        assertEq(names.accountOf("idara"), address(0));
        assertEq(names.availableAt("idara"), until);
        assertEq(names.releasedBy("idara"), idara);
    }

    // ---------------------------------------------------------------------
    // Release and the hold
    // ---------------------------------------------------------------------

    function test_release_clearsTheNameAndHoldsIt() public {
        _claim(idara, "idara");
        uint64 until = uint64(block.timestamp) + 90 days;
        vm.expectEmit(true, false, false, true, address(names));
        emit NameReleased(idara, "idara", until);
        vm.prank(idara);
        names.release();
        assertEq(names.nameOf(idara), "");
        assertEq(names.accountOf("idara"), address(0));
        assertEq(names.availableAt("idara"), until);
    }

    function test_release_withNoNameIsRefused() public {
        vm.prank(idara);
        vm.expectRevert(NivPayNames.NoName.selector);
        names.release();
    }

    function test_hold_isNinetyDays() public view {
        assertEq(names.HOLD_PERIOD(), 90 days);
    }

    function test_hold_nobodyElseCanClaimBeforeItEnds() public {
        _claim(idara, "idara");
        vm.prank(idara);
        names.release();
        uint64 until = uint64(block.timestamp) + 90 days;
        vm.warp(until - 1);
        vm.prank(eve);
        vm.expectRevert(abi.encodeWithSelector(NivPayNames.NameHeld.selector, until));
        names.claim("idara");
    }

    function test_hold_anyoneCanClaimOnceItEnds() public {
        _claim(idara, "idara");
        vm.prank(idara);
        names.release();
        vm.warp(block.timestamp + 90 days);
        assertEq(names.availableAt("idara"), 0);
        assertEq(names.releasedBy("idara"), address(0));
        _claim(eve, "idara");
        assertEq(names.accountOf("idara"), eve);
    }

    function test_hold_theAccountThatReleasedItCanTakeItBackAtAnyTime() public {
        _claim(idara, "idara");
        vm.prank(idara);
        names.release();
        vm.warp(block.timestamp + 1 days);
        _claim(idara, "idara");
        assertEq(names.accountOf("idara"), idara);
        assertEq(names.availableAt("idara"), type(uint64).max);
        // and after changing to another name, the old one comes back the same way
        _claim(idara, "idara_e");
        vm.warp(block.timestamp + 89 days);
        _claim(idara, "idara");
        assertEq(names.nameOf(idara), "idara");
        assertEq(names.availableAt("idara_e"), uint64(block.timestamp) + 90 days);
    }

    // ---------------------------------------------------------------------
    // Only an account changes its own name
    // ---------------------------------------------------------------------

    function test_ownership_nobodyCanReleaseSomeoneElsesName() public {
        _claim(idara, "idara");
        vm.prank(eve);
        vm.expectRevert(NivPayNames.NoName.selector);
        names.release();
        assertEq(names.nameOf(idara), "idara");
    }

    function test_ownership_claimingOnlyEverWritesTheCaller() public {
        _claim(idara, "idara");
        _claim(ubong, "ubong");
        _claim(eve, "eve_x");
        assertEq(names.nameOf(idara), "idara");
        assertEq(names.nameOf(ubong), "ubong");
    }

    function test_noValueCanBeSent() public {
        vm.deal(idara, 1 ether);
        vm.prank(idara);
        (bool ok,) = address(names).call{value: 1}(abi.encodeCall(NivPayNames.claim, ("idara")));
        assertFalse(ok, "claim is not payable");
        vm.prank(idara);
        (ok,) = address(names).call{value: 1}("");
        assertFalse(ok, "no receive or fallback");
    }
}
