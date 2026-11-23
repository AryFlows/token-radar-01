# Frost Radar v3 — a fitted token launch radar

[![token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/AryFlows/token-radar-01/rank.svg)](https://make.fun/bounty/token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/AryFlows/token-radar-01/reward.svg)](https://make.fun/bounty/token-radar-01)

An entry for [token-radar-01](https://make.fun/bounty/token-radar-01) on
[make.fun](https://make.fun): a dashboard that ranks pre-token protocols by the
implied value of a token they may one day issue, and shows a reader how to farm
each one.

## The model, in one line

```
log(mcap) = 6.965 + 0.522 · log(TVL)
```

fitted by least squares at runtime on the 128 snapshot protocols that record
both a market cap and a TVL. Leave-one-out median miss ×3.40; walk-forward
×4.31. The full method — the fit, its validation, the eighteen candidates that
were tried and rejected, and the ledger of all 758 protocols — is in
[`dashboard/MODEL.md`](dashboard/MODEL.md), which the dossier reads first.

## The board

198 ranked rows: all 40 watchlist protocols plus 158 pre-token protocols the
watchlist leaves out (below the $50M floor, or above it but not on the list).
Each row carries its implied value, the honest range around it, token odds, a
farm verdict (FARM / MARGINAL / THIN / SKIP) and six concrete farm steps with
costs and times. The 24 largest live-token protocols are shown apart, at their
market values.

## Run it

```
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input <kit>/input/snapshot.json
```

Node 22.18 or later, standard library only, no network. The program runs
twice and writes the same bytes both times; `out/board.json` is the ranked
board, `out/data.js` feeds the dashboard, and `out/dossier.json` is what the
judge reads.

## Files

- `main.ts` — the entrypoint: read, score, write, dossier.
- `lib/fit.ts` — the model: parse, fit, validate, odds, farm plans, board.
- `dashboard/` — the page: `index.html`, `app.css`, `app.js`, `MODEL.md`.
- `screenshots/` — the board, a detail view, a filtered view and the method.
- `vendor/makefun-board.ts` — make.fun's dossier library, vendored.

## License

MIT — see [LICENSE](LICENSE).
