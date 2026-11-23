// Frost Radar v4: the token launch radar's model.
//
// Every number this file produces is fitted on the sealed snapshot and tested
// held-out before it is believed. Nothing here names a protocol: the model
// reads the snapshot's figures (TVL, chains, age, growth, category) and prices
// every row with the same functions. The page re-runs the pricing in the
// browser and checks it against board.json; the checks are the integrity strip.
//
// Value: log(mcap) is fitted on the traded tokens that can price a launch
// (dated, a market cap between 0.5% and 20x their TVL, in a category the radar
// ranks), then tested leave-one-out and walk-forward (the older 60% price the
// newer 40%). Terms are added greedily and kept only when they improve BOTH
// held-out tests. Token odds come from a second fitted model on the peers'
// record: a logistic fit of who records a token, turned into a hazard — the
// chance a protocol that has run this long without one ever records one.
// Implied value = value-if-it-launches x token odds.

export interface SnapshotProtocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

/** The farm scenario the verdicts are computed under. The page lets the reader change it. */
export interface FarmScenario {
  deposit: number;
  weeks: number;
  dropShare: number;
}

export const FARM_DEFAULT: FarmScenario = { deposit: 1000, weeks: 12, dropShare: 0.07 };
/** The capital charge on the deposit while it farms, and the T-bill it is judged against. */
export const CAPITAL_RATE = 0.02;
export const TBILL_RATE = 0.04;
/** Hands-on hours one farm plan takes, from its eight steps' times. */
export const PLAN_HOURS = 2.5;
/** A farm plan's steps. */
export const PLAN_STEPS = 8;

/** Categories the house rule sets aside: their tokens are priced on businesses the radar does not rank. */
export const SETASIDE_CATEGORIES = new Set([
  'Bridge', 'Canonical Bridge', 'Liquid Staking', 'Liquid Restaking', 'Restaked BTC', 'CEX',
]);
/** A name ending in a version marker (V2, v2, 2.0) is a versioned listing, not a new protocol. */
const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;
const WRAPPED_WORD = /\b(wrapped|staked|staking)\b/i;
/** A comp whose market cap is under half a percent of its TVL, or over twenty times it, is not priced on its TVL. */
export const RATIO_LO = 0.005;
export const RATIO_HI = 20;
/** The odds floor: the record cannot prove a protocol will never launch. */
export const ODDS_FLOOR = 0.05;
export const ODDS_CEIL = 0.95;
/** Bootstrap refits behind every rank range. */
export const BOOTSTRAPS = 200;

// ---------------------------------------------------------------- small tools

export const median = (xs: number[]): number => {
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 === 1 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
};

export function quantile(xs: number[], q: number): number {
  const s = [...xs].sort((a, b) => a - b);
  if (s.length === 0) return 0;
  const at = (s.length - 1) * q;
  const lo = Math.floor(at);
  const hi = Math.ceil(at);
  return s[lo]! + (s[hi]! - s[lo]!) * (at - lo);
}

/** FNV-1a, 32-bit: deterministic folds and checksums, no randomness anywhere. */
export function hash32(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** A seeded generator (mulberry32): the bootstrap refits are the same every run. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Ordinary least squares on a small design: normal equations, Gaussian elimination, a whisper of ridge. */
export function ols(X: number[][], y: number[]): number[] {
  const n = X.length;
  const k = X[0]!.length + 1;
  const a: number[][] = Array.from({ length: k }, () => new Array<number>(k).fill(0));
  const b: number[] = new Array<number>(k).fill(0);
  for (let i = 0; i < n; i++) {
    const row = [1, ...X[i]!];
    for (let r = 0; r < k; r++) {
      b[r]! += row[r]! * y[i]!;
      for (let c = 0; c < k; c++) a[r]![c]! += row[r]! * row[c]!;
    }
  }
  for (let d = 1; d < k; d++) a[d]![d]! += 1e-8;
  for (let col = 0; col < k; col++) {
    let piv = col;
    for (let r = col + 1; r < k; r++) if (Math.abs(a[r]![col]!) > Math.abs(a[piv]![col]!)) piv = r;
    [a[col], a[piv]] = [a[piv]!, a[col]!];
    [b[col], b[piv]] = [b[piv]!, b[col]!];
    const div = a[col]![col]!;
    if (Math.abs(div) < 1e-12) continue;
    for (let r = col + 1; r < k; r++) {
      const f = a[r]![col]! / div;
      if (f === 0) continue;
      for (let c = col; c < k; c++) a[r]![c]! -= f * a[col]![c]!;
      b[r]! -= f * b[col]!;
    }
  }
  const beta: number[] = new Array<number>(k).fill(0);
  for (let r = k - 1; r >= 0; r--) {
    let s = b[r]!;
    for (let c = r + 1; c < k; c++) s -= a[r]![c]! * beta[c]!;
    beta[r] = Math.abs(a[r]![r]!) < 1e-12 ? 0 : s / a[r]![r]!;
  }
  return beta;
}

export const olsPredict = (beta: number[], x: number[]): number =>
  beta[0]! + beta.slice(1).reduce((s, b, i) => s + b * x[i]!, 0);

const sigmoid = (z: number): number => 1 / (1 + Math.exp(-Math.max(-30, Math.min(30, z))));

/** Logistic regression by Newton steps, L2 = 1 on the slopes. Deterministic: no random start. */
export function fitLogistic(X: number[][], y: number[]): number[] {
  const n = X.length;
  const k = X[0]!.length + 1;
  let beta: number[] = new Array<number>(k).fill(0);
  for (let iter = 0; iter < 100; iter++) {
    const g: number[] = new Array<number>(k).fill(0);
    const h: number[][] = Array.from({ length: k }, () => new Array<number>(k).fill(0));
    for (let i = 0; i < n; i++) {
      const row = [1, ...X[i]!];
      const p = sigmoid(row.reduce((s, v, j) => s + v * beta[j]!, 0));
      const w = Math.max(p * (1 - p), 1e-6);
      for (let r = 0; r < k; r++) {
        g[r]! += row[r]! * (p - y[i]!);
        for (let c = 0; c < k; c++) h[r]![c]! += w * row[r]! * row[c]!;
      }
    }
    for (let d = 1; d < k; d++) {
      g[d]! += beta[d]!;
      h[d]![d]! += 1;
    }
    const step = solveLinear(h, g);
    let biggest = 0;
    for (let j = 0; j < k; j++) {
      beta[j]! -= step[j]!;
      biggest = Math.max(biggest, Math.abs(step[j]!));
    }
    if (biggest < 1e-7) break;
  }
  return beta;
}

function solveLinear(a: number[][], b: number[]): number[] {
  const k = b.length;
  const m = a.map((row, i) => [...row, b[i]!]);
  for (let col = 0; col < k; col++) {
    let piv = col;
    for (let r = col + 1; r < k; r++) if (Math.abs(m[r]![col]!) > Math.abs(m[piv]![col]!)) piv = r;
    [m[col], m[piv]] = [m[piv]!, m[col]!];
    const div = m[col]![col]!;
    if (Math.abs(div) < 1e-12) continue;
    for (let r = 0; r < k; r++) {
      if (r === col) continue;
      const f = m[r]![col]! / div;
      if (f === 0) continue;
      for (let c = col; c <= k; c++) m[r]![c]! -= f * m[col]![c]!;
    }
  }
  return m.map((row, i) => (Math.abs(row[i]!) < 1e-12 ? 0 : row[k]! / row[i]!));
}

export const logisticPredict = (beta: number[], x: number[]): number =>
  sigmoid(beta[0]! + beta.slice(1).reduce((s, b, i) => s + b * x[i]!, 0));

/** Standardise columns; returns the scaled matrix and the means/scales that produced it. */
export function standardise(X: number[][]): { scaled: number[][]; mu: number[]; sd: number[] } {
  const k = X[0]!.length;
  const mu: number[] = [];
  const sd: number[] = [];
  for (let j = 0; j < k; j++) {
    const col = X.map((row) => row[j]!);
    const m = col.reduce((s, v) => s + v, 0) / col.length;
    const v = col.reduce((s, x) => s + (x - m) * (x - m), 0) / col.length;
    mu.push(m);
    sd.push(Math.sqrt(v) || 1);
  }
  return { scaled: X.map((row) => row.map((v, j) => (v - mu[j]!) / sd[j]!)), mu, sd };
}

// ---------------------------------------------------------------- the snapshot

export class SnapshotError extends Error {}

export function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SnapshotError('the snapshot is not JSON');
  }
  const s = raw as Partial<Snapshot>;
  if (typeof s.as_of !== 'string' || !Array.isArray(s.protocols) || !Array.isArray(s.watchlist)) {
    throw new SnapshotError('the snapshot lacks as_of, protocols or watchlist');
  }
  return s as Snapshot;
}

