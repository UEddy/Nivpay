# NivPay settlement benchmark

Measured 2026-09-06. All numbers below come from `forge test -vv` in this
repository plus `script/cost_model.py`, both reproducible from a clean
checkout. Nothing is deployed.

## The answer, up front

**Eager per batch settlement is viable on Monad, but only at cadences of
roughly a quarter of an hour or slower. It is not viable at any cadence that
would justify calling the product "streaming".**

The shortest cadence at which settlement cost stays under 1% of streamed value
is **about 686 seconds, or 11.4 minutes**, achieved by **variant C** (pull based
credit with the batch pre-grouped by payee) when payees have meaningful fan in.
With one payee per stream the same threshold sits at about **1,029 seconds, or
17.2 minutes**, and variant B wins by a hair instead.

Of the four cadences asked about, **only 3600s clears 1%**. The 300s cadence
does not clear it under any variant, in any configuration. To state the
negative results plainly:

| cadence | best variant | cost as pct of a $9 stream | clears 1% |
|---|---|---|---|
| 10s | C | 68.59% | no |
| 60s | C | 11.43% | no |
| 300s | C | 2.29% | no |
| 3600s | C | 0.19% | yes |

At a 10 second cadence with one payee per stream, settlement costs **102.91% to
126.45%** of the subscription depending on variant. Settling a $9 per month
stream every 10 seconds costs more than the stream is worth. That is not a
tuning problem, it is a structural one.

The choice of variant is close to irrelevant next to the choice of cadence.
Variant C beats variant B by 3% at high fan in and *loses* to it by 1% at low
fan in. Moving from A to C saves about 23%. Moving from a 60 second cadence to
a 900 second cadence saves 93%. **Cadence is the lever. The variant is not.**

## Why: the cost is in touching the stream, not in moving the money

The marginal cost of one stream in a steady state batch of 1000, at fan in 100,
under variant B, is 9,044 gas. It decomposes like this:

| component | gas | avoidable? |
|---|---|---|
| SLOAD stream slot 0 (payer, lastSettled, active), cold | 2,100 | no |
| SLOAD stream slot 1 (payee, ratePerSecond), cold | 2,100 | no |
| SSTORE stream slot 0, nonzero to nonzero | 2,900 | no |
| destination balance write, amortised over the payee's 100 streams | ~149 | this is what variant C attacks |
| calldata, 32 bytes per id | ~152 | partly, with tighter id packing |
| loop, dispatch, mapping keccaks, bounds checks | ~1,643 | marginally |

**7,100 gas of the 9,044, or 78%, is the stream struct itself.** Two cold reads
and one write, paid once per stream per settlement, no matter which variant
delivers the value. No settlement strategy that visits every stream on a
schedule can get below that floor. Variant C optimises the ~149 gas line item,
which is why it barely moves the total.

This is the finding that should drive the architecture. The question is not
"which settlement variant is cheapest", it is "how do I stop visiting every
stream on a timer at all".

## Method

| | |
|---|---|
| Foundry | forge 1.7.1, forge-std v1.16.2 |
| solc | 0.8.28, optimizer on, 200 runs, via-ir off |
| EVM target | cancun |
| Stream model | `{payer, payee, ratePerSecond, lastSettled, active}` packed into 2 slots |
| Accrual | one shared `_accrue` internal function, identical across A, B and C |
| Accrual window | 3600s per measured settlement, amount always nonzero |
| Measurement | `gasleft()` deltas around an external call |

Two things the harness does that a naive version would get wrong, each worth
more than the entire spread between the three variants:

**Cold storage.** A forge test body is a single transaction, so every slot
touched while seeding streams is still warm under EIP-2929 when the measured
call runs. Uncorrected, slots read at 100 gas instead of 2,100 and the whole
benchmark understates cost by close to an order of magnitude. My first run
produced 1,301 gas per stream for variant B this way. The corrected figure is
13,051. `vm.cool` is called on both contracts before every measured call, so the
numbers reflect a real settlement transaction, which always starts cold.

**Calldata.** N stream ids is N words of calldata, which a `gasleft()` delta
around the call never sees. At N = 10000 that is 1,516,804 gas, about 1% of a
Monad block, invisible in the execution trace. Intrinsic calldata gas is
computed byte by byte at the Cancun schedule (4 per zero byte, 16 per nonzero)
and added, along with the 21,000 transaction base amortised across the batch.

