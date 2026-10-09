// The subset of the contracts' ABIs the app reads and calls.

export const POTS_READ_ABI = [
  { type: "function", name: "potCount", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "token", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  { type: "function", name: "feeBps", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "feeCap", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
] as const;

export const ERC20_READ_ABI = [
  { type: "function", name: "symbol", stateMutability: "view", inputs: [], outputs: [{ type: "string" }] },
  { type: "function", name: "decimals", stateMutability: "view", inputs: [], outputs: [{ type: "uint8" }] },
  {
    type: "function",
    name: "balanceOf",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ type: "uint256" }],
  },
] as const;

export const TEST_DOLLAR_ABI = [
  { type: "function", name: "MAX_MINT", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  {
    type: "function",
    name: "mint",
    stateMutability: "nonpayable",
    inputs: [
      { name: "to", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [],
  },
] as const;

/**
 * The parts of NivPayPots the screens use, copied from the Foundry build
 * (out/NivPayPots.sol/NivPayPots.json). abi.test.ts checks them against that
 * file whenever it exists. Every custom error is listed so reverts decode.
 */
export const POTS_ABI = [
  { type: "function", name: "createPot", stateMutability: "nonpayable", inputs: [{ name: "purpose", type: "bytes32" }, { name: "approvers_", type: "address[]" }, { name: "threshold", type: "uint8" }, { name: "destinations_", type: "address[]" }, { name: "destinationLabels", type: "bytes32[]" }, { name: "destinationCaps", type: "uint256[]" }, { name: "endTime", type: "uint64" }], outputs: [{ name: "potId", type: "uint256" }] },
  { type: "function", name: "getPot", stateMutability: "view", inputs: [{ name: "potId", type: "uint256" }], outputs: [{ name: "", type: "tuple", components: [{ name: "purpose", type: "bytes32" }, { name: "endTime", type: "uint64" }, { name: "threshold", type: "uint8" }, { name: "approverCount", type: "uint8" }, { name: "destinationCount", type: "uint8" }, { name: "closed", type: "bool" }, { name: "frozen", type: "bool" }, { name: "totalAssets", type: "uint256" }, { name: "totalShares", type: "uint256" }] }] },
  { type: "function", name: "getApprovers", stateMutability: "view", inputs: [{ name: "potId", type: "uint256" }], outputs: [{ name: "", type: "address[]" }] },
  { type: "function", name: "getDestinations", stateMutability: "view", inputs: [{ name: "potId", type: "uint256" }], outputs: [{ name: "", type: "tuple[]", components: [{ name: "to", type: "address" }, { name: "label", type: "bytes32" }, { name: "cap", type: "uint256" }, { name: "spent", type: "uint256" }] }] },
  { type: "function", name: "potCount", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "uint256" }] },
  { type: "function", name: "MAX_APPROVERS", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "uint256" }] },
  { type: "function", name: "MAX_DESTINATIONS", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "uint256" }] },
  { type: "event", name: "PotCreated", inputs: [{ name: "potId", type: "uint256", indexed: true }, { name: "creator", type: "address", indexed: true }, { name: "purpose", type: "bytes32", indexed: false }, { name: "approvers", type: "address[]", indexed: false }, { name: "threshold", type: "uint8", indexed: false }, { name: "destinations", type: "address[]", indexed: false }, { name: "destinationLabels", type: "bytes32[]", indexed: false }, { name: "destinationCaps", type: "uint256[]", indexed: false }, { name: "endTime", type: "uint64", indexed: false }], anonymous: false },
  { type: "error", name: "AlreadyApproved", inputs: [] },
  { type: "error", name: "ArrayLengthMismatch", inputs: [] },
  { type: "error", name: "BadApproverCount", inputs: [] },
  { type: "error", name: "BadDestinationCount", inputs: [] },
  { type: "error", name: "BadThreshold", inputs: [] },
  { type: "error", name: "CapExceeded", inputs: [] },
  { type: "error", name: "DuplicateApprover", inputs: [] },
  { type: "error", name: "EmptyPurpose", inputs: [] },
  { type: "error", name: "EndTimeInPast", inputs: [] },
  { type: "error", name: "FeeTooHigh", inputs: [] },
  { type: "error", name: "InsufficientPotAssets", inputs: [] },
  { type: "error", name: "InsufficientShares", inputs: [] },
  { type: "error", name: "NoSuchDestination", inputs: [] },
  { type: "error", name: "NoSuchPot", inputs: [] },
  { type: "error", name: "NoSuchProposal", inputs: [] },
  { type: "error", name: "NotApproved", inputs: [] },
  { type: "error", name: "NotApprover", inputs: [] },
  { type: "error", name: "NotFeeRecipient", inputs: [] },
  { type: "error", name: "NotProposer", inputs: [] },
  { type: "error", name: "NothingToCollect", inputs: [] },
  { type: "error", name: "PotClosed", inputs: [] },
  { type: "error", name: "PotFrozen", inputs: [] },
  { type: "error", name: "PotNotClosed", inputs: [] },
  { type: "error", name: "PotNotFrozen", inputs: [] },
  { type: "error", name: "ProposalExpired", inputs: [] },
  { type: "error", name: "ProposalNotPending", inputs: [] },
  { type: "error", name: "ReentrancyGuardReentrantCall", inputs: [] },
  { type: "error", name: "SafeERC20FailedOperation", inputs: [{ name: "token", type: "address" }] },
  { type: "error", name: "TransferAmountMismatch", inputs: [] },
  { type: "error", name: "ZeroAddress", inputs: [] },
  { type: "error", name: "ZeroAmount", inputs: [] },
  { type: "error", name: "ZeroCap", inputs: [] },
  { type: "error", name: "ZeroShares", inputs: [] },
] as const;
