import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { encodeFunctionData, type Hex } from "viem";
import { copy, ERROR_CODES } from "../copy.ts";
import { POTS_ABI } from "../lib/abi.ts";
import type { StoredAccount } from "../lib/accounts.ts";
import { liveWriteChain, waitForFinalized } from "../lib/chain.ts";
import { POTS } from "../lib/deployment.ts";
import {
  allDeciders,
  checkDraft,
  confirmsAccount,
  newSlot,
  parseAccountId,
  withDecider,
  withoutDecider,
  withPayeeAccount,
  type Draft,
  type DraftStore,
  type Missing,
} from "../lib/draft.ts";
import { describeFailure, SendFailure } from "../lib/errors.ts";
import { idbWriteStore } from "../lib/idb.ts";
import { decodeLink, linkUrl, NO_SLOT, ROLE, signLabels, type Reply } from "../lib/invites.ts";
import { formatAmount, parseAmount } from "../lib/money.ts";
import { checkCreate, CREATE_LABEL, potFragment, potMadeBy, readCreateTerms, type CreateTerms } from "../lib/pots.ts";
import { acceptReply } from "../lib/replies.ts";
import { retryStuckWrite, sendWrite, type Step } from "../lib/send.ts";
import { fitsText32 } from "../lib/text32.ts";
import { followToFinality, type PendingWrite } from "../lib/writes.ts";
import { PotMap } from "./PotMap.tsx";
import { andList, formatDay, Icon, NoticeLine, phoneTimeZone, shareLink, Sheet, type Notice } from "./ui.tsx";

type SheetKind = "name" | "deciders" | "payees" | "closes" | "leftover" | "confirm";

const STEP_LABEL: Record<Step | "landing", string> = {
  preparing: copy.stepPreparing,
  "getting-ready": copy.stepGettingReady,
  confirm: copy.stepConfirm,
  sending: copy.lockingTheRules,
  landing: copy.lockingTheRules,
};

const MISSING_LABEL: Record<Missing, string> = {
  name: copy.missingName,
  city: copy.missingCity,
  deciders: copy.missingDeciders,
  payees: copy.missingPayees,
  "payee-account": copy.missingPayeeAccount,
  closes: copy.missingCloses,
  "closes-past": copy.missingClosesPast,
};

const writeLabel = (draft: Draft) => `${CREATE_LABEL} ${draft.id}`;
const ending = (account: string) => copy.accountEnding(account);

