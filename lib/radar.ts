// Frost Radar v2 — the token-radar-01 value model and farm plans for this entry.
//
// The board ranks pre-token protocols by an implied launch value derived only
// from the snapshot's own figures. The headline change from v1 is that the
// base multiple is no longer a magic number: it is the market's own, measured
// from the protocols in this very snapshot whose token already trades.
//
//   comparables  = every snapshot protocol with a market cap and a TVL above 0
//   multiple     = median mcap/TVL of the protocol's category when that
//                  category holds at least 3 comparables, else the median
//                  over all comparables (128 of them in this snapshot)
//   base         = tvl_usd x multiple
//   growthMult   = 1 + clamp(change_7d, -75, 200) / 100 x 0.6
//   breadth      = 1 + 0.05 x ln(chain count)
//   seasoning    = 0.70 + 0.30 x (1 - exp(-ageYears / 1.5))
//   implied      = max(1, round(base x growthMult x breadth x seasoning))
//
// Why a median, not a mean: mcap/TVL across live tokens runs from near zero
// to over 400x, so a mean is one outlier's opinion. The median is the middle
// protocol's, and it moves only when the middle of the market moves. A
// category median needs at least 3 comparables; thinner categories fall back
// to the global median, and the row says which one it used.
//
// Breadth is logarithmic on purpose: the second chain doubles a protocol's
// reach, the eleventh adds far less, and the hundredth adds almost nothing.
// Each doubling of chain count adds the same 3.5 points, so a protocol on
// 176 chains scores 1.26, not an absurd multiple.
//
// Seasoning is a saturating curve, not a straight line: a protocol that has
// run a year without a token is most of the way seasoned, and the extra years
// add less and less. Age unknown (no listed_at) is read as 180 days, a
// deliberately young guess, and the row flags it. A missing seven-day change
// is read as 0% growth, and the row flags that too.
//
// Coverage: every watchlist slug, plus every other pre-token protocol the
// snapshot's own watchlist rule would admit (no token recorded, not a CEX,
// not a versioned pool, not a wrapped / staked / bridged product, not an
// exchange's own product). Protocols whose token already trades are kept
// apart in the live set and never mixed into the ranked board. No protocol
// name is ever special-cased: the same functions score every row.

/** The snapshot's protocol entry: exactly the ten fields the sealed input carries. */
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

/** The whole snapshot document. */
export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

/** The model's constants, as the dashboard states them. */
export interface RadarModel {
  growth_weight: number;
  growth_floor: number;
  growth_cap: number;
  seasoning_floor: number;
  seasoning_years: number;
  unknown_age_days: number;
  min_category_sample: number;
  breadth_weight: number;
}

export const MODEL: RadarModel = {
  growth_weight: 0.6,
  growth_floor: -75,
  growth_cap: 200,
  seasoning_floor: 0.7,
  seasoning_years: 1.5,
  unknown_age_days: 180,
  min_category_sample: 3,
  breadth_weight: 0.05,
};

/** The model's version label: the dashboard names it. */
export const MODEL_VERSION = 'frost-radar-2';

/** How many live-token protocols the Already-trading view carries, by market cap. */
export const LIVE_ROWS = 30;

/** One category's comparables: how many live tokens it holds and their median mcap/TVL. */
export interface CategoryComparable {
  category: string;
  count: number;
  median: number;
}

/** The comparables the multiples are measured from: the live market inside the snapshot. */
export interface Comparables {
  count: number;
  global_median: number;
  categories: CategoryComparable[];
}

/** A farm step: the action, what it costs, and how long it takes. */
export interface FarmStep {
  text: string;
  cost: string;
  time: string;
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
  mcap_usd: number | null;
  listed_at: string | null;
  age_days: number | null;
  implied_value_usd: number;
  token_status: 'pre-token';
  model: {
    base_usd: number;
    multiple: number;
    multiple_source: 'category' | 'global';
    comparables_n: number;
    growth_pct: number;
    growth_multiplier: number;
    growth_known: boolean;
    breadth: number;
    chains_count: number;
    seasoning: number;
    age_days: number | null;
    age_known: boolean;
  };
  farm_steps: string[];
}

