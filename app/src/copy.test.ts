import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { copy, ERROR_CODES, offlineMessage } from "./copy.ts";

/**
 * Product rule: NivPay reads like a fintech app, and people never need to know
 * it runs on crypto. Whole words, plurals included. "MON" counts only in
 * capitals, so "Mon 14 Dec" stays allowed.
 */
const BANNED: [string, RegExp][] = [
  ["crypto", /\bcryptos?\b/i],
  ["blockchain", /\bblockchains?\b/i],
  ["block", /\bblocks?\b/i],
  ["chain", /\bchains?\b/i],
  ["onchain", /\bonchains?\b/i],
  ["wallet", /\bwallets?\b/i],
  ["token", /\btokens?\b/i],
  ["gas", /\bgas(es)?\b/i],
  ["Monad", /\bmonads?\b/i],
  ["testnet", /\btestnets?\b/i],
  ["network", /\bnetworks?\b/i],
  ["address", /\baddress(es)?\b/i],
  ["hash", /\bhash(es)?\b/i],
  ["contract", /\bcontracts?\b/i],
  ["stablecoin", /\bstablecoins?\b/i],
  ["seed", /\bseeds?\b/i],
  ["mnemonic", /\bmnemonics?\b/i],
  ["private key", /\bprivate\s+keys?\b/i],
  ["0x", /\b0x/i],
  ["MON", /\bMONs?\b/],
  // Agora's settlement is described as sending in another currency, with a
  // one-time setup. Never in its own technical terms.
  ["swap", /\bswap(s|ped|ping)?\b/i],
  ["approve", /\bapprov(e|es|ed|al|als|ing)\b/i],
  ["whitelist", /\b(white|allow)list(s|ed|ing)?\b/i],
  // Typography rule, not a crypto word: no em or en dashes anywhere.
  ["em dash", /\u2014/],
  ["en dash", /\u2013/],
];

export function bannedIn(text: string): string[] {
  return BANNED.filter(([, re]) => re.test(text)).map(([word]) => word);
}

// ---------------------------------------------------------------------------
// The checker itself
// ---------------------------------------------------------------------------

test("the checker catches every banned word, plurals and phrases included", () => {
  const cases = [
    "crypto", "cryptos", "Blockchain", "blocks", "chain", "on-chain", "onchain", "wallets", "Token", "gas",
    "Monad", "testnet", "networks", "address", "addresses", "hash", "hashes", "contract", "stablecoins",
    "seed", "mnemonic", "private key", "Private keys", "0x1234", "1 MON", "MONs", "a \u2014 b", "1\u20132",
    "swap", "Swapped", "approve", "approval", "Approving", "whitelist", "whitelisted", "allowlist",
  ];
  for (const c of cases) assert.ok(bannedIn(`see ${c} here`).length > 0, c);
});

test("the checker leaves ordinary words alone", () => {
  for (const ok of ["Closed Mon 14 Dec", "blocked", "unblock", "tokenless", "chained", "10x faster", "addressed", "contractor", "money", "Agora", "AUSD", "Settled in 0.7s", "one-time setup"]) {
    assert.deepEqual(bannedIn(ok), [], ok);
  }
});

// ---------------------------------------------------------------------------
// What people see
// ---------------------------------------------------------------------------

const SAMPLE_ID = "0x725C9A4Bb4c3dE2F11aC0e7C9b1E8f0D3a2B7bC1";

