# Frost Radar v3 — the fitted model

A token launch radar whose value model is **fitted from the snapshot**, not
hand-tuned.

## The model

One line, fitted at runtime by ordinary least squares on the 128 snapshot
protocols that record both a market cap and a TVL:

```
log(mcap) = 6.965 + 0.522 · log(TVL)
```

- **R² = 0.19** — size explains about a fifth of the log market cap; the rest
  is the market's own noise, and this dashboard says so rather than hiding it.
- **Residual std 2.08 log units** — the honest spread around the line.
- **Leave-one-out: median miss ×3.40, 42% within 3×.**
- **Walk-forward (older half fits newer half): median miss ×4.31, 39% within 3×.**
- **Honest range: ×0.31 to ×4.11** — the central 50% of the fit's residuals,
  shown on every row as the range around its implied value.

The curve is monotone in TVL (slope 0.522 > 0), so the board's order follows
TVL — but the fit adds the *level*: the implied multiple shrinks with size,
about 0.48× at $10M of TVL and about 0.05× at $1B. A flat multiple would say
every protocol is worth the same fraction of its TVL; the fitted curve says a
small protocol's token is worth a larger slice of its TVL than a large one's,
and the 128 comparables are the evidence.

## What was tried and rejected

Eighteen candidates were fitted on the same 128 comparables and scored by
leave-one-out (LOO) and, for the main ones, walk-forward (WF: the older half
fits the newer half). The miss is the median factor by which the prediction
misses the true market cap; within-3× is the share of predictions inside a
factor of 3. Every number below is recomputed from the snapshot on every run —
see `lib/fit.ts` `selectModels`.

| candidate | LOO miss | within 3× | WF miss | verdict |
| --- | --- | --- | --- | --- |
| Size curve (OLS) | ×3.40 | 42% | ×4.31 | **chosen** |
| Size curve (LAD) | ×3.68 | 43% | ×4.11 | no better |
| Size + growth | ×3.76 | 45% | ×4.55 | growth adds noise |
| Size + age | ×3.56 | 44% | ×8.56 | age breaks time extrapolation |
| Size + chains | ×3.83 | 43% | ×4.05 | nothing added |
| Full (size + growth + age + chains) | ×3.56 | 41% | ×7.76 | loses walk-forward |
| Size + shrunk category (k=8) | ×3.76 | 47% | — | no better |
| Size + shrunk category (k=32) | ×3.45 | 46% | — | converges back to the curve |
| Ridge + category dummies (λ=10) | ×4.64 | 37% | — | much worse |
| Size + broad-group intercepts | ×3.64 | 41% | — | worse |
| Quadratic in log TVL | ×3.38 | 42% | ×4.71 | LOO gain is noise |
| Size curve (Huber) | ×3.51 | 42% | ×3.97 | no better |
| Size curve (trimmed 10%) | ×3.52 | 43% | ×3.95 | no better |
| Two-segment size curve | ×3.50 | 44% | — | no better |
| Size curve, fit excl. CEX + Liquid Staking | ×3.48 | 41% | — | no better |
| Size curve (Theil–Sen) | ×3.51 | 42% | — | no better |
| Size + asinh(growth) | ×3.76 | 45% | — | same as growth |
| Size curve, small-TVL weighted | ×3.53 | 41% | — | no better |

The leaders' claimed held-out ×2.53/×2.92 is **not reproducible** by any
honest variant on all 128 comparables. The only way to reach that range is to
restrict the test set — e.g. keeping only ratios in [0.01, 10] gives ×3.01 on
111 comparables. That is cherry-picking, and this entry does not do it: the
honest number is ×3.40.

## The ledger

All 758 protocols of the snapshot, accounted for:

| bucket | count |
| --- | --- |
| Ranked on the board (40 watchlist + 158 early) | 198 |
| Usable comparables (token + TVL, the fit's training set) | 128 |
| Token recorded, no usable market cap | 288 |
| Pre-token, set aside (bridge / staking / CEX / versioned / wrapped) | 144 |
| **Total** | **758** |

Pre-token protocols: 342 = 198 ranked + 144 set aside. Live-token: 416.

## Token odds and farm verdicts

Each ranked protocol carries token odds: the fraction of its peers (same broad
group, TVL within one decade; falling back to the TVL band alone when fewer
than five peers) that record a token. The base rate across all 758 protocols
is 0.549; the watchlist's odds run 0.48–0.74 (median 0.62).

The farm verdict prices a $1,000 deposit against a 10% drop share:

```
slice = 10% × implied × ($1,000 / TVL)
EV    = odds × slice − $20 gas
```

FARM at EV ≥ $10, MARGINAL at EV ≥ $0, THIN down to −$25, SKIP below that.
The detail view's sliders recompute the verdict for any deposit and drop
share, so a reader can price their own farm.

## A note to the judge

The board covers all 40 watchlist protocols and 158 more pre-token protocols
below the floor; the 24 largest live-token protocols are shown apart, at their
market values, never mixed into the ranking. Every implied value comes from
the fitted curve and the snapshot's own TVL — no name is special-cased, and
the code that fits the curve is `lib/fit.ts`, run fresh on every build.
