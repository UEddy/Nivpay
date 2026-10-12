// Read-only checks that the chain is in the starting state a recording take
// expects (docs/SEEDING.md). Nothing here signs or sends anything: the client
// is the app's read transport, which refuses eth_sendRawTransaction, and the
// config holds addresses and pot numbers only. A config with anything that
// looks like a key in it is refused before any request is made.

import { createPublicClient, formatEther, getAddress, isAddress, isAddressEqual, type Address, type PublicClient } from "viem";
import { ERC20_READ_ABI, POTS_ABI, SETTLEMENT_PAIR_ABI } from "../src/lib/abi.ts";
import { AUSD, AUSD_FAUCET, CHAIN, CTK, POTS_AUSD, RPC_URL, SETTLEMENT_PAIR } from "../src/lib/config.ts";
import { endTimeFor } from "../src/lib/draft.ts";
import { FAUCET_ABI } from "../src/lib/faucet.ts";
import { formatAmount } from "../src/lib/money.ts";
import { retryingReadTransport, type ReadTransportOptions } from "../src/lib/rpc.ts";
import { fromText32 } from "../src/lib/text32.ts";
import { MAX_SENT_TXS } from "../api/fund/index.ts";

/** Phone A's time zone when the config names none: the recording phones show "Times show in Africa/Lagos". */
export const DEFAULT_TIME_ZONE = "Africa/Lagos";
export const STATUS_URL = "https://nivpay.vercel.app/api/fund/status";
/** A gas grant is asked for below this much MON, and only by an account with fewer than MAX_SENT_TXS sent (app/api/fund). */
const GRANT_THRESHOLD = 75_000_000_000_000_000n;
const MAX_SENT = MAX_SENT_TXS;
const FUNDER_FLOOR_MON = 1;
/** The most pots read when checking that a fresh account is named on none. */
const MAX_POTS_SCANNED = 200;
const MAX_REQUESTS_SCANNED = 500;

// ---------------------------------------------------------------------------
// The cast and the config
// ---------------------------------------------------------------------------

/** Accounts that already exist, read on chain on 10 Oct 2026. Pot 0's people. */
export const KNOWN = {
  phoneA: getAddress("0x725C9cd75b2C8C29AEbf6a14eE84a3b54C787bC1"),
  phoneB: getAddress("0x97936c44214231002051A601e2065732382Df8b4"),
  third: getAddress("0xa5057F32DB2a6f68F69ad1587014AbF101A20B61"),
} as const;

export type Role = "eddy" | "maya" | "daniel" | "caterer" | "eventHall" | "bountyMaya" | "phoneA" | "phoneB" | "third";

export const ROLE_NAMES: Record<Role, string> = {
  eddy: "Eddy",
  maya: "Maya",
  daniel: "Daniel",
  caterer: "Caterer",
  eventHall: "Event hall",
  bountyMaya: "Maya (2 min cut)",
  phoneA: "Phone A account",
  phoneB: "Phone B account",
  third: "Third test account",
};

export type Config = {
  rpcUrl?: string;
  statusUrl?: string;
  /** The time zone of phone A, where the pot is made. Its closing date is the end of the day there. */
  timeZone?: string;
  cast?: Partial<Record<"phoneA" | "phoneB" | "third", string>>;
  main?: Partial<Record<"eddy" | "maya" | "daniel" | "caterer" | "eventHall", string>> & { pot?: number | null };
  bounty?: { maya?: string };
  testClose?: { pot?: number | null };
  /** Requests an account sent that the script doesn't plan for, acknowledged by hand (a lost claim race, Code 62). */
  extraSent?: Record<string, number>;
};

export class ConfigError extends Error {}

/** Reads `<take-name> [--config <path>]` or `--list` from the command line, in any order. */
export function parseArgs(args: string[]): { name?: string; configPath?: string; list: boolean } {
  const configAt = args.indexOf("--config");
  const configPath = configAt >= 0 ? (args[configAt + 1] ?? "") : undefined;
  const name = args.find((a, i) => !a.startsWith("--") && !(configAt >= 0 && i === configAt + 1));
  return { name, configPath, list: args.includes("--list") };
}

const KEYISH_NAME = /key|secret|mnemonic|seed|phrase|password/i;
const KEYISH_VALUE = /^(0x)?[0-9a-fA-F]{64}$/;

