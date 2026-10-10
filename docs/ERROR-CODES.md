# NivPay error codes

The app shows people a short, neutral code under any failure, like "Code 16".
This table says what each one means. Read the code off the phone and look it
up here. Codes are stable: one is never reused for something else. The source
of truth is `ERROR_CODES` in `app/src/copy.ts`; keep the two in step.

"Nothing was sent" in the message means the person's own request was never
broadcast. A message that says the request was sent but isn't confirmed yet
means it was, and the app is still tracking it.

## Getting ready

| Code | What happened | Where to look |
| --- | --- | --- |
| 10 | Couldn't get the request ready: reading the account, estimating its cost or the fee failed. | RPC reachability from the phone |
| 11 | Another request from this account is still in flight. Wait for it. | The pending write in IndexedDB |

## Gas grant (the setup service, `/api/fund`)

| Code | What happened | Where to look |
| --- | --- | --- |
| 12 | The phone couldn't reach `/api/fund` at all. | Connection, Vercel status |
| 13 | Funding is paused: `FUNDING_ENABLED` is off, or the funder is at its 1 MON floor. | `/api/fund/status` |
| 14 | The funder key is malformed or missing, or `FUNDER_ADDRESS` isn't set. | Vercel env vars; `keyMatches` in `/api/fund/status` |
| 15 | The funder key doesn't belong to `FUNDER_ADDRESS`. | Vercel env vars; `keyMatches` in `/api/fund/status` |
| 16 | The grant couldn't be sent (`SEND_FAILED`). | Vercel function log, `"event":"failed"` |
| 17 | The service couldn't read the chain before granting (`RPC_FAILED`). | Vercel function log, RPC status |
| 18 | The account has sent 10 or more transactions, the per-account limit. | Expected abuse limit |
| 19 | The service refused for another reason: not a personal account, wrong chain, wrong origin, or not found. | Vercel function log, `"event":"refused"` |
| 20 | The grant was sent but wasn't final within 60 seconds. | Funder's recent transactions |
| 21 | The grant was included but reverted. | The grant transaction |
| 93 | The account holds more than the grant threshold (0.075 MON), so `/api/fund` won't top it up (`this account already has enough`), but less than this request needs. The threshold sits above the largest single action, the first payment in another currency (about 0.059 MON at 102 gwei), so this happens only if the network price rises above about 130 gwei. Nothing was sent. | The account's balance against the request's gas x max fee |

## Paying from a pot

A decider asks for a payment to one of the pot's payees; asking counts as
their own yes, and the yes that reaches the pot's rule pays in that same
request (`app/src/lib/payout.ts`). The contract checks the payee's limit and
what the pot holds only when it pays, so the phone checks both before anyone
asks or says yes, then runs the request as a call before anything is signed.
All of 22 to 29 are found that way: nothing was sent, and no gas grant or
passkey prompt was spent. A request, a yes or a take back that reverts or is
replaced shows 52 or 53; one the node turns down twice shows 56; one that
stalls shows 51 and can be retried on the same nonce.

| Code | What happened | Where to look |
| --- | --- | --- |
| 22 | This account doesn't decide on this pot (`NotApprover`). | `getApprovers(potId)` |
| 23 | No amount, or zero (`ZeroAmount`). | |
| 24 | More than the payee can still be paid: `spent + amount > cap` (`CapExceeded`). The fee doesn't count against the limit. | `getDestinations(potId)` |
| 25 | The pot can't cover the amount plus its fee (`InsufficientPotAssets`). | `getPot(potId).totalAssets`, `feeOn(amount)` |
| 26 | The pot is closed or paused (`PotClosed`, `PotFrozen`). | `getPot(potId).closed`, `.frozen` |
| 27 | The request is past its 7 days (`ProposalExpired`), judged at the finalized block's time. | `proposalInfo(id).expiresAt` |
| 28 | The request isn't waiting for that any more: paid, withdrawn, a yes already given, or no yes to take back (`ProposalNotPending`, `AlreadyApproved`, `NotApproved`). | `proposalInfo(id)`, `hasApproved(id, account)` |
| 29 | The contract refused the call for any other reason, such as the dollar refusing the transfer to the payee. | `eth_call` of the request from the account |

## Closing and taking your share out

Closing early is a request like a payment (`proposeClose`, then yeses), and
moves no money: a pause doesn't stop it. Taking your share out works in every
state the contract allows (`exit` before close, `claim` after). Each is run as
a call before anything is signed, so these send nothing.

