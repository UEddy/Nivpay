# NivPay app to contract map

Phase 0 of `docs/BUILD-APP.md`. Everything here was read from `src/`, the
tests, the broadcast receipts and the live chain on 27 Sep 2026. Measurements
say how they were taken. Nothing was broadcast to make them.

## 1. Fixed facts, checked

| Fact in BUILD-APP.md | Checked against | Result |
| --- | --- | --- |
| NivPayPots on AUSD `0xB9E6...9EfB` | `broadcast/Deploy.s.sol/10143/run-latest.json`, `token()` on chain | matches, token is AUSD |
| NivPayPots on TESTUSD `0xe80F...96aA` | `broadcast/DeployTestDollarPots.s.sol/10143/run-latest.json`, `token()` on chain | matches, token is TESTUSD |
| TESTUSD `0x9FD6...B6f7` | `broadcast/DeployTestDollar.s.sol/10143/run-latest.json` | matches |
| AUSD `0xa901...22dC`, 6 decimals, permit | `decimals()`, `eip712Domain()`, `DOMAIN_SEPARATOR()` on chain | matches, see the permit trap below |
| Fee 50 bps with a cap | `feeBps()` and `feeCap()` on both instances | 50 and 50000000 (50 tokens) on both. The app still reads them |
| Chain 10143 | `eth_chainId` | `0x279f` = 10143 |

Other constants read from the contract, never to be hardcoded either:
`PROPOSAL_TTL` = 604800 (7 days), `MAX_APPROVERS` = 10, `MAX_DESTINATIONS` = 10,
TESTUSD `MAX_MINT` = 100000000000 (100,000 TESTUSD per call).

Neither instance has any pots yet (`potCount()` = 0 on both).

**Permit trap, AUSD.** `AUSD.name()` returns `"AUSD"`, but its EIP-712 permit
domain name is `"Agora Dollar"` (version `"1"`). I recomputed the domain
separator both ways: only `"Agora Dollar"` reproduces the on-chain
`DOMAIN_SEPARATOR` `0x7ff7...3ea1`. A permit signed with `name()` is invalid,
and because `fundWithPermit` swallows permit failures, the funding then
reverts on the missing allowance rather than on the signature. The app must
build the permit domain from `eip712Domain()`, not from `name()`. TESTUSD's
domain name is `"NivPay Test Dollar"`, which matches its `name()`; reading
`eip712Domain()` works for both.

**Decided:** for every token, AUSD and TESTUSD alike, the app reads the permit
domain from `eip712Domain()` (EIP-5267) and never hardcodes a name or a
version. Before signing, it recomputes the domain separator from what it read
and refuses to sign unless it equals the token's `DOMAIN_SEPARATOR()`. A test
checks the same thing against both live tokens.

## 2. The answers asked for

**How deciders and funders are set.** Deciders (approvers) are fixed in
`createPot` and can never change: 1 to 10 addresses, no zero address, no
duplicates. Funders are open: anyone can call `fund` or `fundWithPermit` on
any open pot. There is no funder list, invite code or signature check.

**Invite case: B**, for deciders and for destinations. Every decider's address
and every destination's address must be known when the pot is made. Funders
who are not deciders need no invite at all; a link to the pot is enough.
Consequence for the design: the Caterer and the Event hall, if they are real
passkey accounts (the bounty wants the Caterer to be one), must also send
their address back before the pot is made. See gap G1.

**How a payment is asked for, approved and paid.** A decider calls
`proposePayout(potId, destIndex, amount)`. **The asker counts as a yes**: the
proposal starts at 1 approval. Other deciders call `approve(proposalId)`. The
approval that reaches the threshold **executes the payout in the same
transaction**, so that decider pays the gas for the payment. In a 1 of n pot,
asking pays at once. The fee (`feeOn(amount)`) is taken from the pot on top of
the amount; the destination gets exactly `amount`.

Two checks happen only at execution, not when asking: the destination's
remaining limit (`CapExceeded`) and whether the pot can cover amount plus fee
(`InsufficientPotAssets`). A request can be made that cannot be paid yet; the
approving transaction then reverts and the request stays pending. The app must
check both before letting anyone ask or approve.

