import { copy } from "../copy.ts";
import { replyProgress, type Draft } from "./draft.ts";

/**
 * What the make a pot screen shows at each stage, worked out in one place so
 * every stage can be tested without a phone.
 *
 * The rule: until the transaction that makes the pot is final and the pot's
 * number has been read back from it, the screen is a draft. It says "Draft,
 * not made yet", the pot's lid is open, there is no lock, and nothing says
 * made. A draft's only primary action is Make the pot, and only once nothing
 * is missing and everyone has replied. A refused, dropped or reverted attempt
 * leaves the draft as it was.
 */

/** The motion when the pot is made (docs/MOTION.md, "Pot created"). It only starts after the pot is final. */
export type Phase = "draft" | "locked" | "flying" | "landed";

export type CreateStage =
  /** Something is missing, or someone hasn't replied. */
  | "collecting"
  /** Nothing missing and everyone has replied. Make the pot. */
  | "ready"
  /** Checking, getting the account ready, or waiting for the fingerprint. Nothing has been sent. */
  | "preparing"
  /** Sent, and waiting until it is final. Not made yet. */
  | "waiting"
  /** Sent, but checking on it failed. It may still go through. */
  | "unconfirmed"
  /** Dropped or turned down, on a nonce that is still free. The same draft can be tried again. */
  | "stuck"
  /** Made and final, but this phone has no signed names for it yet. */
  | "made-unsigned"
  | "made";

/** The send flow's steps (send.ts), and following the request until it is final. */
export type CreateStep = "preparing" | "getting-ready" | "confirm" | "sending" | "landing";

export type CreateInput = {
  draft: Draft;
  step: CreateStep | null;
  stuck: boolean;
  unconfirmed: boolean;
  /** checkDraft gave the call's arguments: nothing is missing and everyone has replied. */
  ready: boolean;
  phase: Phase;
};

export type PrimaryAction = "make" | "try-again" | "check-again" | "sign-names" | "add-share";

export type CreateView = {
  stage: CreateStage;
  /** Made and final. Only then may anything say made, locked or live. */
  made: boolean;
  /** The name and the rules can still be changed. */
  editable: boolean;
  /** "Draft, not made yet" on every stage before the pot is made. */
  status: string | null;
  /** Who has replied and who hasn't, while the draft is still being put together. */
  progress: string | null;
  /** What is happening now, under the button. */
  line: string | null;
  lid: "open" | "shut";
  lock: boolean;
  badge: "draft" | "live";
  primary: { action: PrimaryAction; label: string; enabled: boolean; busy: boolean };
};

const STEP_LABEL: Record<CreateStep, string> = {
  preparing: copy.stepPreparing,
  "getting-ready": copy.stepGettingReady,
  confirm: copy.stepConfirm,
  sending: copy.createSending,
  landing: copy.createConfirming,
};

const listFormat = new Intl.ListFormat("en-GB", { style: "long", type: "conjunction" });

/** The progress line: who has replied and who the draft is still waiting for. */
export function progressLine(draft: Draft): string {
  const { replied, waiting } = replyProgress(draft);
  if (replied.length === 0 && waiting.length === 0) return copy.progressNobody;
  if (waiting.length === 0) return copy.progressAllReplied(listFormat.format(replied));
  if (replied.length === 0) return copy.progressWaiting(listFormat.format(waiting));
  return copy.progressSome(listFormat.format(replied), listFormat.format(waiting));
}

export function createView(input: CreateInput): CreateView {
  const { draft, step } = input;
  // The pot's number is only ever written to the draft from the finalized
  // transaction's PotCreated event.
  const made = Boolean(draft.made?.potId);

  if (made) {
    const live = input.phase !== "draft";
    const unsigned = Boolean(draft.made?.unsigned);
    return {
      stage: unsigned ? "made-unsigned" : "made",
      made: true,
      editable: false,
      status: null,
      progress: null,
      line: null,
      lid: live ? "shut" : "open",
      lock: live,
      badge: live ? "live" : "draft",
      primary: unsigned
        ? { action: "sign-names", label: step ? copy.stepConfirm : copy.signTheNames, enabled: step === null, busy: step !== null }
        : { action: "add-share", label: copy.addYourShare, enabled: true, busy: false },
    };
  }

  const draftView = { made: false, status: copy.draftNotMade, lid: "open", lock: false, badge: "draft" } as const;
  const busy = (stage: "preparing" | "waiting", label: string, line: string | null): CreateView => ({
    ...draftView,
    stage,
    editable: false,
    progress: null,
    line,
    primary: { action: "make", label, enabled: false, busy: true },
  });

  if (step === "sending" || step === "landing") return busy("waiting", STEP_LABEL[step], copy.createWaiting);
  if (step) return busy("preparing", STEP_LABEL[step], null);
  if (input.unconfirmed) {
    return { ...draftView, stage: "unconfirmed", editable: false, progress: null, line: null, primary: { action: "check-again", label: copy.checkAgain, enabled: true, busy: false } };
  }
  if (input.stuck) {
    return { ...draftView, stage: "stuck", editable: false, progress: null, line: null, primary: { action: "try-again", label: copy.tryAgain, enabled: true, busy: false } };
  }
  // Signed and on its way, but not being followed yet: opening the draft picks it up.
  if (draft.sending) return busy("waiting", copy.createConfirming, copy.createWaiting);

  return {
    ...draftView,
    stage: input.ready ? "ready" : "collecting",
    editable: true,
    progress: progressLine(draft),
    line: input.ready ? copy.createReady : null,
    primary: { action: "make", label: copy.makeThePot, enabled: input.ready, busy: false },
  };
}
