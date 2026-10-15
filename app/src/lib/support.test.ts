import { test } from "node:test";
import assert from "node:assert/strict";
import { emailLink, LastCodeStore, supportBody, supportEmail, supportWhatsApp, whatsAppLink } from "./support.ts";

const ID = "0x725C9A4Bb4c3dE2F11aC0e7C9b1E8f0D3a2B7bC1";

test("a missing or malformed contact hides its button", () => {
  assert.equal(supportEmail(undefined), null);
  assert.equal(supportEmail(""), null);
  assert.equal(supportEmail("not an email"), null);
  assert.equal(supportEmail("help@nivpay.example?cc=x@y.z"), null, "no extra headers");
  assert.equal(supportEmail("a@b.example,c@d.example"), null, "one address");
  assert.equal(supportEmail(" help@nivpay.example "), "help@nivpay.example");
  assert.equal(supportWhatsApp(undefined), null);
  assert.equal(supportWhatsApp("12345"), null, "too short");
  assert.equal(supportWhatsApp("+234 (803) 123-4567"), "2348031234567");
  assert.equal(supportWhatsApp("0803 123 4567"), null, "no country code");
});

test("the version and the last code go in; the Account ID only when ticked", () => {
  const without = supportBody({ version: "abc1234", code: 52, accountId: null });
  assert.match(without, /abc1234/);
  assert.match(without, /Code 52/);
  assert.doesNotMatch(without, /Account ID/);
  const withId = supportBody({ version: "abc1234", code: null, accountId: ID });
  assert.match(withId, new RegExp(ID));
  assert.doesNotMatch(withId, /Code \d/);
});

test("the email and WhatsApp links carry the same words, encoded", () => {
  const f = { version: "abc1234", code: 52, accountId: null };
  const mail = emailLink("help@nivpay.example", f);
  assert.match(mail, /^mailto:help@nivpay\.example\?subject=[^&]*Code%2052&body=/);
  assert.equal(decodeURIComponent(mail.split("&body=")[1]!), supportBody(f));
  const wa = whatsAppLink("2348031234567", f);
  assert.match(wa, /^https:\/\/wa\.me\/2348031234567\?text=/);
  assert.equal(decodeURIComponent(wa.split("?text=")[1]!), supportBody(f));
});

test("the last code shown is remembered on this phone, and only a real code", () => {
  const m = new Map<string, string>();
  const store = new LastCodeStore({ getItem: (k) => m.get(k) ?? null, setItem: (k, v) => void m.set(k, v) });
  assert.equal(store.get(), null);
  store.shown(52);
  assert.equal(store.get(), 52);
  m.set("nivpay.lastcode.v1", "hello");
  assert.equal(store.get(), null);
});
