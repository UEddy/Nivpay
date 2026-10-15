import { useEffect, useRef, useState, type ReactNode } from "react";
import { copy } from "../copy.ts";
import { SLOW_AFTER_MS, slowStepLine } from "../lib/slowStep.ts";
import { Cancellable } from "../lib/cancel.ts";
import type { ShareResult } from "../lib/share.ts";
import { LastCodeStore } from "../lib/support.ts";
import { amountForField, formatAmount, readAmount } from "../lib/money.ts";
import { BANNER_MS, currentPlatform, InstallStore, installWay, onInstallChange, PausableTimer, promptInstall, shouldShowBanner, type InstallWay } from "../lib/install.ts";
import { dateLocale } from "../lib/locale.ts";

export type Notice = { tone: "ok" | "bad"; text: string; code?: number };

/** Whether the phone says it is online, kept up to date. Offline is certain; online only means it may connect. */
export function useOnline(): boolean {
  const [online, setOnline] = useState(() => typeof navigator === "undefined" || navigator.onLine);
  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    setOnline(navigator.onLine);
    return () => {
      window.removeEventListener("online", on);
      window.removeEventListener("offline", off);
    };
  }, []);
  return online;
}

/** What a step before the passkey is waiting for, once it has run long enough to need saying (lib/slowStep.ts). */
export function useSlowStepLine(step: string | null): string | null {
  const [slow, setSlow] = useState<{ step: string | null; elapsed: number }>({ step, elapsed: 0 });
  useEffect(() => {
    setSlow({ step, elapsed: 0 });
    if (!step) return;
    const t = setTimeout(() => setSlow({ step, elapsed: SLOW_AFTER_MS }), SLOW_AFTER_MS);
    return () => clearTimeout(t);
  }, [step]);
  return slow.step === step ? slowStepLine(step, slow.elapsed) : null;
}

/** The screen's action, cancellable before the passkey (lib/cancel.ts), and stopped if the screen goes away. */
export function useCancellable(): Cancellable {
  const ref = useRef<Cancellable | null>(null);
  ref.current ??= new Cancellable();
  const running = ref.current;
  useEffect(() => () => running.dispose(), [running]);
  return running;
}

/** What a screen shows when X stopped its action. */
export const STOPPED: Notice = { tone: "bad", text: copy.cancelledNothingSent };

/** Opens Help and support over whatever screen is showing (App.tsx HelpHost), with this code filled in. */
export function openHelp(code: number | null = null): void {
  window.dispatchEvent(new CustomEvent("nivpay:help", { detail: { code } }));
}

/**
 * A result line. Failures end with a neutral code people can read out to
 * support, and a Get help link that opens support with the code filled in.
 * The code is remembered on this phone as the last one shown.
 */
export function NoticeLine({ notice }: { notice: Notice }) {
  const { code } = notice;
  useEffect(() => {
    if (code === undefined) return;
    try {
      new LastCodeStore(localStorage).shown(code);
    } catch {
      // Storage refused: support just won't have it filled in.
    }
  }, [code]);
  return (
    <div role="status">
      <p className={notice.tone === "ok" ? "success" : "error"}>{notice.text}</p>
      {code !== undefined && (
        <p className="reason">
          {copy.code(code)}{" "}
          <button type="button" className="text-btn get-help" onClick={() => openHelp(code)}>
            {copy.getHelp}
          </button>
        </p>
      )}
    </div>
  );
}

/** A bottom sheet. Tapping outside closes it. */
export function Sheet(props: { title: string; onClose: () => void; children: ReactNode }) {
  return (
    <div className="sheet-backdrop" role="presentation" onClick={props.onClose}>
      <section className="sheet tall" role="dialog" aria-modal="true" aria-label={props.title} onClick={(e) => e.stopPropagation()}>
        <h2>{props.title}</h2>
        {props.children}
      </section>
    </div>
  );
}

