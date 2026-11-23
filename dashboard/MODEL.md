# Frost Radar v4 — how the board is made

A token radar: 198 protocols that DefiLlama records as tokenless, ranked by the
market cap a token would have if one were issued, with the odds of one ever
being issued priced in and a costed farm plan for each. Everything below is
fitted on the sealed snapshot — no protocol is named anywhere in the code, and
no future is predicted.

## 1. The value model: a size curve, kept only if it earns its place

The value model is fitted on **67 traded tokens**: dated, with a market cap
between 0.5% and 20× their TVL (a token worth less, or more, is not priced on
its TVL), in a category the radar ranks. The fit is:

```
log(mcap) = 8.875 + 0.432·ln(TVL) − 0.292·ln(chains)
```

The multiple falls as TVL grows — big protocols are worth less per dollar of
TVL — and falls again with every extra chain. Each term was kept only because
it improved **both** held-out tests:

| term, added in order | leave-one-out | walk-forward |
|---|---|---|
| one flat multiple | ×3.84 | ×4.27 |
| + the size curve | ×2.54 | ×2.38 |
| + the chain count | ×2.47 | ×2.05 |
| + years listed | ×2.52 | ×9.95 — dropped |
| + seven-day growth | ×2.33 | ×2.06 — dropped |
| + a category ridge | ×2.45 | ×2.05 — dropped |

The walk-forward fits the older 60% of the comps and prices the newer 40%.
Years listed fails both tests: its coefficient flips sign between halves and
the walk-forward miss blows out to ×9.95. Seven-day growth sharpens the
leave-one-out miss to ×2.33 but leaves the walk-forward a touch worse
(×2.06 against ×2.05), so the rule drops it. The category ridge moved nothing
on the walk-forward, so the model stays two terms.

## 2. The token odds: a second model, not a guess

The odds come from a logistic fit on **383 peers** — the tokenless protocols
plus the traded tokens that recorded a listing date, restricted to the ranked
categories — of who records a token, from age, size, seven-day growth and the
category's token rate (shrunk toward the base rate, 20 pseudo-observations).
Its Brier score is **0.198** ten-fold and **0.202** walk-forward, against
0.250 / 0.303 for the base rate alone.

The odds are a hazard: among the peers that reach this protocol's age without
a token, the share that ever record one —

```
odds = (ceiling − p) / (1 − p),   ceiling = 0.865
```

The ceiling is the token rate among peers listed at least four years ago. A
young protocol scores high because it has hardly had time; an old one falls,
because the peers that were going to launch mostly have. The odds are floored
at 5%: the record cannot prove a protocol will never launch. Undated protocols
take the peers' median age, 1.53 years. The median odds across the board are
79%.

**Implied value = value-if-it-launches × token odds.** The largest ranked
protocol's implied value is about $46.5M; the board's total implied value is
about $1.68B.

## 3. The band: printed honestly, and checked

The P25–P75 band is the leave-one-out residuals' quartiles (×0.52 to ×2.65;
P10–P90 ×0.14 to ×5.99). Held out, 49% of true caps fall inside the middle
half where the band promises 50%, and 79% inside the outer band where it
promises 80% — an honest band, not a narrow one. 61% of held-out caps land
within 3× of the point estimate, 43% within 2×. Rank ranges come from 200
bootstrap refits of the curve.

## 4. The farm plan: the drop, the fees, the verdict

The drop is the drop share (7% by default) of the implied value, shared
pro-rata by deposit among the protocol's TVL. Fees are a stated assumption, not
a snapshot fact: $8 a step on Ethereum, $0.50 on a rollup or cheap chain,
$0.20 elsewhere, eight steps plus a dollar to arrive and leave. The capital
charge is 2% a year on the deposit. Yield earned meanwhile is left out, so the
net is the airdrop alone.

| verdict | meaning | at $1,000 / 12 weeks / 7% |
|---|---|---|
| ROBUST | pays even at the band's low end | 88 |
| FARM | pays after every cost | 28 |
| THIN | beats its cash fees only | 15 |
| SKIP | fees eat the drop | 67 |

The best hour on the board pays about $23.50. Change the deposit, the drop share
or the horizon on the board and every verdict recomputes — the break-even
deposit on each detail view shows where a protocol starts to pay.

## 5. The ledger: all 758 protocols, exactly one group each

| group | count |
|---|---|
| Ranked — the 40 on the watchlist | 40 |
| Ranked — early, below the TVL floor | 138 |
| Ranked — off-list, a parent record names a token | 20 |
| Token trades — a priced comp | 128 |
| Token on record, no usable cap | 288 |
| Set aside — bridge, liquid staking, exchange, versioned, wrapped/staked | 144 |
| **Total** | **758** |

The 40 watchlist protocols are ranked whatever their size; the early group is
ranked below the $10M TVL floor so small protocols are visible instead of
vanishing; the off-list group is eligible but a parent record names a token, so
it is ranked apart rather than silently dropped. Bridges, liquid staking and
exchanges are set aside because their TVL is not the kind of value a token
prices — their multiples would poison the curve.

## 6. What the board is not

- **No protocol is named in the code.** `namesInCode()` counts 0 of 758
  protocol names in the entry's source; the model prices from figures only.
- **No prediction.** The board says what a token would be worth if the
  protocol's record stayed as it is — never whether or when one is issued.
- **No fetched data.** The snapshot is sealed at the date printed on the
  cover; the page fetches nothing, and the dashboard renders with no network.
- **Seven-day change is shown as DefiLlama records it, in percent** — a
  three-digit move is a three-digit move, not a fraction misread as one.

## 7. How to check it

Run `main.ts` twice: the board is deterministic, byte for byte. The page
checks its own work in the browser — `verifyBoard()` re-fits the size curve
from the 67 comps embedded in the data, re-prices all 198 rows, re-runs all
198 farm plans, and compares ranks, values, bands, verdicts, nets and the
checksum with what `main.ts` wrote. The green checks on the cover are that
comparison's result.