**How requests expire.** 7 days after `createdAt`. `approve` reverts with
`ProposalExpired` after that. **Expiry emits no event**: the app works it out
from `createdAt + PROPOSAL_TTL` against the finalized block's timestamp, or
from `proposalInfo(id).status`. A decider can `revokeApproval` before
execution, and only the asker can `cancelProposal`. There is no "no" vote.

**Who can pause and what a pause blocks.** Any single decider can
`freeze(potId)`, alone, with no proposal. It blocks new funding and payouts
(`fund`, `fundWithPermit`, `proposePayout`, `approve` on a payout). It does
**not** block exits, claims, close proposals or approving a close. Unfreezing
needs a threshold approved `proposeUnfreeze`. There is no direct unfreeze.

**How and when a pot closes.** Two ways. (1) Automatically at `endTime`: the
pot behaves as closed from that second whether or not anyone calls anything.
`closePot(potId)` is permissionless after `endTime` and exists only to emit a
`Closed` event. (2) Early, by a threshold approved `proposeClose`. After close:
no funding, no payouts.

**Can someone take their share out before close?** Yes. `exit(potId, shares)`
works in every state: open, frozen, closed. It pays the caller's pro rata
share of what is currently unspent.

**How leftovers are claimed.** After close, each funder calls `claim(potId)`,
which burns all their shares for their pro rata share. Pull only; nothing is
sent to anyone automatically. An `exit` after close emits `Claimed`, not
`Exited`.