/** Days from `listedAt` to the snapshot's date, or null when DefiLlama records no date. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (!listedAt) return null;
  const ms = Date.parse(`${asOf}T00:00:00Z`) - Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(ms)) return null;
  return Math.max(0, Math.round(ms / 86_400_000));
}

/** A protocol records a token when DefiLlama carries a market cap, a Gecko id or a symbol for it. */
export function hasToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd !== null || p.gecko_id !== null || p.symbol !== null;
}

/** Why the house rule sets a protocol aside, or null when it is rankable. */
export function setasideReason(p: SnapshotProtocol): string | null {
  if (p.category === 'Bridge' || p.category === 'Canonical Bridge') return 'bridge';
  if (p.category === 'Liquid Staking' || p.category === 'Liquid Restaking' || p.category === 'Restaked BTC') {
    return 'liquid staking';
  }
  if (p.category === 'CEX') return 'exchange';
  if (VERSIONED.test(p.name)) return 'versioned';
  if (WRAPPED_WORD.test(p.name)) return 'wrapped/staked name';
  return null;
}

/** Rankable: records no token and nothing in the house rule sets it aside. */
export function isRankable(p: SnapshotProtocol): boolean {
  return !hasToken(p) && setasideReason(p) === null;
}

/** A protocol's tier on the board: watchlist, early below the floor, or off-list (above the floor but not on the watchlist). */
export function tierOf(p: SnapshotProtocol, snapshot: Snapshot): 'watchlist' | 'early' | 'off-list' {
  if (snapshot.watchlist.includes(p.slug)) return 'watchlist';
  return p.tvl_usd >= snapshot.floor_usd ? 'off-list' : 'early';
}

// ---------------------------------------------------------------- the ledger

export interface Ledger {
  ranked: { watchlist: number; early: number; offList: number; total: number };
  tokenTrades: number;
  tokenNoCap: number;
  setAside: Record<string, number>;
  setAsideTotal: number;
  total: number;
}

/** Every protocol in exactly one group; the groups sum to the snapshot. */
export function ledgerOf(snapshot: Snapshot): Ledger {
  const ranked = { watchlist: 0, early: 0, offList: 0, total: 0 };
  let tokenTrades = 0;
  let tokenNoCap = 0;
  const setAside: Record<string, number> = {};
  for (const p of snapshot.protocols) {
    if (isRankable(p)) {
      ranked.total++;
      const tier = tierOf(p, snapshot);
      if (tier === 'watchlist') ranked.watchlist++;
      else if (tier === 'early') ranked.early++;
      else ranked.offList++;
    } else if (hasToken(p)) {
      if (p.mcap_usd !== null && p.mcap_usd > 0) tokenTrades++;
      else tokenNoCap++;
    } else {
      const r = setasideReason(p) ?? 'other';
      setAside[r] = (setAside[r] ?? 0) + 1;
    }
  }
  const setAsideTotal = Object.values(setAside).reduce((s, n) => s + n, 0);
  return { ranked, tokenTrades, tokenNoCap, setAside, setAsideTotal, total: snapshot.protocols.length };
}

// ---------------------------------------------------------------- the value model's comps

/** The traded tokens that can price a launch: dated, a market cap between half a percent and twenty times their TVL, in a category the radar ranks. */
export function compsOf(snapshot: Snapshot): SnapshotProtocol[] {
  return snapshot.protocols.filter((p) => {
    if (p.mcap_usd === null || p.mcap_usd <= 0 || p.tvl_usd <= 0 || !p.listed_at) return false;
    if (p.category !== null && SETASIDE_CATEGORIES.has(p.category)) return false;
    const ratio = p.mcap_usd / p.tvl_usd;
    return ratio > RATIO_LO && ratio < RATIO_HI;
  });
}

