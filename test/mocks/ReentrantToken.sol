// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @notice A token that calls back into a target in the middle of a transfer,
/// so the reentrancy guard on NivPayPots has something to stop. AUSD is not
/// this token, but the guard is what makes that assumption unnecessary.
contract ReentrantToken is ERC20 {
    address public target;
    bytes public payload;
    bool public armed;

    bool public reenterCalled;
    bool public reenterSucceeded;
    bytes public reenterReturndata;

    constructor() ERC20("Reentrant", "RE") {}

    function decimals() public pure override returns (uint8) {
        return 6;
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    function arm(address target_, bytes calldata payload_) external {
        target = target_;
        payload = payload_;
        armed = true;
        reenterCalled = false;
        reenterSucceeded = false;
    }

    function _update(address from, address to, uint256 value) internal override {
        super._update(from, to, value);
        if (armed) {
            armed = false;
            reenterCalled = true;
            (bool ok, bytes memory ret) = target.call(payload);
            reenterSucceeded = ok;
            reenterReturndata = ret;
        }
    }
}
