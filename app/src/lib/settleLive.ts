import { getAddress, isAddressEqual, type Address, type PublicClient } from "viem";
import { ERC20_ALLOWANCE_ABI, ERC20_READ_ABI, SETTLEMENT_PAIR_ABI } from "./abi.ts";
import type { Settlement, SettlementState } from "./settle.ts";

/** How long a quote stays good: the exchange's deadline, in seconds of chain time. */
export const QUOTE_SECONDS = 300n;

/**
 * Reads everything a quote needs at one latest block (a quote must be fresh,
 * and the exchange runs against the latest state), and the deadline from
 * that block's time. Refuses a pair whose currencies aren't the expected two.
 */
export async function readSettlement(
  client: Pick<PublicClient, "getBlock" | "multicall">,
  s: Settlement,
  me: Address,
  amountIn: bigint,
): Promise<{ state: SettlementState; deadline: bigint }> {
  const block = await client.getBlock({ blockTag: "latest" });
  const deadline = block.timestamp + QUOTE_SECONDS;
  const pair = { address: s.pair, abi: SETTLEMENT_PAIR_ABI } as const;
  const [token0, token1, paused, price, priceAtDeadline, fee, amounts, reserveOut, isSetUp, allowance, inDecimals, outDecimals, outSymbol] =
    await client.multicall({
      allowFailure: false,
      blockNumber: block.number,
      contracts: [
        { ...pair, functionName: "token0" },
        { ...pair, functionName: "token1" },
        { ...pair, functionName: "isPaused" },
        { ...pair, functionName: "getPrice", args: [] },
        { ...pair, functionName: "getPrice", args: [deadline] },
        { ...pair, functionName: "token0PurchaseFee" },
        { ...pair, functionName: "getAmountsOut", args: [amountIn, [s.dollar, s.other]] },
        { ...pair, functionName: "reserve0" },
        { ...pair, functionName: "hasRole", args: ["APPROVED_SWAPPER", me] },
        { address: s.dollar, abi: ERC20_ALLOWANCE_ABI, functionName: "allowance", args: [me, s.pair] },
        { address: s.dollar, abi: ERC20_READ_ABI, functionName: "decimals" },
        { address: s.other, abi: ERC20_READ_ABI, functionName: "decimals" },
        { address: s.other, abi: ERC20_READ_ABI, functionName: "symbol" },
      ],
    });
  if (!isAddressEqual(getAddress(token0), s.other) || !isAddressEqual(getAddress(token1), s.dollar)) {
    throw new Error("the settlement pair no longer pairs these two currencies");
  }
  return {
    deadline,
    state: {
      paused,
      price,
      priceAtDeadline,
      fee,
      quotedOut: amounts[1] ?? 0n,
      reserveOut,
      isSetUp,
      allowance,
      inDecimals,
      outDecimals,
      outSymbol,
    },
  };
}