A consistency check on the corrected numbers: at fan in 1 the gap between the
first settlement and the steady state is 17,096 gas per stream, against a
predicted 17,100 for a 20,000 gas zero-to-nonzero SSTORE becoming a 2,900 gas
dirty one. At fan in 100 the same gap is 166 gas, against a predicted 171 for
that one time cost spread over a payee's 100 streams. Both land within 0.3%.

## Raw measurements

Full transaction gas per stream, meaning execution plus calldata plus the
amortised 21,000 base. Batch of 1000.

### Fan in 1 (every stream has a distinct payee)

| variant | first settlement | steady state | marginal |
|---|---|---|---|
| A push transfer | 33,157 | 16,061 | 16,039 |
| B pull credit | 30,168 | 13,072 | 13,056 |
| C pull grouped | 30,311 | 13,216 | 13,201 |

At fan in 1 variant C is structurally identical to B with an extra comparison
per iteration, so it is 144 gas per stream *worse*. The grouping optimisation
has nothing to group.

### Fan in 100 (100 subscribers per merchant, the realistic subscription shape)

| variant | first settlement | steady state | marginal |
|---|---|---|---|
| A push transfer | 11,448 | 11,277 | 11,251 |
| B pull credit | 9,152 | 8,986 | 9,044 |
| C pull grouped | 8,878 | 8,712 | 8,773 |

The pull variants get most of their advantage over A from avoiding a cross
contract call and a second contract's storage write per stream, not from
deferring the payment.

Note that variant C's advantage over B is far smaller than the intuition
suggests. Writing the same balance slot 100 times in one transaction is not 100
cold writes, it is one cold write at 5,000 gas plus 99 warm dirty writes at 100
gas each. EIP-2929 warm slot pricing already captures most of the benefit that
pre-grouping is supposed to deliver. Grouping recovers 272 gas per stream, about
3%.

### Withdrawal

Variant B and C do not delete the transfer cost, they move it to the payee.
A `withdraw()` costs **37,338 gas**. For a merchant with 100 streams withdrawing
monthly that amortises to 373 gas per stream per month, which is negligible.
For a payee with a single stream withdrawing monthly it is 37,338 gas, which at
an hourly cadence is larger than the entire month of settlement gas. The pull
model only pays off when payees aggregate.

## Block capacity

Monad's block gas limit is **150,000,000**, confirmed both from
`docs.monad.xyz` and from `eth_getBlockByNumber` against `https://rpc.monad.xyz`.
Block target is 80% of that.

Largest single `settle` call that fits in one block, steady state:

| variant | fan in 1 | fan in 100 | N = 10000 at fan in 1 |
|---|---|---|---|
| A push transfer | ~9,351 streams | ~13,329 streams | 163,123,381 gas, **exceeds by 13,123,381** |
| B pull credit | ~11,487 streams | ~16,591 streams | 134,859,018 gas, fits |
| C pull grouped | ~11,361 streams | ~17,105 streams | 138,056,425 gas, fits |

So N = 10000 in a single call is achievable for B and C, but not for A with
distinct payees. **A caps out at about 9,350 streams per transaction.** All
three would also consume the entire block, which is not something a real
operator can do repeatedly without competing with everyone else for blockspace
and pushing the base fee up.

## Cost model

Neither input is hardcoded. Gas price is read live with `eth_gasPrice` from the
Monad mainnet RPC, with the chain id checked to be 143 before the value is
trusted. MON/USD is a command line argument.

    chain id            143 (Monad mainnet)
    gas price           102.0000 gwei  (102,000,000,000 wei)
      source            eth_gasPrice from https://rpc.monad.xyz
    MON/USD             $0.026800
      source            --mon-usd argument (CoinGecko spot, 2026-09-06)
    cost per gas        $2.734e-09
    subscription        $9.00 per month streamed per stream

The observed 102 gwei is essentially the protocol's 100 MON-gwei minimum base
fee. **These numbers are the floor, not an average.** Any sustained demand on
Monad moves them up and moves every conclusion here with them.

### Cost per stream per month, fan in 100

