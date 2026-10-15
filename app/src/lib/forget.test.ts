import { test } from "node:test";
import assert from "node:assert/strict";
import { getAddress } from "viem";
import { forgetAccount, LastUsedStore } from "./forget.ts";

const ME = getAddress("0x1A9A136f1cf59899C6b8cfE84ac4df388620467d");
const OTHER = getAddress("0x725C9A4Bb4c3dE2F11aC0e7C9b1E8f0D3a2B7bC1");

function memory(seed: Record<string, unknown>) {
  const m = new Map<string, string>(Object.entries(seed).map(([k, v]) => [k, typeof v === "string" ? v : JSON.stringify(v)]));
  return {
    m,
    store: {
      getItem: (k: string) => m.get(k) ?? null,
      setItem: (k: string, v: string) => void m.set(k, v),
      removeItem: (k: string) => void m.delete(k),
      key: (i: number) => [...m.keys()][i] ?? null,
      get length() {
        return m.size;
      },
    },
  };
}

test("removing an account forgets its name, drafts and settings, and nothing of anyone else's", () => {
  const { m, store } = memory({
    "nivpay.accounts.v1": [{ address: ME, name: "Me" }, { address: OTHER, name: "Other" }],
    "nivpay.active.v1": ME,
    "nivpay.drafts.v1": [{ id: "0x01", owner: ME }, { id: "0x02", owner: OTHER }],
    "nivpay.invited.v1": [{ account: ME.toLowerCase() }, { account: OTHER }],
    "nivpay.nameSkipped.v1": [ME, OTHER],
    "nivpay.lastBalance.v1": { [ME]: { readAt: 1 }, [OTHER]: { readAt: 2 } },
    "nivpay.lastused.v1": { [ME]: 1, [OTHER]: 2 },
    [`nivpay.contacts.v1.ausd.${ME}`]: [],
    [`nivpay.limit.v1.testusd.${ME}`]: {},
    [`nivpay.found.v1.ausd.${ME}`]: {},
    [`nivpay.receipt.v1.${ME}`]: "0xabc",
    [`nivpay.contacts.v1.ausd.${OTHER}`]: [{ keep: true }],
    "nivpay.credentials.v1": { [ME]: "cred" },
    "nivpay.potblocks.v1.ausd": { "0": "1" },
    "nivpay.language.v1": "fr",
    "something.else": ME,
  });
  const touched = forgetAccount(store, ME.toLowerCase() as typeof ME);
  assert.deepEqual(JSON.parse(m.get("nivpay.accounts.v1")!), [{ address: OTHER, name: "Other" }]);
  assert.equal(m.has("nivpay.active.v1"), false, "no longer the active account");
  assert.deepEqual(JSON.parse(m.get("nivpay.drafts.v1")!), [{ id: "0x02", owner: OTHER }], "its drafts are gone");
  assert.deepEqual(JSON.parse(m.get("nivpay.invited.v1")!), [{ account: OTHER }]);
  assert.deepEqual(JSON.parse(m.get("nivpay.nameSkipped.v1")!), [OTHER]);
  assert.deepEqual(Object.keys(JSON.parse(m.get("nivpay.lastBalance.v1")!)), [OTHER]);
  assert.deepEqual(Object.keys(JSON.parse(m.get("nivpay.lastused.v1")!)), [OTHER]);
  for (const k of [`nivpay.contacts.v1.ausd.${ME}`, `nivpay.limit.v1.testusd.${ME}`, `nivpay.found.v1.ausd.${ME}`, `nivpay.receipt.v1.${ME}`]) assert.equal(m.has(k), false, k);
  assert.ok(m.has(`nivpay.contacts.v1.ausd.${OTHER}`), "someone else's settings stay");
  assert.ok(m.has("nivpay.credentials.v1"), "the public credential hint stays");
  assert.ok(m.has("nivpay.potblocks.v1.ausd") && m.has("nivpay.language.v1") && m.has("something.else"), "shared and foreign keys stay");
  assert.ok(touched.includes("nivpay.drafts.v1") && touched.includes(`nivpay.limit.v1.testusd.${ME}`));
});

test("removing an account that isn't the active one leaves the active one signed in", () => {
  const { m, store } = memory({ "nivpay.active.v1": OTHER, "nivpay.accounts.v1": [{ address: ME, name: "" }, { address: OTHER, name: "" }] });
  forgetAccount(store, ME);
  assert.equal(m.get("nivpay.active.v1"), OTHER);
});

test("a damaged shared store is left alone, not thrown over", () => {
  const { m, store } = memory({ "nivpay.drafts.v1": "{oops" });
  assert.doesNotThrow(() => forgetAccount(store, ME));
  assert.equal(m.get("nivpay.drafts.v1"), "{oops");
});

test("when each account was last used on this phone", () => {
  const { store } = memory({});
  const used = new LastUsedStore(store);
  assert.equal(used.get(ME), undefined);
  used.touch(ME.toLowerCase() as typeof ME, 5);
  assert.equal(used.get(ME), 5);
});
