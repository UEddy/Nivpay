import { getAddress, type Address, type Hex } from "viem";
import { copy, ERROR_CODES } from "../copy.ts";
import { AccountStore } from "./accounts.ts";
import { ContactStore } from "./contacts.ts";
import { DEPLOYMENT } from "./deployment.ts";
import { AppError } from "./errors.ts";
import { MutedStore } from "./inbox.ts";
import { language } from "./locale.ts";
import { proofMessage, sha256Hex } from "./proof.ts";
import { cleanSettings, DEFAULT_SETTINGS, type PushSettings } from "./push.ts";

/**
 * Notifications on the phone, in this browser (lib/push.ts has the rules).
 * The browser keeps one push subscription for the site; each account that
 * turns notifications on registers it with /api/push, proved by its passkey.
 * The settings live here, per account, and are sent along whenever they
 * change, with the accounts muted and, only while "Pots made with me in them"
 * is on, the Account IDs of the contacts.
 */

export type Sign = (message: string) => Promise<Hex>;

/** The browser can do Web Push, and the app is running from its service worker. */
export function pushSupported(): boolean {
  return typeof navigator !== "undefined" && "serviceWorker" in navigator && typeof window !== "undefined" && "PushManager" in window && "Notification" in window;
}

let infoOnce: Promise<{ enabled: boolean; publicKey?: string }> | null = null;
/** Whether notifications are set up on this site, asked once per page. */
export function pushInfo(): Promise<{ enabled: boolean; publicKey?: string }> {
  infoOnce ??= fetch("/api/push")
    .then(async (r) => (r.ok ? ((await r.json()) as { enabled: boolean; publicKey?: string }) : { enabled: false }))
    .catch(() => ({ enabled: false }));
  return infoOnce;
}

const ON_KEY = "nivpay.push.v1";
const settingsKey = (account: Address) => `nivpay.pushsettings.v1.${DEPLOYMENT}.${getAddress(account)}`;

function onHere(): string[] {
  try {
    const raw = JSON.parse(localStorage.getItem(ON_KEY) ?? "[]") as unknown;
    return Array.isArray(raw) ? raw.filter((a): a is string => typeof a === "string") : [];
  } catch {
    return [];
  }
}
function setOnHere(list: string[]): void {
  try {
    localStorage.setItem(ON_KEY, JSON.stringify([...new Set(list)]));
  } catch {
    // Storage refused: the switch shows off next time; the server still has it.
  }
}

export const pushOnHere = (account: Address) => onHere().includes(`${DEPLOYMENT}:${getAddress(account)}`);

export function pushSettings(account: Address): PushSettings {
  try {
    return cleanSettings(JSON.parse(localStorage.getItem(settingsKey(account)) ?? "null"));
  } catch {
    return DEFAULT_SETTINGS;
  }
}

/** What goes with the subscription: language, settings, muted, and contacts only if needed. */
function extras(account: Address, settings: PushSettings) {
  const trusted = settings.kinds.potNamesYou
    ? [...new ContactStore(localStorage, DEPLOYMENT, account).list().map((c) => c.account), ...new AccountStore(localStorage).list().map((a) => getAddress(a.address)).filter((a) => a.toLowerCase() !== account.toLowerCase())]
    : [];
  return { lang: language(), settings, muted: new MutedStore(localStorage, DEPLOYMENT, account).list(), trusted };
}

function keyBytes(base64url: string): Uint8Array<ArrayBuffer> {
  const b64 = (base64url + "=".repeat((4 - (base64url.length % 4)) % 4)).replace(/-/g, "+").replace(/_/g, "/");
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
}

async function registration(): Promise<ServiceWorkerRegistration | undefined> {
  return navigator.serviceWorker.getRegistration("/");
}

async function post(body: Record<string, unknown>): Promise<void> {
  const res = await fetch("/api/push", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  if (!res.ok) throw new Error(`push refused: ${res.status}`);
}

/** Turn on: only ever called from a tap. Asks the phone, then registers with one fingerprint. */
export async function turnOnPush(account: Address, sign: Sign, now = Date.now()): Promise<void> {
  const info = await pushInfo();
  const reg = pushSupported() && info.enabled && info.publicKey ? await registration() : undefined;
  if (!reg || !info.publicKey) throw new AppError(copy.errPushTurnOn, ERROR_CODES.PUSH_TURN_ON_FAILED);
  const permission = await Notification.requestPermission();
  if (permission !== "granted") throw new AppError(copy.errPushBlocked, ERROR_CODES.PUSH_BLOCKED);
  let sub: PushSubscription;
  try {
    sub = (await reg.pushManager.getSubscription()) ?? (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(info.publicKey) }));
  } catch {
    throw new AppError(copy.errPushTurnOn, ERROR_CODES.PUSH_TURN_ON_FAILED);
  }
  const json = sub.toJSON() as { endpoint: string; keys: { p256dh: string; auth: string } };
  const time = Math.floor(now / 1000);
  const message = proofMessage({ subject: "push", action: "subscribe", account, data: `sha256:${await sha256Hex(new TextEncoder().encode(json.endpoint))}`, time, site: location.host });
  // A cancelled fingerprint says so itself (errors.ts).
  const signature = await sign(message);
  try {
    await post({ action: "subscribe", account: getAddress(account), time, signature, subscription: { endpoint: json.endpoint, keys: json.keys }, ...extras(account, pushSettings(account)) });
  } catch {
    throw new AppError(copy.errPushTurnOn, ERROR_CODES.PUSH_TURN_ON_FAILED);
  }
  setOnHere([...onHere(), `${DEPLOYMENT}:${getAddress(account)}`]);
}

/** Turn off for this account. The browser's subscription goes too once no account on this phone uses it. */
export async function turnOffPush(account: Address): Promise<void> {
  const sub = await (await registration())?.pushManager.getSubscription();
  const mine = `${DEPLOYMENT}:${getAddress(account)}`;
  if (sub) {
    try {
      await post({ action: "unsubscribe", account: getAddress(account), endpoint: sub.endpoint });
    } catch {
      throw new AppError(copy.errPushTurnOn, ERROR_CODES.PUSH_TURN_ON_FAILED);
    }
  }
  const rest = onHere().filter((a) => a !== mine);
  setOnHere(rest);
  if (sub && rest.length === 0) await sub.unsubscribe().catch(() => false);
}

/** Saves the settings here, and on the server if notifications are on for this account. */
export async function savePushSettings(account: Address, settings: PushSettings): Promise<void> {
  try {
    localStorage.setItem(settingsKey(account), JSON.stringify(settings));
  } catch {
    // Storage refused: the server still gets them.
  }
  await syncPush(account);
}

/** Sends the current settings, muted accounts and contacts, if notifications are on for this account. */
export async function syncPush(account: Address): Promise<void> {
  if (!pushOnHere(account) || !pushSupported()) return;
  const sub = await (await registration())?.pushManager.getSubscription().catch(() => null);
  if (!sub) return;
  await post({ action: "settings", account: getAddress(account), endpoint: sub.endpoint, ...extras(account, pushSettings(account)) }).catch(() => {});
}