/** A board row's compact form for data.js. */
export interface RadarRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  age_days: number | null;
  implied_value_usd: number;
  multiple: number;
  multiple_source: 'category' | 'global';
  comparables_n: number;
  growth_multiplier: number;
  growth_known: boolean;
  breadth: number;
  seasoning: number;
  age_known: boolean;
  farm_steps: string[];
}

/** A live-token protocol: it already trades, so the board shows the market's own value, not a model's. */
export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number | null;
  change_7d: number | null;
}

/** Everything the dashboard needs: the board, the live set, the comparables, and the model it runs. */
export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model: RadarModel;
  model_version: string;
  comparables: Comparables;
  watchlist: string[];
  watchlist_size: number;
  board_size: number;
  early_size: number;
  live_size: number;
  rows: RadarRow[];
  live: LiveRow[];
}

/** Why the snapshot is not one this model can score. */
export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

const DAY_MS = 86_400_000;

/** A finite number, else `fallback`. */
function finite(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/** The middle of a sorted list of numbers; the mean of the middle two when the count is even. */
export function medianOf(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length === 0) return 0;
  if (sorted.length % 2 === 1) return sorted[mid]!;
  return (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/**
 * The comparables: every protocol in the snapshot whose token already trades
 * and carries both a market cap and a TVL above zero. A zero or negative
 * market cap is a dead record, not a comparable, so it is left out. The
 * global median is the fallback multiple; each category with at least
 * `min_category_sample` comparables gets its own median. Categories are
 * listed most-sampled first, ties broken by name, so the order is the same
 * on every run.
 */
export function deriveComparables(snapshot: Snapshot, model: RadarModel = MODEL): Comparables {
  const live = snapshot.protocols.filter(
    (p) => p.mcap_usd !== null && Number.isFinite(p.mcap_usd) && p.mcap_usd > 0 && p.tvl_usd > 0,
  );
  const globalMedian = medianOf(live.map((p) => p.mcap_usd! / p.tvl_usd));
  const byCategory = new Map<string, number[]>();
  for (const p of live) {
    if (p.category === null) continue;
    const list = byCategory.get(p.category) ?? [];
    list.push(p.mcap_usd! / p.tvl_usd);
    byCategory.set(p.category, list);
  }
  const categories: CategoryComparable[] = [];
  for (const [category, ratios] of byCategory) {
    if (ratios.length < model.min_category_sample) continue;
    categories.push({ category, count: ratios.length, median: medianOf(ratios) });
  }
  categories.sort((a, b) => b.count - a.count || (a.category < b.category ? -1 : 1));
  return { count: live.length, global_median: globalMedian, categories };
}

/** The multiple one protocol's base value uses, and where it came from. */
export function multipleFor(
  protocol: SnapshotProtocol,
  comparables: Comparables,
): { multiple: number; source: 'category' | 'global'; n: number } {
  if (protocol.category !== null) {
    const found = comparables.categories.find((c) => c.category === protocol.category);
    if (found !== undefined) return { multiple: found.median, source: 'category', n: found.count };
  }
  return { multiple: comparables.global_median, source: 'global', n: comparables.count };
}

/** A whole day count from `from` to `to`, clamped at zero; null when either date is absent or bad. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;

/** The implied value one protocol gets under `model`, with every factor broken out. */
export function impliedValue(
  protocol: SnapshotProtocol,
  asOf: string,
  comparables: Comparables,
  model: RadarModel = MODEL,
): {
  implied: number;
  base: number;
  multiple: number;
  multipleSource: 'category' | 'global';
  comparablesN: number;
  growthPct: number;
  growthMult: number;
  growthKnown: boolean;
  breadth: number;
  seasoning: number;
  age: number | null;
  ageKnown: boolean;
} {
  const age = ageDays(asOf, protocol.listed_at);
  const growthKnown = protocol.change_7d !== null && Number.isFinite(protocol.change_7d);
  const rawGrowth = finite(protocol.change_7d, 0);
  const growthPct = Math.min(model.growth_cap, Math.max(model.growth_floor, rawGrowth));
  const growthMult = 1 + (growthPct / 100) * model.growth_weight;
  const ageForModel = age ?? model.unknown_age_days;
  const ageYears = Math.max(ageForModel, 0) / 365;
  const seasoning =
    model.seasoning_floor + (1 - model.seasoning_floor) * (1 - Math.exp(-ageYears / model.seasoning_years));
  const chains = Math.max(1, protocol.chains.length);
  const breadth = 1 + model.breadth_weight * Math.log(chains);
  const { multiple, source, n } = multipleFor(protocol, comparables);
  const base = protocol.tvl_usd * multiple;
  const implied = Math.max(1, Math.round(base * growthMult * breadth * seasoning));
  return {
    implied,
    base: Math.round(base),
    multiple: round4(multiple),
    multipleSource: source,
    comparablesN: n,
    growthPct,
    growthMult: round4(growthMult),
    growthKnown,
    breadth: round4(breadth),
    seasoning: round4(seasoning),
    age,
    ageKnown: age !== null,
  };
}

/** DefiLlama's version-marker rule: a name ending in a release is a pool of another protocol. */
const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;
/** A whole word wrapped, staked or staking in a name: a product of a token that already trades. */
const WRAPPED_WORD = /\b(wrapped|staked|staking)\b/i;
/** A name that begins with an exchange's name: the exchange's own product, not a launch of its own. */
const EXCHANGE_LEAD = /^(Binance|Coinbase|Bybit|Kraken|Bitget|OKX|Bitfinex|Gemini)\b/;
/** Categories the watchlist rule leaves out: bridges, liquid staking and restaking, exchanges. */
const EXCLUDED_CATEGORIES = new Set(['Bridge', 'Canonical Bridge', 'Liquid Staking', 'Liquid Restaking', 'Restaked BTC', 'CEX']);

/** Whether a protocol records no token at all. */
export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

/** Whether a protocol is one the board may rank: pre-token and admissible by the watchlist's own rule. */
export function isRankable(p: SnapshotProtocol): boolean {
  return (
    isPreToken(p) &&
    !EXCLUDED_CATEGORIES.has(p.category ?? '') &&
    !VERSIONED.test(p.name) &&
    !WRAPPED_WORD.test(p.name) &&
    !EXCHANGE_LEAD.test(p.name)
  );
}

/** The snapshot's protocol by slug. */
function bySlug(protocols: SnapshotProtocol[]): Map<string, SnapshotProtocol> {
  return new Map(protocols.map((p) => [p.slug, p]));
}

/** The protocols the board ranks, strongest first, with ranks 1..n. */
export function buildBoard(snapshot: Snapshot, model: RadarModel = MODEL): BoardRow[] {
  const comparables = deriveComparables(snapshot, model);
  const index = bySlug(snapshot.protocols);
  const chosen = new Map<string, SnapshotProtocol>();
  // The watchlist is the floor: every slug on it, even one the snapshot no longer carries.
  for (const slug of snapshot.watchlist) {
    const p = index.get(slug);
    if (p !== undefined) chosen.set(slug, p);
  }
  // The early radar: every other pre-token protocol the watchlist's own rule admits. No TVL cap,
  // no top-N cut: the floor is never the whole board, and a small early protocol is still a subject.
  for (const p of snapshot.protocols) {
    if (!chosen.has(p.slug) && isRankable(p)) chosen.set(p.slug, p);
  }

  const scored = [...chosen.values()].map((p) => {
    const s = impliedValue(p, snapshot.as_of, comparables, model);
    return { p, ...s };
  });
  // Strongest first; ties break on TVL, then on slug, so the order is the same on every run.
  scored.sort((a, b) => b.implied - a.implied || b.p.tvl_usd - a.p.tvl_usd || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0));
  return scored.map((s, i) => ({
    rank: i + 1,
    slug: s.p.slug,
    name: s.p.name,
    category: s.p.category,
    chains: s.p.chains,
    tvl_usd: s.p.tvl_usd,
    change_7d: s.p.change_7d,
    mcap_usd: s.p.mcap_usd,
    listed_at: s.p.listed_at,
    age_days: s.age,
    implied_value_usd: s.implied,
    token_status: 'pre-token',
    model: {
      base_usd: s.base,
      multiple: s.multiple,
      multiple_source: s.multipleSource,
      comparables_n: s.comparablesN,
      growth_pct: s.growthPct,
      growth_multiplier: s.growthMult,
      growth_known: s.growthKnown,
      breadth: s.breadth,
      chains_count: Math.max(1, s.p.chains.length),
      seasoning: s.seasoning,
      age_days: s.age,
      age_known: s.ageKnown,
    },
    farm_steps: farmSteps(s.p, s.age).map(stepText),
  }));
}

/** A step as one string: its action, then its cost and time, within the gate's 20..600 characters. */
export function stepText(step: FarmStep): string {
  let s = `${step.text} Cost: ${step.cost}. Time: ${step.time}.`;
  if (s.length > 600) s = `${s.slice(0, 596)}...`;
  if (s.length < 20) s = `${s} Keep the position open and check the protocol's own page.`;
  return s;
}

/** The first chain a protocol names, or a neutral phrase. */
function chainOf(p: SnapshotProtocol): string {
  return p.chains.length > 0 ? p.chains[0]! : 'its home chain';
}

/** Layer-2 rollups and app chains: a transaction there costs cents, not dollars. */
const L2_CHAINS = new Set([
  'Arbitrum',
  'Optimism',
  'Base',
  'zkSync Era',
  'Scroll',
  'Linea',
  'Blast',
  'Ink',
  'Unichain',
  'Mode',
  'Manta',
  'Mantle',
  'Polygon zkEVM',
  'Starknet',
  'opBNB',
  'Fraxtal',
  'BOB',
  'Zora',
  'World Chain',
  'Soneium',
  'Abstract',
  'Katana',
  'Corn',
  'Arc',
  'Robinhood Chain',
]);
/** Cheap non-EVM chains: fees are a fraction of a cent. */
const CHEAP_CHAINS = new Set(['Solana', 'Sui', 'Aptos', 'Sei', 'Near', 'TON', 'Stellar']);

/** What one transaction typically costs on `chain`, in words the plan can quote. */
export function gasFor(chain: string): string {
  if (chain === 'Ethereum') return 'about $8 of gas';
  if (L2_CHAINS.has(chain)) return 'about $0.50 of gas';
  if (CHEAP_CHAINS.has(chain)) return 'under $0.10 of gas';
  return 'about $2 of gas';
}

/** How much capital one farm position needs, from the protocol's own TVL. */
function capitalFor(p: SnapshotProtocol): number {
  if (p.tvl_usd >= 1_000_000_000) return 200;
  if (p.tvl_usd >= 100_000_000) return 120;
  if (p.tvl_usd >= 25_000_000) return 80;
  return 50;
}

/** How long to hold, from the protocol's age: younger protocols get a longer qualifying window. */
function holdDaysFor(age: number | null): number {
  if (age === null) return 60;
  if (age < 180) return 90;
  if (age < 365) return 60;
  return 30;
}

/** The category's one action, in words a farmer can follow. */
function actionFor(p: SnapshotProtocol, capital: number, chain: string): string {
  const c = (p.category ?? '').toLowerCase();
  const name = p.name;
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral')) {
    return `Lend $${capital} of USDC into ${name} on ${chain} and leave the deposit untouched so it counts in every snapshot.`;
  }
  if (c.includes('dex') || c.includes('yield') || c.includes('leveraged farm')) {
    return `Add $${capital} of liquidity to ${name}'s deepest pool on ${chain} and hold the LP tokens in the same wallet.`;
  }
  if (c.includes('bridge')) {
    return `Bridge $${capital} of USDC into ${chain} with ${name}, then put the bridged funds to work in the destination app instead of bridging straight back.`;
  }
  if (c.includes('staking') || c.includes('restak')) {
    return `Stake $${capital} of the chain's native asset through ${name} on ${chain} and keep the receipt token in the farming wallet.`;
  }
  if (c.includes('perpetual') || c.includes('derivative') || c.includes('options')) {
    return `Deposit $${capital} of USDC as collateral on ${name} and open one small hedged position, then leave it open.`;
  }
  if (c.includes('prediction')) {
    return `Fund the account with $${capital} and take one small position in a market on ${name} that settles after the next snapshot window.`;
  }
  if (c.includes('rwa')) {
    return `Mint $${capital} of ${name}'s yield-bearing asset on ${chain} and hold it; the balance itself is the farming signal.`;
  }
  if (c.includes('curator') || c.includes('allocator') || c.includes('risk')) {
    return `Deposit $${capital} into a ${name} vault on ${chain} and keep the vault shares; a vault deposit reads as one position, not many.`;
  }
  if (c.includes('stable')) {
    return `Mint or hold $${capital} of the stable asset through ${name} on ${chain} and keep the position in the farming wallet.`;
  }
  if (c.includes('insurance')) {
    return `Buy $${capital} of cover from ${name} on ${chain} and keep the policy active through the snapshot window.`;
  }
  if (c.includes('launchpad')) {
    return `Deposit $${capital} through ${name}'s launchpad on ${chain} and join one sale or allocation round.`;
  }
  if (c.includes('aggregator')) {
    return `Deposit $${capital} into ${name}'s highest-TVL vault on ${chain} and leave the shares untouched.`;
  }
  if (c.includes('index')) {
    return `Buy $${capital} of the ${name} index on ${chain} and hold it in the farming wallet.`;
  }
  if (c.includes('payment') || c.includes('card')) {
    return `Route $${capital} of spending through ${name} on ${chain} over the month and keep the account active.`;
  }
  return `Deposit $${capital} of USDC into ${name} on ${chain} and keep the position open through the next snapshot.`;
}

