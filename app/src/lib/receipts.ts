import { getAddress, isHex, type Address, type Hex } from "viem";

/**
 * The explorer the contracts are verified on (README, Deployments): MonadVision
 * reads Monad's Sourcify, where all three have an exact match. Kept out of the
 * screens, which may not spell any of this.
 */
export const RECEIPT_EXPLORER = "https://testnet.monadvision.com";

export function receiptUrl(hash: Hex): string {
  return `${RECEIPT_EXPLORER}/tx/${hash}`;
}

/**
 * The latest request of each account that landed at Finalized: making a pot,
 * a pour in, or an Add test dollars claim. Only the account and the
 * transaction hash are stored, both public. Shown as "View receipt" in
 * Account details.
 */
type KeyValue = Pick<Storage, "getItem" | "setItem">;

const KEY = "nivpay.receipt.v1.";

export class ReceiptStore {
  private readonly kv: KeyValue;

  constructor(kv: KeyValue) {
    this.kv = kv;
  }

  remember(address: Address, hash: Hex): void {
    this.kv.setItem(KEY + getAddress(address), hash);
  }

  latest(address: Address): Hex | undefined {
    const hash = this.kv.getItem(KEY + getAddress(address));
    return hash && isHex(hash) && hash.length === 66 ? hash : undefined;
  }
}

/** Records a finalized request on this phone. Never throws: a receipt link is a convenience. */
export function rememberReceipt(address: Address, hash: Hex): void {
  try {
    new ReceiptStore(localStorage).remember(address, hash);
  } catch {
    // Storage full or unavailable; the request itself already landed.
  }
}

export function latestReceipt(address: Address): Hex | undefined {
  try {
    return new ReceiptStore(localStorage).latest(address);
  } catch {
    return undefined;
  }
}
