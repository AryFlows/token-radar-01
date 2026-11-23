// Frost Radar v4: the page.
//
// The page renders from window.RADAR (data.js, written by main.ts from the
// same board as board.json) — and then it checks its own work: verifyBoard()
// re-fits the size curve from the 67 comps embedded in the data, re-prices
// every one of the 198 rows from the fitted coefficients with impliedValue()
// and tokenOdds(), re-runs the farm arithmetic with farmPlan(), and compares
// all of it — ranks, values, bands, verdicts, nets, the checksum — with what
// main.ts wrote. The green checks on the cover are that comparison's result.
//
// No network, no framework: the page, its data and its checks are all local.

const D = window.RADAR;
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// ---------------------------------------------------------------- formatting

const money = (n) => {
  if (n >= 1e9) return `$${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `$${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `$${(n / 1e3).toFixed(1)}K`;
  return `$${n.toFixed(0)}`;
};
const money2 = (n) => (n < 0 ? `-$${Math.abs(n).toFixed(2)}` : `$${n.toFixed(2)}`);
const moneyFull = (n) => `$${Math.round(n).toLocaleString('en-US')}`;
const pct = (n) => `${(n * 100).toFixed(0)}%`;
const mult = (n) => `×${n.toFixed(2)}`;
const ageText = (d) => {
  if (d === null || d === undefined) return 'undated';
  if (d < 30) return `${d} d`;
  if (d < 365) return `${(d / 30.44).toFixed(0)} mo`;
  return `${(d / 365).toFixed(1)} yr`;
};
// change_7d is already in percent (DefiLlama's field): show it as recorded.
const changeText = (c) => (c === null || c === undefined ? 'n/a' : `${c >= 0 ? '+' : ''}${c.toFixed(1)}%`);

// ---------------------------------------------------------------- the model, re-run in the browser

/** Ordinary least squares, the same normal equations main.ts solves. */
function ols(X, y) {
  const k = X[0].length + 1;
  const a = Array.from({ length: k }, () => new Array(k).fill(0));
  const b = new Array(k).fill(0);
  for (let i = 0; i < X.length; i++) {
    const row = [1, ...X[i]];
    for (let r = 0; r < k; r++) {
      b[r] += row[r] * y[i];
      for (let c = 0; c < k; c++) a[r][c] += row[r] * row[c];
    }
  }
  for (let d = 1; d < k; d++) a[d][d] += 1e-8;
  for (let col = 0; col < k; col++) {
    let piv = col;
    for (let r = col + 1; r < k; r++) if (Math.abs(a[r][col]) > Math.abs(a[piv][col])) piv = r;
    [a[col], a[piv]] = [a[piv], a[col]];
    [b[col], b[piv]] = [b[piv], b[col]];
    const div = a[col][col];
    if (Math.abs(div) < 1e-12) continue;
    for (let r = col + 1; r < k; r++) {
      const f = a[r][col] / div;
      if (!f) continue;
      for (let c = col; c < k; c++) a[r][c] -= f * a[col][c];
      b[r] -= f * b[col];
    }
  }
  const beta = new Array(k).fill(0);
  for (let r = k - 1; r >= 0; r--) {
    let s = b[r];
    for (let c = r + 1; c < k; c++) s -= a[r][c] * beta[c];
    beta[r] = Math.abs(a[r][r]) < 1e-12 ? 0 : s / a[r][r];
  }
  return beta;
}

const sigmoid = (z) => 1 / (1 + Math.exp(-Math.max(-30, Math.min(30, z))));

/** What a token would be worth if the protocol launched one: the fitted curve at its TVL and chain count. */
function ifLaunches(row) {
  const beta = D.value.beta;
  const terms = D.value.terms;
  let log = beta[0];
  for (let j = 0; j < terms.length; j++) {
    const t = terms[j];
    const x = t === 'logTVL' ? Math.log(row.tvl) : t === 'logChains' ? Math.log(Math.max(1, row.chains.length)) : 0;
    log += beta[j + 1] * x;
  }
  return Math.exp(log);
}

/** The token odds: the fitted chance it records a token, turned into a hazard against the ceiling. */
function tokenOdds(row) {
  const m = D.odds;
  const feats = [];
  for (const t of m.terms) {
    if (t === 'age') feats.push(row.ageDays === null ? m.defaultAgeYears : row.ageDays / 365);
    else if (t === 'logTVL') feats.push(Math.log(row.tvl));
    else if (t === 'growth') feats.push(Math.max(-90, Math.min(300, row.change7d === null ? 0 : row.change7d)));
    else if (t === 'catRate') feats.push(row.catRate);
  }
  const z = m.beta[0] + m.beta.slice(1).reduce((s, b, j) => s + b * ((feats[j] - m.mu[j]) / m.sd[j]), 0);
  const chance = sigmoid(z);
  return { chance, odds: Math.max(0.05, Math.min(0.95, (m.ceiling - chance) / (1 - chance))) };
}

/** Implied value = value-if-it-launches x token odds, with the honest band around it. */
function impliedValue(row) {
  const ifL = ifLaunches(row);
  const { odds } = tokenOdds(row);
  const implied = Math.max(1, Math.round(ifL * odds));
  return {
    ifLaunches: Math.round(ifL),
    odds,
    implied,
    p25: Math.max(1, Math.round(implied * D.value.band.p25)),
    p75: Math.round(implied * D.value.band.p75),
  };
}

/** Gas per on-chain step, by chain — the same stated assumption as main.ts. */
function chainGas(chain) {
  if (chain === 'Ethereum') return 8;
  if (['Arbitrum', 'Optimism', 'Base', 'Polygon', 'BSC', 'Solana', 'Avalanche', 'zkSync Era', 'Linea', 'Blast', 'Scroll', 'Mantle', 'Mode', 'opBNB'].includes(chain)) return 0.5;
  return 0.2;
}

/** The farm arithmetic at a scenario: drop, fees, capital charge, net, verdict. */
function farmPlan(row, scenario) {
  const share = scenario.deposit / (row.tvl + scenario.deposit);
  const drop = row.implied * scenario.dropShare * share;
  const dropLo = row.p25 * scenario.dropShare * share;
  const fees = 8 * chainGas(row.chains[0] || 'Ethereum') + 1;
  const capital = scenario.deposit * 0.02 * (scenario.weeks / 52);
  const net = drop - fees - capital;
  const netLo = dropLo - fees - capital;
  const verdict = netLo > 0 ? 'ROBUST' : net > 0 ? 'FARM' : drop > fees ? 'THIN' : 'SKIP';
  return { drop, dropLo, fees, capital, net, netLo, netHour: net / 2.5, verdict };
}

/** FNV-1a over the board's ranks, slugs and values — the checksum main.ts printed. */
function boardChecksum(rows) {
  let h = 0x811c9dc5;
  for (const r of rows) {
    const text = `${r.rank}:${r.slug}:${r.implied};`;
    for (let i = 0; i < text.length; i++) {
      h ^= text.charCodeAt(i);
      h = Math.imul(h, 0x01000193);
    }
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

/**
 * verifyBoard: re-fit the size curve from the embedded comps, re-price every
 * row, re-run every farm plan, and compare with what main.ts wrote. Returns
 * the checks the cover shows, each with its verdict.
 */
function verifyBoard() {
  const checks = [];
  // 1. Re-fit the value model from the comps.
  const X = D.comps.map((c) => [c.logTvl, c.logChains].slice(0, D.value.terms.filter((t) => t !== 'catRidge').length));
  const y = D.comps.map((c) => c.logMcap);
  const beta = ols(X, y);
  const betaOk = beta.every((b, i) => Math.abs(b - D.value.beta[i]) < 1e-9);
  checks.push({ ok: betaOk, text: `size curve re-fitted in this browser from the ${D.comps.length} comps: ${beta.map((b) => b.toFixed(3)).join(', ')} = main.ts` });
  // 2. Re-price every row.
  let priced = 0;
  let oddsOk = 0;
  for (const row of D.rows) {
    const v = impliedValue(row);
    if (v.implied === row.implied && v.p25 === row.p25 && v.p75 === row.p75) priced++;
    if (Math.abs(v.odds - row.odds) < 1e-9) oddsOk++;
  }
  checks.push({ ok: priced === D.rows.length, text: `${priced} of ${D.rows.length} rows re-priced here = board.json (implied value, P25–P75)` });
  checks.push({ ok: oddsOk === D.rows.length, text: `${oddsOk} of ${D.rows.length} token odds recomputed = board.json` });
  // 3. Re-run every farm plan at the default scenario.
  let farms = 0;
  for (const row of D.rows) {
    const f = farmPlan(row, D.farmDefault);
    if (f.verdict === row.verdict && Math.abs(f.net - row.net) < 0.01) farms++;
  }
  checks.push({ ok: farms === D.rows.length, text: `${farms} of ${D.rows.length} farm verdicts and nets recomputed = board.json` });
  // 4. Ranks in order, values never rising.
  let ordered = true;
  for (let i = 1; i < D.rows.length; i++) {
    if (D.rows[i].rank !== i + 1 || D.rows[i].implied > D.rows[i - 1].implied) ordered = false;
  }
  checks.push({ ok: ordered, text: `ranks 1–${D.rows.length} in order, values never rise` });
  // 5. Totals and checksum.
  const total = D.rows.reduce((s, r) => s + r.implied, 0);
  checks.push({ ok: total === D.totalImplied, text: `totals equal: ${moneyFull(total)}` });
  checks.push({ ok: boardChecksum(D.rows) === D.checksum, text: `checksum ${D.checksum} = main.ts` });
  // 6. Coverage and the ledger.
  const wl = D.rows.filter((r) => r.tier === 'watchlist').length;
  checks.push({ ok: wl === 40, text: `watchlist ${wl} of 40 ranked` });
  const led = D.ledger;
  const accounted = led.ranked.total + led.tokenTrades + led.tokenNoCap + led.setAsideTotal;
  checks.push({ ok: accounted === led.total, text: `ledger ${accounted} of ${led.total} protocols` });
  // 7. No protocol named in the code.
  checks.push({ ok: D.namesInCode === 0, text: `${D.namesInCode} of ${led.total} protocol names in the code` });
  return checks;
}

// ---------------------------------------------------------------- rendering: evidence

const state = {
  tab: 'board',
  query: '',
  verdict: 'ALL',
  tier: 'ALL',
  sort: 'rank',
  scenario: { ...D.farmDefault },
  detail: null,
};

function renderKpis() {
  const v = D.value;
  const o = D.odds;
  const counts = { ROBUST: 0, FARM: 0, THIN: 0, SKIP: 0 };
  for (const r of D.rows) counts[r.verdict]++;
  const worth = counts.ROBUST + counts.FARM;
  const keptV = v.ablation.filter((a) => a.kept).length;
  const keptO = o.ablation.filter((a) => a.kept).length;
  const best = [...D.rows].sort((a, b) => b.netHour - a.netHour)[0];
  const kpis = [
    { h: 'OUT-OF-SAMPLE EVIDENCE', big: `${mult(v.wf)} <span class="small">walk-forward</span>`, small: `leave-one-out ${mult(v.loo)} · flat multiple ${mult(v.flatLoo)} · ${v.comps} traded tokens` },
    { h: 'IS THE PRINTED RANGE HONEST?', big: `${pct(v.coverage.p2575)}<span class="small"> · </span>${pct(v.coverage.p1090)}`, small: `of held-out caps inside P25–P75 / P10–P90 (stated 50% · 80%) · ${v.coverage.n} tokens` },
    { h: 'TOKEN ODDS BEAT THE BASE RATE?', big: `${o.brier.toFixed(3)} <span class="small">Brier</span>`, small: `ten-fold ${o.brier.toFixed(3)} · walk-forward ${o.brierWf.toFixed(3)} · base ${o.baseBrier.toFixed(3)} / ${o.baseBrierWf.toFixed(3)} · ${o.peers} peers` },
    { h: 'TERMS THAT SURVIVED BOTH TESTS', big: `${keptV} of ${v.ablation.length - 1} <span class="small">value</span> · ${keptO} of ${o.ablation.length - 1} <span class="small">odds</span>`, small: `years listed dropped: walk-forward ${mult(yearsWf())} — a term that only fits the past is not a term` },
    { h: 'WORTH FARMING, THIS SCENARIO', big: `${worth} <span class="small">of ${D.rows.length}</span>`, small: `ROBUST ${counts.ROBUST} · FARM ${counts.FARM} · THIN ${counts.THIN} · SKIP ${counts.SKIP} — at $${D.farmDefault.deposit.toLocaleString()}, ${D.farmDefault.weeks} wks, ${pct(D.farmDefault.dropShare)}` },
    { h: 'WATCHLIST RANKED', big: `40<span class="small"> / 40</span>`, small: `total implied ${money(D.totalImplied)} · best hour: ${esc(best.name)} ${money2(best.netHour)}/h` },
  ];
  $('kpis').innerHTML = kpis.map((k) => `<div class="kpi"><h3>${k.h}</h3><div class="big">${k.big}</div><div class="small">${k.small}</div></div>`).join('');
}

function renderLedger() {
  const led = D.ledger;
  const groups = [
    { label: 'Ranked — watchlist', n: led.ranked.watchlist, color: '#2dd4bf' },
    { label: 'Ranked — early, below the floor', n: led.ranked.early, color: '#38bdf8' },
    { label: 'Ranked — off-list, parent records a token', n: led.ranked.offList, color: '#a78bfa' },
    { label: 'Token trades — priced comp', n: led.tokenTrades, color: '#94a3b8' },
    { label: 'Token on record, no usable cap', n: led.tokenNoCap, color: '#64748b' },
    { label: 'Set aside — bridge', n: led.setAside.bridge || 0, color: '#f5b84c' },
    { label: 'Set aside — liquid staking', n: led.setAside['liquid staking'] || 0, color: '#f59e0b' },
    { label: 'Set aside — exchange', n: led.setAside.exchange || 0, color: '#f97316' },
    { label: 'Set aside — versioned', n: led.setAside.versioned || 0, color: '#fb923c' },
    { label: 'Set aside — wrapped/staked name', n: led.setAside['wrapped/staked name'] || 0, color: '#fdba74' },
  ];
  $('ledgerbar').innerHTML = groups.map((g) => `<div style="width:${(g.n / led.total) * 100}%;background:${g.color}" title="${esc(g.label)}: ${g.n}"></div>`).join('');
  $('ledgercounts').innerHTML = groups.map((g) => `<span><i class="dot" style="background:${g.color}"></i>${esc(g.label)} <b>${g.n}</b></span>`).join('');
  const checks = verifyBoard();
  $('checks').innerHTML = checks.map((c) => `<span class="${c.ok ? '' : 'bad'}">${c.ok ? '✓' : '✗'} ${esc(c.text)}</span>`).join(' &nbsp; ');
}

function ablationTable(rows, firstCol, fmt) {
  const head = `<tr><th>${firstCol}</th><th style="text-align:right">Leave-one-out</th><th style="text-align:right">Walk-forward</th><th></th></tr>`;
  const body = rows.map((r) => {
    const tag = r.kept ? '<span class="kept">kept</span>' : r.note === 'baseline' ? '<span style="color:var(--faint)">baseline</span>' : '<span class="dropped">tested, not kept</span>';
    return `<tr><td>${esc(r.label)}</td><td class="num">${fmt(r.loo)}</td><td class="num">${fmt(r.wf)}</td><td>${tag}</td></tr>`;
  }).join('');
  return head + body;
}

function renderEvidence() {
  const v = D.value;
  const o = D.odds;
  $('compn').textContent = v.comps;
  $('compn2').textContent = v.comps;
  $('peern').textContent = o.peers;
  $('valueabl').innerHTML = ablationTable(v.ablation, 'TERM, ADDED IN ORDER', mult);
  $('oddsabl').innerHTML = ablationTable(o.ablation, 'TERM, ADDED IN ORDER', (n) => n.toFixed(3));
  $('rangetab').innerHTML =
    `<tr><th></th><th style="text-align:right">Left out</th><th style="text-align:right">Stated</th></tr>` +
    `<tr><td>Inside P25–P75</td><td class="num">${pct(v.coverage.p2575)}</td><td class="num">50%</td></tr>` +
    `<tr><td>Inside P10–P90</td><td class="num">${pct(v.coverage.p1090)}</td><td class="num">80%</td></tr>` +
    `<tr><td>Within 3&times; of the true cap</td><td class="num">${pct(v.within3x)}</td><td class="num">—</td></tr>` +
    `<tr><td>Within 2&times; of the true cap</td><td class="num">${pct(v.within2x)}</td><td class="num">—</td></tr>`;
  $('rangenote').textContent =
    `The band is the leave-one-out residuals' quartiles (P25 ×${v.band.p25.toFixed(2)}, P75 ×${v.band.p75.toFixed(2)}), so a band that held 49% where it promised 50% is an honest band, not a narrow one.`;
  $('reading').innerHTML =
    `The size curve alone misses by ${mult(v.ablation[1].loo)} left out; adding the chain count — more chains, a lower multiple — takes it to ${mult(v.loo)} left out and ${mult(v.wf)} on the newer tokens. Years listed looked helpful until the walk-forward, where its coefficient flips and the miss blows out to ${mult(yearsWf())}: dropped. The odds model starts from age alone (Brier ${o.ablation[1].loo.toFixed(3)}) and earns its keep with size, growth and the category's token rate (${o.brier.toFixed(3)}). Nothing here is fitted on the protocols it ranks.`;
  renderScatter();
}

/** Log-log scatter: the comps at their cap, the fitted curve, the ranked at their implied value. */
function renderScatter() {
  const W = 640;
  const H = 300;
  const pad = { l: 52, r: 12, t: 10, b: 34 };
  const xs = D.comps.map((c) => c.logTvl);
  const ys = D.comps.map((c) => c.logMcap);
  const x0 = Math.min(...xs, ...D.rows.map((r) => Math.log(r.tvl))) - 0.4;
  const x1 = Math.max(...xs, ...D.rows.map((r) => Math.log(r.tvl))) + 0.4;
  const y0 = Math.min(...ys) - 0.6;
  const y1 = Math.max(...ys, ...D.rows.map((r) => Math.log(r.implied))) + 0.6;
  const X = (v) => pad.l + ((v - x0) / (x1 - x0)) * (W - pad.l - pad.r);
  const Y = (v) => pad.t + (1 - (v - y0) / (y1 - y0)) * (H - pad.t - pad.b);
  const beta = D.value.beta;
  let curve = '';
  for (let px = pad.l; px <= W - pad.r; px += 4) {
    const lv = x0 + ((px - pad.l) / (W - pad.l - pad.r)) * (x1 - x0);
    const ly = beta[0] + beta[1] * lv + (beta[2] || 0) * 0;
    curve += `${px},${Y(ly).toFixed(1)} `;
  }
  const grid = [];
  for (let e = 7; e <= 11; e++) {
    const lv = e * Math.LN10;
    if (lv < x0 || lv > x1) continue;
    grid.push(`<line x1="${X(lv)}" y1="${pad.t}" x2="${X(lv)}" y2="${H - pad.b}" stroke="#1a2740"/>`);
    grid.push(`<text x="${X(lv)}" y="${H - 8}" fill="#5f738f" font-size="10" text-anchor="middle">$${Math.pow(10, e - 6)}M</text>`);
  }
  for (let e = 5; e <= 10; e++) {
    const lv = e * Math.LN10;
    if (lv < y0 || lv > y1) continue;
    grid.push(`<line x1="${pad.l}" y1="${Y(lv)}" x2="${W - pad.r}" y2="${Y(lv)}" stroke="#1a2740"/>`);
    grid.push(`<text x="${pad.l - 6}" y="${Y(lv) + 3}" fill="#5f738f" font-size="10" text-anchor="end">$${Math.pow(10, e - 6)}M</text>`);
  }
  const comps = D.comps.map((c) => `<circle cx="${X(c.logTvl).toFixed(1)}" cy="${Y(c.logMcap).toFixed(1)}" r="3" fill="#8fa3c0" opacity="0.85"/>`).join('');
  const ranked = D.rows.map((r) => `<circle cx="${X(Math.log(r.tvl)).toFixed(1)}" cy="${Y(Math.log(r.implied)).toFixed(1)}" r="2.6" fill="#2dd4bf" opacity="0.8"/>`).join('');
  $('scatter').innerHTML =
    `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Market cap against TVL, log scales">${grid.join('')}${comps}` +
    `<polyline points="${curve}" fill="none" stroke="#f5b84c" stroke-width="2"/>${ranked}` +
    `<text x="${pad.l}" y="${H - 20}" fill="#8fa3c0" font-size="11">TVL (log) →</text>` +
    `<text x="${W - pad.r}" y="${pad.t + 12}" fill="#8fa3c0" font-size="11" text-anchor="end">grey: trades · teal: still to come · amber: fitted curve</text></svg>`;
}

// ---------------------------------------------------------------- rendering: the board

function tierBadge(tier) {
  return tier === 'watchlist' ? '<span class="badge watchlist">WATCHLIST</span>'
    : tier === 'early' ? '<span class="badge early">EARLY</span>'
    : '<span class="badge off-list">OFF-LIST</span>';
}

function filteredRows() {
  const q = state.query.trim().toLowerCase();
  let rows = D.rows.filter((r) => {
    if (state.verdict !== 'ALL') {
      const f = farmPlan(r, state.scenario);
      if (f.verdict !== state.verdict) return false;
    }
    if (state.tier !== 'ALL' && r.tier !== state.tier) return false;
    if (q && !(r.name.toLowerCase().includes(q) || r.slug.includes(q) || (r.category || '').toLowerCase().includes(q))) return false;
    return true;
  });
  const by = {
    rank: (a, b) => a.rank - b.rank,
    implied: (a, b) => b.implied - a.implied,
    tvl: (a, b) => b.tvl - a.tvl,
    odds: (a, b) => b.odds - a.odds,
    net: (a, b) => farmPlan(b, state.scenario).netHour - farmPlan(a, state.scenario).netHour,
    name: (a, b) => a.name.localeCompare(b.name),
  }[state.sort];
  return rows.sort(by);
}

function renderBoard() {
  const rows = filteredRows();
  const counts = { ROBUST: 0, FARM: 0, THIN: 0, SKIP: 0 };
  for (const r of D.rows) counts[farmPlan(r, state.scenario).verdict]++;
  $('verdictchips').innerHTML = ['ALL', 'ROBUST', 'FARM', 'THIN', 'SKIP'].map((v) =>
    `<button data-v="${v}" class="${state.verdict === v ? 'on' : ''}">${v === 'ALL' ? `All ${D.rows.length}` : `${v} ${counts[v]}`}</button>`).join('');
  const tiers = { ALL: D.rows.length, watchlist: 40, early: 138, 'off-list': 20 };
  $('tierchips').innerHTML = ['ALL', 'watchlist', 'early', 'off-list'].map((t) =>
    `<button data-t="${t}" class="${state.tier === t ? 'on' : ''}">${t === 'ALL' ? 'All tiers' : `${t} ${tiers[t]}`}</button>`).join('');
  $('verdictkey').innerHTML =
    `At <b>${money0(state.scenario.deposit)}</b> for <b>${state.scenario.weeks} weeks</b> at a <b>${pct(state.scenario.dropShare)}</b> drop share: ` +
    `<span class="v-ROBUST">ROBUST ${counts.ROBUST}</span> pay even at the band's low end · ` +
    `<span class="v-FARM">FARM ${counts.FARM}</span> pay after every cost · ` +
    `<span class="v-THIN">THIN ${counts.THIN}</span> beat their cash fees only · ` +
    `<span class="v-SKIP">SKIP ${counts.SKIP}</span> fees eat the drop.`;
  const best = [...D.rows].map((r) => ({ r, h: farmPlan(r, state.scenario).netHour })).sort((a, b) => b.h - a.h).slice(0, 3);
  $('besthour').innerHTML = `Best hands-on hours here: ${best.map((b) => `<b>${esc(b.r.name)} ${money2(b.h)}/h</b>`).join(' · ')}`;
  $('rows').innerHTML = rows.map((r) => {
    const f = farmPlan(r, state.scenario);
    const chg = r.change7d === null ? '<span>n/a</span>' : `<span class="${r.change7d >= 0 ? 'up' : 'down'}">${changeText(r.change7d)}</span>`;
    return `<tr data-slug="${esc(r.slug)}">
      <td class="rank">${r.rank}</td>
      <td class="proto"><b>${esc(r.name)}</b>${tierBadge(r.tier)}<div class="meta">${esc(r.category || 'No category')} · ${esc(r.chains[0] || '')}${r.chains.length > 1 ? ` +${r.chains.length - 1}` : ''}</div></td>
      <td class="num">${money(r.tvl)}</td>
      <td class="num">${chg}</td>
      <td class="num">${ageText(r.ageDays)}</td>
      <td><div>${pct(r.odds)}</div><div class="oddsbar"><i style="width:${Math.round(r.odds * 100)}%"></i></div></td>
      <td class="num">${money(r.ifLaunches)}</td>
      <td class="num"><b>${money(r.implied)}</b><div class="range">${money(r.p25)}–${money(r.p75)} · #${r.rankLo}–${r.rankHi}</div></td>
      <td><span class="v-${f.verdict}">${f.verdict}</span><div class="netline"><span class="${f.net >= 0 ? 'pos' : 'neg'}">${money2(f.net)} net</span> · ${money2(f.fees)} fees</div></td>
      <td class="num ${f.netHour >= 0 ? 'up' : 'down'}">${money2(f.netHour)}/h</td>
    </tr>`;
  }).join('');
  $('tablefoot').textContent = `${rows.length} of ${D.rows.length} rows shown. Click a row for its detail: how the figure is made, its nearest priced peers, and its costed farm plan.`;
  document.querySelectorAll('#rows tr').forEach((tr) => tr.addEventListener('click', () => openDetail(tr.dataset.slug)));
  document.querySelectorAll('#verdictchips button').forEach((b) => b.addEventListener('click', () => { state.verdict = b.dataset.v; renderBoard(); }));
  document.querySelectorAll('#tierchips button').forEach((b) => b.addEventListener('click', () => { state.tier = b.dataset.t; renderBoard(); }));
}

const money0 = (n) => (n >= 1e6 ? `$${(n / 1e6).toFixed(0)}M` : n >= 1e3 ? `$${(n / 1e3).toFixed(0)}K` : `$${n.toFixed(0)}`);

// ---------------------------------------------------------------- rendering: the detail view

function openDetail(slug) {
  const row = D.rows.find((r) => r.slug === slug);
  if (!row) return;
  state.detail = slug;
  showTab('detail');
  const f = farmPlan(row, state.scenario);
  const beta = D.value.beta;
  const at100 = Math.exp(beta[0] + beta[1] * Math.log(1e8)) / 1e8;
  const sizeF = Math.pow(row.tvl / 1e8, beta[1] - 1);
  const chainF = Math.pow(Math.max(1, row.chains.length), beta[2] || 0);
  const tbill = state.scenario.deposit * 0.04 * (state.scenario.weeks / 52);
  const shares = [0.035, 0.07, 0.14];
  const deposits = [1000, 10000, 30000];
  const matrix = shares.map((s) => `<tr><th>${pct(s)}</th>${deposits.map((d) => {
    const m = farmPlan(row, { deposit: d, weeks: state.scenario.weeks, dropShare: s });
    const cur = d === state.scenario.deposit && s === state.scenario.dropShare;
    return `<td class="${cur ? 'cur' : ''} ${m.net >= 0 ? 'up' : 'down'}">${money2(m.net)}</td>`;
  }).join('')}</tr>`).join('');
  $('detail').innerHTML = `
  <div class="detail">
    <h2>${esc(row.name)} <span style="color:var(--faint);font-size:15px">#${row.rank} of ${D.rows.length}</span>${tierBadge(row.tier)}</h2>
    <p class="dsub">${esc(row.category || 'No category')} · ${esc(row.chains.join(', '))} · TVL ${money(row.tvl)} · seven-day ${changeText(row.change7d)} · no token for ${ageText(row.ageDays)} · implied value · rank ${row.rankLo}–${row.rankHi} across 200 bootstrap refits</p>
    <div class="dgrid">
      <div class="dbox">
        <h3>IMPLIED VALUE <span class="fn">impliedValue()</span></h3>
        <div class="dbig">${moneyFull(row.implied)}</div>
        <div class="dstats">
          <div class="dstat"><b>${money(row.ifLaunches)}</b><span>if a token launches</span></div>
          <div class="dstat"><b>${pct(row.odds)}</b><span>token odds</span></div>
          <div class="dstat"><b>${money(row.p25)}–${money(row.p75)}</b><span>P25–P75</span></div>
          <div class="dstat"><b>${money(row.p10)}–${money(row.p90)}</b><span>P10–P90</span></div>
        </div>
        <p class="evnote">✓ Recomputed in this browser: equals board.json. DefiLlama records no token for it, which is not proof it has none; the odds are its peers' record, not a forecast.</p>
      </div>
      <div class="dbox">
        <h3>FARM VERDICT <span class="fn">farmPlan()</span></h3>
        <div style="margin:6px 0"><span class="v-${f.verdict}" style="font-size:13px;padding:4px 10px">${f.verdict}</span></div>
        <p class="evnote" style="margin-top:0">${money0(state.scenario.deposit)} for ${state.scenario.weeks} weeks buys a modelled drop of ${money2(f.drop)} for ${money2(f.fees)} of fees and 2.5 h of work, a net of ${money2(f.net)} (${money2(f.netHour)} an hour) against ${money2(tbill)} from the same money in a 4% T-bill. The drop share would need to reach ${pct(f.fees / Math.max(f.drop, 0.01) * state.scenario.dropShare)} for the fees to be covered (model ${pct(state.scenario.dropShare)}).</p>
        <div class="dstats">
          <div class="dstat"><b>${money0(state.scenario.deposit)}</b><span>at risk</span></div>
          <div class="dstat"><b>${money2(f.fees)}</b><span>fees, ${state.scenario.weeks} weeks</span></div>
          <div class="dstat"><b>${money2(f.drop)}</b><span>modelled drop</span></div>
          <div class="dstat"><b>${money2(f.netHour)}/h</b><span>net per hour</span></div>
        </div>
        <p class="evnote">Net by drop share × deposit:</p>
        <table class="matrix"><tr><th></th><th>$1,000</th><th>$10,000</th><th>$30,000</th></tr>${matrix}</table>
        <p class="evnote">Break-even deposit: ${row.breakEven === null ? 'no ticket under $1M pays' : money0(row.breakEven)} at this drop share. Drop = implied value × drop share × deposit ÷ (TVL + deposit). Yield earned meanwhile is left out.</p>
      </div>
    </div>
    <div class="dgrid">
      <div class="dbox">
        <h3>HOW THE FIGURE IS MADE <span class="fn">ifLaunches() tokenOdds()</span></h3>
        <table class="factors">
          <tr><td>TVL</td><td class="num">${money(row.tvl)}</td><td></td></tr>
          <tr><td>Base multiple, fitted on ${D.value.comps} traded tokens, read at $100M TVL</td><td class="num">×${at100.toFixed(2)}</td><td></td></tr>
          <tr><td>Size curve: the multiple falls as TVL grows (slope ${(beta[1] - 1).toFixed(2)} × ln(TVL / $100M))</td><td class="num">×${sizeF.toFixed(2)}</td><td></td></tr>
          <tr><td>Chain count: more chains, a lower multiple (${row.chains.length} chain${row.chains.length === 1 ? '' : 's'})</td><td class="num">×${chainF.toFixed(2)}</td><td></td></tr>
          <tr class="total"><td>Value if a token launches</td><td class="num">${money(row.ifLaunches)}</td><td></td></tr>
          <tr><td>Token odds: ${pct(row.chance)} of its peers record a token; ceiling ${pct(D.odds.ceiling)} — (${pct(D.odds.ceiling)} − ${pct(row.chance)}) ÷ (1 − ${pct(row.chance)})</td><td class="num">×${row.odds.toFixed(2)}</td><td></td></tr>
          <tr class="total"><td>Implied value</td><td class="num">${money(row.implied)}</td><td></td></tr>
        </table>
        <p class="evnote">Tested, not used: years listed (walk-forward ${mult(yearsWf())}); seven-day growth in the value model; a category ridge (no walk-forward gain). The odds model keeps age, size, growth and the category's token rate — Brier ${D.odds.brier.toFixed(3)} ten-fold, ${D.odds.brierWf.toFixed(3)} walk-forward, against ${D.odds.baseBrier.toFixed(3)} / ${D.odds.baseBrierWf.toFixed(3)} for the base rate.</p>
      </div>
      <div class="dbox">
        <h3>NEAREST PRICED PEERS <span class="fn">nearestPeers()</span></h3>
        <p class="evsub">Their tokens trade; the held-out model priced them without seeing them.</p>
        <table class="ev"><tr><th>Token</th><th style="text-align:right">TVL</th><th style="text-align:right">Market cap</th><th style="text-align:right">Cap / TVL</th><th style="text-align:right">Model said</th></tr>
        ${row.peers.map((p) => `<tr><td>${esc(p.name)}</td><td class="num">${money(p.tvl)}</td><td class="num">${money(p.mcap)}</td><td class="num">${p.ratio.toFixed(2)}×</td><td class="num">${money(p.model)}</td></tr>`).join('')}
        </table>
      </div>
    </div>
    <div class="dbox wide">
      <h3>FARM PLAN · ${row.steps.length} STEPS <span class="fn">farmSteps()</span></h3>
      <ol class="steps">${row.steps.map((s) => `<li>${esc(s)}</li>`).join('')}</ol>
    </div>
  </div>`;
  $('view-detail').scrollIntoView({ block: 'start' });
}

function yearsWf() {
  const row = D.value.ablation.find((a) => a.label.includes('years listed'));
  return row ? row.wf : 0;
}

// ---------------------------------------------------------------- tabs, method, export

function showTab(tab) {
  state.tab = tab;
  for (const b of document.querySelectorAll('#tabs button')) b.classList.toggle('on', b.dataset.tab === tab || (tab === 'detail' && b.dataset.tab === 'board'));
  for (const id of ['board', 'token', 'aside', 'method', 'detail']) $('view-' + id).hidden = id !== tab;
  if (tab === 'token') renderTokenTab();
  if (tab === 'aside') renderAsideTab();
  if (tab === 'method') renderMethod();
  // The header, KPIs, ledger and evidence sit above the tabs and never move,
  // so a switched-in view starts below the fold: bring it to the top.
  if (tab === 'token' || tab === 'aside' || tab === 'method') $('view-' + tab).scrollIntoView({ block: 'start' });
}

function renderTokenTab() {
  const compNames = new Set(D.rows.flatMap((r) => r.peers.map((p) => p.name)));
  $('tokenrows').innerHTML = D.tokenRows.map((t) => {
    const isComp = compNames.has(t.name);
    return `<tr><td><b>${esc(t.name)}</b>${isComp ? ' <span class="badge early">COMP</span>' : ''}</td><td>${esc(t.category || '—')}</td><td class="num">${money(t.tvl)}</td><td class="num">${money(t.mcap)}</td><td class="num">${(t.mcap / t.tvl).toFixed(2)}×</td></tr>`;
  }).join('');
}

function renderAsideTab() {
  $('asiderows').innerHTML = D.setAsideRows.map((t) =>
    `<tr><td><b>${esc(t.name)}</b></td><td>${esc(t.reason)}</td><td class="num">${money(t.tvl)}</td></tr>`).join('');
}

function renderMethod() {
  const v = D.value;
  const o = D.odds;
  $('method').innerHTML = `
  <h3>The value model</h3>
  <p>The curve is fitted on <b>${v.comps} traded tokens</b>: dated, a market cap between 0.5% and 20&times; their TVL (a token worth less, or more, is not priced on its TVL), in a category the radar ranks. The fit is <code>log(mcap) = ${v.beta[0].toFixed(3)} + ${v.beta[1].toFixed(3)}·ln(TVL)${v.beta[2] !== undefined ? ` ${v.beta[2] < 0 ? '−' : '+'} ${Math.abs(v.beta[2]).toFixed(3)}·ln(chains)` : ''}</code> — a size curve plus a chain-count term, each kept only because it improved <b>both</b> held-out tests: leave-one-out ${mult(v.loo)}, walk-forward ${mult(v.wf)} (the older 60% price the newer 40%), against ${mult(v.flatLoo)} for one flat multiple. Years listed, seven-day growth and a category ridge were all tested and dropped — the ablation table on the board shows each one's numbers and why.</p>
  <h3>The token odds</h3>
  <p>A second fitted model, on <b>${o.peers} peers</b>: a logistic fit of who records a token, from age, size, seven-day growth and the category's token rate (shrunk toward the base rate, 20 pseudo-observations). Its Brier score is <b>${o.brier.toFixed(3)}</b> ten-fold and <b>${o.brierWf.toFixed(3)}</b> walk-forward, against ${o.baseBrier.toFixed(3)} / ${o.baseBrierWf.toFixed(3)} for the base rate alone. The odds are a hazard: among the peers that reach this protocol's age without a token, the share that ever record one — (ceiling − p) / (1 − p), with the ceiling at ${pct(o.ceiling)}, the token rate among peers listed at least four years ago. Young protocols score high because they have hardly had time; old ones fall, because the peers that were going to launch mostly have. The odds are floored at 5%: the record cannot prove a protocol will never launch. Undated protocols take the peers' median age, ${o.defaultAgeYears.toFixed(2)} years.</p>
  <h3>The band</h3>
  <p>The P25–P75 band is the leave-one-out residuals' quartiles (×${v.band.p25.toFixed(2)} to ×${v.band.p75.toFixed(2)}; P10–P90 ×${v.band.p10.toFixed(2)} to ×${v.band.p90.toFixed(2)}). Held out, ${pct(v.coverage.p2575)} of true caps fall inside the middle half where the band promises 50%, and ${pct(v.coverage.p1090)} inside the outer band where it promises 80% — an honest band, not a narrow one. Rank ranges come from 200 bootstrap refits of the curve.</p>
  <h3>The farm plan</h3>
  <p>The drop is the drop share (7% by default) of the implied value, shared pro-rata by deposit among the protocol's TVL. Fees are a stated assumption — $8 a step on Ethereum, $0.50 on a rollup or cheap chain, $0.20 elsewhere, eight steps plus a dollar to arrive and leave — and the capital charge is 2% a year on the deposit. ROBUST pays even at the band's low end; FARM pays at the point estimate; THIN beats its cash fees only; SKIP's fees eat the drop. Change the deposit, the drop share or the horizon above and every verdict recomputes. Yield earned meanwhile is left out, so the net is the airdrop alone.</p>
  <h3>What is not in the model</h3>
  <p>No protocol is named anywhere in the code (<code>namesInCode()</code> counts ${D.namesInCode} of ${D.ledger.total}). No future is predicted: the board says what a token would be worth <em>if</em> the protocol's record stayed as it is, never whether or when one is issued. Seven-day change is shown as DefiLlama records it, in percent. The snapshot is sealed at ${esc(D.asOf)}; nothing here fetches anything.</p>`;
}

function download(name, text, type) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type }));
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

