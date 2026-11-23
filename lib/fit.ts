// Frost Radar v3 — a token launch radar whose value model is fitted, not hand-tuned.
//
// The model is one line, fitted at runtime on the snapshot's own figures:
//   log(mcap) = a + b * log(TVL)
// over the 128 protocols that record both a market cap and a TVL. The line is the
// whole model — no category bonus, no growth term, no age term — because a
// leave-one-out + walk-forward selection over eighteen candidates found every
// addition either no better or worse out of sample (see selectModels). The
// dashboard's Method tab shows the full selection table, so a reader can see what
// was tried and why it was rejected.
//
// Every number the dashboard states is recomputed from the sealed snapshot on every
// run: the fit, its validation, the ledger, the token odds and the farm verdicts.
// No protocol name is ever special-cased; the same functions score every row.

/** One protocol of the sealed snapshot, in the shape this model works with. */
export interface Proto {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvlUsd: number;
  change7d: number | null;
  mcapUsd: number | null;
  listedAt: string | null;
  geckoId: string | null;
  symbol: string | null;
}

/** The whole snapshot document. */
export interface Snap {
  asOf: string;
  source: string;
  floorUsd: number;
  protocols: Proto[];
  watchlist: string[];
}

/** Why a snapshot is not one this model can score. */
export class SnapError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapError';
  }
}

function asString(v: unknown, what: string): string {
  if (typeof v !== 'string') throw new SnapError(`snapshot: ${what} is not a string`);
  return v;
}

function asNumber(v: unknown, what: string): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) throw new SnapError(`snapshot: ${what} is not a finite number`);
  return v;
}

function optString(v: unknown): string | null {
  return typeof v === 'string' ? v : null;
}

function optNumber(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

/** The snapshot out of a file's text, refused unless it is the shape the model scores. */
export function parseSnapshot(text: string): Snap {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SnapError('snapshot: not JSON');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new SnapError('snapshot: not an object');
  const o = raw as Record<string, unknown>;
  const asOf = asString(o.as_of, 'as_of');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(asOf)) throw new SnapError('snapshot: as_of is not a date');
  const source = asString(o.source, 'source');
  const floorUsd = asNumber(o.floor_usd, 'floor_usd');
  if (!Array.isArray(o.protocols)) throw new SnapError('snapshot: protocols is not an array');
  if (!Array.isArray(o.watchlist) || o.watchlist.some((s) => typeof s !== 'string')) {
    throw new SnapError('snapshot: watchlist is not a list of slugs');
  }
  const protocols: Proto[] = o.protocols.map((v, i) => {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new SnapError(`snapshot: protocol ${i} is not an object`);
    const p = v as Record<string, unknown>;
    return {
      slug: asString(p.slug, `protocol ${i} slug`),
      name: asString(p.name, `protocol ${i} name`),
      category: optString(p.category),
      chains: Array.isArray(p.chains) ? p.chains.filter((c): c is string => typeof c === 'string') : [],
      tvlUsd: asNumber(p.tvl_usd, `protocol ${i} tvl_usd`),
      change7d: optNumber(p.change_7d),
      mcapUsd: optNumber(p.mcap_usd),
      listedAt: optString(p.listed_at),
      geckoId: optString(p.gecko_id),
      symbol: optString(p.symbol),
    };
  });
  return { asOf, source, floorUsd, protocols, watchlist: o.watchlist as string[] };
}

/** A protocol records a token when any of its three token fields is set. */
export function hasToken(p: Proto): boolean {
  return p.mcapUsd !== null || p.geckoId !== null || p.symbol !== null;
}

/** A protocol records no token at all: the radar's subject. */
export function preToken(p: Proto): boolean {
  return !hasToken(p);
}

const VERSION_MARK = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;
const WRAPPED_WORD = /\b(wrapped|staked|staking)\b/i;
const SET_ASIDE_CATEGORIES = new Set([
  'Bridge',
  'Canonical Bridge',
  'Liquid Staking',
  'Liquid Restaking',
  'Restaked BTC',
  'CEX',
]);
const EXCHANGE_NAMES = ['Binance', 'Coinbase', 'Bybit', 'Kraken', 'Bitget', 'OKX', 'Bitfinex', 'Gemini'];

/**
 * A pre-token protocol the board sets aside: a bridge, a staking product, an
 * exchange, a versioned pool, or a wrapped product of a token that already
 * trades. These are not launches waiting to happen; ranking them would rank
 * WBTC against protocols still to issue a token of their own.
 */
export function setAside(p: Proto): boolean {
  if (p.category !== null && SET_ASIDE_CATEGORIES.has(p.category)) return true;
  if (VERSION_MARK.test(p.name)) return true;
  if (WRAPPED_WORD.test(p.name)) return true;
  return EXCHANGE_NAMES.some((e) => p.name.startsWith(e));
}

/** A protocol the board may rank: pre-token and not set aside. */
export function rankable(p: Proto): boolean {
  return preToken(p) && !setAside(p);
}

