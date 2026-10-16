import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { encodeFunctionData, type Address } from "viem";
import { copy, ERROR_CODES } from "../copy.ts";
import { NAMES_ABI } from "../lib/abi.ts";
import { liveWriteChain } from "../lib/chain.ts";
import { NAMES } from "../lib/config.ts";
import { AppError, describeFailure, SendFailure } from "../lib/errors.ts";
import { idbWriteStore } from "../lib/idb.ts";
import { names as reader, USERNAME_LABEL, usernameOf } from "../lib/names.ts";
import { rememberReceipt } from "../lib/receipts.ts";
import { reloadOnce } from "../lib/reloadOnce.ts";
import type { Step } from "../lib/send.ts";
import { availability, normalizeUsername, usernameProblem, type Availability, type UsernameProblem } from "../lib/usernames.ts";
import { followToFinality, type PendingWrite } from "../lib/writes.ts";
import { NoticeLine, type Notice } from "./ui.tsx";
import { dateLocale } from "../lib/locale.ts";

/**
 * Usernames on screen (README, "Usernames for accounts"). Everything here is
 * off while config.ts has no NAMES: no reads, nothing shown. Reads are at
 * the finalized block; a claim, change or let go goes through sendWrite with
 * a "username" label, so a reload picks it back up, and shows as done only
 * once final.
 */

// The signing code loads only when it is needed, as on Home (App.tsx).
const sending = () => reloadOnce(() => import("../lib/send.ts"));

type Kind = "claim" | "release";
function fromLabel(label: string): { kind: Kind; name: string } | null {
  const [tag, kind, name] = label.split(" ");
  return tag === USERNAME_LABEL && (kind === "claim" || kind === "release") && name ? { kind, name } : null;
}

/** An Account ID. Named so, since what a screen file says is checked for words people mustn't see. */
type Account = Address;

const dayFormat = new Intl.DateTimeFormat(dateLocale(), { weekday: "short", day: "numeric", month: "short", year: "numeric" });
/** A time in seconds as "Thu 14 Jan 2027", in the phone's own time. */
export const dayOf = (seconds: bigint) => dayFormat.format(new Date(Number(seconds) * 1000)).replace(",", "");

