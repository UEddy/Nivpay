// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {NivPayNames} from "../src/NivPayNames.sol";
import {NamesHandler} from "./handlers/NamesHandler.sol";

/// @notice Invariants of NivPayNames under random claims, changes, releases
/// and time passing.
contract NamesInvariantTest is Test {
    NivPayNames internal names;
    NamesHandler internal handler;

    function setUp() public {
        names = new NivPayNames();
        handler = new NamesHandler(names);
        targetContract(address(handler));
    }

    /// accountOf(nameOf(a)) == a for every account that holds a name.
    function invariant_everyHolderIsTheAccountItsNameNames() public view {
        for (uint256 i = 0; i < handler.actorCount(); i++) {
            address a = handler.actors(i);
            string memory name = names.nameOf(a);
            if (bytes(name).length != 0) assertEq(names.accountOf(name), a);
        }
    }

    /// A name points at an account only while that account holds it.
    function invariant_aNameHasAtMostOneHolder() public view {
        for (uint256 j = 0; j < handler.poolCount(); j++) {
            string memory name = handler.pool(j);
            address holder = names.accountOf(name);
            if (holder != address(0)) assertEq(names.nameOf(holder), name);
        }
    }

    /// Only an account can change its own name.
    function invariant_onlyAnAccountChangesItsOwnName() public view {
        assertEq(handler.ghostOthersChanged(), 0);
    }

    /// Nobody but the account that released a name takes it during its hold.
    function invariant_aHeldNameIsOnlyTakenBackByItsReleaser() public view {
        assertEq(handler.ghostHoldBroken(), 0);
    }

    /// Reserved and malformed names are never held by anyone.
    function invariant_reservedAndMalformedNamesAreNeverHeld() public view {
        assertEq(names.accountOf("nivpay_help"), address(0));
        assertEq(names.accountOf("Bad"), address(0));
    }

    /// After every run, one more claim, change and release through the
    /// handler, so each run ends having exercised all three whatever the
    /// fuzzer picked, then every invariant again.
    function afterInvariant() public {
        handler.claim(0, 4);
        handler.claim(0, 2);
        handler.claim(3, 2);
        handler.release(0);
        assertGt(handler.ghostClaims(), 0, "nothing was ever claimed");
        assertGt(handler.ghostRefused(), 0, "nothing was ever refused");
        invariant_everyHolderIsTheAccountItsNameNames();
        invariant_aNameHasAtMostOneHolder();
        invariant_onlyAnAccountChangesItsOwnName();
        invariant_aHeldNameIsOnlyTakenBackByItsReleaser();
    }
}