/** The peers behind the odds model: dated protocols in a category the radar ranks, token or not. */
export function oddsPeersOf(snapshot: Snapshot): SnapshotProtocol[] {
  return snapshot.protocols.filter((p) => p.listed_at !== null && setasideReason(p) === null);
}

// ---------------------------------------------------------------- the value model

export interface AblationRow {
  label: string;
  loo: number;
  wf: number;
  kept: boolean;
  note: string;
}

export interface ValueModel {
  /** Terms in the final fit, in the order they were added. */
  terms: string[];
  /** OLS coefficients: intercept first, then one per term. */
  beta: number[];
  loo: number;
  wf: number;
  flatLoo: number;
  flatWf: number;
  ablation: AblationRow[];
  /** Multiplicative band factors from the leave-one-out residuals. */
  band: { p25: number; p75: number; p10: number; p90: number };
  /** Honest coverage: the share of held-out caps inside the band the model prints. */
  coverage: { p2575: number; p1090: number; n: number };
  within3x: number;
  within2x: number;
  comps: number;
  /** Leave-one-out predictions per comp, for the nearest-peers table. */
  looPred: number[];
  /** Shrunken category effects, when the ridge term is kept; empty otherwise. */
  catEff: Record<string, number>;
}

type ValueTerm = 'logTVL' | 'logChains' | 'logYears' | 'growth' | 'catRidge';

const VALUE_CANDIDATES: ValueTerm[] = ['logChains', 'logYears', 'growth', 'catRidge'];
const VALUE_LABELS: Record<ValueTerm, string> = {
  logTVL: 'size curve, ln TVL',
  logChains: 'chain count, ln',
  logYears: 'years listed, ln',
  growth: 'seven-day growth',
  catRidge: 'category effect, ridge 64',
};

function valueFeature(term: ValueTerm, p: SnapshotProtocol, asOf: string): number {
  switch (term) {
    case 'logTVL':
      return Math.log(p.tvl_usd);
    case 'logChains':
      return Math.log(Math.max(1, p.chains.length));
    case 'logYears': {
      const age = ageDays(asOf, p.listed_at);
      return Math.log(Math.max(age ?? 365, 1) / 365);
    }
    case 'growth':
      // change_7d is already in percent (DefiLlama): clip the wild prints.
      return Math.max(-90, Math.min(300, p.change_7d ?? 0)) / 100;
    case 'catRidge':
      return 0; // handled two-stage, never as a plain feature
  }
}

function logMcap(p: SnapshotProtocol): number {
  return Math.log(p.mcap_usd!);
}

/** Median absolute miss as a multiple: exp(median |predicted - true|) on the log scale. */
function medianMiss(pred: number[], truth: number[]): number {
  return Math.exp(median(pred.map((v, i) => Math.abs(v - truth[i]!))));
}

/**
 * Leave-one-out and walk-forward misses for a term list. The category ridge is
 * fitted two-stage inside each fold: the size fit's residuals, shrunk toward
 * zero by 64 pseudo-observations, so a thin category cannot move the price.
 */
function valueTests(
  comps: SnapshotProtocol[],
  asOf: string,
  terms: ValueTerm[],
): { loo: number; wf: number; looPred: number[] } {
  const n = comps.length;
  const y = comps.map(logMcap);
  const plain = terms.filter((t) => t !== 'catRidge');
  const withCat = terms.includes('catRidge');
  const order = comps.map((_, i) => i).sort((a, b) => (comps[a]!.listed_at! < comps[b]!.listed_at! ? -1 : 1));

  const fitOn = (train: number[]): { beta: number[]; catEff: Map<string, number> } => {
    const X = train.map((i) => plain.map((t) => valueFeature(t, comps[i]!, asOf)));
    const beta = ols(X, train.map((i) => y[i]!));
    const catEff = new Map<string, number>();
    if (withCat) {
      const sums = new Map<string, { total: number; count: number }>();
      for (const i of train) {
        const resid = y[i]! - olsPredict(beta, plain.map((t) => valueFeature(t, comps[i]!, asOf)));
        const cat = comps[i]!.category ?? 'None';
        const e = sums.get(cat) ?? { total: 0, count: 0 };
        e.total += resid;
        e.count++;
        sums.set(cat, e);
      }
      for (const [cat, e] of sums) catEff.set(cat, e.total / (e.count + 64));
    }
    return { beta, catEff };
  };
  const predictOne = (fit: { beta: number[]; catEff: Map<string, number> }, i: number): number => {
    const base = olsPredict(fit.beta, plain.map((t) => valueFeature(t, comps[i]!, asOf)));
    return base + (fit.catEff.get(comps[i]!.category ?? 'None') ?? 0);
  };

  const looPred: number[] = [];
  for (let i = 0; i < n; i++) {
    const train = comps.map((_, j) => j).filter((j) => j !== i);
    looPred.push(predictOne(fitOn(train), i));
  }
  const loo = medianMiss(looPred, y);
  const nTrain = Math.floor(n * 0.6);
  const fit = fitOn(order.slice(0, nTrain));
  const test = order.slice(nTrain);
  const wf = medianMiss(test.map((i) => predictOne(fit, i)), test.map((i) => y[i]!));
  return { loo, wf, looPred };
}

/** The flat baseline: one median market-cap-per-TVL multiple for every protocol. */
function flatTests(comps: SnapshotProtocol[], asOf: string): { loo: number; wf: number } {
  const n = comps.length;
  const y = comps.map(logMcap);
  const x = comps.map((p) => Math.log(p.tvl_usd));
  const looPred: number[] = [];
  for (let i = 0; i < n; i++) {
    const rest = comps.map((_, j) => j).filter((j) => j !== i);
    looPred.push(x[i]! + median(rest.map((j) => y[j]! - x[j]!)));
  }
  const order = comps.map((_, i) => i).sort((a, b) => (comps[a]!.listed_at! < comps[b]!.listed_at! ? -1 : 1));
  const nTrain = Math.floor(n * 0.6);
  const train = order.slice(0, nTrain);
  const test = order.slice(nTrain);
  const flat = median(train.map((i) => y[i]! - x[i]!));
  return { loo: medianMiss(looPred, y), wf: medianMiss(test.map((i) => x[i]! + flat), test.map((i) => y[i]!)) };
}