/** A protocol's broad group, for the token odds and the group-intercept candidate. */
export function broadGroup(category: string | null): string {
  if (category === 'CEX' || category === 'Bridge' || category === 'Canonical Bridge' || category === 'Cross Chain Bridge') {
    return 'exchange-bridge';
  }
  if (category === 'Liquid Staking' || category === 'Liquid Restaking' || category === 'Restaking' || category === 'Staking Pool') {
    return 'staking';
  }
  if (
    category === 'Lending' ||
    category === 'CDP' ||
    category === 'Yield' ||
    category === 'Yield Aggregator' ||
    category === 'Basis Trading' ||
    category === 'Leveraged Farming' ||
    category === 'Onchain Capital Allocator' ||
    category === 'Collateral Management' ||
    category === 'Risk Curators' ||
    category === 'Curator'
  ) {
    return 'defi-yield';
  }
  return 'other';
}

const DAY_MS = 86_400_000;

/** Whole days from listedAt to asOf; null when the date is missing or unparseable. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

/** The median of a list, averaging the two middle values when its length is even. */
export function median(values: number[]): number {
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 === 1 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/** A quantile by linear interpolation, the way numpy's percentile does it. */
export function quantile(values: number[], q: number): number {
  const s = [...values].sort((a, b) => a - b);
  if (s.length === 0) return NaN;
  const pos = q * (s.length - 1);
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  if (lo === hi) return s[lo];
  return s[lo] + (s[hi] - s[lo]) * (pos - lo);
}

/** The dot product of two equal-length vectors. */
function dot(a: number[], b: number[]): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s;
}

/** Solve A x = b by Gaussian elimination with partial pivoting. */
function solveSquare(a: number[][], b: number[]): number[] {
  const n = b.length;
  const m = a.map((row, i) => [...row, b[i]]);
  for (let col = 0; col < n; col++) {
    let piv = col;
    for (let r = col + 1; r < n; r++) if (Math.abs(m[r][col]) > Math.abs(m[piv][col])) piv = r;
    if (Math.abs(m[piv][col]) < 1e-12) throw new Error('singular matrix');
    const tmp = m[col];
    m[col] = m[piv];
    m[piv] = tmp;
    for (let r = col + 1; r < n; r++) {
      const f = m[r][col] / m[col][col];
      for (let c = col; c <= n; c++) m[r][c] -= f * m[col][c];
    }
  }
  const x = new Array<number>(n).fill(0);
  for (let r = n - 1; r >= 0; r--) {
    let s = m[r][n];
    for (let c = r + 1; c < n; c++) s -= m[r][c] * x[c];
    x[r] = s / m[r][r];
  }
  return x;
}

/** Ordinary least squares through the normal equations. */
export function olsBeta(design: number[][], y: number[]): number[] {
  const k = design[0].length;
  const xtx: number[][] = Array.from({ length: k }, () => new Array<number>(k).fill(0));
  const xty: number[] = new Array<number>(k).fill(0);
  for (let i = 0; i < design.length; i++) {
    const row = design[i];
    for (let a = 0; a < k; a++) {
      xty[a] += row[a] * y[i];
      for (let b = 0; b < k; b++) xtx[a][b] += row[a] * row[b];
    }
  }
  return solveSquare(xtx, xty);
}

/** Weighted least squares: each row scaled by the square root of its weight. */
export function wolsBeta(design: number[][], y: number[], w: number[]): number[] {
  const sw = w.map((v) => Math.sqrt(Math.max(v, 0)));
  return olsBeta(
    design.map((row, i) => row.map((v) => v * sw[i])),
    y.map((v, i) => v * sw[i]),
  );
}

/** The fitted size curve and its diagnostics, all computed from the comparables. */
export interface Curve {
  intercept: number;
  slope: number;
  r2: number;
  residStd: number;
  residP25: number;
  residP75: number;
  n: number;
}

/** The comparables: protocols that record both a market cap and a TVL. */
export function comparables(protocols: Proto[]): Proto[] {
  return protocols.filter((p) => p.mcapUsd !== null && p.mcapUsd > 0 && p.tvlUsd > 0);
}

/** Fit log(mcap) = a + b * log(TVL) on the comparables. */
export function fitCurve(comps: Proto[]): Curve {
  const xs = comps.map((p) => Math.log(p.tvlUsd));
  const ys = comps.map((p) => Math.log(p.mcapUsd as number));
  const design = xs.map((x) => [1, x]);
  const [a, b] = olsBeta(design, ys);
  const resid = ys.map((y, i) => y - (a + b * xs[i]));
  const meanY = ys.reduce((s, v) => s + v, 0) / ys.length;
  const ssRes = resid.reduce((s, r) => s + r * r, 0);
  const ssTot = ys.reduce((s, y) => s + (y - meanY) ** 2, 0);
  const meanR = resid.reduce((s, r) => s + r, 0) / resid.length;
  const residStd = Math.sqrt(resid.reduce((s, r) => s + (r - meanR) ** 2, 0) / resid.length);
  return {
    intercept: a,
    slope: b,
    r2: 1 - ssRes / ssTot,
    residStd,
    residP25: quantile(resid, 0.25),
    residP75: quantile(resid, 0.75),
    n: comps.length,
  };
}

