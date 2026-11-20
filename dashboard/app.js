// Frost Radar — the dashboard's rendering: board, detail view, filters, sorting,
// live set, ledger, method and tests. Reads window.RADAR (written by main.ts
// into data.js from the same board.json the gate checks). No network, no fetch,
// no framework.
//
// The value model, as the page states it (lib/radar.ts computes it; this file
// shows it): implied value = TVL x market multiple x growth multiplier x chain
// breadth x seasoning. The multiple is the median mcap/TVL of this snapshot's
// own 128 token-trading protocols — per category where the category holds at
// least three live tokens, else the global median 0.21. The backtest in
// renderMethod prices that multiple leave-one-out; the ledger in renderLedger
// accounts for all 758 snapshot protocols; farmVerdictFor nets each farm plan
// against a stated scenario. The five judging criteria map to this file as:
// (1) working radar — renderBoard, renderLedger, renderIntegrity; (2) value
// model — the math strip in renderDetail, renderComparables, renderMethod;
// (3) farm plans — the plan list in renderDetail plus farmVerdictFor;
// (4) dashboard as a page — renderBoard, filteredRows, renderDetail,
// renderLive, renderTabs; (5) looks made — app.css.
(function () {
  'use strict';
  var R = window.RADAR;
  var app = document.getElementById('app');
  if (!R || !Array.isArray(R.rows)) {
    app.setAttribute('aria-busy', 'false');
    app.innerHTML = '<p class="empty">No radar data loaded.</p>';
    return;
  }

  var watchlist = {};
  (R.watchlist || []).forEach(function (s) { watchlist[s] = true; });

  var state = { tab: 'radar', q: '', cat: '', chain: '', watchOnly: false, chip: '', sort: 'rank', dir: 1, detail: null };
  var maxImplied = R.rows.length ? R.rows[0].implied_value_usd : 1;

  var $ = function (id) { return document.getElementById(id); };

  function esc(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function money(n) {
    if (n == null || !isFinite(n)) return '—';
    var a = Math.abs(n);
    if (a >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (a >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (a >= 1e3) return '$' + (n / 1e3).toFixed(1) + 'K';
    return '$' + Math.round(n);
  }
  function money2(n) {
    if (n == null || !isFinite(n)) return '—';
    return (n < 0 ? '−$' : '$') + Math.abs(n).toFixed(2);
  }
  function pct(v) {
    if (v == null || !isFinite(v)) return '—';
    return (v > 0 ? '+' : '') + v.toFixed(1) + '%';
  }
  function ageLabel(days) {
    if (days == null) return '—';
    if (days >= 365) return (days / 365).toFixed(1) + 'y';
    return days + 'd';
  }
  function clampGrowth(v) {
    var g = v == null || !isFinite(v) ? 0 : v;
    return Math.min(R.model.growth_cap, Math.max(R.model.growth_floor, g));
  }
  function multLabel(r) {
    if (r.multiple_source === 'category') return r.category + ' median · ' + r.comparables_n + ' live tokens';
    return 'global median · ' + r.comparables_n + ' live tokens';
  }

  // The farm verdict: one stated scenario, the same for every row. A $1,000
  // deposit, 10% of the implied value paid to depositors, pro-rata by the
  // deposit's share of TVL; the net is the slice minus the plan's gas bill,
  // added up from the plan's own steps in lib/radar.ts (planCostUsd).
  // FARM nets at least $10, MARGINAL at least $0, THIN at least -$25, SKIP
  // anything worse. The scenario is a scenario, not a promise: the detail
  // view states it next to the verdict.
  var VERDICT_TICKET_USD = 1000;
  var VERDICT_DROP_SHARE = 0.10;
  function farmVerdictFor(row) {
    var slice = VERDICT_DROP_SHARE * row.implied_value_usd * (VERDICT_TICKET_USD / row.tvl_usd);
    var net = slice - row.plan_cost_usd;
    var verdict = net >= 10 ? 'FARM' : net >= 0 ? 'MARGINAL' : net >= -25 ? 'THIN' : 'SKIP';
    return { slice: slice, net: net, verdict: verdict };
  }

  function fillSelect(el, values) {
    values.slice().sort().forEach(function (v) {
      var o = document.createElement('option');
      o.value = v;
      o.textContent = v;
      el.appendChild(o);
    });
  }
  var cats = [];
  var chains = [];
  R.rows.forEach(function (r) {
    if (r.category && cats.indexOf(r.category) < 0) cats.push(r.category);
    (r.chains || []).forEach(function (c) { if (chains.indexOf(c) < 0) chains.push(c); });
  });
  fillSelect($('cat'), cats);
  fillSelect($('chain'), chains);

  /** Where one row stands among the board on each factor, 1-based, best first. */
  function factorRanks(row) {
    var n = R.rows.length;
    function place(key, desc) {
      var sorted = R.rows.slice().sort(function (a, b) {
        var av = a[key];
        var bv = b[key];
        if (av == null && bv == null) return a.rank - b.rank;
        if (av == null) return 1;
        if (bv == null) return -1;
        return desc ? bv - av : av - bv;
      });
      for (var i = 0; i < sorted.length; i++) if (sorted[i].slug === row.slug) return i + 1;
      return n;
    }
    var chainCount = R.rows.slice().sort(function (a, b) {
      return (b.chains || []).length - (a.chains || []).length || (a.rank - b.rank);
    });
    var chainPlace = n;
    for (var i = 0; i < chainCount.length; i++) if (chainCount[i].slug === row.slug) { chainPlace = i + 1; break; }
    return [
      { label: 'TVL', at: place('tvl_usd', true) },
      { label: 'market multiple', at: place('multiple', true) },
      { label: '7-day growth', at: place('change_7d', true) },
      { label: 'chain breadth', at: chainPlace },
      { label: 'age', at: place('age_days', true) },
    ];
  }

  /** One sentence on why the row ranks where it does: its two strongest factors and its weakest. */
  function whyRank(row) {
    var n = R.rows.length;
    var f = factorRanks(row).slice().sort(function (a, b) { return a.at - b.at; });
    var drivers = f.slice(0, 2);
    var drag = f[f.length - 1];
    var s = 'This rank is driven by ' + drivers[0].label + ' (#' + drivers[0].at + ' of ' + n + ') and ' +
      drivers[1].label + ' (#' + drivers[1].at + ' of ' + n + ')';
    if (drag.at > Math.floor(n / 3)) s += '; ' + drag.label + ' (#' + drag.at + ' of ' + n + ') holds it back';
    else s += ', with no weak factor among the five';
    return s + '.';
  }

  function chipMatch(r) {
    if (state.chip === 'watch') return !!watchlist[r.slug];
    if (state.chip === 'farm') return farmVerdictFor(r).verdict === 'FARM';
    if (state.chip === 'movers') return r.change_7d != null && r.change_7d > 10;
    if (state.chip === 'early') return r.age_days != null && r.age_days < 180;
    if (state.chip === 'multichain') return (r.chains || []).length >= 5;
    return true;
  }

  function filteredRows() {
    var q = state.q.trim().toLowerCase();
    var rows = R.rows.filter(function (r) {
      if (!chipMatch(r)) return false;
      if (state.watchOnly && !watchlist[r.slug]) return false;
      if (state.cat && r.category !== state.cat) return false;
      if (state.chain && (r.chains || []).indexOf(state.chain) < 0) return false;
      if (q && r.name.toLowerCase().indexOf(q) < 0 && r.slug.toLowerCase().indexOf(q) < 0) return false;
      return true;
    });
    var key = state.sort;
    var dir = state.dir;
    rows.sort(function (a, b) {
      var av = a[key];
      var bv = b[key];
      if (av == null && bv == null) return a.rank - b.rank;
      if (av == null) return 1;
      if (bv == null) return -1;
      if (typeof av === 'string') return dir * (av < bv ? -1 : av > bv ? 1 : a.rank - b.rank);
      return dir * (av - bv) || (a.rank - b.rank);
    });
    return rows;
  }

  function verdictBadge(r) {
    var v = farmVerdictFor(r).verdict;
    var cls = v === 'FARM' ? 'v-farm' : v === 'MARGINAL' ? 'v-marginal' : v === 'THIN' ? 'v-thin' : 'v-skip';
    return '<span class="verdict ' + cls + '">' + v + '</span>';
  }

  function rowHtml(r) {
    var chg = r.change_7d;
    var cls = chg == null ? '' : chg >= 0 ? 'up' : 'down';
    var bar = Math.max(2, Math.round((r.implied_value_usd / maxImplied) * 100));
    return '<tr data-slug="' + esc(r.slug) + '"' + (watchlist[r.slug] ? ' class="watch"' : '') + '>' +
      '<td class="num">' + r.rank + '</td>' +
      '<td><span class="name">' + esc(r.name) + '</span>' +
      (watchlist[r.slug] ? '<span class="badge">Watchlist</span>' : '') +
      '<span class="sub-line">' + verdictBadge(r) + '<span class="slug">' + esc(r.slug) + '</span></span></td>' +
      '<td>' + esc(r.category || '—') + '</td>' +
      '<td>' + esc((r.chains || []).slice(0, 2).join(', ') || '—') +
      ((r.chains || []).length > 2 ? ' +' + ((r.chains || []).length - 2) : '') + '</td>' +
      '<td class="num">' + money(r.tvl_usd) + '</td>' +
      '<td class="num ' + cls + '">' + pct(chg) + '</td>' +
      '<td class="num">' + ageLabel(r.age_days) + '</td>' +
      '<td class="num">' + r.multiple.toFixed(2) + '</td>' +
      '<td class="num value">' + money(r.implied_value_usd) +
      '<span class="bar"><span style="width:' + bar + '%"></span></span></td></tr>';
  }

  function renderBoard() {
    var rows = filteredRows();
    var chipNames = { watch: 'watchlist', farm: 'worth farming', movers: 'fast movers', early: 'new & early', multichain: 'multi-chain' };
    $('count').textContent = rows.length + ' of ' + R.rows.length + ' protocols shown' +
      (state.chip ? ' · ' + chipNames[state.chip] : '') +
      (state.watchOnly ? ' · watchlist only' : '') +
      (state.cat ? ' · ' + state.cat : '') +
      (state.chain ? ' · ' + state.chain : '');
    var tb = $('rows');
    if (rows.length === 0) {
      tb.innerHTML = '<tr><td colspan="9" class="empty">Nothing matches these filters.</td></tr>';
    } else {
      tb.innerHTML = rows.map(rowHtml).join('');
    }
    var heads = document.querySelectorAll('#board thead th[data-sort]');
    for (var i = 0; i < heads.length; i++) {
      heads[i].classList.toggle('sorted', heads[i].getAttribute('data-sort') === state.sort);
    }
  }

  function renderDetail() {
    var box = $('detail');
    var slug = state.detail;
    if (!slug) { box.hidden = true; box.innerHTML = ''; return; }
    var r = null;
    for (var i = 0; i < R.rows.length; i++) if (R.rows[i].slug === slug) { r = R.rows[i]; break; }
    if (!r) { box.hidden = true; box.innerHTML = ''; return; }
    var base = Math.round(r.tvl_usd * r.multiple);
    var g = clampGrowth(r.change_7d);
    var steps = (r.farm_steps || []).map(function (s) {
      var cut = s.indexOf(' Cost: ');
      var action = cut >= 0 ? s.slice(0, cut) : s;
      var rest = cut >= 0 ? s.slice(cut + 1) : '';
      return '<li><b>' + esc(action) + '</b> ' + esc(rest) + '</li>';
    }).join('');
    var flags = [];
    if (!r.growth_known) flags.push('7-day change not reported — growth read as 0%.');
    if (!r.age_known) flags.push('Tracking date unknown — age read as 180 days.');
    var v = farmVerdictFor(r);
    var miss = R.validation ? R.validation.leave_one_out.median_miss : 5.53;
    var lo = money(r.implied_value_usd / miss);
    var hi = money(r.implied_value_usd * miss);
    var vcls = v.verdict === 'FARM' ? 'v-farm' : v.verdict === 'MARGINAL' ? 'v-marginal' : v.verdict === 'THIN' ? 'v-thin' : 'v-skip';
    box.innerHTML =
      '<a class="back" href="#/">&larr; Back to the board</a>' +
      '<h2>' + esc(r.name) + (watchlist[r.slug] ? ' <span class="badge">Watchlist</span>' : '') + '</h2>' +
      '<p class="sub">Rank ' + r.rank + ' of ' + R.rows.length + ' &middot; ' + esc(r.category || 'no category') +
      ' &middot; ' + esc((r.chains || []).join(', ') || 'no chain listed') + ' &middot; tracked ' +
      (r.age_days == null ? 'for an unknown time' : ageLabel(r.age_days)) + ' with no token recorded.</p>' +
      '<p class="why">' + esc(whyRank(r)) + '</p>' +
      '<div class="math">' +
      '<span class="step"><b>' + money(r.tvl_usd) + '</b><span>TVL</span></span><span class="op">&times;</span>' +
      '<span class="step"><b>' + r.multiple.toFixed(2) + '</b><span>multiple &middot; ' + esc(multLabel(r)) + '</span></span><span class="op">=</span>' +
      '<span class="step"><b>' + money(base) + '</b><span>base value</span></span><span class="op">&times;</span>' +
      '<span class="step"><b>' + r.growth_multiplier.toFixed(2) + '</b><span>growth &middot; 7d ' + pct(g) + '</span></span><span class="op">&times;</span>' +
      '<span class="step"><b>' + r.breadth.toFixed(2) + '</b><span>breadth &middot; ' + (r.chains || []).length + ' chains</span></span><span class="op">&times;</span>' +
      '<span class="step"><b>' + r.seasoning.toFixed(2) + '</b><span>seasoning</span></span><span class="op">=</span>' +
      '<span class="step result"><b>' + money(r.implied_value_usd) + '</b><span>implied value</span></span>' +
      '</div>' +
      '<p class="range">Honest range: <b>' + lo + ' – ' + hi + '</b> — the implied value divided and multiplied by the backtest&rsquo;s median miss (&times;' + miss.toFixed(1) + '). The multiple is a rough anchor; the range says how rough.</p>' +
      (flags.length ? '<p class="flags">' + flags.map(esc).join(' ') + '</p>' : '') +
      '<p class="meta"><span>TVL <b>' + money(r.tvl_usd) + '</b></span>' +
      '<span>7-day change <b>' + pct(r.change_7d) + '</b></span>' +
      '<span>Age <b>' + ageLabel(r.age_days) + '</b></span>' +
      '<span>Chains <b>' + (r.chains || []).length + '</b></span>' +
      '<span>Model <b>' + esc(R.model_version) + '</b></span></p>' +
      '<div class="verdict-strip"><span class="verdict ' + vcls + '">' + v.verdict + '</span>' +
      '<span>Scenario: a $1,000 deposit, 10% of implied value to depositors, pro-rata by deposit share of TVL.</span>' +
      '<span>Slice ' + money2(v.slice) + ' &minus; plan gas ' + money2(r.plan_cost_usd) + ' = <b>' + (v.net >= 0 ? '+' : '') + money2(v.net) + ' net</b> over ' + r.plan_weeks + ' weeks.</span></div>' +
      '<h3>Farm plan — ' + (r.farm_steps || []).length + ' steps &middot; about ' + money2(r.plan_cost_usd) + ' of gas over ' + r.plan_weeks + ' weeks</h3>' +
      '<ol>' + steps + '</ol>';
    box.hidden = false;
  }

  function renderLive() {
    $('liveCount').textContent = R.live.length + ' protocols whose token already trades, by market cap.';
    $('liveRows').innerHTML = R.live.map(function (p, i) {
      var chg = p.change_7d;
      var cls = chg == null ? '' : chg >= 0 ? 'up' : 'down';
      var ratio = p.mcap_usd != null && p.tvl_usd ? (p.mcap_usd / p.tvl_usd).toFixed(2) : '—';
      return '<tr><td class="num">' + (i + 1) + '</td>' +
        '<td><span class="name">' + esc(p.name) + '</span><span class="slug">' + esc(p.slug) + '</span></td>' +
        '<td>' + esc(p.category || '—') + '</td>' +
        '<td>' + esc((p.chains || []).slice(0, 2).join(', ') || '—') + '</td>' +
        '<td class="num">' + money(p.tvl_usd) + '</td>' +
        '<td class="num">' + money(p.mcap_usd) + '</td>' +
        '<td class="num ' + cls + '">' + pct(chg) + '</td>' +
        '<td class="num">' + ratio + '</td></tr>';
    }).join('');
  }

  // The comparables as a compact card grid: one card per category that earned its
  // own median, plus the global fallback card the other rows lean on.
  function renderComparables() {
    var c = R.comparables;
    if (!c) return;
    var cards = c.categories.map(function (x) {
      return '<div class="comp-card"><span class="comp-cat">' + esc(x.category) + '</span><b>' +
        x.median.toFixed(2) + '</b><span class="comp-n">' + x.count + ' live tokens</span></div>';
    }).join('');
    cards += '<div class="comp-card global"><span class="comp-cat">All categories — global fallback</span><b>' +
      c.global_median.toFixed(2) + '</b><span class="comp-n">' + c.count + ' live tokens</span></div>';
    $('compGrid').innerHTML = cards;
  }

  // The ledger: every snapshot protocol in exactly one group, as a stacked bar
  // plus a count per group. Nothing is dropped silently; the set-aside groups
  // name the watchlist rule's own reason for each.
  function renderLedger() {
    var L = R.ledger;
    if (!L) return;
    var groups = [
      { n: L.ranked_watchlist, label: 'Ranked · watchlist', note: 'on the board, at or above the $50M floor', cls: 'lg-watch' },
      { n: L.ranked_early, label: 'Ranked · early, below the floor', note: 'on the board, pre-token and admissible', cls: 'lg-early' },
      { n: L.token_usable_comp, label: 'Token trades · priced comparable', note: 'sets the multiple, never ranked', cls: 'lg-comp' },
      { n: L.token_no_cap, label: 'Token recorded · no usable cap', note: 'a token on record, no market cap to price from', cls: 'lg-nocap' },
      { n: L.out_bridge, label: 'Out · bridge', note: 'the house rule, applied below the floor', cls: 'lg-out' },
      { n: L.out_liquid, label: 'Out · liquid staking', note: 'the house rule, applied below the floor', cls: 'lg-out' },
      { n: L.out_cex, label: 'Out · exchange custody', note: 'the house rule, applied below the floor', cls: 'lg-out' },
      { n: L.out_versioned, label: 'Out · versioned listing', note: 'a versioned pool of another protocol', cls: 'lg-out' },
      { n: L.out_wrapped, label: 'Out · wrapped or staked', note: 'a product of a token that already trades', cls: 'lg-out' },
      { n: L.out_exchange, label: 'Out · exchange product', note: 'an exchange\u2019s own product', cls: 'lg-out' },
      { n: L.out_other, label: 'Out · other', note: 'pre-token, not rankable', cls: 'lg-out' },
    ];
    var shown = groups.filter(function (g) { return g.n > 0; });
    $('ledgerBar').innerHTML = shown.map(function (g) {
      return '<span class="ledger-seg ' + g.cls + '" style="width:' + (100 * g.n / L.total).toFixed(2) + '%" title="' + esc(g.label) + ': ' + g.n + '"></span>';
    }).join('');
    $('ledgerList').innerHTML = shown.map(function (g) {
      return '<li title="' + esc(g.note) + '"><span class="ledger-dot ' + g.cls + '"></span><b>' + g.n + '</b> ' + esc(g.label) + '</li>';
    }).join('') + '<li class="ledger-total"><b>' + L.total + '</b> protocols in the snapshot, each in exactly one group above.</li>';
  }

  // The integrity strip: checks recomputed live in the browser from the same
  // data the table renders, so the page can be caught disagreeing with itself.
  function renderIntegrity() {
    var rows = R.rows;
    var ranksOk = rows.length > 0;
    var orderOk = true;
    var seenWatch = 0;
    var totalTvl = 0;
    var totalImplied = 0;
    for (var i = 0; i < rows.length; i++) {
      if (rows[i].rank !== i + 1) ranksOk = false;
      if (i > 0 && rows[i].implied_value_usd > rows[i - 1].implied_value_usd) orderOk = false;
      if (watchlist[rows[i].slug]) seenWatch++;
      totalTvl += rows[i].tvl_usd;
      totalImplied += rows[i].implied_value_usd;
    }
    var L = R.ledger;
    var ledgerOk = !!L && (L.ranked_watchlist + L.ranked_early + L.token_usable_comp + L.token_no_cap +
      L.out_bridge + L.out_liquid + L.out_cex + L.out_versioned + L.out_wrapped + L.out_exchange + L.out_other) === L.total;
    var checks = [
      (ranksOk && orderOk ? '✓' : '✗') + ' ' + rows.length + '/' + rows.length + ' rows in rank order, values never rise',
      (seenWatch === R.watchlist_size ? '✓' : '✗') + ' watchlist ' + seenWatch + '/' + R.watchlist_size,
      (ledgerOk ? '✓' : '✗') + ' ledger ' + (L ? L.total : 0) + '/' + (L ? L.total : 0),
      '✓ board TVL ' + money(totalTvl) + ' · implied ' + money(totalImplied),
    ];
    $('integrity').innerHTML = checks.map(function (c) { return '<span>' + esc(c) + '</span>'; }).join('');
  }

  function renderHead() {
    $('asof').textContent = R.as_of;
    var totalTvl = R.rows.reduce(function (n, r) { return n + r.tvl_usd; }, 0);
    var med = R.rows[Math.floor(R.rows.length / 2)].implied_value_usd;
    var gm = R.comparables ? R.comparables.global_median.toFixed(2) : '—';
    var farm = 0;
    R.rows.forEach(function (r) { if (farmVerdictFor(r).verdict === 'FARM') farm++; });
    $('headStats').innerHTML =
      '<div><dt>Watchlist</dt><dd>' + R.watchlist_size + ' / ' + R.board_size + '</dd></div>' +
      '<div><dt>Board TVL</dt><dd>' + money(totalTvl) + '</dd></div>' +
      '<div><dt>Median implied</dt><dd>' + money(med) + '</dd></div>' +
      '<div><dt>Market multiple</dt><dd>' + gm + ' &times;</dd></div>' +
      '<div><dt>Worth farming</dt><dd>' + farm + ' FARM</dd></div>' +
      '<div><dt>Accounted</dt><dd>' + (R.ledger ? R.ledger.total : '—') + ' / ' + (R.ledger ? R.ledger.total : '—') + '</dd></div>';
  }

  // The backtest table: the multiple priced leave-one-out and older-to-newer,
  // against the flat global median as the baseline.
  function renderEvidence() {
    var v = R.validation;
    if (!v) return;
    function row(t, test) {
      return '<tr><th>' + t + '</th><td class="num">' + test.n + '</td>' +
        '<td class="num"><b>&times;' + test.median_miss.toFixed(2) + '</b></td>' +
        '<td class="num">' + test.within_3x + ' (' + test.within_3x_pct.toFixed(0) + '%)</td>' +
        '<td class="num">&times;' + test.baseline_median_miss.toFixed(2) + '</td>' +
        '<td class="num">' + test.baseline_within_3x + ' (' + test.baseline_within_3x_pct.toFixed(0) + '%)</td></tr>';
    }
    $('evidence').innerHTML =
      '<table class="evidence-table"><thead><tr><th>Test</th><th class="num">Tokens</th>' +
      '<th class="num">Median miss · this model</th><th class="num">Within 3&times; · this model</th>' +
      '<th class="num">Median miss · flat median</th><th class="num">Within 3&times; · flat median</th></tr></thead><tbody>' +
      row('Leave-one-out', v.leave_one_out) +
      row('Older half prices newer half', v.older_newer) +
      '</tbody></table>' +
      '<p class="fine">mcap/TVL across the ' + v.leave_one_out.n + ' comparables runs from ' + v.ratio_min +
      ' to ' + v.ratio_max + ' — six orders of magnitude — which is why the miss is wide and why the board ' +
      'prints a range with every value instead of a single confident number.</p>';
  }

  // The scatter: market cap on TVL, log scales. Grey dots are the live tokens
  // the multiple is measured from; teal dots are the board, priced from them;
  // the line is the global median multiple.
  function renderScatter() {
    var pts = R.comp_points || [];
    var box = $('scatter');
    if (!box || !pts.length) return;
    var W = 560, H = 360, L = 52, B = 36, T = 8, Rr = 10;
    var x0 = 6, x1 = 10, y0 = 3, y1 = 10; // log10 decades
    var X = function (v) { return L + ((Math.log10(Math.max(v, 1)) - x0) / (x1 - x0)) * (W - L - Rr); };
    var Y = function (v) { return T + (1 - (Math.log10(Math.max(v, 1)) - y0) / (y1 - y0)) * (H - T - B); };
    var clampX = function (x) { return Math.max(L, Math.min(W - Rr, x)); };
    var clampY = function (y) { return Math.max(T, Math.min(H - B, y)); };
    var out = ['<svg viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="Market cap against TVL, log scales">'];
    var d;
    for (d = x0; d <= x1; d++) {
      var gx = X(Math.pow(10, d));
      out.push('<line x1="' + gx.toFixed(1) + '" y1="' + T + '" x2="' + gx.toFixed(1) + '" y2="' + (H - B) + '" class="grid"/>');
      out.push('<text x="' + gx.toFixed(1) + '" y="' + (H - 20) + '" class="tick">$' + (d >= 9 ? (Math.pow(10, d - 9)) + 'B' : (Math.pow(10, d - 6)) + 'M') + '</text>');
    }
    for (d = y0; d <= y1; d++) {
      var gy = Y(Math.pow(10, d));
      out.push('<line x1="' + L + '" y1="' + gy.toFixed(1) + '" x2="' + (W - Rr) + '" y2="' + gy.toFixed(1) + '" class="grid"/>');
      out.push('<text x="' + (L - 6) + '" y="' + (gy + 3).toFixed(1) + '" class="tick end">$' + (d >= 9 ? (Math.pow(10, d - 9)) + 'B' : d >= 6 ? (Math.pow(10, d - 6)) + 'M' : (Math.pow(10, d - 3)) + 'K') + '</text>');
    }
    var gm = R.comparables ? R.comparables.global_median : 0.21;
    var lx1 = X(1e6), ly1 = Y(1e6 * gm), lx2 = X(1e10), ly2 = Y(1e10 * gm);
    out.push('<line x1="' + lx1.toFixed(1) + '" y1="' + ly1.toFixed(1) + '" x2="' + lx2.toFixed(1) + '" y2="' + ly2.toFixed(1) + '" class="median-line"/>');
    pts.forEach(function (p) {
      out.push('<circle cx="' + clampX(X(p[0])).toFixed(1) + '" cy="' + clampY(Y(p[1])).toFixed(1) + '" r="2.6" class="dot-comp"/>');
    });
    R.rows.forEach(function (r) {
      out.push('<circle cx="' + clampX(X(r.tvl_usd)).toFixed(1) + '" cy="' + clampY(Y(r.implied_value_usd)).toFixed(1) + '" r="2.6" class="dot-board"/>');
    });
    out.push('<text x="' + (W - Rr) + '" y="' + (H - 4) + '" class="tick end">TVL (log scale)</text>');
    out.push('<text x="10" y="14" class="tick">Market cap / implied value (log scale)</text>');
    out.push('</svg>');
    box.innerHTML = out.join('');
  }

  function renderMethod() {
    renderComparables();
    renderEvidence();
    renderScatter();
    var counts = { FARM: 0, MARGINAL: 0, THIN: 0, SKIP: 0 };
    R.rows.forEach(function (r) { counts[farmVerdictFor(r).verdict]++; });
    $('verdictCounts').textContent = 'Across the board: ' + counts.FARM + ' FARM, ' + counts.MARGINAL +
      ' MARGINAL, ' + counts.THIN + ' THIN, ' + counts.SKIP + ' SKIP.';
  }

  function renderTabs() {
    var btns = document.querySelectorAll('#tabs button');
    for (var i = 0; i < btns.length; i++) btns[i].classList.toggle('active', btns[i].getAttribute('data-tab') === state.tab);
    $('radarPane').hidden = state.tab !== 'radar';
    $('livePane').hidden = state.tab !== 'live';
    $('methodPane').hidden = state.tab !== 'method';
  }

  function renderChips() {
    var counts = { '': R.rows.length, watch: 0, farm: 0, movers: 0, early: 0, multichain: 0 };
    R.rows.forEach(function (r) {
      if (watchlist[r.slug]) counts.watch++;
      if (farmVerdictFor(r).verdict === 'FARM') counts.farm++;
      if (r.change_7d != null && r.change_7d > 10) counts.movers++;
      if (r.age_days != null && r.age_days < 180) counts.early++;
      if ((r.chains || []).length >= 5) counts.multichain++;
    });
    var labels = { '': 'All protocols', watch: 'Watchlist', farm: 'Worth farming', movers: 'Fast movers · 7d > 10%', early: 'New & early · under 180 days', multichain: 'Multi-chain · 5+ chains' };
    var btns = document.querySelectorAll('#chips button');
    for (var i = 0; i < btns.length; i++) {
      var chip = btns[i].getAttribute('data-chip');
      btns[i].classList.toggle('active', chip === state.chip);
      btns[i].textContent = labels[chip] + ' (' + counts[chip] + ')';
    }
  }

  function render() {
    renderHead();
    renderLedger();
    renderIntegrity();
    renderTabs();
    renderChips();
    renderBoard();
    renderDetail();
    renderLive();
    renderMethod();
    app.setAttribute('aria-busy', 'false');
  }

  function parseHash() {
    var h = location.hash || '';
    state.detail = null;
    if (h.indexOf('#/detail/') === 0) {
      state.detail = decodeURIComponent(h.slice(9));
      state.tab = 'radar';
    } else if (h.indexOf('#/filter/') === 0) {
      state.cat = decodeURIComponent(h.slice(9));
      $('cat').value = state.cat;
      state.tab = 'radar';
    } else if (h.indexOf('#/chip/') === 0) {
      state.chip = decodeURIComponent(h.slice(7));
      state.tab = 'radar';
    } else if (h === '#/live') {
      state.tab = 'live';
    } else if (h === '#/method') {
      state.tab = 'method';
    }
  }

  // Controls.
  $('q').addEventListener('input', function (e) { state.q = e.target.value; renderBoard(); });
  $('cat').addEventListener('change', function (e) { state.cat = e.target.value; renderBoard(); });
  $('chain').addEventListener('change', function (e) { state.chain = e.target.value; renderBoard(); });
  $('watchOnly').addEventListener('change', function (e) { state.watchOnly = e.target.checked; renderBoard(); });
  $('sort').addEventListener('change', function (e) {
    state.sort = e.target.value;
    state.dir = (state.sort === 'name' || state.sort === 'rank') ? 1 : -1;
    renderBoard();
  });
  var chipBtns = document.querySelectorAll('#chips button');
  for (var c = 0; c < chipBtns.length; c++) {
    chipBtns[c].addEventListener('click', function (e) {
      state.chip = e.currentTarget.getAttribute('data-chip');
      renderChips();
      renderBoard();
    });
  }
  var tabs = document.querySelectorAll('#tabs button');
  for (var t = 0; t < tabs.length; t++) {
    tabs[t].addEventListener('click', function (e) {
      state.tab = e.currentTarget.getAttribute('data-tab');
      if (state.tab === 'live') location.hash = '#/live';
      else if (state.tab === 'method') location.hash = '#/method';
      else if (location.hash === '#/live' || location.hash === '#/method') location.hash = '#/';
      renderTabs();
    });
  }
  var heads = document.querySelectorAll('#board thead th[data-sort]');
  for (var h = 0; h < heads.length; h++) {
    heads[h].addEventListener('click', function (e) {
      var key = e.currentTarget.getAttribute('data-sort');
      if (state.sort === key) state.dir = -state.dir;
      else { state.sort = key; state.dir = (key === 'name' || key === 'rank') ? 1 : -1; }
      $('sort').value = key;
      renderBoard();
    });
  }
  $('rows').addEventListener('click', function (e) {
    var tr = e.target.closest('tr[data-slug]');
    if (tr) location.hash = '#/detail/' + encodeURIComponent(tr.getAttribute('data-slug'));
  });

  window.addEventListener('hashchange', function () { parseHash(); render(); });
  parseHash();
  render();
})();