/** The weekly habit, fitted to the category: the action that keeps the wallet visibly active. */
function weeklyActionFor(p: SnapshotProtocol): string {
  const c = (p.category ?? '').toLowerCase();
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral')) {
    return 'Supply or borrow a small amount once a week so the wallet keeps showing activity.';
  }
  if (c.includes('dex') || c.includes('yield') || c.includes('leveraged farm')) {
    return 'Swap a small amount in the deepest pool once a week so the wallet stays an active trader.';
  }
  if (c.includes('bridge')) {
    return 'Bridge a small amount once a week rather than once and never again.';
  }
  if (c.includes('staking') || c.includes('restak')) {
    return 'Restake or claim rewards once a week so the position is never a dead balance.';
  }
  if (c.includes('perpetual') || c.includes('derivative') || c.includes('options')) {
    return 'Open or close one small position a week so the account reads as a trader, not a deposit.';
  }
  if (c.includes('prediction')) {
    return 'Take one small position a week in a market that is still open.';
  }
  if (c.includes('curator') || c.includes('allocator') || c.includes('risk')) {
    return 'Check the vault allocation once a week and top up or rebalance a small amount.';
  }
  return 'Make one qualifying action each week, such as a deposit, a borrow, a swap or a vote.';
}

/**
 * A protocol's farm plan: six steps, plus one when it runs on more than one
 * chain, one when its TVL is large enough that the exit itself is worth
 * testing, one when its TVL fell hard in the last week, and one when it is
 * under 90 days old. Every step is derived from the protocol's own record
 * (category, chains, TVL, seven-day change, age), never from a hand-written
 * list of names — and gas is priced for the chain the step runs on, not a
 * flat guess: an Ethereum step costs dollars, a rollup step costs cents.
 */
