# Frost Radar — token-radar-01

A token launch radar: the protocols whose DefiLlama record carries no token yet,
ranked by an implied launch value, with a farm plan for each one.

## The model (frost-radar-2)

```
implied = TVL x market multiple x growth multiplier x chain breadth x seasoning
```

- **Market multiple** — the median mcap/TVL of the protocols in this snapshot
  whose token already trades: per category where the category holds at least
  three live tokens, else the global median across all 128 comparables
  (0.21). A median, not a mean, because mcap/TVL runs from near zero to over
  400x and one outlier must not set the price. Each row names its multiple's
  source and how many comparables stand behind it.
- **Growth multiplier** from the protocol's seven-day TVL change, clamped to
  -75%…+200% and weighted 0.6. A missing change is read as 0% and flagged.
- **Chain breadth** is logarithmic in the chain count: `1 + 0.05 x ln(chains)`.
  The second chain doubles a protocol's reach; the hundredth adds almost
  nothing.
- **Seasoning** starts at 0.70 and saturates toward 1.00 as the protocol ages
  without a token (half-seasoned after about a year); no tracking date is read
  as 180 days, a deliberately young guess, and flagged.
- No protocol name is special-cased: the same functions score every row.

Coverage: all 40 watchlist protocols, plus every other pre-token protocol the
watchlist's own rule admits (no token recorded, not a CEX, not a versioned
pool, not a wrapped / staked / bridged product, not an exchange's product) —
198 rows. Protocols whose token already trades are listed separately, at the
market's own value; their mcap/TVL ratios are the comparables the multiple is
measured from.

Farm plans are built from each protocol's own record: the action fits its
category, gas is priced for the chain the step runs on (Ethereum dollars,
rollup cents), the weekly habit fits the category, and a plan gains a caution
step when TVL fell more than 10% in a week and a diligence step when the
protocol is under 90 days old.

## Run

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input ../input/snapshot.json
```

Writes `out/board.json`, `out/data.js`, `out/dashboard/`, `out/screenshots/`
and `out/dossier.json`. Two runs write byte-identical output.
