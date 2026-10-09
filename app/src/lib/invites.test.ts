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
  type PayLink,
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
  inviter: idara.address,
  share: 0n,
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
  const shares = [
    { account: idara.address, amount: 500_000_000n },
    { account: ubong.address, amount: 400_000_000n },
  ];
  const link: PotLink = {
    kind: "pot",
    version: 2,
    deployment: "ausd",
    potId: 7n,
    block: 47_123_456n,
    people,
    shares,
    signature: await signLabels(idara, POTS, createdIn, people, shares),
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
  const greedy = { ...back, shares: [shares[0]!, { account: ubong.address, amount: 1n }] };
  assert.ok(!(await verifyLabels(POTS, greedy, createdIn, idara.address)), "edited suggested shares");
  const dropped = { ...back, shares: [shares[0]!] };
  assert.ok(!(await verifyLabels(POTS, dropped, createdIn, idara.address)), "a dropped share");
  assert.ok(!(await verifyLabels(POTS, { ...back, version: 1, shares: [] }, createdIn, idara.address)), "read as the other version");
});

test("version 1 pot links, made before suggested shares, still open and verify", async () => {
  const createdIn = keccak256(toHex("an older createPot transaction"));
  const people = [{ account: idara.address, name: "Idara", city: "London", timeZone: "Europe/London" }];
  // Signed exactly as the first release signed labels: names, no shares.
  const signature = await idara.signTypedData({
    domain: { name: "NivPay", version: "1", chainId: 10143, verifyingContract: POTS },
    types: {
      Labels: [
        { name: "createdIn", type: "bytes32" },
        { name: "people", type: "Person[]" },
      ],
      Person: [
        { name: "account", type: "address" },
        { name: "name", type: "string" },
        { name: "city", type: "string" },
        { name: "timeZone", type: "string" },
      ],
    },
    primaryType: "Labels",
    message: { createdIn, people },
  });
  const w = new LinkWriter().uint(1).uint(3).uint(0).uint(4n).uint(47_000_000n).uint(1);
  w.account(people[0]!.account).text("Idara").text("London").text("Europe/London").hex(signature);
  const back = decodeLink(w.toFragment()) as PotLink;
  assert.equal(back.version, 1);
  assert.deepEqual(back.shares, []);
  assert.ok(await verifyLabels(POTS, back, createdIn, idara.address));
  assert.equal(encodeLink(back), w.toFragment(), "re-encodes as it came");
});

test("an invite carries its creator's account and, for a payee, a suggested share", () => {
  const payee: Invite = { ...invite, role: ROLE.payee, slot: "0x0102030405060708", payeeName: "Caterer", share: 600_000_000n };
  const back = decodeLink(encodeLink(payee));
  assert.ok(back.kind === "invite");
  assert.equal(back.inviter, idara.address);
  assert.equal(back.share, 600_000_000n);
  assertChatSafe(linkUrl("https://nivpay.vercel.app", payee));
});

test("version 1 invites, made before they carried the creator's account, still open", () => {
  const v1 = new LinkWriter().uint(1).uint(1).hex(DRAFT).uint(0).hex(NO_SLOT).text("Idara").text("Mama’s 60th").text("").toFragment();
  const back = decodeLink(v1);
  assert.deepEqual(back, { ...invite, inviter: null, share: 0n });
  assert.equal(encodeLink(back), v1, "re-encodes as it came");
  assert.throws(() => encodeLink({ ...invite, inviter: null, share: 1n }), /no share/);
});

test("only pot links and invites come in version 2", () => {
  const v2reply = new LinkWriter().uint(2).uint(2).hex(DRAFT).uint(0).hex(NO_SLOT).toFragment();
  assert.throws(() => decodeLink(v2reply), /damaged/);
  const v2pay = new LinkWriter().uint(2).uint(4).uint(0).account(idara.address).text("I").uint(0).toFragment();
  assert.throws(() => decodeLink(v2pay), /damaged/);
  // A version 2 invite cut short of the account it promises is refused.
  const short = new LinkWriter().uint(2).uint(1).hex(DRAFT).uint(0).hex(NO_SLOT).text("I").text("P").text("").toFragment();
  assert.throws(() => decodeLink(short), /damaged/);
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
    const shares = people.map((p, j) => ({ account: p.account, amount: BigInt(j + 1) * 123_450_000n }));
    const link: PotLink = { kind: "pot", version: 2, deployment: i % 2 ? "ausd" : "testusd", potId: BigInt(i * 977), block: 47_000_000n + BigInt(i), people, shares, signature: `0x${"ab".repeat(65)}` };
    assert.deepEqual(decodeLink(encodeLink(link)), link);
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

test("a request to be paid round trips, with or without an amount, and is safe to paste in a chat", () => {
  const ubong = getAddress("0x1111111111111111111111111111111111111111");
  for (const link of [
    { kind: "pay", deployment: "ausd", account: ubong, name: "Ubong", amount: 25_000_000n },
    { kind: "pay", deployment: "testusd", account: ubong, name: "Ubong Ökpé", amount: 0n },
  ] satisfies PayLink[]) {
    const url = linkUrl("https://nivpay.vercel.app", link);
    assertChatSafe(url);
    assert.deepEqual(decodeLink(url.split("#")[1]!), link);
  }
});

test("a damaged request to be paid is refused", () => {
  const ubong = getAddress("0x1111111111111111111111111111111111111111");
  const good = encodeLink({ kind: "pay", deployment: "ausd", account: ubong, name: "Ubong", amount: 1n });
  assert.throws(() => decodeLink(good.slice(0, -3)), /damaged/);
  assert.throws(() => decodeLink(`${good}aa`), /damaged/);
  assert.throws(() => decodeLink(encodeLink({ kind: "pay", deployment: "ausd", account: ubong, name: "x".repeat(65), amount: 1n })), /damaged/);
});
