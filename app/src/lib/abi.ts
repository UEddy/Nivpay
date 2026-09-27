// The subset of the contracts' ABIs the skeleton reads. The screens in Phase 3
// replace this with the full ABI taken from the Foundry build.

export const POTS_READ_ABI = [
  { type: "function", name: "potCount", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "token", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  { type: "function", name: "feeBps", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "feeCap", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
] as const;

export const ERC20_READ_ABI = [
  { type: "function", name: "symbol", stateMutability: "view", inputs: [], outputs: [{ type: "string" }] },
  { type: "function", name: "decimals", stateMutability: "view", inputs: [], outputs: [{ type: "uint8" }] },
] as const;