/** Every string in copy, with each message function called on realistic values. */
function allCopy(): [string, string][] {
  const samples: Record<string, unknown[]> = {
    upToAtATime: ["$100,000"],
    added: ["$1,000", "0.7"],
    onlyAtHome: ["nivpay.vercel.app"],
    code: [12],
    accountEnding: [SAMPLE_ID],
    claimAmountHint: ["$10,000", "$100,000"],
    errClaimCooldown: [42],
    errClaimCeiling: ["$100,000"],
    potRowDraft: [3],
    potRowMade: ["Thu 31 Dec 2026"],
    potTitle: ["Mama’s 60th"],
    progressAllReplied: ["Ubong and Caterer"],
    progressWaiting: ["Aniekan and Event hall"],
    progressSome: ["Ubong", "Aniekan"],
    ofN: [2, 3],
    upTo: ["$700"],
    morePayees: [2],
    personYou: ["Idara"],
    personDecides: ["Ubong"],
    morePeople: [2],
    stillNeeded: ["a name, a closing date"],
    sendingTo: ["Ubong"],
    otherCurrencyHint: ["CTK"],
    atLeast: ["10.00 CTK"],
    rateValue: ["1.00 CTK"],
    stepsLine: [3],
    sendAsAction: ["$10", "CTK"],
    progressOf: [1, 3, "One-time setup\u2026"],
    theyReceived: ["10.00 CTK"],
    yourBalanceIs: ["$620.00"],
    requestedAmount: ["$25"],
    sendAction: ["$25"],
    sentTitle: ["$25", "Ubong"],
    settledIn: ["0.7"],
    sendFromRequest: ["Ubong"],
    errSendMoreThanBalance: ["$620.00"],
    requestShareText: ["Ubong"],
    paymentFrom: ["account ending 7bC1"],
    receivedAnnounce: ["$25", "account ending 7bC1"],
    foundMeta: [["you decide on payments", "you've put money in"], "$900"],
    potMadeAnnounce: ["Mama’s 60th", "Caterer and Event hall"],
    shareText: ["Mama’s 60th"],
    map: ["Idara in London, Ubong in Houston", "Caterer and Event hall"],
    timeZoneLine: ["America/Chicago"],
    ruleLine: [2, 3],
    paysLine: ["$700"],
    suggestsLine: ["$400"],
    invitedYou: ["Idara", "Mama\u2019s 60th"],
    yourOwnPot: ["Mama\u2019s 60th"],
    invitedToPot: ["Mama\u2019s 60th"],
    chipPoursOnlyTo: ["Caterer or Event hall"],
    chipRule: [2, 3],
    pourIn: ["$400"],
    fromYourBalance: ["$620.00"],
    moreThanBalance: ["$620.00"],
    pouredIn: ["Idara and Aniekan"],
    personNotYet: ["Aniekan"],
    personPutIn: ["Idara", "$500"],
    addedAnnounce: ["Ubong", "$400", "$900"],
    mapPutIn: ["Idara", "$500", "London"],
    mapNotYet: ["Aniekan", "Uyo"],
    mapHolds: ["$900"],
    mapHoldsShare: ["Idara", "London"],
    closesOn: ["Thu 31 Dec 2026"],
    joinAsDecider: ["Idara", "Mama’s 60th"],
    joinAsPayee: ["Idara", "Mama’s 60th", "Caterer"],
    joinNeedsAccount: ["Idara"],
    replyBody: ["Idara"],
    replyThenHome: ["Idara"],
    invitedWaiting: ["Mama\u2019s 60th", "Idara"],
    invitedShare: ["$600"],
    invitedBy: ["Idara"],
    namedSeeIt: ["Ubong, Aniekan and Caterer"],
    alsoInIt: [["account ending 7bC1", "account ending 4e2a"]],
    replyShareText: ["Idara"],
    replyAdded: ["Ubong"],
    payeeReplyAdded: ["Chidi", "Caterer"],
    errOverLimit: ["$100", "Caterer"],
    errPotShort: ["$397.00"],
    closesAt: ["Thu 31 Dec 2026, 23:59"],
    closeSummary: ["$1,000", "$880", "$4.40", "$115.60"],
    shareBecause: ["$500", "half"],
    closedEarlyLine: ["14 Dec", "You", "Ubong"],
    closedEarlyPlain: ["14 Dec"],
    closedOnDateLine: ["31 Dec"],
    closedBadge: ["14 Dec"],
    takeMyShareOut: ["$57.80"],
    takeMy: ["$57.80"],
    tookLine: ["$57.80"],
    tookOthers: ["Ubong and Aniekan"],
    tookAnnounce: ["$57.80"],
    mapClosed: ["$115.60", "$57.80 to Idara, $46.24 to Ubong"],
    mapShare: ["Idara", "$57.80"],
    mapOpenShares: ["$1,000"],
    fractionPercent: ["40"],
    wantsToClose: ["Idara"],
    moreYesCloses: [1],
    yesClosesNow: [2, 3],
    closedLine: ["$115.60"],
    requestRowClose: ["Idara"],
    homeAskCloseMeta: [1, 2],
    replayBadge: ["28 Sep"],
    receiptFor: ["Ubong added $400.00"],
    storyMade: ["Idara"],
    storyFrom: ["London"],
    storyAdded: ["Ubong", "$400.00"],
    storyAsked: ["Aniekan", "$600.00", "Caterer"],
    storyAskedClose: ["Idara"],
    storyAskedUnpause: ["Idara"],
    storyYes: ["Ubong"],
    storyTookBack: ["Ubong"],
    storyWithdrawn: ["Aniekan"],
    storyForPayment: ["$600.00", "Caterer"],
    storyPaid: ["$600.00", "Caterer"],
    storyPaidBy: ["Aniekan", "Ubong", "$3.00"],
    storyPaidByAsker: ["Aniekan", "$3.00"],
    storyFee: ["$3.00"],
    storyTookOutYou: ["$57.80"],
    storyTookOut: ["Ubong", "$46.24"],
    storyShareYou: ["$57.80"],
    storyShare: ["Ubong", "$46.24"],
    storyClosedBy: ["You", "Ubong", "$115.60"],
    storyLeftToShare: ["$115.60"],
    storyPaused: ["Ubong"],
    storyMap: ["$115.60", 5],
    homeAskMeta: ["$600", 1, 2],
    answerBy: ["Sat 17 Oct, 09:12"],
    payeeLeft: ["$700", "$700"],
    askCountsAsYes: [1, "Caterer"],
    askAction: ["$600", "Caterer"],
    askingFor: ["$600", "Caterer"],
    requestRow: ["Aniekan", "$600", "Caterer"],
    requestRowMeta: [1, 2],
    paymentAskedAnnounce: ["Aniekan", "$600", "Caterer"],
    wantsToPay: ["Aniekan", "$600", "Caterer"],
    youAskedToPay: ["$600", "Caterer"],
    askedLine: ["Aniekan", "14 Oct, 09:12"],
    askedLineIn: ["Aniekan", "14 Oct, 09:12", "Uyo"],
    payeeLimit: ["Caterer"],
    limitOf: ["$600", "$700"],
    moreYesPays: [1, "Caterer"],
    yesPaysNow: [2, 3, "Caterer"],
    yourYesCounts: [1],
    paidSeen: ["Idara"],
    paidLine: ["$600", "Caterer", "$397.00"],
    sayYesAndPay: ["Caterer"],
    payingNow: ["Caterer"],
    needsYesesWithin: [2, 7],
    requestExpiredLine: [7],
    cannotPayShort: ["$500.00"],
    cannotPayLimit: ["Caterer", "$100"],
    paymentRequestShareText: ["Mama\u2019s 60th"],
    personTime: ["Idara", "12:40"],
    personAsked: ["Aniekan"],
    mapEnding: ["0x725C9A4Bb4c3dE2F11aC0e7C9b1E8f0D3a2B7bC1"],
    payeeSubAsked: ["$600"],
    payeeSubPaid: ["$600"],
    mapAsked: ["$1,000", "Aniekan", "$600", "Caterer"],
    mapPaid: ["$397", "$600", "Caterer"],
  };
  return Object.entries(copy).map(([key, value]) => {
    if (typeof value === "string") return [key, value];
    const args = samples[key];
    assert.ok(args, `copy.${key} is a function with no sample arguments in this test`);
    return [key, (value as (...a: unknown[]) => string)(...args)];
  });
}