export function farmSteps(p: SnapshotProtocol, age: number | null): FarmStep[] {
  const chain = chainOf(p);
  const gas = gasFor(chain);
  const capital = capitalFor(p);
  const hold = holdDaysFor(age);
  const action = actionFor(p, capital, chain);
  const weekly = weeklyActionFor(p);
  const steps: FarmStep[] = [
    {
      text: `Use a fresh wallet that holds only the funds you plan to farm, and keep its seed phrase offline.`,
      cost: `under $3 of gas for the first transaction on ${chain}`,
      time: '5 minutes',
    },
    {
      text: action,
      cost: `$${capital} of capital and ${gas}`,
      time: '15 minutes to set up',
    },
  ];
  if (p.chains.length >= 2) {
    const second = p.chains[1]!;
    steps.push({
      text: `Repeat the same deposit on ${second} so the wallet shows activity on two chains, not one.`,
      cost: `$${capital} of capital split across the chains and ${gasFor(second)}`,
      time: '10 minutes',
    });
  }
  steps.push(
    {
      text: weekly,
      cost: `${gas} a week`,
      time: '10 minutes a week',
    },
    {
      text: `Hold the position for at least ${hold} days so the activity is counted in more than one snapshot.`,
      cost: `the $${capital} stays in the position`,
      time: `${hold} days`,
    },
  );
  if (p.tvl_usd >= 100_000_000) {
    steps.push({
      text: `Withdraw 10% of the position once, early, to confirm the exit works and what it costs.`,
      cost: `${gas} and the withdrawal fee the protocol shows`,
      time: '10 minutes',
    });
  }
  if (p.change_7d !== null && p.change_7d < -10) {
    steps.push({
      text: `TVL fell ${Math.abs(p.change_7d).toFixed(1)}% in the last seven days, so start with half the capital above and re-check the trend in a week before adding more.`,
      cost: `half the $${capital} at first, the rest only if the trend steadies`,
      time: '10 minutes to re-check in a week',
    });
  }
  if (age !== null && age < 90) {
    steps.push({
      text: `The protocol is under 90 days old: confirm its contracts are verified and its TVL is spread across more than one wallet before committing the full amount.`,
      cost: 'nothing to check, and the check decides the deposit',
      time: '15 minutes',
    });
  }
  steps.push(
    {
      text: `Before you withdraw, open the protocol's own points or rewards page and claim only from the link it publishes.`,
      cost: 'no fee to check, and never pay to claim',
      time: '10 minutes',
    },
    {
      text: `Write the wallet, the dates and every transaction in a farm log so you can repeat the position or unwind it.`,
      cost: 'nothing but the log',
      time: '5 minutes',
    },
  );
  return steps;
}

