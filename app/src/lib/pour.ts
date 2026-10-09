import { encodeFunctionData, parseSignature, type Address, type Hex, type LocalAccount, type TypedDataDomain } from "viem";
import { ERC20_READ_ABI, POTS_ABI } from "./abi.ts";
import { readPermitDomain } from "./permit.ts";
import { readClient } from "./rpc.ts";

/** Label for a pour-in's pending write record. */
export const POUR_LABEL = "pour in";

/**
 * Gas the account is made ready for before the passkey session opens. The
 * measured cost of a first AUSD pour-in was 260,268 (docs/APP-CONTRACT-MAP.md);
 * the exact limit is estimated on the real data inside the session.
 */
export const POUR_GAS_HINT = 320_000n;

export const PERMIT_TYPES = {
  Permit: [
    { name: "owner", type: "address" },
    { name: "spender", type: "address" },
    { name: "value", type: "uint256" },
    { name: "nonce", type: "uint256" },
    { name: "deadline", type: "uint256" },
  ],
} as const;

export type PermitTerms = { domain: TypedDataDomain; nonce: bigint; deadline: bigint };

/**
 * Everything the permit needs, read before the passkey session: the domain
 * from the token's own eip712Domain() (AUSD's permit name is not its name()),
 * the owner's permit nonce, and a deadline an hour out.
 */
export async function readPermitTerms(asset: Address, owner: Address, nowSeconds: bigint): Promise<PermitTerms> {
  const [domain, nonce] = await Promise.all([
    readPermitDomain(readClient, asset),
    readClient.readContract({ address: asset, abi: ERC20_READ_ABI, functionName: "nonces", args: [owner] }),
  ]);
  return { domain, nonce, deadline: nowSeconds + 3_600n };
}

/** Signs the permit for exactly `amount` to the pots contract and returns fundWithPermit's call data. */
export async function pourData(account: LocalAccount, pots: Address, potId: bigint, amount: bigint, terms: PermitTerms): Promise<Hex> {
  const signature = await account.signTypedData({
    domain: terms.domain,
    types: PERMIT_TYPES,
    primaryType: "Permit",
    message: { owner: account.address, spender: pots, value: amount, nonce: terms.nonce, deadline: terms.deadline },
  });
  const { v, r, s, yParity } = parseSignature(signature);
  return encodeFunctionData({
    abi: POTS_ABI,
    functionName: "fundWithPermit",
    args: [potId, amount, terms.deadline, Number(v ?? BigInt(yParity + 27)), r, s],
  });
}

/** A pour-in's call data is built inside the passkey session (send.ts presign); this stands in until then. */
export const NO_DATA: Hex = "0x";
