/**
 * Installing NivPay on the phone's home screen.
 *
 * Chrome and other browsers that support it send beforeinstallprompt; the
 * app keeps that event and opens the phone's own install prompt from a
 * button. iPhone and iPad send nothing, so there the app says how: Share,
 * then Add to Home Screen. Anywhere else installing isn't offered, and
 * nothing is shown. Once installed, never again.
 *
 * The banner shows at most once a day, from the time it was last shown,
 * kept on this phone.
 */

export type InstallWay = "prompt" | "ios";

export type Platform = {
  /** Already running as the installed app. */
  standalone: boolean;
  /** The browser sent beforeinstallprompt, and it hasn't been used. */
  hasPrompt: boolean;
  userAgent: string;
  maxTouchPoints: number;
};

/** iPhone, iPod, or an iPad, which says it's a Mac but has a touch screen. */
export function isAppleTouch(userAgent: string, maxTouchPoints: number): boolean {
  return /iPhone|iPad|iPod/.test(userAgent) || (/Macintosh/.test(userAgent) && maxTouchPoints > 1);
}

/** Apps that open links in their own browser, with no Add to Home Screen. */
export function inAppBrowser(userAgent: string): boolean {
  return /FBAN|FBAV|Instagram|Line\/|Twitter|TikTok|Snapchat/i.test(userAgent);
}

/** How this phone can install the app, or null where it can't or already has. */
export function installWay(p: Platform): InstallWay | null {
  if (p.standalone) return null;
  if (p.hasPrompt) return "prompt";
  if (isAppleTouch(p.userAgent, p.maxTouchPoints) && !inAppBrowser(p.userAgent)) return "ios";
  return null;
}

export const DAY_MS = 24 * 60 * 60 * 1000;
/** The banner hides by itself after this long, not counting time it is touched or focused. */
export const BANNER_MS = 10_000;

export type InstallMemory = { lastShown: number | null; installed: boolean };

export function shouldShowBanner(way: InstallWay | null, memory: InstallMemory, now: number): boolean {
  if (!way || memory.installed) return false;
  return memory.lastShown === null || now - memory.lastShown >= DAY_MS;
}

type KeyValue = Pick<Storage, "getItem" | "setItem">;
const KEY = "nivpay.install.v1";

export class InstallStore {
  private readonly kv: KeyValue;

  constructor(kv: KeyValue) {
    this.kv = kv;
  }

  get(): InstallMemory {
    try {
      const raw = JSON.parse(this.kv.getItem(KEY) ?? "null") as Partial<InstallMemory> | null;
      return { lastShown: typeof raw?.lastShown === "number" ? raw.lastShown : null, installed: raw?.installed === true };
    } catch {
      return { lastShown: null, installed: false };
    }
  }

  shown(now: number): void {
    this.kv.setItem(KEY, JSON.stringify({ ...this.get(), lastShown: now }));
  }

  installed(): void {
    this.kv.setItem(KEY, JSON.stringify({ ...this.get(), installed: true }));
  }
}

/**
 * A countdown that pauses: the banner's 10 seconds stop while it is touched
 * or focused, so slower readers can finish, and carry on from where they
 * were once it is let go.
 */
export class PausableTimer {
  private left: number;
  private startedAt: number | null = null;
  private paused = new Set<string>();

  constructor(ms: number) {
    this.left = ms;
  }

  /** Starts or resumes, at `now`. */
  start(now: number): void {
    if (this.startedAt === null && this.paused.size === 0) this.startedAt = now;
  }

  /** Something holds it: a finger, the pointer or focus. Each is released separately. */
  hold(reason: string, now: number): void {
    if (this.startedAt !== null) {
      this.left -= now - this.startedAt;
      this.startedAt = null;
    }
    this.paused.add(reason);
  }

  release(reason: string, now: number): void {
    this.paused.delete(reason);
    this.start(now);
  }

  /** Milliseconds until it is done; Infinity while held. */
  remaining(now: number): number {
    if (this.startedAt === null) return this.paused.size ? Infinity : this.left;
    return Math.max(0, this.left - (now - this.startedAt));
  }
}

// What the browser tells us, kept from the moment the app loads, since
// beforeinstallprompt can fire before anything is on screen.
type PromptEvent = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: "accepted" | "dismissed" }> };
let deferred: PromptEvent | null = null;
const listeners = new Set<() => void>();
const changed = () => listeners.forEach((l) => l());

if (typeof window !== "undefined") {
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    deferred = e as PromptEvent;
    changed();
  });
  window.addEventListener("appinstalled", () => {
    deferred = null;
    try {
      new InstallStore(localStorage).installed();
    } catch {
      // Storage refused: the app still knows from display-mode once it runs installed.
    }
    changed();
  });
}

/** This phone, now. */
export function currentPlatform(): Platform {
  const standalone =
    window.matchMedia?.("(display-mode: standalone)").matches === true || (navigator as Navigator & { standalone?: boolean }).standalone === true;
  return { standalone, hasPrompt: deferred !== null, userAgent: navigator.userAgent, maxTouchPoints: navigator.maxTouchPoints ?? 0 };
}

export function onInstallChange(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Opens the phone's install prompt. True if the person installed. The event can be used once. */
export async function promptInstall(): Promise<boolean> {
  const e = deferred;
  if (!e) return false;
  deferred = null;
  await e.prompt();
  const { outcome } = await e.userChoice;
  changed();
  return outcome === "accepted";
}