/** Refuses a config that carries anything shaped like a private key or a recovery phrase. */
export function refuseSecrets(value: unknown, path = "config"): void {
  if (typeof value === "string") {
    if (KEYISH_VALUE.test(value.trim()) || value.trim().split(/\s+/).length >= 12) {
      throw new ConfigError(`${path} looks like a private key or a recovery phrase. This script never needs one: remove it.`);
    }
    return;
  }
  if (Array.isArray(value)) return value.forEach((v, i) => refuseSecrets(v, `${path}[${i}]`));
  if (value && typeof value === "object") {
    for (const [k, v] of Object.entries(value)) {
      if (KEYISH_NAME.test(k)) throw new ConfigError(`${path}.${k}: this script never takes keys, secrets or phrases. Remove it.`);
      refuseSecrets(v, `${path}.${k}`);
    }
  }
}

export function parseConfig(text: string): Config {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    throw new ConfigError(`the config is not valid JSON: ${(error as Error).message}`);
  }
  refuseSecrets(parsed);
  if (!parsed || typeof parsed !== "object") throw new ConfigError("the config must be a JSON object");
  return parsed as Config;
}

function addressAt(config: Config, role: Role): Address {
  const raw =
    role === "phoneA" || role === "phoneB" || role === "third"
      ? (config.cast?.[role] ?? KNOWN[role])
      : role === "bountyMaya"
        ? config.bounty?.maya
        : config.main?.[role];
  const where = role === "bountyMaya" ? "bounty.maya" : role in KNOWN ? `cast.${role}` : `main.${role}`;
  if (!raw || !isAddress(raw, { strict: false })) {
    throw new ConfigError(`${where} is not filled in with ${ROLE_NAMES[role]}'s address (SEEDING.md, "The cast": copy it from Account details)`);
  }
  return getAddress(raw);
}

function potIdAt(config: Config, pot: PotRef): bigint {
  if (typeof pot === "number") return BigInt(pot);
  const raw = pot === "mama" ? config.main?.pot : config.testClose?.pot;
  const where = pot === "mama" ? "main.pot" : "testClose.pot";
  if (typeof raw !== "number" || !Number.isInteger(raw) || raw < 0) {
    throw new ConfigError(`${where} is not filled in with the pot's number (SEEDING.md, "Finding a pot's number")`);
  }
  return BigInt(raw);
}

// ---------------------------------------------------------------------------
// What each take expects
// ---------------------------------------------------------------------------

/** Dollars as base units of a 6 decimal dollar, from text so no float ever holds money. */
export function usd(text: string): bigint {
  const m = /^(\d+)(?:\.(\d{1,2}))?$/.exec(text.replace(/,/g, ""));
  if (!m) throw new Error(`bad amount ${text}`);
  return BigInt(m[1]!) * 1_000_000n + BigInt((m[2] ?? "").padEnd(2, "0")) * 10_000n;
}

type AccountExpect = {
  role: Role;
  /** Unset for an account whose balance isn't part of the take: it is reported only. */
  ausd?: bigint;
  /** Requests this account has sent: its nonce. { atMost } for an older account with room left for the take. */
  sent: number | { atMost: number };
  /** A fresh account: no pot names it as a decider or a payee yet. */
  onNoPot?: boolean;
  /** The SEEDING.md step that puts this account in this state. */
  fix: string;
};

type PotRef = "mama" | "testClose" | number;

type PotExpect = {
  label: string;
  ref: PotRef;
  name: string;
  threshold: number;
  deciders: Role[];
  payees: { role: Role; label: string; cap: bigint; spent: bigint }[];
  total: bigint;
  /** What each decider would take out now (funderInfo), to the cent. */
  shares?: Partial<Record<Role, bigint>>;
  closed: boolean;
  /** Requests waiting for a yes. "any" reports them without judging. */
  pending: number | "any";
  /** The closing date as picked in the app, YYYY-MM-DD, ended in the config's time zone. Unset: only checked to be in the future. */
  closes?: string;
  fix: string;
};

export type Take = {
  name: string;
  title: string;
  /** The SEEDING.md section for this take. */
  section: string;
  accounts: AccountExpect[];
  pots: PotExpect[];
  /** Claims made on camera: the faucet must be off cooldown and stocked for them. */
  claimsOnCamera: number;
  /** Agora's pair must be open with CTK to deliver. */
  pair: boolean;
  /** MON the funder needs above its 1 MON floor for the rest of this cut. */
  funderHeadroomMon: number;
};

