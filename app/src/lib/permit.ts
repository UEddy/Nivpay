import { domainSeparator, getAddress, type Address, type Hex, type TypedDataDomain } from "viem";
import { CHAIN_ID } from "./config.ts";

export const EIP5267_ABI = [
  {
    type: "function",
    name: "eip712Domain",
    stateMutability: "view",
    inputs: [],
    outputs: [
      { name: "fields", type: "bytes1" },
      { name: "name", type: "string" },
      { name: "version", type: "string" },
      { name: "chainId", type: "uint256" },
      { name: "verifyingContract", type: "address" },
      { name: "salt", type: "bytes32" },
      { name: "extensions", type: "uint256[]" },
    ],
  },
  {
    type: "function",
    name: "DOMAIN_SEPARATOR",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "bytes32" }],
  },
] as const;

/** Just the calls this module needs, so tests can pass a stub. */
export type DomainReader = {
  readContract(args: {
    address: Address;
    abi: typeof EIP5267_ABI;
    functionName: "eip712Domain" | "DOMAIN_SEPARATOR";
    blockTag?: "finalized";
  }): Promise<unknown>;
};

type Eip712DomainResult = readonly [Hex, string, string, bigint, Address, Hex, readonly bigint[]];

// EIP-5267 field bits.
const NAME = 0x01;
const VERSION = 0x02;
const CHAIN = 0x04;
const CONTRACT = 0x08;
const SALT = 0x10;

export class PermitDomainError extends Error {}

/**
 * Builds the EIP-712 domain for a token's permit from its own eip712Domain(),
 * never from name() and never from a hardcoded name or version. AUSD is the
 * reason: its name() is "AUSD" but its permit domain name is "Agora Dollar".
 *
 * Refuses to return a domain unless it hashes to the token's
 * DOMAIN_SEPARATOR(), is for chain 10143, and names the token itself as the
 * verifying contract.
 */
export async function readPermitDomain(client: DomainReader, token: Address): Promise<TypedDataDomain> {
  const [raw, separator] = await Promise.all([
    client.readContract({ address: token, abi: EIP5267_ABI, functionName: "eip712Domain", blockTag: "finalized" }),
    client.readContract({ address: token, abi: EIP5267_ABI, functionName: "DOMAIN_SEPARATOR", blockTag: "finalized" }),
  ]);
  const [fieldsHex, name, version, chainId, verifyingContract, salt, extensions] = raw as Eip712DomainResult;
  const fields = Number.parseInt(fieldsHex.slice(2), 16);

  if (extensions.length !== 0) throw new PermitDomainError(`${token}: EIP-5267 extensions are not supported`);

  const domain: TypedDataDomain = {};
  if (fields & NAME) domain.name = name;
  if (fields & VERSION) domain.version = version;
  if (fields & CHAIN) domain.chainId = Number(chainId);
  if (fields & CONTRACT) domain.verifyingContract = getAddress(verifyingContract);
  if (fields & SALT) domain.salt = salt;

  if (domain.chainId !== CHAIN_ID) {
    throw new PermitDomainError(`${token}: permit domain is for chain ${String(domain.chainId)}, not ${CHAIN_ID}`);
  }
  if (domain.verifyingContract !== getAddress(token)) {
    throw new PermitDomainError(`${token}: permit domain names ${String(domain.verifyingContract)} as its contract`);
  }
  const computed = domainSeparator({ domain });
  if (computed.toLowerCase() !== (separator as Hex).toLowerCase()) {
    throw new PermitDomainError(`${token}: domain from eip712Domain() hashes to ${computed}, DOMAIN_SEPARATOR() is ${String(separator)}`);
  }
  return domain;
}