test("no banned word in any copy, including generated messages", () => {
  for (const [key, text] of allCopy()) assert.deepEqual(bannedIn(text), [], `copy.${key}: ${text}`);
});

test("a pot found from the chain says what the person does in it, as one sentence", () => {
  assert.equal(copy.foundMeta([copy.foundRoleDecides], "$900"), "You decide on payments. Holds $900.");
  assert.equal(copy.foundMeta([copy.foundRoleDecides, copy.foundRolePutIn], "$900"), "You decide on payments and you've put money in. Holds $900.");
  assert.equal(copy.foundMeta([copy.foundRolePaid], "$0"), "It can pay you. Holds $0.");
});

test("after a pot is made, the screen says named people already have it, and offers one link for the group", () => {
  assert.equal(copy.namedSeeIt("Ubong, Aniekan and Caterer"), "Ubong, Aniekan and Caterer already have this pot on their Home. They don't need a link.");
  assert.equal(copy.shareThePot, "Share the pot");
  assert.match(copy.shareThePotHint, /one link for the whole group/);
  const create = readFileSync(new URL("./screens/Create.tsx", import.meta.url), "utf8");
  assert.equal(create.match(/copy\.shareThePot\b/g)?.length, 1, "one Share the pot button");
  assert.doesNotMatch(create, /send-btn|sendTo\(/, "no button per person");
});

test("a payment request reads in plain words: a yes, never an approval", () => {
  assert.equal(copy.wantsToPay("Aniekan", "$600", "Caterer"), "Aniekan wants to pay $600 to Caterer");
  assert.equal(copy.moreYesPays(1, "Caterer"), "1 more yes pays Caterer straight away.");
  assert.equal(copy.moreYesPays(2, "Caterer"), "2 more yeses pay Caterer.");
  assert.equal(copy.yesPaysNow(2, 3, "Caterer"), "That's 2 of 3. Paying Caterer now.");
  assert.equal(copy.paidLine("$600", "Caterer", "$397.00"), "Paid $600 to Caterer. The pot has $397.00.");
  assert.equal(copy.needsYesesWithin(2, 7), "Requests need 2 yeses within 7 days, or they expire.");
  assert.equal(copy.shareBecause("$500", "half"), "You put in $500, half of the pot, so half of what's left is yours.");
  assert.equal(copy.askCountsAsYes(1, "Caterer"), "Asking counts as your yes. 1 more yes pays Caterer.");
  assert.equal(copy.askCountsAsYes(2, "Caterer"), "Asking counts as your yes. 2 more yeses pay Caterer.");
  assert.equal(copy.askCountsAsYes(0, "Caterer"), "This pot needs only one yes, so asking pays Caterer straight away.");
});

test("a sentence that starts with an unnamed person starts with a capital, and only then", () => {
  assert.equal(copy.storyAdded("account ending 8C9D", "$100.00"), "Account ending 8C9D added $100.00");
  assert.equal(copy.wantsToPay("account ending 8C9D", "$600", "Caterer"), "Account ending 8C9D wants to pay $600 to Caterer");
  assert.equal(copy.storyPaidBy("account ending 8C9D", "account ending 1a2b", "$3.00"), "Account ending 8C9D asked, account ending 1a2b said yes · fee $3.00");
  assert.equal(copy.tookLine("$5"), "Your $5 is in your balance.");
});

test("nothing the app says about closing claims more than the contract does", () => {
  // At close the contract sends nobody anything: each takes their own share (claim). And a share is shares, not dollars put in.
  for (const [key, text] of allCopy()) {
    assert.doesNotMatch(text, /goes back to|comes back to you|back to each of you/i, `copy.${key}: leftovers are taken, never sent`);
    assert.doesNotMatch(text, /in proportion to what each put in|split by what/i, `copy.${key}: a share follows shares`);
  }
  assert.match(copy.closesLede, /Nothing is sent to anyone then/);
});

test("vendors and people are shown as 'account ending', never a 0x form", () => {
  assert.equal(copy.accountEnding(SAMPLE_ID), "account ending 7bC1");
});

test("every error code is shown as a short neutral 'Code N'", () => {
  for (const n of Object.values(ERROR_CODES)) assert.match(copy.code(n), /^Code \d{2}$/);
  const codes = Object.values(ERROR_CODES);
  assert.equal(new Set(codes).size, codes.length, "codes are unique");
});

function filesUnder(dir: string, ext: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return filesUnder(path, ext);
    return path.endsWith(ext) && !path.includes(".test.") ? [path] : [];
  });
}