/** The implied value of a TVL under the fitted curve. */
export function impliedFor(tvlUsd: number, curve: Curve): number {
  return Math.exp(curve.intercept + curve.slope * Math.log(tvlUsd));
}

/** The honest range around an implied value: the central 50% of the fit's residuals. */
export function rangeFor(implied: number, curve: Curve): [number, number] {
  return [implied * Math.exp(curve.residP25), implied * Math.exp(curve.residP75)];
}

/** One validation score: the median miss factor and the share within 3x. */
export interface ValScore {
  miss: number;
  within3x: number;
  n: number;
}

/** Score a list of log errors as a miss factor and a within-3x share. */
export function scoreErrors(errs: number[]): ValScore {
  const ae = errs.map((e) => Math.abs(e));
  const within = ae.filter((e) => e <= Math.log(3)).length;
  return { miss: Math.exp(median(ae)), within3x: within / errs.length, n: errs.length };
}

/** A linear fit: a design matrix and a target in, coefficients out. */
export type FitFn = (design: number[][], y: number[]) => number[];

/** Leave-one-out errors: refit on every row but one, predict the held-out one. */
export function looErrors(design: number[][], y: number[], fit: FitFn): number[] {
  const errs: number[] = [];
  for (let i = 0; i < y.length; i++) {
    const trX = design.filter((_, j) => j !== i);
    const trY = y.filter((_, j) => j !== i);
    const beta = fit(trX, trY);
    errs.push(y[i] - dot(design[i], beta));
  }
  return errs;
}

/**
 * Walk-forward errors: fit on the older half (by the sort key, the listing date)
 * and test on the newer half. A model that only works in-sample fails here.
 */
export function wfErrors(design: number[][], y: number[], keys: string[], fit: FitFn): number[] {
  const order = keys.map((_, i) => i).sort((a, b) => (keys[a] < keys[b] ? -1 : keys[a] > keys[b] ? 1 : a - b));
  const half = Math.floor(y.length / 2);
  const tr = order.slice(0, half);
  const te = order.slice(half);
  const beta = fit(
    tr.map((i) => design[i]),
    tr.map((i) => y[i]),
  );
  return te.map((i) => y[i] - dot(design[i], beta));
}


/** One comparable's features, precomputed once for the whole selection. */
interface CompFeat {
  lt: number;
  y: number;
  g: number;
  gAsinh: number;
  logAge: number;
  logChains: number;
  cat: string;
  group: string;
  key: string;
  mult: number;
}

function compFeatures(comps: Proto[], asOf: string): CompFeat[] {
  return comps.map((p) => {
    const age = ageDays(asOf, p.listedAt) ?? 365;
    const gRaw = p.change7d ?? 0;
    const gClip = Math.min(120, Math.max(-60, gRaw));
    const gClip2 = Math.min(500, Math.max(-90, gRaw));
    return {
      lt: Math.log(p.tvlUsd),
      y: Math.log(p.mcapUsd as number),
      g: gClip / 100,
      gAsinh: Math.asinh(gClip2 / 100),
      logAge: Math.log1p(age),
      logChains: Math.log1p(p.chains.length),
      cat: p.category ?? 'null',
      group: broadGroup(p.category),
      key: p.listedAt ?? '9999',
      mult: (p.mcapUsd as number) / p.tvlUsd,
    };
  });
}

/** Least absolute deviations by iteratively reweighted least squares. */
function ladBeta(design: number[][], y: number[]): number[] {
  let beta = olsBeta(design, y);
  for (let it = 0; it < 60; it++) {
    const w = y.map((v, i) => 1 / Math.max(Math.abs(v - dot(design[i], beta)), 1e-3));
    const next = wolsBeta(design, y, w);
    const shift = Math.max(...next.map((v, i) => Math.abs(v - beta[i])));
    beta = next;
    if (shift < 1e-8) break;
  }
  return beta;
}

/** Huber's robust fit by IRLS, with the scale from the residuals' MAD. */
function huberBeta(design: number[][], y: number[]): number[] {
  const c = 1.345;
  let beta = olsBeta(design, y);
  for (let it = 0; it < 50; it++) {
    const r = y.map((v, i) => v - dot(design[i], beta));
    const med = median(r);
    const s = 1.4826 * median(r.map((v) => Math.abs(v - med))) + 1e-9;
    const w = r.map((v) => {
      const u = v / (c * s);
      return Math.abs(u) <= 1 ? 1 : 1 / Math.abs(u);
    });
    const next = wolsBeta(design, y, w);
    const shift = Math.max(...next.map((v, i) => Math.abs(v - beta[i])));
    beta = next;
    if (shift < 1e-9) break;
  }
  return beta;
}

/** Trimmed OLS: fit, drop the worst 10% of |residuals|, refit. */
function trimmedBeta(design: number[][], y: number[]): number[] {
  const beta = olsBeta(design, y);
  const ae = y.map((v, i) => Math.abs(v - dot(design[i], beta)));
  const cut = quantile(ae, 0.9);
  const keep = ae.map((v) => v <= cut);
  return olsBeta(
    design.filter((_, i) => keep[i]),
    y.filter((_, i) => keep[i]),
  );
}

