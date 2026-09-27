// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {ERC20Permit} from "@openzeppelin/contracts/token/ERC20/extensions/ERC20Permit.sol";

/// @title NivPayTestDollar
/// @notice A worthless test stablecoin for exercising NivPayPots on Monad
///         testnet without depending on Agora's AUSD faucet. Six decimals and
///         EIP-2612 permit, like AUSD, so it drives every path in the pot
///         contract including `fundWithPermit`.
/// @dev NOT A REAL STABLECOIN. Anyone can mint, up to MAX_MINT per call, so
///      it is worth exactly nothing. The name and symbol are chosen so it can
///      never be mistaken for AUSD or any real dollar token.
///
///      It must never exist on a mainnet. That is enforced here, not just in
///      the deploy script: the constructor refuses every chain except Monad
///      testnet and a local Anvil or Forge test chain, so the bytecode cannot
///      be deployed to Monad mainnet or anywhere else by any route.
contract NivPayTestDollar is ERC20, ERC20Permit {
    uint256 internal constant MONAD_TESTNET_CHAIN_ID = 10143;
    uint256 internal constant LOCAL_CHAIN_ID = 31337;

    /// @notice The most one mint call can create: 100,000 TESTUSD. Keeps each
    ///         mint within amounts a real stablecoin holder could plausibly
    ///         move, which is the range NivPayPots has been tested against.
    uint256 public constant MAX_MINT = 100_000 * 10 ** 6;

    error NotATestChain(uint256 chainId);
    error MintAboveCap(uint256 amount, uint256 cap);

    constructor() ERC20("NivPay Test Dollar", "TESTUSD") ERC20Permit("NivPay Test Dollar") {
        if (block.chainid != MONAD_TESTNET_CHAIN_ID && block.chainid != LOCAL_CHAIN_ID) {
            revert NotATestChain(block.chainid);
        }
    }

    function decimals() public pure override returns (uint8) {
        return 6;
    }

    /// @notice Anyone can mint to anyone, up to MAX_MINT per call.
    function mint(address to, uint256 amount) external {
        if (amount > MAX_MINT) revert MintAboveCap(amount, MAX_MINT);
        _mint(to, amount);
    }
}