const SHOWCASE: PotExpect = {
  label: "Pot 0, the showcase",
  ref: 0,
  name: "Anniversary",
  threshold: 2,
  deciders: ["phoneA", "phoneB"],
  payees: [{ role: "third", label: "Carter", cap: usd("100"), spent: usd("0") }],
  total: usd("400"),
  closed: false,
  pending: "any",
  fix: 'SEEDING.md, "Pot 0 stays as it is": nothing can reopen it; if it was closed or paid, stop and tell the reviewers which pot to look at',
};

const MAMA = "Mama's 60th";
const CLOSES = "2026-12-31";
const mamaPayees = (caterer: string, hall: string) => [
  { role: "caterer" as const, label: "Caterer", cap: usd("700"), spent: usd(caterer) },
  { role: "eventHall" as const, label: "Event hall", cap: usd("300"), spent: usd(hall) },
];
const mamaPot = (p: Pick<PotExpect, "total" | "shares" | "closed" | "fix"> & { caterer: string; hall: string }): PotExpect => ({
  label: MAMA,
  ref: "mama",
  name: MAMA,
  threshold: 2,
  deciders: ["eddy", "maya", "daniel"],
  payees: mamaPayees(p.caterer, p.hall),
  total: p.total,
  shares: p.shares,
  closed: p.closed,
  pending: 0,
  closes: CLOSES,
  fix: p.fix,
});

const cast = (fix: string, ...rows: [Role, string, number][]): AccountExpect[] =>
  rows.map(([role, ausd, sent]) => ({ role, ausd: usd(ausd), sent, fix }));

export const TAKES: Take[] = [
  {
    name: "main-make",
    title: "3 min cut, take M1: make the pot (DEMO.md section 2)",
    section: "M1",
    accounts: [
      ...cast('SEEDING.md M1, "Seed it", steps 1 to 6', ["eddy", "10000", 1], ["maya", "10000", 1], ["daniel", "10000", 1]),
      ...cast('SEEDING.md M1, "Seed it", steps 7 and 8', ["caterer", "0", 0], ["eventHall", "0", 0]),
    ].map((a) => ({ ...a, onNoPot: true })),
    pots: [SHOWCASE],
    claimsOnCamera: 0,
    pair: false,
    funderHeadroomMon: 0.2,
  },
  {
    name: "main-pour",
    title: "3 min cut, take M2: pour in (DEMO.md section 3)",
    section: "M2",
    accounts: cast(
      'SEEDING.md M2, "Seed it"',
      ["eddy", "10000", 2],
      ["maya", "10000", 1],
      ["daniel", "10000", 1],
      ["caterer", "0", 0],
      ["eventHall", "0", 0],
    ),
    pots: [
      SHOWCASE,
      mamaPot({ total: usd("0"), caterer: "0", hall: "0", closed: false, shares: { eddy: 0n, maya: 0n, daniel: 0n }, fix: 'SEEDING.md M2, "Seed it", step 2' }),
    ],
    claimsOnCamera: 0,
    pair: false,
    funderHeadroomMon: 0.2,
  },
  {
    name: "main-pay",
    title: "3 min cut, take M3: payments (DEMO.md section 4)",
    section: "M3",
    accounts: cast(
      'SEEDING.md M3, "Seed it"',
      ["eddy", "9500", 3],
      ["maya", "9600", 2],
      ["daniel", "9900", 2],
      ["caterer", "0", 0],
      ["eventHall", "0", 0],
    ),
    pots: [
      SHOWCASE,
      mamaPot({
        total: usd("1000"),
        caterer: "0",
        hall: "0",
        closed: false,
        shares: { eddy: usd("500"), maya: usd("400"), daniel: usd("100") },
        fix: 'SEEDING.md M3, "Seed it", step 2',
      }),
    ],
    claimsOnCamera: 0,
    pair: false,
    funderHeadroomMon: 0.2,
  },
  {
    name: "main-close",
    title: "3 min cut, take M4: close and take shares (DEMO.md section 5)",
    section: "M4",
    accounts: cast(
      'SEEDING.md M4, "Seed it"',
      ["eddy", "9500", 4],
      ["maya", "9600", 3],
      ["daniel", "9900", 4],
      ["caterer", "600", 0],
      ["eventHall", "280", 0],
    ),
    pots: [
      SHOWCASE,
      mamaPot({
        total: usd("115.60"),
        caterer: "600",
        hall: "280",
        closed: false,
        shares: { eddy: usd("57.80"), maya: usd("46.24"), daniel: usd("11.56") },
        fix: 'SEEDING.md M4, "Seed it", steps 2 and 3',
      }),
    ],
    claimsOnCamera: 0,
    pair: false,
    funderHeadroomMon: 0.2,
  },
  {
    name: "main-story",
    title: "3 min cut, take M5: the story and the explorer (DEMO.md section 6)",
    section: "M5",
    accounts: cast(
      'SEEDING.md M5, "Seed it"',
      ["eddy", "9557.80", 6],
      ["maya", "9646.24", 5],
      ["daniel", "9911.56", 5],
      ["caterer", "600", 0],
      ["eventHall", "280", 0],
    ),
    pots: [
      SHOWCASE,
      mamaPot({
        total: usd("0"),
        caterer: "600",
        hall: "280",
        closed: true,
        shares: { eddy: 0n, maya: 0n, daniel: 0n },
        fix: 'SEEDING.md M5, "Seed it"',
      }),
    ],
    claimsOnCamera: 0,
    pair: false,
    funderHeadroomMon: 0,
  },
  {
    name: "bounty",
    title: "2 min cut, take B1: the Agora bounty path (DEMO.md, The 2 minute bounty path)",
    section: "B1",
    accounts: [{ role: "bountyMaya", ausd: 0n, sent: 0, onNoPot: true, fix: 'SEEDING.md B1, "Seed it", step 1: a fresh Maya' }],
    pots: [SHOWCASE],
    claimsOnCamera: 1,
    pair: true,
    funderHeadroomMon: 0.2,
  },
  {
    name: "test-close",
    title: 'Rehearsal R1: early close and take-share on the throwaway "Test close" pot (never recorded)',
    section: "R1",
    // Older accounts whose balances move between sessions: only their room for the
    // rehearsal is checked. After seeding, the maker still asks to close and takes
    // its share (2 more), the second decider says yes (1 more). The Phone A
    // account is only the payee, and being paid sends nothing.
    accounts: [
      { role: "phoneB", sent: { atMost: MAX_SENT - 2 }, fix: 'make the pot from another account (SEEDING.md R1, "Who")' },
      { role: "third", sent: { atMost: MAX_SENT - 1 }, fix: 'use another second decider (SEEDING.md R1, "Who")' },
    ],
    pots: [
      SHOWCASE,
      {
        label: "Test close",
        ref: "testClose",
        name: "Test close",
        threshold: 2,
        deciders: ["phoneB", "third"],
        payees: [{ role: "phoneA", label: "Test payee", cap: usd("10"), spent: usd("0") }],
        total: usd("20"),
        shares: { phoneB: usd("20"), third: 0n },
        closed: false,
        pending: 0,
        closes: CLOSES,
        fix: 'SEEDING.md R1, "Seed it", steps 1 to 4',
      },
    ],
    claimsOnCamera: 0,
    pair: false,
    funderHeadroomMon: 0.2,
  },
];