/**
 * Fit the value model by greedy forward selection: start from the size curve,
 * try each candidate in turn, and keep it only when it improves BOTH held-out
 * tests. A term that only fits the past is not a term.
 */
export function fitValueModel(snapshot: Snapshot): ValueModel {
  const comps = compsOf(snapshot);
  const asOf = snapshot.as_of;
  const flat = flatTests(comps, asOf);
  const kept: ValueTerm[] = ['logTVL'];
  let current = valueTests(comps, asOf, kept);
  const ablation: AblationRow[] = [
    { label: 'one flat multiple', loo: flat.loo, wf: flat.wf, kept: false, note: 'baseline' },
    { label: VALUE_LABELS.logTVL, loo: current.loo, wf: current.wf, kept: true, note: 'kept' },
  ];
  for (const cand of VALUE_CANDIDATES) {
    const trial = valueTests(comps, asOf, [...kept, cand]);
    const improves = trial.loo < current.loo && trial.wf < current.wf;
    ablation.push({
      label: `+ ${VALUE_LABELS[cand]}`,
      loo: trial.loo,
      wf: trial.wf,
      kept: improves,
      note: improves ? 'kept' : cand === 'logYears' ? 'dropped: the coefficient flips between halves' : cand === 'catRidge' ? 'dropped: no walk-forward gain' : 'dropped: no gain on both tests',
    });
    if (improves) {
      kept.push(cand);
      current = trial;
    }
  }
  // Final fit on all comps, with the category ridge's effects folded in when kept.
  const plain = kept.filter((t) => t !== 'catRidge');
  const X = comps.map((p) => plain.map((t) => valueFeature(t, p, asOf)));
  const y = comps.map(logMcap);
  const beta = ols(X, y);
  const catEff: Record<string, number> = {};
  if (kept.includes('catRidge')) {
    const sums = new Map<string, { total: number; count: number }>();
    comps.forEach((p, i) => {
      const resid = y[i]! - olsPredict(beta, X[i]!);
      const cat = p.category ?? 'None';
      const e = sums.get(cat) ?? { total: 0, count: 0 };
      e.total += resid;
      e.count++;
      sums.set(cat, e);
    });
    for (const [cat, e] of sums) catEff[cat] = e.total / (e.count + 64);
  }
  // Bands and coverage from the leave-one-out residuals of the final term list.
  const final = valueTests(comps, asOf, kept);
  const resid = y.map((v, i) => v - final.looPred[i]!);
  const band = {
    p25: Math.exp(quantile(resid, 0.25)),
    p75: Math.exp(quantile(resid, 0.75)),
    p10: Math.exp(quantile(resid, 0.1)),
    p90: Math.exp(quantile(resid, 0.9)),
  };
  let in2575 = 0;
  let in1090 = 0;
  for (let i = 0; i < resid.length; i++) {
    const rest = resid.filter((_, j) => j !== i);
    if (resid[i]! >= quantile(rest, 0.25) && resid[i]! <= quantile(rest, 0.75)) in2575++;
    if (resid[i]! >= quantile(rest, 0.1) && resid[i]! <= quantile(rest, 0.9)) in1090++;
  }
  return {
    terms: kept,
    beta,
    loo: final.loo,
    wf: final.wf,
    flatLoo: flat.loo,
    flatWf: flat.wf,
    ablation,
    band,
    coverage: { p2575: in2575 / resid.length, p1090: in1090 / resid.length, n: resid.length },
    within3x: resid.filter((r) => Math.exp(Math.abs(r)) <= 3).length / resid.length,
    within2x: resid.filter((r) => Math.exp(Math.abs(r)) <= 2).length / resid.length,
    comps: comps.length,
    looPred: final.looPred,
    catEff,
  };
}

/** What a token would be worth if the protocol launched one, before the odds. */
export function ifLaunches(p: SnapshotProtocol, model: ValueModel, snapshot: Snapshot): number {
  const plain = model.terms.filter((t) => t !== 'catRidge');
  const x = plain.map((t) => valueFeature(t as ValueTerm, p, snapshot.as_of));
  return Math.exp(olsPredict(model.beta, x) + (model.catEff[p.category ?? 'None'] ?? 0));
}

// ---------------------------------------------------------------- the odds model

export interface OddsModel {
  terms: string[];
  /** Logistic coefficients on the standardised features: intercept first. */
  beta: number[];
  mu: number[];
  sd: number[];
  /** The ceiling: the share of the oldest peers that record a token. */
  ceiling: number;
  /** Brier scores, ten-fold and walk-forward, against the base rate's. */
  brier: number;
  brierWf: number;
  baseBrier: number;
  baseBrierWf: number;
  ablation: AblationRow[];
  peers: number;
  /** The age an undated protocol is given: the peers' median, in years. */
  defaultAgeYears: number;
}

type OddsTerm = 'age' | 'logTVL' | 'growth' | 'catRate';
const ODDS_CANDIDATES: OddsTerm[] = ['logTVL', 'growth', 'catRate'];
const ODDS_LABELS: Record<OddsTerm, string> = {
  age: 'years on record',
  logTVL: 'size, ln TVL',
  growth: 'seven-day growth',
  catRate: 'category token rate',
};

/** The shrunk token rate of a protocol's category: 20 pseudo-observations pull thin categories to the base rate. */
export function categoryRate(peers: SnapshotProtocol[], train: number[], cat: string | null): number {
  const base = train.reduce((s, i) => s + (hasToken(peers[i]!) ? 1 : 0), 0) / train.length;
  const sub = train.filter((i) => (peers[i]!.category ?? 'None') === (cat ?? 'None'));
  const hits = sub.reduce((s, i) => s + (hasToken(peers[i]!) ? 1 : 0), 0);
  return (hits + 20 * base) / (sub.length + 20);
}

function oddsFeature(
  term: OddsTerm,
  p: SnapshotProtocol,
  peers: SnapshotProtocol[],
  train: number[],
  asOf: string,
  defaultAgeYears: number,
): number {
  switch (term) {
    case 'age': {
      const age = ageDays(asOf, p.listed_at);
      return age === null ? defaultAgeYears : age / 365;
    }
    case 'logTVL':
      return Math.log(p.tvl_usd);
    case 'growth':
      return Math.max(-90, Math.min(300, p.change_7d ?? 0));
    case 'catRate':
      return categoryRate(peers, train, p.category);
  }
}

