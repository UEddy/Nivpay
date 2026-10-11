import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { copyLink, shareLink } from "./share.ts";

type FakePhone = { shared: string[]; copied: string[] };

/** Swaps the browser's navigator for one with a share sheet and a clipboard that record what they got. */
function withNavigator(opts: { share?: "ok" | "cancel" | "error" | "none"; clipboard?: "ok" | "error" }, run: (phone: FakePhone) => Promise<void>) {
  const phone: FakePhone = { shared: [], copied: [] };
  const fake: Record<string, unknown> = {
    clipboard: {
      writeText: async (text: string) => {
        if (opts.clipboard === "error") throw new Error("denied");
        phone.copied.push(text);
      },
    },
  };
  if ((opts.share ?? "none") !== "none") {
    fake.share = async (data: { url: string }) => {
      if (opts.share === "cancel") throw new DOMException("cancelled", "AbortError");
      if (opts.share === "error") throw new DOMException("not allowed", "NotAllowedError");
      phone.shared.push(data.url);
    };
  }
  const before = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  Object.defineProperty(globalThis, "navigator", { value: fake, configurable: true, writable: true });
  return run(phone).finally(() => {
    if (before) Object.defineProperty(globalThis, "navigator", before);
    else delete (globalThis as { navigator?: unknown }).navigator;
  });
}

const URL_ = "https://nivpay.vercel.app/#p1abc";

test("Copy link copies without opening the share sheet, even on a phone that has one", () =>
  withNavigator({ share: "ok" }, async (phone) => {
    assert.equal(await copyLink(URL_), "copied");
    assert.deepEqual(phone.copied, [URL_]);
    assert.deepEqual(phone.shared, []);
  }));

test("Copy link says failed when the clipboard refuses, so the screen can say how to copy by hand", () =>
  withNavigator({ clipboard: "error" }, async (phone) => {
    assert.equal(await copyLink(URL_), "failed");
    assert.deepEqual(phone.copied, []);
  }));

test("Share uses the share sheet where there is one, and copies only where there is none", async () => {
  await withNavigator({ share: "ok" }, async (phone) => {
    assert.equal(await shareLink(URL_, "Open our pot"), "shared");
    assert.deepEqual(phone.shared, [URL_]);
    assert.deepEqual(phone.copied, []);
  });
  await withNavigator({ share: "none" }, async (phone) => {
    assert.equal(await shareLink(URL_, "Open our pot"), "copied");
    assert.deepEqual(phone.copied, [URL_]);
  });
  await withNavigator({ share: "cancel" }, async (phone) => {
    assert.equal(await shareLink(URL_, "Open our pot"), "cancelled");
    assert.deepEqual(phone.copied, []);
  });
  await withNavigator({ share: "error" }, async (phone) => {
    assert.equal(await shareLink(URL_, "Open our pot"), "copied");
    assert.deepEqual(phone.copied, [URL_]);
  });
});

/**
 * Every screen that offers Share also offers Copy link: the group pot link,
 * the request links (a pot's payment request, and Receive), the invite links
 * and the reply link. Copying never opens the share sheet, so no contacts show.
 */
test("every screen with a Share action also has Copy link", () => {
  const screens = ["ChipIn", "Close", "Create", "Join", "Receive", "Request"];
  for (const name of screens) {
    const src = readFileSync(new URL(`../screens/${name}.tsx`, import.meta.url), "utf8");
    const shares = src.match(/\bshareLink\(|props\.onShare\(/g)?.length ?? 0;
    const copies = src.match(/<CopyLinkButton\b/g)?.length ?? 0;
    assert.ok(shares > 0, `${name} has a Share action`);
    assert.ok(copies > 0, `${name} has Copy link next to Share`);
  }
  // Create has four: the pot, a new decider invite, a decider invite again, a payee invite.
  const create = readFileSync(new URL("../screens/Create.tsx", import.meta.url), "utf8");
  assert.equal(create.match(/<CopyLinkButton\b/g)?.length, 4);
});
