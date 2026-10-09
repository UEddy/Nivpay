import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { encodeFunctionData, type Address, type Hex } from "viem";
import { copy, ERROR_CODES } from "../copy.ts";
import { POTS_ABI } from "../lib/abi.ts";
import type { StoredAccount } from "../lib/accounts.ts";
import { liveWriteChain, waitForFinalized } from "../lib/chain.ts";
import { DEPLOYMENT, POTS } from "../lib/deployment.ts";
import { PotStore, type StoredPot } from "../lib/potstore.ts";
import {
  allDeciders,
  checkDraft,
  confirmsAccount,
  labelsFor,
  normalizeSending,
  withAttempt,
  deciderShare,
  newSlot,
  parseAccountId,
  potRecipients,
  signedShares,
  withDecider,
  withDeciderShare,
  withoutDecider,
  withPayeeAccount,
  withPayeeShare,
  withSentTo,
  type Draft,
  type DraftStore,
  type Recipient,
  type Missing,
} from "../lib/draft.ts";
import { describeFailure, SendFailure } from "../lib/errors.ts";
import { idbWriteStore } from "../lib/idb.ts";
import { decodeLink, linkUrl, NO_SLOT, ROLE, signLabels, type Reply } from "../lib/invites.ts";
import { formatAmount, parseAmount } from "../lib/money.ts";
import { checkCreate, CREATE_LABEL, potFragment, potMadeBy, readCreateTerms, type CreateTerms } from "../lib/pots.ts";
import { acceptReply } from "../lib/replies.ts";
import { withSigner } from "../lib/passkey.ts";
import { retryStuckWrite, sendWrite, type Step } from "../lib/send.ts";
import { fitsText32 } from "../lib/text32.ts";
import { rememberReceipt } from "../lib/receipts.ts";
import { followToFinality, type PendingWrite } from "../lib/writes.ts";
import { PotMap, type Coin, type MapPerson } from "./PotMap.tsx";
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

const potStore = new PotStore(localStorage);
const writeLabel = (draft: Draft) => `${CREATE_LABEL} ${draft.id}`;
const sharesOf = (stored: { account: Address; amount: string }[]) => stored.map((s) => ({ account: s.account, amount: BigInt(s.amount) }));
const ending = (account: string) => copy.accountEnding(account);

