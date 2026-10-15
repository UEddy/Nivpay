// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {NivPayNames} from "../../src/NivPayNames.sol";

/// @notice Drives NivPayNames with a few accounts fighting over a small pool
/// of names, through claims, changes, releases and time passing. Around every
/// call it checks that nobody's name changed except the caller's, and records
/// any breach in a ghost variable, since fail_on_revert is off and an assert
/// inside a handler action would be swallowed.
contract NamesHandler is Test {
    NivPayNames public immutable names;
    address[] public actors;
    string[] public pool;

    uint256 public ghostClaims;
    uint256 public ghostReleases;
    uint256 public ghostRefused;
    /// Someone's name changed during a call made by someone else.
    uint256 public ghostOthersChanged;
    /// A held name was taken by an account other than the one that released it.
    uint256 public ghostHoldBroken;

    constructor(NivPayNames names_) {
        names = names_;
        actors.push(makeAddr("idara"));
        actors.push(makeAddr("ubong"));
        actors.push(makeAddr("aniekan"));
        actors.push(makeAddr("eve"));
        pool.push("idara");
        pool.push("ubong");
        pool.push("caterer");
        pool.push("event_hall");
        pool.push("x_1");
        // Never allowed, so the refusals are exercised too.
        pool.push("nivpay_help");
        pool.push("Bad");
    }

    function actorCount() external view returns (uint256) {
        return actors.length;
    }

    function poolCount() external view returns (uint256) {
        return pool.length;
    }

    function _snapshot() internal view returns (string[] memory out) {
        out = new string[](actors.length);
        for (uint256 i = 0; i < actors.length; i++) out[i] = names.nameOf(actors[i]);
    }

    function _checkOthers(string[] memory before, uint256 caller) internal {
        for (uint256 i = 0; i < actors.length; i++) {
            if (i == caller) continue;
            if (keccak256(bytes(names.nameOf(actors[i]))) != keccak256(bytes(before[i]))) ghostOthersChanged++;
        }
    }

    function claim(uint256 actorSeed, uint256 nameSeed) external {
        uint256 a = actorSeed % actors.length;
        string memory name = pool[nameSeed % pool.length];
        string[] memory before = _snapshot();
        uint64 heldUntil = names.availableAt(name);
        address releaser = names.releasedBy(name);
        vm.prank(actors[a]);
        try names.claim(name) {
            ghostClaims++;
            if (heldUntil != 0 && heldUntil != type(uint64).max && releaser != actors[a]) ghostHoldBroken++;
        } catch {
            ghostRefused++;
        }
        _checkOthers(before, a);
    }

    function release(uint256 actorSeed) external {
        uint256 a = actorSeed % actors.length;
        string[] memory before = _snapshot();
        vm.prank(actors[a]);
        try names.release() {
            ghostReleases++;
        } catch {
            ghostRefused++;
        }
        _checkOthers(before, a);
    }

    function passTime(uint256 seconds_) external {
        vm.warp(block.timestamp + bound(seconds_, 1 hours, 120 days));
    }
}
