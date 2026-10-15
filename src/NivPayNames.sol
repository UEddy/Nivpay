// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/// @title NivPayNames
/// @notice Usernames that map to an Account ID, one name per account, chosen
/// and changed only by the account itself.
///
/// Design rules this contract holds to:
///
///  1. Only an account can change its own name. Every write reads msg.sender
///     and touches only that account's name. Nobody can point a name at
///     someone else, and nobody can take a name someone holds.
///  2. There is no owner, no admin, no pause, no upgrade path, no fee and no
///     payable function. The rules and the reserved names are fixed in this
///     source; nothing can be changed after deployment.
///  3. Names are strict, so look-alikes can't be made: 3 to 20 characters,
///     only a to z, 0 to 9 and _, starting with a letter, with no "__" and no
///     trailing _. Names close to NivPay's own are reserved.
///  4. A released name is held for HOLD_PERIOD before anyone else can claim
///     it, so it can't be taken over the moment it is let go. The account
///     that released it can take it back at any time.
///
/// This contract knows nothing about NivPayPots and NivPayPots knows nothing
/// about it. A name never decides who a pot can pay.
contract NivPayNames {
    // ---------------------------------------------------------------------
    // Constants
    // ---------------------------------------------------------------------

    uint256 public constant MIN_LENGTH = 3;
    uint256 public constant MAX_LENGTH = 20;

    /// @notice How long a released name stays out of reach of everyone but
    /// the account that released it.
    uint64 public constant HOLD_PERIOD = 90 days;

    // ---------------------------------------------------------------------
    // Storage
    // ---------------------------------------------------------------------

    /// @dev Keyed by keccak256 of the name's bytes.
    mapping(bytes32 nameKey => address account) private _accountOf;
    mapping(address account => string name) private _nameOf;
    /// @dev Set when a name is released, cleared when it is claimed again.
    mapping(bytes32 nameKey => address account) private _releasedBy;
    mapping(bytes32 nameKey => uint64 time) private _heldUntil;

    // ---------------------------------------------------------------------
    // Events
    // ---------------------------------------------------------------------

    event NameClaimed(address indexed account, string name);
    event NameReleased(address indexed account, string name, uint64 availableAt);

    // ---------------------------------------------------------------------
    // Errors
    // ---------------------------------------------------------------------

    error NameNotAllowed();
    error NameReserved();
    error NameTaken();
    error NameHeld(uint64 availableAt);
    error AlreadyYours();
    error NoName();

    // ---------------------------------------------------------------------
    // Writes
    // ---------------------------------------------------------------------

    /// @notice The caller takes `name`. If the caller already has a name, that
    /// one is released in the same call and held for HOLD_PERIOD.
    function claim(string calldata name) external {
        bytes memory b = bytes(name);
        if (!isWellFormed(b)) revert NameNotAllowed();
        if (isReserved(b)) revert NameReserved();
        bytes32 key = keccak256(b);
        address holder = _accountOf[key];
        if (holder == msg.sender) revert AlreadyYours();
        if (holder != address(0)) revert NameTaken();
        uint64 until = _heldUntil[key];
        if (until > block.timestamp && _releasedBy[key] != msg.sender) revert NameHeld(until);

        if (bytes(_nameOf[msg.sender]).length != 0) _release(msg.sender);

        _accountOf[key] = msg.sender;
        _nameOf[msg.sender] = name;
        delete _releasedBy[key];
        delete _heldUntil[key];
        emit NameClaimed(msg.sender, name);
    }

    /// @notice The caller gives up its name, which is then held for HOLD_PERIOD.
    function release() external {
        if (bytes(_nameOf[msg.sender]).length == 0) revert NoName();
        _release(msg.sender);
    }

    function _release(address account) private {
        string memory name = _nameOf[account];
        bytes32 key = keccak256(bytes(name));
        uint64 until = uint64(block.timestamp) + HOLD_PERIOD;
        delete _accountOf[key];
        delete _nameOf[account];
        _releasedBy[key] = account;
        _heldUntil[key] = until;
        emit NameReleased(account, name, until);
    }

    // ---------------------------------------------------------------------
    // Views
    // ---------------------------------------------------------------------

    /// @notice The account holding `name`, or the zero address.
    function accountOf(string calldata name) external view returns (address) {
        return _accountOf[keccak256(bytes(name))];
    }

    /// @notice The name `account` holds, or "".
    function nameOf(address account) external view returns (string memory) {
        return _nameOf[account];
    }

    /// @notice When anyone may claim `name`: 0 if it is free now, the end of
    /// its hold if it was released recently, or type(uint64).max if an account
    /// holds it. A name that breaks the rules or is reserved is never
    /// available: also type(uint64).max. The account that released a held
    /// name can take it back before then (releasedBy).
    function availableAt(string calldata name) external view returns (uint64) {
        bytes memory b = bytes(name);
        bytes32 key = keccak256(b);
        if (!isWellFormed(b) || isReserved(b) || _accountOf[key] != address(0)) return type(uint64).max;
        uint64 until = _heldUntil[key];
        return until > block.timestamp ? until : 0;
    }

    /// @notice The account that last released `name`, while it is held for them.
    function releasedBy(string calldata name) external view returns (address) {
        bytes32 key = keccak256(bytes(name));
        return _heldUntil[key] > block.timestamp ? _releasedBy[key] : address(0);
    }

    /// @notice True when `name` follows the character rules. Reserved names
    /// can be well formed; isReserved says whether one is.
    function isWellFormed(bytes memory name) public pure returns (bool) {
        uint256 n = name.length;
        if (n < MIN_LENGTH || n > MAX_LENGTH) return false;
        if (!_isLetter(name[0])) return false;
        if (name[n - 1] == "_") return false;
        for (uint256 i = 0; i < n; i++) {
            bytes1 c = name[i];
            if (c == "_") {
                if (name[i - 1] == "_") return false;
            } else if (!_isLetter(c) && !_isDigit(c)) {
                return false;
            }
        }
        return true;
    }

    /// @notice True for NivPay's own names and the names of those it works
    /// with, and for any name containing "nivpay".
    function isReserved(bytes memory name) public pure returns (bool) {
        bytes32 h = keccak256(name);
        if (
            h == keccak256("nivpay") || h == keccak256("support") || h == keccak256("help") || h == keccak256("admin")
                || h == keccak256("official") || h == keccak256("team") || h == keccak256("security")
                || h == keccak256("staff") || h == keccak256("agora") || h == keccak256("monad") || h == keccak256("mera")
        ) return true;
        return _contains(name, "nivpay");
    }

    function _isLetter(bytes1 c) private pure returns (bool) {
        return c >= "a" && c <= "z";
    }

    function _isDigit(bytes1 c) private pure returns (bool) {
        return c >= "0" && c <= "9";
    }

    function _contains(bytes memory haystack, bytes memory needle) private pure returns (bool) {
        if (needle.length > haystack.length) return false;
        for (uint256 i = 0; i + needle.length <= haystack.length; i++) {
            uint256 j = 0;
            while (j < needle.length && haystack[i + j] == needle[j]) j++;
            if (j == needle.length) return true;
        }
        return false;
    }
}
