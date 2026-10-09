import type { Address } from "viem";
import { copy, ERROR_CODES } from "../copy.ts";
import { withDecider, withoutInvited, withPayeeAccount, type Draft, type DraftStore } from "./draft.ts";
import { AppError } from "./errors.ts";
import { ROLE, verifyReply, type Reply } from "./invites.ts";

/**
 * Adds a signed reply to the draft it answers. Refused unless the draft is on
 * this phone and still open, the signature recovers to the account the reply
 * names, and, for a payee, the slot still exists.
 */
export async function acceptReply(store: DraftStore, pots: Address, reply: Reply): Promise<{ draft: Draft; text: string }> {
  const draft = store.get(reply.draftId);
  if (!draft) throw new AppError(copy.errReplyNotHere, ERROR_CODES.REPLY_NOT_HERE);
  if (draft.made || draft.sending) throw new AppError(copy.errReplyTooLate, ERROR_CODES.REPLY_TOO_LATE);
  if (!(await verifyReply(pots, reply))) throw new AppError(copy.errReplyUnverified, ERROR_CODES.REPLY_UNVERIFIED);

  if (reply.role === ROLE.decider) {
    // A reply to a named invite answers it. Older invites carry no slot.
    const next = withDecider(withoutInvited(draft, reply.slot), reply.person);
    store.put(next);
    return { draft: next, text: copy.replyAdded(reply.person.name) };
  }
  const payee = draft.payees.find((p) => p.slot === reply.slot);
  if (!payee) throw new AppError(copy.errReplyNotHere, ERROR_CODES.REPLY_NOT_HERE);
  const next = withPayeeAccount(draft, reply.slot, reply.person.account, "reply");
  store.put(next);
  return { draft: next, text: copy.payeeReplyAdded(reply.person.name, payee.name) };
}
