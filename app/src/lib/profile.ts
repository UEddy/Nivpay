import { LANGS, type Lang } from "./locale.ts";

/**
 * The Profile tab's rules, apart from how it looks (screens/Profile.tsx):
 * which rows show, in which groups and order, the daily limit's bar, and the
 * language choices. A row for a feature that isn't set up, or has nothing in
 * it, doesn't show, and a group with no rows left doesn't either.
 */

export type RowId = "name" | "username" | "photo" | "limit" | "autocash" | "hidden" | "receipt" | "devices" | "language" | "notifications" | "voice" | "help" | "install";
export type GroupId = "account" | "money" | "security" | "preferences" | "help";

export type ProfileFacts = {
  namesOn: boolean;
  photosOn: boolean;
  hiddenPots: number;
  hasReceipt: boolean;
  /** Requests from people, or notifications on the phone, set up on this site. */
  notificationsOn: boolean;
  voiceOffered: boolean;
  /** Auto cash out: with the AUSD build's cash out desk only. */
  autoCashOffered: boolean;
  /** The app can still be installed here. */
  canInstall: boolean;
};

export function profileGroups(f: ProfileFacts): { group: GroupId; rows: RowId[] }[] {
  const groups: { group: GroupId; rows: (RowId | false)[] }[] = [
    { group: "account", rows: ["name", f.namesOn && "username", f.photosOn && "photo"] },
    { group: "money", rows: ["limit", f.autoCashOffered && "autocash", f.hiddenPots > 0 && "hidden", f.hasReceipt && "receipt"] },
    { group: "security", rows: ["devices"] },
    { group: "preferences", rows: ["language", f.notificationsOn && "notifications", f.voiceOffered && "voice"] },
    { group: "help", rows: ["help", f.canInstall && "install"] },
  ];
  return groups.map((g) => ({ group: g.group, rows: g.rows.filter((r): r is RowId => r !== false) })).filter((g) => g.rows.length > 0);
}

/** How much of the daily limit is used, 0 to 100, for its bar. A limit of nothing reads as full. */
export function limitUsedShare(used: bigint, limit: bigint): number {
  if (limit <= 0n) return 100;
  const tenths = Number((used * 1000n) / limit);
  return Math.max(0, Math.min(100, tenths / 10));
}

/** The language list: the phone's own first, then each language. */
export const LANGUAGE_CHOICES: (Lang | null)[] = [null, ...LANGS];
