import { copy } from "../copy.ts";

/**
 * Stopping an action before the passkey. X during "Getting ready…" aborts
 * the action's signal; the send flow checks it at every step and last of all
 * right before it asks for the passkey (sendCore.ts), so reads that answer
 * later can never bring up a passkey prompt or send anything.
 */
export class CancelledError extends Error {
  constructor() {
    super(copy.cancelledNothingSent);
    this.name = "CancelledError";
  }
}

export function throwIfCancelled(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw new CancelledError();
}

/** Steps where nothing has been signed yet, so X stops the action instead of leaving the screen. */
export function beforePasskey(step: string | null | undefined): boolean {
  return step === "preparing" || step === "getting-ready";
}

/**
 * One screen's action at a time. `start` gives the action its signal and a
 * step listener; once the action reaches the passkey ("confirm") it can no
 * longer be cancelled, so `cancel` only ever reports a stop that is true.
 */
export class Cancellable {
  private run: { controller: AbortController; committed: boolean } | null = null;

  start(): { signal: AbortSignal; track: <S extends string>(onStep: (step: S) => void) => (step: S) => void } {
    this.run?.controller.abort();
    const run = { controller: new AbortController(), committed: false };
    this.run = run;
    return {
      signal: run.controller.signal,
      track: (onStep) => (step) => {
        if (step === "confirm") run.committed = true;
        onStep(step);
      },
    };
  }

  /** Stops the running action if it has not reached the passkey. True when it did stop it. */
  cancel(): boolean {
    const run = this.run;
    if (!run || run.committed || run.controller.signal.aborted) return false;
    run.controller.abort();
    this.run = null;
    return true;
  }

  /** The screen is going away: nothing that hasn't reached the passkey may go on. */
  dispose(): void {
    this.run?.controller.abort();
    this.run = null;
  }
}
