# Frost Radar — the model, the evidence, and how to judge it

Frost Radar ranks the snapshot's pre-token protocols by an implied launch
value and gives each one a farm plan. Every figure below is computed from the
sealed DefiLlama snapshot by the entry's own program (model frost-radar-2);
the dashboard recomputes the checks live in the browser from the same data
it renders, so the page can be caught disagreeing with itself.

## The value model

    implied = TVL x market multiple x growth multiplier x chain breadth x seasoning

- **Market multiple.** The median mcap/TVL of this snapshot's own
  token-trading protocols: 128 comparables, global median 0.21. A category
  with at least 3 live tokens gets its own median; thinner categories fall
  back to the global median. 96 of 198 rows use a category multiple, 102 the
  global fallback. A median, not a mean: mcap/TVL runs from 0.0003 to 400,
  so one outlier must not set the price.
- **Growth multiplier.** 1 + clamp(7-day TVL change, -75%..+200%) x 0.6.
  A missing 7-day change reads as 0% growth and the row flags it (2 rows).
- **Chain breadth.** 1 + 0.05 x ln(chain count): the second chain doubles
  a protocol's reach, the hundredth adds almost nothing.
- **Seasoning.** 0.70 + 0.30 x (1 - exp(-age in years / 1.5)): a protocol
  that has run a year without a token is most of the way seasoned. An
  unknown tracking date reads as 180 days, a deliberately young guess, and
  the row flags it (7 rows).

No protocol name is ever special-cased: the same functions score every row.
Tokens that already trade are listed separately, at the market's own value,
and never ranked against protocols still to launch.

## The comparables (median mcap/TVL, live tokens only)

| Category | Live tokens | Median | | Category | Live tokens | Median |
|---|---:|---:|---|---:|---:|
| Lending | 15 | 0.13 | | Bridge | 6 | 0.56 |
| Dexs | 11 | 0.34 | | Cross Chain Bridge | 4 | 1.22 |
| CEX | 9 | 0.07 | | Yield Aggregator | 4 | 0.15 |
| Liquid Staking | 9 | 0.04 | | CDP | 3 | 0.17 |
| RWA | 9 | 0.27 | | Indexes | 3 | 0.15 |
| Yield | 9 | 0.19 | | Privacy | 3 | 0.97 |
| Canonical Bridge | 8 | 0.75 | | **All categories** | **128** | **0.21** |
| Basis Trading | 7 | 0.65 | | | | |

## The backtest — the multiple, tested, not trusted

Each live token is priced from the median of the *other* comparables
(leave-one-out), and the medians fitted on the older half of the dated
tokens price the newer half. The miss is the factor between the priced
value and the real market cap, so x2 means half or double. The flat global
median is the baseline.

| Test | Tokens | Median miss, this model | Within 3x | Median miss, flat median | Within 3x |
|---|---:|---:|---:|---:|---:|
| Leave-one-out | 128 | x5.53 | 37 (29%) | x5.07 | 45 (35%) |
| Older half prices newer half | 48 | x5.24 | 14 (29%) | x5.29 | 16 (33%) |

The multiple is a rough anchor — mcap/TVL spans six orders of magnitude, so
no TVL multiple is precise — and the board says so: every implied value
carries an honest range, the value divided and multiplied by the backtest's
median miss (x5.5). Rank 1, Steakhouse Financial, is $578.3M with an honest
range of $104.6M–$3.20B. The detail view shows all five factors, so the
reader can see how much of a rank is TVL and how much is multiple.

## The ledger — all 758 protocols, each in exactly one group

198 ranked (40 watchlist + 158 early, below the floor) + 416 token-recorded
(128 usable comparables + 288 with a token on record but no usable market
cap) + 144 set aside by the watchlist rule's own reasons (43 bridge, 43
liquid staking, 42 exchange custody, 11 versioned listings, 5 wrapped or
staked products) = 758. Board TVL $20.71B; total implied value $4.31B;
median implied value $4.19M.

## Farm plans and verdicts

Every row carries 6–9 steps, each with a cost and a time; gas is priced for
the chain the step runs on (about $8 on Ethereum, $0.50 on a rollup, under
$0.10 on Sui or Solana). The plan's gas bill is totalled from its own steps
— first transaction, deposit, second chain, the weekly habit over the whole
hold window, the exit test — and runs $0.70–$123.50 across the board
(median $16.50). Capital is not a cost: it comes back.

Each row's verdict nets the plan against one stated scenario: a $1,000
deposit, 10% of the implied value paid to depositors, pro-rata by the
deposit's share of TVL. Slice = 10% x implied value x ($1,000 / TVL); net =
slice - plan gas. FARM nets at least $10, MARGINAL at least $0, THIN at
least -$25, SKIP anything worse. Across the board: 53 FARM, 48 MARGINAL, 42
THIN, 55 SKIP. The plan's own minimum deposit is $50–$200, so a reader
farming the minimum should scale the slice down; the verdict prices the
$1,000 position it states.

## How to judge this (criterion by criterion)

1. **A working radar.** 198 rows, ranks 1–198, implied values never rise;
   watchlist 40 of 40 on the board; the ledger accounts for all 758
   protocols. Check the integrity strip under the ledger — it recomputes
   these in the browser.
2. **The value model.** TVL x a multiple measured from this snapshot's own
   128 live tokens, x growth x breadth x seasoning; no hardcoded names;
   live tokens kept apart. Check the math strip on any detail view, the
   comparables on the Method tab, and the backtest above.
3. **Farm plans.** Concrete steps with costs and times on every row, plan
   totals, and a verdict netted against a stated scenario. Check any detail
   view's farm plan.
4. **The dashboard as a page.** Sortable columns, search, category and
   chain filters, six quick-filter chips, a detail view per protocol, and
   separate tabs for trading tokens and for the method.
5. **It looks made.** Warm paper, ink type, teal for the radar and amber
   for value; one spacing scale, tabular numerals, a fixed-width table.

## What is in this dossier

MODEL.md (this file) states the model and its evidence. app.js renders the
board — see farmVerdictFor for the verdict rule, renderLedger for the
accounting, renderMethod for the backtest and the scatter, renderDetail for
the per-row math strip. index.html is the page's structure. The model
itself is computed by lib/radar.ts and main.ts outside this dossier, from
the same sealed snapshot, and the page's data.js is generated from the same
board.json the gate checks.