/** Line icons from the comps, drawn in currentColor. */
const ICONS = {
  back: <path d="M15 18l-6-6 6-6" />,
  close: (
    <>
      <path d="M18 6L6 18" />
      <path d="M6 6l12 12" />
    </>
  ),
  people: (
    <>
      <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
      <path d="M16 3.13a4 4 0 0 1 0 7.75" />
    </>
  ),
  drop: <path d="M12 22a7 7 0 0 0 7-7c0-2-1-3.9-3-5.5s-3.5-4-4-6.5c-.5 2.5-2 4.9-4 6.5C6 11.1 5 13 5 15a7 7 0 0 0 7 7z" />,
  calendar: (
    <>
      <rect x="3" y="4" width="18" height="18" rx="2" />
      <path d="M16 2v4" />
      <path d="M8 2v4" />
      <path d="M3 10h18" />
    </>
  ),
  undo: (
    <>
      <path d="M9 14L4 9l5-5" />
      <path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11" />
    </>
  ),
  chevron: <path d="M9 18l6-6-6-6" />,
  check: <path d="M20 6L9 17l-5-5" />,
  more: (
    <>
      <circle cx="5" cy="12" r="1" />
      <circle cx="12" cy="12" r="1" />
      <circle cx="19" cy="12" r="1" />
    </>
  ),
  replay: (
    <>
      <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
      <path d="M3 3v5h5" />
    </>
  ),
  lock: (
    <>
      <rect x="5" y="11" width="14" height="10" rx="2" />
      <path d="M8 11V7a4 4 0 0 1 8 0v4" />
    </>
  ),
  copy: (
    <>
      <rect x="9" y="9" width="12" height="12" rx="2" />
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
    </>
  ),
  /** The iPhone's own Share icon: a box with an arrow out of the top. */
  iosShare: (
    <>
      <path d="M12 3v12" />
      <path d="M8 7l4-4 4 4" />
      <path d="M6 11H5a1 1 0 0 0-1 1v8a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-8a1 1 0 0 0-1-1h-1" />
    </>
  ),
  share: (
    <>
      <circle cx="18" cy="5" r="3" />
      <circle cx="6" cy="12" r="3" />
      <circle cx="18" cy="19" r="3" />
      <path d="M8.6 13.5l6.8 4" />
      <path d="M15.4 6.5l-6.8 4" />
    </>
  ),
} as const;

export function Icon(props: { name: keyof typeof ICONS; size?: number; className?: string }) {
  const size = props.size ?? 18;
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" className={`ico ${props.className ?? ""}`} aria-hidden="true">
      {ICONS[props.name]}
    </svg>
  );
}

export { copyLink, shareLink, type ShareResult } from "../lib/share.ts";

/** A Copy link button that says "Link copied" briefly, for every place that also offers Share. */
export function CopyLinkButton(props: { onCopy: () => Promise<ShareResult>; className?: string; disabled?: boolean }) {
  const [done, setDone] = useState(false);
  useEffect(() => {
    if (!done) return;
    const t = setTimeout(() => setDone(false), 2000);
    return () => clearTimeout(t);
  }, [done]);
  return (
    <button
      type="button"
      className={props.className ?? "btn ghost small"}
      disabled={props.disabled}
      onClick={async () => setDone((await props.onCopy()) === "copied")}
    >
      <Icon name="copy" />
      {done ? copy.linkCopiedShort : copy.copyLink}
    </button>
  );
}

const listFormat = new Intl.ListFormat(dateLocale(), { style: "long", type: "conjunction" });

/** "Caterer and Event hall", "A, B and C". */
export function andList(items: string[]): string {
  return listFormat.format(items);
}

const dayFormat = new Intl.DateTimeFormat(dateLocale(), {
  weekday: "short",
  day: "numeric",
  month: "short",
  year: "numeric",
  timeZone: "UTC",
});

/** A yyyy-mm-dd day as "Thu 31 Dec 2026". The day itself, whatever the phone's zone. */
export function formatDay(day: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
  if (!m) return day;
  return dayFormat.format(new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])))).replace(",", "");
}

/** The phone's own IANA time zone. */
export function phoneTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
}

/** How this phone can install the app right now, kept up to date as the browser offers it. */
export function useInstallWay(): InstallWay | null {
  const [way, setWay] = useState<InstallWay | null>(() => (typeof window === "undefined" ? null : installWay(currentPlatform())));
  useEffect(() => onInstallChange(() => setWay(installWay(currentPlatform()))), []);
  return way;
}

