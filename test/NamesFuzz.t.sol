// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {NivPayNames} from "../src/NivPayNames.sol";

/// @notice The contract's name check against a reference written separately,
/// as a small state machine over the bytes, on random input.
contract NamesFuzzTest is Test {
    NivPayNames internal names;

    function setUp() public {
        names = new NivPayNames();
    }

    /// The reference. Written from the rules, not from the contract.
    function _reference(bytes memory s) internal pure returns (bool) {
        if (s.length < 3 || s.length > 20) return false;
        // 0: at the start, 1: after a letter or digit, 2: after an underscore
        uint8 state = 0;
        for (uint256 i = 0; i < s.length; i++) {
            uint8 c = uint8(s[i]);
            bool letter = c >= 0x61 && c <= 0x7a;
            bool digit = c >= 0x30 && c <= 0x39;
            bool under = c == 0x5f;
            if (state == 0) {
                if (!letter) return false;
                state = 1;
            } else if (state == 1) {
                if (letter || digit) state = 1;
                else if (under) state = 2;
                else return false;
            } else {
                if (letter || digit) state = 1;
                else return false;
            }
        }
        return state == 1;
    }

    /// Bytes drawn mostly from the characters that matter, so valid names
    /// come up often, with any byte at all now and then.
    function _name(uint256 seed, uint256 len) internal pure returns (bytes memory out) {
        bytes memory alphabet = "abcz09_A-@. ";
        out = new bytes(len);
        for (uint256 i = 0; i < len; i++) {
            uint256 r = uint256(keccak256(abi.encode(seed, i)));
            out[i] = r % 8 == 0 ? bytes1(uint8(r >> 8)) : alphabet[(r >> 16) % alphabet.length];
        }
    }

    function testFuzz_nameCheckMatchesTheReference(uint256 seed, uint8 rawLen) public view {
        bytes memory s = _name(seed, bound(rawLen, 0, 24));
        assertEq(names.isWellFormed(s), _reference(s));
    }

    function testFuzz_nameCheckMatchesTheReferenceOnAnyBytes(bytes calldata s) public view {
        assertEq(names.isWellFormed(s), _reference(s));
    }

    function testFuzz_claimSucceedsExactlyWhenTheReferenceAllowsIt(uint256 seed, uint8 rawLen) public {
        bytes memory s = _name(seed, bound(rawLen, 0, 24));
        bool allowed = _reference(s) && !names.isReserved(s);
        vm.prank(address(0xA11CE));
        (bool ok,) = address(names).call(abi.encodeCall(NivPayNames.claim, (string(s))));
        assertEq(ok, allowed);
        if (ok) assertEq(names.accountOf(string(s)), address(0xA11CE));
    }

    function testFuzz_containingNivpayIsAlwaysReserved(uint256 seed, uint8 before, uint8 rest) public view {
        bytes memory a = _name(seed, bound(before, 0, 7));
        bytes memory b = _name(uint256(keccak256(abi.encode(seed))), bound(rest, 0, 7));
        assertTrue(names.isReserved(bytes.concat(a, "nivpay", b)));
    }
}
