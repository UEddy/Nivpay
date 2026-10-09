import { test } from "node:test";
import assert from "node:assert/strict";
import { getAddress, keccak256, toHex, type Hex } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import {
  decodeLink,
  encodeLink,
  linkUrl,
  NO_SLOT,
  ROLE,
  signLabels,
  signReply,
  verifyLabels,
  verifyReply,
  type Invite,
  type PotLink,
} from "./invites.ts";
import { LinkWriter } from "./links.ts";

// Throwaway keys that live only in this test's memory.
const idara = privateKeyToAccount(generatePrivateKey());
const ubong = privateKeyToAccount(generatePrivateKey());
const POTS = getAddress("0xB9E68db3117Db149dF56F5Aa29CF6adaA2369EfB");
const OTHER_POTS = getAddress("0xe80FBB5F77Cb87d4f588A3F21bf9Eae34fC996aA");
const DRAFT: Hex = "0x00112233445566778899aabbccddeeff";

const invite: Invite = {
  kind: "invite",
  draftId: DRAFT,
  role: ROLE.decider,
  slot: NO_SLOT,
  from: "Idara",
  potName: "Mama’s 60th",
  payeeName: "",
};
const ubongLabel = { account: ubong.address, name: "Ubong", city: "Houston", timeZone: "America/Chicago" };

function assertChatSafe(url: string) {
  const fragment = url.split("#")[1]!;
  assert.match(fragment, /^[a-z2-7]+$/);
  assert.doesNotMatch(url, /0x/i);
  assert.doesNotMatch(url, /MON/);
}

test("an invite round trips and is safe to paste in a chat", () => {
  for (const i of [invite, { ...invite, role: ROLE.payee, slot: "0x0102030405060708" as Hex, payeeName: "Caterer" }]) {
    const url = linkUrl("https://nivpay.vercel.app", i);
    assertChatSafe(url);
    assert.deepEqual(decodeLink(url.split("#")[1]!), i);
  }
});

test("a reply is signed by its own account and checked against it", async () => {
  const reply = await signReply(ubong, POTS, invite, ubongLabel);
  const url = linkUrl("https://nivpay.vercel.app", reply);
  assertChatSafe(url);
  const back = decodeLink(url.split("#")[1]!);
  assert.equal(back.kind, "reply");
  assert.ok(back.kind === "reply" && (await verifyReply(POTS, back)));

  // Anything changed after signing, and the reply is refused.
  assert.ok(!(await verifyReply(POTS, { ...reply, person: { ...ubongLabel, name: "Ubong E." } })));
  assert.ok(!(await verifyReply(POTS, { ...reply, person: { ...ubongLabel, account: idara.address } })));
  assert.ok(!(await verifyReply(POTS, { ...reply, draftId: "0xffffffffffffffffffffffffffffffff" })));
  assert.ok(!(await verifyReply(POTS, { ...reply, role: ROLE.payee })));
  assert.ok(!(await verifyReply(OTHER_POTS, reply)), "bound to one pots contract");
  await assert.rejects(signReply(idara, POTS, invite, ubongLabel), "no one signs a reply for someone else");
});

test("the pot link's labels are accepted only from the pot's creator, for that pot's transaction", async () => {
  const createdIn = keccak256(toHex("the createPot transaction"));
  const people = [
    { account: idara.address, name: "Idara", city: "London", timeZone: "Europe/London" },
    ubongLabel,
  ];
  const link: PotLink = {
    kind: "pot",
    deployment: "ausd",
    potId: 7n,
    block: 47_123_456n,
    people,
    signature: await signLabels(idara, POTS, createdIn, people),
  };
  const url = linkUrl("https://nivpay.vercel.app", link);
  assertChatSafe(url);
  const back = decodeLink(url.split("#")[1]!) as PotLink;
  assert.deepEqual(back, link);
  assert.ok(await verifyLabels(POTS, back, createdIn, idara.address));
  assert.ok(!(await verifyLabels(POTS, back, createdIn, ubong.address)), "someone else made the pot");
  assert.ok(!(await verifyLabels(POTS, back, keccak256(toHex("another pot")), idara.address)), "labels from another pot");
  const renamed = { ...back, people: [people[0]!, { ...ubongLabel, name: "Mallory" }] };
  assert.ok(!(await verifyLabels(POTS, renamed, createdIn, idara.address)), "edited labels");
});

test("links stay chat safe for many realistic people", async () => {
  const cities = ["Lagos", "Uyo", "Port Harcourt", "Houston", "London", "São Paulo", "Montréal"];
  const zones = ["Africa/Lagos", "America/Chicago", "Europe/London", "America/Sao_Paulo", "America/Toronto"];
  for (let i = 0; i < 40; i++) {
    const people = Array.from({ length: 1 + (i % 10) }, (_, j) => ({
      account: privateKeyToAccount(generatePrivateKey()).address,
      name: ["Idara", "Ubong", "Ngozi Okafor", "Émile", "Aniekan"][(i + j) % 5]!,
      city: cities[(i + j) % cities.length]!,
      timeZone: zones[(i * j) % zones.length]!,
    }));
    const link: PotLink = { kind: "pot", deployment: i % 2 ? "ausd" : "testusd", potId: BigInt(i * 977), block: 47_000_000n + BigInt(i), people, signature: `0x${"ab".repeat(65)}` };
    assertChatSafe(linkUrl("https://nivpay.vercel.app", link));
  }
});

test("damaged links are refused, not half read", () => {
  const good = encodeLink(invite);
  for (const bad of [good.slice(0, -3), `${good}aa`, "", "zzzz"]) assert.throws(() => decodeLink(bad), /damaged/, bad);
  const wrongVersion = new LinkWriter().uint(2).uint(1).toFragment();
  assert.throws(() => decodeLink(wrongVersion), /damaged/);
  const badZone = new LinkWriter().uint(1).uint(2).hex(DRAFT).uint(0).hex(NO_SLOT).account(ubong.address).text("Ubong").text("Houston").text("Mars/Olympus").hex(`0x${"ab".repeat(65)}`).toFragment();
  assert.throws(() => decodeLink(badZone), /damaged/);
  const badRole = new LinkWriter().uint(1).uint(1).hex(DRAFT).uint(5).hex(NO_SLOT).text("I").text("P").text("").toFragment();
  assert.throws(() => decodeLink(badRole), /damaged/);
});