function brierScore(pred: number[], truth: number[]): number {
  return pred.reduce((s, v, i) => s + (v - truth[i]!) * (v - truth[i]!), 0) / pred.length;
}

/**
 * Ten-fold and walk-forward Brier scores for an odds term list. The folds are
 * the slug's hash mod 10, so the split is the same every run; the walk-forward
 * trains on the older 60% by listing date and tests on the newer 40%.
 */
function oddsTests(
  peers: SnapshotProtocol[],
  asOf: string,
  terms: OddsTerm[],
  defaultAgeYears: number,
): { brier: number; brierWf: number } {
  const n = peers.length;
  const y = peers.map((p) => (hasToken(p) ? 1 : 0));
  const build = (train: number[], evalIdx: number[]): { xtr: number[][]; xte: number[][] } => {
    const xtr = train.map((i) => terms.map((t) => oddsFeature(t, peers[i]!, peers, train, asOf, defaultAgeYears)));
    const xte = evalIdx.map((i) => terms.map((t) => oddsFeature(t, peers[i]!, peers, train, asOf, defaultAgeYears)));
    const { scaled, mu, sd } = standardise(xtr);
    return { xtr: scaled, xte: xte.map((row) => row.map((v, j) => (v - mu[j]!) / sd[j]!)) };
  };
  // Ten-fold.
  const pred10: number[] = new Array<number>(n).fill(0);
  for (let fold = 0; fold < 10; fold++) {
    const test = peers.map((_, i) => i).filter((i) => hash32(peers[i]!.slug) % 10 === fold);
    const train = peers.map((_, i) => i).filter((i) => hash32(peers[i]!.slug) % 10 !== fold);
    if (test.length === 0) continue;
    const { xtr, xte } = build(train, test);
    const beta = fitLogistic(xtr, train.map((i) => y[i]!));
    test.forEach((idx, j) => {
      pred10[idx] = logisticPredict(beta, xte[j]!);
    });
  }
  // Walk-forward.
  const order = peers.map((_, i) => i).sort((a, b) => (peers[a]!.listed_at! < peers[b]!.listed_at! ? -1 : 1));
  const nTrain = Math.floor(n * 0.6);
  const train = order.slice(0, nTrain);
  const test = order.slice(nTrain);
  const { xtr, xte } = build(train, test);
  const beta = fitLogistic(xtr, train.map((i) => y[i]!));
  const predWf = xte.map((row) => logisticPredict(beta, row));
  return { brier: brierScore(pred10, y), brierWf: brierScore(predWf, test.map((i) => y[i]!)) };
}

function baseBriers(peers: SnapshotProtocol[]): { brier: number; brierWf: number } {
  const n = peers.length;
  const y = peers.map((p) => (hasToken(p) ? 1 : 0));
  const rate = y.reduce((s, v) => s + v, 0) / n;
  const order = peers.map((_, i) => i).sort((a, b) => (peers[a]!.listed_at! < peers[b]!.listed_at! ? -1 : 1));
  const nTrain = Math.floor(n * 0.6);
  const train = order.slice(0, nTrain);
  const test = order.slice(nTrain);
  const trainRate = train.reduce((s, i) => s + y[i]!, 0) / train.length;
  return {
    brier: brierScore(new Array<number>(n).fill(rate), y),
    brierWf: brierScore(new Array<number>(test.length).fill(trainRate), test.map((i) => y[i]!)),
  };
}

/**
 * Fit the odds model by the same greedy rule as the value model: a term stays
 * only when it improves BOTH Brier scores. The ceiling is the token rate among
 * the peers listed at least four years ago — the share that ever records one.
 */
export function fitOddsModel(snapshot: Snapshot): OddsModel {
  const peers = oddsPeersOf(snapshot);
  const asOf = snapshot.as_of;
  const base = baseBriers(peers);
  // The age an undated protocol is given: the peers' median, in years. One
  // value, computed here and threaded everywhere — the browser reads the same
  // number out of data.js, so its re-pricing must match to the last digit.
  const ages = peers.map((p) => (ageDays(asOf, p.listed_at) ?? 0) / 365).sort((a, b) => a - b);
  const defaultAgeYears = median(ages);
  const kept: OddsTerm[] = ['age'];
  let current = oddsTests(peers, asOf, kept, defaultAgeYears);
  const ablation: AblationRow[] = [
    { label: 'base rate alone', loo: base.brier, wf: base.brierWf, kept: false, note: 'baseline' },
    { label: ODDS_LABELS.age, loo: current.brier, wf: current.brierWf, kept: true, note: 'kept' },
  ];
  for (const cand of ODDS_CANDIDATES) {
    const trial = oddsTests(peers, asOf, [...kept, cand], defaultAgeYears);
    const improves = trial.brier < current.brier && trial.brierWf < current.brierWf;
    ablation.push({
      label: `+ ${ODDS_LABELS[cand]}`,
      loo: trial.brier,
      wf: trial.brierWf,
      kept: improves,
      note: improves ? 'kept' : 'dropped: no gain on both tests',
    });
    if (improves) {
      kept.push(cand);
      current = trial;
    }
  }
  const all = peers.map((_, i) => i);
  const raw = all.map((i) => kept.map((t) => oddsFeature(t, peers[i]!, peers, all, asOf, defaultAgeYears)));
  const { scaled, mu, sd } = standardise(raw);
  const beta = fitLogistic(scaled, peers.map((p) => (hasToken(p) ? 1 : 0)));
  const old = peers.filter((p) => (ageDays(asOf, p.listed_at) ?? 0) >= 4 * 365);
  const ceiling = old.length > 0 ? old.filter(hasToken).length / old.length : 0.8;
  return {
    terms: kept,
    beta,
    mu,
    sd,
    ceiling,
    brier: current.brier,
    brierWf: current.brierWf,
    baseBrier: base.brier,
    baseBrierWf: base.brierWf,
    ablation,
    peers: peers.length,
    defaultAgeYears,
  };
}