**Can deposits use permit?** Yes, `fundWithPermit(potId, amount, deadline, v,
r, s)`, one transaction. Both tokens support EIP-2612 (see the permit trap for
AUSD's domain). A failed permit is swallowed, so the app should confirm the
funder's permit nonce went up.

**How the creator and names are stored.**
* **Creator:** not in storage. Only in `PotCreated` as the indexed `creator`
  topic. The creator need not be a decider.
* **Pot name:** `purpose`, `bytes32`, on chain, readable through `getPot`. At
  most 32 bytes of UTF-8 ("Mama's 60th" with a curly apostrophe is 13 bytes).
* **Destination names:** `bytes32` labels on chain, through `getDestinations`.
  Also at most 32 bytes.
* **People's names, cities, time zones:** not stored. These travel as the
  creator signed JSON in the invite link's `#` fragment, accepted only if the
  signer equals the `creator` in `PotCreated`.

Since the contract stores the pot name and vendor names, the app reads those
from the chain, and the signed labels carry only what the chain does not.

## 3. Actions, screen by screen

Every function below is on the NivPayPots instance the pot lives on. "Events"
are what the transaction emits. Reverts are the contract's custom errors.

### Screen 1: Make a pot (`Live-Create`)

| Action | Function | Who may call | Preconditions | Events | Reverts |
| --- | --- | --- | --- | --- | --- |
| Make the pot | `createPot(bytes32 purpose, address[] approvers, uint8 threshold, address[] destinations, bytes32[] destinationLabels, uint256[] destinationCaps, uint64 endTime) returns (uint256 potId)` | anyone | purpose not zero; 1 to 10 deciders, unique, none zero; 1 to 10 destinations, none zero or the contract; equal array lengths; every limit above 0; 1 <= threshold <= deciders; endTime in the future | `PotCreated(potId, creator, purpose, approvers, threshold, destinations, destinationLabels, destinationCaps, endTime)` | `EmptyPurpose`, `BadApproverCount`, `BadDestinationCount`, `ArrayLengthMismatch`, `BadThreshold`, `EndTimeInPast`, `ZeroAddress`, `DuplicateApprover`, `ZeroCap` |
| Who decides, pours only to, closes, leftover | inputs to `createPot` | | | | |
| Share the invite link | no contract call | | | | |

The potId is not known until the receipt: read it from `PotCreated`.

### Screen 2: Pour in your share (`Live-ChipIn`)

| Action | Function | Who | Preconditions | Events | Reverts |
| --- | --- | --- | --- | --- | --- |
| Pour in | `fundWithPermit(uint256 potId, uint256 amount, uint256 deadline, uint8 v, bytes32 r, bytes32 s) returns (uint256 sharesMinted)` | anyone | pot exists, open (not closed, not past endTime), not frozen, amount > 0, balance >= amount, a valid permit or an existing allowance | token `Approval` (from the permit) and `Transfer`, `Funded(potId, funder, assets, sharesMinted)` | `NoSuchPot`, `PotClosed`, `PotFrozen`, `ZeroAmount`, `ZeroShares`, `TransferAmountMismatch`, the token's own balance or allowance error |
| Fallback without permit | token `approve(pots, amount)` then `fund(potId, amount)` | anyone | same | `Approval`, then `Transfer` and `Funded` | same |
| Add test dollars (TESTUSD mode) | TESTUSD `mint(address to, uint256 amount)` | anyone | amount <= `MAX_MINT` | `Transfer(0x0, to, amount)` | `MintAboveCap(amount, cap)` |

### Screen 3: Approve a pour (`Live-Approve`)

| Action | Function | Who | Preconditions | Events | Reverts |
| --- | --- | --- | --- | --- | --- |
| Ask to pour (from the story screen) | `proposePayout(uint256 potId, uint16 destIndex, uint256 amount) returns (uint256 proposalId)` | a decider of that pot | pot open, not frozen, destIndex exists, amount > 0 | `Proposed(proposalId, potId, proposer, kind=0, destIndex, amount, expiresAt)`, `Approved(proposalId, potId, proposer, 1)`, and if the threshold is 1, `PayoutExecuted` | `NoSuchPot`, `PotClosed`, `PotFrozen`, `NoSuchDestination`, `ZeroAmount`, `NotApprover`, plus the execution reverts if it pays at once |
| Approve the pour | `approve(uint256 proposalId)` | a decider who has not approved | pending, not expired, not frozen (for payouts) | `Approved(proposalId, potId, approver, approvals)`; at threshold also token `Transfer` to the destination and `PayoutExecuted(proposalId, potId, destination, destIndex, amount, fee)` | `NoSuchProposal`, `NotApprover`, `ProposalNotPending`, `ProposalExpired`, `AlreadyApproved`, `PotFrozen`; at threshold `PotClosed`, `CapExceeded`, `InsufficientPotAssets`, or the token's transfer error |
| Not yet | no call if the viewer has not approved. If they have, `revokeApproval(uint256 proposalId)` | a decider who approved | not executed or cancelled | `ApprovalRevoked(proposalId, potId, approver, approvals)` | `NoSuchProposal`, `ProposalNotPending`, `NotApproved` |
| Pause all pours | `freeze(uint256 potId)` | any one decider | not already frozen | `Frozen(potId, approver)` | `NoSuchPot`, `NotApprover`, `PotFrozen` |
| Cancel a request (not in the comps) | `cancelProposal(uint256 proposalId)` | the asker only | not executed or cancelled | `ProposalCancelled(proposalId, potId, proposer)` | `NoSuchProposal`, `NotProposer`, `ProposalNotPending` |
| Unpause (not in the comps) | `proposeUnfreeze(potId)` then `approve` | deciders | pot frozen | `Proposed(kind=2)`, `Approved`, at threshold `Unfrozen(potId, proposalId)` | `PotNotFrozen`, `NotApprover`, the `approve` reverts |

### Screen 4: The pot's story (`Live-Timeline`)

| Action | Function | Who | Preconditions | Events | Reverts |
| --- | --- | --- | --- | --- | --- |
| Replay | no call; replays the event feed | | | | |
| Ask to pour | `proposePayout`, as above | a decider | as above | as above | as above |
| Take my share out | `exit(uint256 potId, uint256 shares) returns (uint256 assets)` with all of `sharesOf(potId, me)` | anyone holding shares | shares > 0 and <= held | token `Transfer`, `Exited(potId, funder, sharesBurned, assets)` (`Claimed` if the pot is closed) | `NoSuchPot`, `ZeroShares`, `InsufficientShares`, the token's transfer error |
| More options, close early | `proposeClose(uint256 potId)` then `approve` | deciders | pot not closed | `Proposed(kind=1)`, `Approved`, at threshold `Closed(potId, true, remainingAssets)` | `PotClosed`, `NotApprover`, the `approve` reverts |

### Screen 5: Close and split (`Live-Close`)

| Action | Function | Who | Preconditions | Events | Reverts |
| --- | --- | --- | --- | --- | --- |
| Take my $57.80 | `claim(uint256 potId) returns (uint256 assets)` | anyone holding shares | pot closed | token `Transfer`, `Claimed(potId, funder, sharesBurned, assets)` | `NoSuchPot`, `PotNotClosed`, `ZeroShares` (nothing to claim), the token's transfer error |
| Record the close after the end time | `closePot(uint256 potId)` | anyone | `block.timestamp >= endTime`, not already flagged | `Closed(potId, false, remainingAssets)` | `NoSuchPot`, `PotClosed`, `PotNotClosed` |
| Share the story with the family | no contract call | | | | |

Not on any screen, listed for completeness: `collectFees()` (fee recipient
only, emits `FeesCollected`).

## 4. Numbers, screen by screen

All current numbers are view calls at the `finalized` block. History is events.

| Screen | Number or text | Source |
| --- | --- | --- |
| all | "$X in the pot" | `getPot(potId).totalAssets` |
| all | pot fill height | `totalAssets` over the sum of `getDestinations(potId)[i].cap`, per the design README |
| all | each person's layer | `funderInfo(potId, person).redeemable` for each known person (see G6) |
| all | "Live", closed, frozen state | `getPot(potId).closed`, `.frozen` |
| all | token label and symbol | `token()` then the token's `symbol()` and `decimals()` |
| Create | "up to $700", "up to $300" | inputs; after creation `getDestinations(potId)[i].cap` |
| Create | "2 of 3" | `getPot.threshold`, `getPot.approverCount` |
| Create | "Closes Thu 31 Dec 2026" | `getPot.endTime`, formatted with `Intl.DateTimeFormat` |
| Chip in | "Idara $500" per person | sum of `Funded.assets` per funder from events |
| Chip in | "Aniekan not yet" | no `Funded` event from that address |
| Chip in | "From your balance of $620.00" | token `balanceOf(me)` at finalized |
| Chip in | "2 of 3 must agree" | `getPot.threshold`, `approverCount` |
| Approve | "wants to pour $600 to the Caterer" | `proposalInfo(id).amount`, `.destIndex` to the on-chain label |
| Approve | asker name and time "14 Oct, 09:12 in Uyo" | `Proposed.proposer`, `proposalInfo.createdAt`, the asker's time zone from labels |
| Approve | "NivPay fee $3.00" | `proposalInfo(id).fee` (equals `feeOn(amount)`) |
| Approve | "Left in the pot after $397.00" | `totalAssets - amount - fee` |
| Approve | "Caterer limit $600 of $700" | `getDestination(potId, i)`: `spent + amount` of `cap` |
| Approve | Asked / You / Waiting chips | `proposalInfo.proposer`, `.approvedBy`, `hasApproved(id, me)` |
| Approve | "1 more yes pours it" | `proposalInfo.threshold - .approvals` |
| Approve | each person's local time | the person's IANA zone from labels, formatted now |
| Story | "$115.60 left in the pot" | `getPot.totalAssets` |
| Story | Caterer "$600 of $700" | `getDestinations`: `spent` of `cap` |
| Story | event rows "Ubong added $400.00" | `Funded` |
| Story | "Poured $600.00 to the Caterer, Aniekan asked, Ubong approved, fee $3.00" | `PayoutExecuted` (amount, fee), `Proposed.proposer`, the last `Approved` |
| Story | "you made the pot" | `PotCreated.creator` |
| Story | dates on rows | the block timestamp of each log (`eth_getBlockByNumber`), one fetch per block, cached |
| Story | "Take my share out $57.80" | `funderInfo(potId, me).redeemable` |
| Story | "Party in 21 days" | not on chain, see G5 |
| Close | "Closed 14 Dec" | `Closed` event block timestamp, or `endTime` if nobody called `closePot` |
| Close | "You asked, Ubong agreed" | `Proposed` (kind Close) and `Approved` for that proposal |
| Close | "$1,000 went in" | sum of `Funded.assets` |
| Close | "$880 paid for the party" | sum of `PayoutExecuted.amount` |
| Close | "$4.40 went on fees" | sum of `PayoutExecuted.fee` |
| Close | "The last $115.60" | `Closed.remainingAssets`, or `getPot.totalAssets` before anyone claims |
| Close | "$57.80, $46.24, $11.56" | `funderInfo(potId, person).redeemable` per person, then `Claimed.assets` once taken |
| Close | "You put in $500, half the pot" | your `Funded` sum over the total `Funded` sum, adjusted for exits |
| Close | "Your share, In your balance" | `Claimed` event for you, then token `balanceOf(me)` |

## 5. Gaps and how to handle each without changing the contracts

**G1. Invites fly out after the pot is made (Create).** In case B the deciders
and vendors have already joined before `createPot`, because their addresses
are arguments. Handling: a draft pot on the creator's phone; each decider and
each vendor opens a join link, signs up, and sends their address back as a
link. The Create animation's "invites fly out" should mean "the pot is live
and locked, here is the link to share", not a first invitation. The done copy
"Invites went to Ubong and Aniekan" needs rewording, since nothing is sent.

**G2. The request note ("Deposit for jollof, small chops and drinks").** Not
stored anywhere. **Decided:** the note travels only in the share link the
requester sends to the other deciders, in the `#` fragment, signed by the
requester's account as EIP-712 typed data over the pots contract, the chain
id, the `proposalId` and the note. The app shows the note only if the
signature recovers to `Proposed.proposer` for that `proposalId` on that
contract. No valid signature, no note. Unsigned text is never shown, not even
greyed out. Opening the request without the link shows it without a note.

**G3. "Not yet".** There is no "no" vote on chain. **Decided:** "Not yet" only
closes the screen; it sends nothing. Under the buttons, one line, filled from
the contract: "Requests need 2 yeses within 7 days, or they expire." (2 is
`getPot.threshold`, 7 days is `PROPOSAL_TTL`.) A decider who already said yes
can still take it back with `revokeApproval`, from the request's detail, as a
separate action with its own label.

**G4. Pause.** **Decided:** the label says what it really does, and a short
confirm sheet says exactly what stops and what does not, read from the code
(`frozen` is checked in `_fund`, `proposePayout`, `approve` for payouts and
`_executePayout`, and nowhere else):

| While paused | |
| --- | --- |
| Pour-ins (`fund`, `fundWithPermit`) | **stopped** |
| New payment requests (`proposePayout`) | **stopped** |
| Saying yes to a payment, so no payment can go out | **stopped** |
| Taking your own share out (`exit`) | still works, for everyone |
| Leftovers after close (`claim`) | still work |
| Closing the pot early (`proposeClose` and its yeses) | still works |
| Taking back a yes, cancelling your own request | still works |
| Requests already waiting | not cancelled, and their 7 days keep running |

Pausing takes one decider. Unpausing takes the pot's usual number of yeses,
through an "Ask to unpause" request (`proposeUnfreeze`). Proposed label:
"Pause payments and pour-ins". The sheet must not say or imply that pausing
protects anyone's money: money in the pot is already safe from everyone but
the listed destinations, and every person can still take their own share out
while paused.

**G5. Party date.** **Decided:** an optional date in the creator's signed
labels. When it is absent, nothing about a party date is shown.

**G6. Per-person layers and amounts.** The contract has no funder list.
Handling: the known people (deciders plus anyone in the labels) are queried
with `funderInfo`, which needs no history. Unknown funders are found from
`Funded` events and shown as a shortened address.

**G7. Suggested share ($400 on the Chip-in stepper).** Not stored; any amount
is accepted. Handling: an optional suggested amount per person in the signed
labels; the stepper starts there.

**G8. Payments that cannot be paid yet.** `proposePayout` accepts an amount
above the remaining limit or above what the pot holds; only the final approve
fails. Handling: the app blocks asking and approving when `spent + amount >
cap` or `amount + fee > totalAssets`, and simulates with `eth_call` before
every send.

**G9. Expiry and time based close have no events.** **Decided for expiry:**
a request's start is the timestamp of the block that holds its `Proposed`
log (equal to `proposalInfo.createdAt`), and it is expired when the finalized
block's timestamp is greater than start plus `PROPOSAL_TTL` read from the
contract, the same `>` the contract uses in `approve`. The app shows
"expired" from that alone, with no event needed. The time based close is
derived the same way from `endTime` (closed when the finalized timestamp is
at or past `endTime`, as `_isClosed` does). Optionally the app calls
`closePot` once after `endTime` (43,293 gas) so the story has a real `Closed`
row.

**G10. Notifications.** "Idara and Aniekan can see it now" and "invites went
to" imply delivery. Nothing is pushed. People see changes when they open the
app. Handling: share links over chat for invites and requests; copy says
"can see it when they open the pot".

**G11. Who approved which payment.** `PayoutExecuted` does not name the
approvers. Handling: from the `Approved` events for that `proposalId`, less
any `ApprovalRevoked`.

**G12. "Held as AUSD digital dollars".** True only on the AUSD instance.
Handling: the AUSD balance is labelled "Dollars" with "Held as AUSD, a
digital dollar issued by Agora."; TESTUSD shows "test dollars, not real
money". Which line applies comes from `token()`.

**G13. The creator is not stored.** Handling: `PotCreated.creator`, which is
also what signed labels are checked against. Invite links carry the pot's
creation block so this is one `eth_getLogs` page, not a search.

## 6. Measurements

### RPC, finality and logs

Taken with curl against `https://testnet-rpc.monad.xyz` from this machine.

* **`finalized` works.** `eth_getBlockByNumber` answers `latest`, `safe` and
  `finalized`. In one batched request (all three tags in one call), `safe` was
  1 block behind `latest` and `finalized` 2 behind, in 8 of 8 samples.
  `eth_call` and `eth_getLogs` both accept `"finalized"` as the block tag.
* **Block time: 0.31 s.** The finalized head advanced 198 blocks in 61.0 s of
  wall time (0.308 s per block), and 100,000 blocks spanned 31,129 s of chain
  time (0.311 s). So finalized is about 0.6 s behind latest.
* **`eth_getLogs` limit: `toBlock - fromBlock` at most 100**, which is 101
  blocks inclusive, about 31 s of chain. 102 blocks is refused with HTTP 413
  and `{"code":-32614,"message":"eth_getLogs is limited to a 100 range"}`. The
  limit is the same with and without an address filter. Pages must be 101
  blocks.
* **Consequence for history:** one day of chain is about 278,000 blocks, which
  is about 2,750 `eth_getLogs` pages. A one day old pot takes minutes to
  backfill on a phone; a month old pot is not practical. Live polling is fine:
  1 request per second covers about 3 new blocks. This is the known limit for
  the README, and why the invite link carries the creation block.
* **Latency and reliability.** 30 of 30 `eth_blockNumber` calls succeeded,
  median 0.56 s, worst 0.64 s. Earlier the same morning, 4 of the first 12
  batched calls failed outright (no response inside 15 s) and 2 single calls
  hung past 30 s. Failures come in bursts. The app needs timeouts and retries
  on every RPC call.
* **State overrides work** in `eth_call` and `eth_estimateGas` on this RPC.

### Gas and fee per action

Method: a Forge script replayed the Mama's 60th story on a fork of testnet
against the deployed contracts and recorded every storage slot each step wrote
(scratch harness, not committed). Then, for each action, curl sent
`eth_estimateGas` to the live testnet RPC with all earlier writes as a state
override, twice. Both answers were identical for every action. The funders
were throwaway simulation wallets that exist only in the override.

Fee = gas limit x gas price, because Monad charges the limit. Gas price at
measurement: `eth_gasPrice` = 102 gwei (base fee 100 gwei).

| Action | Gas (TESTUSD pot) | MON | Gas (AUSD pot) | MON |
| --- | ---: | ---: | ---: | ---: |
| `createPot`, 3 deciders, 2 destinations | 434,799 | 0.0443 | 434,799 | 0.0443 |
| `fundWithPermit`, first funder | 237,011 | 0.0242 | 260,268 | 0.0265 |
| `fundWithPermit`, later funder | 185,607 | 0.0189 | 208,864 | 0.0213 |
| token `approve` (no permit path) | 52,942 | 0.0054 | | |
| `fund` after approve | 127,845 | 0.0130 | | |
| `proposePayout` (below threshold) | 157,953 | 0.0161 | 157,953 | 0.0161 |
| `approve` that reaches threshold and pays | 192,399 to 209,522 | 0.0196 to 0.0214 | 218,219 | 0.0223 |
| `revokeApproval` | 55,816 | 0.0057 | | |
| `cancelProposal` | 43,571 | 0.0044 | | |
| `freeze` | 51,122 | 0.0052 | | |
| `proposeUnfreeze` | 131,750 | 0.0134 | | |
| `approve` that unfreezes | 100,464 | 0.0102 | | |
| `proposeClose` | 131,915 | 0.0135 | | |
| `approve` that closes | 100,986 | 0.0103 | | |
| `exit` all shares | 97,991 | 0.0100 | 106,723 | 0.0109 |
| `claim` | 98,369 | 0.0100 | | |
| `closePot` after end time | 43,293 | 0.0044 | | |
| `collectFees` | 89,402 | 0.0091 | | |
| TESTUSD `mint`, the first ever | 81,182 | 0.0083 | | |
| TESTUSD `mint`, later | 64,115 | 0.0065 | | |
| plain MON transfer (for `/api/fund`) | 21,000 | 0.0021 | | |

Notes:
* `createPot` gas depends slightly on the addresses (calldata bytes): the same
  shape with different addresses estimated 434,146.
* AUSD costs about 23,000 more per funding and 9,000 more per payout than
  TESTUSD, because its transfers do more (proxy, freeze checks).
* The first payout in the story (a fresh destination slot) cost 209,522, the
  second 192,399.
* Per person in the full story, TESTUSD: the creator about 1.14M gas (0.116
  MON), another decider about 0.66M to 0.70M (0.067 to 0.071 MON). This sizes
  the `/api/fund` top up in Phase 2.
* Estimates are what the app should use as the gas limit, unpadded. They are
  exact for the state they were made against; the app should estimate each
  transaction just before sending, not reuse these figures.

## 7. Toolchain

| Check | Result |
| --- | --- |
| `node -v` | v24.15.0 (20 or newer required: OK) |
| `npm -v` | 9.6.2 (old for Node 24, which ships npm 11; works, but worth updating) |
| `forge --version` | 1.8.3 |
| Shell | Git Bash (MINGW64) and PowerShell, natively on Windows 11. `docs/BUILD-APP.md` now says so. |

## 8. Bounty requirements (`docs/BOUNTIES.md`)

| Requirement | How the app meets it |
| --- | --- |
| A mobile application | The PWA, wrapped as an Android app with Bubblewrap (Trusted Web Activity) in a phase after Phase 4 |
| Send AUSD to another person or across borders | Chipping in AUSD from London, Houston and Uyo into the AUSD pot, and the pot paying the Caterer, a real passkey account on the second phone. Both ends shown |
| Mera passkey onboarding | Sign up and sign in with Mera PRF passkeys, per BUILD-APP.md |
| An AUSD balance | AUSD `balanceOf` at the finalized block, shown on the chip-in screen and home |
| A completed send and receive settled instantly | The Caterer's phone shows AUSD arriving on the finalized `PayoutExecuted`; each receipt shows measured submit to finalized time. Finalized is about 0.6 s behind latest (measured above); the full submit to finalized time will be measured in Phase 2 with a real transaction |
| AUSD, not TESTUSD, in the demo | The demo uses the AUSD pot `0xB9E6...9EfB`. TESTUSD stays for testing |
| Where test AUSD comes from | **Blocker.** Agora's faucet `0xd236...ee6C` is AUSD's faucet (`token()` = AUSD) and is called with `requestFunds(address)`: 10,000 AUSD per claim, one claim per 60 s, refused once you hold 100,000. It currently holds **1 base unit** (0.000001 AUSD), so it cannot pay out. Test AUSD must come from Agora directly |
| Agora's API, staging | Not built until you confirm staging access, as you said |
| Business viability | The fee is shown on every payment (`proposalInfo.fee`) and in the close summary (sum of `PayoutExecuted.fee`) |
| Implementation quality, real-world usability | Covered by the rest of BUILD-APP.md |

One more point on "send to another person": the pot can only pay destinations
listed at creation. A plain AUSD transfer between two accounts (the token's
own `transfer`) would be a simple "send to anyone" without touching the
contracts, if you want one in the demo. I have not planned it in.

## 9. Decisions on writes, invites and accounts

### Retries

* **Reads** retry with exponential backoff and full jitter, with a timeout on
  every call and a cap on attempts. Reads are idempotent, so this is safe.
* **Writes are signed once.** The signed transaction's raw bytes and hash are
  kept (in IndexedDB, keyed by account, so a reload resumes tracking; a
  signed transaction is not a secret). A retry re-broadcasts the same bytes
  and tracks the same hash. A second copy of the same signed transaction can
  never be a second payment.
* **A new transaction is built only after the old nonce is confirmed unused
  at finalized**: the account's nonce at the finalized block still equals the
  old transaction's nonce and the old hash is still unknown. The new one
  **reuses that same nonce**, so even if the old one surfaces late, at most
  one of the two can ever be included.
* **One write in flight per account.** Buttons that send are disabled while a
  write for that account is pending, across tabs (the IndexedDB record is the
  lock), so a double tap cannot make two transactions.
* Why the nonce rule matters most for pour-ins: if a retry signed a fresh
  `fundWithPermit` with a new account nonce and a fresh permit, both could be
  included and the person would pour in twice. Same bytes, or same nonce,
  closes that.

### Invites, case B

* The creator's draft has a random 128-bit draft id and lives on the
  creator's phone.
* **Join links carry proof.** When someone joins, their app signs EIP-712
  typed data over `{draftId, role, name, address}` with their account, where
  role is decider or destination. The link back to the creator carries that
  in its `#` fragment. The creator's app accepts it only if the signature
  recovers to the address in it and the draft id is one of its own drafts.
* **Pasted vendor Account IDs.** For a vendor not on NivPay, the creator
  can paste the vendor's Account ID (on screen it is never called an
  address). It must be a valid address; if it is written in mixed case, its
  EIP-55 checksum must be right. Because destinations are fixed forever, the
  creator then types its last 4 characters to confirm it. This applies to
  every pasted Account ID, not only suspicious ones.
