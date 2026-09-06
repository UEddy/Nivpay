// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/// @title MockStable
/// @notice Minimal 6 decimal ERC-20 used only by the NivPay benchmark harness.
///         USDC and AUSD are both 6 decimals, so the benchmark uses 6 to keep
///         transfer arithmetic and storage widths representative of production.
/// @dev Not production code. Unrestricted mint, no permit, no hooks. The goal is
///      to reproduce the gas profile of a standard ERC-20 balance update, which
///      is what dominates settlement cost, without any extra machinery that
///      would distort the measurement.
contract MockStable {
    string public constant name = "Mock Stable";
    string public constant symbol = "mUSD";
    uint8 public constant decimals = 6;

    uint256 public totalSupply;

    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    event Transfer(address indexed from, address indexed to, uint256 value);
    event Approval(address indexed owner, address indexed spender, uint256 value);

    function mint(address to, uint256 amount) external {
        totalSupply += amount;
        unchecked {
            balanceOf[to] += amount;
        }
        emit Transfer(address(0), to, amount);
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        emit Approval(msg.sender, spender, amount);
        return true;
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        balanceOf[msg.sender] -= amount;
        unchecked {
            balanceOf[to] += amount;
        }
        emit Transfer(msg.sender, to, amount);
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        uint256 allowed = allowance[from][msg.sender];
        if (allowed != type(uint256).max) {
            allowance[from][msg.sender] = allowed - amount;
        }
        balanceOf[from] -= amount;
        unchecked {
            balanceOf[to] += amount;
        }
        emit Transfer(from, to, amount);
        return true;
    }
}