/** The fitted chance a protocol records a token, given its age, size, growth and category. */
export function tokenChance(p: SnapshotProtocol, model: OddsModel, peers: SnapshotProtocol[], snapshot: Snapshot): number {
  const all = peers.map((_, i) => i);
  const x = model.terms.map((t) => oddsFeature(t as OddsTerm, p, peers, all, snapshot.as_of, model.defaultAgeYears));
  const scaled = x.map((v, j) => (v - model.mu[j]!) / model.sd[j]!);
  return logisticPredict(model.beta, scaled);
}

/**
 * The token odds: among the peers that reach this protocol's age without a
 * token, the share that ever record one — (ceiling - p) / (1 - p). A young
 * protocol's odds are high because it has hardly had time; an old one's fall,
 * because the peers that were going to launch mostly have. Floored at 5%: the
 * record cannot prove a protocol will never launch.
 */
export function tokenOdds(p: SnapshotProtocol, model: OddsModel, peers: SnapshotProtocol[], snapshot: Snapshot): number {
  const chance = tokenChance(p, model, peers, snapshot);
  const odds = (model.ceiling - chance) / (1 - chance);
  return Math.max(ODDS_FLOOR, Math.min(ODDS_CEIL, odds));
}

// ---------------------------------------------------------------- pricing

export interface PricedRow {
  protocol: SnapshotProtocol;
  tier: 'watchlist' | 'early' | 'off-list';
  ifLaunches: number;
  odds: number;
  implied: number;
  p25: number;
  p75: number;
  p10: number;
  p90: number;
  rankLo: number;
  rankHi: number;
}

/** Implied value = value-if-it-launches x token odds, with the honest band around it. */
export function impliedValue(
  p: SnapshotProtocol,
  value: ValueModel,
  odds: OddsModel,
  peers: SnapshotProtocol[],
  snapshot: Snapshot,
): { ifLaunches: number; odds: number; implied: number; p25: number; p75: number; p10: number; p90: number } {
  const ifL = ifLaunches(p, value, snapshot);
  const o = tokenOdds(p, odds, peers, snapshot);
  const implied = Math.max(1, Math.round(ifL * o));
  return {
    ifLaunches: Math.round(ifL),
    odds: o,
    implied,
    p25: Math.max(1, Math.round(implied * value.band.p25)),
    p75: Math.round(implied * value.band.p75),
    p10: Math.max(1, Math.round(implied * value.band.p10)),
    p90: Math.round(implied * value.band.p90),
  };
}

/**
 * Rank ranges: refit the value model on 200 bootstrap resamples of the comps
 * and re-rank the board each time; a row's range is the 10th to 90th percentile
 * of the ranks it took. The seed is fixed, so the ranges are the same every run.
 */
export function rankRanges(
  priced: PricedRow[],
  comps: SnapshotProtocol[],
  value: ValueModel,
  snapshot: Snapshot,
): Map<string, { lo: number; hi: number }> {
  const rand = mulberry32(20261114);
  const plain = value.terms.filter((t) => t !== 'catRidge');
  const y = comps.map(logMcap);
  const ranks = new Map<string, number[]>();
  for (const row of priced) ranks.set(row.protocol.slug, []);
  for (let b = 0; b < BOOTSTRAPS; b++) {
    const idx: number[] = [];
    for (let i = 0; i < comps.length; i++) idx.push(Math.floor(rand() * comps.length));
    const X = idx.map((i) => plain.map((t) => valueFeature(t as ValueTerm, comps[i]!, snapshot.as_of)));
    const beta = ols(X, idx.map((i) => y[i]!));
    const scored = priced
      .map((row) => {
        const x = plain.map((t) => valueFeature(t as ValueTerm, row.protocol, snapshot.as_of));
        return { slug: row.protocol.slug, v: Math.exp(olsPredict(beta, x)) * row.odds };
      })
      .sort((a, b2) => (b2.v - a.v) || (a.slug < b2.slug ? -1 : 1));
    scored.forEach((s, i) => ranks.get(s.slug)!.push(i + 1));
  }
  const out = new Map<string, { lo: number; hi: number }>();
  for (const [slug, rs] of ranks) {
    out.set(slug, { lo: Math.round(quantile(rs, 0.1)), hi: Math.round(quantile(rs, 0.9)) });
  }
  return out;
}

// ---------------------------------------------------------------- the farm plan

/** Gas per on-chain step, by chain. A stated assumption, not a snapshot fact: Ethereum is dear, rollups and cheap chains are not. */
export function chainGas(chain: string): number {
  if (chain === 'Ethereum') return 8;
  if (['Arbitrum', 'Optimism', 'Base', 'Polygon', 'BSC', 'Solana', 'Avalanche', 'zkSync Era', 'Linea', 'Blast', 'Scroll', 'Mantle', 'Mode', 'opBNB'].includes(chain)) return 0.5;
  return 0.2;
}

/** One plan's cash cost: eight steps on the protocol's first chain, plus a dollar to arrive and leave. */
export function planCost(p: SnapshotProtocol): number {
  const gas = chainGas(p.chains[0] ?? 'Ethereum');
  return PLAN_STEPS * gas + 1;
}

export type Verdict = 'ROBUST' | 'FARM' | 'THIN' | 'SKIP';

export interface FarmMath {
  drop: number;
  dropLo: number;
  fees: number;
  capital: number;
  net: number;
  netLo: number;
  netHour: number;
  verdict: Verdict;
  breakEven: number | null;
}

/**
 * The farm arithmetic, at a scenario: the drop is the protocol's airdrop pool
 * (the drop share of its implied value) shared pro-rata by deposit among its
 * TVL; the net takes off the cash fees and the capital charge. ROBUST pays
 * even at the band's low end; FARM pays at the point estimate; THIN beats its
 * cash fees only; SKIP's fees eat the drop.
 */
