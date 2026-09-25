# NivPay

**A pot is a group purse for one purpose that no single person can pocket.**

Money goes in from anyone. It can only come out to destinations fixed when the
pot was created, and only when enough of the named approvers agree. When the
pot ends, whatever is left goes back to the people who put it in, split by what
they contributed.

Built for the Monad Metropolis hackathon, Consumer Products and Payments track.
Contracts only, no frontend. The whole product is
[`src/NivPayPots.sol`](./src/NivPayPots.sol).

## The problem

Every group that collects money for one thing has the same two fears. The
person holding the money might spend it on something else, and the person
holding the money might simply keep it. The usual answer is to trust somebody.
A pot removes the need to.

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

878.7 of the 1000 leaves the pot and 121.3 remains, split by contribution with
no dust left over. The test asserts
`paid out + fees + claimed == funded` exactly.

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

One immutable token, set in the constructor: **AUSD**.

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

## Tests

```powershell
forge test
```

149 test cases. The one skip is the faucet test, which skips only when Agora's public
faucet is out of stock (see below). The fork tests need network access; the rest
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

## Deployment

**Nothing here has been broadcast.** The steps below are prepared and the dry
run has been verified against the live chain. Run them yourself.

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

`quick` runs **every test the default profile runs**, all 7 suites and the same
152 cases, under the same Monad execution rules and the same invariant depth.
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

`cast wallet import` prompts for the private key and then for a password, echoes
neither, and writes only an encrypted keystore file under
`~/.foundry/keystores/nivpay-deployer`. **Nothing in this repository writes a
private key to any file, and none of these commands takes one as an argument,
so no key ends up in your PowerShell history.**

```powershell
# Paste the private key at the prompt, then choose a password.
# Neither is echoed, and neither is written anywhere in plain text.
cast wallet import nivpay-deployer --interactive

# Confirm the keystore exists and holds the address you expect.
cast wallet address --account nivpay-deployer

# Check that address has MON for gas. The dry run needs about 0.61 MON.
$addr = cast wallet address --account nivpay-deployer
cast balance $addr --rpc-url https://testnet-rpc.monad.xyz
```

To generate a fresh key on this machine instead of importing one:

```powershell
# Write the mnemonic down offline. It is printed once and not saved.
cast wallet new-mnemonic

# Then import the private key it derives, with the interactive command above.
cast wallet import nivpay-deployer --interactive
```

To check what keystores already exist, or to start over:

```powershell
Get-ChildItem ~/.foundry/keystores

# Only if you want to replace it. This is irreversible: make sure the key is
# backed up elsewhere first.
Remove-Item ~/.foundry/keystores/nivpay-deployer
```

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

### Broadcast receipts are committed on purpose

`broadcast/Deploy.s.sol/10143/` is **deliberately not gitignored**. The receipt
from a real deploy gets committed, as provenance.

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

A scan of the full object store, reachable and unreachable, found no private
key, mnemonic or keystore material anywhere in this repository's history. The
longest hex literal in the entire history is 40 characters: the three public
contract addresses above.

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
| `maxDripFrequency()` | `60` | one claim per 60 seconds |
| `maxAmountToOwn()` | `100000000000` | refuses if you already hold 100,000 AUSD or more |
| `token()` | `0xa901...22dC` | the same AUSD this contract uses |

Check it has stock before trying, because it reverts with `InsufficientFunds()`
once its balance is down to a single drip:

```powershell
cast call 0xa9012a055bd4e0eDfF8Ce09f960291C09D5322dC "balanceOf(address)(uint256)" 0xd236c18D274E54FAccC3dd9DDA4b27965a73ee6C --rpc-url https://testnet-rpc.monad.xyz
```

At the time of writing it holds exactly one drip and therefore refuses, which is
why `test_fork_faucetDispensesAusd` skips rather than fails.

## A note on the benchmark files

This repository also contains an earlier settlement benchmark: `StreamBench`,
`MockStable`, their tests, `script/cost_model.py` and
[BENCHMARK.md](./BENCHMARK.md). That benchmark evaluated a **streaming**
subscription design that has since been **replaced** by the pot design above.

The files are kept untouched as evidence of process, and their tests still run
and still pass as part of the suite. Nothing in `NivPayPots` depends on them.

## Layout

    src/NivPayPots.sol            the pot contract, the whole product
    script/Deploy.s.sol           deployment, with live chain preflight checks

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
