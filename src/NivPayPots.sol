// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC20Permit} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Permit.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";

/// @title NivPayPots
/// @notice A pot is a group purse for one purpose that no single person can pocket.
///
/// Money goes in from anyone. It can only come out to destinations fixed at
/// creation, and only when enough of the named approvers agree. When the pot
/// ends, whatever is left goes back to the funders, split by what they put in.
///
/// Design rules this contract holds to, in priority order:
///
///  1. There is no withdraw-to-self path of any kind. Value leaves a pot only
///     as a payout to a destination listed at creation, or as a funder
///     redeeming their own shares.
///  2. Safety of funds beats liveness of payouts. If every approver loses
///     their keys, no payout can ever happen again, and every funder can still
///     take their money out. Exits are never gated on freeze, close, approvals
///     or anyone else's cooperation.
///  3. There is no owner, no admin, no pause, no upgrade path and no
///     delegatecall. Nothing in this contract can be changed after deployment.
///  4. Pots are fully isolated. No storage write made on behalf of one pot can
///     change what another pot owes its funders.
///
/// Accounting is ERC4626 style. Funding mints shares at the current value per
/// share, so a later funder never pays for spending that happened before they
/// joined. Payouts and fees reduce pot assets without burning shares, so every
/// funder bears spending in proportion to their stake. Pot assets are tracked
/// in storage and never derived from the token balance, so a direct transfer
/// to this contract cannot move any share price.
contract NivPayPots is ReentrancyGuard {
    using SafeERC20 for IERC20;
    using Math for uint256;

    // ---------------------------------------------------------------------
    // Constants
    // ---------------------------------------------------------------------

    uint256 public constant MAX_APPROVERS = 10;
    uint256 public constant MAX_DESTINATIONS = 10;
    uint256 public constant PROPOSAL_TTL = 7 days;
    uint256 public constant MAX_FEE_BPS = 100;
    uint256 public constant BPS_DENOMINATOR = 10_000;

    /// @notice Virtual shares and virtual assets offset, as in OpenZeppelin's
    /// ERC4626. Conversions behave as if the pot always held 10**3 extra
    /// shares against 1 extra asset unit, which bounds the value a rounding
    /// error can move and keeps a pot with zero shares well defined.
    ///
    /// The offset is 3 rather than 6 on purpose. The share inflation attack
    /// the larger offsets defend against is already impossible here, because
    /// pot assets come from internal accounting and a donated token balance is
    /// invisible to every conversion. A smaller offset leaves more headroom in
    /// uint256 for the share supply growth described on _convertToShares.
    uint256 public constant DECIMALS_OFFSET = 3;

    // ---------------------------------------------------------------------
    // Immutables
    // ---------------------------------------------------------------------

    /// @notice The one token every pot is denominated in. AUSD on Monad.
    IERC20 public immutable token;

    /// @notice Fee in basis points charged on a successful payout, on top of
    /// the payout amount. Never charged on funding, exits, claims, closes or
    /// refunds. Can never exceed MAX_FEE_BPS.
    uint256 public immutable feeBps;

    /// @notice Absolute ceiling on the fee taken from any single payout.
    uint256 public immutable feeCap;

    /// @notice The only address that can collect accrued fees.
    address public immutable feeRecipient;

    // ---------------------------------------------------------------------
    // Types
    // ---------------------------------------------------------------------

    struct Destination {
        address to;
        bytes32 label;
        uint256 cap;
        uint256 spent;
    }

    struct Pot {
        bytes32 purpose;
        uint64 endTime;
        uint8 threshold;
        bool closedFlag;
        bool frozen;
        uint256 totalAssets;
        uint256 totalShares;
    }

    enum ProposalKind {
        Payout,
        Close,
        Unfreeze
    }

    enum ProposalStatus {
        Pending,
        Executed,
        Cancelled,
        Expired
    }

    struct Proposal {
        uint256 potId;
        ProposalKind kind;
        uint16 destIndex;
        uint256 amount;
        address proposer;
        uint64 createdAt;
        uint8 approvals;
        bool executed;
        bool cancelled;
    }

    // ---------------------------------------------------------------------
    // Storage
    // ---------------------------------------------------------------------

    uint256 public potCount;
    uint256 public proposalCount;

    /// @notice Fees taken from payouts and not yet collected. Held back rather
    /// than pushed, so that a fee recipient frozen by the token's asset
    /// controls cannot brick payouts for every pot in the contract.
    uint256 public feesAccrued;

    mapping(uint256 potId => Pot) private _pots;
    mapping(uint256 potId => address[]) private _approvers;
    mapping(uint256 potId => mapping(address account => bool)) private _isApprover;
    mapping(uint256 potId => Destination[]) private _destinations;
    mapping(uint256 potId => mapping(address funder => uint256)) private _shares;

    mapping(uint256 proposalId => Proposal) private _proposals;
    mapping(uint256 proposalId => mapping(address approver => bool)) private _approved;

    // ---------------------------------------------------------------------
    // Events
    // ---------------------------------------------------------------------

    event PotCreated(
        uint256 indexed potId,
        address indexed creator,
        bytes32 purpose,
        address[] approvers,
        uint8 threshold,
        address[] destinations,
        bytes32[] destinationLabels,
        uint256[] destinationCaps,
        uint64 endTime
    );
    event Funded(uint256 indexed potId, address indexed funder, uint256 assets, uint256 sharesMinted);
    event Exited(uint256 indexed potId, address indexed funder, uint256 sharesBurned, uint256 assets);
    event Claimed(uint256 indexed potId, address indexed funder, uint256 sharesBurned, uint256 assets);
    event Proposed(
        uint256 indexed proposalId,
        uint256 indexed potId,
        address indexed proposer,
        ProposalKind kind,
        uint16 destIndex,
        uint256 amount,
        uint64 expiresAt
    );
    event Approved(uint256 indexed proposalId, uint256 indexed potId, address indexed approver, uint8 approvals);
    event ApprovalRevoked(uint256 indexed proposalId, uint256 indexed potId, address indexed approver, uint8 approvals);
    event ProposalCancelled(uint256 indexed proposalId, uint256 indexed potId, address indexed proposer);
    event PayoutExecuted(
        uint256 indexed proposalId,
        uint256 indexed potId,
        address indexed destination,
        uint16 destIndex,
        uint256 amount,
        uint256 fee
    );
    event Frozen(uint256 indexed potId, address indexed approver);
    event Unfrozen(uint256 indexed potId, uint256 indexed proposalId);
    event Closed(uint256 indexed potId, bool viaProposal, uint256 remainingAssets);
    event FeesCollected(address indexed feeRecipient, uint256 amount);

    // ---------------------------------------------------------------------
    // Errors
    // ---------------------------------------------------------------------

    error ZeroAddress();
    error FeeTooHigh();
    error NoSuchPot();
    error NoSuchProposal();
    error NoSuchDestination();
    error EmptyPurpose();
    error BadApproverCount();
    error BadDestinationCount();
    error DuplicateApprover();
    error BadThreshold();
    error ZeroCap();
    error EndTimeInPast();
    error ArrayLengthMismatch();
    error NotApprover();
    error NotProposer();
    error NotFeeRecipient();
    error PotClosed();
    error PotNotClosed();
    error PotFrozen();
    error PotNotFrozen();
    error ZeroAmount();
    error ZeroShares();
    error InsufficientShares();
    error TransferAmountMismatch();
    error ProposalNotPending();
    error ProposalExpired();
    error AlreadyApproved();
    error NotApproved();
    error CapExceeded();
    error InsufficientPotAssets();
    error NothingToCollect();

    // ---------------------------------------------------------------------
    // Constructor
    // ---------------------------------------------------------------------

    /// @param token_ The single settlement token. AUSD on Monad, 6 decimals.
    /// @param feeBps_ Payout fee in basis points. Capped at MAX_FEE_BPS forever.
    /// @param feeCap_ Absolute ceiling on the fee taken from one payout.
    /// @param feeRecipient_ The only address allowed to collect accrued fees.
    constructor(IERC20 token_, uint256 feeBps_, uint256 feeCap_, address feeRecipient_) {
        if (address(token_) == address(0) || feeRecipient_ == address(0)) revert ZeroAddress();
        if (feeBps_ > MAX_FEE_BPS) revert FeeTooHigh();
        token = token_;
        feeBps = feeBps_;
        feeCap = feeCap_;
        feeRecipient = feeRecipient_;
    }

    // ---------------------------------------------------------------------
    // Pot creation
    // ---------------------------------------------------------------------

    /// @notice Create a pot. Every parameter here is fixed for the life of the
    /// pot. There is no function anywhere in this contract that edits an
    /// approver list, a threshold, a destination, a cap, a purpose or an end
    /// time after this call returns.
    function createPot(
        bytes32 purpose,
        address[] calldata approvers_,
        uint8 threshold,
        address[] calldata destinations_,
        bytes32[] calldata destinationLabels,
        uint256[] calldata destinationCaps,
        uint64 endTime
    ) external returns (uint256 potId) {
        if (purpose == bytes32(0)) revert EmptyPurpose();
        if (approvers_.length == 0 || approvers_.length > MAX_APPROVERS) revert BadApproverCount();
        if (destinations_.length == 0 || destinations_.length > MAX_DESTINATIONS) revert BadDestinationCount();
        if (destinations_.length != destinationLabels.length || destinations_.length != destinationCaps.length) {
            revert ArrayLengthMismatch();
        }
        if (threshold == 0 || threshold > approvers_.length) revert BadThreshold();
        if (endTime <= block.timestamp) revert EndTimeInPast();

        potId = potCount++;
        Pot storage pot = _pots[potId];
        pot.purpose = purpose;
        pot.endTime = endTime;
        pot.threshold = threshold;

        // Bounded by MAX_APPROVERS. Uniqueness is enforced through the
        // membership mapping rather than a nested loop.
        for (uint256 i = 0; i < approvers_.length; ++i) {
            address a = approvers_[i];
            if (a == address(0)) revert ZeroAddress();
            if (_isApprover[potId][a]) revert DuplicateApprover();
            _isApprover[potId][a] = true;
            _approvers[potId].push(a);
        }

        // Bounded by MAX_DESTINATIONS.
        for (uint256 i = 0; i < destinations_.length; ++i) {
            address d = destinations_[i];
            if (d == address(0) || d == address(this)) revert ZeroAddress();
            if (destinationCaps[i] == 0) revert ZeroCap();
            _destinations[potId].push(
                Destination({to: d, label: destinationLabels[i], cap: destinationCaps[i], spent: 0})
            );
        }

        emit PotCreated(
            potId,
            msg.sender,
            purpose,
            approvers_,
            threshold,
            destinations_,
            destinationLabels,
            destinationCaps,
            endTime
        );
    }

    // ---------------------------------------------------------------------
    // Funding
    // ---------------------------------------------------------------------

    /// @notice Fund an open pot. Anyone can fund any open pot.
    function fund(uint256 potId, uint256 amount) external nonReentrant returns (uint256 sharesMinted) {
        return _fund(potId, amount);
    }

    /// @notice Fund using an EIP-2612 permit, so approval and funding are one
    /// transaction.
    /// @dev The permit is wrapped in try/catch on purpose. An attacker who
    /// sees the signed permit in the mempool can submit it first, which would
    /// make a bare permit call revert and grief the funder for no gain. If the
    /// permit fails for any reason, funding continues and simply relies on the
    /// allowance already being in place, which it is in exactly that case.
    function fundWithPermit(uint256 potId, uint256 amount, uint256 deadline, uint8 v, bytes32 r, bytes32 s)
        external
        nonReentrant
        returns (uint256 sharesMinted)
    {
        try IERC20Permit(address(token)).permit(msg.sender, address(this), amount, deadline, v, r, s) {} catch {}
        return _fund(potId, amount);
    }

    function _fund(uint256 potId, uint256 amount) private returns (uint256 sharesMinted) {
        Pot storage pot = _requirePot(potId);
        if (_isClosed(pot)) revert PotClosed();
        if (pot.frozen) revert PotFrozen();
        if (amount == 0) revert ZeroAmount();

        // Interaction before effects, guarded by nonReentrant. The exact
        // balance delta is the only honest way to reject a token that takes a
        // transfer fee or otherwise credits less than it was asked for, and it
        // cannot be measured before the transfer happens. Nothing is written
        // to storage until the delta is confirmed, so a reentrant call would
        // see the pre-funding state and cannot mint against it.
        uint256 balanceBefore = token.balanceOf(address(this));
        token.safeTransferFrom(msg.sender, address(this), amount);
        if (token.balanceOf(address(this)) - balanceBefore != amount) revert TransferAmountMismatch();

        // Rounds down, so the funder never receives a share more than the
        // assets they brought are worth.
        sharesMinted = _convertToShares(pot, amount, Math.Rounding.Floor);
        if (sharesMinted == 0) revert ZeroShares();

        pot.totalAssets += amount;
        pot.totalShares += sharesMinted;
        _shares[potId][msg.sender] += sharesMinted;

        emit Funded(potId, msg.sender, amount, sharesMinted);
    }

    // ---------------------------------------------------------------------
    // Exits and claims
    // ---------------------------------------------------------------------

    /// @notice Burn shares for their pro-rata share of the pot's unspent
    /// assets. Works in every pot state. A freeze, a pending proposal, a
    /// hostile approver or an approver set that has lost its keys cannot stop
    /// it, and it touches nobody's balance but the caller's.
    function exit(uint256 potId, uint256 shares) external nonReentrant returns (uint256 assets) {
        return _redeem(potId, shares);
    }

    /// @notice Burn every share the caller holds in a closed pot. Pull only.
    /// Nothing is ever pushed to funders in a loop.
    function claim(uint256 potId) external nonReentrant returns (uint256 assets) {
        Pot storage pot = _requirePot(potId);
        if (!_isClosed(pot)) revert PotNotClosed();
        return _redeem(potId, _shares[potId][msg.sender]);
    }

    function _redeem(uint256 potId, uint256 shares) private returns (uint256 assets) {
        Pot storage pot = _requirePot(potId);
        if (shares == 0) revert ZeroShares();
        uint256 held = _shares[potId][msg.sender];
        if (shares > held) revert InsufficientShares();

        // Rounds down, so the caller never takes an asset unit more than their
        // shares are worth and the rounding dust stays with the pot.
        assets = _convertToAssets(pot, shares, Math.Rounding.Floor);

        _shares[potId][msg.sender] = held - shares;
        pot.totalShares -= shares;
        pot.totalAssets -= assets;

        if (assets != 0) token.safeTransfer(msg.sender, assets);

        if (_isClosed(pot)) {
            emit Claimed(potId, msg.sender, shares, assets);
        } else {
            emit Exited(potId, msg.sender, shares, assets);
        }
    }

    // ---------------------------------------------------------------------
    // Proposals
    // ---------------------------------------------------------------------

    /// @notice Propose paying a listed destination. Proposing counts as the
    /// proposer's own approval, so a 1 of n pot pays out in this call.
    function proposePayout(uint256 potId, uint16 destIndex, uint256 amount)
        external
        nonReentrant
        returns (uint256 proposalId)
    {
        Pot storage pot = _requirePot(potId);
        if (_isClosed(pot)) revert PotClosed();
        if (pot.frozen) revert PotFrozen();
        if (destIndex >= _destinations[potId].length) revert NoSuchDestination();
        if (amount == 0) revert ZeroAmount();
        return _propose(potId, pot, ProposalKind.Payout, destIndex, amount);
    }

    /// @notice Propose closing the pot before its end time.
    function proposeClose(uint256 potId) external nonReentrant returns (uint256 proposalId) {
        Pot storage pot = _requirePot(potId);
        if (_isClosed(pot)) revert PotClosed();
        return _propose(potId, pot, ProposalKind.Close, 0, 0);
    }

    /// @notice Propose lifting a freeze. One approver can freeze, but it takes
    /// the full threshold to unfreeze.
    function proposeUnfreeze(uint256 potId) external nonReentrant returns (uint256 proposalId) {
        Pot storage pot = _requirePot(potId);
        if (!pot.frozen) revert PotNotFrozen();
        return _propose(potId, pot, ProposalKind.Unfreeze, 0, 0);
    }

    function _propose(uint256 potId, Pot storage pot, ProposalKind kind, uint16 destIndex, uint256 amount)
        private
        returns (uint256 proposalId)
    {
        if (!_isApprover[potId][msg.sender]) revert NotApprover();

        proposalId = proposalCount++;
        Proposal storage p = _proposals[proposalId];
        p.potId = potId;
        p.kind = kind;
        p.destIndex = destIndex;
        p.amount = amount;
        p.proposer = msg.sender;
        p.createdAt = uint64(block.timestamp);
        p.approvals = 1;
        _approved[proposalId][msg.sender] = true;

        emit Proposed(proposalId, potId, msg.sender, kind, destIndex, amount, uint64(block.timestamp + PROPOSAL_TTL));
        emit Approved(proposalId, potId, msg.sender, 1);

        if (p.approvals >= pot.threshold) _execute(proposalId, p, pot);
    }

    /// @notice Approve a pending proposal. The approval that reaches the
    /// threshold executes the proposal in this same transaction.
    function approve(uint256 proposalId) external nonReentrant {
        Proposal storage p = _requireProposal(proposalId);
        uint256 potId = p.potId;
        Pot storage pot = _pots[potId];

        if (!_isApprover[potId][msg.sender]) revert NotApprover();
        if (p.executed || p.cancelled) revert ProposalNotPending();
        if (block.timestamp > p.createdAt + PROPOSAL_TTL) revert ProposalExpired();
        if (_approved[proposalId][msg.sender]) revert AlreadyApproved();
        // A freeze halts payouts. Close and unfreeze proposals stay usable,
        // since an unfreeze proposal is the only way out of a freeze.
        if (p.kind == ProposalKind.Payout && pot.frozen) revert PotFrozen();

        _approved[proposalId][msg.sender] = true;
        uint8 approvals = p.approvals + 1;
        p.approvals = approvals;
        emit Approved(proposalId, potId, msg.sender, approvals);

        if (approvals >= pot.threshold) _execute(proposalId, p, pot);
    }

    /// @notice Withdraw an approval from a proposal that has not executed.
    function revokeApproval(uint256 proposalId) external {
        Proposal storage p = _requireProposal(proposalId);
        if (p.executed || p.cancelled) revert ProposalNotPending();
        if (!_approved[proposalId][msg.sender]) revert NotApproved();

        _approved[proposalId][msg.sender] = false;
        uint8 approvals = p.approvals - 1;
        p.approvals = approvals;
        emit ApprovalRevoked(proposalId, p.potId, msg.sender, approvals);
    }

    /// @notice Cancel a proposal. Only the proposer can.
    function cancelProposal(uint256 proposalId) external {
        Proposal storage p = _requireProposal(proposalId);
        if (msg.sender != p.proposer) revert NotProposer();
        if (p.executed || p.cancelled) revert ProposalNotPending();

        p.cancelled = true;
        emit ProposalCancelled(proposalId, p.potId, msg.sender);
    }

    function _execute(uint256 proposalId, Proposal storage p, Pot storage pot) private {
        if (p.kind == ProposalKind.Payout) {
            _executePayout(proposalId, p, pot);
        } else if (p.kind == ProposalKind.Close) {
            if (_isClosed(pot)) revert PotClosed();
            p.executed = true;
            pot.closedFlag = true;
            emit Closed(p.potId, true, pot.totalAssets);
        } else {
            if (!pot.frozen) revert PotNotFrozen();
            p.executed = true;
            pot.frozen = false;
            emit Unfrozen(p.potId, proposalId);
        }
    }

    function _executePayout(uint256 proposalId, Proposal storage p, Pot storage pot) private {
        uint256 potId = p.potId;
        if (_isClosed(pot)) revert PotClosed();
        if (pot.frozen) revert PotFrozen();

        Destination storage d = _destinations[potId][p.destIndex];
        uint256 amount = p.amount;

        // The cap governs the payout amount only. The fee is charged on top
        // and does not consume the destination's remaining cap.
        uint256 spent = d.spent + amount;
        if (spent > d.cap) revert CapExceeded();

        uint256 fee = _feeOn(amount);

        // If the pot cannot cover amount plus fee right now, this approving
        // transaction reverts and the proposal stays pending. Nothing is
        // consumed, and the same proposal can execute later once the pot has
        // been funded again.
        uint256 assets = pot.totalAssets;
        if (assets < amount + fee) revert InsufficientPotAssets();

        p.executed = true;
        d.spent = spent;
        pot.totalAssets = assets - amount - fee;

        // The fee is credited, not pushed. The fee recipient is one address
        // shared by every pot, and the token has asset freezing controls. If
        // the fee were transferred here, freezing that single address would
        // revert every payout in every pot forever, with no admin and no
        // upgrade to undo it. Crediting keeps pots isolated: a frozen fee
        // recipient can only ever block its own collectFees call.
        feesAccrued += fee;

        // A destination frozen by the token's asset controls makes this revert
        // and the whole payout unwinds, leaving the proposal pending. It
        // cannot affect any other destination, any other pot, or anybody's
        // exit or claim.
        token.safeTransfer(d.to, amount);

        emit PayoutExecuted(proposalId, potId, d.to, p.destIndex, amount, fee);
    }

    // ---------------------------------------------------------------------
    // Freeze and close
    // ---------------------------------------------------------------------

    /// @notice Any single approver can freeze a pot. A freeze halts payouts
    /// and new funding. It never touches exits or claims.
    function freeze(uint256 potId) external {
        Pot storage pot = _requirePot(potId);
        if (!_isApprover[potId][msg.sender]) revert NotApprover();
        if (pot.frozen) revert PotFrozen();
        pot.frozen = true;
        emit Frozen(potId, msg.sender);
    }

    /// @notice Record that a pot has reached its end time. Permissionless, and
    /// only there so the Closed event exists for pots that were never closed
    /// by proposal. A pot past its end time behaves as closed whether or not
    /// this has been called.
    function closePot(uint256 potId) external {
        Pot storage pot = _requirePot(potId);
        if (pot.closedFlag) revert PotClosed();
        if (block.timestamp < pot.endTime) revert PotNotClosed();
        pot.closedFlag = true;
        emit Closed(potId, false, pot.totalAssets);
    }

    // ---------------------------------------------------------------------
    // Fees
    // ---------------------------------------------------------------------

    /// @notice Collect fees accrued from payouts. Only the fee recipient can,
    /// and it moves nothing that belongs to any pot.
    function collectFees() external nonReentrant returns (uint256 amount) {
        if (msg.sender != feeRecipient) revert NotFeeRecipient();
        amount = feesAccrued;
        if (amount == 0) revert NothingToCollect();
        feesAccrued = 0;
        token.safeTransfer(feeRecipient, amount);
        emit FeesCollected(feeRecipient, amount);
    }

    // ---------------------------------------------------------------------
    // Internal helpers
    // ---------------------------------------------------------------------

    function _requirePot(uint256 potId) private view returns (Pot storage pot) {
        if (potId >= potCount) revert NoSuchPot();
        pot = _pots[potId];
    }

    function _requireProposal(uint256 proposalId) private view returns (Proposal storage p) {
        if (proposalId >= proposalCount) revert NoSuchProposal();
        p = _proposals[proposalId];
    }

    function _isClosed(Pot storage pot) private view returns (bool) {
        return pot.closedFlag || block.timestamp >= pot.endTime;
    }

    function _feeOn(uint256 amount) private view returns (uint256 fee) {
        fee = Math.mulDiv(amount, feeBps, BPS_DENOMINATOR, Math.Rounding.Floor);
        if (fee > feeCap) fee = feeCap;
    }

    /// @dev Virtual shares and virtual assets, as in OpenZeppelin's ERC4626.
    ///
    /// A pot that has been fully spent still has a live share supply, and
    /// every one of those shares is worth exactly zero. Funding it again is
    /// allowed and correct: the new funder receives essentially the entire
    /// supply, because the old shares have no claim on anything. The cost is
    /// that the supply is multiplied by roughly the funded amount on each such
    /// refund, so a pot that is drained to zero and refunded many times over
    /// will eventually overflow uint256 and stop accepting new funding. Every
    /// funder can still exit at that point, and the pot can be replaced. This
    /// is documented rather than papered over, because the alternative of
    /// resetting the supply would silently detach per funder share balances
    /// from the total.
    function _convertToShares(Pot storage pot, uint256 assets, Math.Rounding rounding)
        private
        view
        returns (uint256)
    {
        return assets.mulDiv(pot.totalShares + 10 ** DECIMALS_OFFSET, pot.totalAssets + 1, rounding);
    }

    function _convertToAssets(Pot storage pot, uint256 shares, Math.Rounding rounding)
        private
        view
        returns (uint256)
    {
        return shares.mulDiv(pot.totalAssets + 1, pot.totalShares + 10 ** DECIMALS_OFFSET, rounding);
    }

    // ---------------------------------------------------------------------
    // Views
    // ---------------------------------------------------------------------

    struct PotView {
        bytes32 purpose;
        uint64 endTime;
        uint8 threshold;
        uint8 approverCount;
        uint8 destinationCount;
        bool closed;
        bool frozen;
        uint256 totalAssets;
        uint256 totalShares;
    }

    /// @notice Everything about a pot that fits in one call.
    function getPot(uint256 potId) external view returns (PotView memory) {
        Pot storage pot = _requirePot(potId);
        return PotView({
            purpose: pot.purpose,
            endTime: pot.endTime,
            threshold: pot.threshold,
            approverCount: uint8(_approvers[potId].length),
            destinationCount: uint8(_destinations[potId].length),
            closed: _isClosed(pot),
            frozen: pot.frozen,
            totalAssets: pot.totalAssets,
            totalShares: pot.totalShares
        });
    }

    function getApprovers(uint256 potId) external view returns (address[] memory) {
        _requirePot(potId);
        return _approvers[potId];
    }

    function isApprover(uint256 potId, address account) external view returns (bool) {
        return _isApprover[potId][account];
    }

    /// @notice Every destination with its cap and what it has been paid.
    function getDestinations(uint256 potId) external view returns (Destination[] memory) {
        _requirePot(potId);
        return _destinations[potId];
    }

    /// @notice One destination's spend against its cap.
    function getDestination(uint256 potId, uint256 index)
        external
        view
        returns (address to, bytes32 label, uint256 cap, uint256 spent, uint256 remaining)
    {
        _requirePot(potId);
        if (index >= _destinations[potId].length) revert NoSuchDestination();
        Destination storage d = _destinations[potId][index];
        return (d.to, d.label, d.cap, d.spent, d.cap - d.spent);
    }

    /// @notice A funder's share balance and what those shares are worth right
    /// now, using the same rounding an exit would use.
    function funderInfo(uint256 potId, address funder) external view returns (uint256 shares, uint256 redeemable) {
        Pot storage pot = _requirePot(potId);
        shares = _shares[potId][funder];
        redeemable = _convertToAssets(pot, shares, Math.Rounding.Floor);
    }

    function sharesOf(uint256 potId, address funder) external view returns (uint256) {
        return _shares[potId][funder];
    }

    /// @notice Shares that funding `assets` into this pot would mint right now.
    function previewFund(uint256 potId, uint256 assets) external view returns (uint256) {
        Pot storage pot = _requirePot(potId);
        return _convertToShares(pot, assets, Math.Rounding.Floor);
    }

    /// @notice Assets that burning `shares` in this pot would return right now.
    function previewExit(uint256 potId, uint256 shares) external view returns (uint256) {
        Pot storage pot = _requirePot(potId);
        return _convertToAssets(pot, shares, Math.Rounding.Floor);
    }

    /// @notice Fee that a payout of `amount` would cost the pot on top of the
    /// amount itself.
    function feeOn(uint256 amount) external view returns (uint256) {
        return _feeOn(amount);
    }

    struct ProposalView {
        uint256 potId;
        ProposalKind kind;
        ProposalStatus status;
        uint16 destIndex;
        address destination;
        uint256 amount;
        uint256 fee;
        address proposer;
        uint64 createdAt;
        uint64 expiresAt;
        uint8 approvals;
        uint8 threshold;
        address[] approvedBy;
    }

    /// @notice A proposal's full status including who has approved it.
    function proposalInfo(uint256 proposalId) external view returns (ProposalView memory info) {
        Proposal storage p = _requireProposal(proposalId);
        uint256 potId = p.potId;
        Pot storage pot = _pots[potId];

        ProposalStatus status;
        if (p.executed) {
            status = ProposalStatus.Executed;
        } else if (p.cancelled) {
            status = ProposalStatus.Cancelled;
        } else if (block.timestamp > p.createdAt + PROPOSAL_TTL) {
            status = ProposalStatus.Expired;
        } else {
            status = ProposalStatus.Pending;
        }

        // Bounded by MAX_APPROVERS.
        address[] storage approvers_ = _approvers[potId];
        address[] memory approvedBy = new address[](p.approvals);
        uint256 n = 0;
        for (uint256 i = 0; i < approvers_.length; ++i) {
            if (_approved[proposalId][approvers_[i]] && n < approvedBy.length) {
                approvedBy[n++] = approvers_[i];
            }
        }

        info = ProposalView({
            potId: potId,
            kind: p.kind,
            status: status,
            destIndex: p.destIndex,
            destination: p.kind == ProposalKind.Payout ? _destinations[potId][p.destIndex].to : address(0),
            amount: p.amount,
            fee: p.kind == ProposalKind.Payout ? _feeOn(p.amount) : 0,
            proposer: p.proposer,
            createdAt: p.createdAt,
            expiresAt: p.createdAt + uint64(PROPOSAL_TTL),
            approvals: p.approvals,
            threshold: pot.threshold,
            approvedBy: approvedBy
        });
    }

    function hasApproved(uint256 proposalId, address approver) external view returns (bool) {
        return _approved[proposalId][approver];
    }
}
