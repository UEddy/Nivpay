import { test } from "node:test";
import assert from "node:assert/strict";
import { getAddress, keccak256, toHex } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { decodeLink, linkUrl, signLabels, verifyLabels, type PotLink } from "./invites.ts";
import { PotStore, rememberPotLink } from "./potstore.ts";

// Throwaway keys that live only in this test's memory.
const creator = privateKeyToAccount(generatePrivateKey());
const invitee = privateKeyToAccount(generatePrivateKey());
const POTS = getAddress("0xB9E68db3117Db149dF56F5Aa29CF6adaA2369EfB");

function memory() {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) };
}

/** The link the creator's phone shares once the pot is made, as Create.tsx builds it. */
async function sharedPotUrl(potId: bigint): Promise<{ url: string; createdIn: `0x${string}` }> {
  const createdIn = keccak256(toHex(`createPot ${potId}`));
  const people = [
    { account: creator.address, name: "Idara", city: "London", timeZone: "Europe/London" },
    { account: invitee.address, name: "Ubong", city: "Houston", timeZone: "America/Chicago" },
  ];
  const shares = [{ account: invitee.address, amount: 400_000_000n }];
  const link: PotLink = {
    kind: "pot",
    version: 2,
    deployment: "ausd",
    potId,
    block: 69_000_000n + potId,
    people,
    shares,
    signature: await signLabels(creator, POTS, createdIn, people, shares),
  };
  return { url: linkUrl("https://nivpay.vercel.app", link), createdIn };
}

/** What App.tsx does with a link opened on the invitee's phone. */
function openOnInviteePhone(store: PotStore, url: string, now: number) {
  const fragment = new URL(url).hash.replace(/^#/, "");
  const link = decodeLink(fragment);
  assert.equal(link.kind, "pot");
  return { link: link as PotLink, stored: rememberPotLink(store, link as PotLink, fragment, now) };
}

test("a pot link opened on the invitee's phone puts the pot on that phone's Home", async () => {
  const store = new PotStore(memory());
  assert.deepEqual(store.all("ausd"), [], "nothing before the link is opened");

  const { url, createdIn } = await sharedPotUrl(4n);
  const { link, stored } = openOnInviteePhone(store, url, 1_000);

  assert.deepEqual(
    store.all("ausd").map((p) => [p.potId, p.block, p.fragment]),
    [["4", "69000004", stored.fragment]],
  );
  // The names in what was stored are the creator's, signed over the pot's transaction.
  const again = decodeLink(store.get("ausd", "4")!.fragment) as PotLink;
  assert.deepEqual(again, link);
  assert.ok(await verifyLabels(POTS, again, createdIn, creator.address));
});

test("opening the same pot again keeps its name and place, and takes the newer link", async () => {
  const store = new PotStore(memory());
  const first = await sharedPotUrl(4n);
  openOnInviteePhone(store, first.url, 1_000);
  store.put({ ...store.get("ausd", "4")!, name: "Mama’s 60th" });

  const second = await sharedPotUrl(4n);
  const { stored } = openOnInviteePhone(store, second.url, 9_000);
  assert.equal(stored.name, "Mama’s 60th");
  assert.equal(stored.addedAt, 1_000);
  assert.equal(stored.fragment, new URL(second.url).hash.slice(1));
  assert.equal(store.all("ausd").length, 1);
});

test("each pot opened is listed, newest first", async () => {
  const store = new PotStore(memory());
  openOnInviteePhone(store, (await sharedPotUrl(1n)).url, 1_000);
  openOnInviteePhone(store, (await sharedPotUrl(2n)).url, 2_000);
  assert.deepEqual(store.all("ausd").map((p) => p.potId), ["2", "1"]);
  assert.deepEqual(store.all("testusd"), [], "a pot is listed only for its own deployment");
});