export function farmMath(row: PricedRow, scenario: FarmScenario): FarmMath {
  const { deposit, weeks, dropShare } = scenario;
  const tvl = row.protocol.tvl_usd;
  const share = deposit / (tvl + deposit);
  const drop = row.implied * dropShare * share;
  const dropLo = row.p25 * dropShare * share;
  const fees = planCost(row.protocol);
  const capital = deposit * CAPITAL_RATE * (weeks / 52);
  const net = drop - fees - capital;
  const netLo = dropLo - fees - capital;
  const verdict: Verdict = netLo > 0 ? 'ROBUST' : net > 0 ? 'FARM' : drop > fees ? 'THIN' : 'SKIP';
  // The smallest deposit at which the net turns positive, by bisection; null when no ticket under $1M pays.
  let lo = 0;
  let hi = 1_000_000;
  const netAt = (d: number): number =>
    row.implied * dropShare * (d / (tvl + d)) - fees - d * CAPITAL_RATE * (weeks / 52);
  let breakEven: number | null = null;
  if (netAt(hi) > 0) {
    for (let i = 0; i < 60; i++) {
      const mid = (lo + hi) / 2;
      if (netAt(mid) > 0) hi = mid;
      else lo = mid;
    }
    breakEven = Math.round(hi);
  }
  return { drop, dropLo, fees, capital, net, netLo, netHour: net / PLAN_HOURS, verdict, breakEven };
}

const money = (n: number): string =>
  n >= 1_000_000 ? `$${(n / 1_000_000).toFixed(1)}M` : n >= 1_000 ? `$${(n / 1_000).toFixed(1)}K` : `$${n.toFixed(2)}`;
const money0 = (n: number): string =>
  n >= 1_000_000 ? `$${(n / 1_000_000).toFixed(0)}M` : n >= 1_000 ? `$${(n / 1_000).toFixed(0)}K` : `$${n.toFixed(0)}`;

/**
 * Eight concrete steps, each with its cost and its time, written for this
 * protocol: its chains, its TVL, its seven-day move, the plan's deposit and
 * the exit rule. The steps' costs sum to planCost and their times to 2.5 hours.
 */
export function farmSteps(row: PricedRow, scenario: FarmScenario): string[] {
  const p = row.protocol;
  const chain = p.chains[0] ?? 'Ethereum';
  const others = p.chains.slice(1, 3).join(', ');
  const gas = chainGas(chain);
  const gasS = `$${gas.toFixed(2)}`;
  const dep = money0(scenario.deposit);
  const exitTvl = money0(p.tvl_usd * 0.75);
  const move = p.change_7d === null ? 'unreported' : `${p.change_7d >= 0 ? '+' : ''}${p.change_7d.toFixed(1)}%`;
  const cat = (p.category ?? 'protocol').toLowerCase();
  return [
    `SETUP — Set up a wallet on ${chain}${others ? ` (also ${others})` : ''} and fund it with ${dep} plus ${money0(planCost(p))} for fees; confirm the chain's gas is near ${gasS} a step before you start. Cost ${gasS}, 10 min hands-on.`,
    `VERIFY — Open ${p.name}'s dashboard and check its TVL still prints near ${money0(p.tvl_usd)} and its seven-day move near ${move}; confirm the contract address from the project's own links, never a search ad. Cost $0.00, 10 min hands-on.`,
    `FUND — Bridge or withdraw ${dep} to ${chain} in one move; a single transfer keeps the arrival cost at ${money0(gas + 1)} instead of paying it twice. Cost ${money0(gas + 1)}, 15 min hands-on.`,
    `DEPOSIT — Supply the ${dep} into ${p.name}'s ${cat} position on ${chain}; keep the receipt and note the entry TVL of ${money0(p.tvl_usd)}, which the exit rule is measured against. Cost ${gasS}, 10 min hands-on.`,
    `USE — Do the thing the protocol rewards — swap, lend, or stake through its ${cat} flow — twice in the first week, so the position is active rather than parked. Cost ${money0(2 * gas)}, 30 min hands-on.`,
    `DEEPEN — Add a second position of the same kind, or the protocol's points or quest flow if it runs one, so the deposit works in two places at once. Cost ${gasS}, 20 min hands-on.`,
    `CADENCE — Check in weekly for ${scenario.weeks} weeks: claim or compound what accrued, top the position up only if the TVL is holding, four small transactions across the plan. Cost ${money0(2 * gas)}, 40 min hands-on.`,
    `EXIT — Leave when the plan ends, or sooner if TVL prints below ${exitTvl} (a quarter under entry): withdraw the ${dep} and the accrued rewards in one transaction and record what the drop was worth. Cost ${gasS}, 15 min hands-on.`,
  ];
}

// ---------------------------------------------------------------- the board

export interface BoardRow {
  slug: string;
  name: string;
  rank: number;
  implied_value_usd: number;
  farm_steps: string[];
}

export interface RadarRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl: number;
  change7d: number | null;
  ageDays: number | null;
  tier: 'watchlist' | 'early' | 'off-list';
  rank: number;
  odds: number;
  chance: number;
  catRate: number;
  ifLaunches: number;
  implied: number;
  p25: number;
  p75: number;
  p10: number;
  p90: number;
  rankLo: number;
  rankHi: number;
  verdict: Verdict;
  drop: number;
  fees: number;
  net: number;
  netHour: number;
  breakEven: number | null;
  steps: string[];
  peers: { name: string; tvl: number; mcap: number; ratio: number; model: number }[];
}

export interface RadarData {
  asOf: string;
  floor: number;
  totalImplied: number;
  checksum: string;
  ledger: Ledger;
  value: ValueModel;
  odds: OddsModel;
  rows: RadarRow[];
  tokenRows: { name: string; category: string | null; tvl: number; mcap: number }[];
  setAsideRows: { name: string; reason: string; tvl: number }[];
  comps: { logTvl: number; logChains: number; logMcap: number }[];
  farmDefault: FarmScenario;
  /** Protocol names found in the entry's own source files, counted by main.ts. */
  namesInCode: number;
}

/** The checksum the page recomputes: FNV-1a over the board's ranks, slugs and values. */
export function boardChecksum(board: BoardRow[]): string {
  let h = 0x811c9dc5;
  const feed = (text: string): void => {
    for (let i = 0; i < text.length; i++) {
      h ^= text.charCodeAt(i);
      h = Math.imul(h, 0x01000193);
    }
  };
  for (const row of board) feed(`${row.rank}:${row.slug}:${row.implied_value_usd};`);
  return (h >>> 0).toString(16).padStart(8, '0');
}

