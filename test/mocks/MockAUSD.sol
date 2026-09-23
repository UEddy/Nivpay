// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {ERC20Permit} from "@openzeppelin/contracts/token/ERC20/extensions/ERC20Permit.sol";

/// @notice Stand in for AUSD in tests. Six decimals, EIP-2612 permit, and the
/// two behaviours that matter for NivPayPots and are not in a plain ERC-20:
///
///  * asset freezing, so a transfer to or from a frozen address reverts, which
///    is what Agora's controls do on the real token,
///  * an optional transfer fee, so the balance delta check on funding has
///    something to catch.
contract MockAUSD is ERC20, ERC20Permit {
    mapping(address => bool) public frozen;
    uint256 public transferFeeBps;

    error AccountFrozen(address account);

    constructor() ERC20("Mock AUSD", "AUSD") ERC20Permit("Mock AUSD") {}

    function decimals() public pure override returns (uint8) {
        return 6;
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    /// @notice Mimic Agora's asset freeze on a single address.
    function setFrozen(address account, bool value) external {
        frozen[account] = value;
    }

    /// @notice Make transfers deliver less than they were asked for.
    function setTransferFeeBps(uint256 bps) external {
        transferFeeBps = bps;
    }

    function _update(address from, address to, uint256 value) internal override {
        if (from != address(0) && frozen[from]) revert AccountFrozen(from);
        if (to != address(0) && frozen[to]) revert AccountFrozen(to);

        uint256 fee = (value * transferFeeBps) / 10_000;
        if (fee != 0 && from != address(0) && to != address(0)) {
            super._update(from, address(0), fee);
            super._update(from, to, value - fee);
            return;
        }
        super._update(from, to, value);
    }
}