| Code | What happened | Where to look |
| --- | --- | --- |
| 94 | Nothing to take out: this account holds no shares in the pot, or fewer than it asked to take (`ZeroShares`, `InsufficientShares`). | `funderInfo(potId, account)` |
| 95 | The pot is already closed (`PotClosed` on `proposeClose` or a closing yes), by request or because its closing date has passed. | `getPot(potId).closed`, `.endTime` |
| 96 | The pot isn't closed yet (`PotNotClosed`): what's left can be shared out only after close, and its close can be recorded only after its date. Taking your own share out works any time. | `getPot(potId).closed`, `.endTime` |
| 97 | The contract refused taking a share out for another reason, such as the dollar refusing the transfer to this account. | `eth_call` of `exit` or `claim` from the account |

## Passkey

| Code | What happened | Where to look |
| --- | --- | --- |
| 30 | The passkey prompt was cancelled or didn't finish (Mera `PASSKEY_OPERATION_FAILED`). | Usually the person dismissed it |
| 31 | The passkey provider has no PRF support (Mera `PRF_UNAVAILABLE`). Use Google Password Manager or iCloud Keychain. | Which password manager saved the passkey |
| 32 | The browser lacks a crypto primitive Mera needs (Mera `CRYPTO_UNAVAILABLE`). | Browser version |
| 33 | The passkey chosen belongs to a different account than the one in use. | Switch account |
| 34 | The signing session ended before signing (Mera `SESSION_ENDED`). | Try again |
| 35 | Another passkey failure. | Browser console on a USB debug session |
| 36 | Accounts aren't allowed on this hostname (only nivpay.vercel.app and localhost). | The URL being used |

## Sending and confirming

| Code | What happened | Where to look |
| --- | --- | --- |
| 41 | Signing the transaction failed after the passkey step. | Browser console |
| 42 | Saving the signed request to IndexedDB failed, so it was never broadcast. | Storage settings, private browsing |
| 50 | The request was broadcast, but following it to finality failed. The app resumes on reload. | The pending write's hash |
| 51 | Not in any block after 45 seconds, and its nonce is still unused at finalized. Nothing moved; it can be retried on the same nonce. | The pending write |
| 52 | Included and finalized, but reverted. Nothing moved. | The transaction receipt |
| 53 | Its nonce was used by a different transaction. Nothing of this request moved. | The account's transactions |
| 54 | A retry was refused because the earlier attempt may still go through. Wait. | The pending write |
| 55 | Try again was pressed but there was nothing stuck to retry. | |
| 56 | The node answered the broadcast and turned it down twice in a row (a JSON-RPC error other than a rate limit, an internal error, "already known" or "nonce too low"), and its nonce is still unused at finalized. Nothing moved; it can be retried on the same nonce. Shown when making a pot and when paying from a pot; elsewhere it shows as 51. | The pending write; the RPC's error for its raw bytes |

## Adding test dollars on the AUSD deployment (Agora's faucet)

60 and 61 are found before anything is sent: the app runs the claim as a call
first, so no gas grant or passkey prompt is spent on them.

| Code | What happened | Where to look |
| --- | --- | --- |
| 60 | Cooldown: someone claimed from the faucet less than 60 seconds ago. It is one cooldown for everyone, not per account. Nothing was sent. The phone counts down the seconds left and enables Try again when they reach 0; it never claims without a tap. | `lastDripTimestamp()` on the faucet |
| 61 | Ceiling: the account already holds 100,000 AUSD or more (`maxAmountToOwn()`). Nothing was sent. | The account's AUSD balance |
| 62 | The faucet refused for another reason before sending (out of stock, `0x356680b7`, or an unknown error), or the claim was included and reverted, usually because someone else claimed first. No AUSD moved. | The faucet's AUSD balance; the transaction receipt |

## Making a pot and joining one

Invite case B (`docs/APP-CONTRACT-MAP.md` section 9): the pot is a draft on
the creator's phone until every decider and payee has sent a signed reply.
70 to 72 and 74 happen on the phone and send nothing. 73 is found by running
`createPot` as a call before anything is signed, so it costs no gas grant
and no passkey prompt. A pot whose transaction reverts or is replaced shows
52 or 53 as above.

| Code | What happened | Where to look |
| --- | --- | --- |
| 70 | A link from a chat couldn't be read: cut short, edited, an unknown version, or text over the length limits. Also a payment request link naming a request that doesn't exist, or belongs to another pot. | The link as received; `proposalInfo(id).potId` |
| 71 | A reply link names a draft that isn't on this phone (opened on another phone, or the draft was deleted), or a payee slot that is no longer in the draft. | The creator's drafts in localStorage, `nivpay.drafts.v1` |
| 72 | A reply's signature doesn't recover to the account it names, for this chain and this pots contract. It was not added. | The reply link |
| 73 | `createPot` would revert with these arguments, usually `EndTimeInPast`. Nothing was sent. | The draft's closing date and time zone |
| 74 | A reply arrived for a pot that is already made or being made. Deciders and payees can't change after that. | The draft's `made` or `sending` field |