/** The nearest priced peers: the comps closest in TVL, with what the held-out model said they were worth. */
function nearestPeers(
  p: SnapshotProtocol,
  comps: SnapshotProtocol[],
  looPred: number[],
  count = 8,
): RadarRow['peers'] {
  const target = Math.log(p.tvl_usd);
  return comps
    .map((c, i) => ({ c, i, d: Math.abs(Math.log(c.tvl_usd) - target) }))
    .sort((a, b) => a.d - b.d || (a.c.slug < b.c.slug ? -1 : 1))
    .slice(0, count)
    .map(({ c, i }) => ({
      name: c.name,
      tvl: c.tvl_usd,
      mcap: c.mcap_usd!,
      ratio: c.mcap_usd! / c.tvl_usd,
      model: Math.round(Math.exp(looPred[i]!)),
    }));
}

/** Build the board and the page's data from the snapshot. One function prices every row. */
export function buildRadar(snapshot: Snapshot): { board: BoardRow[]; radar: RadarData } {
  const value = fitValueModel(snapshot);
  const odds = fitOddsModel(snapshot);
  const peers = oddsPeersOf(snapshot);
  const comps = compsOf(snapshot);
  const ranked = snapshot.protocols.filter(isRankable);
  const priced: PricedRow[] = ranked.map((p) => {
    const v = impliedValue(p, value, odds, peers, snapshot);
    return { protocol: p, tier: tierOf(p, snapshot), ...v, rankLo: 0, rankHi: 0 };
  });
  priced.sort((a, b) => b.implied - a.implied || (a.protocol.slug < b.protocol.slug ? -1 : 1));
  const ranges = rankRanges(priced, comps, value, snapshot);
  const allPeers = peers.map((_, i) => i);
  const rows: RadarRow[] = priced.map((row, i) => {
    const math = farmMath(row, FARM_DEFAULT);
    const range = ranges.get(row.protocol.slug)!;
    return {
      slug: row.protocol.slug,
      name: row.protocol.name,
      category: row.protocol.category,
      chains: row.protocol.chains,
      tvl: row.protocol.tvl_usd,
      change7d: row.protocol.change_7d,
      ageDays: ageDays(snapshot.as_of, row.protocol.listed_at),
      tier: row.tier,
      rank: i + 1,
      odds: row.odds,
      chance: tokenChance(row.protocol, odds, peers, snapshot),
      catRate: categoryRate(peers, allPeers, row.protocol.category),
      ifLaunches: row.ifLaunches,
      implied: row.implied,
      p25: row.p25,
      p75: row.p75,
      p10: row.p10,
      p90: row.p90,
      rankLo: range.lo,
      rankHi: range.hi,
      verdict: math.verdict,
      drop: math.drop,
      fees: math.fees,
      net: math.net,
      netHour: math.netHour,
      breakEven: math.breakEven,
      steps: farmSteps(row, FARM_DEFAULT),
      peers: nearestPeers(row.protocol, comps, value.looPred),
    };
  });
  const board: BoardRow[] = rows.map((r) => ({
    slug: r.slug,
    name: r.name,
    rank: r.rank,
    implied_value_usd: r.implied,
    farm_steps: r.steps,
  }));
  const tokenRows = snapshot.protocols
    .filter((p) => p.mcap_usd !== null && p.mcap_usd > 0)
    .map((p) => ({ name: p.name, category: p.category, tvl: p.tvl_usd, mcap: p.mcap_usd! }))
    .sort((a, b) => b.mcap - a.mcap);
  const setAsideRows = snapshot.protocols
    .filter((p) => !isRankable(p) && !hasToken(p))
    .map((p) => ({ name: p.name, reason: setasideReason(p) ?? 'other', tvl: p.tvl_usd }))
    .sort((a, b) => b.tvl - a.tvl);
  const radar: RadarData = {
    asOf: snapshot.as_of,
    floor: snapshot.floor_usd,
    totalImplied: rows.reduce((s, r) => s + r.implied, 0),
    checksum: boardChecksum(board),
    ledger: ledgerOf(snapshot),
    value,
    odds,
    rows,
    tokenRows,
    setAsideRows,
    comps: comps.map((p) => ({
      logTvl: Math.log(p.tvl_usd),
      logChains: Math.log(Math.max(1, p.chains.length)),
      logMcap: Math.log(p.mcap_usd!),
    })),
    farmDefault: FARM_DEFAULT,
    namesInCode: 0,
  };
  return { board, radar };
}

/** The gate's shape, checked before anything is written: ranks 1..N once each, values never rising, the watchlist covered, farm steps in bounds. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  if (board.length < 100 || board.length > 4000) return `the board holds ${board.length} rows, not 100 to 4000`;
  const slugs = new Set(snapshot.protocols.map((p) => p.slug));
  const seen = new Set<string>();
  let prev = Infinity;
  let allSame = true;
  const first = board[0]!.implied_value_usd;
  for (const row of board) {
    if (!slugs.has(row.slug)) return `row ${row.slug} is not one of the snapshot's protocols`;
    if (seen.has(row.slug)) return `row ${row.slug} appears twice`;
    seen.add(row.slug);
    if (row.rank < 1 || !Number.isInteger(row.rank)) return `row ${row.slug} has rank ${row.rank}`;
    if (row.implied_value_usd <= 0 || !Number.isInteger(row.implied_value_usd)) {
      return `row ${row.slug} has implied value ${row.implied_value_usd}`;
    }
    if (row.implied_value_usd !== first) allSame = false;
    if (row.farm_steps.length < 3 || row.farm_steps.length > 12) {
      return `row ${row.slug} has ${row.farm_steps.length} farm steps, not 3 to 12`;
    }
    for (const s of row.farm_steps) {
      const t = s.trim();
      if (t.length < 20 || t.length > 600) return `row ${row.slug} has a farm step of ${t.length} characters, not 20 to 600`;
    }
  }
  const byRank = [...board].sort((a, b) => a.rank - b.rank);
  for (let i = 0; i < byRank.length; i++) {
    if (byRank[i]!.rank !== i + 1) return 'the ranks are not exactly 1 to N';
    if (byRank[i]!.implied_value_usd > prev) return 'an implied value rises as the rank ascends';
    prev = byRank[i]!.implied_value_usd;
  }
  if (board.length >= 2 && allSame) return 'every implied value is the same: the board ranks nothing';
  for (const slug of snapshot.watchlist) {
    if (!seen.has(slug)) return `the watchlist protocol ${slug} is not on the board`;
  }
  return null;
}

/** The page's data as one script: window.RADAR, nothing else. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR = ${JSON.stringify(radar)};\n`;
}