const SRC = new URL(".", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
const APP = join(SRC, "..");

/** Text people can see in a screen: JSX text, visible attributes, and string literals. */
function visibleTextIn(source: string): string[] {
  const out: string[] = [];
  const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "").replace(/^import .*$/gm, "");
  for (const m of code.matchAll(/>([^<>{}]*[A-Za-z][^<>{}]*)</g)) out.push(m[1]!.trim());
  for (const m of code.matchAll(/\b(?:aria-label|placeholder|title|alt)="([^"]*)"/g)) out.push(m[1]!);
  for (const m of code.matchAll(/"([^"\n]*)"|`([^`]*)`/g)) out.push(m[1] ?? m[2] ?? "");
  return out.filter(Boolean);
}

test("no banned word in the text of any screen", () => {
  const screens = filesUnder(SRC, ".tsx");
  assert.ok(screens.length > 0, "found the screens");
  for (const file of screens) {
    for (const text of visibleTextIn(readFileSync(file, "utf8"))) {
      assert.deepEqual(bannedIn(text), [], `${file}: ${text}`);
    }
  }
});

test("no banned word in the page title, description or app manifest", () => {
  const html = readFileSync(join(APP, "index.html"), "utf8");
  const title = /<title>([^<]*)<\/title>/.exec(html)?.[1] ?? "";
  const description = /name="description" content="([^"]*)"/.exec(html)?.[1] ?? "";
  const manifest = JSON.parse(readFileSync(join(APP, "public", "manifest.webmanifest"), "utf8")) as Record<string, string>;
  for (const text of [title, description, manifest.name ?? "", manifest.short_name ?? "", manifest.description ?? ""]) {
    assert.deepEqual(bannedIn(text), [], text);
  }
});

