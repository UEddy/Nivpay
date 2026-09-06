#!/usr/bin/env python3
"""
NivPay settlement cost model.

Turns the measured gas numbers in bench/gas.json into a dollar cost per stream
per month at a range of settlement cadences, and expresses that as a percentage
of a reference monthly subscription.

Inputs that are not measurements are either queried live or passed on the
command line, never baked into the arithmetic:

  gas price  queried with eth_gasPrice from the Monad mainnet RPC (chain id 143)
  MON/USD    a command line argument with an overridable default, or fetched
             live from the CoinGecko public endpoint with --fetch-mon-price

Both are printed at the top of the output so the assumptions behind every
number below them are visible.

Standard library only. No paid services, no API keys.
"""

import argparse
import json
import os
import sys
import urllib.error
import urllib.request

DEFAULT_RPC = "https://rpc.monad.xyz"
MONAD_CHAIN_ID = 143

# Fallback only. Override with --mon-usd, or refresh with --fetch-mon-price.
# Sourced from the CoinGecko public price endpoint on 2026-09-06.
DEFAULT_MON_USD = 0.0268

SECONDS_PER_MONTH = 30 * 24 * 3600  # 2,592,000. A 30 day month.
CADENCES = [10, 60, 300, 3600]
TX_BASE_GAS = 21000


def rpc(url, method, params=None):
    payload = json.dumps(
        {"jsonrpc": "2.0", "id": 1, "method": method, "params": params or []}
    ).encode()
    req = urllib.request.Request(
        url, data=payload, headers={"Content-Type": "application/json"}
    )
    with urllib.request.urlopen(req, timeout=20) as resp:
        body = json.load(resp)
    if "error" in body:
        raise RuntimeError(f"{method} failed: {body['error']}")
    return body["result"]


def fetch_gas_price(url):
    """Returns (wei_per_gas, chain_id, source_description)."""
    chain_id = int(rpc(url, "eth_chainId"), 16)
    if chain_id != MONAD_CHAIN_ID:
        raise RuntimeError(
            f"RPC {url} reports chain id {chain_id}, expected {MONAD_CHAIN_ID} (Monad mainnet)"
        )
    wei = int(rpc(url, "eth_gasPrice"), 16)
    return wei, chain_id, f"eth_gasPrice from {url}"


def fetch_mon_usd():
    url = "https://api.coingecko.com/api/v3/simple/price?ids=monad&vs_currencies=usd"
    with urllib.request.urlopen(url, timeout=20) as resp:
        body = json.load(resp)
    return float(body["monad"]["usd"]), "CoinGecko simple/price"


def load_rows(path):
    with open(path) as fh:
        return json.load(fh)


def pick(rows, variant, regime, n, fan_in):
    for r in rows:
        if (
            r["variant"] == variant
            and r["regime"] == regime
            and r["n"] == n
            and r["fan_in"] == fan_in
        ):
            return r
    raise KeyError(f"no row for {variant} {regime} n={n} fan_in={fan_in}")


def total_tx_gas(row):
    """Full transaction gas: execution plus calldata plus the 21000 base."""
    return row["exec_gas"] + row["calldata_gas"] + TX_BASE_GAS


def linear_fit(small, large):
    """Fixed overhead and marginal per stream gas from two batch sizes."""
    g_small, g_large = total_tx_gas(small), total_tx_gas(large)
    slope = (g_large - g_small) / (large["n"] - small["n"])
    intercept = g_small - slope * small["n"]
    return intercept, slope


def fmt_usd(x):
    if x >= 0.01:
        return f"${x:,.4f}"
    return f"${x:.6f}"


