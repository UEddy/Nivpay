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
| 13 | Funding is paused: `FUNDING_ENABLED` is off, the funder is at its 1 MON floor, or 20 grants were already made in about the last hour (`funding is busy, try again later`). | `/api/fund/status`; the funder's recent transactions |
| 14 | The funder key is malformed or missing, or `FUNDER_ADDRESS` isn't set. | Vercel env vars; `keyMatches` in `/api/fund/status` |
| 15 | The funder key doesn't belong to `FUNDER_ADDRESS`. | Vercel env vars; `keyMatches` in `/api/fund/status` |
| 16 | The grant couldn't be sent (`SEND_FAILED`). | Vercel function log, `"event":"failed"` |
| 17 | The service couldn't read the chain before granting (`RPC_FAILED`). | Vercel function log, RPC status |
| 18 | The account has sent 30 or more transactions, the per-account limit (`MAX_SENT_TXS` in `app/api/fund/index.ts`), and holds too little to pay for this request. It gets no more gas grants. The screen says "This account has sent as many payments as NivPay covers, so it can't send more. It can still be paid. To send, make another account. Nothing was sent." Nothing was signed: the grant is asked for before the passkey. | Expected abuse limit. The account can still receive |
| 19 | The service refused for another reason: not a personal account, wrong chain, wrong origin, not found, a request over 1 KB, or this address was granted in the last 2 minutes on that server instance. | Vercel function log, `"event":"refused"` |
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
| 24 | More than the payee can still be paid: `spent + amount > cap` (`CapExceeded`). The fee doesn't count against the limit. On a NivPayPotsV2 pot, also a payee a change took off the pot (`PayeeRemoved`): it is paid nothing more. | `getDestinations(potId)`; on V2, `isRemoved(potId, index)` |
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

## Changing a pot (NivPayPotsV2)

Only pots made on NivPayPotsV2 can change, and nothing here shows while
`POTS_V2` in `app/src/lib/config.ts` is null. Proposing, saying yes to,
withdrawing and making a change are each run as a call before anything is
signed, so these send nothing. A change from someone who doesn't decide shows
22, and one on a closed pot 95, as for payments and closing.

| Code | What happened | Where to look |
| --- | --- | --- |
| 79 | The contract refused the change, and the message says which way: 5 changes are already open on the pot (`TooManyOpenChanges`); the change is no longer waiting for a yes, because it was agreed, withdrawn or not agreed within 7 days (`ChangeNotPending`, `ChangeNotOpen`, `ProposalExpired`); the pot is paused, so a change that adds to spending waits (`PotFrozen`); a limit would go below what that payee was already paid (`LimitBelowSpent`); the pot changed since it was proposed and the change no longer raises or lowers what it meant to (`NotWider`, `NotNarrower`); or anything else. | `changeInfo(changeId)`, `openChanges(potId)`, `getPot(potId).frozen`, `getDestination(potId, index)` |
| 89 | A change that adds to spending can't be made yet: its 72 hours after the yes that agreed it aren't up, or the 7 days after them, when anyone could make it, have passed and it has lapsed (`ChangeNotReady`). Exits were open all the while. | `changeInfo(changeId).appliesAt` and `.lapsesAt` against the finalized block's time |

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
| 51 | Not in any block after 45 seconds of the network answering, and its nonce is still unused at finalized. Time offline doesn't count: a request signed or sent while offline is sent again, the same bytes, when the phone is back. Nothing moved; it can be retried on the same nonce. | The pending write; Get help, Recent sends from this phone (taken each time means the node accepted it and it was dropped) |
| 52 | Included and finalized, but reverted. Nothing moved. | The transaction receipt |
| 53 | Its nonce was used by a different transaction. Nothing of this request moved. | The account's transactions |
| 54 | A retry was refused because the earlier attempt may still go through. Wait. | The pending write |
| 55 | Try again was pressed but there was nothing stuck to retry. | |
| 56 | The node answered the broadcast and turned it down twice in a row (a JSON-RPC error other than a rate limit, an internal error, "already known" or "nonce too low"), and its nonce is still unused at finalized. Nothing moved; it can be retried on the same nonce. Shown when making a pot, paying from a pot, closing it, taking a share out, and claiming, changing or letting go of a username; elsewhere (adding test dollars, putting money in, sending) it shows as 51. | The pending write; the RPC's error for its raw bytes |

## Adding test dollars on the AUSD deployment (Agora's faucet)

60 and 61 are found before anything is sent: the app runs the claim as a call
first, so no gas grant or passkey prompt is spent on them.

| Code | What happened | Where to look |
| --- | --- | --- |
| 60 | Cooldown: someone claimed from the faucet less than 60 seconds ago. It is one cooldown for everyone, not per account. Nothing was sent. The phone counts down the seconds left and enables Try again when they reach 0; it never claims without a tap. | `lastDripTimestamp()` on the faucet |
| 61 | Ceiling: the account already holds 100,000 AUSD or more (`maxAmountToOwn()`). Nothing was sent. | The account's AUSD balance |
| 62 | The faucet refused for another reason before sending (out of stock, `0x356680b7`, or an unknown error), or the claim was included and reverted, usually because someone else claimed first. No AUSD moved. | The faucet's AUSD balance; the transaction receipt |