/** Make a pot (docs/design/Live-Create.dc.html). */
export function CreateScreen(props: {
  account: StoredAccount;
  draftId: Hex;
  drafts: DraftStore;
  banner: ReactNode;
  notice: Notice | null;
  onBack: () => void;
}) {
  const { account, drafts, draftId } = props;
  const [draft, setDraft] = useState<Draft | undefined>(() => drafts.get(draftId));
  const [terms, setTerms] = useState<CreateTerms | null>(null);
  const [termsAt, setTermsAt] = useState(0);
  const [termsFailed, setTermsFailed] = useState(false);
  const [sheet, setSheet] = useState<SheetKind | null>(null);
  const [step, setStep] = useState<Step | "landing" | null>(null);
  const [result, setResult] = useState<Notice | null>(props.notice);
  const [stuck, setStuck] = useState(false);
  const [celebrate, setCelebrate] = useState(false);
  const [announce, setAnnounce] = useState("");
  const [shareNote, setShareNote] = useState<string | null>(null);
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  /** Saves a change to the draft as it is now in storage, not as this screen last saw it. */
  const update = useCallback(
    (change: (d: Draft) => Draft) => {
      const current = drafts.get(draftId);
      if (!current) return;
      const next = change(current);
      drafts.put(next);
      if (alive.current) setDraft(next);
    },
    [drafts, draftId],
  );

  const loadTerms = useCallback(() => {
    setTermsFailed(false);
    readCreateTerms()
      .then((t) => {
        if (!alive.current) return;
        setTerms(t);
        setTermsAt(Date.now());
        setTermsFailed(false);
      })
      .catch(() => alive.current && setTermsFailed(true));
  }, []);
  useEffect(loadTerms, [loadTerms]);

  /** Chain time, moved on by the phone's clock since it was read. */
  const nowSeconds = () => (terms ? terms.now + BigInt(Math.floor((Date.now() - termsAt) / 1000)) : 0n);

  const finish = useCallback(
    async (hash: Hex) => {
      const sending = drafts.get(draftId)?.sending;
      if (!sending || sending.hash !== hash) return;
      const made = await potMadeBy(hash);
      const fragment = potFragment(made.potId, made.block, sending.people, sending.labelsSignature);
      update((d) => ({ ...d, sending: undefined, made: { potId: made.potId.toString(), block: made.block.toString(), fragment } }));
      if (!alive.current) return;
      setStep(null);
      setStuck(false);
      setResult(null);
      setCelebrate(true);
      const d = drafts.get(draftId);
      if (d) setAnnounce(copy.potMadeAnnounce(d.name, andList(d.payees.map((p) => p.name))));
    },
    [drafts, draftId, update],
  );

  const failed = useCallback(
    (notice: Notice) => {
      update((d) => ({ ...d, sending: undefined }));
      if (!alive.current) return;
      setStep(null);
      setStuck(false);
      setResult(notice);
    },
    [update],
  );

  /** Follows our own createPot to the finalized receipt. Nothing lands before that. */
  const land = useCallback(
    async (write: PendingWrite) => {
      setStep("landing");
      try {
        const outcome = await followToFinality(idbWriteStore, liveWriteChain, write);
        if (outcome.kind === "final") await finish(write.hash);
        else if (outcome.kind === "reverted") failed({ tone: "bad", text: copy.createDidNotGoThrough, code: ERROR_CODES.REVERTED });
        else if (outcome.kind === "superseded") failed({ tone: "bad", text: copy.createDidNotGoThrough, code: ERROR_CODES.SUPERSEDED });
        else if (alive.current) {
          setStep(null);
          setStuck(true);
          setResult({ tone: "bad", text: copy.stuck, code: ERROR_CODES.STUCK });
        }
      } catch (e) {
        // It was sent; only following it failed. Opening the pot again resumes.
        if (!alive.current) return;
        setStep(null);
        setResult({ tone: "bad", ...describeFailure(new SendFailure("confirming", true, e)) });
      }
    },
    [finish, failed],
  );

  // Resume a pot that was being made when the app was closed.
  useEffect(() => {
    const d = drafts.get(draftId);
    if (!d?.sending || d.made) return;
    const sending = d.sending;
    void (async () => {
      const w = await idbWriteStore.get(account.address).catch(() => undefined);
      if (w && w.label === writeLabel(d)) {
        if (w.replaceable) {
          setStuck(true);
          setResult({ tone: "bad", text: copy.earlierStuck, code: ERROR_CODES.STUCK });
        } else if (w.hash === sending.hash) {
          await land(w);
        }
        return;
      }
      // Its record is gone, so it already ended one way or another. Find out which.
      setStep("landing");
      try {
        const receipt = await liveWriteChain.getReceipt(sending.hash);
        if (!receipt) {
          failed({ tone: "bad", text: copy.createDidNotGoThrough, code: ERROR_CODES.SUPERSEDED });
          return;
        }
        const status = await waitForFinalized(sending.hash);
        if (status === "success") await finish(sending.hash);
        else failed({ tone: "bad", text: copy.createDidNotGoThrough, code: ERROR_CODES.REVERTED });
      } catch (e) {
        if (!alive.current) return;
        setStep(null);
        setResult({ tone: "bad", ...describeFailure(new SendFailure("confirming", true, e)) });
      }
    })();
  }, [account.address, draftId, drafts, failed, finish, land]);

  const people = useMemo(() => (draft ? allDeciders(draft, account.name) : []), [draft, account.name]);

  if (!draft) {
    return (
      <div className="screen">
        <Bar title={copy.newPot} onBack={props.onBack} />
        <div className="screen-body">
          <NoticeLine notice={{ tone: "bad", text: copy.errReplyNotHere, code: ERROR_CODES.REPLY_NOT_HERE }} />
        </div>
      </div>
    );
  }

  const decimals = terms?.decimals ?? null;
  const amount = (cap: string) => (decimals === null ? "…" : formatAmount(BigInt(cap), decimals, "auto"));
  const made = draft.made;
  const locked = Boolean(made || draft.sending || step);
  const check = terms ? checkDraft(draft, terms, nowSeconds(), POTS) : null;
  const others = people.slice(1).map((p) => p.name);

  const make = async (retry: boolean) => {
    if (!terms) return;
    const { args } = checkDraft(draft, terms, nowSeconds(), POTS);
    if (!args) return;
    setSheet(null);
    setResult(null);
    setShareNote(null);
    const signedPeople = allDeciders(draft, account.name);
    const call = {
      from: account.address,
      to: POTS,
      data: encodeFunctionData({ abi: POTS_ABI, functionName: "createPot", args }),
      label: writeLabel(draft),
      onStep: setStep,
      // The pot's labels are signed with the pot, in the same passkey step.
      cosign: async (signer: Parameters<typeof signLabels>[0], hash: Hex) => {
        const labelsSignature = await signLabels(signer, POTS, hash, signedPeople);
        update((d) => ({ ...d, sending: { hash, labelsSignature, people: signedPeople } }));
      },
    };
    try {
      if (!retry) {
        // Ask first, so a pot the rules would refuse costs no grant and no passkey.
        setStep("preparing");
        await checkCreate(account.address, args);
      }
      const write = retry ? await retryStuckWrite(call) : await sendWrite(call);
      await land(write);
    } catch (e) {
      setStep(null);
      // Nothing was broadcast: forget the labels signed for a transaction that never left.
      if (!(e instanceof SendFailure && e.broadcast) && !retry) update((d) => ({ ...d, sending: undefined }));
      setResult({ tone: "bad", ...describeFailure(e) });
    }
  };

  const share = async (url: string, text: string) => {
    setShareNote(null);
    const how = await shareLink(url, text);
    if (how === "copied") setShareNote(copy.linkCopied);
    if (how === "failed") setShareNote(copy.copyFailed);
  };

  const addReply = async (reply: Reply) => {
    const accepted = await acceptReply(drafts, POTS, reply);
    setDraft(accepted.draft);
    return accepted.text;
  };

  const potUrl = made ? `${location.origin}/#${made.fragment}` : "";

  const mapPeople = people.map((p, i) => ({ name: p.name, city: p.city || copy.yourCity, you: i === 0 }));
  const mapPayees = draft.payees.map((p) => ({ name: p.name, sub: copy.upTo(amount(p.cap)) }));
  const mapLabel = copy.map(
    andList(mapPeople.map((p) => `${p.name} in ${p.city}`)),
    draft.payees.length ? andList(draft.payees.map((p) => p.name)) : copy.nobodyYet,
  );

  const shownPayees = draft.payees.slice(0, 2);

  return (
    <div className="screen">
      <Bar title={copy.newPot} onBack={props.onBack} />
      {props.banner}
      <div className="screen-body">
        <PotMap
          people={mapPeople}
          payees={mapPayees}
          potText={decimals === null ? "$0" : formatAmount(0n, decimals, "auto")}
          state={made ? "live" : "draft"}
          celebrate={celebrate}
          label={mapLabel}
        />

        <div className="intro enter" style={{ animationDelay: "150ms" }}>
          {locked ? (
            <h1>{copy.potTitle(draft.name)}</h1>
          ) : (
            <button type="button" className={`title-btn${draft.name ? "" : " empty"}`} onClick={() => setSheet("name")}>
              {draft.name ? copy.potTitle(draft.name) : copy.nameYourPot}
            </button>
          )}
          <p>{copy.createLede}</p>
        </div>

        <div className="rules enter" style={{ animationDelay: "260ms" }}>
          <RuleRow icon="people" k={copy.whoDecides} disabled={locked} onClick={() => setSheet("deciders")}
            v={people.length > 1 ? people.map((p) => p.name).join(", ") : copy.justYouSoFar}
            side={<span className="rule-chip">{copy.ofN(draft.threshold, people.length)}</span>}
          />
          <RuleRow icon="drop" k={copy.poursOnlyTo} disabled={locked} onClick={() => setSheet("payees")}
            v={draft.payees.length ? andList(draft.payees.map((p) => p.name)) : copy.addWhereItPays}
            unset={!draft.payees.length}
            side={
              draft.payees.length ? (
                <span className="row-side">
                  {shownPayees.map((p, i) => (
                    <span key={p.slot}>
                      {i > 0 && <br />}
                      {copy.upTo(amount(p.cap))}
                    </span>
                  ))}
                  {draft.payees.length > 2 && (
                    <>
                      <br />
                      {copy.morePayees(draft.payees.length - 2)}
                    </>
                  )}
                </span>
              ) : (
                <Icon name="chevron" className="row-chevron" />
              )
            }
          />
          <RuleRow icon="calendar" k={copy.closes} disabled={locked} onClick={() => setSheet("closes")}
            v={draft.closes ? formatDay(draft.closes) : copy.chooseADate}
            unset={!draft.closes}
            side={<Icon name="chevron" className="row-chevron" />}
          />
          <RuleRow icon="undo" k={copy.leftover} onClick={() => setSheet("leftover")} v={copy.leftoverValue}
            side={<Icon name="chevron" className="row-chevron" />}
          />
        </div>

        <div className={`lock-note enter${made ? " locked" : ""}`} style={{ animationDelay: "360ms" }}>
          <Icon name="lock" />
          <span>{made ? copy.lockAfter : copy.lockBefore}</span>
        </div>
      </div>

      <div className="screen-foot enter" style={{ animationDelay: "420ms" }}>
        <p className="sr-only" aria-live="polite">
          {announce}
        </p>
        {made ? (
          <>
            <p className="foot-line">{others.length ? copy.potMade(andList(others)) : copy.potMadeAlone}</p>
            <button type="button" className="pill-btn" onClick={() => share(potUrl, copy.shareText(draft.name))}>
              <Icon name="share" />
              {copy.shareInviteLink}
            </button>
            {shareNote && <p className="foot-hint">{shareNote}</p>}
          </>
        ) : (
          <>
            {result && <NoticeLine notice={result} />}
            {stuck && step === null ? (
              <button type="button" className="pill-btn" onClick={() => make(true)}>
                {copy.tryAgain}
              </button>
            ) : (
              <button
                type="button"
                className={`pill-btn${step ? " busy" : ""}`}
                disabled={step !== null || !check?.args || Boolean(draft.sending)}
                aria-busy={step !== null}
                onClick={() => setSheet("confirm")}
              >
                {step ? STEP_LABEL[step] : copy.makeThePot}
              </button>
            )}
            {!step && !draft.sending && check && check.missing.length > 0 && (
              <p className="foot-hint">{copy.stillNeeded(andList(check.missing.map((m) => MISSING_LABEL[m])))}</p>
            )}
            {!terms && <p className="foot-hint">{termsFailed ? copy.errSetupUnreachable : copy.readingPotRules}</p>}
            {!terms && termsFailed && (
              <button type="button" className="btn" onClick={loadTerms}>
                {copy.tryAgain}
              </button>
            )}
          </>
        )}
      </div>

      {sheet === "name" && (
        <NameSheet draft={draft} onSave={(name) => update((d) => ({ ...d, name }))} onClose={() => setSheet(null)} />
      )}
      {sheet === "deciders" && (
        <DecidersSheet
          draft={draft}
          me={account}
          update={update}
          onReply={addReply}
          onShare={share}
          shareNote={shareNote}
          maxDeciders={terms?.maxDeciders ?? null}
          onClose={() => setSheet(null)}
        />
      )}
      {sheet === "payees" && (
        <PayeesSheet
          draft={draft}
          me={account}
          update={update}
          decimals={decimals}
          maxPayees={terms?.maxPayees ?? null}
          onShare={share}
          shareNote={shareNote}
          onClose={() => setSheet(null)}
        />
      )}
      {sheet === "closes" && (
        <Sheet title={copy.closes} onClose={() => setSheet(null)}>
          <p className="lede">{copy.closesLede}</p>
          <label className="field">
            <span>{copy.closes}</span>
            <input type="date" value={draft.closes} min={tomorrow()} onChange={(e) => update((d) => ({ ...d, closes: e.target.value }))} />
          </label>
          <p className="hint">{copy.timeZoneLine(draft.me.timeZone)}</p>
          <button type="button" className="btn primary" onClick={() => setSheet(null)}>
            {copy.done}
          </button>
        </Sheet>
      )}
      {sheet === "leftover" && (
        <Sheet title={copy.leftover} onClose={() => setSheet(null)}>
          <p className="lede">{copy.leftoverLede}</p>
          <button type="button" className="btn primary" onClick={() => setSheet(null)}>
            {copy.done}
          </button>
        </Sheet>
      )}
      {sheet === "confirm" && (
        <Sheet title={copy.checkBeforeYouMakeIt} onClose={() => setSheet(null)}>
          <p className="lede">{copy.noneCanChange}</p>
          <div className="list">
            {people.map((p, i) => (
              <div className="list-row" key={p.account}>
                <div className="grow">
                  <span className="name">{i === 0 ? `${p.name} (${copy.you})` : p.name}</span>
                  <span className="meta">{`${copy.decidesLine}, ${ending(p.account)}`}</span>
                </div>
              </div>
            ))}
            {draft.payees.map((p) => (
              <div className="list-row" key={p.slot}>
                <div className="grow">
                  <span className="name">{p.name}</span>
                  <span className="meta">{`${copy.paysLine(amount(p.cap))}, ${p.account ? ending(p.account) : ""}`}</span>
                </div>
              </div>
            ))}
          </div>
          <p className="hint">{copy.ruleLine(draft.threshold, people.length)}</p>
          <p className="hint">{copy.closesOn(formatDay(draft.closes))}</p>
          <button type="button" className="pill-btn" onClick={() => make(false)}>
            {copy.makeThePot}
          </button>
          <button type="button" className="btn ghost" onClick={() => setSheet(null)}>
            {copy.back}
          </button>
        </Sheet>
      )}
    </div>
  );
}