* **The confirm screen before "Make the pot"** lists every decider and every
  destination as "account ending 7bC1", whether it joined by link or was
  pasted, and says that none of it can ever change.
* **Switch account.** One phone can hold more than one account for testing.
  The app stores a list of addresses, one per passkey, and "Switch account"
  asks for that account's passkey. Keys are still never stored; only
  addresses are.

## 10. History, planned for after Phase 3 (not built yet)

The 100 block `eth_getLogs` limit makes backfilling an old pot on a phone
impractical (section 6). The plan:

* **A free GitHub Actions job every 5 minutes** (the repo is public, so the
  minutes are free). It reads a cursor, pages `eth_getLogs` in 101 block
  windows from the cursor to the `finalized` block for both NivPayPots
  addresses, and appends the new logs to JSON snapshots: one file per pot
  (`history/<contract>/<potId>.json`) plus an index holding the last block
  covered. It commits them to a separate data branch, never to `master`.
  Five minutes of chain is about 970 blocks, so about 10 requests per run.
  The first run backfills from the deploy blocks (about 1,000 requests once).
* **Only finalized blocks** go into the snapshot, so nothing in it can be
  reverted and the job needs no reorg handling.
* **The app loads the pot's snapshot first**, from its own origin through a
  Vercel rewrite to the data branch, so `connect-src` stays `'self'` plus the
  RPC. It then follows from the snapshot's last block to finalized over RPC,
  in 101 block pages, exactly as live polling does. If the snapshot is
  missing or unreachable, it falls back to scanning from the pot's creation
  block.
* **The snapshot is for history only.** Money numbers (balances, shares,
  limits used, what is left) still come only from view calls at the
  finalized block, never from the snapshot.
* **Untrusted input.** Each snapshot row keeps its block hash and log index.
  For the pot on screen, the app re-reads the logs of each referenced block
  by block hash (one call per block, bounded by the pot's size) before
  showing a row as confirmed.
* **Known limits:** GitHub runs scheduled jobs late or skips them under load,
  so the snapshot can be minutes behind (the live follow covers that). A
  scheduled workflow is paused after 60 days without repository activity.
  The job uses the public RPC and needs no secret, only permission to push to
  its data branch.