test("'Nothing has moved' is only said when no request is in flight", () => {
  assert.match(offlineMessage(0), /Nothing has moved/);
  for (const unsure of [1, 3, undefined]) {
    const text = offlineMessage(unsure);
    assert.doesNotMatch(text, /nothing has moved/i, String(unsure));
    assert.match(text, /sent and is still being confirmed/, String(unsure));
  }
});

// ---------------------------------------------------------------------------
// The dash rule covers the whole codebase, not just the screens
// ---------------------------------------------------------------------------

test("no em or en dash in any tracked or newly added file except package-lock.json", () => {
  const root = execFileSync("git", ["rev-parse", "--show-toplevel"], { cwd: APP, encoding: "utf8" }).trim();
  const files = execFileSync("git", ["ls-files", "-z", "--cached", "--others", "--exclude-standard"], { cwd: root, encoding: "utf8" })
    .split("\0")
    .filter((f) => f && !f.endsWith("package-lock.json"));
  assert.ok(files.length > 50, `found the tracked files (${files.length})`);
  const offenders: string[] = [];
  let checked = 0;
  for (const file of files) {
    const path = join(root, file);
    let bytes: Buffer;
    try {
      if (!statSync(path).isFile()) continue; // submodule entries are folders
      bytes = readFileSync(path);
    } catch {
      continue;
    }
    if (bytes.includes(0)) continue; // binary files (icons) hold no prose
    checked++;
    bytes
      .toString("utf8")
      .split("\n")
      .forEach((line, i) => {
        if (/[\u2013\u2014]/.test(line)) offenders.push(`${file}:${i + 1}`);
      });
  }
  assert.ok(checked > 50, `checked ${checked} text files`);
  assert.deepEqual(offenders, [], "em or en dash found");
});