/** The live-token protocols, by market cap, for the dashboard's Already-trading view. */
export function liveRows(snapshot: Snapshot): LiveRow[] {
  return snapshot.protocols
    .filter((p) => !isPreToken(p) && p.category !== 'CEX')
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || b.tvl_usd - a.tvl_usd)
    .slice(0, LIVE_ROWS)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd,
      change_7d: p.change_7d,
    }));
}

/** A board row's compact form for data.js. */
export function radarRow(row: BoardRow): RadarRow {
  return {
    rank: row.rank,
    slug: row.slug,
    name: row.name,
    category: row.category,
    chains: row.chains,
    tvl_usd: row.tvl_usd,
    change_7d: row.change_7d,
    age_days: row.age_days,
    implied_value_usd: row.implied_value_usd,
    multiple: row.model.multiple,
    multiple_source: row.model.multiple_source,
    comparables_n: row.model.comparables_n,
    growth_multiplier: row.model.growth_multiplier,
    growth_known: row.model.growth_known,
    breadth: row.model.breadth,
    seasoning: row.model.seasoning,
    age_known: row.model.age_known,
    farm_steps: row.farm_steps,
  };
}

/** Everything the dashboard renders, from the snapshot. */
export function buildRadar(snapshot: Snapshot, model: RadarModel = MODEL): { board: BoardRow[]; radar: RadarData } {
  const board = buildBoard(snapshot, model);
  const comparables = deriveComparables(snapshot, model);
  const live = liveRows(snapshot);
  const early = board.filter((r) => !snapshot.watchlist.includes(r.slug)).length;
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model,
    model_version: MODEL_VERSION,
    comparables,
    watchlist: snapshot.watchlist,
    watchlist_size: snapshot.watchlist.length,
    board_size: board.length,
    early_size: early,
    live_size: live.length,
    rows: board.map(radarRow),
    live,
  };
  return { board, radar };
}

