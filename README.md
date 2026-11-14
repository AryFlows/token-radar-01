# Frost Radar — token-radar-01

A token launch radar: the protocols whose DefiLlama record carries no token yet,
ranked by an implied launch value, with a farm plan for each one.

## The model (frost-radar-1)

```
implied = TVL x 0.30 x growth multiplier x seasoning
```

- **Growth multiplier** from the protocol's seven-day TVL change, clamped to
  -75%…+200% and weighted 0.6.
- **Seasoning** starts at 0.70 and saturates toward 1.00 as the protocol ages
  without a token (half-seasoned after about a year); no tracking date is read
  as 180 days, a deliberately young guess.
- No protocol name is special-cased: the same function scores every row.

Coverage: all 40 watchlist protocols, plus every other pre-token protocol the
watchlist's own rule admits (no token recorded, not a CEX, not a versioned
pool, not a wrapped / staked / bridged product, not an exchange's product) —
198 rows. Protocols whose token already trades are listed separately, at the
market's own value.

## Run

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input ../input/snapshot.json
```

Writes `out/board.json`, `out/data.js`, `out/dashboard/`, `out/screenshots/`
and `out/dossier.json`. Two runs write byte-identical output.
