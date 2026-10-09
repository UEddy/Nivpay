import { test } from "node:test";
import assert from "node:assert/strict";
import { getAddress, type Address, type Hex } from "viem";
import { fromBase32, LinkReader, LinkWriter, toBase32 } from "./links.ts";

const enc = (s: string) => new TextEncoder().encode(s);

test("base32 matches the RFC 4648 vectors, lowercase and unpadded", () => {
  const vectors: [string, string][] = [
    ["", ""],
    ["f", "my"],
    ["fo", "mzxq"],
    ["foo", "mzxw6"],
    ["foob", "mzxw6yq"],
    ["fooba", "mzxw6ytb"],
    ["foobar", "mzxw6ytboi"],
  ];
  for (const [plain, coded] of vectors) {
    assert.equal(toBase32(enc(plain)), coded, plain);
    assert.deepEqual(fromBase32(coded), enc(plain), coded);
  }
});

test("damaged fragments are refused, not half read", () => {
  for (const bad of ["MZXW6", "mzxw0", "mzxw1", "mzxw6=", "mzxw6yr", "m"]) {
    assert.throws(() => fromBase32(bad), /damaged/, bad);
  }
  const fragment = new LinkWriter().uint(1).text("Idara").toFragment();
  const r = new LinkReader(fragment);
  r.uint();
  assert.throws(() => r.end(), /damaged/);
});

// Realistic invite: draft id, role, name, account, signature, labels, pot, creation block.
function invite(seed: number) {
  const byte = (i: number) => ((seed * 131 + i * 17) & 0xff).toString(16).padStart(2, "0");
  const hex = (n: number, off: number) => `0x${Array.from({ length: n }, (_, i) => byte(i + off)).join("")}` as Hex;
  return {
    draft: hex(16, 0),
    role: seed % 3,
    name: ["Idara", "Ubong", "Ngozi Okafor", "Émile"][seed % 4]!,
    account: getAddress(hex(20, 40)) as Address,
    signature: hex(65, 80),
    labels: ["Lagos rent", "School fees, Uyo"].slice(0, (seed % 2) + 1),
    pot: getAddress(hex(20, 200)) as Address,
    block: 30_000_000n + BigInt(seed) * 7919n,
  };
}

test("links round trip and never carry 0x, whatever the data", () => {
  for (let seed = 0; seed < 500; seed++) {
    const d = invite(seed);
    const w = new LinkWriter().hex(d.draft).uint(d.role).text(d.name).account(d.account).hex(d.signature);
    w.uint(d.labels.length);
    for (const l of d.labels) w.text(l);
    w.account(d.pot).uint(d.block);
    const link = `https://nivpay.vercel.app/#${w.toFragment()}`;

    const fragment = link.split("#")[1]!;
    assert.match(fragment, /^[a-z2-7]+$/, `seed ${seed}`);
    assert.doesNotMatch(link, /0x/i, `seed ${seed}`);
    assert.doesNotMatch(link, /MON/, `seed ${seed}`);

    const r = new LinkReader(`#${fragment}`);
    assert.equal(r.hex(), d.draft.toLowerCase());
    assert.equal(Number(r.uint()), d.role);
    assert.equal(r.text(), d.name);
    assert.equal(getAddress(r.account()), d.account);
    assert.equal(r.hex(), d.signature.toLowerCase());
    const labels = Array.from({ length: Number(r.uint()) }, () => r.text());
    assert.deepEqual(labels, d.labels);
    assert.equal(getAddress(r.account()), d.pot);
    assert.equal(r.uint(), d.block);
    r.end();
  }
});