| cadence | settles/mo | A | pct | B | pct | C | pct |
|---|---|---|---|---|---|---|---|
| 10s | 259,200 | $7.9903 | 88.78% | $6.3668 | 70.74% | $6.1727 | 68.59% |
| 60s | 43,200 | $1.3317 | 14.80% | $1.0611 | 11.79% | $1.0288 | 11.43% |
| 300s | 8,640 | $0.2663 | 2.96% | $0.2122 | 2.36% | $0.2058 | 2.29% |
| 3600s | 720 | $0.0222 | 0.25% | $0.0177 | 0.20% | $0.0171 | 0.19% |

### Cost per stream per month, fan in 1

| cadence | settles/mo | A | pct | B | pct | C | pct |
|---|---|---|---|---|---|---|---|
| 10s | 259,200 | $11.3803 | 126.45% | $9.2622 | 102.91% | $9.3640 | 104.04% |
| 60s | 43,200 | $1.8967 | 21.07% | $1.5437 | 17.15% | $1.5607 | 17.34% |
| 300s | 8,640 | $0.3793 | 4.21% | $0.3087 | 3.43% | $0.3121 | 3.47% |
| 3600s | 720 | $0.0316 | 0.35% | $0.0257 | 0.29% | $0.0260 | 0.29% |

### Break even cadence, the fastest settlement still under 1%

| variant | fan in 100 | fan in 1 |
|---|---|---|
| A push transfer | 888s (14.8 min) | 1,264s (21.1 min) |
| B pull credit | 707s (11.8 min) | 1,029s (17.2 min) |
| C pull grouped | **686s (11.4 min)** | 1,040s (17.3 min) |

## Two things that make this worse than it looks

**Monad charges the gas limit, not the gas used.** From the Monad docs: "the gas
charged for a transaction is the gas limit". This follows from asynchronous
execution, since leaders propose blocks before execution completes. Every safety
margin an operator puts on a settlement transaction is paid in full. A 10%
buffer, which is conservative for a loop whose cost depends on how many streams
are still active, multiplies every figure in this document by 1.1 and pushes
variant C's break even cadence from 686s to 754s. Run
`--limit-buffer-pct 10` to see it.

**MON at $0.0268 is doing a lot of work here.** The break even cadence scales
linearly with the token price:

| MON/USD | break even cadence, variant C, fan in 100 |
|---|---|
| $0.0268 (spot) | 686s (11.4 min) |
| $0.05 | 1,280s (21.3 min) |
| $0.10 | 2,559s (42.7 min) |
| $0.25 | 6,398s (1.8 h) |
| $0.50 | 12,796s (3.6 h) |
| $1.00 | 25,592s (7.1 h) |

If MON reaches $0.25, a price that is not remotely outlandish for an L1 with a
$317M market cap, **no cadence under an hour clears 1% under any variant**, and
hourly settlement itself sits at 1.8%. An architecture whose viability is a
function of the gas token staying cheap is an architecture with a countdown on
it.

## What I would conclude

Eager per batch settlement works, at a cadence somewhere north of 15 minutes,
today, at today's MON price, with a 1% cost budget. That is a real and usable
answer if the product is content to settle every 15 to 60 minutes.

It does not survive contact with any of the following: sub minute settlement,
a 5 minute cadence, a 3x move in MON, sustained network congestion, or low fan
in payees. That is a lot of ways for the number to break, and the per stream
storage floor of 7,100 gas means no amount of contract optimisation buys back
more than about 20%.

The measured decomposition points somewhere specific. 78% of the cost is
reading and re-stamping per stream state on a timer. Lazy accrual removes that
line item entirely rather than shrinking it: leave `lastSettled` alone, compute
what is owed at read time from `(now - lastSettled) * ratePerSecond`, and write
storage only when a payee actually withdraws or the stream is modified. Cost
then scales with withdrawals, which is a number the protocol controls, instead
of with `streams x cadence`, which is a number that grows with adoption.

The benchmark does not measure a lazy accrual variant, so that last paragraph
is an implication of the numbers rather than a result. It is the obvious next
thing to measure, and the case for measuring it is that eager settlement's
viability window here is narrow enough that I would not want to build on it
without knowing what the alternative costs.

## Reproducing

    forge test -vv
    python script/cost_model.py --fan-in 100
    python script/cost_model.py --fan-in 1
    python script/cost_model.py --fan-in 100 --mon-usd 0.25
    python script/cost_model.py --fan-in 100 --limit-buffer-pct 10

Offline, with no RPC call:

    python script/cost_model.py --gas-price-gwei 100 --mon-usd 0.0268