def main():
    p = argparse.ArgumentParser(
        description="NivPay settlement cost model",
        formatter_class=argparse.ArgumentDefaultsHelpFormatter,
    )
    p.add_argument("--gas-json", default=os.path.join("bench", "gas.json"))
    p.add_argument("--rpc", default=DEFAULT_RPC, help="Monad mainnet RPC endpoint")
    p.add_argument(
        "--mon-usd",
        type=float,
        default=DEFAULT_MON_USD,
        help="MON price in USD, override the default freely",
    )
    p.add_argument(
        "--fetch-mon-price",
        action="store_true",
        help="query CoinGecko for MON/USD instead of using --mon-usd",
    )
    p.add_argument(
        "--gas-price-gwei",
        type=float,
        default=None,
        help="skip the RPC and force a gas price, for what-if analysis",
    )
    p.add_argument("--subscription", type=float, default=9.00, help="monthly USD streamed per subscription")
    p.add_argument("--batch-size", type=int, default=1000, help="batch size whose measurement is used")
    p.add_argument("--fan-in", type=int, default=100, choices=[1, 100], help="streams per payee in the batch")
    p.add_argument(
        "--regime",
        default="steady",
        choices=["first", "steady"],
        help="steady is every settlement after the first, and is the right one for a recurring cadence",
    )
    p.add_argument(
        "--limit-buffer-pct",
        type=float,
        default=0.0,
        help="safety margin added to the tx gas limit. Monad charges the limit, not the amount used, so this is paid in full",
    )
    p.add_argument("--threshold-pct", type=float, default=1.0, help="viability threshold as pct of streamed value")
    args = p.parse_args()

    # ---------------- inputs ----------------
    if args.gas_price_gwei is not None:
        gas_price_wei = int(args.gas_price_gwei * 1e9)
        chain_id = MONAD_CHAIN_ID
        gas_src = "forced by --gas-price-gwei"
    else:
        try:
            gas_price_wei, chain_id, gas_src = fetch_gas_price(args.rpc)
        except (urllib.error.URLError, RuntimeError, TimeoutError) as e:
            print(f"ERROR: could not query gas price: {e}", file=sys.stderr)
            print("Pass --gas-price-gwei to run offline.", file=sys.stderr)
            return 1

    if args.fetch_mon_price:
        try:
            mon_usd, price_src = fetch_mon_usd()
        except Exception as e:
            print(f"ERROR: could not fetch MON price: {e}", file=sys.stderr)
            return 1
    else:
        mon_usd, price_src = args.mon_usd, "--mon-usd argument"

    data = load_rows(args.gas_json)
    rows = data["rows"]
    block_limit = data["monad_block_gas_limit"]
    buffer_mult = 1.0 + args.limit_buffer_pct / 100.0

    usd_per_gas = gas_price_wei / 1e18 * mon_usd

    print("=" * 78)
    print("NivPay settlement cost model")
    print("=" * 78)
    print()
    print("INPUTS")
    print(f"  chain id            {chain_id} (Monad mainnet)")
    print(f"  gas price           {gas_price_wei / 1e9:,.4f} gwei  ({gas_price_wei:,} wei)")
    print(f"    source            {gas_src}")
    print(f"  MON/USD             ${mon_usd:,.6f}")
    print(f"    source            {price_src}")
    print(f"  cost per gas        ${usd_per_gas:.3e}")
    print(f"  subscription        ${args.subscription:,.2f} per month streamed per stream")
    print(f"  gas limit buffer    {args.limit_buffer_pct:.1f}%  (Monad charges the gas limit, not gas used)")
    print(f"  measurement         regime={args.regime}, batch={args.batch_size}, fan_in={args.fan_in} streams per payee")
    print(f"  block gas limit     {block_limit:,} gas")
    print()

    variants = ["A_push_transfer", "B_pull_credit", "C_pull_grouped"]

    # ---------------- per stream gas ----------------
    print("PER STREAM GAS  (execution + calldata + amortised 21000 base)")
    print()
    print(f"  {'variant':<18} {'total tx gas':>14} {'gas/stream':>12} {'marginal':>10} {'fixed':>10}")
    print(f"  {'-' * 18} {'-' * 14:>14} {'-' * 12:>12} {'-' * 10:>10} {'-' * 10:>10}")

    per_stream = {}
    max_n = {}
    for v in variants:
        row = pick(rows, v, args.regime, args.batch_size, args.fan_in)
        small = pick(rows, v, args.regime, 100, args.fan_in)
        large = pick(rows, v, args.regime, 1000, args.fan_in)
        intercept, slope = linear_fit(small, large)

        total = total_tx_gas(row) * buffer_mult
        gps = total / row["n"]
        per_stream[v] = gps
        max_n[v] = int((block_limit / buffer_mult - intercept) / slope)

        print(f"  {v:<18} {total:>14,.0f} {gps:>12,.1f} {slope:>10,.1f} {intercept:>10,.0f}")
    print()

    # ---------------- block capacity ----------------
    print("BLOCK CAPACITY  (largest single settle call that fits in one Monad block)")
    print()
    for v in variants:
        n10k = pick(rows, v, args.regime, 10000, args.fan_in)
        g10k = total_tx_gas(n10k) * buffer_mult
        verdict = "fits" if g10k <= block_limit else f"EXCEEDS by {g10k - block_limit:,.0f} gas"
        print(f"  {v:<18} max N ~ {max_n[v]:>6,}   |  N=10000 costs {g10k:>13,.0f} gas  ->  {verdict}")
    print()

    # ---------------- cost table ----------------
    print(f"SETTLEMENT COST PER STREAM PER MONTH  (30 day month, ${args.subscription:.2f} streamed)")
    print()
    header = f"  {'cadence':<10} {'settles/mo':>11}"
    for v in variants:
        header += f" | {v.split('_')[0]:>10} {'pct':>8}"
    print(header)
    print("  " + "-" * (len(header) - 2))

    results = {}
    for cad in CADENCES:
        settles = SECONDS_PER_MONTH / cad
        line = f"  {str(cad) + 's':<10} {settles:>11,.0f}"
        for v in variants:
            monthly = per_stream[v] * usd_per_gas * settles
            pct = monthly / args.subscription * 100
            results[(cad, v)] = (monthly, pct)
            line += f" | {fmt_usd(monthly):>10} {pct:>7.2f}%"
        print(line)
    print()

    # ---------------- verdict ----------------
    print("VERDICT")
    print()

    # The four sampled cadences are coarse. The break even cadence is the number
    # that actually drives the architecture decision, so solve for it directly.
    budget = args.subscription * (args.threshold_pct / 100.0)
    print(f"  Break even cadence, the fastest settlement that still costs under {args.threshold_pct:.0f}%:")
    for v in variants:
        cost_per_settle = per_stream[v] * usd_per_gas
        max_settles = budget / cost_per_settle
        req = SECONDS_PER_MONTH / max_settles
        print(f"    {v:<18} {req:>10,.0f}s  ({req / 60:>7,.1f} min)   at {fmt_usd(cost_per_settle)} per stream per settlement")
    print()

    winners = []
    for cad in CADENCES:
        for v in variants:
            _, pct = results[(cad, v)]
            if pct < args.threshold_pct:
                winners.append((cad, v, pct))

    if not winners:
        best_cad, best_v = CADENCES[-1], min(variants, key=lambda v: results[(CADENCES[-1], v)][1])
        best_pct = results[(best_cad, best_v)][1]
        print(f"  No cadence at or under one hour keeps settlement cost below {args.threshold_pct:.0f}%")
        print(f"  of streamed value. The cheapest combination measured is {best_v}")
        print(f"  at {best_cad}s, and it still costs {best_pct:.2f}% of the ${args.subscription:.2f} stream.")
        print()
        needed = args.subscription * (args.threshold_pct / 100)
        for v in variants:
            cost_per_settle = per_stream[v] * usd_per_gas
            max_settles = needed / cost_per_settle
            req_cadence = SECONDS_PER_MONTH / max_settles
            print(f"    {v:<18} would need a cadence of {req_cadence:>12,.0f}s ({req_cadence / 3600:,.1f} h) to clear {args.threshold_pct:.0f}%")
    else:
        best = min(winners, key=lambda w: (w[0], w[2]))
        print(f"  Shortest cadence under {args.threshold_pct:.0f}% of streamed value: {best[0]}s")
        print(f"  Achieved by: {best[1]} at {best[2]:.3f}% of the ${args.subscription:.2f} stream.")
        print()
        for cad in CADENCES:
            ok = [v for v in variants if results[(cad, v)][1] < args.threshold_pct]
            print(f"    {str(cad) + 's':<8} clears {args.threshold_pct:.0f}%: {', '.join(ok) if ok else 'none'}")
    print()
    return 0


if __name__ == "__main__":
    sys.exit(main())