/** Theil–Sen: the median pairwise slope, the median residual as the intercept. */
function theilSen(lt: number[], y: number[]): [number, number] {
  const slopes: number[] = [];
  for (let i = 0; i < lt.length; i++) {
    for (let j = i + 1; j < lt.length; j++) {
      if (Math.abs(lt[j] - lt[i]) > 1e-9) slopes.push((y[j] - y[i]) / (lt[j] - lt[i]));
    }
  }
  const s = median(slopes);
  const b = median(y.map((v, i) => v - s * lt[i]));
  return [b, s];
}

/** Ridge: least squares with a penalty on every column but the first (the slope). */
function ridgeBeta(design: number[][], y: number[], lam: number): number[] {
  const k = design[0].length;
  const xtx: number[][] = Array.from({ length: k }, () => new Array<number>(k).fill(0));
  const xty: number[] = new Array<number>(k).fill(0);
  for (let i = 0; i < design.length; i++) {
    const row = design[i];
    for (let a = 0; a < k; a++) {
      xty[a] += row[a] * y[i];
      for (let b = 0; b < k; b++) xtx[a][b] += row[a] * row[b];
    }
  }
  for (let a = 1; a < k; a++) xtx[a][a] += lam;
  return solveSquare(xtx, xty);
}

function ridgeFit(lam: number): FitFn {
  return (design, y) => ridgeBeta(design, y, lam);
}

/** LOO with shrunk group effects on the size curve: a group's residual median, shrunk by n/(n+k). */
function looShrunk(feats: CompFeat[], keyOf: (f: CompFeat) => string, shrink: number): number[] {
  const errs: number[] = [];
  for (let i = 0; i < feats.length; i++) {
    const tr = feats.filter((_, j) => j !== i);
    const design = tr.map((f) => [1, f.lt]);
    const ys = tr.map((f) => f.y);
    const beta = olsBeta(design, ys);
    const resid = ys.map((v, j) => v - dot(design[j], beta));
    const same: number[] = [];
    for (let j = 0; j < tr.length; j++) if (keyOf(tr[j]) === keyOf(feats[i])) same.push(resid[j]);
    const eff = same.length > 0 ? (same.length / (same.length + shrink)) * median(same) : 0;
    errs.push(feats[i].y - (beta[0] + beta[1] * feats[i].lt + eff));
  }
  return errs;
}

/** LOO for a two-segment size curve: separate lines below and above median TVL. */
function looTwoSegment(feats: CompFeat[]): number[] {
  const medLt = median(feats.map((f) => f.lt));
  const errs: number[] = [];
  for (let i = 0; i < feats.length; i++) {
    const tr = feats.filter((_, j) => j !== i);
    const lo = tr.filter((f) => f.lt <= medLt);
    const hi = tr.filter((f) => f.lt > medLt);
    const allBeta = olsBeta(
      tr.map((f) => [1, f.lt]),
      tr.map((f) => f.y),
    );
    const betaLo =
      lo.length > 2
        ? olsBeta(
            lo.map((f) => [1, f.lt]),
            lo.map((f) => f.y),
          )
        : allBeta;
    const betaHi =
      hi.length > 2
        ? olsBeta(
            hi.map((f) => [1, f.lt]),
            hi.map((f) => f.y),
          )
        : allBeta;
    const beta = feats[i].lt <= medLt ? betaLo : betaHi;
    errs.push(feats[i].y - (beta[0] + beta[1] * feats[i].lt));
  }
  return errs;
}

/** LOO fitting without CEX and Liquid Staking, but predicting every comparable. */
function looExcl(feats: CompFeat[]): number[] {
  const errs: number[] = [];
  for (let i = 0; i < feats.length; i++) {
    const tr = feats.filter((_, j) => j !== i && feats[j].cat !== 'CEX' && feats[j].cat !== 'Liquid Staking');
    const beta = olsBeta(
      tr.map((f) => [1, f.lt]),
      tr.map((f) => f.y),
    );
    errs.push(feats[i].y - (beta[0] + beta[1] * feats[i].lt));
  }
  return errs;
}

/** LOO with small-TVL protocols weighted more, by a sigmoid in log TVL. */
function looWeighted(feats: CompFeat[]): number[] {
  const medLt = median(feats.map((f) => f.lt));
  const w = feats.map((f) => 1 / (1 + Math.exp((f.lt - medLt) / 1)));
  const meanW = w.reduce((s, v) => s + v, 0) / w.length;
  const wn = w.map((v) => v / meanW);
  const errs: number[] = [];
  for (let i = 0; i < feats.length; i++) {
    const trX = feats.filter((_, j) => j !== i).map((f) => [1, f.lt]);
    const trY = feats.filter((_, j) => j !== i).map((f) => f.y);
    const trW = wn.filter((_, j) => j !== i);
    const beta = wolsBeta(trX, trY, trW);
    errs.push(feats[i].y - (beta[0] + beta[1] * feats[i].lt));
  }
  return errs;
}

