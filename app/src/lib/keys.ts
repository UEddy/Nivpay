import { createSecp256k1SigningSession, getEvmAddress, type Secp256k1SigningSession } from "@category-labs/mera";
import { HDKey } from "@scure/bip32";
import { entropyToMnemonic, mnemonicToSeedSync } from "@scure/bip39";
import { wordlist } from "@scure/bip39/wordlists/english.js";
import { getAddress, type Address } from "viem";

/** The account's HD path, per docs/BUILD-APP.md. */
export const HD_PATH = "m/44'/60'/0'/0/0";

/**
 * Turns a passkey's PRF output into a live signing session, exactly as Mera's
 * docs describe: PRF output as BIP-39 entropy, mnemonic to seed, seed to the
 * HD key at HD_PATH.
 *
 * Everything secret on the way is wiped before this returns, whether it
 * succeeds or throws: the PRF output, the seed, and both HD keys. The session
 * holds its own copy of the private key and zeroes it on end(). The mnemonic
 * is a JavaScript string, which cannot be zeroed; it is dropped here and never
 * leaves this function.
 *
 * The caller must end() the session as soon as it has signed.
 */
export function sessionFromPrfOutput(prfOutput: Uint8Array): Secp256k1SigningSession {
  let seed: Uint8Array | undefined;
  let master: HDKey | undefined;
  let child: HDKey | undefined;
  try {
    seed = mnemonicToSeedSync(entropyToMnemonic(prfOutput, wordlist));
    master = HDKey.fromMasterSeed(seed);
    child = master.derive(HD_PATH);
    const privateKey = child.privateKey;
    if (!privateKey) throw new Error("HD derivation produced no private key");
    return createSecp256k1SigningSession({ privateKey });
  } finally {
    prfOutput.fill(0);
    seed?.fill(0);
    child?.wipePrivateData();
    master?.wipePrivateData();
  }
}

/** The account address of a session, EIP-55 checksummed. */
export function sessionAddress(session: Secp256k1SigningSession): Address {
  return getAddress(getEvmAddress(session.publicKey));
}
