# NivPay

**A pot is a group purse for one purpose that no single person can pocket.**

Money goes in from anyone. It can only come out to destinations fixed when the
pot was created, and only when enough of the named approvers agree. When the
pot ends, whatever is left goes back to the people who put it in, split by what
they contributed.

Built for the Monad Metropolis hackathon, Consumer Products and Payments
track. [CHECK: the track name matches the one you enter on the submission
form.] The repository has two parts:

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

## The problem, and who it is for

Every group that collects money for one thing has the same two fears. The
person holding the money might spend it on something else, and the person
holding the money might simply keep it. The usual answer is to trust somebody.
A pot removes the need to.

The intended user is a family or group of friends spread across countries,
paying for one shared thing together: a parent's birthday, a wedding, a
funeral, school fees. Today one relative collects everyone's transfers into
their own account and pays the vendors, and everyone else has to trust them.
The story the app is built and tested around is "Mama's 60th": three siblings
in London, Houston and Uyo pay for their mother's party, and the money can only
ever reach the caterer and the event hall. [CHECK: the list of example uses.]

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

## Contract addresses

Monad testnet, chain id `10143`, RPC `https://testnet-rpc.monad.xyz`. The
explorer is [MonadVision](https://testnet.monadvision.com), which reads
verified source from Monad's Sourcify. The "Verified" links below are the
Sourcify records themselves, so anyone can check them; each was checked on 9
Oct 2026.

| Contract | Address | Verified source | What it is for |
| --- | --- | --- | --- |
| NivPayPots on AUSD | [`0xB9E68db3117Db149dF56F5Aa29CF6adaA2369EfB`](https://testnet.monadvision.com/address/0xB9E68db3117Db149dF56F5Aa29CF6adaA2369EfB) | [exact match](https://sourcify-api-monad.blockvision.org/v2/contract/10143/0xB9E68db3117Db149dF56F5Aa29CF6adaA2369EfB) | The product. Pots funded in AUSD. The app runs on this by default. |
| NivPayPots on TESTUSD | [`0xe80FBB5F77Cb87d4f588A3F21bf9Eae34fC996aA`](https://testnet.monadvision.com/address/0xe80FBB5F77Cb87d4f588A3F21bf9Eae34fC996aA) | [exact match](https://sourcify-api-monad.blockvision.org/v2/contract/10143/0xe80FBB5F77Cb87d4f588A3F21bf9Eae34fC996aA) | The same bytecode bound to TESTUSD, the fallback for testing. |
| NivPayTestDollar (TESTUSD) | [`0x9FD60818e0DFee982d677cd72FbC3601Cc2eB6f7`](https://testnet.monadvision.com/address/0x9FD60818e0DFee982d677cd72FbC3601Cc2eB6f7) | [exact match](https://sourcify-api-monad.blockvision.org/v2/contract/10143/0x9FD60818e0DFee982d677cd72FbC3601Cc2eB6f7) | A worthless test token anyone can mint, 100,000 per call. Testnet only. |
| AUSD (Agora) | [`0xa9012a055bd4e0eDfF8Ce09f960291C09D5322dC`](https://testnet.monadvision.com/address/0xa9012a055bd4e0eDfF8Ce09f960291C09D5322dC) | not on Monad's Sourcify (see below) | Agora's six decimal dollar. Not ours. |
| Agora AUSD faucet | [`0xd236c18D274E54FAccC3dd9DDA4b27965a73ee6C`](https://testnet.monadvision.com/address/0xd236c18D274E54FAccC3dd9DDA4b27965a73ee6C) | not on Monad's Sourcify (see below) | Dispenses test AUSD. Not ours. |
| Agora Instant Settlement pair, AUSD and CTK | [`0x1Aa8958Aa34cEC8096EF4381cb335effe977b0ae`](https://testnet.monadvision.com/address/0x1Aa8958Aa34cEC8096EF4381cb335effe977b0ae) | proxy; its implementation `0x1a5d115a87e39fd8d8c9e53b91dbe5e0ec309dd2` is a [Sourcify match](https://sourcify-api-monad.blockvision.org/v2/contract/10143/0x1a5d115a87e39fd8d8c9e53b91dbe5e0ec309dd2) | Delivers a payment in another currency at a fixed price. Not ours. |
| Agora whitelister | [`0x7c10F56d6f04a51376393a1C3670e966863F6BD5`](https://testnet.monadvision.com/address/0x7c10F56d6f04a51376393a1C3670e966863F6BD5) | proxy; implementation not verified | Grants an account permission to send through the pair. Not ours. |
| CTK (ConstantToken) | [`0x7BEb5D9DB0d85cBEa543C04f0dE8c23c2176cd9D`](https://testnet.monadvision.com/address/0x7BEb5D9DB0d85cBEa543C04f0dE8c23c2176cd9D) | not on Monad's Sourcify | Agora's 18 decimal test currency on the other side of the pair. Not ours. |

AUSD and the faucet are Agora's contracts. Both are EIP-1967 proxies: AUSD's
implementation is `0xc1e3C7D486d6A92fBE920232E439EeC2cEb112dA` and the
faucet's is `0xba804DF5c476E8EaeF87BF8085F295300ccE2a49`, read from the
standard implementation slot. On 9 Oct 2026 Monad's Sourcify had no match for
either proxy or either implementation. [CHECK: whether MonadVision or Monadscan
shows Agora's verified source by another route; if so, link it here.]

The three NivPay contracts were deployed from
`0x7EAf7f3e330ac388A0e951e80957B7274597297c`. Their deploy transactions, from
the committed broadcast receipts under `broadcast/*/10143/`:

```
NivPayPots on AUSD          0xa2de65f6cdc7bcd8ab0d3e4e11f7652fb2e0392e2e5eff88bc31c4548a18a286
NivPayTestDollar (TESTUSD)  0x561e99082af17a9873948ccbe32b534b311777db6a995d6f48ee047440a5d856
NivPayPots on TESTUSD       0x68e15496691cfbe7bfa117db8e023141309a03e52b42e30b98fbca1bb19fe0eb
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
  proxies whose admin is `0x85f263d91f2706b32c85f22c681c0fe175eb48f2`, and
  that admin's only manager is the same
  `0x99B0E95Fa8F5C3b86e4d78ED715B475cFCcf6E97`. It can replace either
  contract's code (`upgradeAndCall`).
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
| App | React 19, TypeScript 7, Vite 8, viem 2.56, self hosted fonts, a service worker that caches the app shell only |
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
| `ALLOWED_ORIGINS` | Vercel, server | no | Comma separated extra origins allowed to call `/api/fund`, for example `http://localhost:5173`. The deployment's own origin is always allowed. |
| `VITE_PRODUCTION_HOSTNAME` | Vercel, build time | yes in production | The only hostname besides `localhost` where passkeys can be made or used. For this deployment, `nivpay.vercel.app`, and it must never change. |
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
| Only when the account holds under | 0.05 MON | above the most expensive single action, making a pot, about 0.044 |
| Only while the account has sent fewer than | 10 transactions | a full story is 5 to 7 per person |
| Only accounts with | no contract code | |
| Funder floor | 1 MON | granting stops before the funder can run dry |
| Kill switch | `FUNDING_ENABLED` not `true` | answers "funding is paused" without reading the key |

`GET /api/fund/status` returns only whether funding is on and the funder's
balance. Each grant is logged with the address, the amount and the
transaction hash; nothing else from the request is logged, and the key never
is.

**The honest limit.** These rules bound what one address can take, about 10
grants or 1 MON if someone deliberately spends each grant away. They do not
bound how many addresses someone can make, and new addresses cost nothing.
A determined abuser can therefore drain the funder down to its 1 MON floor,
where granting stops until it is refilled. The same-origin check only stops
other websites from using a visitor's browser; a script can send any Origin
header it likes. Two requests for the same address that reach different
server instances at the same moment can both be granted. None of this can
touch anyone's pot: the funder only ever holds testnet MON for gas.

**A gap for requests with several steps.** A grant is sent only to accounts
holding under 0.05 MON. A first payment in another currency signs three
requests whose gas limits add up to about 0.06 MON at today's price, so an
account holding between those two can neither afford it nor be topped up.
The app says so with code 93 before anything is signed; the account gets
back under the threshold by doing anything smaller first.

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
since been restocked: on 9 October 2026 it held 996,345,050 AUSD, and the app's
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

## Tests

```powershell
forge test
```

166 test cases. The one skip is the faucet test, which skips only when Agora's public
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
| `test/NivPayTestDollar.t.sol` | the TESTUSD test token: metadata, open mint, the per call mint cap, permit, refusal of every non test chain |

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

`quick` runs **every test the default profile runs**, all 8 suites and the same
166 cases, under the same Monad execution rules and the same invariant depth.
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
between 6 Sep and 9 Oct 2026. The history has not been rewritten or squashed.
[CHECK]

* The streaming benchmark (`StreamBench`, `MockStable`, `BENCHMARK.md`) was the
  first thing built in this repository, on 6 Sep 2026, inside the build window.
  It is an earlier design that was retired, not code from another project.
* No file here was copied from an earlier project. Checked on 9 Oct 2026 by
  comparing every tracked file's content hash against the files in the
  author's seven other local repositories: no file is identical. [CHECK: no
  code was pasted in from anywhere else, edited or not.]
* The design comps in `docs/design/` were taken from a "NivPay UI Concepts"
  design canvas and committed on 27 Sep 2026. [CHECK: when that canvas was
  made; if before 1 Sep 2026, list it here as pre-existing.]
* Third-party libraries are listed under
  [Third-party code and licenses](#third-party-code-and-licenses). They are
  used as published and are not this project's work.

## AI disclosure

**Claude Code, Anthropic's AI coding tool, was used across this whole
project**: the Solidity contracts and deploy scripts, the app and its
serverless functions, the Foundry and app tests, and the documentation,
including this README. A large share of the code and prose in this repository
was written by Claude Code from written instructions and then reviewed.
[CHECK: replace "a large share" with a description you are comfortable
stating, for example "most".] No other AI tool was used. [CHECK]

The instructions it worked from are in the repository: `docs/BUILD-APP.md` is
the app brief, and the "My notes on this bounty" section of `docs/BOUNTIES.md`
records the author's decisions for the Agora bounty. Commit messages carry no
AI attribution lines; this section is the disclosure.

What the human author, UEddy, did:

* **Product concept and rules.** The pot, and the rules it must keep: fixed
  destinations with caps, threshold approvals, any single approver can freeze
  but only a threshold can unfreeze, exits never blocked, the remainder
  returned pro rata. The "Mama's 60th" story. The decision to retire the
  streaming design in favour of pots. [CHECK]
* **Design decisions.** The chosen visual direction (the "Clay Pot" look with
  the Three Cities map in `docs/design/`), the motion rules in
  `docs/MOTION.md`, and the product language rule that no crypto word appears
  in the app. [CHECK: who made the design comps.]
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
* **Review** of the changes before they were committed. [CHECK: describe how
  you reviewed, for example every diff.]
* **Testing on real phones.** The passkey, pot and payment flows were tested
  by hand on two phones. [CHECK: which phones, operating systems and
  browsers.]
* **Deployment.** Ran the contract deployments and verification from their
  own keystore, created and funded the funder key and entered it in Vercel,
  and deployed the app to nivpay.vercel.app. [CHECK]

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
| `typescript` (dev) | 7.0.2 | Apache-2.0 | type-checking |
| `vite` (dev) | 8.3.1 | MIT | dev server and build |
| `@types/node`, `@types/react`, `@types/react-dom` (dev) | 24.19.0, 19.3.0, 19.3.0 | MIT | type definitions |

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
    docs/                         design, measurements, error codes, bounty and submission notes

## License

MIT, copyright (c) 2026 UEddy. See [LICENSE](./LICENSE). Third-party code keeps
its own license, listed under
[Third-party code and licenses](#third-party-code-and-licenses).