## Opening a pot and chipping in

A pour-in that reverts or is replaced shows 52 or 53, with "That didn't go
through. Nothing moved."

| Code | What happened | Where to look |
| --- | --- | --- |
| 75 | A pot link or payment request link made for the other deployment (AUSD or TESTUSD) was opened on this one. | The link's deployment byte and `VITE_NIVPAY_POTS` |
| 76 | No `PotCreated` for that pot id in the block the link names. The link is wrong or for another contract. | `eth_getLogs` at the link's block, topic 1 the pot id |

## Finding pots on Home

Home reads, from the chain, every pot this account decides on, can be paid
from, or has put money in (`app/src/lib/discover.ts`): `potCount`, then
`getApprovers`, `getDestinations`, `sharesOf` and `getPot` through Multicall3
at the finalized block. It runs when Home opens and every 10 seconds while it
stays open. Nothing is sent.

| Code | What happened | Where to look |
| --- | --- | --- |
| 78 | Reading the pot's history for its story failed (`eth_getLogs` from the saved place, in 101 block pages). Entries already read stay; the next read is a second later and resumes from the same place. | RPC reachability; the pot's cursor in IndexedDB, `nivpay` store, key `<pots>:<potId>` |
| 77 | One of those reads failed, so pots this account was added to may be missing for now. Pots already found stay listed, and the next read is 10 seconds later. | RPC reachability; Multicall3 at `0xcA11bde05977b3631167028862bE2a173976CA11` |

## Sending and receiving dollars

Send dollars moves the build's dollar (AUSD by default) from this account to
another with a plain `transfer`, signed with the passkey and shown as sent
only at Finalized. 80 to 84 are found before anything is signed, so they cost
no gas grant and no passkey prompt. A payment that reverts or is replaced
shows 52 or 53 with "That payment didn't go through. Nothing moved."; one
that stalls shows 51 and can be retried on the same nonce.

| Code | What happened | Where to look |
| --- | --- | --- |
| 80 | The recipient is this same account. Nothing was sent. | The Account ID or request link used |
| 81 | The recipient has code: a service such as a pots contract, not a person's account. Nothing was sent. | `eth_getCode` at the recipient |
| 82 | No amount, or zero, was entered. Nothing was sent. | |
| 83 | The amount is more than the account's balance at the finalized block. Nothing was sent. | `balanceOf` the account on the dollar |
| 84 | The dollar refused the transfer when it was run as a call, most likely Agora's freeze on the sender or the recipient. Nothing was sent. | `eth_call` of `transfer` from the sender |
| 85 | A request link made for the other deployment (AUSD or TESTUSD) was opened on this one. Nothing was sent. | The link's deployment byte and `VITE_NIVPAY_POTS` |
| 86 | Reading incoming payments for the Receive view failed. The balance is unaffected and the next read is a second later. | `eth_getLogs` on the dollar, topic 2 the account; RPC reachability |

## Sending in another currency (Agora's Instant Settlement)

On the AUSD deployment, Send dollars can deliver CTK, the currency on the
other side of Agora's settlement pair `0x1Aa8958Aa34cEC8096EF4381cb335effe977b0ae`.
The phone reads the pair's pause, price (now and at the deadline), fee and
reserves at one block and quotes from them (`app/src/lib/settle.ts`). 90 and
92 are found then; 91 is found by quoting again right before signing. None of
them sends anything. If the account can't cover the processing for all the
steps, that is 93 under Gas grant above.

The first time, three requests are signed with one fingerprint: the one-time
setup (`setApprovedSwapper` on Agora's whitelister), letting the pair take this
amount, and the exchange. Each is sent only once the one before it is final.
If one reverts, the ones after it are never sent: 52, and the steps already
final stay done (a finished setup is not repeated; an unused allowance is
used by the next attempt). If the exchange reverts because the pair's price
fell below the minimum after the quote, nothing moved but its gas: also 52.

| Code | What happened | Where to look |
| --- | --- | --- |
| 90 | The pair is paused (`isPaused()`), by Agora's pauser. Nothing was sent. | `isPaused()` on the pair |
| 91 | The quote taken right before signing differs from the one on the confirm sheet: amount out, minimum or fee. The sheet shows the new one. Nothing was sent. | `getPrice()`, `token0PurchaseFee()`, `getAmountsOut` on the pair |
| 92 | The pair holds less CTK than this payment would deliver (`reserve0()`). Nothing was sent. | `reserve0()` on the pair |

## Other

| Code | What happened | Where to look |
| --- | --- | --- |
| 99 | Anything not covered above. | Browser console on a USB debug session |