/** What the screen says about a name as it is typed, read a moment after typing stops. */
export function useAvailability(typed: string, me: Address): Availability | "checking" | null {
  const name = normalizeUsername(typed);
  const [state, setState] = useState<Availability | "checking" | null>(null);
  useEffect(() => {
    const r = reader;
    if (!r || !name) return setState(null);
    const problem = usernameProblem(name);
    if (problem) return setState({ kind: "notAllowed", problem });
    setState("checking");
    let live = true;
    const t = setTimeout(() => {
      void r
        .finalized()
        .then((at) => r.lookup(name, at))
        .then((read) => live && setState(availability(name, me, read)))
        .catch(() => live && setState(null));
    }, 350);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [name, me]);
  return state;
}

/** Each listed account's username, by lowercase account, read once at a finalized block. */
const known = new Map<string, string>();
export function useUsernames(accounts: readonly string[]): Record<string, string> {
  const key = [...new Set(accounts.map((a) => a.toLowerCase()))].sort().join(",");
  const [names, setNames] = useState<Record<string, string>>(() => {
    const wanted = new Set(key.split(","));
    return Object.fromEntries([...known].filter(([a]) => wanted.has(a)));
  });
  useEffect(() => {
    const r = reader;
    if (!r || !key) return;
    let live = true;
    const list = key.split(",") as Account[];
    void r
      .finalized()
      .then((at) => r.namesOf(list, at))
      .then((found) => {
        list.forEach((a, i) => (found[i] ? known.set(a, found[i]!) : known.delete(a)));
        if (live) setNames(Object.fromEntries(list.flatMap((a, i) => (found[i] ? [[a, found[i]!]] : []))));
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [key]);
  return names;
}

/**
 * "Idara (@idara)": a name with the account's username beside it, never in
 * its place. The name is still the one signed in the link, or the account
 * ending; the username only helps tell people apart.
 */
export function withUsernameOf(usernames: Record<string, string>, account: Account, name: string): string {
  const u = usernames[account.toLowerCase()];
  return u ? copy.withUsername(name, u) : name;
}

const PROBLEM_TEXT: Record<UsernameProblem, string> = {
  short: copy.usernameShort,
  long: copy.usernameLong,
  start: copy.usernameStart,
  characters: copy.usernameCharacters,
  underscores: copy.usernameUnderscores,
  end: copy.usernameEnd,
  reserved: copy.usernameReserved,
};

export function availabilityText(name: string, a: Availability | "checking" | null): { text: string; ok: boolean } | null {
  if (a === null) return null;
  if (a === "checking") return { text: copy.checkingUsername, ok: false };
  switch (a.kind) {
    case "notAllowed":
      return { text: PROBLEM_TEXT[a.problem], ok: false };
    case "yours":
      return { text: copy.usernameIsYours, ok: false };
    case "taken":
      return { text: copy.usernameTaken(name), ok: false };
    case "available":
      return { text: copy.usernameAvailable(name), ok: true };
    case "takeBack":
      return { text: copy.usernameTakeBack(name), ok: true };
    case "held":
      return { text: copy.usernameFreeOn(name, dayOf(a.until)), ok: false };
  }
}

const STEP_TEXT: Record<Step | "landing", string> = {
  preparing: copy.stepPreparing,
  "getting-ready": copy.stepGettingReady,
  confirm: copy.stepConfirm,
  sending: copy.createSending,
  landing: copy.stepSettling,
};

/**
 * This account's username: read at the finalized block, claimed, changed or
 * let go with one fingerprint, and picked back up after a reload. Lives on
 * Home, so a change in flight is followed even with Account details closed.
 */
export function useMyUsername(me: Address) {
  const [name, setName] = useState<string | null | undefined>(undefined);
  const [step, setStep] = useState<Step | "landing" | null>(null);
  const [result, setResult] = useState<Notice | null>(null);
  const [stuck, setStuck] = useState<{ kind: Kind; name: string } | null>(null);
  const alive = useRef(true);

  const refresh = useCallback(async () => {
    const n = await usernameOf(me);
    if (alive.current) setName(n);
    return n;
  }, [me]);

  const land = useCallback(
    async (write: PendingWrite, what: { kind: Kind; name: string }) => {
      setStep("landing");
      try {
        const outcome = await followToFinality(idbWriteStore, liveWriteChain, write);
        if (!alive.current) return;
        setStep(null);
        if (outcome.kind === "final") {
          rememberReceipt(write.address, write.hash);
          setStuck(null);
          await refresh().catch(() => {});
          setResult({ tone: "ok", text: what.kind === "claim" ? copy.usernameClaimed(what.name) : copy.usernameLetGoDone(what.name) });
        } else if (outcome.kind === "stuck") {
          setStuck(what);
          // Turned down twice by the node (56), or not in any block in time (51), as the other screens say it.
          setResult(outcome.refused ? { tone: "bad", text: copy.requestTurnedDown, code: ERROR_CODES.REFUSED } : { tone: "bad", text: copy.stuck, code: ERROR_CODES.STUCK });
        } else {
          setStuck(null);
          setResult({ tone: "bad", text: copy.usernameDidNotGoThrough, code: outcome.kind === "reverted" ? ERROR_CODES.REVERTED : ERROR_CODES.SUPERSEDED });
        }
      } catch (e) {
        if (!alive.current) return;
        setStep(null);
        setResult({ tone: "bad", ...describeFailure(new SendFailure("confirming", true, e)) });
      }
    },
    [refresh],
  );

  useEffect(() => {
    alive.current = true;
    if (!reader) return;
    void refresh().catch(() => {});
    // A claim, change or let go in flight when the app was closed.
    void idbWriteStore.get(me).then((w) => {
      const what = w ? fromLabel(w.label) : null;
      if (!w || !what || !alive.current) return;
      if (w.replaceable) {
        setStuck(what);
        setResult({ tone: "bad", text: copy.earlierStuck, code: ERROR_CODES.STUCK });
      } else void land(w, what);
    });
    return () => {
      alive.current = false;
    };
  }, [me, refresh, land]);

  const run = async (what: { kind: Kind; name: string }, retry = false) => {
    if (!reader || !NAMES) return;
    setResult(null);
    setStep("preparing");
    try {
      if (what.kind === "claim" && !retry) {
        // Every refusal the contract would make, found before anything is signed.
        const a = availability(what.name, me, await reader.lookup(what.name, await reader.finalized()));
        if (a.kind === "notAllowed") throw new AppError(copy.errNameNotAllowed, ERROR_CODES.NAME_NOT_ALLOWED);
        if (a.kind === "taken") throw new AppError(copy.errNameTaken, ERROR_CODES.NAME_TAKEN);
        if (a.kind === "held") throw new AppError(copy.errNameHeld(dayOf(a.until)), ERROR_CODES.NAME_HELD);
        if (a.kind === "yours") {
          setStep(null);
          return;
        }
      }
      const { retryStuckWrite, sendWrite } = await sending();
      const call = {
        from: me,
        to: NAMES,
        data: what.kind === "claim" ? encodeFunctionData({ abi: NAMES_ABI, functionName: "claim", args: [what.name] }) : encodeFunctionData({ abi: NAMES_ABI, functionName: "release" }),
        label: `${USERNAME_LABEL} ${what.kind} ${what.name}`,
        onStep: (s: Step) => alive.current && setStep(s),
      };
      const write = retry ? await retryStuckWrite(call) : await sendWrite(call);
      await land(write, what);
    } catch (e) {
      if (!alive.current) return;
      setStep(null);
      setResult({ tone: "bad", ...(e instanceof AppError ? { text: e.message, code: e.code } : describeFailure(e)) });
    }
  };

  return {
    /** undefined until read; null for none. Changes only once a claim or let go is final. */
    name,
    step,
    busyText: step ? STEP_TEXT[step] : null,
    result,
    stuck,
    claim: (n: string) => run({ kind: "claim", name: n }),
    letGo: () => name && run({ kind: "release", name }),
    retry: () => stuck && run(stuck, true),
    clearResult: () => setResult(null),
  };
}

export type MyUsername = ReturnType<typeof useMyUsername>;

/** "Choose a username", beside the Account ID in Account details. */
export function UsernameSection(props: { me: Address; start?: "view" | "choose"; inScreen?: boolean }) {
  const u = useMyUsername(props.me);
  const [mode, setMode] = useState<"view" | "choose" | "letGo">(props.start ?? "view");
  const [typed, setTyped] = useState("");
  const target = normalizeUsername(typed);
  const status = useAvailability(typed, props.me);
  const said = useMemo(() => availabilityText(target, status), [target, status]);
  const busy = u.step !== null;
  // Back to the plain view once a claim or let go is final.
  useEffect(() => {
    if (u.result?.tone === "ok") {
      setMode("view");
      setTyped("");
    }
  }, [u.result]);

  const plainWords = (
    <>
      <p className="hint">{copy.usernamePublic}</p>
      <p className="hint">{copy.usernameLetGoNote}</p>
      <p className="hint">{copy.usernameHoldNote}</p>
    </>
  );

  return (
    <section className="username-section" aria-labelledby="username-title">
      <p className={props.inScreen ? "sr-only" : "eyebrow"} id="username-title">
        {copy.username}
      </p>
      {u.name === undefined ? (
        <p className="hint">{copy.checkingUsername}</p>
      ) : mode === "view" ? (
        <>
          {u.name ? <p className="name">{copy.yourUsername(u.name)}</p> : null}
          {busy && (
            <p className="hint" role="status">
              {copy.usernameStillGoing} {u.busyText}
            </p>
          )}
          <div className="new-pot-actions">
            <button type="button" className="btn small" disabled={busy} onClick={() => (u.clearResult(), setMode("choose"))}>
              {u.name ? copy.changeUsername : copy.chooseUsername}
            </button>
            {u.name && (
              <button type="button" className="btn ghost small" disabled={busy} onClick={() => (u.clearResult(), setMode("letGo"))}>
                {copy.letGoUsername}
              </button>
            )}
          </div>
        </>
      ) : mode === "choose" ? (
        <form
          className="name-form"
          onSubmit={(e) => {
            e.preventDefault();
            if (said?.ok && !busy) void u.claim(target);
          }}
        >
          <label className="field">
            <span>{u.name ? copy.changeUsername : copy.chooseUsername}</span>
            <input
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              autoComplete="off"
              autoCapitalize="off"
              spellCheck={false}
              maxLength={40}
              placeholder={copy.usernamePlaceholder}
              disabled={busy}
            />
          </label>
          <p className="hint">{copy.usernameHint}</p>
          {said && <p className={said.ok ? "success" : "hint"} role="status">{said.text}</p>}
          {plainWords}
          <button type="submit" className="btn primary" disabled={!said?.ok || busy} aria-busy={busy}>
            {u.busyText ?? (u.name ? copy.changeTo(target) : copy.claimUsername(target))}
          </button>
          <button type="button" className="btn ghost" disabled={busy} onClick={() => setMode("view")}>
            {copy.back}
          </button>
        </form>
      ) : (
        <>
          {plainWords}
          <button type="button" className="btn primary" disabled={busy} aria-busy={busy} onClick={() => void u.letGo()}>
            {u.busyText ?? copy.letGoOf(u.name ?? "")}
          </button>
          <button type="button" className="btn ghost" disabled={busy} onClick={() => setMode("view")}>
            {copy.back}
          </button>
        </>
      )}
      {u.result && <NoticeLine notice={u.result} />}
      {u.stuck && !busy && (
        <button type="button" className="btn" onClick={() => void u.retry()}>
          {copy.tryAgain}
        </button>
      )}
    </section>
  );
}
