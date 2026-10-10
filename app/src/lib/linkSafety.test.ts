import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { getAddress, toHex, type Hex } from "viem";
import { decodeLink, encodeLink, NO_SLOT, ROLE, type Invite, type PayLink } from "./invites.ts";
import { receiptUrl } from "./receipts.ts";
import { shownText32, toText32 } from "./text32.ts";
import { hasInvisible, stripInvisible } from "./text.ts";

/**
 * Anything decoded from a link or read from the chain is someone else's
 * text. It is shown only as text (React, and Trusted Types in the CSP), it
 * can't become a link target, and characters that disguise a name are
 * refused in links and taken out of names read from the chain.
 */
const RLO = String.fromCharCode(0x202e);
const ZWSP = String.fromCharCode(0x200b);
const LRI = String.fromCharCode(0x2066);
const BEL = String.fromCharCode(0x07);
const ACCOUNT = getAddress("0x725C9cd75b2C8C29AEbf6a14eE84a3b54C787bC1");

const invite = (over: Partial<Invite> = {}): Invite => ({
  kind: "invite",
  draftId: "0x00112233445566778899aabbccddeeff",
  role: ROLE.decider,
  slot: NO_SLOT,
  from: "Idara",
  potName: "Mama's 60th",
  payeeName: "",
  inviter: ACCOUNT,
  share: 0n,
  ...over,
});
const pay = (name: string): PayLink => ({ kind: "pay", deployment: "ausd", account: ACCOUNT, name, amount: 0n });

test("a link whose names carry direction overrides, zero-width or control characters is refused", () => {
  for (const bad of [`Ida${RLO}ra`, `Idara${ZWSP}`, `${LRI}Idara`, `Idara${BEL}`]) {
    assert.throws(() => decodeLink(encodeLink(invite({ from: bad }))), /damaged/, JSON.stringify(bad));
    assert.throws(() => decodeLink(encodeLink(invite({ potName: bad }))), /damaged/);
    assert.throws(() => decodeLink(encodeLink(pay(bad))), /damaged/);
  }
  assert.equal((decodeLink(encodeLink(pay("Ubong"))) as PayLink).name, "Ubong");
});

test("markup and script in a name stay plain text: the link opens, and the name is just those characters", () => {
  for (const text of ["<script>alert(1)</script>", "<img src=x onerror=alert(1)>", "javascript:alert(1)", "data:text/html,<b>x"]) {
    const name = text.slice(0, 64);
    assert.equal((decodeLink(encodeLink(pay(name))) as PayLink).name, name);
  }
});

test("hostile payloads fail closed: random, oversized, cut short or padded links all throw, quickly", () => {
  let seed = 7;
  const rand = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  const alphabet = "abcdefghijklmnopqrstuvwxyz234567";
  for (let i = 0; i < 500; i++) {
    const len = Math.floor(rand() * 400);
    const fragment = Array.from({ length: len }, () => alphabet[Math.floor(rand() * 32)]).join("");
    try {
      const link = decodeLink(fragment);
      // A random payload that happens to parse is still a well-formed link, never a crash.
      assert.ok(["invite", "reply", "pot", "pay", "ask"].includes(link.kind));
    } catch (e) {
      assert.ok(e instanceof Error);
    }
  }
  const good = encodeLink(pay("Ubong"));
  assert.throws(() => decodeLink(good.slice(0, -3)));
  assert.throws(() => decodeLink(good + "aaaa"));
  assert.throws(() => decodeLink("0x" + "ab".repeat(40)));
  assert.throws(() => decodeLink("!@#$%^&*()"));
  const started = performance.now();
  assert.throws(() => decodeLink("a".repeat(2_000_000)));
  assert.ok(performance.now() - started < 2_000, "a 2 MB link is refused in under two seconds");
});

test("a name over the link limit is refused, not cut", () => {
  assert.throws(() => decodeLink(encodeLink(pay("x".repeat(65)))), /damaged/);
});

test("a link that can't be read takes the person Home with Code 70, never further", () => {
  const app = readFileSync(new URL("../App.tsx", import.meta.url), "utf8");
  assert.match(app, /link = decodeLink\(fragment\);\s*\} catch \{\s*go\(\{ kind: "home" \}, \{ tone: "bad", text: copy\.errLinkDamaged, code: ERROR_CODES\.LINK_DAMAGED \}\);\s*return;/);
});

test("every link the app draws goes to the receipt explorer, whatever the hash it is given", () => {
  for (const hostile of ["javascript:alert(1)", "//evil.example", "../../x", "\" onclick=\"x"]) {
    assert.ok(receiptUrl(hostile as Hex).startsWith("https://testnet.monadvision.com/tx/"));
  }
  for (const f of ["screens/Receive.tsx", "screens/Send.tsx", "screens/Timeline.tsx", "App.tsx", "screens/Create.tsx", "screens/ChipIn.tsx", "screens/Request.tsx", "screens/Close.tsx", "screens/Join.tsx", "screens/Ask.tsx"]) {
    const text = readFileSync(new URL(`../${f}`, import.meta.url), "utf8");
    for (const [, target] of text.matchAll(/href=\{([^}]*)\}/g)) assert.match(target!, /^receiptUrl\(/, `${f}: href={${target}}`);
    assert.doesNotMatch(text, /href="(?!#)/, `${f}: a literal href`);
    assert.doesNotMatch(text, /window\.open\(|location\.(href|assign|replace)\s*[=(]/, f);
  }
});

test("pot and payee names read from the chain lose invisible characters before they are shown", () => {
  // Anyone can make a pot straight through the contract with any bytes32 name.
  const raw = toHex(new TextEncoder().encode(`Mama${RLO}${ZWSP}'s`), { size: 32 });
  assert.equal(shownText32(raw), "Mama's");
  assert.equal(shownText32(toText32("Caterer")), "Caterer");
});

test("the invisible character rule", () => {
  assert.equal(stripInvisible(`I${RLO}d${ZWSP}a${LRI}r${BEL}a`), "Idara");
  assert.equal(hasInvisible("Ubong"), false);
  assert.equal(hasInvisible(`Ubong${ZWSP}`), true);
  assert.equal(hasInvisible("Ọ̀kọ́n Àníkẹ́"), false, "accents and tones are visible and stay");
});