## Add money and Cash out (the test desk, `/api/ramp`)

A simulation in test mode: no bank is involved and no real currency moves.
Add money asks the desk to send test AUSD; Cash out is the person's own
transfer of AUSD to the desk, followed to Finalized like any send (a reverted
or replaced one shows 52 or 53), and then the desk's statement.

| Code | What happened | Where to look |
| --- | --- | --- |
| 63 | The phone couldn't reach `/api/ramp` at all. Nothing moved. | Connection, Vercel status |
| 64 | The desk is paused or busy: `RAMP_ENABLED` is off, `RAMP_DESK_ADDRESS` isn't set, wrong chain, 30 desk transactions in about the last hour, the desk under 0.2 MON for gas, or short of AUSD while Agora's faucet won't pay it yet (`the test desk is restocking`). Nothing moved. | `GET /api/ramp`; the desk's balances and recent transactions |
| 65 | The desk refused the request: not a personal account, an account already holding $1,000 or more, under $1 or over $100, a buy from this account in the last 2 minutes on that server instance, another request for this account still in flight, a wrong origin, a request over 1 KB, or an unknown currency. Nothing moved. | Vercel function log, `"event":"refused"` |
| 66 | The desk couldn't send the dollars (`SEND_FAILED`, `RPC_FAILED`, `DESK_KEY_MALFORMED`, `DESK_KEY_MISMATCH`), or it sent them and they reverted or weren't final within 60 seconds. | Vercel function log, `"event":"failed"`; the desk's transaction |
| 67 | The cash out was final, but the desk's statement couldn't be read (its read of the finalized transfer failed or lagged). Asking again is safe: it moves nothing and gives the same reference. | Vercel function log; the cash out transaction |

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
| 77 | One of those reads failed, so pots this account was added to may be missing for now. Pots already found stay listed, and the next read is 10 seconds later. | RPC reachability; Multicall3 at `0xcA11bde05977b3631167028862bE2a173976CA11` |

## The pot's story

| Code | What happened | Where to look |
| --- | --- | --- |
| 78 | Reading the pot's history for its story failed (`eth_getLogs` from the saved place, in 101 block pages). Entries already read stay; the next read is a second later and resumes from the same place. | RPC reachability; the pot's cursor in IndexedDB, `nivpay` store, key `<pots>:<potId>` |

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

## Daily limit

A limit on money leaving the account in any 24 hours, $1,000 unless the
person sets another in Account details (`app/src/lib/limits.ts`). It counts
Send, Send in another currency, chipping in and Cash out, from the moment
each is sent, on this phone only. It is checked before the confirm sheet and
again right before signing.

| Code | What happened | Where to look |
| --- | --- | --- |
| 44 | This payment would take the account past its daily limit, counting what this phone sent in the last 24 hours, final or in flight. The screen says how much is left today. Nothing was sent. | Account details, Daily limit; `nivpay.limit.v1.*` in the phone's localStorage |

## Profile photos

Photos are made on the phone (`app/src/lib/photo.ts`) and stored through
`/api/photo`, which checks a signature from the account's own passkey over
the photo's SHA-256 and the time. Nothing moves and nothing is written to the
chain. Hidden until a Vercel Blob store is connected.

| Code | What happened | Where to look |
| --- | --- | --- |
| 45 | The photo, or its removal, didn't reach `/api/photo`, or it refused it: photos not set up (503), wrong origin (403), a proof that didn't check out or was over 5 minutes old (401), not a JPEG (415), too large (413), or too many changes in a minute on that server instance (429). | The request's status in the browser; Vercel function log for `/api/photo` |
| 88 | The display name was saved on this phone but didn't reach `/api/name`, or it refused it: names not set up (503), wrong origin (403), a proof that didn't check out or was over 5 minutes old (401), a name that isn't clean (400), or too many changes in a minute on that server instance (429). Also when the fingerprint was cancelled. The phone keeps the name; Save again sends it. | The request's status in the browser; Vercel function log for `/api/name` |
| 46 | The picture chosen couldn't be read by the phone (`createImageBitmap`), or couldn't be made small enough. Nothing was sent. | The file's type; HEIC needs a phone that can decode it |

## Where people in a pot are

A city, opt in, shared with one pot: encrypted on the phone with a key from
the pot link's fragment, so `/api/city` holds only ciphertext it can't read.
Hidden until a Vercel Blob store is connected, and for a pot opened with no
link.

| Code | What happened | Where to look |
| --- | --- | --- |
| 47 | Sharing or removing a city didn't reach `/api/city`, or it refused it: not set up (503), wrong origin (403), a proof that didn't check out or was over 5 minutes old (401), more than a sealed city (413), or too many changes in a minute on that server instance (429). Nothing else changed. | The request's status in the browser; Vercel function log for `/api/city` |

