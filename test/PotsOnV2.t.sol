// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {NivPayPots} from "../src/NivPayPots.sol";
import {NivPayPotsV2} from "../src/NivPayPotsV2.sol";
import {PotsCoreTest} from "./PotsCore.t.sol";
import {PotsFuzzTest} from "./PotsFuzz.t.sol";
import {PotsGovernanceTest} from "./PotsGovernance.t.sol";
import {PotsSecurityTest} from "./PotsSecurity.t.sol";
import {PotsInvariantTest} from "./PotsInvariant.t.sol";
import {PotsForkTest} from "./PotsFork.t.sol";
import {Mama60Test} from "./Mama60.t.sol";

/// @notice Every NivPayPots suite, run again against NivPayPotsV2: whatever
/// NivPayPots does, V2 has to do the same way. V2 is reached through the
/// NivPayPots type, which works because V2 keeps every one of its functions,
/// events, errors and structs exactly as they are; a single difference in any
/// of them fails here. What V2 adds is tested in PotsChanges*.t.sol.

function newV2(IERC20 token_, uint256 feeBps_, uint256 feeCap_, address feeRecipient_) returns (NivPayPots) {
    return NivPayPots(address(new NivPayPotsV2(token_, feeBps_, feeCap_, feeRecipient_, 72 hours, 7 days)));
}

contract PotsCoreOnV2Test is PotsCoreTest {
    function _newPots(IERC20 t, uint256 b, uint256 c, address r) internal override returns (NivPayPots) {
        return newV2(t, b, c, r);
    }
}

contract PotsFuzzOnV2Test is PotsFuzzTest {
    function _newPots(IERC20 t, uint256 b, uint256 c, address r) internal override returns (NivPayPots) {
        return newV2(t, b, c, r);
    }
}

contract PotsGovernanceOnV2Test is PotsGovernanceTest {
    function _newPots(IERC20 t, uint256 b, uint256 c, address r) internal override returns (NivPayPots) {
        return newV2(t, b, c, r);
    }
}

contract PotsSecurityOnV2Test is PotsSecurityTest {
    function _newPots(IERC20 t, uint256 b, uint256 c, address r) internal override returns (NivPayPots) {
        return newV2(t, b, c, r);
    }
}

contract Mama60OnV2Test is Mama60Test {
    function _newPots(IERC20 t, uint256 b, uint256 c, address r) internal override returns (NivPayPots) {
        return newV2(t, b, c, r);
    }
}

contract PotsInvariantOnV2Test is PotsInvariantTest {
    function _newPots(IERC20 t, uint256 b, uint256 c, address r) internal override returns (NivPayPots) {
        return newV2(t, b, c, r);
    }
}

contract PotsForkOnV2Test is PotsForkTest {
    function _newPots(IERC20 t, uint256 b, uint256 c, address r) internal override returns (NivPayPots) {
        return newV2(t, b, c, r);
    }
}