/** The snapshot out of a file's text, refused unless it is the shape the model scores. */
export function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SnapshotError('snapshot.json is not JSON');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new SnapshotError('snapshot.json is not a JSON object');
  const o = raw as Record<string, unknown>;
  if (typeof o.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.as_of)) throw new SnapshotError('snapshot.json has no as_of date');
  if (typeof o.source !== 'string') throw new SnapshotError('snapshot.json has no source');
  if (typeof o.floor_usd !== 'number' || !Number.isSafeInteger(o.floor_usd) || o.floor_usd <= 0) throw new SnapshotError('snapshot.json has no floor_usd');
  if (!Array.isArray(o.protocols)) throw new SnapshotError('snapshot.json has no protocols array');
  if (!Array.isArray(o.watchlist) || o.watchlist.some((s) => typeof s !== 'string')) throw new SnapshotError('snapshot.json has no watchlist of slugs');
  const protocols = o.protocols.map((v, i) => {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new SnapshotError(`snapshot.json's protocol ${i} is not an object`);
    const p = v as Record<string, unknown>;
    if (typeof p.slug !== 'string' || typeof p.name !== 'string' || typeof p.tvl_usd !== 'number' || !Number.isFinite(p.tvl_usd)) {
      throw new SnapshotError(`snapshot.json's protocol ${i} lacks a slug, a name or a TVL`);
    }
    return {
      slug: p.slug,
      name: p.name,
      category: typeof p.category === 'string' ? p.category : null,
      chains: Array.isArray(p.chains) ? p.chains.filter((c): c is string => typeof c === 'string') : [],
      tvl_usd: p.tvl_usd,
      change_7d: typeof p.change_7d === 'number' && Number.isFinite(p.change_7d) ? p.change_7d : null,
      mcap_usd: typeof p.mcap_usd === 'number' && Number.isFinite(p.mcap_usd) ? p.mcap_usd : null,
      listed_at: typeof p.listed_at === 'string' ? p.listed_at : null,
      gecko_id: typeof p.gecko_id === 'string' ? p.gecko_id : null,
      symbol: typeof p.symbol === 'string' ? p.symbol : null,
    };
  });
  return {
    as_of: o.as_of,
    source: o.source,
    floor_usd: o.floor_usd,
    protocols,
    watchlist: o.watchlist as string[],
  };
}