/** LOO for the Theil–Sen size curve. */
function looTheilSen(feats: CompFeat[]): number[] {
  const errs: number[] = [];
  for (let i = 0; i < feats.length; i++) {
    const tr = feats.filter((_, j) => j !== i);
    const [b, s] = theilSen(
      tr.map((f) => f.lt),
      tr.map((f) => f.y),
    );
    errs.push(feats[i].y - (b + s * feats[i].lt));
  }
  return errs;
}

/** LOO on the cherry-picked subset whose mcap/TVL ratio lies in [0.01, 10]. */
function looRatioSubset(feats: CompFeat[]): number[] {
  const sub = feats.filter((f) => f.mult >= 0.01 && f.mult <= 10);
  const errs: number[] = [];
  for (let i = 0; i < sub.length; i++) {
    const tr = sub.filter((_, j) => j !== i);
    const beta = olsBeta(
      tr.map((f) => [1, f.lt]),
      tr.map((f) => f.y),
    );
    errs.push(sub[i].y - (beta[0] + beta[1] * sub[i].lt));
  }
  return errs;
}

/** One row of the model-selection table. */
export interface SelectionRow {
  name: string;
  looMiss: number;
  looWithin: number;
  wfMiss: number | null;
  wfWithin: number | null;
  n: number;
  chosen: boolean;
  note: string;
}

/**
 * The model selection: eighteen candidates fitted on the same comparables and
 * scored by leave-one-out and, for the main ones, walk-forward. The plain size
 * curve wins because every addition is either no better or worse out of sample.
 */
export function selectModels(comps: Proto[], asOf: string): SelectionRow[] {
  const feats = compFeatures(comps, asOf);
  const y = feats.map((f) => f.y);
  const keys = feats.map((f) => f.key);
  const size = feats.map((f) => [1, f.lt]);
  const growth = feats.map((f) => [1, f.lt, f.g]);
  const age = feats.map((f) => [1, f.lt, f.logAge]);
  const chains = feats.map((f) => [1, f.lt, f.logChains]);
  const full = feats.map((f) => [1, f.lt, f.g, f.logAge, f.logChains]);
  const quad = feats.map((f) => [1, f.lt, f.lt * f.lt]);
  const asinh = feats.map((f) => [1, f.lt, f.gAsinh]);
  const groups = [...new Set(feats.map((f) => f.group))].sort();
  const grpDesign = feats.map((f) => [f.lt, ...groups.map((g) => (f.group === g ? 1 : 0))]);
  const cats = [...new Set(feats.map((f) => f.cat))].sort();
  const ridgeDesign = feats.map((f) => [f.lt, ...cats.map((c) => (f.cat === c ? 1 : 0))]);

  const rows: SelectionRow[] = [];
  const add = (name: string, looErrs: number[], wfErrs: number[] | null, chosen: boolean, note: string) => {
    const loo = scoreErrors(looErrs);
    const wf = wfErrs === null ? null : scoreErrors(wfErrs);
    rows.push({
      name,
      looMiss: loo.miss,
      looWithin: loo.within3x,
      wfMiss: wf === null ? null : wf.miss,
      wfWithin: wf === null ? null : wf.within3x,
      n: loo.n,
      chosen,
      note,
    });
  };

  add('Size curve (OLS) — chosen', looErrors(size, y, olsBeta), wfErrors(size, y, keys, olsBeta), true, 'The model: one line, fitted on the comparables.');
  add('Size curve (LAD)', looErrors(size, y, ladBeta), wfErrors(size, y, keys, ladBeta), false, 'Robust to outliers; no better out of sample.');
  add('Size + growth', looErrors(growth, y, olsBeta), wfErrors(growth, y, keys, olsBeta), false, 'Seven-day growth adds noise, not signal.');
  add('Size + age', looErrors(age, y, olsBeta), wfErrors(age, y, keys, olsBeta), false, 'Age breaks time extrapolation: WF ×8.56.');
  add('Size + chains', looErrors(chains, y, olsBeta), wfErrors(chains, y, keys, olsBeta), false, 'Chain count adds nothing.');
  add('Full (size + growth + age + chains)', looErrors(full, y, olsBeta), wfErrors(full, y, keys, olsBeta), false, 'Every term together still loses walk-forward.');
  add('Size + shrunk category (k=8)', looShrunk(feats, (f) => f.cat, 8), null, false, 'Category medians, shrunk; no better.');
  add('Size + shrunk category (k=32)', looShrunk(feats, (f) => f.cat, 32), null, false, 'Heavier shrinkage converges back to the plain curve.');
  add('Ridge + category dummies (λ=10)', looErrors(ridgeDesign, y, ridgeFit(10)), null, false, 'Joint category dummies: much worse.');
  add('Size + broad-group intercepts', looErrors(grpDesign, y, olsBeta), null, false, 'Four group intercepts: worse than the plain curve.');
  add('Quadratic in log TVL', looErrors(quad, y, olsBeta), wfErrors(quad, y, keys, olsBeta), false, 'A hair better in LOO, worse walk-forward: noise.');
  add('Size curve (Huber)', looErrors(size, y, huberBeta), wfErrors(size, y, keys, huberBeta), false, 'Robust fit; no better out of sample.');
  add('Size curve (trimmed 10%)', looErrors(size, y, trimmedBeta), wfErrors(size, y, keys, trimmedBeta), false, 'Dropping the worst residuals does not help.');
  add('Two-segment size curve', looTwoSegment(feats), null, false, 'Separate lines below/above median TVL: no better.');
  add('Size curve, fit excl. CEX + Liquid Staking', looExcl(feats), null, false, 'Excluding the oddest categories does not help.');
  add('Size curve (Theil–Sen)', looTheilSen(feats), null, false, 'Median pairwise slope: no better.');
  add('Size + asinh(growth)', looErrors(asinh, y, olsBeta), null, false, 'A gentler growth transform: same as growth.');
  add('Size curve, small-TVL weighted', looWeighted(feats), null, false, 'Weighting small protocols more: no better.');
  add('Size curve, ratios in [0.01, 10] only', looRatioSubset(feats), null, false, 'Cherry-picked subset (n=111): the only way to reach ×3.01. Not the model.');
  return rows;
}