export function findTake(name: string): Take | undefined {
  return TAKES.find((t) => t.name === name);
}

// ---------------------------------------------------------------------------
// Reading the chain, one request at a time
// ---------------------------------------------------------------------------

export type Deps = {
  client: PublicClient;
  /** GET for the funder's status. Read only. */
  fetchStatus: (url: string) => Promise<{ enabled: boolean; keyMatches: boolean; funderBalance: string | null }>;
};

export function makeClient(rpcUrl: string = RPC_URL, options: ReadTransportOptions = {}): PublicClient {
  // No batching and no multicall: every read is its own request, awaited
  // before the next, so the public RPC's 15 a second is never hit in a burst.
  return createPublicClient({ chain: CHAIN, transport: retryingReadTransport(rpcUrl, options), ccipRead: false }) as PublicClient;
}

export function liveDeps(config: Config): Deps {
  return {
    client: makeClient(config.rpcUrl ?? RPC_URL),
    async fetchStatus(url) {
      const res = await fetch(url, { method: "GET", headers: { accept: "application/json" } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return (await res.json()) as { enabled: boolean; keyMatches: boolean; funderBalance: string | null };
    },
  };
}

// ---------------------------------------------------------------------------
// The checks
// ---------------------------------------------------------------------------

export type Row = {
  /** true pass, false fail, null shown for information only. */
  ok: boolean | null;
  what: string;
  expected: string;
  actual: string;
  fix?: string;
};

export type Report = { take: Take; rows: Row[]; at: { block: bigint; time: bigint } };

const money = (v: bigint) => formatAmount(v, 6, "cents");
const mon = (v: bigint) => `${Number(formatEther(v)).toFixed(4)} MON`;
const short = (a: Address) => `ending ${a.slice(-4)}`;
const sameName = (a: string, b: string) => a.replace(/[\u2018\u2019]/g, "'") === b.replace(/[\u2018\u2019]/g, "'");
const day = (t: bigint) => new Date(Number(t) * 1000).toISOString().replace("T", " ").slice(0, 16) + " UTC";

export async function runTake(take: Take, config: Config, deps: Deps): Promise<Report> {
  const { client } = deps;
  const rows: Row[] = [];
  const add = (row: Row) => rows.push(row);
  // The pot closes at the end of the chosen day in the maker's phone time zone
  // (draft.me.timeZone, from phoneTimeZone(), in src/lib/draft.ts endTimeFor).
  // The recording phones are set to Lagos.
  const tz = config.timeZone ?? DEFAULT_TIME_ZONE;

  // Every address and pot number first, so a config gap stops the run before any request.
  const addressOf = new Map<Role, Address>();
  for (const a of take.accounts) addressOf.set(a.role, addressAt(config, a.role));
  for (const p of take.pots) {
    for (const r of [...p.deciders, ...p.payees.map((x) => x.role)]) addressOf.set(r, addressAt(config, r));
  }
  const potIds = new Map(take.pots.map((p) => [p, potIdAt(config, p.ref)] as const));

  const block = await client.getBlock({ blockTag: "finalized" });
  const at = { blockNumber: block.number } as const;
  const now = block.timestamp;
  const potCount = await client.readContract({ address: POTS_AUSD, abi: POTS_ABI, functionName: "potCount", ...at });
  add({ ok: null, what: "Pots made so far", expected: "reported only", actual: `${potCount}: the next pot made is number ${potCount}` });

  // Accounts.
  let named: Set<string> | null = null;
  for (const a of take.accounts) {
    const address = addressOf.get(a.role)!;
    const who = `${ROLE_NAMES[a.role]} (${short(address)})`;
    const balance = await client.readContract({ address: AUSD, abi: ERC20_READ_ABI, functionName: "balanceOf", args: [address], ...at });
    add({
      ok: a.ausd === undefined ? null : balance === a.ausd,
      what: `${who} AUSD`,
      expected: a.ausd === undefined ? "reported only" : money(a.ausd),
      actual: money(balance),
      fix: a.fix,
    });

    const gas = await client.getBalance({ address, ...at });
    const sent = await client.getTransactionCount({ address, ...at });
    if (typeof a.sent === "number") {
      const extra = config.extraSent?.[address] ?? config.extraSent?.[address.toLowerCase()] ?? 0;
      const planned = a.sent + extra;
      add({
        ok: sent === planned,
        what: `${who} requests sent`,
        expected: extra ? `${planned} (${a.sent} + ${extra} acknowledged)` : String(planned),
        actual: String(sent),
        fix:
          sent > planned
            ? `this is not the account for this take, or it sent an extra request (a lost claim race shows Code 62). Use a fresh account (SEEDING.md, "Retakes"), or acknowledge it under extraSent in the config`
            : a.fix,
      });
    } else {
      add({
        ok: sent <= a.sent.atMost,
        what: `${who} requests sent`,
        expected: `at most ${a.sent.atMost}, to leave room for the take`,
        actual: String(sent),
        fix: `this account is too close to the gas grant limit of ${MAX_SENT}: ${a.fix}`,
      });
    }
    const canPayGas = gas >= GRANT_THRESHOLD || sent < MAX_SENT;
    add({
      ok: canPayGas,
      what: `${who} MON for gas`,
      expected: `at least ${mon(GRANT_THRESHOLD)}, or under ${MAX_SENT} sent so a gas grant can top it up`,
      actual: `${mon(gas)}, ${sent} sent`,
      fix: 'this account can get no more gas grants: use a fresh account (SEEDING.md, "Retakes")',
    });

    if (a.onNoPot) {
      named ??= await namedOnPots(client, potCount, at.blockNumber);
      const onPot = named.has(address.toLowerCase());
      add({
        ok: !onPot,
        what: `${who} is on no pot yet`,
        expected: "on no pot (Home shows no pots)",
        actual: onPot ? "named on a pot already" : potCount > BigInt(MAX_POTS_SCANNED) ? `on none of the last ${MAX_POTS_SCANNED} pots` : "on no pot",
        fix: 'an old pot would show on this Home: use a fresh account (SEEDING.md, "Retakes")',
      });
    }
  }

  // Pots.
  const pending = await pendingByPot(client, at.blockNumber, now);
  for (const p of take.pots) {
    const id = potIds.get(p)!;
    const label = `${p.label} (pot ${id})`;
    const exists = id < potCount;
    add({ ok: exists, what: `${label} exists`, expected: "made", actual: exists ? "made" : `no such pot (${potCount} pots so far)`, fix: p.fix });
    if (!exists) continue;

    const view = await client.readContract({ address: POTS_AUSD, abi: POTS_ABI, functionName: "getPot", args: [id], ...at });
    let name: string;
    try {
      name = fromText32(view.purpose);
    } catch {
      name = view.purpose;
    }
    add({ ok: sameName(name, p.name), what: `${label} name`, expected: p.name, actual: name, fix: `${p.fix}. A wrong pot number in the config shows here too` });
    add({ ok: view.totalAssets === p.total, what: `${label} holds`, expected: money(p.total), actual: money(view.totalAssets), fix: p.fix });
    add({ ok: view.closed === p.closed, what: `${label} closed`, expected: p.closed ? "closed" : "open", actual: view.closed ? "closed" : "open", fix: p.closed ? p.fix : `a closed pot cannot be reopened: make a fresh one (SEEDING.md, "Retakes")` });
    add({ ok: !view.frozen, what: `${label} frozen`, expected: "not frozen", actual: view.frozen ? "frozen" : "not frozen", fix: `a frozen pot needs a vote to unfreeze: make a fresh one (SEEDING.md, "Retakes")` });

    const endOk = view.endTime > now;
    const wanted = p.closes ? endTimeFor(p.closes, tz) : null;
    add({
      ok: endOk && (wanted === null || view.endTime === wanted),
      what: `${label} closing date`,
      expected: wanted === null ? "still in the future" : `end of ${p.closes} in ${tz} (${day(wanted)}), in the future`,
      actual: `${day(view.endTime)}, ${endOk ? "in the future" : "already passed"}`,
      fix: endOk ? `${p.fix}: pick Thu 31 Dec 2026, on a phone set to ${tz}` : `the pot has reached its closing date: make a fresh one (SEEDING.md, "Retakes")`,
    });
    add({ ok: view.threshold === p.threshold && view.approverCount === p.deciders.length, what: `${label} yeses needed`, expected: `${p.threshold} of ${p.deciders.length}`, actual: `${view.threshold} of ${view.approverCount}`, fix: p.fix });

    const deciders = await client.readContract({ address: POTS_AUSD, abi: POTS_ABI, functionName: "getApprovers", args: [id], ...at });
    const wantDeciders = p.deciders.map((r) => addressOf.get(r)!);
    const decidersOk = deciders.length === wantDeciders.length && wantDeciders.every((w) => deciders.some((d) => isAddressEqual(d, w)));
    add({
      ok: decidersOk,
      what: `${label} deciders`,
      expected: p.deciders.map((r) => `${ROLE_NAMES[r]} (${short(addressOf.get(r)!)})`).join(", "),
      actual: deciders.map(short).join(", "),
      fix: `${p.fix}. Check the addresses in the config against Account details`,
    });

    const payees = await client.readContract({ address: POTS_AUSD, abi: POTS_ABI, functionName: "getDestinations", args: [id], ...at });
    for (const want of p.payees) {
      const to = addressOf.get(want.role)!;
      const got = payees.find((d) => isAddressEqual(d.to, to));
      let gotLabel = "";
      if (got) {
        try {
          gotLabel = fromText32(got.label);
        } catch {
          gotLabel = got.label;
        }
      }
      add({
        ok: !!got && sameName(gotLabel, want.label) && got.cap === want.cap && got.spent === want.spent,
        what: `${label} payee ${want.label}`,
        expected: `${want.label} (${short(to)}), up to ${money(want.cap)}, paid ${money(want.spent)}`,
        actual: got ? `${gotLabel} (${short(got.to)}), up to ${money(got.cap)}, paid ${money(got.spent)}` : "not a payee",
        fix: p.fix,
      });
    }
    if (payees.length !== p.payees.length) {
      add({ ok: false, what: `${label} payees`, expected: String(p.payees.length), actual: String(payees.length), fix: p.fix });
    }

    for (const [role, want] of Object.entries(p.shares ?? {}) as [Role, bigint][]) {
      const address = addressOf.get(role)!;
      const [, redeemable] = await client.readContract({ address: POTS_AUSD, abi: POTS_ABI, functionName: "funderInfo", args: [id, address], ...at });
      // To the cent, as the app shows it: the pot's rounding can leave a sub-cent remainder.
      const ok = redeemable / 10_000n === want / 10_000n || (redeemable + 1n) / 10_000n === want / 10_000n;
      add({ ok, what: `${label} share, ${ROLE_NAMES[role]}`, expected: money(want), actual: money(redeemable), fix: p.fix });
    }

    const waiting = pending.byPot.get(id.toString()) ?? [];
    const pendingText = waiting.length ? waiting.map((r) => `#${r.id} ${r.kind === 0 ? `pay ${money(r.amount)}` : r.kind === 1 ? "close early" : "unfreeze"}, ${r.approvals} yes`).join("; ") : "none";
    add({
      ok: p.pending === "any" ? null : waiting.length === p.pending,
      what: `${label} requests waiting for a yes`,
      expected: p.pending === "any" ? "reported only" : p.pending === 0 ? "none" : String(p.pending),
      actual: pending.capped ? `${pendingText} (only the last ${MAX_REQUESTS_SCANNED} requests read)` : pendingText,
      fix: `the app has no way to withdraw a request: it waits until 7 days after it was asked. Make a fresh pot with fresh accounts (SEEDING.md, "Retakes")`,
    });
  }

  // The faucet, for a claim on camera.
  if (take.claimsOnCamera > 0) {
    const drip = await client.readContract({ address: AUSD_FAUCET, abi: FAUCET_ABI, functionName: "faucetDripAmount", ...at });
    const every = await client.readContract({ address: AUSD_FAUCET, abi: FAUCET_ABI, functionName: "maxDripFrequency", ...at });
    const last = await client.readContract({ address: AUSD_FAUCET, abi: FAUCET_ABI, functionName: "lastDripTimestamp", ...at });
    const stock = await client.readContract({ address: AUSD, abi: ERC20_READ_ABI, functionName: "balanceOf", args: [AUSD_FAUCET], ...at });
    const need = drip * BigInt(take.claimsOnCamera);
    add({ ok: stock >= need, what: "Faucet stock", expected: `at least ${money(need)}`, actual: money(stock), fix: 'the faucet is empty: ask Agora, or record later (SEEDING.md, "Test money")' });
    const wait = last + every > now ? last + every - now : 0n;
    add({
      ok: wait === 0n,
      what: "Faucet cooldown",
      expected: `no claim in the last ${every}s`,
      actual: wait === 0n ? `last claim ${now - last}s ago` : `ready in ${wait}s`,
      fix: `wait ${wait}s and run this again: nobody may claim in the minute before the take (SEEDING.md, "Test money")`,
    });
  }

  // Agora's pair, for the payment delivered as CTK.
  if (take.pair) {
    const paused = await client.readContract({ address: SETTLEMENT_PAIR, abi: SETTLEMENT_PAIR_ABI, functionName: "isPaused", ...at });
    add({ ok: !paused, what: "Agora pair open", expected: "not paused", actual: paused ? "paused" : "not paused", fix: "Agora has paused Instant Settlement: record the CTK step later" });
    const ctk = await client.readContract({ address: CTK, abi: ERC20_READ_ABI, functionName: "balanceOf", args: [SETTLEMENT_PAIR], ...at });
    const tenCtk = 10n * 10n ** 18n;
    add({ ok: ctk >= tenCtk, what: "Agora pair CTK to deliver", expected: "at least 10.00 CTK", actual: `${formatAmount(ctk, 18, "cents").slice(1)} CTK`, fix: "the pair can't deliver 10 CTK: record the CTK step later" });
  }

  // The funder, through the app's own status endpoint (a GET; it never returns the key).
  if (take.funderHeadroomMon > 0) {
    const want = FUNDER_FLOOR_MON + take.funderHeadroomMon;
    try {
      const status = await deps.fetchStatus(config.statusUrl ?? STATUS_URL);
      const balance = Number.parseFloat(status.funderBalance ?? "");
      add({
        ok: status.enabled && status.keyMatches,
        what: "Gas grants on",
        expected: "enabled, keyMatches",
        actual: `${status.enabled ? "enabled" : "disabled"}, ${status.keyMatches ? "keyMatches" : "key does not match"}`,
        fix: "set FUNDING_ENABLED and the funder key in Vercel (SEEDING.md, \"Gas grants\")",
      });
      add({
        ok: Number.isFinite(balance) && balance >= want,
        what: "Funder MON",
        expected: `at least ${want.toFixed(1)} MON (1 MON floor + ${take.funderHeadroomMon.toFixed(1)})`,
        actual: Number.isFinite(balance) ? `${balance.toFixed(4)} MON` : "unknown",
        fix: 'top up the funder (SEEDING.md, "Gas grants")',
      });
    } catch (error) {
      add({ ok: false, what: "Gas grants on", expected: "status answers", actual: `no answer: ${(error as Error).message}`, fix: `open ${config.statusUrl ?? STATUS_URL} and check it answers` });
    }
  }

  return { take, rows, at: { block: block.number, time: now } };
}

/** Every address named as a decider or payee on any pot, read pot by pot. */
async function namedOnPots(client: PublicClient, potCount: bigint, blockNumber: bigint): Promise<Set<string>> {
  const named = new Set<string>();
  const from = potCount > BigInt(MAX_POTS_SCANNED) ? potCount - BigInt(MAX_POTS_SCANNED) : 0n;
  for (let id = from; id < potCount; id++) {
    const deciders = await client.readContract({ address: POTS_AUSD, abi: POTS_ABI, functionName: "getApprovers", args: [id], blockNumber });
    deciders.forEach((d) => named.add(d.toLowerCase()));
    const payees = await client.readContract({ address: POTS_AUSD, abi: POTS_ABI, functionName: "getDestinations", args: [id], blockNumber });
    payees.forEach((d) => named.add(d.to.toLowerCase()));
  }
  return named;
}

type Waiting = { id: bigint; kind: number; amount: bigint; approvals: number };

/** Requests still waiting for a yes, by pot. Request numbers are global, so each is read once. */
async function pendingByPot(client: PublicClient, blockNumber: bigint, now: bigint): Promise<{ byPot: Map<string, Waiting[]>; capped: boolean }> {
  const count = await client.readContract({ address: POTS_AUSD, abi: POTS_ABI, functionName: "proposalCount", blockNumber });
  const capped = count > BigInt(MAX_REQUESTS_SCANNED);
  const byPot = new Map<string, Waiting[]>();
  for (let id = capped ? count - BigInt(MAX_REQUESTS_SCANNED) : 0n; id < count; id++) {
    const info = await client.readContract({ address: POTS_AUSD, abi: POTS_ABI, functionName: "proposalInfo", args: [id], blockNumber });
    if (info.status !== 0 || now > info.expiresAt) continue;
    const key = info.potId.toString();
    byPot.set(key, [...(byPot.get(key) ?? []), { id, kind: info.kind, amount: info.amount, approvals: info.approvals }]);
  }
  return { byPot, capped };
}

// ---------------------------------------------------------------------------
// Output
// ---------------------------------------------------------------------------

export function failed(report: Report): Row[] {
  return report.rows.filter((r) => r.ok === false);
}

export function formatReport(report: Report): string {
  const mark = (ok: boolean | null) => (ok === null ? "info" : ok ? "PASS" : "FAIL");
  const width = (key: "what" | "expected" | "actual", cap: number) => Math.min(cap, Math.max(key.length, ...report.rows.map((r) => r[key].length)));
  const w = { what: width("what", 52), expected: width("expected", 44) };
  const pad = (s: string, n: number) => (s.length > n ? s.slice(0, n - 3) + "..." : s.padEnd(n));
  const lines = [
    `Preflight: ${report.take.name}, ${report.take.title}`,
    `Read at finalized block ${report.at.block} (${day(report.at.time)}). Read only: nothing was signed or sent.`,
    "",
    `${"    ".padEnd(5)}${pad("Check", w.what)}  ${pad("Expected", w.expected)}  Actual`,
    ...report.rows.map((r) => `${mark(r.ok).padEnd(5)}${pad(r.what, w.what)}  ${pad(r.expected, w.expected)}  ${r.actual}`),
    "",
  ];
  const fails = failed(report);
  if (fails.length === 0) {
    lines.push(`All ${report.rows.filter((r) => r.ok).length} checks pass. Ready for take ${report.take.section}.`);
  } else {
    lines.push(`${fails.length} check${fails.length === 1 ? "" : "s"} failed. To fix:`);
    for (const r of fails) lines.push(`  - ${r.what}: ${r.fix ?? `SEEDING.md ${report.take.section}`}`);
  }
  return lines.join("\n");
}