/** Make a pot (docs/design/Live-Create.dc.html). */
export function CreateScreen(props: {
  account: StoredAccount;
  draftId: Hex;
  drafts: DraftStore;
  banner: ReactNode;
  notice: Notice | null;
  onBack: () => void;
  onOpenPot: (pot: StoredPot) => void;
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
  // The map's motion when the pot is made (docs/MOTION.md, "Pot created",
  // about 1.8s): the lid drops and the lock pops, then an invite flies out to
  // each city, then each ring lights up. Only ever after the finalized receipt.
  const [phase, setPhase] = useState<"draft" | "locked" | "flying" | "landed">(() => (drafts.get(draftId)?.made ? "landed" : "draft"));
  useEffect(() => {
    if (!celebrate) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setPhase("landed");
      return;
    }
    const others = Math.max(0, (drafts.get(draftId)?.deciders.length ?? 0));
    setPhase("locked");
    const t1 = setTimeout(() => setPhase("flying"), 380);
    const t2 = setTimeout(() => setPhase("landed"), 380 + 900 + 140 * Math.max(0, others - 1));
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
    };
  }, [celebrate, drafts, draftId]);
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
      const stored = drafts.get(draftId)?.sending;
      if (!stored) return;
      const sending = normalizeSending(stored);
      const made = await potMadeBy(hash);
      const signature = labelsFor(sending, hash);
      const base = { potId: made.potId.toString(), block: made.block.toString() };
      // The names are signed over the transaction that landed. If this phone
      // has no signature for it, the creator signs them again before sharing.
      const record = signature
        ? { ...base, fragment: potFragment(made.potId, made.block, sending.people, sharesOf(sending.shares), signature) }
        : { ...base, fragment: "", unsigned: { createdIn: hash, people: sending.people, shares: sending.shares } };
      update((d) => ({ ...d, sending: undefined, made: record }));
      if (record.fragment) rememberPot(record.potId, record.block, record.fragment);
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
        if (outcome.kind === "final") {
          rememberReceipt(write.address, write.hash);
          await finish(write.hash);
        }
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
    const sending = normalizeSending(d.sending);
    void (async () => {
      const w = await idbWriteStore.get(account.address).catch(() => undefined);
      if (w && w.label === writeLabel(d)) {
        // Follow whichever attempt is on record, even one whose retry was
        // signed but never sent: finish() finds the names for its hash.
        if (w.replaceable) {
          setStuck(true);
          setResult({ tone: "bad", text: copy.earlierStuck, code: ERROR_CODES.STUCK });
        } else {
          await land(w);
        }
        return;
      }
      // Its record is gone, so it already ended one way or another. At most
      // one attempt can be in a block, since they share a nonce.
      setStep("landing");
      try {
        let landed: { hash: Hex } | null = null;
        for (const a of sending.attempts) {
          if (await liveWriteChain.getReceipt(a.hash)) landed = a;
        }
        if (!landed) {
          failed({ tone: "bad", text: copy.createDidNotGoThrough, code: ERROR_CODES.SUPERSEDED });
          return;
        }
        const status = await waitForFinalized(landed.hash);
        if (status === "success") await finish(landed.hash);
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
  const recipients = made && !made.unsigned ? potRecipients(draft) : [];

  const make = async (retry: boolean) => {
    if (!terms) return;
    const { args } = checkDraft(draft, terms, nowSeconds(), POTS);
    if (!args) return;
    setSheet(null);
    setResult(null);
    setShareNote(null);
    const signedPeople = allDeciders(draft, account.name);
    const shares = signedShares(draft);
    const call = {
      from: account.address,
      to: POTS,
      data: encodeFunctionData({ abi: POTS_ABI, functionName: "createPot", args }),
      label: writeLabel(draft),
      onStep: setStep,
      // The pot's labels are signed with the pot, in the same passkey step.
      cosign: async (signer: Parameters<typeof signLabels>[0], hash: Hex) => {
        const labelsSignature = await signLabels(signer, POTS, hash, signedPeople, shares);
        const asText = shares.map((s) => ({ account: s.account, amount: s.amount.toString() }));
        // Saved before anything is broadcast, next to any earlier attempt's.
        update((d) => ({ ...d, sending: withAttempt(d.sending, signedPeople, asText, { hash, labelsSignature }) }));
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

  /** Sends one person their pot link through the share sheet, and remembers it once it has left this phone. */
  const sendTo = async (person: Recipient) => {
    setShareNote(null);
    const how = await shareLink(potUrl, copy.potLinkFor(person.name, draft.name));
    if (how === "shared" || how === "copied") update((d) => withSentTo(d, person.account));
    if (how === "copied") setShareNote(copy.linkCopiedFor(person.name));
    if (how === "failed") setShareNote(copy.copyFailed);
  };

  const addReply = async (reply: Reply) => {
    const accepted = await acceptReply(drafts, POTS, reply);
    setDraft(accepted.draft);
    return accepted.text;
  };

  /** Signs the names again over the transaction that made the pot, when this phone had no signature for it. */
  const signNames = async () => {
    const unsigned = made?.unsigned;
    if (!made || !unsigned) return;
    setResult(null);
    setStep("confirm");
    try {
      const shares = sharesOf(unsigned.shares);
      const signature = await withSigner(account.address, (signer) => signLabels(signer, POTS, unsigned.createdIn, unsigned.people, shares));
      const fragment = potFragment(BigInt(made.potId), BigInt(made.block), unsigned.people, shares, signature);
      update((d) => ({ ...d, made: d.made && { potId: d.made.potId, block: d.made.block, fragment } }));
      rememberPot(made.potId, made.block, fragment);
    } catch (e) {
      setResult({ tone: "bad", ...describeFailure(e) });
    } finally {
      setStep(null);
    }
  };

  /** Lists the made pot on Home, and returns it for opening. */
  function rememberPot(potId: string, block: string, fragment: string): StoredPot {
    const pot = { deployment: DEPLOYMENT, potId, block, fragment, name: drafts.get(draftId)?.name ?? "", addedAt: Date.now() };
    potStore.put(pot);
    return pot;
  }

  const potUrl = made ? `${location.origin}/#${made.fragment}` : "";

  const live = phase !== "draft";
  const mapPeople: MapPerson[] = people.map((p, i) => {
    const you = i === 0;
    return {
      name: p.name,
      city: p.city || copy.yourCity,
      sub: you ? copy.personYou(p.name) : phase === "landed" ? copy.personDecides(p.name) : p.name,
      ring: you ? "solid" : phase === "landed" ? "dashed" : "pencil",
      ping: !you && phase === "landed" && celebrate,
      route: live ? "march" : "pencil",
    };
  });
  const coins: Coin[] =
    phase === "locked" || phase === "flying"
      ? people.slice(1).map((_, k) => ({ person: k + 1, to: "city", at: phase === "flying" ? "end" : "start", delayMs: 140 * k }))
      : [];
  const mapPayees = draft.payees.map((p) => ({ name: p.name, sub: copy.upTo(amount(p.cap)) }));
  const mapLabel = copy.map(
    andList(people.map((p) => `${p.name} in ${p.city || copy.yourCity}`)),
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
          payeeRoutes={live ? "dotted" : "pencil"}
          lid={live ? "shut" : "open"}
          lock={live}
          coins={coins}
          potText={decimals === null ? "$0" : formatAmount(0n, decimals, "auto")}
          badge={live ? "live" : "draft"}
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

        {recipients.length > 0 && (
          <section className="send-out enter" aria-labelledby="send-out-title">
            <h2 id="send-out-title">{copy.sendToEveryone}</h2>
            <p className="hint">{copy.sendToEveryoneHint}</p>
            {recipients.map((r) => (
              <div className="send-row" key={r.account}>
                <span className="grow">
                  <span className="name">{r.name}</span>
                  <span className="meta">{r.sent ? copy.sentTo : r.role === "decider" ? copy.sendRoleDecides : copy.sendRoleGetsPaid}</span>
                </span>
                <button
                  type="button"
                  className={`send-btn${r.sent ? " sent" : ""}`}
                  aria-label={r.sent ? copy.sendAgainTo(r.name) : copy.sendToPerson(r.name)}
                  onClick={() => sendTo(r)}
                >
                  <Icon name="share" />
                  {r.sent ? copy.sendAgain : copy.send}
                </button>
              </div>
            ))}
          </section>
        )}
      </div>

      <div className="screen-foot enter" style={{ animationDelay: "420ms" }}>
        <p className="sr-only" aria-live="polite">
          {announce}
        </p>
        {made?.unsigned ? (
          <>
            <p className="foot-line">{copy.namesNeedSigning}</p>
            {result && <NoticeLine notice={result} />}
            <button type="button" className={`pill-btn${step ? " busy" : ""}`} disabled={step !== null} onClick={signNames}>
              {step ? copy.stepConfirm : copy.signTheNames}
            </button>
          </>
        ) : made ? (
          <>
            {recipients.length === 0 && <p className="foot-line">{copy.potMadeAlone}</p>}
            {shareNote && <p className="foot-hint">{shareNote}</p>}
            <button type="button" className="pill-btn outline" onClick={() => share(potUrl, copy.shareText(draft.name))}>
              <Icon name="share" />
              {recipients.length ? copy.shareWithSomeoneElse : copy.shareInviteLink}
            </button>
            <button type="button" className="pill-btn" onClick={() => props.onOpenPot(rememberPot(made.potId, made.block, made.fragment))}>
              {copy.addYourShare}
            </button>
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
          decimals={decimals}
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
                  {deciderShare(draft, p.account) > 0n && <span className="meta">{copy.suggestsLine(amount(deciderShare(draft, p.account).toString()))}</span>}
                </div>
              </div>
            ))}
            {draft.payees.map((p) => (
              <div className="list-row" key={p.slot}>
                <div className="grow">
                  <span className="name">{p.name}</span>
                  <span className="meta">{`${copy.paysLine(amount(p.cap))}, ${p.account ? ending(p.account) : ""}`}</span>
                  {BigInt(p.share ?? "0") > 0n && <span className="meta">{copy.suggestsLine(amount(p.share!))}</span>}
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

/**
 * A suggested share. Typed as text, saved as base units only when it reads
 * as an amount; a blank field clears the suggestion.
 */
function ShareField(props: { decimals: number | null; value: bigint; optional?: boolean; onChange: (v: bigint) => void }) {
  const { decimals } = props;
  const [text, setText] = useState(() =>
    decimals !== null && props.value > 0n ? formatAmount(props.value, decimals, "auto").replace(/^\$/, "") : "",
  );
  const parsed = decimals === null ? null : text.trim() === "" ? 0n : parseAmount(text, decimals);
  return (
    <label className="field">
      <span>{props.optional ? copy.suggestedShareOptional : copy.suggestedShare}</span>
      <input
        value={text}
        inputMode="decimal"
        placeholder={copy.noSuggestion}
        disabled={decimals === null}
        onChange={(e) => {
          setText(e.target.value);
          const v = decimals === null ? null : e.target.value.trim() === "" ? 0n : parseAmount(e.target.value, decimals);
          if (v !== null) props.onChange(v);
        }}
      />
      {parsed === null && <span className="error">{copy.limitInvalid}</span>}
    </label>
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
  decimals: number | null;
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
          <ShareField decimals={props.decimals} value={deciderShare(draft, draft.owner)}
            onChange={(v) => update((d) => withDeciderShare(d, d.owner, v))} />
        </div>
        {draft.deciders.map((p) => (
          <div className="list-row stacked" key={p.account}>
            <div className="list-row">
              <div className="grow">
                <span className="name">{p.name}</span>
                <span className="meta">{`${p.city}, ${ending(p.account)}`}</span>
              </div>
              <button type="button" className="btn ghost small" onClick={() => update((d) => withoutDecider(d, p.account))}>
                {copy.remove}
              </button>
            </div>
            <ShareField decimals={props.decimals} value={deciderShare(draft, p.account)}
              onChange={(v) => update((d) => withDeciderShare(d, p.account, v))} />
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
            <ShareField decimals={decimals} value={BigInt(p.share ?? "0")} optional
              onChange={(v) => update((d) => withPayeeShare(d, p.slot, v))} />
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