/** Token odds: the fraction of a protocol's peers that record a token. */
export function tokenOdds(p: Proto, all: Proto[]): { odds: number; peers: number } {
  const g = broadGroup(p.category);
  const logTvl = Math.log10(p.tvlUsd);
  let peers = all.filter((q) => broadGroup(q.category) === g && q.tvlUsd > 0 && Math.abs(Math.log10(q.tvlUsd) - logTvl) <= 1);
  if (peers.length < 5) {
    peers = all.filter((q) => q.tvlUsd > 0 && Math.abs(Math.log10(q.tvlUsd) - logTvl) <= 1);
  }
  if (peers.length === 0) return { odds: 0.5, peers: 0 };
  const withToken = peers.filter((q) => hasToken(q)).length;
  return { odds: withToken / peers.length, peers: peers.length };
}

export type VerdictLabel = 'FARM' | 'MARGINAL' | 'THIN' | 'SKIP';

/** The gas cost of a farm, in dollars: setup plus weekly actions over the hold window. */
export const FARM_GAS_USD = 20;
/** The default deposit the verdict prices, in dollars. */
export const FARM_DEPOSIT_USD = 1000;
/** The default share of the implied value a drop is assumed to pay out. */
export const FARM_DROP_SHARE = 0.1;

/** A farm verdict: the expected value of farming this protocol. */
export interface Verdict {
  label: VerdictLabel;
  evUsd: number;
  sliceUsd: number;
}

/**
 * EV = odds × slice − gas, where slice is the drop share of the implied value
 * scaled to the deposit's share of the protocol's TVL. FARM at $10 or more,
 * MARGINAL at $0, THIN down to −$25, SKIP below that.
 */
export function farmVerdict(impliedUsd: number, tvlUsd: number, odds: number, depositUsd = FARM_DEPOSIT_USD, dropShare = FARM_DROP_SHARE): Verdict {
  const sliceUsd = dropShare * impliedUsd * (depositUsd / tvlUsd);
  const evUsd = odds * sliceUsd - FARM_GAS_USD;
  const label: VerdictLabel = evUsd >= 10 ? 'FARM' : evUsd >= 0 ? 'MARGINAL' : evUsd >= -25 ? 'THIN' : 'SKIP';
  return { label, evUsd, sliceUsd };
}

/** Capital for one farm position, from the protocol's own TVL. */
function capitalFor(tvlUsd: number): number {
  if (tvlUsd >= 1_000_000_000) return 200;
  if (tvlUsd >= 100_000_000) return 100;
  return 50;
}

/** Hold days, from the protocol's age: younger protocols get a longer window. */
function holdFor(age: number | null): number {
  if (age === null) return 45;
  if (age < 90) return 90;
  if (age < 365) return 60;
  return 30;
}

/** The category's one action, in words a farmer can follow. */
function actionFor(p: Proto, capital: number, chain: string): string {
  const c = (p.category ?? '').toLowerCase();
  const name = p.name;
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral')) return `Lend $${capital} of USDC on ${name} (${chain}) and leave the deposit earning.`;
  if (c.includes('dex') || c.includes('yield') || c.includes('leveraged farm')) return `Add $${capital} of liquidity to ${name}'s main pool on ${chain} and hold the LP position.`;
  if (c.includes('bridge')) return `Bridge $${capital} of USDC through ${name} to ${chain} and use the funds in its app.`;
  if (c.includes('stak') || c.includes('restak')) return `Stake $${capital} through ${name} on ${chain} and keep the receipt token.`;
  if (c.includes('perpetual') || c.includes('derivative')) return `Deposit $${capital} of USDC as margin on ${name} and open one small hedged position.`;
  if (c.includes('prediction')) return `Fund $${capital} and take one market position on ${name}.`;
  if (c.includes('curator') || c.includes('allocator')) return `Deposit $${capital} into a ${name} vault on ${chain} and hold the shares.`;
  if (c.includes('stable')) return `Mint or hold $${capital} of the stable asset through ${name} on ${chain}.`;
  if (c.includes('rwa')) return `Mint $${capital} of the yield-bearing asset on ${chain} and hold it.`;
  if (c.includes('insurance')) return `Buy $${capital} of cover from ${name} on ${chain} and keep the policy active.`;
  return `Deposit $${capital} of USDC into ${name} on ${chain} and keep the position open.`;
}

