# NivPay

A pot is a group purse for one purpose that no single person can pocket.

Money goes in from anyone. It can only come out to destinations fixed when the
pot was created, and only when enough of the named approvers agree. When the
pot ends, whatever is left goes back to the people who put it in, split by what
they contributed.

Built for the Monad Metropolis hackathon, Consumer Products and Payments track.
Contracts only, no frontend.

## A note on the benchmark files

This repository also contains an earlier settlement benchmark: `StreamBench`,
`MockStable`, their tests, `script/cost_model.py` and
[BENCHMARK.md](./BENCHMARK.md). That benchmark evaluated a **streaming**
subscription design that has since been replaced by the pot design described
above. The files are kept untouched as evidence of process, and their tests
still run as part of the suite. Nothing in the pot contract depends on them.

## Layout

    src/NivPayPots.sol      the pot contract, the whole product
    src/MockStable.sol      minimal 6 decimal ERC-20, test only, retired benchmark
    src/StreamBench.sol     retired streaming benchmark
    script/cost_model.py    retired streaming cost model
    bench/gas.json          retired streaming measurements

## Running it

    forge test
