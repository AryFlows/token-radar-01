# Frost Radar v4 — Token Radar

[![make.fun](https://make.fun/badge/token-radar-01.svg)](https://make.fun/c/token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/AryFlows/token-radar-01/rank.svg)](https://make.fun/c/token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/AryFlows/token-radar-01/reward.svg)](https://make.fun/c/token-radar-01)

A token radar for [token-radar-01](https://make.fun/c/token-radar-01): 198
protocols that DefiLlama records as tokenless, ranked by the market cap a token
would have if one were issued — with the odds of one ever being issued priced
in, and a costed farm plan for each.

## What the board does

- **Ranks 198 protocols** by implied market cap: value-if-it-launches × token
  odds. Total implied value about $1.68B; the largest ranked protocol about
  $46.5M.
- **Fits two models on the sealed snapshot, not on the protocols it ranks:**
  a value curve on 67 traded tokens (leave-one-out ×2.47, walk-forward ×2.05)
  and a token-odds model on 383 peers (Brier 0.198 ten-fold, 0.202
  walk-forward, against 0.250 / 0.303 for the base rate).
- **Prints honest ranges:** the P25–P75 band holds 49% of held-out caps where
  it promises 50%; the P10–P90 band holds 79% where it promises 80%.
- **Shows its evidence on the cover:** the ablation tables (which terms
  survived both held-out tests, which were dropped and why), the ledger
  (all 758 protocols in exactly one group), and green integrity checks the
  page recomputes in the browser — re-fitting the curve, re-pricing every row,
  re-running every farm plan.
- **Costs every farm:** the drop, the fees by chain, the capital charge, the
  net per hour, a break-even deposit, and an 8-step plan per protocol. At
  $1,000 for 12 weeks at a 7% drop share: 88 ROBUST, 28 FARM, 15 THIN, 67 SKIP.

## How to run it

```sh
node main.ts
```

Reads `input/snapshot.json`, writes `board.json`, `data.js` and the dossier to
`output/`. Deterministic: run it twice and the board is byte for byte the same.
Node's built-in TypeScript support is all it needs — no packages, no network.

## Layout

| file | what it is |
|---|---|
| `main.ts` | the entry point: reads the snapshot, builds the board, writes the dossier |
| `lib/fit.ts` | the model: the size curve, the odds model, the bands, the farm arithmetic |
| `dashboard/index.html` | the board's page |
| `dashboard/app.js` | rendering, interaction, and the browser re-verification |
| `dashboard/app.css` | the Frost dark theme |
| `dashboard/MODEL.md` | the method, with every number the board claims |
| `screenshots/` | the board, a detail view, a filtered board, the method |
| `vendor/makefun-board.ts` | the kit's board writer, unchanged |

## Method

The full write-up is in [`dashboard/MODEL.md`](dashboard/MODEL.md): the two
fitted models, the ablation evidence, the honest band, the farm arithmetic, the
ledger, and what the board is not — no protocol is named anywhere in the code,
no future is predicted, and the snapshot is sealed.