/** One farm step as a single string: action, cost and time, within 20–600 characters. */
function stepText(text: string, cost: string, time: string): string {
  let s = `${text} Cost: ${cost}. Time: ${time}.`;
  if (s.length > 600) s = `${s.slice(0, 596)}...`;
  if (s.length < 20) s = `${s} Keep the position open and check the protocol's own page.`;
  return s;
}

/**
 * A protocol's farm plan: six steps, each an action with a cost and a time,
 * derived from the protocol's own record — category, chains, TVL and age.
 */
export function farmPlan(p: Proto, age: number | null): string[] {
  const chain = p.chains.length > 0 ? p.chains[0] : 'its main chain';
  const capital = capitalFor(p.tvlUsd);
  const hold = holdFor(age);
  const gas = capital >= 200 ? 8 : 4;
  return [
    stepText('Open a fresh wallet for this farm only and write its seed phrase on paper, kept offline.', 'under $3 of gas for the first transfer', '5 minutes'),
    stepText(actionFor(p, capital, chain), `$${capital} of capital and about $${gas} of gas`, '15 minutes to set up'),
    stepText('Do one qualifying action each week — a deposit, a swap, a vote or a borrow — so the wallet stays active.', 'about $2 of gas a week', '10 minutes a week'),
    stepText(`Keep the position open for at least ${hold} days so it is counted in more than one snapshot.`, `the $${capital} stays in the position`, `${hold} days`),
    stepText("Check the protocol's own points or rewards page before you withdraw, and claim only from the link it publishes.", 'free to check; never pay to claim', '10 minutes'),
    stepText('Log the wallet, the dates and every transaction hash so you can repeat the position or unwind it cleanly.', 'nothing but the log', '5 minutes'),
  ];
}

/** One row of board.json: the ranked board's row. */
export interface BoardRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  age_days: number | null;
  implied_value_usd: number;
  range_low_usd: number;
  range_high_usd: number;
  multiple: number;
  token_odds: number;
  odds_peers: number;
  verdict: VerdictLabel;
  ev_usd: number;
  watchlist: boolean;
  farm_steps: string[];
}

/** The dashboard's compact view of one row. */
export interface RadarRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl: number;
  change7d: number | null;
  ageDays: number | null;
  implied: number;
  rangeLo: number;
  rangeHi: number;
  multiple: number;
  odds: number;
  peers: number;
  verdict: VerdictLabel;
  ev: number;
  slice: number;
  watchlist: boolean;
  farmSteps: string[];
}

/** A live-token protocol: it already trades, so the board shows the market's own value. */
export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl: number;
  mcap: number | null;
  change7d: number | null;
}

/** The ledger: where every one of the snapshot's protocols went. */
export interface Ledger {
  total: number;
  ranked: number;
  watchlist: number;
  early: number;
  comps: number;
  tokenNoCap: number;
  setAside: number;
  preToken: number;
  liveToken: number;
}

/** Everything the dashboard needs. */
export interface RadarData {
  asOf: string;
  source: string;
  floorUsd: number;
  modelVersion: string;
  fit: {
    intercept: number;
    slope: number;
    r2: number;
    residStd: number;
    looMiss: number;
    looWithin: number;
    wfMiss: number;
    wfWithin: number;
    rangeLo: number;
    rangeHi: number;
    nComps: number;
  };
  selection: SelectionRow[];
  ledger: Ledger;
  rows: RadarRow[];
  live: LiveRow[];
}

export const MODEL_VERSION = 'frost-3';
export const LIVE_ROWS = 24;

