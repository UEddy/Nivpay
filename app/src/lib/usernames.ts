/**
 * Usernames (README, "Usernames for accounts"): the phone's copy of the rules
 * NivPayNames checks, so a name is judged before any request is made. The two
 * are tested against the same vectors (test/vectors/usernames.json), so they
 * can never disagree. The contract's check is the one that counts.
 *
 * A username is a convenience for finding an Account ID. It is never shown in
 * place of a name signed in a link, and never changes who a pot can pay.
 */

export const NAME_MIN = 3;
export const NAME_MAX_LENGTH = 20;
/** How long a released name is held before anyone else can take it (NivPayNames.HOLD_PERIOD). */
export const HOLD_DAYS = 90;

/** Exactly these, and any name containing "nivpay" (NivPayNames.isReserved). */
export const RESERVED = ["nivpay", "support", "help", "admin", "official", "team", "security", "staff", "agora", "monad", "mera"] as const;

/** What a person typed, as the name it means: "@Idara " is "idara". Not checked; see usernameProblem. */
export function normalizeUsername(typed: string): string {
  return typed.trim().replace(/^@+/, "").trim().toLowerCase();
}

export type UsernameProblem = "short" | "long" | "start" | "characters" | "underscores" | "end" | "reserved";

/** Why a name can't be claimed, or null if it follows every rule. Same order of checks as the contract. */
export function usernameProblem(name: string): UsernameProblem | null {
  if (name.length < NAME_MIN) return "short";
  if (name.length > NAME_MAX_LENGTH) return "long";
  if (!/^[a-z]/.test(name)) return "start";
  if (!/^[a-z0-9_]+$/.test(name)) return "characters";
  if (name.includes("__")) return "underscores";
  if (name.endsWith("_")) return "end";
  if ((RESERVED as readonly string[]).includes(name) || name.includes("nivpay")) return "reserved";
  return null;
}

/** True when it follows the character rules, reserved or not (NivPayNames.isWellFormed). */
export function isWellFormed(name: string): boolean {
  const p = usernameProblem(name);
  return p === null || p === "reserved";
}

/** "@idara". */
export function atName(name: string): string {
  return `@${name}`;
}

/** NivPayNames.availableAt for a name an account holds, or one that breaks the rules. */
export const NEVER = 2n ** 64n - 1n;

export type Availability =
  | { kind: "notAllowed"; problem: UsernameProblem }
  | { kind: "yours" }
  | { kind: "taken" }
  | { kind: "available" }
  /** Released by this account and still held for it: it can take it back now. */
  | { kind: "takeBack"; until: bigint }
  /** Released by someone else, free for anyone from `until` (seconds). */
  | { kind: "held"; until: bigint };

/**
 * What the screen says about a name, from what was read at one finalized
 * block: who holds it, when anyone may claim it, and who released it.
 */
export function availability(
  name: string,
  me: string,
  read: { holder: string | null; availableAt: bigint; releasedBy: string | null },
): Availability {
  const problem = usernameProblem(name);
  if (problem) return { kind: "notAllowed", problem };
  const same = (a: string | null) => a !== null && a.toLowerCase() === me.toLowerCase();
  if (read.holder) return same(read.holder) ? { kind: "yours" } : { kind: "taken" };
  if (read.availableAt === 0n) return { kind: "available" };
  if (same(read.releasedBy)) return { kind: "takeBack", until: read.availableAt };
  return { kind: "held", until: read.availableAt };
}

/** Typed text that is meant as an Account ID, even a broken one, rather than a username. */
export function looksLikeAccountId(typed: string): boolean {
  return /^\s*0x/i.test(typed);
}