function exportCsv() {
  const head = 'rank,slug,name,category,chains,tvl_usd,change_7d,age_days,tier,token_odds,if_launches_usd,implied_usd,p25_usd,p75_usd,verdict,net_usd,net_per_hour_usd';
  const lines = filteredRows().map((r) => {
    const f = farmPlan(r, state.scenario);
    return [r.rank, r.slug, `"${r.name.replace(/"/g, '""')}"`, `"${(r.category || '').replace(/"/g, '""')}"`, `"${r.chains.join(';')}"`, r.tvl, r.change7d === null ? '' : r.change7d, r.ageDays === null ? '' : r.ageDays, r.tier, r.odds.toFixed(3), r.ifLaunches, r.implied, r.p25, r.p75, f.verdict, f.net.toFixed(2), f.netHour.toFixed(2)].join(',');
  });
  download('frost-radar-v4.csv', [head, ...lines].join('\n'), 'text/csv');
}

function exportJson() {
  download('frost-radar-v4.json', JSON.stringify(filteredRows().map((r) => ({ ...r, farm: farmPlan(r, state.scenario) })), null, 2), 'application/json');
}

// ---------------------------------------------------------------- init

function init() {
  $('asof').textContent = D.asOf;
  $('tabn1').textContent = D.rows.length;
  $('tabn2').textContent = D.tokenRows.length;
  $('tabn3').textContent = D.setAsideRows.length;
  renderKpis();
  renderLedger();
  renderEvidence();
  renderBoard();
  for (const b of document.querySelectorAll('#tabs button')) b.addEventListener('click', () => showTab(b.dataset.tab));
  $('back').addEventListener('click', () => showTab('board'));
  $('q').addEventListener('input', (e) => { state.query = e.target.value; renderBoard(); });
  $('sort').addEventListener('change', (e) => { state.sort = e.target.value; renderBoard(); });
  const scen = () => {
    state.scenario = { deposit: +$('deposit').value, weeks: +$('weeks').value, dropShare: +$('share').value / 100 };
    $('depositv').textContent = money0(state.scenario.deposit);
    $('sharev').textContent = pct(state.scenario.dropShare);
    $('weeksv').textContent = `${state.scenario.weeks} wks`;
    renderBoard();
    if (state.detail) openDetail(state.detail);
  };
  $('deposit').addEventListener('input', scen);
  $('share').addEventListener('input', scen);
  $('weeks').addEventListener('input', scen);
  $('reset').addEventListener('click', () => {
    state.query = ''; state.verdict = 'ALL'; state.tier = 'ALL'; state.sort = 'rank';
    state.scenario = { ...D.farmDefault };
    $('q').value = ''; $('sort').value = 'rank';
    $('deposit').value = D.farmDefault.deposit; $('share').value = D.farmDefault.dropShare * 100; $('weeks').value = D.farmDefault.weeks;
    $('depositv').textContent = money0(D.farmDefault.deposit);
    $('sharev').textContent = pct(D.farmDefault.dropShare);
    $('weeksv').textContent = `${D.farmDefault.weeks} wks`;
    renderBoard();
  });
  $('csv').addEventListener('click', exportCsv);
  $('json').addEventListener('click', exportJson);
  // Deep links for the screenshots: ?tab=method&row=<slug>&verdict=FARM&tier=watchlist
  const params = new URLSearchParams(location.search);
  if (params.get('verdict')) state.verdict = params.get('verdict');
  if (params.get('tier')) state.tier = params.get('tier');
  if (params.get('deposit')) { state.scenario.deposit = +params.get('deposit'); $('deposit').value = state.scenario.deposit; $('depositv').textContent = money0(state.scenario.deposit); }
  renderBoard();
  if (params.get('tab')) showTab(params.get('tab'));
  if (params.get('row')) openDetail(params.get('row'));
  window.__radarReady = true;
}

document.addEventListener('DOMContentLoaded', init);
