# NivPay

**Nivpay is a pot is a group purse for one purpose that no single person can pocket.**

Money goes in from anyone. It can only come out to destinations fixed when the
pot was created, and only when enough of the named approvers agree. From its
closing time nothing more can go in or be paid out, and whatever is left
belongs to the people with money in it, by their share; each takes their own
whenever they like. Nothing is sent to anyone automatically.

Built for the Monad Metropolis hackathon, Consumer Products & Payments
track. The repository has two parts:

* **The contracts.** [`src/NivPayPots.sol`](./src/NivPayPots.sol) is the whole
  pot product, deployed and verified on Monad testnet.
* **The app.** [`app/`](./app) is a mobile first web app (a PWA) with passkey
  accounts, live at [nivpay.vercel.app](https://nivpay.vercel.app). Besides
  pots, it sends dollars to another person, receives them, and can deliver a
  payment in another currency through Agora's Instant Settlement. It reads
  like a fintech app: people see dollars and names, never gas, keys or
  addresses.

Released under the MIT License, see [LICENSE](./LICENSE). The hackathon
checklist is in [docs/SUBMISSION.md](./docs/SUBMISSION.md), and the use of AI
coding tools is disclosed under [AI disclosure](#ai-disclosure).

## Changes since submission

The version judged is the tag
[`submission-2026-10-13`](https://github.com/UEddy/Nivpay/tree/submission-2026-10-13)
(commit `843cbbe`): the production deploy of 13 Oct 2026 at 18:59 UTC, live
when the entry was submitted, about 19:59 UTC, 8 hours before the 23:59 US
Eastern deadline. The judges confirmed building could go on. Everything below
came after it
([the full list of commits](https://github.com/UEddy/Nivpay/compare/submission-2026-10-13...master)):

* **Safety around pots and payments.** A Who controls this pot card before
  putting money in; pots from people you may not know held in a New pots list
  with Keep, Hide and Report; contacts, with warnings on a first payment to
  someone; a daily limit on money leaving the account ($1,000 by default,
  raised only after 24 hours).
* **Usernames.** NivPayNames, a new contract: choose an @username, send to
  one, and see it beside names, with a check of the last 4 characters on a
  first payment.
* **Pots that can change.** NivPayPotsV2, a new contract next to the
  untouched NivPayPots: deciders can add a payee, change a limit, remove a
  payee or close later, and changes that widen spending wait 72 hours so
  anyone who disagrees can take their part out first.
* **Where your money went.** On a pot's screen, each person's money in, their
  part of each payment and of the fees, and what is left.
* **The pot map.** Each person at their city on a world map, opt in and city
  only, moved and zoomed by hand.
* **Profile and the app around it.** A tab bar, Profile laid out like a
  phone's settings, a display name, profile photos, Devices and sessions, Log
  out, Help and support, an install banner, dark mode that follows the phone,
  and History on Home.
* **Languages.** French, Spanish and Portuguese, written by AI and awaiting
  native review, with amounts and dates the reader's way.
* **Notifications.** A bell in the app, and pushes on the phone, opt in per
  phone; asking someone for money directly, sealed so only their phones read
  it.
* **Voice.** Voice commands on Send and on a pot, paying only contacts
  trusted for voice after 10 payments together, at most $200; "Hey NivPay",
  heard on the phone while the app is open, shown by the Pots logo glowing;
  and hands free: the payment read back aloud, a spoken yes, then the
  fingerprint, which is still needed every time.
* **Auto cash out**, in test mode like Add money and Cash out: dollars that
  arrive go to the bank by the test desk, a simulation in which no bank is
  paid.

## The problem, and who it is for

Every group that collects money for one thing has the same two fears. The
person holding the money might spend it on something else, and the person
holding the money might simply keep it. The usual answer is to trust somebody.
A pot removes the need to.

The intended user is a family or group of friends spread across countries,
paying for one shared thing together: a parent's birthday, a wedding, a
funeral, school fees. The same pot fits any shared cost with known payees: a
relative's hospital bill paid straight to the hospital, a group trip's hotel
and flights, a class reunion, an office leaving gift, a club's or association's
dues, a church, mosque or community building fund paid to its contractor, or
a hometown project such as a borehole. Today one relative collects everyone's transfers into
their own account and pays the vendors, and everyone else has to trust them.
The story the app is built and tested around is "Mama's 60th": three siblings
in London, Houston and Uyo pay for their mother's party, and the money can only
ever reach the caterer and the event hall.

A pot is created with a purpose, a list of approvers, a threshold, a list of
destinations each with its own spending cap, and an end time. **None of those
can ever be changed.** There is no owner, no admin, no pause and no upgrade
path. The contract cannot be talked into paying anyone who was not named at the
start.

## The rules

**Funding.** Anyone can fund an open pot. Funding is blocked after close, after
the end time, and while frozen.

**Payouts.** An approver proposes paying a listed destination a given amount.
Proposing counts as the proposer's own approval. When approvals reach the
threshold, the payout executes in that same transaction. It must go to a listed
destination and stay within that destination's remaining lifetime cap. If the
pot cannot cover the payout plus the fee at that moment, the approving
transaction reverts and the proposal stays pending until the pot is topped up.
Proposals expire after 7 days, approvers can revoke an approval before
execution, and the proposer can cancel.

**Exits.** Any funder can exit at any time with their pro rata share of what is
currently unspent. **Exits are never blocked by a freeze, a close, a pending
proposal, or an approver who has stopped cooperating.**

**Closing.** At the end time, or earlier by a threshold approved close
proposal. After close there is no funding and no payout, and funders claim
their share whenever they like. Claims are pulled, never pushed in a loop.

What the contract enforces about the closing time (`endTime`, fixed when the
pot is made and never changeable), read from `src/NivPayPots.sol`. "Closed"
is `_isClosed`: `closedFlag || block.timestamp >= endTime`.

| | Before the closing time | From the closing time on | Who |
| --- | --- | --- | --- |
| Put money in (`fund`, `fundWithPermit`) | yes, unless paused | refused, `PotClosed` | anyone |
| Ask for a payment (`proposePayout`) | yes, unless paused | refused, `PotClosed` | a decider |
| A yes that pays (`approve` reaching the rule) | pays, in that request | refused, `PotClosed`; nothing is paid | a decider |
| A yes short of the rule (`approve`) | recorded | still recorded, but it can never pay | a decider |
| Ask to close early (`proposeClose`), and the yes that closes | yes, even while paused | refused, `PotClosed` | deciders |
| Take your own share out (`exit`) | yes, in every state | yes, told as `Claimed` | whoever holds shares |
| Take your share of what is left (`claim`) | refused, `PotNotClosed` | yes, whenever you like, no deadline | whoever holds shares |
| Record the close as an event (`closePot`) | refused, `PotNotClosed` | once, by anyone; it changes nothing else | anyone |
| Take back a yes, withdraw a request, pause | yes | yes, though there is nothing left for them to change | deciders, the asker |
| Change the closing time | never | never | nobody |

**If nobody does anything on the date,** the pot is closed anyway, from the
first block whose timestamp reaches `endTime`: every view reports it closed
and every call above behaves as closed. Nothing is sent to anyone and no
event is emitted. The money stays in the contract, each person's share stays
theirs, and each takes it whenever they like, with no deadline and no sweep:
a share nobody claims stays in the contract for good. Payment requests still
open can never pay, and expire on their own 7 days after they were asked.

**What only the app does:**

* It turns the chosen day into the exact second: `endTime` is the end of
  that day in the maker's time zone (`endTimeFor` in `app/src/lib/draft.ts`).
  Someone in another time zone sees the same second in their own time, which
  may be a different date. The contract only ever sees the second.
* It refuses a closing time less than 10 minutes away. The contract only
  requires it to be in the future when the pot is made (`EndTimeInPast`).
* It reads "closed" at the finalized block's time, about a second behind the
  newest block, so for about a second either side of the closing time the
  app and the contract can disagree. The contract's answer is the one that
  counts.
* It never calls `closePot`, so a pot closed by its date has no `Closed`
  event: the story shows no row for it, and close and split says it closed
  on its date from `endTime` alone.

The app does not enforce the date. The contract does, on every call above,
and would do so with the app gone.

### Pots that can change (NivPayPotsV2)

`src/NivPayPotsV2.sol` sits next to `NivPayPots`, which is untouched and
keeps every pot already made on it. V2 does everything V1 does, the same
way: every NivPayPots suite runs against V2 too (`test/PotsOnV2.t.sol`).
What it adds is changes to a pot after it is made. Deployed on 19 Oct 2026
(addresses under [Contract addresses](#contract-addresses)), and set in
`app/src/lib/config.ts` as `POTS_V2`: the app makes new pots on V2, and every
pot made on NivPayPots before stays there and works as it always did.

| Change | Who proposes | Yeses | When it applies | While the pot is paused | Once the pot is closed |
| --- | --- | --- | --- | --- | --- |
| Add a payee, with a limit (`proposeAddPayee`) | a decider | the pot's rule, as for a payment | 72 hours after the yes that agrees it (`EXIT_WINDOW`), then by anyone, within 7 days (`APPLY_PERIOD`), or never | can be proposed and agreed, can't be applied | refused, `PotClosed` |
| Raise a payee's limit (`proposeRaiseLimit`) | a decider | the rule | the same 72 hours, then 7 days | the same | refused |
| Move the closing date later (`proposeLaterClose`) | a decider | the rule | the same 72 hours, then 7 days; if the pot closes first, never | the same | refused |
| Lower a payee's limit, never below what it was paid (`proposeLowerLimit`) | a decider | the rule | with the yes that agrees it | applies | refused |
| Remove a payee (`proposeRemovePayee`) | a decider | the rule | with the yes that agrees it | applies | refused |

* **72 hours and 7 days are set when the contract is deployed**, as
  `EXIT_WINDOW` and `APPLY_PERIOD` (each from 1 minute to 30 days). The real
  deployment's script fixes them at 72 hours and 7 days, reads them back, and
  `test/DeployPotsV2.t.sol` fails if either is ever anything else. Only the
  staging copy below is shorter.
* **Exits are never blocked**, during the wait or at any other time:
  `exit` and `claim` are V1's, unchanged.
* **Nothing is agreed that could never apply.** A change that adds to
  spending is refused when proposed, and again when agreed, if the pot closes
  before its wait ends (`ClosesBeforeItApplies`), and when agreed if it no
  longer fits the pot (a raise that no longer raises, no room for a payee).
  Funders are only ever told of a change that can happen.
* **A narrowing undoes nothing later.** Lowering a payee's limit ends every
  raise of that payee still open, agreed or not; removing a payee ends every
  change of that payee still open (`ChangeOverridden`). A raise agreed after
  the lowering is a fresh decision, and applies.
* **A change waiting to apply gives nothing.** A payment checks the payee
  and limit as they are when it pays: a payee not yet added has no index, a
  raise not yet applied leaves the old limit, and a payee removed meanwhile
  is refused (`PayeeRemoved`), even for a payment asked for before.
* **The wait runs from the yes that agrees it**, and no yes counts after
  that, so nobody can restart or shorten it. Before then the proposer's yes
  counts with the proposal, yeses can be taken back, and an unagreed change
  expires after 7 days, like a payment request.
* **The pot is checked again when a change applies**: a raise must still
  raise, a lowering must still lower and stay at or above what was paid,
  there must still be room for a new payee (10 in all, removed ones
  included), and a payee removed meanwhile takes no change.
* **At most 5 changes are open on a pot** at once (`MAX_OPEN_CHANGES`),
  agreed and waiting ones included, and at most 2 from any one decider
  (`MAX_OPEN_PER_PROPOSER`), so no one decider can take every place. One that expired or lapsed frees its
  place at the next proposal, or at once with `lapseChange`, which anyone
  may call.
* **The proposer can withdraw a change** until it applies, during the wait
  too (`withdrawChange`).
* **Never changeable on V2 either**: the deciders, the rule, the pot's name,
  a payee's address, and anything about another pot.
* **Events** for every step: `ChangeProposed`, `ChangeYes`,
  `ChangeYesRevoked`, `ChangeApproved` (with when it applies and lapses),
  `ChangeApplied`, `ChangeWithdrawn`, `ChangeLapsed` and `ChangeOverridden`.
* **What a determined minority can still do**, by design: any one decider can
  pause the pot, which stops changes that add to spending from applying (as
  V1 lets one decider stop payments); and three or more deciders together,
  short of the rule, can keep all 5 places filled with changes nobody agrees,
  each expiring after 7 days. Neither moves money or stops anyone leaving.

**What the app does with it.** On a V2 pot's screen the deciders get Propose
a change, and everyone sees the changes on their way with how many yeses
each has. When a change that widens spending is agreed, everyone who put
money in is told, in the bell and by push: "Change agreed: add DJ, up to
$300. Takes effect Mon 20 Oct, 09:00. If you disagree, take your part out
before then.", with Take my part out. (The words say "agreed", not
"approved": "approve" is on the list of words never shown.) The pot's story
lists every change, and Who controls this pot shows those on their way and
the payees removed. When making a pot, a limit gets a suggestion with some
room ("Caterer quoted $600? Set up to $660 in case prices move."), since a
raise later waits 72 hours, and a closed pot offers Copy this pot.

**What a share is.** Shares are minted at the value per share when money
goes in, and a payment lowers the value of every share alike. So a share of
what is left follows what each person put in only when everyone put in
before any payment and nobody took a share out early. Otherwise the
contract's split is still exact and fair (a later funder never pays for
spending before they joined), but it is not "by what each put in".

**Freezing.** Any single approver can freeze a pot. That halts payouts and new
funding and nothing else. Unfreezing needs a threshold approved proposal. A
freeze never touches exits or claims.

This is implemented exactly as specified and nothing about it was dropped.
`freeze()` requires only that the caller is an approver, with no threshold
and no proposal. `pot.frozen = false` appears **once** in the contract,
inside the `Unfreeze` branch of `_execute`, which is reachable only at the
threshold; there is no direct unfreeze function. The freeze is checked in
four places, all of them funding or payout: `_fund`, `proposePayout`,
`approve` for payout proposals, and `_executePayout`. `exit`, `claim` and
`_redeem` contain no freeze check at all.

**There is no withdraw to self path of any kind.** Money leaves a pot only as a
payout to a listed destination, or as a funder redeeming their own shares.

### Safety of funds beats liveness of payouts

The two failure modes are deliberately asymmetric.

If every approver loses their keys, no payout can ever happen again, and every
funder can still take their money out. If a single hostile approver freezes the
pot forever, payouts stop, and every funder can still take their money out.
Both are tested (`test_lostKeys_moneyIsStillReachable`,
`test_hostileApprover_cannotTrapFunds`).

## The reference scenario

`test/Mama60.t.sol` replays this end to end with every balance asserted to the
unit.

Idara, Ubong and Aniekan are throwing their mother a sixtieth birthday party.
They are the approvers, 2 of 3. The money can only ever reach the caterer or
the event hall, each with its own cap.

| Step | Detail | Pot after |
| --- | --- | --- |
| Idara funds | 500 AUSD | 500 |
| Ubong funds | 400 AUSD | 900 |
| Aniekan funds | 100 AUSD | 1000 |
| Aniekan proposes paying the caterer 600 | 1 of 2 approvals, nothing moves | 1000 |
| Ubong approves | threshold reached, caterer paid 600, fee 6 | 394 |
| Idara proposes paying the hall 270 | 1 of 2 approvals | 394 |
| Aniekan approves | hall paid 270, fee 2.7 | 121.3 |
| Pot reaches its end time and closes | | 121.3 |
| Each sibling claims | 60.65, 48.52, 12.13 | 0 |

878.7 of the 1000 leaves the pot and 121.3 remains. Everyone put in before
the first payment, so here the split follows each contribution, with no dust
left over. Each sibling has to claim; nothing is sent to them at close. The test asserts
`paid out + fees + claimed == funded` exactly.

The test deploys its own pots contract with a 1 percent fee, so its fees
are 6 and 2.7. The deployed instances charge 0.5 percent (`feeBps` 50), and
the recorded demo in `docs/DEMO.md` pays the hall $280 and closes early, so
there the fees are $3.00 and $1.40 and the three shares of the $115.60 left
are $57.80, $46.24 and $11.56.

## Why Monad

**Finality.** A payment app has to choose between telling people their money
moved before it is certain, or making them wait. On Monad testnet blocks come
about every 0.31 s and the `finalized` block trails the latest by about two
blocks, roughly 0.6 s (measured, see `docs/APP-CONTRACT-MAP.md` section 6).
So the app can afford to report success **only at Finalized**, the point after
which a block cannot be reverted, and still feel instant. Every receipt in the
app shows the time measured on the phone from sending to Finalized, for
example "Settled in 0.7s"; the figure is measured, never hardcoded.

**Fees.** Every action costs a small, predictable amount. At the 102 gwei
measured on testnet: making a pot is about 0.044 MON, putting money in with a
permit about 0.021 MON, a threshold approval that pays out about 0.022 MON.
That is cheap enough for the app to pay people's fees for them from a small
grant (see [Gas grants](#gas-grants-in-the-app-and-their-limits)), so nobody
needs to hold MON. Monad charges the gas limit rather than the gas used, so the
app estimates each transaction and does not pad the limit.

**It is the EVM.** The contracts are ordinary Solidity on OpenZeppelin, tested
with Foundry under `network = "monad"` so gas, opcode pricing and size limits
are Monad's. The app uses viem's `monadTestnet` chain. AUSD, Agora's dollar,
is live on Monad testnet with permit support, which lets a person put money in
with one signature.

## Monad integration

Everything the app does runs on Monad testnet (chain id `10143`) through the
public RPC `https://testnet-rpc.monad.xyz`, with viem's `monadTestnet`
chain:

* **Accounts** are Mera passkeys whose key signs ordinary Monad
  transactions on the phone (`app/src/lib/passkey.ts`, `keys.ts`).
* **Reads** are at the `finalized` block only: balances, pots, limits and
  requests through `eth_call` (Multicall3 for Home), history through
  `eth_getLogs` in 101 block pages, the most the public RPC allows.
* **Writes** are raw signed transactions sent with
  `eth_sendRawTransaction`, saved before sending and followed until their
  block is Finalized, about 0.6 s behind the newest block; only then does
  the app say they happened (`app/src/lib/writes.ts`).
* **Gas** is estimated per request and not padded, because Monad charges the
  gas limit; a small grant of testnet MON from `/api/fund` pays for it.
* **Money** is Agora's AUSD, put into pots with one EIP-2612 permit
  signature (`fundWithPermit`), and delivered in another currency through
  Agora's Instant Settlement pair.

Real transactions from the app, each read back with `eth_getTransactionReceipt`
(the first three on 10 Oct 2026, the two sends on 11 Oct 2026, the two
recorded sends and the Birthday pot's three on 13 Oct 2026): status success,
and in a block below the finalized head.
Pot 0's two were found from its events: `potCount()` bisected over past
blocks to find the block where pot 0 appears, its `PotCreated` log in that
block, then the first `Funded` log for pot 0 after it.

| What | Transaction | Block | Time (UTC) | What it shows |
| --- | --- | ---: | --- | --- |
| Add test dollars, a faucet claim | [`0xcf032c4555429aa1dacf086276a7d880fa587ed3bfbc5457137697ed9bd6fcdf`](https://testnet.monadvision.com/tx/0xcf032c4555429aa1dacf086276a7d880fa587ed3bfbc5457137697ed9bd6fcdf) | 69,524,729 | 9 Oct 2026, 11:13:07 | `requestFunds` on Agora's faucet from the app account `0x725C9cd75b2C8C29AEbf6a14eE84a3b54C787bC1`, for itself: 10,000 AUSD |
| CreatePot, pot 0 | [`0x6d1d6bdc5a942458c994e2735a684fb5b0665d77a692c3763c33f2962495199c`](https://testnet.monadvision.com/tx/0x6d1d6bdc5a942458c994e2735a684fb5b0665d77a692c3763c33f2962495199c) | 69,610,359 | 9 Oct 2026, 18:26:28 | `createPot` on the AUSD pots from the same account. Its `PotCreated` event names pot 0, "Anniversary", 2 of 2 deciders, one payee, closing 1 Nov 2026 |
| FundWithPermit, the first deposit in pot 0 | [`0x9276983cefc2ff505352412a2044841d81f6f032b3ba1ece5ff9f21d040c5cbe`](https://testnet.monadvision.com/tx/0x9276983cefc2ff505352412a2044841d81f6f032b3ba1ece5ff9f21d040c5cbe) | 69,611,378 | 9 Oct 2026, 18:31:36 | `fundWithPermit` from a second app account, `0x97936c44214231002051A601e2065732382Df8b4`: the permit's `Approval`, the AUSD `Transfer` and `Funded` for $200, in one request |
| Send dollars, a plain AUSD payment to another person | [`0xd23cf8e21f928468d7f1d826f6d2cd8d351faf1b3e698d823b37808007641ade`](https://testnet.monadvision.com/tx/0xd23cf8e21f928468d7f1d826f6d2cd8d351faf1b3e698d823b37808007641ade) | 70,176,817 | 11 Oct 2026, 17:57:44 | `transfer` on AUSD from the app account `0x725C9cd75b2C8C29AEbf6a14eE84a3b54C787bC1` to a third app account, `0xa5057F32DB2a6f68F69ad1587014AbF101A20B61`: one AUSD `Transfer` of $50. Settled in 2.5 s on the sending phone, one measurement |
| Send in another currency, the exchange through Agora's pair | [`0x9d95911b7e9b2811bf4063054cb13e573e229260398705d7464844456a1f93b1`](https://testnet.monadvision.com/tx/0x9d95911b7e9b2811bf4063054cb13e573e229260398705d7464844456a1f93b1) | 70,177,155 | 11 Oct 2026, 17:59:26 | `swapExactTokensForTokens` on Agora's pair from the same account to the same recipient: 50 AUSD in from the sender, 50 CTK out to the recipient, `SwapFees` 0 and 0, so $1 = 1.00 CTK. Settled in 1.2 s on the sending phone, one measurement, timing this exchange alone |
| Send dollars, the $25 from London to Houston in the bounty video | [`0x295647906ec087f124fbc3292a4660c12ccfda867e3aa8389683a3eb25ceb17d`](https://testnet.monadvision.com/tx/0x295647906ec087f124fbc3292a4660c12ccfda867e3aa8389683a3eb25ceb17d) | 70,391,921 | 12 Oct 2026, 12:00:18 | `transfer` on AUSD from a fresh passkey account, `0xd6a619f8F0F5ed3050635E0274971985794154c8`, to the account `0x607b6F5dc7f721C6Cf0902d50bA1Bed724f8562C` (ending 562C): one AUSD `Transfer` of $25. Settled in 2.2 s on the sending phone, and the recipient's phone shows $25.00 at the same moment |
| Send in another currency, $50 as CTK in both videos | [`0x112a8747b5e4f1b77321ce74334a5dc24753404d0475d1b93f819b0af84fab44`](https://testnet.monadvision.com/tx/0x112a8747b5e4f1b77321ce74334a5dc24753404d0475d1b93f819b0af84fab44) | 70,608,773 | 13 Oct 2026, 06:16:55 | `swapExactTokensForTokens` on Agora's pair from the same sender to the same recipient: 50.00 AUSD in, 50.00 CTK out to the account ending 562C, after the one-time setup and the allowance, one fingerprint for all three. Settled in 1.3 s on the sending phone |
| CreatePot, the Birthday pot in the technical video | [`0xe62866fbda9cf329b002ee0bf6d9cae767a7722ae689a4bc1d790fbf72592f5d`](https://testnet.monadvision.com/tx/0xe62866fbda9cf329b002ee0bf6d9cae767a7722ae689a4bc1d790fbf72592f5d) | 69,908,559 | 10 Oct 2026, 19:27:44 | `createPot` on the AUSD pots from the app account `0x725C9cd75b2C8C29AEbf6a14eE84a3b54C787bC1`. Its `PotCreated` event names pot 1, "Birthday" |
| FundWithPermit, Eddy's $200 into the Birthday pot in the technical video | [`0xb2280f5941859658ab3df36768da3c15b9f53c180b3abd6439bb3b63b57a9cfe`](https://testnet.monadvision.com/tx/0xb2280f5941859658ab3df36768da3c15b9f53c180b3abd6439bb3b63b57a9cfe) | 69,908,640 | 10 Oct 2026, 19:28:09 | `fundWithPermit` from the same account: the permit's `Approval`, the AUSD `Transfer` and `Funded` for $200, in one request |
| The second yes that pays, in the Birthday pot in the technical video | [`0x0c1f90cc259db9c53af480ba1486021a2f86dad32369676aa8efe839c179acba`](https://testnet.monadvision.com/tx/0x0c1f90cc259db9c53af480ba1486021a2f86dad32369676aa8efe839c179acba) | 69,909,376 | 10 Oct 2026, 19:31:51 | `approve` from the same account, the second of 2 yeses: `PayoutExecuted` pays the Event Center account `0x97936c44214231002051A601e2065732382Df8b4` $50 with a $0.25 fee, in that same request |

Pot 0 has had two more since, on 10 Oct 2026: a second $200 put in by its
maker
([`0xa5a64cabcf31608837fe03587734e94ad074548b78007f7e22054a6b4489d738`](https://testnet.monadvision.com/tx/0xa5a64cabcf31608837fe03587734e94ad074548b78007f7e22054a6b4489d738),
08:32:17 UTC) and a request to pay its payee $100 with a $0.50 fee
([`0xa8a0481a8a818baac227d4cf1662c6e3edca933291dce6ae65bff485d8eaeb9a`](https://testnet.monadvision.com/tx/0xa8a0481a8a818baac227d4cf1662c6e3edca933291dce6ae65bff485d8eaeb9a),
08:34:05 UTC), which is waiting for its second yes. It holds $400. The two
sends came from the phone test on 11 Oct 2026, from pot 0's maker to its
payee's account: each one finalized, with its transfer events decoded from
the receipt.
Their settle times are the app's own "Settled in" figure: the phone's clock
starts as the signed request is handed to the network, just after the
fingerprint, and stops when the app first sees the block holding it finalized.

The three Birthday rows are pot 1, made in the 10 Oct 2026 test run that the
technical video shows: the pot made, Eddy's $200 poured in, and the second yes
paying the Event Center. They were found on chain from the pot's events
(`potCount()` bisected to the block that made pot 1, then its `Funded` and
`PayoutExecuted` logs), each read back as successful and finalized on 13 Oct
2026, and `video/src/facts.test.ts` fails unless the first two match
`video/src/facts.ts`. Pot 0 stays the showcase reviewers can open.

## Contract addresses

Monad testnet, chain id `10143`, RPC `https://testnet-rpc.monad.xyz`. The
explorer is [MonadVision](https://testnet.monadvision.com), which reads
verified source from Monad's Sourcify. The "Verified" links below are the
Sourcify records themselves, so anyone can check them; each was checked on 9
Oct 2026, and the two NivPayPotsV2 on 19 Oct 2026.

| Contract | Address | Verified source | What it is for |
| --- | --- | --- | --- |
| NivPayPots on AUSD | [`0xB9E68db3117Db149dF56F5Aa29CF6adaA2369EfB`](https://testnet.monadvision.com/address/0xB9E68db3117Db149dF56F5Aa29CF6adaA2369EfB) | [exact match](https://sourcify-api-monad.blockvision.org/v2/contract/10143/0xB9E68db3117Db149dF56F5Aa29CF6adaA2369EfB) | The product. Pots funded in AUSD. The app runs on this by default. |
| NivPayPots on TESTUSD | [`0xe80FBB5F77Cb87d4f588A3F21bf9Eae34fC996aA`](https://testnet.monadvision.com/address/0xe80FBB5F77Cb87d4f588A3F21bf9Eae34fC996aA) | [exact match](https://sourcify-api-monad.blockvision.org/v2/contract/10143/0xe80FBB5F77Cb87d4f588A3F21bf9Eae34fC996aA) | The same bytecode bound to TESTUSD, the fallback for testing. |
| NivPayPotsV2 on AUSD | [`0xa41e0DdC0c94a795f200c5e850321242975dFA93`](https://testnet.monadvision.com/address/0xa41e0DdC0c94a795f200c5e850321242975dFA93) | [exact match](https://sourcify-api-monad.blockvision.org/v2/contract/10143/0xa41e0DdC0c94a795f200c5e850321242975dFA93) | Pots that can change, with a 72 hour exit window and a 7 day apply period, read back from the chain. New pots are made here; pots on NivPayPots stay there and keep working. See [Pots that can change](#pots-that-can-change-nivpaypotsv2). |
| NivPayPotsV2 on TESTUSD | [`0xE47CCe61e95fB4B451c0FfF0dD5164F2E48e79d1`](https://testnet.monadvision.com/address/0xE47CCe61e95fB4B451c0FfF0dD5164F2E48e79d1) | [exact match](https://sourcify-api-monad.blockvision.org/v2/contract/10143/0xE47CCe61e95fB4B451c0FfF0dD5164F2E48e79d1) | The same V2 bytecode bound to TESTUSD. |
| NivPayNames | [`0x798f4a11c16C96561fE7834365420505542e280D`](https://testnet.monadvision.com/address/0x798f4a11c16C96561fE7834365420505542e280D) | [exact match](https://sourcify-api-monad.blockvision.org/v2/contract/10143/0x798f4a11c16C96561fE7834365420505542e280D) | The username registry, one for both pot instances. No owner, no admin, no fee. See [Usernames for accounts](#usernames-for-accounts). |
| NivPayTestDollar (TESTUSD) | [`0x9FD60818e0DFee982d677cd72FbC3601Cc2eB6f7`](https://testnet.monadvision.com/address/0x9FD60818e0DFee982d677cd72FbC3601Cc2eB6f7) | [exact match](https://sourcify-api-monad.blockvision.org/v2/contract/10143/0x9FD60818e0DFee982d677cd72FbC3601Cc2eB6f7) | A worthless test token anyone can mint, 100,000 per call. Testnet only. |
| AUSD (Agora) | [`0xa9012a055bd4e0eDfF8Ce09f960291C09D5322dC`](https://testnet.monadvision.com/address/0xa9012a055bd4e0eDfF8Ce09f960291C09D5322dC) | [Monadscan](https://testnet.monadscan.com/address/0xa9012a055bd4e0eDfF8Ce09f960291C09D5322dC#code): proxy `AgoraDollarErc1967Proxy`, implementation `AgoraDollar`, both exact matches; not on Monad's Sourcify | Agora's six decimal dollar. Not ours. |
| Agora AUSD faucet | [`0xd236c18D274E54FAccC3dd9DDA4b27965a73ee6C`](https://testnet.monadvision.com/address/0xd236c18D274E54FAccC3dd9DDA4b27965a73ee6C) | [Monadscan](https://testnet.monadscan.com/address/0xd236c18D274E54FAccC3dd9DDA4b27965a73ee6C#code): proxy `AgoraTransparentUpgradeableProxy`, exact match; implementation a similar match (same bytecode as another verified contract); not on Monad's Sourcify | Dispenses test AUSD. Not ours. |
| Agora Instant Settlement pair, AUSD and CTK | [`0x1Aa8958Aa34cEC8096EF4381cb335effe977b0ae`](https://testnet.monadvision.com/address/0x1Aa8958Aa34cEC8096EF4381cb335effe977b0ae) | proxy; its implementation `0x1a5d115a87e39fd8d8c9e53b91dbe5e0ec309dd2` is a [Sourcify match](https://sourcify-api-monad.blockvision.org/v2/contract/10143/0x1a5d115a87e39fd8d8c9e53b91dbe5e0ec309dd2) | Delivers a payment in another currency at a fixed price. Not ours. |
| Agora whitelister | [`0x7c10F56d6f04a51376393a1C3670e966863F6BD5`](https://testnet.monadvision.com/address/0x7c10F56d6f04a51376393a1C3670e966863F6BD5) | proxy, exact match on [Monadscan](https://testnet.monadscan.com/address/0x7c10F56d6f04a51376393a1C3670e966863F6BD5#code); implementation `0xB6118Dd4ee6d92a6b4878ca4a011080b906a35ef`, `AgoraWhitelister`, exact match | Grants an account permission to send through the pair. Not ours. |
| CTK (ConstantToken) | [`0x7BEb5D9DB0d85cBEa543C04f0dE8c23c2176cd9D`](https://testnet.monadvision.com/address/0x7BEb5D9DB0d85cBEa543C04f0dE8c23c2176cd9D) | [Monadscan](https://testnet.monadscan.com/address/0x7BEb5D9DB0d85cBEa543C04f0dE8c23c2176cd9D#code): `ConstantToken`, exact match; not on Monad's Sourcify | Agora's 18 decimal test currency on the other side of the pair. Not ours. |

AUSD and the faucet are Agora's contracts. Both are EIP-1967 proxies: AUSD's
implementation is `0xc1e3C7D486d6A92fBE920232E439EeC2cEb112dA` and the
faucet's is `0xba804DF5c476E8EaeF87BF8085F295300ccE2a49`, read from the
standard implementation slot. Monad's Sourcify, which MonadVision reads, has
no match for either proxy or either implementation (404 on 10 Oct 2026), but
Monadscan shows verified source for all of Agora's contracts here, with the
names and match kinds in the table above (read from its public pages on 10
Oct 2026).

NivPayNames was deployed on 15 Oct 2026 in block 71,283,172; its Sourcify
record was checked the same day.

The four NivPay contracts were deployed from
`0x7EAf7f3e330ac388A0e951e80957B7274597297c`. Their deploy transactions, from
the committed broadcast receipts under `broadcast/*/10143/`:

```
NivPayPots on AUSD          0xa2de65f6cdc7bcd8ab0d3e4e11f7652fb2e0392e2e5eff88bc31c4548a18a286
NivPayTestDollar (TESTUSD)  0x561e99082af17a9873948ccbe32b534b311777db6a995d6f48ee047440a5d856
NivPayPots on TESTUSD       0x68e15496691cfbe7bfa117db8e023141309a03e52b42e30b98fbca1bb19fe0eb
NivPayNames                 0x9bf29091dbe3167dfd72f6602a1f4d4d32f06039b6d001f7c1199f74df4d949e
```

Both pot instances have identical fee settings, read back from the chain on 9
Oct 2026: `feeBps` 50 (0.5 percent), `feeCap` 50,000,000 base units (50 AUSD
or 50 TESTUSD per payout), `feeRecipient`
`0x7EAf7f3e330ac388A0e951e80957B7274597297c`.

## What the contract can and cannot do, read from the source

This was checked by reading `src/NivPayPots.sol` line by line, not assumed
from its comments.

* **There is no owner or admin.** No `owner` variable, no role, no
  `Ownable` or `AccessControl`. The only imports are OpenZeppelin's `IERC20`,
  `IERC20Permit`, `SafeERC20`, `ReentrancyGuard` and `Math`, none of which
  carries any privileged role.
* **Nothing global can be changed after deployment.** The constructor sets
  four `immutable` values, `token`, `feeBps` (refused above 100), `feeCap` and
  `feeRecipient`, and there is no function that sets anything else global.
  No pause, no setter, no `delegatecall`, no `selfdestruct`, no inline
  assembly, no `payable` function, no `receive` or `fallback`. The deployed
  contract is not a proxy (its implementation slot is empty) and its bytecode
  is an exact Sourcify match for this source.
* **The deployer has no power at all** after the deployment transaction. The
  deployer's address appears nowhere in the code paths.
* **One address gated power exists: `collectFees()`.** Only `feeRecipient`
  may call it, and it can only transfer the `feesAccrued` counter, which grows
  only by the fee on each executed payout. It cannot reach any pot's money. On
  the two deployed instances the fee recipient happens to be the deployer's
  address, so that key can collect fees and nothing else.
* **Every other check is per pot**, set by whoever creates the pot and fixed
  for its life: only that pot's approvers can propose, approve, revoke their
  own approval or freeze; only a proposal's proposer can cancel it.
  `closePot` is open to anyone, but only after the end time.
* **Tokens leave the contract in exactly three places**: a payout to a
  destination listed at creation (`_executePayout`), a funder redeeming their
  own shares (`_redeem`, used by `exit` and `claim`), and `collectFees` to the
  fee recipient.
* **Tokens sent straight to the contract are stuck for good.** There is no
  rescue function, by design; they do not change any pot's share price.

### Each claim, and the line that proves it

Checked on 10 Oct 2026 against `src/NivPayPots.sol` at this commit. The
deployed AUSD instance is this source: a fresh build with the `deploy`
profile (solc 0.8.28, optimizer 200 runs, no IR) is byte for byte the code
at `0xB9E68db3117Db149dF56F5Aa29CF6adaA2369EfB` (`eth_getCode`), including
the 51 byte metadata trailer, which carries the hash of the source. The
only differences are the 17 places the compiler leaves for the four
immutables, which hold AUSD, `feeBps` 50, `feeCap` 50,000,000 and the fee
recipient `0x7EAf...297c`.

| Claim | Where |
| --- | --- |
| No owner or admin, no roles | imports at lines 4 to 8 are `IERC20`, `IERC20Permit`, `SafeERC20`, `ReentrancyGuard`, `Math` only; no `owner`, `Ownable` or `AccessControl` anywhere |
| Nothing global can be set after deploy | `token`, `feeBps`, `feeCap`, `feeRecipient` are `immutable` (lines 68 to 79), set only in the constructor (235 to 242); `feeBps` refused above `MAX_FEE_BPS` 100 (48, 237) |
| No global pause | the only pause is `freeze(potId)`, one pot (577 to 583) |
| Not a proxy | no `delegatecall`, no assembly in the source; the deployed implementation slot is empty and the code matches the build above |
| Fees go to the fee recipient only | `collectFees` refuses anyone else (604) and moves only `feesAccrued` (605 to 608), which grows only on a payout (560); on both instances that recipient is the deployer's address |
| One decider can pause a pot, only the rule can unpause it | `freeze` needs only `_isApprover` (579), refuses a second freeze (580); `pot.frozen = false` appears once, in `_execute` for an agreed unpause request (516 to 518) |
| A pause stops pour-ins and payments, never exits | frozen is checked in `_fund` (337), `proposePayout` (418), `approve` for payouts (475) and `_executePayout` (531); `exit`, `claim` and `_redeem` (370 to 405) have no such check |
| Requests expire after 7 days | `PROPOSAL_TTL = 7 days` (47); `approve` refuses after (471) |
| The closing time | `_isClosed` is `closedFlag \|\| block.timestamp >= endTime` (626 to 627); `endTime` must be in the future when made (268) and nothing changes it; `closePot` only records it (589 to 594) |
| Exits in every state | `exit` calls `_redeem` (370 to 372), which checks only that the caller holds the shares (384 to 386) |
| What is left goes back by share | `claim` needs the pot closed (378) and burns all the caller's shares for their part of what is left, rounded down (379, 382 to 396, `_convertToAssets` 656) |
| Nobody can take another person's share, so a lost passkey's share stays put | shares are written only for `msg.sender`: when they pour in (357) and when they take out (392); there is no transfer or approval of shares |
| A payment goes only to a listed payee, within its cap | `_executePayout` pays `_destinations[potId][p.destIndex].to` and refuses past its cap (523 to 566) |

The Foundry suite was run on 10 Oct 2026, default profile: see
[Tests](#tests).

### What a pot's maker or its deciders can do to those who put money in

All of this is visible before anyone puts money in, but only if they look:

* **The maker chooses every name.** A payee's name ("Caterer") is a label
  the maker typed, stored on chain and in the signed link. Nothing checks
  it: a maker can list their own account as "Caterer". The app shows each
  payee's account ending under its name; check it with the real payee.
* **A rule of one yes.** With "1 of n", any single decider can pay a listed
  payee up to its cap at once, with no one else agreeing. The rule is on
  the pot screen ("1 of 3 must agree").
* **Caps can be as large as the maker likes**, so a payee can be allowed
  all of the pot.
* **A decider can pause a pot for good.** Payments stop until the rule
  agrees to unpause; everyone can still take their own share out.
* **A payment agreed just before you take your share out** lowers what you
  get, as it would for everyone in the pot.
* **The closing time can be seconds away** if the pot is made outside the
  app; the app itself refuses less than 10 minutes. A closed pot still
  lets everyone take what is left by share.

### NivPayPotsV2, each claim and the line that proves it

Checked on 17 Oct 2026 against `src/NivPayPotsV2.sol` at this commit, the
source both deployed instances are built from, byte for byte (see Deploying
the contracts). Everything
in the V1 table above holds for V2 as well, at the same functions; the lines
below are V2's.

| Claim | Where |
| --- | --- |
| Still no owner, admin, role or upgrade | imports at lines 4 to 8 are V1's: `IERC20`, `IERC20Permit`, `SafeERC20`, `ReentrancyGuard`, `Math` only; no `owner`, no `delegatecall`, no assembly |
| Tokens still leave only to a funder redeeming their own part, a listed payee, or as fees | the only transfers out are `_redeem` (570), `_executePayout` (744) and `collectFees` (1117); no change function moves a token |
| A pot's payees, limits and closing date change only by an applied change | outside `createPot` (426 onwards) they are written only in `_apply`: a payee added (958), the closing date (960), a limit (964, 968), a payee removed (970); what a payee was paid only by a payment (729) |
| The deciders, the rule and the name never change | `pot.purpose`, `pot.threshold` and `_approvers` are written only in `createPot` (446 to 457) |
| 72 hours and 7 days are fixed at deployment | `EXIT_WINDOW` and `APPLY_PERIOD` are immutables (126, 130), each between 1 minute and 30 days (408, 409); `script/DeployPotsV2.s.sol` passes 72 hours and 7 days and reads them back, and `test/DeployPotsV2.t.sol` fails on anything else |
| Only the pot's deciders propose and agree changes | `_openChange` (894) and `approveChange` (825) need `_isApprover` |
| The same yeses as a payment | agreed when its yeses reach `pot.threshold` (837, 928), as a payment is |
| A widening change waits `EXIT_WINDOW` from the yes that agrees it | `_agree` (931 onwards) stamps the time; `_changeStatus` keeps it `Waiting` until then (1058); `applyChange` (870 onwards) needs `Ready` |
| No yes after it is agreed, so the wait can't move | `approveChange` needs `Pending` (828); taking a yes back refuses too (843) |
| It lapses `APPLY_PERIOD` after its wait | `Ready` only until then (1059), then `Lapsed` |
| Nothing is agreed that could never apply | refused when proposed (898) and when agreed (938) if the pot closes before the wait ends; `_checkWidening` (982) at agreement and again when applied |
| Narrowing applies with its yes, and ends what it made moot | `_agree` applies a lowering or removal at once (`_widens`, 1065); `_override` (993) ends that payee's open raises, or all its open changes on a removal |
| Checked again when it applies | `_apply` (951 onwards): `_checkWidening` for room, a later date and a raise that still raises; a lowering still lowers and stays above what was paid; a removed payee takes nothing (`_livePayee`, 1071) |
| A paused pot applies nothing that widens | `applyChange` refuses while frozen (875) |
| A closed pot takes no change | refused when proposing (893), agreeing (829) and applying (874) |
| At most 5 open, at most 2 from one decider | `MAX_OPEN_CHANGES` (99) checked at 896, `MAX_OPEN_PER_PROPOSER` (103) at 897, after ended ones are swept (`_sweep`, 1021) |
| Only the proposer withdraws | `withdrawChange` (856) |
| A removed payee is paid nothing | refused when asking (594) and when paying (710) |
| Exits during the wait | `exit` and `_redeem` (544 onwards, 556 onwards) are V1's, with no check on changes, a pause or a close |

The suites that check this: `test/PotsChanges.t.sol` (every rule, one at a
time), `test/PotsChangesFuzz.t.sol`, `test/PotsChangesInvariant.t.sol` with
`test/handlers/PotsV2Handler.sol`, `test/DeployPotsV2.t.sol`,
`test/PotsForkV2.t.sol` on the real AUSD, and every V1 suite again on V2
(`test/PotsOnV2.t.sol`). See [Tests](#tests).

### Outside this contract: Agora's Instant Settlement

Sending in another currency goes through Agora's pair
`0x1Aa8958Aa34cEC8096EF4381cb335effe977b0ae`, which NivPay does not control.
Read from its verified source and its live state on 9 Oct 2026:

* **One address holds every role on the pair:**
  `0x99B0E95Fa8F5C3b86e4d78ED715B475cFCcf6E97`, as `ACCESS_CONTROL_MANAGER_ROLE`,
  `PRICE_SETTER_ROLE`, `FEE_SETTER_ROLE`, `PAUSER_ROLE`, `TOKEN_REMOVER_ROLE` and
  `WHITELISTER_ROLE` (with the whitelister contract). It is also CTK's owner.
  With those roles it can:
  * pause and unpause the pair (`setPaused`),
  * set the price within bounds (`configureOraclePrice`): today 0.9 to 1.1
    CTK per AUSD, with an interest rate bounded to 0,
  * set the purchase fee within bounds (`setTokenPurchaseFees`): today 0 to
    0.05 percent, currently 0,
  * change those bounds themselves (`setOraclePriceBounds`, `setFeeBounds`),
  * take the pair's reserves out (`removeTokens`) and its fees (`collectFees`),
  * grant or revoke anyone's permission to send through the pair, and set
    where removed tokens and fees go.
* **The pair and the whitelister are upgradeable.** Both are EIP-1967
  proxies whose admin slot holds
  `0x85f263d91f2706b32c85f22c681c0fe175eb48f2`, a contract Monadscan shows
  as `AgoraProxyAdmin` (exact match). It has no `owner()`; it uses Agora's
  role checks, and `hasRole("ACCESS_CONTROL_MANAGER_ROLE", 0x99B0...6E97)`
  is true on it. Whoever manages it can replace either contract's code.
  Whether any other address also holds that role was not checked: that
  would need the role's full grant history.
* **Read again on 10 Oct 2026:** the six roles above are still held by
  `0x99B0...6E97` (and `WHITELISTER_ROLE` also by the whitelister), which is
  also the pair's fee receiver; both proxies' admin slot still holds
  `0x85f2...48f2`; the pair is not paused. Its bounds, read from the pair:
  base price 1.0 CTK per AUSD with bounds 0.9 to 1.1 (`minBasePrice`,
  `maxBasePrice`, at `PRICE_PRECISION`), the interest rate bounded to 0
  (`minAnnualizedInterestRate`, `maxAnnualizedInterestRate`), and purchase
  fees 0 with bounds 0 to 0.05 percent for both tokens
  (`maxToken0PurchaseFee`, `maxToken1PurchaseFee` 5e14 at `FEE_PRECISION`
  1e18).
* **On testnet anyone may send through the pair**: the whitelister's
  `setApprovedSwapper` has no caller check, so the app's one-time setup grants
  the permission to the person's own account.

What that means for a NivPay payment, and how the app limits it:

* **The rate can't be changed against the sender.** The app quotes fresh
  before the confirm sheet and again right before signing, and sets the
  exchange's minimum amount out to the lower of the quote now and at the
  deadline. A price or fee change after that makes the exchange revert;
  nothing is exchanged below the minimum. The deadline is 5 minutes.
* **The pair is allowed exactly the amount being sent**, never an open
  allowance, so even an upgraded pair could take no more than one payment's
  dollars. If a payment fails after that step, the allowance for that one
  amount stays until the next payment in another currency uses it.
* **A pause, a revoked permission or emptied reserves** make the payment
  fail before anything moves: the app checks pause and reserves first (codes
  90 and 92), and the exchange reverts as a whole if anything changes in
  between.
* **What the recipient receives is CTK, Agora's test currency**, not
  dollars, and only worth what Agora's pair says it is.

AUSD itself is Agora's upgradeable token with asset
freezing controls. Agora can freeze an address, which would block that
address's own payout or exit and nothing else (see
[Token and security](#token-and-security)). `NivPayTestDollar` has no owner
either; anyone can mint up to 100,000 per call, and its constructor refuses any
chain but Monad testnet and local test chains.

## Architecture

```
  Phone (installable web app, React)
   |
   |-- Passkey (Mera): the passkey's PRF output becomes the account key,
   |   in memory, only while signing. Only the account and a display name
   |   are stored on the phone.
   |
   |-- Reads: public Monad testnet RPC, finalized block only.
   |   A pot's history comes from its events (eth_getLogs in 101 block pages).
   |
   |-- Writes: signed on the phone, raw transaction sent to the RPC.
   |   The signed bytes are saved in IndexedDB before sending, so a retry
   |   re-sends the same transaction and can never pay twice.
   |   Success is shown only at Finalized.
   |
   |-- POST /api/fund (Vercel function): a small grant of testnet MON
   |   before an account's first transactions, so nobody sees fees.
   |
   |-- POST /api/report (Vercel function): a report about a pot that
   |   named someone, written as one log line. Nothing is stored.
   |
   |-- Links shared in chats: invites, signed replies, pot links and
   |   requests to be paid, packed binary in the URL fragment.
   |
   |-- Send and receive: a plain AUSD transfer to a person's account, or,
   |   in another currency, Agora's Instant Settlement pair delivering CTK
   |   to them, up to three requests behind one fingerprint.
   v
  NivPayPots (AUSD or TESTUSD instance)  ->  AUSD / TESTUSD token
```

There is no app server or database beyond the one function above, and no
server ever sees a key. Pot state is read from the contract; the names people
give each other travel in signed links and are stored on each phone.

The documents behind the design:

| File | What it holds |
| --- | --- |
| `docs/APP-CONTRACT-MAP.md` | every screen mapped to contract calls, with testnet measurements of finality, log limits and gas |
| `docs/BUILD-APP.md` | the app brief: accounts, gas, product language, phases |
| `docs/MOTION.md` | animation rules |
| `docs/ERROR-CODES.md` | every "Code N" the app can show |
| `docs/DEMO.md` | the script for recording the demo on production, and the 2 minute bounty path |
| `docs/PERF-S10.md` | measuring the motions at 60fps on a Galaxy S10 over USB, with laptop figures for comparison |
| `docs/BOUNTIES.md` | the Agora bounty and how the app meets it |
| `docs/SUBMISSION.md` | the hackathon terms checklist |
| `docs/design/` | the design comps for the core screens |

## Tech stack

| Layer | Choice |
| --- | --- |
| Chain | Monad testnet, chain id 10143 |
| Contracts | Solidity 0.8.28, OpenZeppelin Contracts 5.1.0, Foundry 1.8.3 with `network = "monad"`, forge-std 1.16.2 |
| Money | AUSD (Agora) by default, TESTUSD as the test fallback; CTK through Agora's Instant Settlement for payments in another currency |
| Accounts | Mera 0.2.0 passkeys (WebAuthn PRF), `@scure/bip39` and `@scure/bip32` for the key path `m/44'/60'/0'/0/0` |
| App | React 19, TypeScript 7, Vite 8, viem 2.56, self hosted fonts, a service worker that caches the app shell only (every screen's scripts, so it opens offline and says so) and never `/api` or the RPC |
| Hosting | Vercel: static app plus two functions, `/api/fund` and `/api/fund/status` |
| Tests | `forge test` (unit, fuzz, invariant, fork), `node --test` for the app |

## Run it yourself

### Prerequisites

* Git, with submodules: `git clone --recurse-submodules <repo>`, or
  `git submodule update --init` in an existing clone.
* [Foundry](https://getfoundry.sh) 1.8.0 or later for the contracts.
* Node.js 24.x for the app (`engine-strict` is on, so other majors are
  refused).

### The contracts

```powershell
forge build
$env:FOUNDRY_PROFILE = "quick"; forge test   # everyday, seconds
Remove-Item Env:\FOUNDRY_PROFILE; forge test # thorough, before a deploy
```

The fork tests read Monad testnet and need network access. Deploying your own
instances is under [Deploying the contracts](#deploying-the-contracts).

### The app, locally

```powershell
cd app
npm ci            # exact versions from the committed lockfile
npm run dev       # http://localhost:5173
npm test          # unit tests, including the product language check
npm run build     # type-check, then a production build in app/dist
npm run preview   # serves the build under the production security headers
npm run test:live # optional, reads Monad testnet
```

Passkeys work on `localhost` without any configuration. The app uses the
deployed contracts above; nothing needs deploying to try it.

The gas grant function only runs on Vercel. Locally you have two choices:

* set `NIVPAY_API_TARGET` to a Vercel deployment of this app whose
  `ALLOWED_ORIGINS` includes `http://localhost:5173`, and the dev server
  forwards `/api` there; or
* run without grants and send a little testnet MON to the account yourself
  (the Account ID is under Account details), for example from Monad's testnet
  faucet. Without either, an account with no MON stops at its first action
  with one of the setup codes (12 to 21) in `docs/ERROR-CODES.md`.

### Deploying the app to Vercel

1. Import the repository in Vercel and set the project's **Root Directory** to
   `app`. `app/vercel.json` sets the framework, `npm ci`, the build command,
   the output directory and the security headers.
2. Set the environment variables below. Set `VITE_PRODUCTION_HOSTNAME` to the
   final hostname **before anyone makes an account**: a passkey is bound to the
   hostname it was made on and can never move to another.
3. To pay people's fees, create a **new key used for nothing else**, in your
   own terminal, and paste it only into Vercel's environment settings (mark it
   Sensitive). Never the deployer key. Send that address some testnet MON. To
   run without it, leave `FUNDING_ENABLED` unset or `false` and leave the key
   out entirely; `/api/fund` then answers "funding is paused" without reading
   anything.
4. Deploy. `GET /api/fund/status` should answer `"enabled": true`,
   `"keyMatches": true` and the funder's balance.

**Never put a key in this repository**, in a `.env` file or anywhere else.
`.gitignore` covers `.env*`, keystores and key files, but the rule is not to
have them in the working tree at all.

### Environment variables

None is needed to run the app locally or the tests.

| Variable | Where | Required | What it does |
| --- | --- | --- | --- |
| `FUNDING_ENABLED` | Vercel, server | no | The kill switch. Grants are sent only when it is exactly `true`. Anything else, or unset, pauses funding without reading the key. |
| `FUNDER_PRIVATE_KEY` | Vercel, server, Sensitive | only if funding is enabled | The dedicated testnet key that sends gas grants. Read only after every check has passed, never logged. Never the deployer key, never in the repo. |
| `FUNDER_ADDRESS` | Vercel, server | only if funding is enabled | The address of that key. The function refuses to sign unless the key derives exactly this address. |
| `RAMP_ENABLED` | Vercel, server | no | The test desk's kill switch (`/api/ramp`). Add money and Cash out work only when it is exactly `true`. Anything else, or unset, pauses the desk without reading its key. |
| `RAMP_DESK_PRIVATE_KEY` | Vercel, server, Sensitive | only if the desk is enabled | A dedicated testnet key for the test desk, which sends test AUSD for Add money and receives it on Cash out. Read only after every check has passed, never on a cash out, never logged. Not the funder key, never in the repo. |
| `RAMP_DESK_ADDRESS` | Vercel, server | only if the desk is enabled | The address of that key; the desk refuses to sign unless the key derives exactly this address. It needs testnet MON for its own gas (it stops under 0.2 MON) and claims test AUSD from Agora's faucet for itself when low. |
| `ALLOWED_ORIGINS` | Vercel, server | no | Comma separated extra origins allowed to call `/api/fund`, `/api/ramp` and `/api/report`, for example `http://localhost:5173`. The deployment's own origin is always allowed. |
| `VITE_PRODUCTION_HOSTNAME` | Vercel, build time | yes in production | The only hostname besides `localhost` where passkeys can be made or used. For this deployment, `nivpay.vercel.app`, and it must never change. |
| `BLOB_STORE_ID` | Vercel, server | no | Set by connecting a Vercel Blob store to the project. `@vercel/blob` pairs it with the OIDC token Vercel issues and rotates for each function, so no token is stored. Profile photos and shared cities stay hidden until a store is connected. |
| `BLOB_READ_WRITE_TOKEN` | Vercel, server, Sensitive | no | Only for a store connected the older way, with a token; used instead of `BLOB_STORE_ID` when set. |
| `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` | Vercel, server; the private key Sensitive | no | Made once with `npx web-push generate-vapid-keys`. Notifications on the phone stay hidden until both are set, with `VAPID_SUBJECT`. Never commit the private key. |
| `VAPID_SUBJECT` | Vercel, server | no | How push services can reach the sender: a `mailto:` address or the site's URL, such as `https://nivpay.vercel.app`. |
| `VITE_SUPPORT_EMAIL` | Vercel, build time | no | The address Help and support's Email support writes to. Its button is hidden while this is missing or malformed. |
| `VITE_SUPPORT_WHATSAPP` | Vercel, build time | no | The WhatsApp number Chat on WhatsApp opens (wa.me), country code first. Hidden while missing or malformed. |
| `VITE_NIVPAY_POTS` | build time | no | `testusd` builds the app on the TESTUSD instance. Anything else, or unset, is AUSD. |
| `NIVPAY_API_TARGET` | your machine, `npm run dev` | no | Forwards `/api` from the dev server to a Vercel deployment. |
| `FOUNDRY_PROFILE` | your machine | no | `quick`, `bench` or `deploy`; see [Profiles](#profiles). |
| `FEE_RECIPIENT`, `FEE_BPS`, `FEE_CAP` | your machine, contract deploy | to deploy | The immutable fee settings for a new NivPayPots. |
| `TEST_DOLLAR`, `AUSD_POTS` | your machine, TESTUSD deploy | to deploy TESTUSD pots | The TESTUSD address, and optionally the AUSD instance to copy fee settings from. |
| `MONADSCAN_API_KEY` | your machine | no | Only for verifying on Monadscan instead of Sourcify. |

The contract deployer key is never an environment variable: it lives in an
encrypted Foundry keystore outside the repository, see
[Create the encrypted keystore](#1-create-the-encrypted-keystore).

## Gas grants in the app, and their limits

The app (`app/`) never shows people gas or MON. A Vercel function,
`POST /api/fund` in `app/api/fund/index.ts`, sends an account a small grant of
testnet MON from a dedicated funder key before its first transaction, and the
app waits until that grant is finalized before sending anything of the
person's own. Sizes come from the gas measured in
`docs/APP-CONTRACT-MAP.md`, at 102 gwei:

| Rule | Value | Why |
| --- | --- | --- |
| Grant | 0.1 MON, fixed | a decider's whole story costs about 0.071 MON, a creator's first three actions about 0.084 |
| Only when the account holds under | 0.075 MON | above the most expensive single action, the first payment in another currency, about 0.059 (making a pot is about 0.044) |
| Only while the account has sent fewer than | 30 transactions | a full story is 5 or 6 per person, and the last grant is asked for by 3 sent (recounted in `docs/APP-CONTRACT-MAP.md` section 11); 30 leaves room for an account that keeps using NivPay after its first story |
| Only accounts with | no contract code | |
| Funder floor | 1 MON | granting stops before the funder can run dry |
| Grants an hour, from every server instance together | 20 | counted from the funder's own nonce now and about an hour of blocks ago (11,600), so it needs no storage; a full demo take uses 5. If the past nonce can't be read, nothing is granted |
| The same address again, on the same instance | refused for 2 minutes after a grant | closes the window while the first grant is still landing |
| Request body | 1 KB at most | refused unread above that |
| Kill switch | `FUNDING_ENABLED` not `true` | answers "funding is paused" without reading the key |
| A broadcast that times out or errors | looked for before answering | the grant is signed first, so its hash is known; it is looked for 3 times, 2 s apart, and the same signed bytes are sent once more. Mined or pending, the answer is the grant (`pending: true` when not mined yet), which the app waits for as for any grant; only a grant that truly didn't go out answers `SEND_FAILED` (Code 16). One request is one signed grant at one nonce, so this never makes two |

`GET /api/fund/status` returns only whether funding is on, whether the
funder key derives `FUNDER_ADDRESS` (`keyMatches`, true or false, nothing
else about the key), and the funder's balance. Each grant is logged with the address, the amount and the
transaction hash; nothing else from the request is logged, and the key never
is.

**The honest limit.** These rules bound what one address can take, about 30
grants or 3 MON if someone deliberately spends each grant away. They do not
bound how many addresses someone can make, and new addresses cost nothing.
A determined abuser can therefore still drain the funder down to its 1 MON
floor, where granting stops until it is refilled, but no faster than 20
grants an hour: about 2 MON an hour instead of everything above the floor
within a minute. That leaves time to turn `FUNDING_ENABLED` off. The same-origin check only stops
other websites from using a visitor's browser; a script can send any Origin
header it likes. Two requests for the same address that reach different
server instances at the same moment can both be granted. None of this can
touch anyone's pot: the funder only ever holds testnet MON for gas.

**Requests with several steps.** A first payment in another currency signs
three requests whose gas limits add up to about 0.059 MON at today's price,
the largest single action in the app. The threshold sits above it, at
0.075 MON, so an account that can't be topped up can always pay for it. Only
if the network price rose above about 130 gwei could an account hold too much
for a grant and too little for the request; the app then says so with code 93
before anything is signed.

## Getting test AUSD

Agora's faucet at `0xd236c18D274E54FAccC3dd9DDA4b27965a73ee6C` is a UUPS proxy.
Its implementation was read off chain at
`0xba804df5c476e8eaef87bf8085f295300cce2a49` and its interface recovered from
the bytecode, since the source is not published through the Monad Sourcify
endpoint.

**Claim by calling `requestFunds(address)` with the address that should receive
the tokens.** You do not need to be that address.

```powershell
cast send 0xd236c18D274E54FAccC3dd9DDA4b27965a73ee6C `
    "requestFunds(address)" `
    <recipient_address> `
    --account nivpay-deployer `
    --rpc-url https://testnet-rpc.monad.xyz
```

The terms it enforces, read from the live contract:

| Getter | Value | Meaning |
| --- | --- | --- |
| `faucetDripAmount()` | `10000000000` | 10,000 AUSD per claim |
| `maxDripFrequency()` | `60` | one claim per 60 seconds for the whole faucet, not per account (`lastDripTimestamp()` is a single value) |
| `maxAmountToOwn()` | `100000000000` | refuses if you already hold 100,000 AUSD or more |
| `token()` | `0xa901...22dC` | the same AUSD this contract uses |

Check it has stock before trying, because it reverts with `InsufficientFunds()`
(`0x356680b7`) once its balance is down to a single drip:

```powershell
cast call 0xa9012a055bd4e0eDfF8Ce09f960291C09D5322dC "balanceOf(address)(uint256)" 0xd236c18D274E54FAccC3dd9DDA4b27965a73ee6C --rpc-url https://testnet-rpc.monad.xyz
```

It was dry in Phase 0 (one base unit), which is why
`test_fork_faucetDispensesAusd` skips rather than fails when it is. It has
since been restocked: on 9 October 2026 it held 996,345,050 AUSD (995,775,050
on 10 October), and the app's
"Add test dollars" now claims from it on the AUSD deployment.

Its refusals, recovered from the bytecode and confirmed on a fork of the live
contract (the error names aren't published, so the app matches selectors):

| Selector | When |
| --- | --- |
| `0x20e5bc67` | a claim inside 60 seconds of anyone's last claim |
| `0x0949dab9` | the recipient already holds 100,000 AUSD or more |
| `0x356680b7` | the faucet is down to a single drip (`InsufficientFunds()`) |

### In the app

The app runs on the AUSD pots unless it was built with
`VITE_NIVPAY_POTS=testusd`. On AUSD, "Add test dollars" first gets a gas grant
from `/api/fund` if the account needs one, then the person's own passkey
account calls `requestFunds(its own address)` for one drip. Before anything is
sent, the app runs the claim as a call against the latest block, so a cooldown
or the ceiling is reported (codes 60 and 61 in `docs/ERROR-CODES.md`) without a
grant or a passkey prompt. On a cooldown the screen counts down the seconds
left and enables "Try again" at 0; it never claims again without a tap. A
claim that is included but reverts, usually because someone else claimed
first, is code 62. The new balance appears only once the claim is finalized.
On TESTUSD, the button mints TESTUSD as before; both deployments are on the
testnet only.

## The pot story in the app

The five comps in `docs/design/` are built as screens, in story order. Every
amount and state on them is read at the finalized block or from the pot's
finalized events; nothing lands before Finalized.

| Screen | Where | Status |
| --- | --- | --- |
| Make a pot | `app/src/screens/Create.tsx` | Built; pot 0 on the AUSD pots was made on testnet on 9 Oct 2026 |
| Pour in your share | `app/src/screens/ChipIn.tsx` | Built; pot 0 holds $400, a pour from each of two accounts |
| Ask for a payment, and say yes | `app/src/screens/Ask.tsx`, `Request.tsx` | Built, checked with unit and live read-only tests. One request has been asked on testnet, on pot 0 on 10 Oct 2026 (see [Monad integration](#monad-integration)); a yes that pays still needs the phone run. A named decider sees a request waiting for their yes on Home with no link. |
| The pot's story | `app/src/screens/Timeline.tsx`, `app/src/lib/story.ts` | Built, checked with unit and live read-only tests; needs the phone run. On a first open the history fills newest first in the background (see [Known limits](#known-limits)) |
| Close and split | `app/src/screens/Close.tsx`, `app/src/lib/close.ts` | Built, checked with unit and live read-only tests; needs the phone run. Closing early is a request with yeses, like a payment; taking your share out works in every state the contract allows |

Deciders "say yes"; the app never shows the word "approve", which the
product language check (`app/src/copy.test.ts`) refuses everywhere people
read.

## Accounting

Shares are ERC4626 style, with OpenZeppelin's virtual shares and virtual assets
and a decimals offset.

* Funding mints shares at the current value per share, so **a later funder
  never pays for spending that happened before they joined.**
* Payouts and fees reduce pot assets **without burning shares**, so every
  funder bears spending in proportion to their stake.
* Exits and claims burn shares for their pro rata assets.
* Every conversion rounds **in favour of the pot, never the caller**. A funder
  can lose at most one unit to rounding; the pot keeps it as dust.
* Pot assets live in internal storage and are **never derived from the token
  balance**, so sending AUSD straight to the contract moves no share price and
  is simply a donation nobody can withdraw.

The decimals offset is 3 rather than the more usual 6. The share inflation
attack that larger offsets defend against is already impossible here, because a
donated balance is invisible to every conversion, and a smaller offset leaves
more headroom in uint256 for the supply growth described below.

**A pot spent to nothing and funded again** is handled and tested. Shares in an
empty pot are worth exactly zero, so a new funder receives essentially the whole
supply and does not inherit the old spending. The cost is that the share supply
is multiplied by roughly the funded amount on each such refund, so a pot drained
to zero and refunded many times over will eventually overflow and stop accepting
new funding. Every funder can still exit at that point. This is documented in
the contract rather than papered over, because resetting the supply instead
would silently detach per funder balances from the total.

## Where your money went

A pot's screen has a card for each person who put money in, yours first
(`app/src/lib/ledger.ts`, `app/src/screens/MoneyCards.tsx`):

    You put in                     $500.00
    Your part of payments made    -$300.00  (Caterer)
    Your part of fees               -$1.50
    Taken out                        $0.00
    Left for you                   $198.50

Tapping "Your part of payments made" lists each payment with your part of it.
The card is worked out by replaying the pot's finalized events with the
contract's own numbers, as described under Accounting: each payment and its
fee are divided by everyone's shares at that moment (virtual shares included),
so someone who joined after a payment shows nothing for it, and someone who
had already taken their part out shows nothing for what came after. "Left for
you" is the contract's own number, `funderInfo`'s `redeemable`, read at the
same finalized block; until the replay agrees with it, the cards wait. The
lines are in whole cents and always add up exactly: a payment total is rounded
once and its items take whole cents that add up to it, and whatever the cents
leave over shows as a Rounding line (at most 2 cents across 400 random pots
in the tests), never as lines that don't add up. `ledger.test.ts` checks that
against a separate model of the contract, with late joiners, early exits,
several payments, top ups and pots spent to nothing, and ties the model to
the contract itself: `test/vectors/ledger.json` holds 27 pots recorded from
NivPayPots, which `test/PotsLedger.t.sol` replays on the contract (every share
minted, exit, claim, fee and `funderInfo`) and `ledger.test.ts` replays
through the model and the cards.

Chip in says "Payments already made don't come out of your money." once a
payment has been made; Take my share out says "You'd get $198.50 now. That's
your part of what hasn't been spent."; and a closed pot's summary shows the
same cards.

## Fees

Fee basis points, the per payout fee cap and the fee recipient are set in the
constructor and are immutable. **Fee basis points can never exceed 100.**

The fee is charged **only on a successful payout**, taken from the pot on top of
the payout amount. Never on funding, exits, claims, closes or refunds.
Destination caps apply to the payout amount excluding the fee, so a destination
capped at 100 can be paid the full 100.

Fees are **credited to an internal counter and pulled** by the fee recipient
through `collectFees()`, rather than pushed during the payout. This is a
deliberate choice, and the reason is worth stating: the fee recipient is a
single address shared by every pot, and AUSD has asset freezing controls. If the
fee were transferred inside the payout, Agora freezing that one address would
revert **every payout in every pot forever**, with no admin and no upgrade to
undo it. Crediting keeps pots isolated, so a frozen fee recipient can only ever
block its own collection. Tested in
`test_frozenFeeRecipient_doesNotBlockPayouts`.

## Token and security

One immutable token, set in the constructor: **AUSD**. A second, test only
instance bound to a worthless test token is described under
[Two instances](#two-instances); the contract is the same bytecode either way.

* **Asset freezing is survivable.** A failed transfer to one address never
  blocks anyone else. A frozen destination makes only its own payout revert and
  leaves the proposal pending; a frozen funder can only ever block their own
  exit. Both are tested against a mock that reproduces Agora's freeze, and the
  whole lifecycle is tested against the real token on a fork.
* **Funding verifies the balance delta** and reverts if the contract did not
  receive exactly the amount.
* **`fundWithPermit`** wraps the EIP-2612 call in try/catch, so somebody
  front running the permit out of the mempool cannot grief the funder. Tested
  with a real replay in `test_fundWithPermit_survivesAFrontRunPermit`, and
  against the live AUSD domain separator on the fork.
* Checks effects interactions, `ReentrancyGuard` on everything that moves
  tokens, verified with a token that actually attempts reentry.
* No owner, no upgradeability, no delegatecall, no global pause. All loops are
  bounded by `MAX_APPROVERS` and `MAX_DESTINATIONS`, both 10.

## Known limits

These are limits of the design as built, stated so nobody relies on more.

* **The closing time is enforced by the contract, not by the app**, and only
  as the table under [The rules](#the-rules) says. Nothing happens on the
  date by itself: nobody is paid, and each person has to take their own
  share. The app is not a safety net for the date; it only shows it.
* **A share nobody takes stays in the contract for good.** There is no
  deadline, no sweep and no recovery. A person who loses the passkey that
  holds their account can never take their share; nobody else can take it
  for them, and no admin can move it.
* **Payment requests that never reach the rule expire after 7 days** and are
  never paid after close. A request that is still open keeps any yes it has
  until then.
* **The closing day is the maker's day.** `endTime` is the end of the chosen
  day in the maker's time zone. People elsewhere see the same moment in
  their own time.
* **History is read from the public RPC, 101 blocks at a time.** A phone
  opening an old pot for the first time shows its numbers at once (1 s on
  pot 0) and fills its history newest first, but the oldest entries arrive
  last: pot 0, 167,624 blocks old with its only events at the start when it was
  timed on 10 Oct 2026, took 11.6 minutes to complete. See `docs/APP-CONTRACT-MAP.md` section 12.
  Leaving before it finishes is fine: what is still to read is saved with
  what was read, and the next open carries on from there
  (`savedFeedState` in `app/src/lib/feed.ts`). Until 17 Oct 2026 it was not
  read back, so a pot left early came back without its oldest entries; a
  pot saved like that is read again from its first block, once
  (`refillCutShort`).

## Protecting people from bad actors

Three kinds of bad actor can use a group purse without breaking any rule:
someone who builds a "fundraiser" that only they control, someone who makes
pots naming strangers so they show up on their Home, and someone who uses a
relative's name, or "Event hall", on a link. The contract can't tell any of
these from honest use, and it stays exactly as deployed. The app answers them
with warnings and choices for the person, on their phone. **None of them
blocks or delays a payment.**

**Who controls this pot.** The pot screen, where people pour in, shows a
"Who controls this pot" card before the Pour in button: who decides and the
rule ("2 of 3 must say yes to each payment"), who can be paid and up to
what, and the closing date. Each person shows by the name this phone saved
for them as a contact, else the pot's own label, and always with "account
ending 7bC1", since a label is only what the maker typed. Then a calm line
for each thing the rules allow (`app/src/lib/potRisks.ts`):

* "One yes is enough to pay out."
* "Ubong decides and can also be paid."
* "Account ending 7bC1 made this pot and can be paid from it." The maker
  comes from the pot's `PotCreated` event, which the pot screen already
  checks every link against.
* "The people who can be paid have enough yeses between them to pay
  themselves."

And always: "NivPay makes sure money only goes to the people named here.
It can't check who they are." A pot where one person decides alone and is
the only payee is a fine way to collect for your own party, and a scam looks
the same; the card says what the rules allow and leaves the choice to the
person.

**New pots that name you.** Anyone can make a pot naming any account, and
Home finds every pot that names you from the chain. So Home now sorts what it
finds (`app/src/lib/potSort.ts`). A pot is yours if this phone made it, its
link was opened here, you answered its invite, you put money in, its maker
is one of this phone's accounts or a saved contact, or you chose Keep. Every
other pot goes in "New pots that name you", a separate section, collapsed,
with no badge and no announcement, and its requests never show under
"Waiting for your yes". Each row shows the pot's name as plain text, who made
it ("account ending 7bC1") and your role, with three buttons:

* **Keep** moves it to Your pots.
* **Hide** takes it off Home on this phone, per account and per deployment,
  and it stays off whatever else is true of it, even if its maker later
  becomes a contact. Opening its link brings it back. "Hidden pots" under
  Account details lists them, with Show again. Any pot can also be hidden
  from its own screen ("Hide from Home"), including one you made: a made
  pot can't be deleted, because it lives on the chain.
* **Report** asks for a reason ("Scam", "Pretending to be someone", "Spam" or
  "Not for me"), sends it to `/api/report`, then hides the pot.

Reports only reach the server logs, and are read by hand. `/api/report`
takes the deployment, the pot number and one of those four reasons, nothing
about the person reporting, and writes one log line. It stores nothing. It
has the same origin check and body cap as `/api/fund`, and takes at most 30
reports a minute on each server instance. A report changes nothing about the
pot.

**Contacts, and the first payment to an account.** "Save as contact" is
offered when someone opens a pay link, and on the Sent card after a payment
is final. Contacts show at the top of Send, so a person can pick one instead
of pasting an Account ID. The confirm sheet then warns:

* the first time this account pays another with a final payment: "First time
  paying account ending 7bC1. If you're not sure it's them, check by phone
  first."
* strongly, when a link's name matches a contact's name (ignoring case and
  spacing, after cleaning) but the account is different: "You have a contact
  called Idara with a different account. This may not be them."
* when the account is a contact saved under another name than the link's,
  the saved name first and the link's name second.

Contacts are a convenience on this phone, not an identity. Nobody checks
them, they are never sent anywhere, and clearing the site's data removes
them, along with the record of who this phone has paid
(`app/src/lib/contacts.ts`).

**What this can't stop.** People who agree among themselves: if two of three
deciders decide to pay themselves, the rules allow it, and the card can only
say so beforehand. A pot whose maker controls everything is still a valid
pot: NivPay warns, and nothing more. People who pour in anyway can take their
own share out at any time, as [The rules](#the-rules) say, but where one yes
pays, a payment can go out the moment it is asked, before anyone sees it. A contact name
helps only if the person saved the right account in the first place, and a
report is read by a person, later; nothing acts on it automatically.

## Daily limit

Money leaving an account is limited to $1,000 in any 24 hours, unless the
person sets another limit under Account details, which shows the limit, how
much was used and how much is left (`app/src/lib/limits.ts`). It counts Send,
Send in another currency, chipping in and Cash out, from the moment each is
sent, so requests still in flight count. Taking your share out of a pot and
money coming in never count. Over the limit, the app stops before the confirm
sheet, says how much is left today and that nothing was sent (Code 44), and
checks again right before signing. A test fails if a money screen doesn't
call the rule.

Lowering the limit takes effect at once. Raising it takes effect after 24
hours, and the screen says when, so nobody can pressure someone into raising
it on the spot.

Said honestly:

* **It counts this phone's payments.** The public RPC can't read a day of an
  account's history cheaply, so the limit counts the payments this phone made.
  A payment made from another phone counts only there. The screen says so.
* **The limit lives in the app.** It protects against mistakes and pressure,
  not against someone who has the passkey and uses other software: the
  contracts know nothing of it.
* **Clearing the site's data resets it** to the default, $1,000.

## Devices and sessions

Account details has three parts here (`app/src/screens/Devices.tsx`):

* **This phone** lists the accounts on it and when each was last used here,
  with Remove from this phone. That forgets this phone's name, drafts and
  settings for that account (contacts, hidden pots, the daily limit, what Home
  found), after a confirm that says unmade drafts are lost
  (`app/src/lib/forget.ts`). The account and its money stay; its passkey
  brings it back. It is refused while a request from that account is in
  flight, since that request's record is needed to finish it.
* **Signing.** NivPay keeps no signing session: each signature opens and ends
  its own (`app/src/lib/passkey.ts`), so every payment asks for the
  fingerprint, and the screen says so.
* **Your passkey** lives in the phone's password manager (iCloud Keychain,
  Google Password Manager or 1Password) and syncs to the person's other
  devices. To cut off a lost phone, remove it there. NivPay keeps no sessions
  on a server, so it can't list or sign out other devices, and doesn't
  pretend to.

## Notifications

A bell on Home shows the unread count and opens a list, newest first
(`app/src/lib/notes.ts`): money received, your own payment once final,
someone chipping in to a pot you're in, someone you put in a pot you made
putting money into it (named, from its `Funded` event), a pot that names you
when a contact or one of your accounts made it, a payment request waiting for
your yes, a request for money sent straight to you (with Pay, Ignore and
Mute), a payment paid out, a pot closing within a day, a pot closed with your
share ready to take, and a raised daily limit now in effect. Tapping one
opens the right screen. Read and unread are kept per account on this phone.

They are built only from what the app already reads at the finalized block:
the pots found for the account, the requests waiting for its yes, its own
pours and limit, and payments coming in (read like Receive reads them, every
15 seconds while Home is open), plus requests sent straight to you (below).
The list itself needs no server; notifications outside the app are a
separate, opt-in feature (Notifications on the phone, below). Said honestly:

* **The list starts from when this phone first ran the feature**, and says
  so; nothing earlier is listed.
* **"A payment paid out" covers pots the account decides on**, where the app
  already follows each request to its end.
* **"Someone chipped in" is a pot's total rising** between reads, less the
  account's own pours; two things in the same few seconds can show as one.
* **Pots new to the account, or hidden, never notify** (see Protecting
  people from bad actors). A pot that names you is announced only when its
  maker is one of your contacts or another account on this phone; strangers'
  pots stay in "New pots that name you" without a word.
* **"Your payment" is listed already read**: you just saw it go through.
* **Nudges don't exist in NivPay**, so there is no "someone you nudged"; the
  people you put in a pot you made are the ones named when they chip in.

## Requests to a person

From Receive, someone can ask a contact, or anyone by their `@username`,
for an amount or for any amount, without sharing a link
(`app/src/lib/inbox.ts`, `app/api/inbox/index.ts`).

* **Sealed to the person asked.** Each phone that turns on "Requests from
  people" (Profile, Notifications; one fingerprint) makes its own key pair in
  the browser. The private half can't be exported and never leaves the
  phone; the public half is published, proved by the account's passkey. A
  request is sealed on the requester's phone to every key the person asked
  has published (ECDH P-256, HKDF, AES-GCM), so only their phones can read
  it. `/api/inbox` keeps ciphertext only: not the amount, not the name, and
  not who asked.
* **Signed by the requester.** One fingerprint signs a short proof naming the
  requester, the person asked and a SHA-256 of the request. The server checks
  it before storing; the phone that opens the request checks it again from
  inside, and drops anything not addressed to it or not signed by who it says.
* **Pay, Ignore, Mute.** It shows in the person's bell. Pay opens Send filled
  in, where the usual checks apply (first payment to an account, a name that
  clashes with a contact, the daily limit, and a fingerprint). Ignore drops
  it for good. Mute stops every request from that account on this phone;
  Profile lists who is muted, with Unmute.
* **Limits.** A request is kept 30 days, a person has at most 50 waiting, an
  account at most 5 published keys; a few writes a minute per account. A
  phone that removes an account forgets its key; the public half stays on
  the server until turned off there, and requests sealed to it can no longer
  be opened anywhere.
* **Someone who never turned it on can't be asked this way** (Code 49): share
  the link instead.
* **Hidden until a Vercel Blob store is connected.**

## Notifications on the phone

Notifications outside the app, through Web Push and the existing service
worker (`app/api/push`, `app/api/notify`, `app/public/sw.js`).

* **Opt in, per phone.** Profile, Notifications, Turn on. The phone is asked
  for permission only after that tap, never on page load. The subscription is
  registered through `/api/push`, proved by the account's passkey (one
  fingerprint), so nobody can subscribe their phone to someone else's
  account. It is stored private in the Blob store, keyed by account. Turn off
  removes it, and the browser's subscription goes too once no account on the
  phone uses it.
* **What to be told about**, each on or off: money coming in, your own
  payments going through, money put into your pots, payments waiting for your
  yes, requests from people, Auto cash out (on the AUSD build), and pots made
  with you in them by people you know. That last one is off at first: to know who you know, the phone gives
  the notifications service your contacts' Account IDs (never their names)
  while it is on.
* **Show amounts on the lock screen**, off by default: "You received money."
  instead of "You received $100.00." A request from a person never carries
  an amount or a name, whatever the setting: they are sealed.
* **No cron.** Vercel's Hobby plan runs cron jobs once a day, so instead,
  when someone's own payment, chip-in, pot or pot payment request is final,
  their app calls `/api/notify` with the transaction hash, or, for a request
  to a person, with its signed proof. The server reads the receipt at the
  finalized block and works out who is affected from the events alone
  (`Transfer` of the dollar or CTK, `Funded`, `Proposed`, `PotCreated`),
  never from what the app says. Unknown, unfinished, failed or older than 15
  minutes: ignored. Each is handled once per server instance, and calls are
  rate limited per account.
* **If the sender's app closes before it calls `/api/notify`, that push is
  missed.** The bell in the app still shows it, from the app's own reads.
* **iPhone**: notifications come only once NivPay is added to the Home Screen,
  on iOS 16.4 or later. The Notifications screen says so and shows the
  install steps.
* **Tapping a notification opens the right screen**: Receive, the pot, the
  request waiting for your yes, an Auto cash out's statement, or the bell.
* **The words come from the app's dictionaries.** The build puts each
  language's notification texts into `sw.js` (`sw-build.ts`); a push carries
  only the kind, the phone's language, the pot's number and name, and an
  amount if allowed. An Auto cash out's also carries the bank's name and last
  4 digits, the currency and the move's transaction for its statement, and
  what the bank got only if amounts are allowed.
* **Hidden until `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` and a
  Blob store are set.** The private key lives only in Vercel's settings.

## History

Home has a History card, folded or open as the person left it on this phone
(`app/src/lib/history.ts`, `app/src/screens/History.tsx`). It lists every
finalized movement of the account's money that this phone has followed,
newest first, five at a time: money sent to or received from a person, sent
or received in another currency, Add money and Cash out through the test
desk, test dollars, money put into a pot and money paid out of one. What
each was is read from who was on the other side of the dollar's Transfer:
a pot, the desk, Agora's settlement pair, the faucet, or a person. Opening an
entry shows when, how much, who (by contact name, @username, or the end of
their account), the pot, what the other person got in another currency, and
the receipt; the pot and the other currency are read from that one receipt
when the entry is opened. The transfers come from the same finalized reads
the bell uses, in and, for History, out, so History starts when this phone
first ran them, and says so.

## Pots, each in two lines

On the Pots tab each pot is its name and what it holds, then the last thing
that happened in it and how long ago ("Ubong put in $50 · 2h ago", "Asked to
pay Caterer $600 · yesterday", "Closed · your share is ready"), with Live, or
"Needs your yes" when a request waits for this account
(`app/src/lib/potLast.ts`). The last event comes from the pot's own
finalized events, the ones its screen reads; each is remembered per pot, so
the list shows it at once and updates quietly. A pot whose events this phone
hasn't read yet shows only what it holds. New pots that name you read "Made
by account ending 7bC1 · 1h ago".

## Get help: what came back from each send

Each time this phone broadcasts a request, the node's answer is kept: the
time, the transaction hash, and a short result ("accepted", or "refused" or
"no answer" with the first line of the reason). The last 5 per account are
shown under Get help in plain words (taken, turned down, no answer), and go
into the support message, in full, only with "include my Account ID" ticked,
since a transaction leads to the account. A record only: `writes.ts` hands
each answer to a recorder set at start and never reads it back, so sending,
retrying and nonces work exactly as before (`writes.answers.test.ts` runs
every case with and without a recorder, and with one that throws, and gets
the same calls and outcome). Nothing secret is kept, not even the raw
transaction. This is what tells a dropped request (Code 51: accepted, then
never included) from a refused one (Code 56).

## Voice commands

A microphone on Send and on a pot's screen (`app/src/lib/voice.ts`,
`app/src/screens/Voice.tsx`). It listens after a tap, or after "Hey NivPay"
when that is turned on (next section), for one sentence, then stops. Nothing
listens in the background.

* **The browser's speech recognition**, where the browser has it; elsewhere
  the button is hidden. Before the first use the app says plainly that the
  phone's speech service (Google on Android, Apple on iPhone) turns the words
  into text; NivPay gets only the text. `Permissions-Policy` allows
  `microphone=(self)` and nothing wider.
* **Two commands, in English**, from a pure, tested parser: "send 100 dollars
  to Mum" (or "100 USD", "$100", "a hundred and fifty") and "put 50 into
  Mama's 60th". Anything else is "I didn't catch that", with examples. The
  button is hidden in French, Spanish and Portuguese until their parsers are
  tested.
* **Who voice can pay**: only a contact marked "Trusted for voice" in
  Profile, Voice, and only once this phone has seen 10 final payments with
  that person, sent to them or received from them, including at least one
  paid to them (the remembered pair). Until then the contact shows "x of 10
  payments together" and can't be marked. Pots: only ones the person is
  already in. The spoken name is matched against those contacts only; when
  two names are close, both are shown to pick from.
* **Safety.** A tap on the microphone only fills in the screen. Send's confirm sheet reads back
  the words heard, the amount and the person, and the fingerprint is still
  needed every time; on a pot, the same read-back sits above the button, and
  the fingerprint follows it. The daily limit applies, and each voice payment
  is at most $200 (Code 68), even if the amount is changed afterwards. Voice
  has no command to change settings or limits, add contacts or mark them
  trusted, or say yes to a pot's payment. After "Hey NivPay", the same rules
  hold, read back aloud instead of on a filled in screen (below).

## Hey NivPay

Hands free, on top of voice commands, with every voice rule kept: only
contacts trusted for voice, 10 payments together first, at most $200, the
read back, and a fingerprint for every payment. "Hey NivPay" only does what a
tap on the microphone does; what is said next goes through the same checks
(`app/src/lib/wake/`, `app/src/screens/Wake.tsx`, `app/src/lib/voiceAsk.ts`).

* **Off by default**: "Listen for “Hey NivPay”" in Profile, Voice, under
  voice commands, which must be on first. Hidden in other languages, like the
  rest of voice, and where the browser can't hear it on the phone.
* **Heard on the phone, only while the app is open.** The wake word is found
  in the page itself; no sound leaves the phone until it is heard. Then a
  chime and a short buzz (where the phone can buzz), the wake word lets the
  microphone go, and the phone's speech service hears one sentence, as after
  a tap. The two never share the microphone, and listening comes back once
  the payment is done or dropped.
* **Hands free** (`app/src/screens/VoicePay.tsx`, `app/src/lib/voicePay.ts`):
  no screen opens. A sheet over the screen that is open shows and says each
  step. The sentence goes through voice's rules (a trusted contact, at most
  $200, two close names shown to pick from) and every check Send makes before
  its confirm sheet (balance at finalized, not a contract, the daily limit,
  a transfer the dollar would refuse). Then it says "Send $20 to Ana? Say yes
  or no." and listens. Only a whole yes ("yes", "yeah, send it") pays; any no
  or stop cancels; anything else is asked once more, then nothing is sent.
  Yes and No are buttons too. The daily limit is checked again, then one
  fingerprint signs the same write Send makes (`sendWrite`, labelled as
  Send's, so a payment cut off by a reload is picked up on Send), and "Done"
  is said only at Finalized. Where the phone wants a tap before the
  fingerprint (Safari on iPhone), one big Confirm with your fingerprint button
  shows; nothing was sent before it. On a pot's screen, its own microphone
  button listens instead, for putting money in, as before. A ?voice=1 link
  still opens Send, listening.
* **Always shown.** Whenever the microphone is on for it, the pot mark at the
  bottom glows: the tab bar's Pots mark, or the mark on its own at the bottom
  of a screen with no tab bar; screen readers hear "Listening for “Hey
  NivPay”". It stops when the app goes to the background or the screen
  locks, after 5 minutes without a tap, key or wake, if the microphone is
  taken away, or with the switch in Profile, Voice, and a bar across the top
  says which, with Listen again. A browser that wants a tap before it plays sound
  gets a Start button.
* **Never under a confirm sheet**: while Send's confirm sheet, or a sheet over
  a pot's amount, is open, a wake changes nothing on it; the hands free sheet
  opens over it and keeps the wake word paused while it listens, asks or
  signs.
* **English only**, like the rest of voice.

### The engine, and why this one

| | Picovoice Porcupine Web | openWakeWord's design, in the page (chosen) |
| --- | --- | --- |
| Accuracy | the best published, with a phrase trained in Picovoice's console | good; it depends on the phrase's training, measured below |
| Licence | proprietary; its free tier was reported ended on 30 June 2026, so a paid plan | code Apache-2.0, Google's speech embedding Apache-2.0; its ready made wake words are non-commercial (CC BY-NC-SA 4.0), so none is used |
| Cost and keys | a paid plan, and an AccessKey in the page that Picovoice's servers check | none |
| What the page needs | WebAssembly (`'wasm-unsafe-eval'` in the CSP) and a `connect-src` for the key check | nothing new |

openWakeWord's design is written out in plain TypeScript
(`app/src/lib/wake/engine.ts`): a mel spectrogram (librosa's filters, worked
out in code), Google's speech embedding (96 numbers every 80 ms from the last
0.76 s; its 20 layers are streamed, so each is worked out once per new row)
and a small classifier, trained for this app, on the last 1.28 s. A wake is 3
scores in a row at 0.6 or more, then 2 s before the next. No WebAssembly, no
account and no key, so no environment variable and nothing to hide the switch
behind. The weights are one file, `app/public/wake/hey-nivpay-v1.bin`
(2.1 MB), fetched only when listening is on and kept by the service worker.
The engine gives openWakeWord's own numbers, checked frame by frame in
`engine.test.ts`; openWakeWord's embedding file matches the official
`embedding_model.tflite` that Home Assistant's `wyoming-openwakeword` ships.
Listening used about 9% of one core in headless Chromium on the test
machine (0.3% with it off).

`Permissions-Policy` is unchanged: `microphone=(self)` was already there for
voice commands, and nothing wider is needed. The Content Security Policy is
unchanged too: the audio worklet (`app/public/wake/capture.js`) and the
weights are this site's own files.

### Training, and how well it hears

The classifier is trained only on speech made for it, so nothing with a
non-commercial licence goes into it (`app/scripts/wake/`, reproducible from
npm and PyPI). Kokoro-82M (Apache-2.0) said "Hey NivPay" 4,200 times in 46
voices (American and British English, English with Spanish, French, Hindi,
Italian, Portuguese, Japanese and Chinese accents) and mixes of them, at
different speeds and in several ways ("Hey, NivPay!", run together, without
the h). It also said 93 phrases that sound alike ("hey Nick, pay", "hey
Venmo", "navy pay", "hey Siri", "NivPay" without "hey") 3,720 times, and 4,800
ordinary sentences. Each was put in a scene: other people talking before and
after, rooms, phone microphone bands, levels, and noise (hum, babble, music,
hiss) 3 to 30 dB below the voice.

Measured on 8 of Kokoro's voices it never trained on (`evaluate.py`):

| | |
| --- | --- |
| "Hey NivPay" heard, quiet room | 98.9% of 566 |
| heard, everyday room (reverb, phone band, noise 3 to 30 dB down) | 91.0% |
| heard, noise 5 dB below the voice | 85.2% |
| false wakes, 105 similar phrases (840 clips) | 3.3% |
| false wakes, ordinary talk (1,800 sentences, 111 min) | 1.1 an hour (2) |
| false wakes, noise and babble (40 min) | none |

83 of the 105 similar phrases never woke it. The ones that sometimes do are
the closest: "hey, did Niv pay" and "hey, Liv paid" (3 times in 8), "hey,
need pay" and "hey Liv, pay" (2 in 8), and 18 others once in 8, such as "hey
NetPay", "hey Nick, pay" and "open NivPay". A false wake only listens for
one sentence; nothing is paid without a trusted contact, the spoken read back,
a yes and a fingerprint. These are synthetic voices: real people, accents and rooms
will differ.

### Open NivPay ready to listen: ?voice=1, Siri and Google

`https://nivpay.vercel.app/?voice=1` opens Send with the microphone ready,
when voice is on. If the microphone is already allowed, it listens at once;
if the browser must ask, or wants a tap first, Send shows one big Tap to
speak button. With voice off, Home says how to turn it on. `voice=1` leaves
the address bar at once, so a reload doesn't listen again; opened before an
account is open, it waits for one.

Profile, Voice has short guides, each with a Copy link button:

* **Hey Siri (iPhone):** a Shortcut with one action, Open URLs, and the link.
  It opens in Safari, which keeps its own NivPay apart from the app on the
  Home Screen, so voice and who it can pay are set up there too; the guide
  says so.
* **Hey Google (Android):** install NivPay from Chrome, then "Hey Google, open
  NivPay", then "Hey NivPay" with listening on; or touch and hold the NivPay
  icon and tap Speak (a shortcut in `manifest.webmanifest` to the same link).

### Tested

* `engine.test.ts`: the TypeScript engine against openWakeWord's front end in
  Python, frame by frame, on a recorded "Hey NivPay"; it wakes on that
  recording once, and not on recorded similar words ("navy pay", "NivPay"
  alone, "hey Siri", "hey Niv", "hey Kev, pay"...), talk, silence or hiss
  (`app/src/lib/wake/testdata/`, voices it never trained on).
* `session.test.ts`: when the microphone is on, the wake, the background, the
  5 minutes, a refused or lost microphone, a stop while starting, and sharing
  the microphone with the button; `voiceAsk.test.ts`, `resample.test.ts`, and
  `voice.test.ts` for the switch.
* `app/scripts/wake/browser-check.mjs`: the built app in Chromium on
  localhost under the real headers, with recordings as the microphone: the
  wake, chime, buzz, hand over and the voice rules after it; no wake in 60 s
  of similar words or 90 s of talk (the closest phrases are counted, not
  failed: about 1 in 10, 1 and 3 of 32 in two runs); the background and 5 idle minutes; `?voice=1` three ways;
  the switch and guides; no CSP or Trusted Types violation.

**Needs a real phone**: how well it hears real voices, accents and phone
microphones; whether the microphone and sound start without a tap when the
app opens (Android installed app, iPhone Safari and Home Screen app), and
whether the speech service listens after a wake without one (if not, Tap to
speak shows); the chime's loudness and the buzz (iPhones don't buzz for web
pages); that leaving the app or locking the screen turns the phone's own
microphone light off; battery over a few 5 minute sessions; Bluetooth
headsets; the Siri Shortcut, "Hey Google, open NivPay" and the Speak shortcut.

## The pot map, on the world

A pot's map shows the world as the demo film does: a teal sea, sand land,
each person at their city in a box with their name, a route from there into
the pot, and the payees on the right. Where someone is comes from the city
they shared with the pot (opt in, encrypted for the pot's link,
`lib/cityShare.ts`), else the city written in the pot's link, else the time
zone their phone gave when they joined; never a position. This holds on
every screen with a map: the pot, closing, a payment asked, and the story. A
city's place is looked up on the phone in a bundled list of cities of 100,000
people or more, loaded only when a map needs it, and when someone's city
isn't there (a town they picked, or the one Use my location found), in the
full list of 34,163 cities of 15,000 or more that a city is chosen from, so
they sit at their own town, not at their time zone's city. A shared city
carries its country and is only looked for in it: Lagos in Portugal is never
put in Nigeria. The world is scaled and moved so
everyone placed is on the map and clear of the pot and payees, and each
label takes the side of its dot that covers least (`lib/worldmap.ts`).
Someone with no known place sits in one of the map's usual spots, not
somewhere they may not be.

The world can be moved by hand under the pot, which stays put: dragged with
a finger or the mouse, round the world east and west as on a globe, and
zoomed with two fingers, a double tap, Ctrl and the wheel, or the − and +
buttons under the pot's amount, from the whole world in to two cities in one
country, so people in one country come apart. Each person stays at their
city as it moves; one the pot covers, or past the map's edge, is hidden, and
their route still points the way. The button beside them goes back to the
map that frames everyone. Up and down on the map still scrolls the page
until it is zoomed in.

## Display names

The name shown at the top of Home and on Profile is the person's display
name, never their username (the username shows only on Profile and where
people pay them). Profile has a Display name row above Username; it and
Change name open the same screen: one field, up to 40 characters, cleaned
like every name (`cleanName`), and Save.

The name is saved on the phone at once. Where the site keeps names
(`/api/name`, on when a Blob store is connected), it is also kept for every
phone the account signs in on, proved like a photo: the passkey signs a
short message naming the account, a SHA-256 of the name and the time, one
fingerprint. The server checks the signature and that the name is already
clean, and stores it private; `GET /api/name/<account>` returns it, so
anyone with the Account ID can read it, as with a photo. When the account
signs in, the kept name wins, unless this phone has a newer one it couldn't
send yet (Code 88). With no name anywhere, Home asks "What should we call
you?" once. An `@username` that an earlier version kept in place of a name
is dropped.

## Profile photos

An account can add a photo in Account details: from the camera or the
gallery, through a file input, so the `camera=()` header stays. On the phone
the picture is read with `createImageBitmap`, cropped to a square, drawn at
256 by 256 on a canvas and saved as a JPEG of about 100 KB or less
(`app/src/lib/photo.ts`). Redrawing it drops everything hidden in the
original, such as where it was taken, and the preview is the canvas itself,
so `img-src` needs no `blob:`. Before the first upload the screen says:
"Anyone with your Account ID or username can see this photo."

Each upload and removal is proved by the account itself: its passkey signs a
short message naming the account, the image's SHA-256, the time and the site,
with one fingerprint (`app/src/lib/proof.ts`, through `withSigner`,
unchanged). `/api/photo` checks the signature belongs to that account, the
time is within 5 minutes and the hash matches the image; nobody can set or
remove another account's photo. It takes JPEG only, refuses bodies over
200 KB, checks the origin like `/api/fund`, and limits changes per minute.
Photos are stored private in Vercel Blob and served only through
`GET /api/photo/<account>`, so `img-src` stays `'self'`.

Photos show in Account details, Send, Receive, a pot's members, the pot map
and notifications; without one, initials. Someone else's photo can be tapped
and reported (`/api/report`, the same reasons as a pot); a reported photo
shows as initials on that phone from then on. **The feature stays hidden
until a Blob store is connected** (`BLOB_STORE_ID`, or `BLOB_READ_WRITE_TOKEN`).

## Where people in a pot are

City only, opt in, for the people in the same pot only. When someone chips
in, or the first time someone in a pot opens it with its link, the pot screen
offers "Show where you're chipping in from". The phone asks for its position
once, at low accuracy, and turns it into a city on the phone, from a world
cities list bundled with the app and loaded only when needed (GeoNames, cities
of 15,000 people or more, `app/src/data/cities.json`; `app/src/lib/cities.ts`).
No outside service is asked anything, and the position is forgotten at once.
The person can change the city, or pick one by hand without sharing their
position at all. It shows like "Houston, United States", the country in the
reader's language.

* **Never live, never exact, never on the chain.** No tracking in the
  background; no coordinates are stored or sent anywhere; nothing is written
  to the chain, which is permanent and public.
* **Only people with the pot's link can read the cities.** Each city is
  encrypted on the phone with a key derived from the pot link's fragment
  (`app/src/lib/cityShare.ts`), the part after `#`, which never reaches any
  server. `/api/city` stores only ciphertext it can't read. Someone who sees
  a pot on Home with no link has no key and sees no cities. This builds on
  how the pot map already got its cities: typed by the pot's maker into the
  signed link; a city shared this way takes the typed one's place.
* **Proved and removable.** Each share and removal is signed by the account's
  passkey, one fingerprint, like a photo; nobody can share or remove a city
  for someone else, and anyone can remove theirs from a pot at any time.
* The screen says: "Only people in this pot see your city. NivPay never
  tracks where you are." `Permissions-Policy` allows `geolocation=(self)` and
  nothing wider.
* Someone who answers an invite before the pot exists gets the offer when
  they first open the pot's link: before that there is no pot and no key.
* **Hidden until a Blob store is connected**, like photos.

## Languages

NivPay speaks English, French, Spanish and Portuguese. It uses the first
language in the phone's list that it has, or English, and follows the phone
when that list changes, unless the person picks one under Account details
("Language: phone's language", then the list). `<html lang>` follows too.
Every word lives in one dictionary per language under `app/src/i18n`, all
with the same keys; English is the source. Only the language in use is
downloaded.

**The translations were written by AI and have not been reviewed by native
speakers.** They need that review before anyone relies on them, above all the
texts about money (amounts, fees, what was sent and what wasn't) and about
closing a pot and taking a share out, where a wrong word can mislead someone
about their money. The app says so in Account details when a language other
than English is in use.

Tests fail if a language is missing a key, if a message takes different
values from the English one or drops one of them, or if any language uses a
banned word, in English or in its own words (`portefeuille`, `cartera`,
`carteira` for wallet, and so on: `app/src/i18n/banned.ts`).

**Amounts follow the reader, money safety first.** Before, an amount field
stripped commas, so in French "10,50" would have been read as $1,050. Now
every amount field reads the way the phone's region writes numbers
(`app/src/lib/locale.ts`): "10,50" is $10.50 in French, in Spain and in
Brazil, and 10.50 is how a Mexican phone writes it. Dollar fields take at most
2 decimals, groups must be groups of three, and anything ambiguous is refused,
never guessed: "1,000" in French is refused instead of read as $1, and
"10,50" in English is refused instead of read as $1,050. Under every amount
field the app shows what it understood ("That's $10.50."), before any confirm.
Amounts are shown the reader's way too ("1 050,00 $US" in French). Dates,
times and lists follow the language.

## Usernames for accounts

An account is a 42 character Account ID, and the names people see ("Idara",
"the caterer") are labels signed inside pot and request links: whoever made
the link signs the name together with the account it belongs to, and the app
shows it only in that link's context. A name is never looked up from, or
trusted because of, the account alone.

A username lets someone pay `@idara` without a link. It comes with two costs,
and the design answers each:

* **Squatting and impersonation.** Names are first come, first served.
  Someone can claim `@caterer`, or a name one letter away from a real
  person's. So names are strict (no look-alike letters from other
  alphabets), names close to NivPay's own are reserved, and the first payment
  to a name asks for the last 4 characters of the Account ID, as a pasted ID
  does.
* **A public name links an identity to a balance.** Anyone who resolves a
  name can read that account's balance and every payment it has made or
  received. So a username is opt in, never assigned, and every flow keeps
  working for people who never take one. The screen says so before a name is
  claimed.

**Status.** Live. The registry is deployed at
[`0x798f4a11c16C96561fE7834365420505542e280D`](https://testnet.monadvision.com/address/0x798f4a11c16C96561fE7834365420505542e280D)
(block 71,283,172, [Sourcify exact match](https://sourcify-api-monad.blockvision.org/v2/contract/10143/0x798f4a11c16C96561fE7834365420505542e280D)), set in
`app/src/lib/config.ts` (`NAMES`, with `NAMES_DEPLOY_BLOCK`). With `NAMES` set
to null the app hides every username feature and works exactly as before.

### What was built

1. **NivPayNames** (`src/NivPayNames.sol`), a new contract separate from
   NivPayPots, which stays exactly as deployed. It maps a username to an
   Account ID and back, one name per account. Only the account itself can
   claim, change or let go of its name: every write reads `msg.sender`, so
   nobody can point a name at someone else. There is no owner, no admin, no
   pause, no upgrade, no fee and no payable function.
   * `claim(name)` takes a name. If the caller already has one, the old name
     is released in the same call. `release()` gives it up.
   * Views: `accountOf(name)`, `nameOf(account)`, `availableAt(name)` (0 if
     free now, the end of its hold if recently released, never if held or
     not allowed) and `releasedBy(name)`.
   * Events: `NameClaimed(account, name)` and
     `NameReleased(account, name, availableAt)`.
2. **Strict names**, checked in the contract: 3 to 20 characters, only `a`
   to `z`, `0` to `9` and `_`, starting with a letter, no `__`, not ending in
   `_`. Reserved for good: `nivpay`, `support`, `help`, `admin`, `official`,
   `team`, `security`, `staff`, `agora`, `monad`, `mera`, and any name
   containing `nivpay`. The phone has the same rules in
   `app/src/lib/usernames.ts`, and both test suites read one file of sample
   names, `test/vectors/usernames.json`, so the two can never disagree.
3. **A 90 day hold.** A name that is let go, or left behind by a change,
   can't be claimed by anyone else for 90 days (`HOLD_PERIOD`), so it can't
   be taken over the moment it is released. The account that released it can
   take it back at any time.
4. **Choose a username, in Account details** (the Profile tab), beside the Account ID. As the
   person types, the screen says whether the name is available, taken, not
   allowed (and why), or free again on a given date. Before claiming it says
   plainly that anyone who knows the name can see this account's balance and
   payments, that letting the name go later doesn't erase payments already
   made, and that a name let go is held for 90 days. Claim, Change and Let go
   each take one fingerprint through the usual send flow, with a `username`
   write label so a reload picks a change in flight back up. The name shows
   only once the change is final.
5. **Paying `@idara`.** Send to takes a username as well as an Account ID.
   The phone looks the name up at the finalized block. The first payment to
   a name asks for the last 4 characters of the Account ID, which the person
   gets from the payee, as with a pasted ID; only once they match does the
   screen show "@idara, account ending 7bC1". When a payment to the name is
   final, the pair (name and account) is remembered on this phone and not
   asked about again. If the name later points at a different account, the
   payment stops before anything is signed: "@idara belongs to a different
   account than the one you paid before. Nothing was sent." The name is
   checked again right before signing. The first time and name clash
   warnings from [Protecting people from bad actors](#protecting-people-from-bad-actors)
   still apply.
6. **Names in pots stay signed.** A username shows beside a name, as
   "Idara (@idara)", in Who controls this pot, payment requests, the pot's
   story and Receive; never in place of it. A pot's payees stay fixed Account
   IDs: a username can never change who a pot can pay. Receive shows "Your
   username: @eddy".
7. **A name that comes back from the passkey.** When an account signs in on
   a phone with no name for it (a new phone, or cleared site data), the app
   reads its username and uses it as the name, instead of asking.

Every read is at the finalized block, and names are read in batches through
Multicall3, as discovery reads pots.

### NivPayNames, each claim and the line that proves it

Checked against `src/NivPayNames.sol` at this commit.

| Claim | Where |
| --- | --- |
| No owner or admin, no roles, nothing imported | the contract imports nothing; no `owner`, `Ownable` or `AccessControl` anywhere |
| Nothing can be set after deploy | the only constants are `MIN_LENGTH` 3, `MAX_LENGTH` 20 (30 to 31) and `HOLD_PERIOD` 90 days (35); there is no setter, no pause, no `delegatecall`, no assembly, no `payable` function, no `receive` or `fallback` |
| Only an account changes its own name | a name is written only for `msg.sender`: set in `claim` (85 to 86), released by `_release(msg.sender)` from `claim` (83) and `release` (95) |
| A name someone holds can't be taken | `claim` refuses a held name (79) |
| The rules are checked on chain | `claim` refuses a name that breaks them (74) or is reserved (75); the rules are `isWellFormed` (144) and `isReserved` (162), reserving any name containing `nivpay` (169) |
| One name per account | claiming a second releases the first in the same call (83) |
| A released name is held for 90 days | `_release` holds it until now plus `HOLD_PERIOD` (101) for the account that released it (104); `claim` refuses anyone else until then (81) |

Four deliberate bugs were run against the names suite before this was
written, each reverted after: removing the hold, holding a name against the
account that released it, allowing a trailing `_`, and letting a held name
be claimed. Each failed two or three tests.

### Disputes, and squatting: decisions before mainnet

**Disputes are the open question.** A registry with no admin can't take a
name back from a squatter; one with an admin adds a party who can move names.
NivPayNames has no admin, relying on the last 4 check and the remembered
pairing, and this is revisited before mainnet.

**Squatting is a decision to make before mainnet.** On testnet a name costs
only the gas to claim it, so one person can claim many. Options: a small
refundable deposit to claim a name, returned when it is let go, which makes
holding hundreds of names cost something without charging honest users; a
limit per account is already there (one name each), but accounts are free to
make. Whatever is chosen has to keep the registry free of an admin, or say
plainly who the admin is.

## Tests

```powershell
forge test
```

192 test cases, all passing on 15 Oct 2026 with none skipped. The faucet test
skips only when Agora's public faucet is out of stock (see below). The fork tests need network access; the rest
do not.

| Suite | What it covers |
| --- | --- |
| `test/Mama60.t.sol` | the reference scenario, exact balances |
| `test/PotsCore.t.sol` | creation, funding, permit funding, exits, claims, views |
| `test/PotsGovernance.t.sol` | proposals, payouts, caps, freeze, close, fees |
| `test/PotsSecurity.t.sol` | asset freezing, reentrancy, donations, pot isolation, lost keys |
| `test/PotsFuzz.t.sol` | funding amounts, join and exit order, payout sizes, fee settings, rounding direction |
| `test/PotsInvariant.t.sol` | invariants and ten adversarial attack categories |
| `test/PotsFork.t.sol` | the whole lifecycle against real AUSD on Monad testnet |
| `test/NivPayTestDollar.t.sol` | the TESTUSD test token: metadata, open mint, the per call mint cap, permit, refusal of every non test chain |
| `test/NamesCore.t.sol` | NivPayNames: every name rule, reserved names, claim, change, release, the 90 day hold and taking a name back, only an account changing its own name; reads `test/vectors/usernames.json`, as the app's tests do |
| `test/NamesFuzz.t.sol` | NivPayNames: the name check against a reference written separately, on random input and on any bytes |
| `test/NamesInvariant.t.sol` | NivPayNames: `accountOf(nameOf(a)) == a` for every holder, at most one holder per name, only an account changing its own name, a held name taken only by its releaser |

### Invariants

Over 24,576 calls per run, across 256 runs:

* the contract's token balance always covers every pot's assets plus uncollected fees, exactly
* per pot, `funded == paid out + fees + exited + claimed + remaining`
* no address outside a pot's destination list ever receives a payout
* no payout ever executes below the threshold
* destination caps are never exceeded
* one funder's fund or exit never costs another funder more than one unit of rounding
* exits always succeed for holders, in every pot state, freeze included
* creation parameters never change

### Adversarial invariants

An earlier version of the invariant suite reported **zero reverts** across every
call. That is not the reassurance it looks like. It meant the handler had only
ever attempted things the contract permits, so every security invariant held
trivially: the suite proved that legal behaviour is legal.

There is now an **attacker** actor, which is an approver of nothing and a
destination of nothing. It attempts ten categories of thing the contract is
supposed to refuse. Each attempt is recorded and then checked: either the call
reverted, or it was allowed to run and changed nothing it was not entitled to
change. Anything else is a breach and fails the run.

| # | What is attempted | Attempts per run | Refused | Harmless |
| --- | --- | --- | --- | --- |
| 0 | proposing as a non approver | 18 | 18 | 0 |
| 1 | a payout aimed outside the destination list | 18 | 12 | 6 |
| 2 | a payout above a destination's remaining cap | 6 | 6 | 0 |
| 3 | the same approver approving twice | 12 | 6 | 6 |
| 4 | approving a cancelled or expired proposal | 12 | 12 | 0 |
| 5 | unfreezing alone when the threshold is two | 12 | 6 | 6 |
| 6 | closing early alone when the threshold is two | 18 | 12 | 6 |
| 7 | exiting more shares than the caller holds | 36 | 36 | 0 |
| 8 | funding a pot that is closed or frozen | 18 | 18 | 0 |
| 9 | spending one pot's shares against another pot | 6 | 6 | 0 |
| | **total** | **156** | **132** | **24** |

**Succeeded: 0.** The "harmless" column is not a weaker result. Some of these
attempts are legal calls that simply must not achieve the thing being attempted:
proposing an unfreeze alone is allowed, and it must leave the pot frozen;
revoking and approving again is allowed, and it must not stack into a second
approval.

Two things make the counts trustworthy rather than decorative:

* The attacks run as **one sweep** that performs all ten categories together, so
  no category can sit at zero merely because the fuzzer never picked its
  selector. The sweep is both a fuzzable action, so it lands on random states,
  and is run once more at the end of every run.
* `afterInvariant` **asserts that every category was attempted at least once**.
  A category dropping to zero fails the suite rather than passing quietly. This
  assertion has already caught two cases where a rule was silently untested: a
  run that closed every live pot starved the attacks that need an open one, and
  the cross pot attack was skipping whenever its chosen pot happened to be
  frozen. A pot reserved for the attacker fixed the first, and seeking out a pot
  the attacker actually holds shares in fixed the second.

Foundry's own revert counter stays low because the attacks catch their own
reverts in order to count them, so the `blocked` ghost variables are the real
measure, not `reverts:` in the run summary.

### Before deploying NivPayPotsV2

Every check below was run on the final source (the one the staging copy
runs), on 17 Oct 2026:

* **Deep runs.** `$env:FOUNDRY_PROFILE = "deep"; forge test --force`: ten
  times the usual runs, at the same depth. Fuzz 5,120 runs each, invariants
  2,560 runs at depth 96 (about 246,000 calls each). **424 tests passed, 0
  failed**, in 20.5 minutes, the live testnet fork tests included.
* **Coverage** of `src/NivPayPotsV2.sol` (the `forge coverage` command below):
  **100% of lines and functions, 141 of 143 branches.** The two left are
  V1's two unreachable guards, explained below; every new branch is covered.
* **Static analysis**: Slither, below. None High; both Mediums false
  positives; three findings fixed in the source.
* **Mutation testing**: 48 mutants of the new rules, all killed, below.
* **Real AUSD**: `test/PotsForkV2.t.sol` forks Monad testnet: a pot made,
  money in, a payment, a raise proposed and agreed, a payment past the old
  limit refused during the window, someone taking their part out a day in,
  the change refused one second early and applied at 72 hours by someone
  who doesn't decide, the bigger payment, and every unit accounted for.
* **Live staging run**, on a staging copy with 5 minute windows, in the real
  app with throwaway accounts: see the staging section under Deploying the
  contracts.
* **Independent review.** A separate agent, which had not seen this work,
  reviewed `NivPayPotsV2.sol` and its tests three times, looking for a way to
  pay someone not agreed, block an exit, or apply a change early. Round 1
  found nothing above Low and three Lows: one decider could take every open
  place (now at most 2 each), a raise agreed before a lowering could undo it
  (a narrowing now ends it), and a change that could never apply could still
  be agreed and announced (now refused). Round 2 found one more Low, a pot
  closing exactly as a wait ended, now refused too. Round 3 found nothing.
  What it left as by design is in the rules above.

### Mutation testing

A passing suite proves nothing about a suite's ability to fail. Six deliberate
bugs were introduced one at a time on a scratch branch, each run against the
full product suite, then reverted. No mutant was ever committed and the branch
was deleted.

| Mutant | Result | Caught by |
| --- | --- | --- |
| 1. execute payouts at threshold minus one | killed, **52** tests failed | the whole governance and Mama's 60th suite, plus two fuzz tests |
| 2. skip the destination cap check | killed, 4 tests failed | `test_payout_revertsAboveTheDestinationCap`, `test_payout_capIsLifetimeNotPerPayout`, `testFuzz_capIsNeverExceeded`, and the invariant run |
| 3. count a repeat approval from the same approver | killed, 2 tests failed | `test_approve_revertsWhenAlreadyApproved` and the invariant run |
| 4. remove the freeze check from funding | killed, 2 tests failed | `test_fund_revertsWhileFrozen`, and by name: `an attack succeeded: funding a closed or frozen pot` |
| 5. round redemption in the caller's favour | killed, 8 tests failed | both Mama's 60th tests, the fork test, `invariant_contractCoversAllPotAssetsPlusFees`, `invariant_exitsAlwaysSucceedForHolders`, `invariant_freezeNeverTrapsFunds`, two fuzz tests |
| 6. read pot value from the token balance | killed, **31** tests failed | both donation tests, every exit and claim test, five invariants, four fuzz tests |

Mutant 4 is the clearest evidence that the adversarial work was worth doing: it
was caught by the attack category added for exactly that rule, by name.

#### The one that nearly got away

"Round one share conversion in the caller's favour" has two call sites, and only
one of them was tested properly. Mutant 5 above is the redemption side, killed
by eight tests. The **minting** side, `_fund` rounding up instead of down, was
caught by **exactly one** assertion in one unit test, and the invariant suite
passed it clean across all 24,576 calls. One hand written assertion was the only
thing standing between that bug and production.

Worse, the first fix did not work. A fuzz test was added asserting that
`previewFund` rounds down, and it **passed against the mutant**: `previewFund`
and `_fund` are separate call sites into the same conversion, so a preview based
assertion cannot see a rounding change on the real path at all. That is a
general trap, and it is now written into the test file so nobody repeats it.

What kills it:

* `testFuzz_mintingRoundsToThePot` and `testFuzz_redeemingRoundsToThePot`, which
  assert on what `fund` and `exit` **actually return**, against share counts
  recomputed independently from the pot's reported totals.
* `invariant_conversionsAlwaysRoundToThePot`, backed by the handler checking the
  value returned by every fund and exit it was already making. Recording a
  violation in a ghost variable rather than asserting inside the handler matters:
  `fail_on_revert` is off, so an assertion failure inside a handler action would
  have been swallowed.

Both mutants now die by both routes.

#### NivPayPotsV2's new rules

Every new rule broken on purpose, one at a time: 48 mutants, each run
against the V2 suites (`test/PotsChanges*.t.sol` and
`test/DeployPotsV2.t.sol`) with `forge test --force`, then reverted. None
was committed. **All 48 are killed.**

The forced rebuild matters. Tests deploy the contract from the build folder,
and without `--force` a mutant's run was once seen to use the previous
mutant's build. That is also how the run found that V1's three constructor
tests (`test_constructor_reverts*`) had never been able to fail: `new` runs
here as a cheatcode, so `vm.expectRevert` before it doesn't watch the
constructor itself. They now go through an external call
(`PotsTestBase.newPotsCall`), and deleting the fee check now fails
`test_constructor_revertsAboveMaxFeeBps`, as it should have all along.

| Mutant | Result | Caught by |
| --- | --- | --- |
| 1. apply a widening change inside its exit window | killed, 8 | `invariant_noWideningBeforeItsWindow`, `invariant_onlyThePotsOwnDecidersAndNoUndoing` and 6 more |
| 2. the window one second short | killed, 3 | `test_widening_lapsesSevenDaysAfterItsWait`, `test_widening_theWaitIsFromTheYesThatAgreedIt` and 1 more |
| 3. ignore the exit window given at deployment | killed, 9 | `test_constants`, `test_theRealDeploymentAppliesForSevenDays` and 7 more |
| 4. accept a window below the minimum | killed, 1 | `test_theWindowIsBounded` |
| 5. accept a window above the maximum | killed, 1 | `test_theWindowIsBounded` |
| 6. ignore the apply period given at deployment | killed, 8 | `test_constants`, `test_lapsed_onceRecordedStaysLapsed` and 6 more |
| 7. accept an apply period below the minimum | killed, 1 | `test_theApplyPeriodIsBounded` |
| 8. accept an apply period above the maximum | killed, 1 | `test_theApplyPeriodIsBounded` |
| 9. never let an agreed change lapse | killed, 4 | `test_lapsed_onceRecordedStaysLapsed`, `test_open_expiredAndLapsedFreeTheirPlaces` and 2 more |
| 10. lapse a second early | killed, 1 | `test_widening_lapsesSevenDaysAfterItsWait` |
| 11. let an unagreed change never expire | killed, 4 | `test_expired_neitherLapsesNorWithdraws`, `test_open_expiredAndLapsedFreeTheirPlaces` and 2 more |
| 12. treat raising a limit as narrowing, so it applies at once | killed, 17 | `test_agree_aWideningChangeThatCouldNeverApplyIsRefused`, `test_closed_byItsDateTakesNoChange` and 15 more |
| 13. treat lowering a limit as widening, so it waits | killed, 12 | `test_expiry_theLastSecondStillTakesAYes`, `test_handlerReachesEveryRule` and 10 more |
| 14. agree a change one yes short | killed, 2 | `test_revoke_takesAYesBack`, `test_yeses_aThreeOfThreePotNeedsAllThree` |
| 15. agree at proposal whatever the rule | killed, 50 | `test_addPayee_refusedOnceThePotHasTenPayees`, `test_add_whenTheLastPlaceWasTakenMeanwhileIsRefused` and 48 more |
| 16. count yeses after a change is agreed, restarting its wait | killed, 1 | `test_noYesCountsOnceAgreed` |
| 17. count the same decider's yes twice | killed, 1 | `test_approve_onlyDecidersAndOnlyOnce` |
| 18. take back a yes after agreement | killed, 1 | `test_noYesCountsOnceAgreed` |
| 19. take back a yes without lowering the count | killed, 3 | `invariant_yesCountsAreTheYeses`, `test_events_proposedAndEachYes` and 1 more |
| 20. let a non-decider propose a change | killed, 5 | `invariant_onlyThePotsOwnDecidersAndNoUndoing`, `invariant_potsAreExactlyWhatWasApplied` and 3 more |
| 21. let a non-decider say yes to a change | killed, 5 | `invariant_onlyThePotsOwnDecidersAndNoUndoing`, `invariant_potsAreExactlyWhatWasApplied` and 3 more |
| 22. take changes on a closed pot | killed, 2 | `invariant_closedPotsTakeNoChange`, `test_closed_takesNoChange` |
| 23. take a yes on a closed pot | killed, 2 | `invariant_closedPotsTakeNoChange`, `test_closed_takesNoChange` |
| 24. apply a change on a closed pot | killed, 2 | `test_closed_byItsDateTakesNoChange`, `test_closed_takesNoChange` |
| 25. apply a widening change while frozen | killed, 2 | `invariant_noWideningBeforeItsWindow`, `test_widening_notWhileFrozen` |
| 26. agree a widening change the close would beat | killed, 2 | `test_widening_agreedExactlyTooLateIsRefused`, `test_widening_thatTheCloseWouldBeatIsRefused` |
| 27. propose a widening change the close would beat | killed, 2 | `test_widening_closesExactlyWhenItWouldApplyIsRefused`, `test_widening_thatTheCloseWouldBeatIsRefused` |
| 28. agree one closing exactly at the wait's end | killed, 1 | `test_widening_agreedExactlyTooLateIsRefused` |
| 29. allow six open changes | killed, 2 | `test_open_agreedAndWaitingStillCounts`, `test_open_atMostFive` |
| 30. allow three from one decider | killed, 2 | `invariant_atMostTwoFromOneDecider`, `test_open_atMostTwoFromOneDecider` |
| 31. never free an expired change's place | killed, 3 | `test_expired_neitherLapsesNorWithdraws`, `test_open_expiredAndLapsedFreeTheirPlaces` and 1 more |
| 32. keep an applied change's place | killed, 5 | `test_addPayee_refusedOnceThePotHasTenPayees`, `test_add_whenTheLastPlaceWasTakenMeanwhileIsRefused` and 3 more |
| 33. keep a withdrawn change's place | killed, 2 | `test_open_atMostFive`, `test_open_atMostTwoFromOneDecider` |
| 34. let anyone withdraw a change | killed, 1 | `test_withdraw_onlyTheProposerAndOnlyWhileOpen` |
| 35. withdraw an applied change | killed, 5 | `test_expired_neitherLapsesNorWithdraws`, `test_lapsed_onceRecordedStaysLapsed` and 3 more |
| 36. lower a limit below what was paid when it applies | killed, 1 | `test_lower_thatNoLongerFitsWaitsForItsYes` |
| 37. lower a limit that no longer lowers | killed, 1 | `test_lower_thatWouldNowRaiseIsRefused` |
| 38. apply a raise that no longer raises | killed, 2 | `test_agree_aWideningChangeThatCouldNeverApplyIsRefused`, `test_raise_thatNoLongerRaisesIsRefused` |
| 39. apply a later close that is no longer later | killed, 1 | `test_laterClose_thatIsNoLongerLaterIsRefused` |
| 40. add an eleventh payee | killed, 1 | `test_add_whenTheLastPlaceWasTakenMeanwhileIsRefused` |
| 41. apply a raise to a payee removed meanwhile | killed, 1 | `test_remove_appliesAtOnceAndThePayeeIsPaidNothingMore` |
| 42. remove a payee in name only | killed, 7 | `invariant_paymentsOnlyUseWhatHadApplied`, `invariant_potsAreExactlyWhatWasApplied` and 5 more |
| 43. let a lowering leave an agreed raise standing | killed, 3 | `test_lower_endsEveryOpenRaiseOfThatPayeeOnly`, `test_raise_ofAPayeeRemovedMeanwhileIsOverridden` and 1 more |
| 44. let a lowering end raises of other payees too | killed, 2 | `test_lower_endsEveryOpenRaiseOfThatPayeeOnly`, `test_remove_endsEveryOpenChangeOfThatPayee` |
| 45. let a lowering end changes other than raises | killed, 1 | `test_lower_thatWouldNowRaiseIsRefused` |
| 46. pay a removed payee | killed, 1 | `test_pay_aPendingPaymentToAPayeeRemovedMeanwhileIsRefused` |
| 47. ask to pay a removed payee | killed, 1 | `test_remove_appliesAtOnceAndThePayeeIsPaidNothingMore` |
| 48. show a removed payee as payable | killed, 1 | `test_removedPayee_showsNothingLeft` |

### Coverage

```powershell
forge coverage --no-match-coverage "(test|script)" --no-match-path "test/PotsFork.t.sol" --ir-minimum
```

`src/NivPayPots.sol`: **99.59% lines, 99.35% statements, 97.10% branches,
100.00% functions.**

Two branches are deliberately unreached, and both are defensive guards that the
outer checks already make impossible:

1. `if (sharesMinted == 0) revert ZeroShares()` in `_fund`. Funding always mints
   at least one share, because the supply stays at roughly `10**DECIMALS_OFFSET`
   times pot assets: funding mints proportionally, and payouts only push the
   ratio higher by shrinking assets without burning shares.
   `test_fund_smallestFundingStillMintsAfterHeavySpending` pins the invariant
   that keeps it unreachable.
2. `if (pot.frozen) revert PotFrozen()` in `_executePayout`. Both
   `proposePayout` and `approve` already refuse while frozen, so execution never
   arrives with the freeze on. It stays so that a future caller of that function
   cannot skip the check by forgetting it.

Neither was removed to raise the number, and neither is suppressed.

### Static analysis

```powershell
python -m pip install slither-analyzer
python -m slither src/NivPayPots.sol --solc-remaps "@openzeppelin/contracts/=lib/openzeppelin-contracts/contracts/" --exclude-dependencies --checklist
```

Slither 0.11.6 reports **9 findings, all Low or Informational. No High and no
Medium.** Every one is listed here; none is suppressed and no
`slither-disable` comment appears anywhere in the source.

| # | Detector | Where | Assessment |
| --- | --- | --- | --- |
| 1 | `reentrancy-benign` | `fundWithPermit` writes state after calling `permit` | Not exploitable. The callee is the immutable AUSD token fixed at construction, and the function carries `nonReentrant`. Slither classes it benign because there is no read then write to exploit. The call has to come first: a permit is what creates the allowance the funding then spends. |
| 2 | `timestamp` | `createPot`, `endTime <= block.timestamp` | Inherent. A pot has an end time; it has to be compared against the clock. Nothing here is decided at second granularity. |
| 3 | `timestamp` | `approve`, proposal expiry | Inherent. The 7 day window is coarse enough that validator level timestamp drift cannot change an outcome. |
| 4 | `timestamp` | `closePot`, `block.timestamp < pot.endTime` | Inherent, same reasoning. |
| 5 | `timestamp` | `_isClosed` | Inherent, same reasoning. |
| 6 | `timestamp` | `_propose`, flagged on `p.approvals >= pot.threshold` | **False positive.** That comparison involves no timestamp at all. Slither attributes it to the function because `_propose` also reads `block.timestamp` when stamping `createdAt`. |
| 7 | `timestamp` | `proposalInfo`, expiry status | Inherent, and it is a view. |
| 8 | `pragma` | 0.8.28 here against OpenZeppelin's `^0.8.20` | Expected. Everything compiles under the single pinned 0.8.28. |
| 9 | `cyclomatic-complexity` | `createPot` scores 13 | Accepted. Every branch is one validation of one parameter that can never be changed afterwards. Splitting it would add indirection to the one function where the checks most deserve to be read in a single place. |

#### NivPayPotsV2

```powershell
python -m slither src/NivPayPotsV2.sol --solc-remaps "@openzeppelin/contracts/=lib/openzeppelin-contracts/contracts/" --exclude-dependencies --checklist
```

Three findings of the first run were changed in the source rather than
argued with: `changeInfo` now sets `appliesAt` and `lapsesAt` to 0 where it
declares them (`uninitialized-local`, twice; harmless, now explicit), and
`_widens` reads the kind's place in the enum instead of three equalities
(`incorrect-equality`). On the final source Slither 0.11.6 reports **20
findings: none High, and both Mediums are false positives.** None is
suppressed and no `slither-disable` comment appears in the source.

| # | Detector | Where | Assessment |
| --- | --- | --- | --- |
| 1, 2 | `incorrect-equality` (Medium) | `_dropOpen` (`open[i] == changeId`) and `_override` (`id == byChangeId`, `o.destIndex == index`) | **False positives.** The detector is about strict equality on a balance or a timestamp that someone could nudge; these compare change ids and payee indexes, which is the point of both functions. |
| 3 | `reentrancy-benign` (Low) | `fundWithPermit` | V1's, unchanged; see the table above. |
| 4 to 16 | `timestamp` (Low) | V1's six (`approve`, `createPot`, `closePot`, `_propose`, `proposalInfo`, `_isClosed`); `_changeStatus`, `_openChange` and `_agree`; `_widens`, `_openBy`, `_dropOpen` and `_override` | Inherent where time is read: a change's wait and lapse, and whether the pot closes before the wait ends, are judged against the block's time, coarse enough that validator drift changes nothing. `_widens`, `_openBy`, `_dropOpen` and `_override` read no time at all; Slither attributes it to them, as with V1's `_propose`. |
| 17 | `pragma` | 0.8.28 against OpenZeppelin's `^0.8.20` | Expected, as for V1. |
| 18 | `cyclomatic-complexity` | `createPot` | V1's, unchanged. |
| 19, 20 | `naming-convention` | `EXIT_WINDOW` and `APPLY_PERIOD`, immutables in capitals | Kept on purpose: they were constants, and keeping the names keeps the getters the app and the deploy script read. |

## Deploying the contracts

**All three contracts are deployed and verified on Monad testnet**; the
addresses are under [Contract addresses](#contract-addresses). The steps below are how they
were deployed, kept as the record and for redeploying elsewhere.

### Two instances

The same `NivPayPots` bytecode is deployed twice, once per token. The token is
an immutable constructor argument, so each instance is bound to its token for
ever and the two never share funds.

| Instance | Token | Script | What it is for |
| --- | --- | --- | --- |
| **AUSD** | AUSD, Agora's real six decimal stablecoin | `script/Deploy.s.sol` | the product. Real pots, real money on mainnet in due course |
| **TESTUSD** | NivPay Test Dollar, a worthless token anyone can mint | `script/DeployTestDollar.s.sol`, then `script/DeployTestDollarPots.s.sol` | trying the whole pot lifecycle on Monad testnet without waiting on Agora's faucet, which is often empty |

Both use identical fee settings. Everything else in this section, steps 1 to 5,
is the AUSD instance and is unchanged. The TESTUSD instance follows in
[The TESTUSD instance](#the-testusd-instance).

> **TESTUSD must never be deployed to a mainnet, Monad or any other.** It is
> not a stablecoin. Anyone can mint it, up to 100,000 TESTUSD per call and as
> many calls as they like, so it is worth nothing, and a pot holding it holds
> nothing. It is named *NivPay Test Dollar* with symbol `TESTUSD` precisely so
> it cannot be mistaken for AUSD or any real dollar.
> This is enforced in the contract, not only by convention: the
> `NivPayTestDollar` constructor reverts with `NotATestChain` on every chain id
> except `10143` (Monad testnet) and `31337` (local Anvil and Forge tests), and
> both TESTUSD scripts also refuse any chain but `10143`. Do not remove either
> guard.

### Toolchain

Built and tested on **Foundry 1.8.3** with `network = "monad"`, so the gas
model, opcode pricing, transaction rules, precompiles and contract size limits
are Monad's, not Ethereum's. Monad's docs require v1.8.0 or later for this.

No Monad specific Foundry build exists or is needed: `foundryup`'s `--network`
flag is now documented as *"Deprecated and ignored; installs the regular
Foundry release"*.

```powershell
foundryup --install latest
forge --version          # must report 1.8.0 or later
```

### Profiles

| Profile | Rules | Runs | Why |
| --- | --- | --- | --- |
| `default` | Monad | the product suite, 256 invariant runs | **the one to run before a deploy** |
| `quick` | Monad | the same suite, 24 invariant runs | everyday work |
| `bench` | Ethereum | the retired streaming benchmark only | see below |
| `deploy` | Monad | the deployment script | keeps test settings away from a broadcast |

### Which to run when

```powershell
# Everyday, while changing things. Same tests, same Monad rules, seconds.
$env:FOUNDRY_PROFILE = "quick"; forge test

# Before a deploy, and before trusting anything. Several minutes.
Remove-Item Env:\FOUNDRY_PROFILE -ErrorAction SilentlyContinue
forge test

# The retired benchmark, under the Ethereum rules it was measured on.
$env:FOUNDRY_PROFILE = "bench"; forge test
```

`quick` runs **every test the default profile runs**, all 11 suites and the same
192 cases, under the same Monad execution rules and the same invariant depth.
The only difference is 24 invariant runs instead of 256, which takes the suite
from around ten minutes to around twelve seconds.

That is a narrower search, not a weaker one, and it is **not sufficient before a
deploy**: the invariant campaign is where the accounting bugs surface, and 2,304
calls explore far less than 24,576. The thorough setting is deliberately the
**default**, so under-testing has to be asked for rather than happening because
somebody forgot to pass a flag.

> If `forge test` ever reports fewer suites than you expect, run
> `forge build --force` first. Switching between profiles can leave the
> incremental build cache in a state where a suite compiles but its tests are
> not discovered, and it fails silently rather than erroring. This bit during
> development: a whole fuzz suite quietly stopped running under both profiles,
> and a forced rebuild restored it.

The retired benchmark is isolated rather than accommodated. Its N = 10000
measurements deliberately exceed Monad's 150,000,000 block gas limit, which was
part of its point, so under Monad rules its gas sweep fails with
`MemoryLimitOOG`. It keeps the Ethereum rules and the enormous gas ceiling it
was always measured under, in its own profile. **Nothing in the product profile
was weakened to let it run.**

### Network

| | |
| --- | --- |
| Network | Monad testnet |
| Chain id | `10143` |
| RPC | `https://testnet-rpc.monad.xyz` |
| AUSD | `0xa9012a055bd4e0eDfF8Ce09f960291C09D5322dC` |
| AUSD faucet | `0xd236c18D274E54FAccC3dd9DDA4b27965a73ee6C` |
| TESTUSD | `0x9FD60818e0DFee982d677cd72FbC3601Cc2eB6f7` |

### Why the gas estimate multiplier is low

Monad's docs are explicit: *"the gas charged for a transaction is the gas limit
set in the transaction, rather than the gas used in the course of execution."*
It is a consequence of asynchronous execution: leaders build blocks before
executing them, so charging `gas_used` would let a transaction reserve a large
share of the block gas limit while paying almost nothing for it, which is a
denial of service vector.

Forge's default gas estimate multiplier is **130 percent**. On Ethereum the
unused 30 percent is refunded. **On Monad it is simply paid.**

There is **no `foundry.toml` key for this**. An earlier revision of this
repository set `gas_estimate_multiplier` in the deploy profile, and forge
reported `Found unknown gas_estimate_multiplier config`, meaning it was
silently doing nothing. It is a command line flag only, so every deployment
command below passes `-g 105`, which keeps a little headroom for estimation
drift without buying headroom that is never used.

### 1. Create the encrypted keystore

The deployer keystore is named **`nivpay-deployer`**, and every command below
refers to it by that name. Run these yourself, in your own terminal.

Create the key with `cast wallet new`, giving it the keystore directory and the
name. It generates the key, prompts for a password without echoing it, and
writes only an encrypted keystore file. It prints the file's path and the
address, and **never displays the private key**, so the key never appears on
screen, in your PowerShell history or in any file in this repository.

```powershell
# cast wallet new refuses a directory that does not exist yet.
New-Item -ItemType Directory -Force "$HOME\.foundry\keystores" | Out-Null

# Choose a password at the prompt. It is not echoed.
cast wallet new "$HOME\.foundry\keystores" nivpay-deployer

# Confirm the keystore exists and holds the address you expect.
cast wallet address --account nivpay-deployer

# Fund that address with MON for gas. The dry run needs about 0.61 MON.
$addr = cast wallet address --account nivpay-deployer
cast balance $addr --rpc-url https://testnet-rpc.monad.xyz
```

Write the path as `$HOME\.foundry\keystores`, not `~/.foundry/keystores`:
PowerShell does not expand `~` in arguments to native programs such as `cast`.
Never run a bare `cast wallet new` with no arguments: that form prints a fresh
private key to the terminal instead of writing a keystore.

Because the key is never shown, **the keystore file and its password are the
only copy of it.** There is no mnemonic to write down. Back up
`$HOME\.foundry\keystores\nivpay-deployer` somewhere safe and keep
the password separately. For a deployer that only pays gas, losing it is a
small loss, since `NivPayPots` has no owner and the deployer has no powers over
any pot. The deployed instances do use the deployer's address as their fee
recipient, so losing the key also loses the ability to call `collectFees()`,
along with any MON left on the address.

If a keystore named `nivpay-deployer` already exists, `cast wallet new` refuses
and lists it rather than overwriting it. To check what exists, or to start
over:

```powershell
Get-ChildItem "$HOME\.foundry\keystores"

# Only if you want to replace it. This is irreversible: the keystore is the
# only copy of the key, so back it up first if it holds anything.
Remove-Item "$HOME\.foundry\keystores\nivpay-deployer"
```

To use a key you already have instead, `cast wallet import nivpay-deployer
--interactive` prompts for the private key and a password, echoes neither, and
writes the same kind of encrypted keystore.

Verification needs no wallet, so the `forge verify-contract` commands further
down take no `--account`. Only the broadcast does.

### 2. Set the fee configuration

These are immutable once deployed, so get them right.

```powershell
$env:FEE_RECIPIENT = "0xYourFeeRecipientAddress"
$env:FEE_BPS = "50"          # 0.5 percent, contract hard ceiling is 100
$env:FEE_CAP = "50000000"    # 50 AUSD, six decimals
```

### 3. Dry run

This performs every check, including reading AUSD's symbol and decimals off the
live chain, and deploys nothing.

```powershell
$env:FOUNDRY_PROFILE = "deploy"
forge script script/Deploy.s.sol:Deploy --rpc-url https://testnet-rpc.monad.xyz -g 105
```

The verified dry run reports **2,969,615 gas**, about **0.603 MON** at a
203 gwei max fee. Under Ethereum rules on the old toolchain the same script
estimated 3,676,666 gas and 0.746 MON.

### 4. Broadcast

**This is the point of no return. The contract has no owner and cannot be
upgraded or withdrawn from.**

```powershell
$env:FOUNDRY_PROFILE = "deploy"
forge script script/Deploy.s.sol:Deploy `
    --rpc-url https://testnet-rpc.monad.xyz `
    --account nivpay-deployer `
    -g 105 `
    --broadcast
```

### 5. Verify

From the Monad docs, MonadVision uses Sourcify and needs no API key:

```powershell
forge verify-contract `
    <deployed_address> `
    src/NivPayPots.sol:NivPayPots `
    --chain 10143 `
    --verifier sourcify `
    --verifier-url https://sourcify-api-monad.blockvision.org/ `
    --constructor-args (cast abi-encode "constructor(address,uint256,uint256,address)" 0xa9012a055bd4e0eDfF8Ce09f960291C09D5322dC 50 50000000 $env:FEE_RECIPIENT)
```

Monadscan is the Etherscan compatible alternative and does need an API key:

```powershell
forge verify-contract `
    <deployed_address> `
    src/NivPayPots.sol:NivPayPots `
    --chain 10143 `
    --verifier etherscan `
    --etherscan-api-key $env:MONADSCAN_API_KEY `
    --watch `
    --constructor-args (cast abi-encode "constructor(address,uint256,uint256,address)" 0xa9012a055bd4e0eDfF8Ce09f960291C09D5322dC 50 50000000 $env:FEE_RECIPIENT)
```

### The TESTUSD instance

**Deployed**, see [Contract addresses](#contract-addresses). Two transactions: the test token, then a
`NivPayPots` bound to it. Use the same `nivpay-deployer` keystore and the same
three fee variables from step 2, so the settings match the AUSD instance.

#### T1. Deploy the test dollar

```powershell
$env:FOUNDRY_PROFILE = "deploy"

# Dry run. Deploys nothing.
forge script script/DeployTestDollar.s.sol:DeployTestDollar --rpc-url https://testnet-rpc.monad.xyz -g 105

# Broadcast.
forge script script/DeployTestDollar.s.sol:DeployTestDollar `
    --rpc-url https://testnet-rpc.monad.xyz `
    --account nivpay-deployer `
    -g 105 `
    --broadcast
```

The dry run against the live chain reports **1,001,875 gas**, about
**0.203 MON** at a 203 gwei max fee. The script reads the deployed name,
symbol, decimals and permit domain back and fails if any is wrong. Note the
`TESTUSD` address it prints.

#### T2. Deploy the TESTUSD pots

```powershell
$env:FOUNDRY_PROFILE = "deploy"
$env:TEST_DOLLAR = "<TESTUSD address from T1>"

# Optional but recommended once the AUSD instance is live: its address.
# The script then reads that instance's fee settings off the chain and refuses
# to deploy unless FEE_BPS, FEE_CAP and FEE_RECIPIENT match them exactly.
$env:AUSD_POTS = "<AUSD NivPayPots address>"

# Dry run. Deploys nothing.
forge script script/DeployTestDollarPots.s.sol:DeployTestDollarPots --rpc-url https://testnet-rpc.monad.xyz -g 105

# Broadcast.
forge script script/DeployTestDollarPots.s.sol:DeployTestDollarPots `
    --rpc-url https://testnet-rpc.monad.xyz `
    --account nivpay-deployer `
    -g 105 `
    --broadcast
```

Before deploying, the script checks that `TEST_DOLLAR` is not the AUSD address,
has code, is named `NivPay Test Dollar` with symbol `TESTUSD`, has six decimals
and a permit domain separator. Because TESTUSD is not on chain yet, the dry run
was verified on an Anvil fork of Monad testnet (chain id 10143) with TESTUSD and
a stand in AUSD instance created there. It reported **2,945,004 gas**, and it
refused a mismatched fee cap, a mismatched fee recipient, the AUSD address and a
non token address.

#### T3. Mint and verify

TESTUSD mints to anyone, from anyone, with no faucet. Each call is capped at
100,000 TESTUSD (`MAX_MINT`, 100000000000 base units) and reverts with
`MintAboveCap` above that. Calls can be repeated, so the cap limits each mint,
not the total supply:

```powershell
cast send <TESTUSD address> "mint(address,uint256)" <recipient_address> 10000000000 `
    --account nivpay-deployer `
    --rpc-url https://testnet-rpc.monad.xyz
```

That is 10,000 TESTUSD. Verification is the same as step 5, with the token
contract taking no constructor arguments:

```powershell
forge verify-contract `
    <TESTUSD address> `
    src/NivPayTestDollar.sol:NivPayTestDollar `
    --chain 10143 `
    --verifier sourcify `
    --verifier-url https://sourcify-api-monad.blockvision.org/

forge verify-contract `
    <TESTUSD pots address> `
    src/NivPayPots.sol:NivPayPots `
    --chain 10143 `
    --verifier sourcify `
    --verifier-url https://sourcify-api-monad.blockvision.org/ `
    --constructor-args (cast abi-encode "constructor(address,uint256,uint256,address)" $env:TEST_DOLLAR 50 50000000 $env:FEE_RECIPIENT)
```

### NivPayNames, the username registry

**Deployed** at `0x798f4a11c16C96561fE7834365420505542e280D`, transaction `0x9bf29091dbe3167dfd72f6602a1f4d4d32f06039b6d001f7c1199f74df4d949e`,
block 71,283,172; the receipt is committed under
`broadcast/DeployNames.s.sol/10143/`. To deploy it again: one transaction, no constructor arguments: the rules,
the reserved names and the 90 day hold are fixed in the source. Use the same
`nivpay-deployer` keystore.

```powershell
$env:FOUNDRY_PROFILE = "deploy"

# Dry run. Deploys nothing.
forge script script/DeployNames.s.sol:DeployNames --rpc-url https://testnet-rpc.monad.xyz -g 105

# Broadcast.
forge script script/DeployNames.s.sol:DeployNames `
    --rpc-url https://testnet-rpc.monad.xyz `
    --account nivpay-deployer `
    -g 105 `
    --broadcast
```

The dry run against the live chain reports **1,025,914 gas**, about
**0.21 MON** at a 204.5 gwei max fee. The script refuses any chain but
`10143`, then reads the deployed rules back (the hold, the lengths, a name
check and the reserved names) and fails if any is wrong. Note the
`NivPayNames` address it prints, and the block of the transaction.

Verify, with no constructor arguments:

```powershell
forge verify-contract `
    <NivPayNames address> `
    src/NivPayNames.sol:NivPayNames `
    --chain 10143 `
    --verifier sourcify `
    --verifier-url https://sourcify-api-monad.blockvision.org/
```

### NivPayPotsV2, pots that can change

**Deployed** on 19 Oct 2026, AUSD first, then TESTUSD:

| Token | Address | Transaction | Block |
| --- | --- | --- | --- |
| AUSD | `0xa41e0DdC0c94a795f200c5e850321242975dFA93` | `0x490c2e41598bcae2a69bc9f84c7ee383bd1e92105d92dbd3b858313243221a8d` | 72,436,819 |
| TESTUSD | `0xE47CCe61e95fB4B451c0FfF0dD5164F2E48e79d1` | `0xe399f8493f48bd81ec2df18661f48274d7569ce1003c0fb13c8e8ad47128c86c` | 72,438,051 |

Both receipts are committed under `broadcast/DeployPotsV2.s.sol/10143/` (one
`run-*.json` each; `app/src/lib/config.test.ts` checks `POTS_V2` and its
blocks against them). Checked on the chain after deploying: each is bound to
the token in its row (AUSD and TESTUSD, both six decimals), with
`EXIT_WINDOW` 259,200 seconds (72 hours), `APPLY_PERIOD` 604,800 seconds (7
days), 50 bps, a 50 AUSD fee cap and the same fee recipient as NivPayPots.
Each one's live code is byte for byte a build of this source with the
`deploy` profile: 21,581 bytes, identical outside the 28 places the compiler
leaves for immutables (which hold exactly those values), metadata trailer
and so source hash included. Both are exact matches on Sourcify.

How they were made: one per token, next to each NivPayPots, which is not
touched. `script/DeployPotsV2.s.sol` takes no fee settings from the
environment: it reads the token, `feeBps`, `feeCap` and `feeRecipient` off
the live NivPayPots for that token, refuses any chain but `10143` and any
token but the one expected, deploys with an exit window of exactly 72 hours
and an apply period of exactly 7 days (fixed in the script, not read from
the environment, and pinned by `test/DeployPotsV2.t.sol`), and reads every
setting and rule back. Use the same `nivpay-deployer` keystore.

```powershell
$env:FOUNDRY_PROFILE = "deploy"

# Dry runs. Deploy nothing.
$env:POTS_TOKEN = "ausd"
forge script script/DeployPotsV2.s.sol:DeployPotsV2 --rpc-url https://testnet-rpc.monad.xyz -g 105
$env:POTS_TOKEN = "testusd"
forge script script/DeployPotsV2.s.sol:DeployPotsV2 --rpc-url https://testnet-rpc.monad.xyz -g 105

# Broadcast, one for each token.
$env:POTS_TOKEN = "ausd"
forge script script/DeployPotsV2.s.sol:DeployPotsV2 `
    --rpc-url https://testnet-rpc.monad.xyz `
    --account nivpay-deployer `
    -g 105 `
    --broadcast
$env:POTS_TOKEN = "testusd"
forge script script/DeployPotsV2.s.sol:DeployPotsV2 `
    --rpc-url https://testnet-rpc.monad.xyz `
    --account nivpay-deployer `
    -g 105 `
    --broadcast
```

The dry run against the live chain, on 17 Oct 2026, on the final source,
reports **5,024,967 gas** for each, about **1.02 MON** at a 203 gwei max
fee, and logs `exit window s 259200` and `apply period s 604800`. Their
addresses and blocks are set in `app/src/lib/config.ts` (`POTS_V2`,
`POTS_V2_DEPLOY_BLOCK`), and the same `POTS_V2` in `app/api/notify/index.ts`
(its test fails if the two differ). New pots are made on V2; pots on
NivPayPots keep working there as before.

Verify each, with its constructor arguments read from the NivPayPots next to it:

```powershell
forge verify-contract `
    <NivPayPotsV2 address> `
    src/NivPayPotsV2.sol:NivPayPotsV2 `
    --chain 10143 `
    --verifier sourcify `
    --verifier-url https://sourcify-api-monad.blockvision.org/ `
    --constructor-args (cast abi-encode "constructor(address,uint256,uint256,address,uint256,uint256)" <token> 50 50000000 0x7EAf7f3e330ac388A0e951e80957B7274597297c 259200 604800)
```


### NivPayPotsV2 STAGING copy: unused, not the real deployment

> **Staging only. Do not use, do not point the app at it.** Monad testnet
> `0x5a6121611867B238530cE4C6d55F1327AABB05aF`, deployed in transaction
> `0xa3d646ce6cac7ce31b33a36e5e6ddd2cabf1c4d3c3ee0caa9f131018dc04eee7`,
> block 71,868,354, by a throwaway key, from
> `script/DeployPotsV2Staging.s.sol`: a **5 minute** exit window, a **5
> minute** apply period, no fees, on real AUSD. It exists only so a change's
> whole life could be run end to end in minutes. Nothing in this repository
> points at it, and it is left unused.

On 17 Oct 2026 it was run end to end with throwaway accounts, in the real app
at localhost, built with `POTS_V2` pointed at it for that run only (never
committed), in a headless Chromium with a virtual passkey for each person:

1. Ana made a pot ("Staging party", 1 of 1, Caterer up to $300) through Make
   a pot; Ana put in $1,000 and Ben, from the pot's link, $500.
2. Ana paid the caterer $200, within the limit.
3. Ana proposed raising the caterer to $600: agreed at once (1 of 1), waiting
   5 minutes. The pot screen said so; applying it early was refused
   (`ChangeNotReady`).
4. Ben's bell said "Staging party: change agreed: raise Caterer's limit to
   $600. Takes effect Sat 17 Oct, 17:48. If you disagree, take your part out
   before then.", with Take my part out. Ben took his $433.33 out, two
   minutes into the window.
5. After the window, Ana made the change, and paid the caterer $350 more,
   $550 in all, past the old limit.
6. Ana proposed adding a DJ, up to $100; agreed, nobody applied it, and 10
   minutes later it had lapsed: the chain reports it Lapsed, applying it is
   refused, the pot no longer lists it, and once anyone recorded the lapse
   the story says "Change lapsed: add DJ, up to $100.00".
7. The money, to the unit: $1,500 in = $550 paid + $0 fees + $433.333333
   taken out + $516.666667 held, which is exactly the contract's AUSD
   balance.

The run found and fixed five things in the app before this commit: a render
loop on Home once V2 is set, a pot screen that didn't refresh after a change
landed (the RPC's nodes don't all reach the same finalized block at once),
money into a V2 pot shown in History as sent to an account, three lines on
Make a pot saying nothing could ever change, and dates written "Sat, 17 Oct"
where the rest of the app writes "Sat 17 Oct".

### Broadcast receipts are committed on purpose

`broadcast/Deploy.s.sol/10143/` is **deliberately not gitignored**. The receipt
from a real deploy gets committed, as provenance. The same applies to
`broadcast/DeployTestDollar.s.sol/10143/` and
`broadcast/DeployTestDollarPots.s.sol/10143/`: the ignore rules cover every
script's Monad testnet receipts, so those record which address is the TESTUSD
token and which pots instance is bound to it.

The reasoning: this contract has no owner, no admin and no upgrade path. Once it
is deployed there is no registry to update and no migration to point at, so the
deployment transaction is the only record of which bytecode is live at which
address with which immutable fee settings. Keeping that receipt in the
repository means the address, the exact constructor arguments and the
transaction hash are versioned next to the source they came from, rather than
living in somebody's terminal scrollback.

What the receipt contains, and does not:

* it **does** contain the deployer address, the full constructor calldata, the
  deployed address, gas figures and the transaction hash,
* it contains **no private key**, no mnemonic and no keystore material. Foundry
  writes nothing of that kind into a broadcast receipt, and the keystore stays
  in `~/.foundry/keystores`, outside this repository.

Still ignored, because they are noise rather than provenance:

* `/broadcast/*/31337/`, local Anvil runs,
* `/broadcast/**/dry-run/`, simulations that were never sent,
* `cache/`, which is where Foundry writes the file it labels "Sensitive values".
  On the dry runs so far that file has held nothing but the public RPC URL,
  since no wallet was involved, but it stays ignored regardless.

A scan on 9 Oct 2026 of every object in the repository, reachable from any
branch, the reflog or nothing at all, found no private key, mnemonic, API key,
keystore, `.env` file or other credential in any file or commit message. Every
64 character hex value in the history was checked: each is a transaction
hash, a block hash or an EIP-712 domain separator, except one, which is the
publicly documented Anvil test account key used by `app/src/api-tests/fund.test.ts`
and named `PUBLIC_TEST_KEY` there. It is not a secret: Foundry and Hardhat
publish it as their first local test account.

## Demo videos

Three videos, built in `video/` with Remotion, all rendered on the author's
PC. The finished files are not in the repository.

| Video | Length | What it shows |
| --- | --- | --- |
| Technical demo | 2 min 34 s | The live app, recorded on phones: a passkey account and test dollars, the Birthday pot made and locked, $200 poured in, a payment of $50 asked for, and the second yes paying the Event Center, on two phones at once (the three Birthday rows under [Monad integration](#monad-integration)); then a send from London to Houston, its receipt on MonadVision, and $50 paid as CTK through Agora |
| Agora bounty | 1 min 46 s | Passkey sign-up from 8 s, an AUSD balance from 25 s, the $25 send landing on the recipient's phone in 2.2 s, its receipt read from the chain, then $50 paid as CTK through Agora's Instant Settlement in 1.3 s and that exchange's receipt |
| X launch | 36 s | Animated: the family group chat, then the pot that answers it. No crypto words |

How they are made (`video/src/films/`):

* **The two footage videos play real screen recordings** of nivpay.vercel.app
  inside a drawn phone frame. `video/src/films/clips.ts` lists every stretch
  used, with the recording, its in and out points and its speed; anything
  played faster than life carries a "Sped up" tag, the phone's own
  fingerprint blackouts are labelled, and key moments are magnified, never
  redrawn. The pot scenes come from the 10 Oct 2026 test run, as the video
  says; the CTK send from a recording on 13 Oct 2026.
* **The X video, the title cards and the end cards are animation** drawn in
  code. The pot, the map and the app screens there are illustrations of the
  app, in its own words.
* **Every figure comes from `video/src/facts.ts`** (amounts, settle times as
  measured on the phone, hashes), and receipt cards are read from Monad
  testnet by `video/scripts/read-receipts.ts`.
* **The music and sound effects are synthesized** by
  `video/scripts/make-sound.ts`; no music by anyone else is used.
* **Privacy:** the author chose to show the footage videos' recordings as
  recorded, unredacted; their OCR privacy check reports its findings and
  does not block. The animated video must pass it. Raw footage is never
  committed, and renders bundle only the cut clips, never the footage folder.

Render steps are in [video/README.md](video/README.md), the credits and
licenses in [video/CREDITS.md](video/CREDITS.md). The older timeline-based
cuts in `video/timelines/` remain, with their redaction map and checks.

## Logo

The logo in `brand/` is the family's clay pot from the app: three bands of
colour, one per person who put money in, under a wave, and a lid whose
handle is a padlock shackle, with a keyhole in front. A pot nobody can
pocket. The wordmark is Nunito Black, converted to outlines. The app's
favicon, home-screen and maskable icons and its header mark use it.
`brand/README.md` lists every file (lockups, one-colour versions, app tiles,
a 1000 px square) and the palette; `brand/make-logo.mjs` rebuilds the SVGs.

## Add money and Cash out in test mode

The Home card "Your bank" opens Add money and Cash out
(`app/src/screens/Money.tsx`), in 18 currencies. On testnet it is a
simulation, and every step says so ("Test mode: no real money moves"): no
bank is involved, no real currency moves, and only test AUSD moves, to or
from a test desk account run by `/api/ramp`.

* **Rates are fixed test rates, labelled as not live** (`app/src/lib/ramp.ts`),
  with a 1 percent fee. Every division rounds down and the fee rounds up, so
  a round trip always returns less than went in. $1 to $100 a request.
* **Add money:** pick a currency (the phone's time zone picks the first one:
  Africa/Lagos gives naira) and an amount; the screen shows the quote and
  which partner would serve that currency at launch. A mock "Pay by bank
  transfer" card shows a test account and a reference, and says "This is a
  simulation. Don't send real money". "I've sent it" asks the desk, which
  recomputes the quote itself and sends exactly that much test AUSD; the
  phone shows "$X added" only once that is final, with the time measured from
  the tap. No fingerprint, because nothing leaves the account.
* **Cash out:** an amount in dollars and bank details, which stay on the
  phone and are never sent. One fingerprint signs a transfer of AUSD to the
  desk, followed to Finalized like any send (a reload resumes it), then the
  desk reads that transfer at the finalized block and returns what a bank
  would get, with a reference derived from the transaction, so asking twice
  gives the same answer. The screen shows "₦X on its way to your bank",
  marked Simulated: no bank is paid, and the desk keeps the test dollars.
* **Limits on the desk**, in the style of `/api/fund`: the `RAMP_ENABLED` kill
  switch, same origin only, a 1 KB body cap, one request per account at a
  time and a two minute wait after a buy on each server instance, no buys for
  contracts or accounts holding $1,000 or more, and at most 30 desk
  transactions an hour, counted from the desk's own nonce. The desk key is
  read only after every check, never logged. Error codes 63 to 67 are in
  `docs/ERROR-CODES.md`.

On mainnet the same screens would quote from a licensed partner instead; see
[Mainnet plan](#mainnet-plan-money-in-and-out-in-any-currency).

## Auto cash out

Profile, Money, Auto cash out (`app/src/screens/AutoCash.tsx`): dollars that
arrive go to the person's bank in their own currency, with no tap each time.
On testnet it is the same labelled simulation as Cash out ("Test mode: no
real money moves"), run by the same test desk: no bank is involved, and the
desk keeps the test AUSD. The rules are `app/src/lib/autocash.ts`; the
server is `/api/autocash` (`app/api/autocash/index.ts`), which keeps its own
copy of them, tested against the phone's.

**On mainnet this needs a licensed partner** that holds the bank details and
runs ID checks, such as the Ramp or Switch routes in the
[Mainnet plan](#mainnet-plan-money-in-and-out-in-any-currency). NivPay would
only send the dollars to that partner; it would not keep bank details or
check identities itself.

* **Turning it on.** A currency from the same 18, a bank (its name, the
  account name and the account number), what to cash out (everything that
  arrives, or everything above a balance to keep, such as "keep $100"), and
  the most a day, $500 unless chosen, $1 to $1,000. Only the
  bank's name and the last 4 digits of the account number leave the phone:
  the account name and the full number are never stored, sent or logged. The
  choices are kept in the private Blob store under the account, sent with a
  proof the account's passkey signs (one fingerprint). A second fingerprint
  signs the dollar's own allowance for the desk's account, through
  `sendWrite` like every write: exactly the cap in force, as a total
  (`allowanceToSign`, tested), never a higher cap still waiting. The screen
  says what the chain and the server each do: "One fingerprint lets NivPay's
  cash-out desk move up to $500 in total from your account to your bank.
  NivPay's server sends at most $500 of it in any 24 hours, and once the $500
  is used up nothing more moves until you allow it again. Turn this off any
  time."
* **How it runs.** The same trigger as notifications: when a payment is final,
  the sender's app calls `/api/notify` with its transaction, and `/api/notify`
  asks `/api/autocash` about each account it is telling "received" for
  dollars. The person's own app also asks, when it opens and when its feed of
  money in sees new dollars, for its 10 latest arrivals. The desk reads the
  receipt at the finalized block, works out what really arrived for that
  account from someone else, checks auto cash out is on and was on before
  that block, the day's cap and the balance to keep, and moves that amount to
  itself with `transferFrom`. The statement is Cash out's own for that
  transaction (`/api/ramp`), with the same reference.
* **What it never does.** Move more than arrived; move money that was there
  before it was turned on, except what is above the balance to keep; move the
  account's own transactions, money from the desk (Add money), the faucet, or
  money minted; take money out of a pot (it only ever moves from the account
  itself); move a transaction twice for an account; move past the allowance
  the person signed. A transaction is claimed before anything moves, in one
  file per account (`autocash/<account>/claims.json`) changed only by a
  conditional write: read past the cache with its ETag, written back with
  `ifMatch`, which Vercel Blob refuses (412) if another server instance wrote
  in between; the loser reads again and finds it claimed, and its
  notification says nothing more. A missing file is created with no
  overwrite. The file keeps the last 500 arrivals and two floors, the block
  it was last turned on at and the highest block ever pruned, and refuses
  any arrival at or below either, so a pruned one is never moved again. A
  claim is never let go: a move lost after it was sent is never tried again.
* **Telling the person.** One push, in their language: "$50 arrived and was
  sent to your bank: ₦76,725.00, First Bank ending 6789. Test mode.", whose
  tap opens the statement. With "Show amounts on the lock screen" off, the
  amounts are left out and the bank stays. If only part of it moved (the cap,
  the balance to keep, the allowance), the arrival is told as always and the
  part that went to the bank too. If the money stayed (the cap reached, the
  allowance used up, the desk switched off, busy or out of what it runs on),
  the push says it stayed and why. The bell says the same from
  `GET /api/autocash`, which lists the last 7 days' moves and holds and
  nothing about the bank; History says "Auto cash out" for those cash outs.
* **Turning it off, or changing it.** Off is at once on the server, with no
  fingerprint (off only ever leaves money where it is), and the screen says
  Off from that moment; then one fingerprint sets the allowance back to zero,
  and if that doesn't happen, the screen offers it again. A lower cap, a
  higher balance to keep, a currency and switching between everything and a
  balance apply at once. A new bank, or a higher cap, waits 24 hours, like
  the daily limit, with "Your new bank is used from Tue 20 Oct, 09:40" and
  Cancel; until then the old ones are used.
* **Apart from the daily limit.** Auto cash out does not count towards the
  [daily limit](#daily-limit), which lives on the phone, where the desk
  can't see it and the server can't enforce it. It is bounded by its own cap
  instead, which the server keeps.
* **The allowance is a total, not a day.** The chain only counts the
  dollar's allowance down as the desk moves money; nothing on the chain
  resets it each day. Keeping each 24 hours to the cap is the server's rule.
  Once the allowance is used up, money stays in the account, the person is
  told, and one fingerprint ("Allow again") sets it back to the cap. A
  contract could make a daily allowance on the chain; none was deployed for
  this.
* **Limits.** The `RAMP_ENABLED` kill switch (money that arrives is told as
  staying, nothing is claimed, and the key is never read), same origin only,
  a 1 KB body cap, a proof under 5 minutes old for every change but off, 10
  requests a minute and 6 moves an hour for one account, and the desk's 30
  transactions an hour, shared with Add money. The desk key is read only once
  a move is due, after every check, and never logged; logs carry the account,
  amounts and transactions, never the bank. Its error codes are its own, 100
  to 104 (`docs/ERROR-CODES.md`), apart from Cash out's 63 to 67: every two
  digit code was already taken.

## Mainnet plan: money in and out in any currency

On testnet, Add money and Cash out in the app are a clearly labelled
simulation: only test AUSD moves, and no bank is involved (see
[Add money and Cash out in test mode](#add-money-and-cash-out-in-test-mode)).
On mainnet a licensed partner does the bank side. No single partner covers
every currency in the world, so NivPay stacks them, and picks the route per
currency:

| Route | Partner | When | How money moves |
| --- | --- | --- | --- |
| 1. Direct | Ramp | Where Ramp sells and buys AUSD | Buy AUSD by card, bank transfer, Apple Pay or Google Pay; sell AUSD and cash out to a bank or card. AUSD bank cash out per corridor: [CHECK] |
| 2. Local | Switch, plus Paj, HoneyCoin and Rampnow for Africa | Naira, shillings, cedis, euros, rupees, yuan, and where Ramp doesn't serve AUSD | Bank transfer or mobile money in local currency, settled as USDC on Monad. NivPay converts USDC to AUSD in the same confirm, and back the other way to cash out |
| 3. Anywhere else | Onramper or Meld | Every other country | Aggregators that route each person to the licensed partner serving their country |
| 4. Later | Agora's own mint and redeem | Once there is an Agora organisation account | Dollars in and out directly with the issuer of AUSD (see `docs/BOUNTIES.md`) |

What the sources say, read on 13 Oct 2026:

* **Ramp.** Its post announcing Monad support (page dated 3 June 2026) lists
  buying and selling MON, USDC, USDT0 and AUSD on Monad. AUSD and USDT0 are
  not available in the EU. Buying is by card, instant bank transfer, Apple
  Pay, Google Pay and local options; selling cashes out to a bank or card.
  Which bank corridors pay out AUSD is not stated: [CHECK] per corridor
  before launch.
* **Switch.** Monad's onramp list gives USDC and USDT0 on Monad, settled in
  local currency (EUR, GBP, NGN, KES, GHS, INR, CNY and others) by bank
  transfer, mobile money and SWIFT.
* **Paj, HoneyCoin, Rampnow.** Listed for Africa; Rampnow names South Africa
  and Nigeria.
* **Onramper and Meld.** Listed as covering 190+ and 225+ countries.

Mama's 60th, on mainnet: Idara pays in pounds from London (Ramp), Ubong in
dollars from Houston (Ramp), and Aniekan in naira from Uyo (Switch, USDC
converted to AUSD in the same confirm). All of it lands as AUSD in one pot.
When the second yes pays the caterer, the caterer cashes out to naira in
their own bank, through the local route.

Revenue stays the pot fee on payouts (see [Fees](#fees)); NivPay adds no
margin on top of a partner. The partner's fee and rate are shown before
anything moves, on the same confirm sheet, and nothing moves without that
confirm.

Sources:

* https://rampnetwork.com/blog/monad-live-on-ramp-network
* https://docs.monad.xyz/tooling-and-infra/onramps

## Plan: mobile apps for Android and iOS

Today NivPay is a web app that installs to the home screen (Install the app,
in Profile). The plan is a store app on both phones, built around the same
code, so the two never drift apart and every fix ships to everyone at once.

**What must not change.** Passkeys are tied to `nivpay.vercel.app`, and each
account is derived from its passkey. Both apps keep that hostname as the
passkey's site and keep the derivation exactly as it is, so the same
fingerprint opens the same account in the browser, in the Android app and in
the iPhone app. An app that made its own passkeys under another name would
show people an empty account. This is a hard rule, not a preference.

**Android first, as a Trusted Web Activity.** The Android app is the web app
running full screen in Chrome (a Trusted Web Activity, packaged with
Bubblewrap), listed on Google Play. Chrome does the passkeys, so they work as
they do now, and Web Push, the service worker and the map all carry over.
The site proves the app is its own through `/.well-known/assetlinks.json`.
Most of NivPay's first people use Android (it was tested by hand on a Galaxy
S10), so this comes first.

1. A Play Console account, the app's signing key kept offline, and
   `assetlinks.json` served by Vercel with that key's fingerprint.
2. A Bubblewrap project in the repository, built in CI, with the app's
   icons, name and colours from `manifest.webmanifest`.
3. An internal test track on the team's own phones, then closed testing,
   then Play's review. The listing says plainly that it holds dollars as
   AUSD and that payouts need the pot's yeses.

**iPhone next, as a thin native shell.** On iOS, Apple doesn't allow a
store app that is only a website, and Web Push works only after the web app
is added to the home screen (iOS 16.4 or later). The iPhone app is a small
native shell (Capacitor) that loads the same screens and adds what a store
app needs:

* **Passkeys** through the shell, with Associated Domains
  (`webcredentials:nivpay.vercel.app` and `/.well-known/apple-app-site-association`),
  so the passkeys people already made on an iPhone in Safari still work.
  [CHECK] that the web view hands WebAuthn to the system with these
  entitlements on every iOS version supported, before anything else is built.
* **Notifications** through Apple's push service, sent by `/api/notify`
  beside Web Push, with the same per-kind switches and the same privacy
  (amounts on the lock screen off by default).
* **Face ID** is the passkey's own prompt; the app adds no second lock.

Then TestFlight with the team and early pot makers, and App Review. Apple's
rules on crypto apps and on payments are read before submitting, and the
review notes explain that NivPay moves AUSD on Monad and takes no payment
inside the app. [CHECK] the current App Review Guidelines (3.1 and 5.x) at
the time of submission.

**What stays the same everywhere.** One codebase, one deploy. The apps load
the deployed screens, so a fix on the web reaches both apps without a store
update; only the shells themselves (icons, entitlements, push keys) go
through review. The four languages, the error codes and Get help are
unchanged.

## Plan: mainnet launch

NivPay runs on Monad testnet today, with test AUSD and TESTUSD. Mainnet is a
launch of the AUSD instance only (see [Two instances](#two-instances));
TESTUSD never goes to a mainnet. It happens in stages, each one opened only
when the one before held up.

**Before anything is deployed**

1. **An external audit** of `NivPayPots` and `NivPayNames`, with every
   finding fixed or answered in the open, and the invariant, adversarial and
   mutation suites (see [Tests](#tests)) run again on the audited code.
2. **The decisions left for mainnet** made and written down: usernames'
   squatting and disputes (see
   [Disputes, and squatting](#disputes-and-squatting-decisions-before-mainnet)),
   and whether payouts wait 24 hours (see [Future work](#future-work)), which
   would mean a new contract version before launch rather than after.
3. **Keys.** The deployer key and the fee recipient on a hardware wallet or
   a multisig, never a keystore on a laptop. Nobody holds a key that can move
   people's money: the contract has no owner and no admin, and that is kept.
4. **Fees for people's requests.** The testnet gas grant from `/api/fund` is
   replaced by a sponsor that pays only for NivPay's own actions on NivPay's
   own contracts (see [Future work](#future-work)), with a budget and alerts.
5. **Money partners signed.** At least the direct route (Ramp) and one local
   route for Nigeria live, with their checks on sanctions and identity, and
   each partner's fee and rate shown on the confirm sheet (see
   [Mainnet plan: money in and out](#mainnet-plan-money-in-and-out-in-any-currency)).

**Launch**

6. Deploy with `script/Deploy.s.sol` to Monad mainnet: dry run, broadcast,
   verify, the receipts committed, and the addresses added to
   [Contract addresses](#contract-addresses), where the docs test checks them
   against the app.
7. Build the app on the mainnet instance at the same hostname,
   `nivpay.vercel.app`, so people's passkeys and accounts carry over. Add
   test dollars and the Test mode badge go away on that build; nothing else
   in the screens changes.
8. **Invite only first**, with low limits in the app: a lower default daily
   limit and a cap on what the app lets one pot take in, both raised as weeks
   pass without trouble. The contract itself stays as deployed, with no
   limits to change. The first pots are the team's own and people they know.
9. A bug bounty, open from launch day, and monitoring of the contracts'
   events and the API's errors. NivPay can't pause or change the contract
   (it has no owner), so the written plan for trouble is what NivPay does
   control: the fee sponsor and the money partners' screens can be switched
   off, the app can show a notice, and each pot's deciders can pause their
   own pot, which stops pour-ins and payments but never exits.

**Then open to everyone**, the store apps released on the mainnet build, and
the limits set from what the invite-only weeks showed.

## Future work

**System push notifications.** Notifications that reach a phone with the app
closed need a server that watches the chain for each account, and the
person's permission for push messages. Both are a step away from "no server
ever sees an account": the server would learn which accounts belong to which
phone. To be designed with that in the open, and opt in.

**More languages, with native speakers.** Yoruba, Igbo, Hausa and Nigerian
Pidgin, for the people NivPay was first built for, and Arabic, which reads
right to left and needs the layout mirrored, not only the words. Each should
be written or at least reviewed by native speakers, starting with the texts
about money and closing pots, before it ships.

**Inviting people to a pot by username.** Today a decider or a payee joins a
pot by answering an invite link, which proves the account is theirs. With
usernames, the maker could type `@idara` instead of sending a link and
waiting for a reply: the phone looks the name up at the finalized block and
asks for the same last 4 characters as Send does. It needs care, because a
pot's payees can never change: a name that points at the wrong account
there is wrong for good, so it would ask for the last 4 every time, not
only the first.

**A 24 hour wait on payouts.** In the next contract version, a payment that
reaches its rule would wait 24 hours before it pays, so everyone with money
in the pot sees it coming and can take their share out first. That turns
"the deciders agreed among themselves" from a surprise into a choice, at the
cost of slower payouts. It needs a new contract; NivPayPots stays as
deployed.

**Fees paid through a sponsor.** Today `/api/fund` sends each account a
little testnet MON before its first requests. A sponsor that pays fees
directly, and only for NivPay's own actions on NivPay's own contracts, would
remove the grant, the per-account limits that come with it, and the chance of
someone spending a grant on something else.

**Sanctions screening and ID checks** through the licensed money partners
that would run Add money and Cash out at launch (see
[Mainnet plan](#mainnet-plan-money-in-and-out-in-any-currency)). They hold
the licences and do the checks where money meets a bank; NivPay itself keeps
no identity documents.

## A note on the benchmark files

This repository also contains an earlier settlement benchmark: `StreamBench`,
`MockStable`, their tests, `script/cost_model.py` and
[BENCHMARK.md](./BENCHMARK.md). That benchmark evaluated a **streaming**
subscription design that has since been **replaced** by the pot design above.

The files are kept untouched as evidence of process, and their tests still run
and still pass as part of the suite. Nothing in `NivPayPots` depends on them.

## Pre-existing work

**Nothing in this repository predates 1 Sep 2026.** The first commit,
`e627991`, is dated 6 Sep 2026, and every commit on every branch was authored
between 6 Sep and 10 Oct 2026. Nothing was squashed.

**The published history has never been rewritten.** Every push recorded in
this clone (17, from 25 Sep to 10 Oct 2026) moved `origin/master` forward
from the one before, and the local branch still contains the last one.
The local reflog, which goes back to the first commit, shows two redos,
both before they were ever pushed:

* On 6 Sep 2026, six commits made between 21:28 and 21:33 were made again
  from a fresh start at 21:34 (`e627991`, "commit (initial)"), with the same
  messages. The first push, on 25 Sep, already began at `e627991`.
* On 10 Oct 2026 at 08:00, two local commits were undone and made again 20
  seconds later with the same messages (now `114d391` and `84a6e04`). The
  push before was at 20:13 on 9 Oct, the push after at 09:04 on 10 Oct.

* The streaming benchmark (`StreamBench`, `MockStable`, `BENCHMARK.md`) was the
  first thing built in this repository, on 6 Sep 2026, inside the build window.
  It is an earlier design that was retired, not code from another project.
* No file here was copied from an earlier project. Checked on 9 Oct 2026 by
  comparing every tracked file's content hash against the files in the
  author's seven other local repositories: no file is identical. The author
  pasted in no code from anywhere else: the code here was written in this
  repository by Claude Code or by the author.
* The design comps in `docs/design/` were taken from a "NivPay UI Concepts"
  design canvas and committed on 27 Sep 2026.
* Third-party libraries are listed under
  [Third-party code and licenses](#third-party-code-and-licenses). They are
  used as published and are not this project's work.

## AI disclosure

**Claude Code, Anthropic's AI coding tool, was used across this whole
project**: the Solidity contracts and deploy scripts, the app and its
serverless functions, the Foundry and app tests, and the documentation,
including this README. About 80 percent of the code and prose in this
repository was written by Claude Code from written instructions and then
reviewed; the author wrote the rest. No other AI tool was used.

The instructions it worked from are in the repository: `docs/BUILD-APP.md` is
the app brief, and the "My notes on this bounty" section of `docs/BOUNTIES.md`
records the author's decisions for the Agora bounty. Commit messages carry no
AI attribution lines; this section is the disclosure.

What the human author, UEddy, did:

* **Product concept and rules.** The pot, and the rules it must keep: fixed
  destinations with caps, threshold approvals, any single approver can freeze
  but only a threshold can unfreeze, exits never blocked, the remainder
  returned pro rata. The "Mama's 60th" story. The decision to retire the
  streaming design in favour of pots. All of these were the author's ideas.
* **Design decisions.** The chosen visual direction (the "Clay Pot" look with
  the Three Cities map in `docs/design/`), the motion rules in
  `docs/MOTION.md`, and the product language rule that no crypto word appears
  in the app. The author made the design comps.
* **Architecture choices.** Mera passkey accounts that store only an address;
  gas paid through a small grant function so people never see fees; reads
  only at Finalized; AUSD by default with TESTUSD as the fallback; no
  third-party scripts, no analytics, exact dependency versions. These are set
  out in `docs/BUILD-APP.md`.
* **Security decisions.** No owner, admin or upgrade path in the contract;
  which keys exist and where they live (the deployer key in an encrypted
  keystore, the funder key only in Vercel's settings); a kill switch for
  funding; and the rule that the AI tool is never given, shown or asked for a
  private key or seed phrase.
* **Review** of the changes before they were committed: the author read
  Claude Code's summary of each change, skimmed the code, and tested each
  change on the phones.
* **Testing on real phones.** The passkey, pot and payment flows were tested
  by hand, mainly on two Android phones, a Samsung Galaxy S10 and a Galaxy
  S24, in Chrome with the passkeys saved to Google Password Manager.
* **Deployment.** Ran the contract deployments and verification from their
  own keystore, created and funded the funder key and entered it in Vercel,
  and deployed the app to nivpay.vercel.app, all by hand.

## Third-party code and licenses

This project's own code is MIT licensed (see [License](#license)). It builds
on the following, each used unmodified under its own license. App versions
are the exact ones in `app/package-lock.json`; license fields were read from
each installed package's `package.json`.

### Contracts (git submodules under `lib/`)

| Library | Version | License | Used for |
| --- | --- | --- | --- |
| [OpenZeppelin Contracts](https://github.com/OpenZeppelin/openzeppelin-contracts) | 5.1.0 | MIT | `IERC20`, `IERC20Permit`, `SafeERC20`, `ReentrancyGuard`, `Math` in NivPayPots; `ERC20`, `ERC20Permit` in TESTUSD |
| [forge-std](https://github.com/foundry-rs/forge-std) | 1.16.2 | MIT OR Apache-2.0 | tests and deploy scripts only |

### App, direct dependencies

| Package | Version | License | Used for |
| --- | --- | --- | --- |
| [`@category-labs/mera`](https://github.com/category-labs/mera) | 0.2.0 | MIT OR Apache-2.0 | passkey accounts and signing sessions |
| [`viem`](https://github.com/wevm/viem) | 2.56.9 | MIT | reading the chain, encoding calls, signing |
| [`@scure/bip39`](https://github.com/paulmillr/scure-bip39) | 2.4.0 | MIT | passkey output to seed |
| [`@scure/bip32`](https://github.com/paulmillr/scure-bip32) | 2.4.0 | MIT | seed to account key |
| [`react`](https://github.com/facebook/react), `react-dom` | 19.3.0 | MIT | the interface |
| [`@fontsource/besley`](https://fontsource.org/fonts/besley) | 5.3.0 | OFL-1.1 | self hosted Besley font |
| [`@fontsource/work-sans`](https://fontsource.org/fonts/work-sans) | 5.3.0 | OFL-1.1 | self hosted Work Sans font |
| [`@vercel/blob`](https://github.com/vercel/storage) | 2.8.2 | Apache-2.0 | storing profile photos, shared cities, sealed requests and push subscriptions, private, in the `/api/photo`, `/api/city`, `/api/inbox`, `/api/push` and `/api/notify` functions only; never in the page |
| [`web-push`](https://github.com/web-push-libs/web-push) | 3.6.7 | MPL-2.0 | sending notifications to phones, in the `/api/notify` function only; never in the page |
| `typescript` (dev) | 7.0.2 | Apache-2.0 | type-checking |
| `vite` (dev) | 8.3.1 | MIT | dev server and build |
| `@types/node`, `@types/react`, `@types/react-dom` (dev) | 24.19.0, 19.3.0, 19.3.0 | MIT | type definitions |

### Data

| Data | Source | License | Used for |
| --- | --- | --- | --- |
| World land outlines (`app/src/data/world-land.json`, made by `app/scripts/make_world.mjs`, simplified) | [Natural Earth](https://www.naturalearthdata.com/), `ne_110m_land`, v5.1.2, downloaded 16 Oct 2026 | Public domain | the world under the pot map |
| World cities (`app/src/data/cities.json`, made by `app/scripts/make_cities.py`) | [GeoNames](https://www.geonames.org/), `cities15000`, downloaded 15 Oct 2026 | [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) | turning a phone's position, or a typed name, into a city, on the phone only |
| Speech embedding weights, in `app/public/wake/hey-nivpay-v1.bin` (made by `app/scripts/wake/export.py`) | Google's [speech_embedding](https://www.kaggle.com/models/google/speech-embedding) as exported by [openWakeWord](https://github.com/dscripka/openWakeWord) (`embedding_model.onnx`, taken from npm `@wakebox/browser` 0.1.2 and checked against the `embedding_model.tflite` in PyPI `wyoming-openwakeword` 1.8.2) | Apache-2.0 | "Hey NivPay": turning sound into what the wake word classifier reads, on the phone only |
| The "Hey NivPay" classifier, in the same file | trained for this app by `app/scripts/wake/`, on speech made for it (below) | MIT, as this project | deciding it heard "Hey NivPay" |

### Wake word engine

| Code | Version | License | Used for |
| --- | --- | --- | --- |
| [openWakeWord](https://github.com/dscripka/openWakeWord)'s design: mel spectrogram, speech embedding, classifier on 16 embeddings | 0.6.0 | Apache-2.0 | re-written in TypeScript in `app/src/lib/wake/engine.ts`; none of its code or its non-commercial (CC BY-NC-SA 4.0) wake word models are shipped or used |

Used only to train and check the classifier, on the author's machine; none is
shipped, and the voices it made are not in the repository:
[Kokoro-82M](https://huggingface.co/hexgrad/Kokoro-82M) (Apache-2.0; npm
`kokoro-q8-shards` 1.0.0 for the weights, `kokoro-js` 1.2.1 for the voices)
through `kokoro-onnx` 0.6.1 (MIT); `espeak-ng` (GPL-3.0-or-later, through
`espeakng-loader` 0.2.4) and `phonemizer` 3.4.0 (GPL-3.0) for the phonemes of
the sentences spoken; `onnxruntime` 1.31.0 (MIT); `numpy`, `scipy` and
`soundfile` (BSD-3-Clause); `ai-edge-litert` (Apache-2.0) for the check
against the TFLite model; the sentences spoken are docstrings of Python's
standard library (PSF License) and this repository's documentation. [Playwright](https://playwright.dev/)
(Apache-2.0) runs `app/scripts/wake/browser-check.mjs`; it is not a
dependency.

### App, indirect dependencies

Shipped in the app: `@noble/curves`, `@noble/hashes`, `@noble/ciphers`,
`@scure/base`, `ox`, `abitype`, `isows`, `ws`, `eventemitter3`,
`@adraffy/ens-normalize` and `scheduler`, all MIT.

Build time only: `rolldown`, `postcss`, `nanoid`, `fdir`, `picomatch`,
`tinyglobby`, `csstype`, `undici-types`, `@oxc-project/types` and
`@rolldown/pluginutils` (MIT); `lightningcss` (MPL-2.0); `source-map-js`
(BSD-3-Clause); `picocolors` (ISC); `detect-libc` (Apache-2.0). Platform
specific native binaries of `rolldown`, `lightningcss` and `typescript` are
installed only for the machine building the app and carry the same licenses as
their parent packages.

### Services and contracts used, not included

* **AUSD and its faucet**, by Agora, on Monad testnet. Called, not copied.
* **Agora's Instant Settlement pair, its whitelister and CTK**, on Monad
  testnet. Called, not copied. Agora's pair source is BUSL-1.1 and is not in
  this repository; the app holds only the ABI fragments it calls.
* **Monad testnet** and its public RPC, `https://testnet-rpc.monad.xyz`.
* **Sourcify** for contract verification, as used by MonadVision.
* **Vercel** for hosting the app and its functions.
* **Slither** was run for static analysis; it is not a dependency.

### Videos and logo

* **Remotion** 4.0.534 renders the videos, under the Remotion License (free
  for an individual). Its other parts, three.js and tesseract.js (used on
  the author's PC for the privacy check) are listed with versions and
  licenses in [video/CREDITS.md](video/CREDITS.md).
* **Fonts:** Besley and Work Sans, as in the app, and **Nunito** for the
  videos' headlines and the logo's wordmark, all under the SIL Open Font
  License 1.1.
* **opentype.js** 1.3.4 (MIT) was used once, outside the repository, to turn
  the wordmark into outlines; it is not a dependency.
* **FFmpeg** cuts the clips on the author's PC; it is a tool, not shipped.

## Layout

    src/NivPayPots.sol            the pot contract, the whole product
    script/Deploy.s.sol           deployment, with live chain preflight checks

    src/NivPayTestDollar.sol      TESTUSD, a worthless test token, testnet only
    script/DeployTestDollar.s.sol       deploys TESTUSD on Monad testnet
    script/DeployTestDollarPots.s.sol   deploys a second NivPayPots bound to TESTUSD
    test/NivPayTestDollar.t.sol   TESTUSD, including the mainnet refusal

    test/Mama60.t.sol             the reference scenario
    test/PotsCore.t.sol           creation, funding, exits, claims
    test/PotsGovernance.t.sol     proposals, payouts, freeze, close, fees
    test/PotsSecurity.t.sol       freezing, reentrancy, isolation, lost keys
    test/PotsFuzz.t.sol           fuzz over amounts, order, fees
    test/PotsInvariant.t.sol      invariants
    test/handlers/PotsHandler.sol the stateful handler behind them
    test/PotsFork.t.sol           real AUSD on Monad testnet
    test/mocks/                   AUSD with freezing and permit, a reentrant token

    src/MockStable.sol            retired streaming benchmark
    src/StreamBench.sol           retired streaming benchmark
    test/StreamBench.t.sol        retired streaming benchmark
    script/cost_model.py          retired streaming cost model
    bench/gas.json                retired streaming measurements

    app/                          the app: React screens in app/src, functions in app/api
    app/src/lib/                  accounts, writes, feeds, links, money, config
    app/api/fund/                 the gas grant function and its status endpoint
    app/api/ramp/                 the test desk behind Add money and Cash out, a simulation
    app/src/lib/wake/             "Hey NivPay": the wake word engine, the listening rules, recorded test audio
    app/public/wake/              its weights and the microphone's audio worklet
    app/scripts/wake/             how the weights were trained and measured, and the browser check
    docs/                         design, measurements, error codes, bounty and submission notes
    brand/                        the logo: SVG lockups, app tiles, PNG exports, make-logo.mjs
    video/                        the demo videos: Remotion compositions, timelines, facts, shot list
    video/src/films/              the three videos as built: clips, scenes, sound plan

## License

MIT, copyright (c) 2026 UEddy. See [LICENSE](./LICENSE). Third-party code keeps
its own license, listed under
[Third-party code and licenses](#third-party-code-and-licenses).