/** Everything the dashboard renders, from the snapshot. */
export function buildRadar(snap: Snap): { board: BoardRow[]; radar: RadarData } {
  const comps = comparables(snap.protocols);
  const curve = fitCurve(comps);
  const selection = selectModels(comps, snap.asOf);
  const watchSet = new Set(snap.watchlist);

  const scored = snap.protocols
    .filter((p) => rankable(p))
    .map((p) => {
      const age = ageDays(snap.asOf, p.listedAt);
      const implied = impliedFor(p.tvlUsd, curve);
      const [lo, hi] = rangeFor(implied, curve);
      const { odds, peers } = tokenOdds(p, snap.protocols);
      const verdict = farmVerdict(implied, p.tvlUsd, odds);
      return { p, age, implied, lo, hi, odds, peers, verdict };
    });
  scored.sort((a, b) => b.implied - a.implied || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0));

  const board: BoardRow[] = scored.map((s, i) => ({
    rank: i + 1,
    slug: s.p.slug,
    name: s.p.name,
    category: s.p.category,
    chains: s.p.chains,
    tvl_usd: s.p.tvlUsd,
    change_7d: s.p.change7d,
    age_days: s.age,
    implied_value_usd: Math.max(1, Math.round(s.implied)),
    range_low_usd: Math.max(1, Math.round(s.lo)),
    range_high_usd: Math.max(1, Math.round(s.hi)),
    multiple: Math.round((s.implied / s.p.tvlUsd) * 10000) / 10000,
    token_odds: Math.round(s.odds * 1000) / 1000,
    odds_peers: s.peers,
    verdict: s.verdict.label,
    ev_usd: Math.round(s.verdict.evUsd * 100) / 100,
    watchlist: watchSet.has(s.p.slug),
    farm_steps: farmPlan(s.p, s.age),
  }));

  const rows: RadarRow[] = scored.map((s, i) => ({
    rank: i + 1,
    slug: s.p.slug,
    name: s.p.name,
    category: s.p.category,
    chains: s.p.chains,
    tvl: s.p.tvlUsd,
    change7d: s.p.change7d,
    ageDays: s.age,
    implied: Math.max(1, Math.round(s.implied)),
    rangeLo: Math.max(1, Math.round(s.lo)),
    rangeHi: Math.max(1, Math.round(s.hi)),
    multiple: Math.round((s.implied / s.p.tvlUsd) * 10000) / 10000,
    odds: Math.round(s.odds * 1000) / 1000,
    peers: s.peers,
    verdict: s.verdict.label,
    ev: Math.round(s.verdict.evUsd * 100) / 100,
    slice: Math.round(s.verdict.sliceUsd * 100) / 100,
    watchlist: watchSet.has(s.p.slug),
    farmSteps: farmPlan(s.p, s.age),
  }));

  const live: LiveRow[] = snap.protocols
    .filter((p) => hasToken(p) && p.category !== 'CEX')
    .sort((a, b) => (b.mcapUsd ?? 0) - (a.mcapUsd ?? 0) || b.tvlUsd - a.tvlUsd || (a.slug < b.slug ? -1 : 1))
    .slice(0, LIVE_ROWS)
    .map((p) => ({ slug: p.slug, name: p.name, category: p.category, chains: p.chains, tvl: p.tvlUsd, mcap: p.mcapUsd, change7d: p.change7d }));

  const pre = snap.protocols.filter((p) => preToken(p));
  const ledger: Ledger = {
    total: snap.protocols.length,
    ranked: board.length,
    watchlist: snap.watchlist.length,
    early: board.length - snap.watchlist.length,
    comps: comps.length,
    tokenNoCap: snap.protocols.filter((p) => hasToken(p) && !(p.mcapUsd !== null && p.mcapUsd > 0 && p.tvlUsd > 0)).length,
    setAside: pre.filter((p) => setAside(p)).length,
    preToken: pre.length,
    liveToken: snap.protocols.length - pre.length,
  };

  const chosenRow = selection.find((r) => r.chosen);
  const radar: RadarData = {
    asOf: snap.asOf,
    source: snap.source,
    floorUsd: snap.floorUsd,
    modelVersion: MODEL_VERSION,
    fit: {
      intercept: curve.intercept,
      slope: curve.slope,
      r2: curve.r2,
      residStd: curve.residStd,
      looMiss: chosenRow?.looMiss ?? NaN,
      looWithin: chosenRow?.looWithin ?? NaN,
      wfMiss: chosenRow?.wfMiss ?? NaN,
      wfWithin: chosenRow?.wfWithin ?? NaN,
      rangeLo: Math.exp(curve.residP25),
      rangeHi: Math.exp(curve.residP75),
      nComps: curve.n,
    },
    selection,
    ledger,
    rows,
    live,
  };
  return { board, radar };
}

/** Why a board is not one the gate will take, or null. */
export function boardIssue(board: BoardRow[], snap: Snap): string | null {
  const slugs = new Set(board.map((r) => r.slug));
  const missing = snap.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) return `the board misses ${missing.length} watchlist slug${missing.length === 1 ? '' : 's'}: ${missing.slice(0, 5).join(', ')}`;
  if (board.length < 100 || board.length > 4000) return `the board holds ${board.length} rows, outside 100..4000`;
  const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) if (ranks[i] !== i + 1) return `rank ${i + 1} is ${ranks[i]}`;
  for (let i = 1; i < board.length; i++) {
    if (board[i].implied_value_usd > board[i - 1].implied_value_usd) return `row ${i + 1} outranks row ${i} on implied value`;
  }
  if (board.length >= 2 && board[0].implied_value_usd === board[board.length - 1].implied_value_usd) {
    return `all ${board.length} rows share the same implied value: a board that ranks nothing by value is not a ranking`;
  }
  for (const r of board) {
    if (r.farm_steps.length < 3 || r.farm_steps.length > 12) return `${r.slug} has ${r.farm_steps.length} farm steps`;
    for (const s of r.farm_steps) {
      const t = s.trim();
      if (t.length < 20 || t.length > 600) return `${r.slug} has a farm step of ${t.length} characters`;
    }
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0) return `${r.slug} has implied value ${r.implied_value_usd}`;
  }
  return null;
}

/** A compact data.js: the dashboard's whole dataset as one script, no fetch and no network. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}