function Bar(props: { title: string; onBack: () => void }) {
  return (
    <div className="bar">
      <button type="button" className="icon-btn" aria-label={copy.back} onClick={props.onBack}>
        <Icon name="back" size={22} />
      </button>
      <div className="bar-title">{props.title}</div>
      <div className="bar-spacer" />
    </div>
  );
}

function RuleRow(props: {
  icon: "people" | "drop" | "calendar" | "undo";
  k: string;
  v: string;
  unset?: boolean;
  side: ReactNode;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button type="button" className="row-btn" disabled={props.disabled} onClick={props.onClick}>
      <span className="row-icon">
        <Icon name={props.icon} size={17} />
      </span>
      <span className="row-text">
        <span className="k">{props.k}</span>
        <span className={`v${props.unset ? " unset" : ""}`}>{props.v}</span>
      </span>
      {props.side}
    </button>
  );
}

function tomorrow(): string {
  const d = new Date(Date.now() + 86_400_000);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function NameSheet(props: { draft: Draft; onSave: (name: string) => void; onClose: () => void }) {
  const [name, setName] = useState(props.draft.name);
  const ok = fitsText32(name);
  const tooLong = name.trim().length > 0 && !ok;
  const save = () => {
    if (!ok) return;
    props.onSave(name.trim());
    props.onClose();
  };
  return (
    <Sheet title={copy.potName} onClose={props.onClose}>
      <label className="field">
        <span>{copy.potName}</span>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder={copy.potNamePlaceholder} autoFocus enterKeyHint="done"
          onKeyDown={(e) => e.key === "Enter" && save()} />
      </label>
      <p className={tooLong ? "error" : "hint"}>{tooLong ? copy.potNameTooLong : copy.potNameHint}</p>
      <button type="button" className="btn primary" disabled={!ok} onClick={save}>
        {copy.done}
      </button>
    </Sheet>
  );
}

function DecidersSheet(props: {
  draft: Draft;
  me: StoredAccount;
  update: (change: (d: Draft) => Draft) => void;
  onReply: (reply: Reply) => Promise<string>;
  onShare: (url: string, text: string) => Promise<void>;
  shareNote: string | null;
  maxDeciders: number | null;
  onClose: () => void;
}) {
  const { draft, update } = props;
  const [replyText, setReplyText] = useState("");
  const [replyNote, setReplyNote] = useState<Notice | null>(null);
  const total = draft.deciders.length + 1;
  const full = props.maxDeciders !== null && total >= props.maxDeciders;

  const invite = () =>
    props.onShare(
      linkUrl(location.origin, {
        kind: "invite",
        draftId: draft.id,
        role: ROLE.decider,
        slot: NO_SLOT,
        from: props.me.name,
        potName: draft.name || copy.unnamedPot,
        payeeName: "",
      }),
      copy.joinAsDecider(props.me.name, draft.name || copy.unnamedPot),
    );

  const addReply = async () => {
    setReplyNote(null);
    try {
      const link = decodeLink(replyText.trim().split("#").pop() ?? "");
      if (link.kind !== "reply") throw new Error("link is damaged");
      const text = await props.onReply(link);
      setReplyText("");
      setReplyNote({ tone: "ok", text });
    } catch (e) {
      setReplyNote(
        e instanceof Error && e.message === "link is damaged"
          ? { tone: "bad", text: copy.errLinkDamaged, code: ERROR_CODES.LINK_DAMAGED }
          : { tone: "bad", ...describeFailure(e) },
      );
    }
  };

  return (
    <Sheet title={copy.whoDecides} onClose={props.onClose}>
      <p className="lede">{copy.decidersLede}</p>
      <div className="list">
        <div className="list-row stacked">
          <span className="name">{`${props.me.name} (${copy.you})`}</span>
          <label className="field">
            <span>{copy.yourCity}</span>
            <input
              value={draft.me.city}
              maxLength={40}
              placeholder={copy.cityPlaceholder}
              autoComplete="off"
              onChange={(e) => update((d) => ({ ...d, me: { city: e.target.value, timeZone: phoneTimeZone() } }))}
            />
          </label>
          <span className="hint">{copy.timeZoneLine(draft.me.timeZone)}</span>
        </div>
        {draft.deciders.map((p) => (
          <div className="list-row" key={p.account}>
            <div className="grow">
              <span className="name">{p.name}</span>
              <span className="meta">{`${p.city}, ${ending(p.account)}`}</span>
            </div>
            <button type="button" className="btn ghost small" onClick={() => update((d) => withoutDecider(d, p.account))}>
              {copy.remove}
            </button>
          </div>
        ))}
      </div>
      <button type="button" className="btn" disabled={full} onClick={invite}>
        {copy.inviteToDecide}
      </button>
      {props.shareNote && <p className="hint">{props.shareNote}</p>}
      <label className="field">
        <span>{copy.replyLinkField}</span>
        <input value={replyText} onChange={(e) => setReplyText(e.target.value)} inputMode="url" autoComplete="off" />
      </label>
      {replyText.trim() && (
        <button type="button" className="btn" onClick={addReply}>
          {copy.addReply}
        </button>
      )}
      {replyNote && <NoticeLine notice={replyNote} />}
      <span className="field">
        <span>{copy.howManyMustSayYes}</span>
      </span>
      <div className="stepper">
        <button type="button" className="round-btn" aria-label={copy.fewer} disabled={draft.threshold <= 1}
          onClick={() => update((d) => ({ ...d, threshold: d.threshold - 1 }))}>
          {"−"}
        </button>
        <span className="count">{copy.ofN(draft.threshold, total)}</span>
        <button type="button" className="round-btn" aria-label={copy.more} disabled={draft.threshold >= total}
          onClick={() => update((d) => ({ ...d, threshold: d.threshold + 1 }))}>
          +
        </button>
      </div>
      <p className="hint">{copy.ruleLine(draft.threshold, total)}</p>
      <button type="button" className="btn primary" onClick={props.onClose}>
        {copy.done}
      </button>
    </Sheet>
  );
}

function PayeesSheet(props: {
  draft: Draft;
  me: StoredAccount;
  update: (change: (d: Draft) => Draft) => void;
  decimals: number | null;
  maxPayees: number | null;
  onShare: (url: string, text: string) => Promise<void>;
  shareNote: string | null;
  onClose: () => void;
}) {
  const { draft, update, decimals } = props;
  const [name, setName] = useState("");
  const [limit, setLimit] = useState("");
  const [pasting, setPasting] = useState<Hex | null>(null);
  const [idText, setIdText] = useState("");
  const [last4, setLast4] = useState("");
  const cap = decimals === null ? null : parseAmount(limit, decimals);
  const nameOk = fitsText32(name);
  const capOk = cap !== null && cap > 0n;
  const full = props.maxPayees !== null && draft.payees.length >= props.maxPayees;
  const pasted = parseAccountId(idText);

  const add = () => {
    if (!nameOk || !capOk || cap === null) return;
    update((d) => ({ ...d, payees: [...d.payees, { slot: newSlot((n) => crypto.getRandomValues(new Uint8Array(n))), name: name.trim(), cap: cap.toString() }] }));
    setName("");
    setLimit("");
  };

  const invite = (slot: Hex, payeeName: string) =>
    props.onShare(
      linkUrl(location.origin, {
        kind: "invite",
        draftId: draft.id,
        role: ROLE.payee,
        slot,
        from: props.me.name,
        potName: draft.name || copy.unnamedPot,
        payeeName,
      }),
      copy.joinAsPayee(props.me.name, draft.name || copy.unnamedPot, payeeName),
    );

  const usePasted = () => {
    if (!pasting || !pasted || !confirmsAccount(pasted, last4)) return;
    update((d) => withPayeeAccount(d, pasting, pasted, "pasted"));
    setPasting(null);
    setIdText("");
    setLast4("");
  };

  return (
    <Sheet title={copy.poursOnlyTo} onClose={props.onClose}>
      <p className="lede">{copy.payeesLede}</p>
      <div className="list">
        {draft.payees.map((p) => (
          <div className="list-row stacked" key={p.slot}>
            <div className="list-row">
              <div className="grow">
                <span className="name">{p.name}</span>
                <span className="meta">{p.account ? ending(p.account) : copy.waitingForReply}</span>
              </div>
              <span className="side">{decimals === null ? "" : copy.upTo(formatAmount(BigInt(p.cap), decimals, "auto"))}</span>
            </div>
            {pasting === p.slot ? (
              <>
                <label className="field">
                  <span>{copy.theirAccountId}</span>
                  <input value={idText} onChange={(e) => setIdText(e.target.value)} autoComplete="off" autoCapitalize="off" spellCheck={false} />
                </label>
                {idText.trim() && !pasted && <p className="error">{copy.accountIdInvalid}</p>}
                {pasted && (
                  <>
                    <label className="field">
                      <span>{copy.typeLast4}</span>
                      <input value={last4} onChange={(e) => setLast4(e.target.value)} maxLength={4} autoComplete="off" autoCapitalize="off" spellCheck={false} />
                    </label>
                    <p className={last4.length === 4 && !confirmsAccount(pasted, last4) ? "error" : "hint"}>
                      {last4.length === 4 && !confirmsAccount(pasted, last4) ? copy.last4Wrong : copy.typeLast4Hint}
                    </p>
                    <button type="button" className="btn primary" disabled={!confirmsAccount(pasted, last4)} onClick={usePasted}>
                      {copy.useThisAccount}
                    </button>
                  </>
                )}
              </>
            ) : (
              !p.account && (
                <div className="field-row">
                  <button type="button" className="btn small" onClick={() => invite(p.slot, p.name)}>
                    {copy.sendThemALink}
                  </button>
                  <button type="button" className="btn small" onClick={() => { setPasting(p.slot); setIdText(""); setLast4(""); }}>
                    {copy.pasteTheirAccountId}
                  </button>
                </div>
              )
            )}
            <button type="button" className="btn ghost small" onClick={() => update((d) => ({ ...d, payees: d.payees.filter((x) => x.slot !== p.slot) }))}>
              {copy.remove}
            </button>
          </div>
        ))}
      </div>
      {props.shareNote && <p className="hint">{props.shareNote}</p>}
      {!full && (
        <>
          <p className="eyebrow">{copy.addPlaceToPay}</p>
          <div className="field-row">
            <label className="field">
              <span>{copy.payeeName}</span>
              <input value={name} onChange={(e) => setName(e.target.value)} placeholder={copy.payeeNamePlaceholder} />
            </label>
            <label className="field">
              <span>{copy.limit}</span>
              <input value={limit} onChange={(e) => setLimit(e.target.value)} inputMode="decimal" placeholder="$700" disabled={decimals === null} />
            </label>
          </div>
          {name.trim() && !nameOk && <p className="error">{copy.payeeNameTooLong}</p>}
          {limit.trim() && !capOk && <p className="error">{copy.limitInvalid}</p>}
          <button type="button" className="btn" disabled={!nameOk || !capOk} onClick={add}>
            {copy.add}
          </button>
        </>
      )}
      <button type="button" className="btn primary" onClick={props.onClose}>
        {copy.done}
      </button>
    </Sheet>
  );
}