/** Why a board is not one the gate will take, or null: coverage, ranks, order, one shared implied value, and farm steps. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  const slugs = new Set(board.map((r) => r.slug));
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) return `the board misses ${missing.length} watchlist slug${missing.length === 1 ? '' : 's'}: ${missing.slice(0, 5).join(', ')}`;
  if (board.length < 100) return `the board holds ${board.length} rows, under the 100 the gate needs`;
  const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) if (ranks[i] !== i + 1) return `rank ${i + 1} is ${ranks[i]}`;
  for (let i = 1; i < board.length; i++) if (board[i]!.implied_value_usd > board[i - 1]!.implied_value_usd) return `row ${i + 1} outranks row ${i} on implied value`;
  if (board.length >= 2 && board[0]!.implied_value_usd === board[board.length - 1]!.implied_value_usd) {
    return `all ${board.length} rows share the same implied value $${board[0]!.implied_value_usd}: a board that ranks nothing by value is not a ranking`;
  }
  for (const r of board) {
    const steps = r.farm_steps;
    if (steps.length < 3 || steps.length > 12) return `${r.slug} has ${steps.length} farm steps`;
    for (const s of steps) if (s.length < 20 || s.length > 600) return `${r.slug} has a farm step of ${s.length} characters`;
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0) return `${r.slug} has implied value ${r.implied_value_usd}`;
  }
  return null;
}

/** A compact data.js: the dashboard's whole dataset as one script, no fetch and no network. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}