/** The install button, or on iPhone and iPad how to do it with Share. */
export function InstallHow(props: { way: InstallWay; onInstalled?: () => void }) {
  return props.way === "prompt" ? (
    <button
      type="button"
      className="btn primary small"
      onClick={() => {
        void promptInstall().then((ok) => ok && props.onInstalled?.());
      }}
    >
      {copy.installNivPay}
    </button>
  ) : (
    <p className="install-ios">
      <Icon name="iosShare" size={20} />
      <span>{copy.installIos}</span>
    </p>
  );
}

/**
 * Offers to install NivPay, once a day at most, where the phone can and the
 * app isn't installed. It sits in the page's flow, above everything, so it
 * never covers a button. It goes by itself after 10 seconds, which pause
 * while it is touched or focused, and screen readers hear it once, politely.
 */
export function InstallBanner() {
  const way = useInstallWay();
  const [open, setOpen] = useState(false);
  const timer = useRef<PausableTimer | null>(null);
  const decided = useRef(false);

  useEffect(() => {
    if (decided.current || !way) return;
    decided.current = true;
    let store: InstallStore;
    try {
      store = new InstallStore(localStorage);
    } catch {
      return;
    }
    const now = Date.now();
    if (!shouldShowBanner(way, store.get(), now)) return;
    store.shown(now);
    timer.current = new PausableTimer(BANNER_MS);
    timer.current.start(now);
    setOpen(true);
  }, [way]);

  useEffect(() => {
    if (!open) return;
    const t = setInterval(() => {
      if (timer.current && timer.current.remaining(Date.now()) <= 0) setOpen(false);
    }, 250);
    return () => clearInterval(t);
  }, [open]);

  // Installed meanwhile, or the browser took the offer back.
  useEffect(() => {
    if (!way) setOpen(false);
  }, [way]);

  if (!open || !way) return null;
  const hold = (why: string) => () => timer.current?.hold(why, Date.now());
  const release = (why: string) => () => timer.current?.release(why, Date.now());
  return (
    <aside
      className="install-banner enter"
      aria-label={copy.installNivPay}
      onPointerEnter={hold("pointer")}
      onPointerLeave={release("pointer")}
      onPointerDown={hold("touch")}
      onPointerUp={release("touch")}
      onPointerCancel={release("touch")}
      onFocus={hold("focus")}
      onBlur={release("focus")}
    >
      <div className="grow" role="status" aria-live="polite">
        <p className="install-title">{copy.installNivPay}</p>
        {way === "ios" ? <InstallHow way={way} /> : <p className="hint">{copy.installHint}</p>}
      </div>
      {way === "prompt" && <InstallHow way={way} onInstalled={() => setOpen(false)} />}
      <button type="button" className="icon-btn" aria-label={copy.close} onClick={() => setOpen(false)}>
        <Icon name="close" size={20} />
      </button>
    </aside>
  );
}

/**
 * Under every amount field: the amount the app understood, the reader's way
 * ("That's $10.50."), before any confirm, or how to write it. In French
 * "10,50" is $10.50, and "1,000" is refused, never read as $1.
 */
export function AmountUnderstood(props: { text: string; decimals: number | null; maxFraction?: number; show?: (v: bigint) => string }) {
  const { text, decimals } = props;
  if (decimals === null || !text.trim()) return null;
  const r = readAmount(text, decimals, props.maxFraction ?? Math.min(2, decimals));
  if ("value" in r) {
    return (
      <p className="hint amount-understood" aria-live="polite">
        {copy.amountUnderstood(props.show ? props.show(r.value) : formatAmount(r.value, decimals, "cents"))}
      </p>
    );
  }
  return (
    <p className="error" aria-live="polite">
      {r.problem === "decimals" ? copy.amountTooManyDecimals : copy.amountWriteLike(amountForField(105_050n * 10n ** BigInt(Math.max(0, decimals - 2)), decimals))}
    </p>
  );
}