## Requests to a person

Asking someone directly, from Receive, and turning requests from people on
or off, in Profile (README, "Requests to a person"). Requests are sealed on
the phone so only the person's own phones can read them; `/api/inbox` keeps
ciphertext only. Hidden until a Vercel Blob store is connected. Nothing here
moves money.

| Code | What happened | Where to look |
| --- | --- | --- |
| 48 | The request didn't reach `/api/inbox`, or it refused it: not set up (503), wrong origin (403), a proof that didn't check out or was over 5 minutes old (401), too large (413), or too many in a minute on that server instance (429). Nothing was sent. | The request's status in the browser; Vercel function log for `/api/inbox` |
| 49 | The person asked hasn't turned on requests from people on any phone, so there is nowhere to seal it to. Nothing was sent. Share the request link instead. | `GET /api/inbox?account=<theirs>&what=keys` returns no keys |
| 57 | Turning requests from people on or off didn't reach `/api/inbox`, or it refused it, for the reasons under 48. Nothing changed on this phone. | The request's status in the browser; Vercel function log for `/api/inbox` |

## Notifications on the phone

Turning notifications on or off for this phone, in Profile, Notifications
(README, "Notifications on the phone"). Hidden until the VAPID keys and a
Vercel Blob store are set. Nothing here moves money.

| Code | What happened | Where to look |
| --- | --- | --- |
| 58 | The phone's push subscription couldn't be made, or didn't reach `/api/push`, or it refused it: not set up (503), wrong origin (403), a proof that didn't check out or was over 5 minutes old (401), or too many changes in a minute on that server instance (429). Nothing changed. | The browser's push support; the request's status; Vercel function log for `/api/push` |
| 59 | The phone or browser said no to notifications for NivPay, now or earlier. Nothing was asked of the server. Allow notifications for the site in the browser's or phone's settings, then try again. | `Notification.permission` is `denied` |

## Voice commands

The microphone on Send and on a pot's screen (README, "Voice commands"). Voice
only fills in the screen; nothing is sent until the person confirms with a
fingerprint.

| Code | What happened | Where to look |
| --- | --- | --- |
| 68 | The amount voice filled in is over $200, the most one voice payment can be, or was changed to more than that before Review. Nothing was sent. Type the amount instead. | `VOICE_CAP` in `app/src/lib/voice.ts` |
| 69 | The phone's speech service heard nothing, or the microphone was refused for NivPay. Nothing was filled in. | The browser's microphone permission for the site |

## Usernames

Usernames live in NivPayNames, a registry separate from the pots (README,
"Usernames for accounts"). The app shows none of this until the registry's
address is set in `app/src/lib/config.ts`. Every check below is made at the
finalized block before anything is signed, so none of them sends anything or
spends a gas grant. A claim, change or let go that reverts anyway, because
someone else claimed the name in between, shows 52.

| Code | What happened | Where to look |
| --- | --- | --- |
| 37 | The username is held by another account (`NameTaken`). | `accountOf(name)` on NivPayNames |
| 38 | The username breaks a rule (3 to 20 characters, a to z, 0 to 9 and _, starting with a letter, no `__`, not ending in _) or is reserved (`NameNotAllowed`, `NameReserved`). The phone checks the same rules first, from `app/src/lib/usernames.ts`, tested against `test/vectors/usernames.json`. | `isWellFormed`, `isReserved` on NivPayNames |
| 39 | The username was let go by another account less than 90 days ago, and is held until the date shown (`NameHeld`). Only the account that let it go can take it before then. | `availableAt(name)`, `releasedBy(name)` |
| 40 | Send to was given a username no account holds. Nothing was sent. | `accountOf(name)` is the zero account |
| 43 | A username this phone has paid before now belongs to a different account than the one paid then. Checked when the name is looked up and again right before signing. Nothing was sent. The name was let go, held for 90 days, and claimed by someone else, so check with the person another way. | `accountOf(name)` now, and `nivpay.namepairs.v1.*` in the phone's localStorage |

## Reporting a pot

Report, on a row under "New pots that name you" on Home, sends the
deployment, the pot number and one of four fixed reasons to `/api/report`.
The service writes one log line and stores nothing. Nothing moves, and the
pot itself is untouched.

| Code | What happened | Where to look |
| --- | --- | --- |
| 87 | The report didn't reach `/api/report`, or it refused it: wrong origin, a body over 512 bytes, a reason or pot number it doesn't accept, or more than 30 reports in a minute on that server instance (`429`). The pot is not hidden, so the person can try again or choose Hide. | Vercel function log for `/api/report`; the request's status in the browser |

## Other

| Code | What happened | Where to look |
| --- | --- | --- |
| 98 | A screen failed to show: its code couldn't be loaded (often a new version replaced it while the app was open, or the connection dropped), or it hit an error while drawing. The app shows Something went wrong with Back to Home instead of a blank screen. Nothing moved. | Browser console on a USB debug session; the error is logged there |
| 99 | Anything not covered above. | Browser console on a USB debug session |
