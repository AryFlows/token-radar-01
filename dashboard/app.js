// Frost Radar v3 — the dashboard's page logic. No network, no framework:
// it reads window.RADAR (data.js, written by main.ts from the same board)
// and renders the board, the detail view, the method tab and the live view.
(function () {
  'use strict';
  var D = window.RADAR;
  var app = document.getElementById('app');
  var rowsEl = document.getElementById('rows');
  var countEl = document.getElementById('count');
  var detailEl = document.getElementById('detail');
  var methodEl = document.getElementById('methodPane');
  var searchEl = document.getElementById('search');
  var sortEl = document.getElementById('sort');

  var state = { chip: 'all', sort: 'rank', query: '', detail: null, method: false };

  function money(n) {
    if (n === null || n === undefined) return '—';
    if (n >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (n >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (n >= 1e3) return '$' + (n / 1e3).toFixed(1) + 'K';
    return '$' + Math.round(n);
  }

  function moneyFull(n) {
    if (n === null || n === undefined) return '—';
    return '$' + Math.round(n).toLocaleString('en-US');
  }

  function pct(n, digits) {
    if (n === null || n === undefined) return '—';
    var d = digits === undefined ? 1 : digits;
    return (n >= 0 ? '+' : '') + n.toFixed(d) + '%';
  }

  function esc(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function verdictClass(v) {
    return 'v-' + v.toLowerCase();
  }

  function filteredRows() {
    var rows = D.rows;
    if (state.chip === 'watchlist') rows = rows.filter(function (r) { return r.watchlist; });
    else if (state.chip !== 'all') rows = rows.filter(function (r) { return r.verdict.toLowerCase() === state.chip; });
    if (state.query) {
      var q = state.query.toLowerCase();
      rows = rows.filter(function (r) {
        return r.name.toLowerCase().indexOf(q) >= 0 || r.slug.indexOf(q) >= 0 || (r.category || '').toLowerCase().indexOf(q) >= 0;
      });
    }
    var key = state.sort;
    var sorted = rows.slice();
    sorted.sort(function (a, b) {
      if (key === 'name') return a.name.localeCompare(b.name);
      if (key === 'tvl') return b.tvl - a.tvl;
      if (key === 'implied') return b.implied - a.implied;
      if (key === 'ev') return b.ev - a.ev;
      if (key === 'odds') return b.odds - a.odds;
      if (key === 'change7d') return (b.change7d === null ? -1e9 : b.change7d) - (a.change7d === null ? -1e9 : a.change7d);
      return a.rank - b.rank;
    });
    return sorted;
  }

  function renderStats() {
    var f = D.fit;
    var L = D.ledger;
    document.getElementById('stats').innerHTML =
      '<div class="stat"><b>' + L.ranked + '</b><span>ranked</span></div>' +
      '<div class="stat"><b>' + L.watchlist + '</b><span>watchlist</span></div>' +
      '<div class="stat"><b>' + L.comps + '</b><span>comparables</span></div>' +
      '<div class="stat"><b>×' + f.looMiss.toFixed(2) + '</b><span>LOO miss</span></div>' +
      '<div class="stat"><b>×' + f.wfMiss.toFixed(2) + '</b><span>walk-forward</span></div>' +
      '<div class="stat"><b>×' + f.rangeLo.toFixed(2) + '–×' + f.rangeHi.toFixed(2) + '</b><span>honest range</span></div>';
    document.getElementById('asof').textContent = 'Snapshot ' + D.asOf + ' · floor $' + (D.floorUsd / 1e6) + 'M';
    document.getElementById('formula').textContent =
      'log(mcap) = ' + f.intercept.toFixed(3) + ' + ' + f.slope.toFixed(3) + ' · log(TVL) — fitted on ' + f.nComps + ' live-token comparables';
    document.getElementById('footAsOf').textContent = D.asOf;
  }

  function renderBoard() {
    var rows = filteredRows();
    countEl.textContent = 'Showing ' + rows.length + ' of ' + D.rows.length + ' ranked protocols';
    rowsEl.innerHTML = rows.map(function (r) {
      var chip = '<span class="verdict ' + verdictClass(r.verdict) + '">' + r.verdict + '</span>';
      return '<tr data-slug="' + esc(r.slug) + '">' +
        '<td class="num">' + r.rank + '</td>' +
        '<td><a href="#/detail/' + esc(r.slug) + '">' + esc(r.name) + '</a>' + (r.watchlist ? ' <span class="wl" title="On the watchlist">★</span>' : '') + '</td>' +
        '<td>' + esc(r.category || '—') + '</td>' +
        '<td>' + esc(r.chains.slice(0, 3).join(', ') || '—') + '</td>' +
        '<td class="num">' + money(r.tvl) + '</td>' +
        '<td class="num ' + ((r.change7d === null ? 0 : r.change7d) >= 0 ? 'up' : 'down') + '">' + pct(r.change7d) + '</td>' +
        '<td class="num"><b>' + money(r.implied) + '</b></td>' +
        '<td class="num">' + money(r.rangeLo) + ' – ' + money(r.rangeHi) + '</td>' +
        '<td class="num">' + Math.round(r.odds * 100) + '%</td>' +
        '<td>' + chip + '</td></tr>';
    }).join('');
  }

  function renderLive() {
    document.getElementById('liveRows').innerHTML = D.live.map(function (r) {
      return '<tr><td>' + esc(r.name) + '</td><td>' + esc(r.category || '—') + '</td>' +
        '<td class="num">' + money(r.tvl) + '</td><td class="num"><b>' + money(r.mcap) + '</b></td>' +
        '<td class="num ' + ((r.change7d === null ? 0 : r.change7d) >= 0 ? 'up' : 'down') + '">' + pct(r.change7d) + '</td></tr>';
    }).join('');
  }

  function evFor(row, deposit, share) {
    var slice = share * row.implied * (deposit / row.tvl);
    return row.odds * slice - 20;
  }

  function verdictFor(ev) {
    if (ev >= 10) return 'FARM';
    if (ev >= 0) return 'MARGINAL';
    if (ev >= -25) return 'THIN';
    return 'SKIP';
  }

  function renderDetail() {
    if (!state.detail) {
      detailEl.hidden = true;
      detailEl.innerHTML = '';
      return;
    }
    var r = null;
    for (var i = 0; i < D.rows.length; i++) {
      if (D.rows[i].slug === state.detail) { r = D.rows[i]; break; }
    }
    if (!r) {
      detailEl.hidden = false;
      detailEl.innerHTML = '<p class="detail-missing">No ranked protocol with that slug.</p>';
      return;
    }
    var steps = r.farmSteps.map(function (s, i) {
      return '<li><b>Step ' + (i + 1) + '.</b> ' + esc(s) + '</li>';
    }).join('');
    detailEl.hidden = false;
    detailEl.innerHTML =
      '<div class="detail-head"><h2>#' + r.rank + ' ' + esc(r.name) + '</h2>' +
      '<span class="verdict ' + verdictClass(r.verdict) + '">' + r.verdict + '</span>' +
      '<a class="detail-close" href="#/">Back to board</a></div>' +
      '<p class="detail-sub">' + esc(r.category || 'Uncategorised') + ' · ' + esc(r.chains.join(', ') || '—') +
      (r.watchlist ? ' · <span class="wl">★ on the watchlist</span>' : '') + '</p>' +
      '<div class="detail-grid">' +
      '<div><span>TVL</span><b>' + moneyFull(r.tvl) + '</b></div>' +
      '<div><span>Implied value</span><b>' + moneyFull(r.implied) + '</b></div>' +
      '<div><span>Honest range</span><b>' + money(r.rangeLo) + ' – ' + money(r.rangeHi) + '</b></div>' +
      '<div><span>Implied multiple</span><b>' + r.multiple.toFixed(2) + '× TVL</b></div>' +
      '<div><span>Token odds</span><b>' + Math.round(r.odds * 100) + '% <small>(' + r.peers + ' peers)</small></b></div>' +
      '<div><span>Farm EV ($1,000, 10% drop)</span><b>' + (r.ev >= 0 ? '+' : '') + '$' + r.ev.toFixed(2) + '</b></div>' +
      '</div>' +
      '<div class="scenario">' +
      '<h3>Price your own farm</h3>' +
      '<label>Deposit $<span id="depVal">1,000</span> <input id="depSlider" type="range" min="100" max="10000" step="100" value="1000"></label>' +
      '<label>Drop share <span id="shareVal">10%</span> <input id="shareSlider" type="range" min="1" max="50" step="1" value="10"></label>' +
      '<p id="scenarioOut"></p>' +
      '</div>' +
      '<h3>Farm plan</h3><ol class="steps">' + steps + '</ol>';
    var depSlider = document.getElementById('depSlider');
    var shareSlider = document.getElementById('shareSlider');
    var out = document.getElementById('scenarioOut');
    function updateScenario() {
      var dep = Number(depSlider.value);
      var share = Number(shareSlider.value) / 100;
      document.getElementById('depVal').textContent = dep.toLocaleString('en-US');
      document.getElementById('shareVal').textContent = shareSlider.value + '%';
      var ev = evFor(r, dep, share);
      var v = verdictFor(ev);
      out.innerHTML = 'EV <b>' + (ev >= 0 ? '+' : '') + '$' + ev.toFixed(2) + '</b> — verdict <span class="verdict ' + verdictClass(v) + '">' + v + '</span> <small>(gas $20)</small>';
    }
    depSlider.addEventListener('input', updateScenario);
    shareSlider.addEventListener('input', updateScenario);
    updateScenario();
  }

  function renderMethod() {
    if (!state.method) {
      methodEl.hidden = true;
      return;
    }
    var f = D.fit;
    var L = D.ledger;
    var sel = D.selection.map(function (s) {
      return '<tr class="' + (s.chosen ? 'chosen' : '') + '"><td>' + esc(s.name) + '</td>' +
        '<td class="num">×' + s.looMiss.toFixed(2) + '</td>' +
        '<td class="num">' + Math.round(s.looWithin * 100) + '%</td>' +
        '<td class="num">' + (s.wfMiss === null ? '—' : '×' + s.wfMiss.toFixed(2)) + '</td>' +
        '<td class="num">' + (s.wfWithin === null ? '—' : Math.round(s.wfWithin * 100) + '%') + '</td>' +
        '<td>' + esc(s.note) + '</td></tr>';
    }).join('');
    methodEl.hidden = false;
    methodEl.innerHTML =
      '<h2>Method — the fitted model</h2>' +
      '<p class="formula-block">log(mcap) = ' + f.intercept.toFixed(3) + ' + ' + f.slope.toFixed(3) + ' · log(TVL)</p>' +
      '<p>Fitted by least squares at runtime on the ' + f.nComps + ' snapshot protocols that record both a market cap and a TVL. ' +
      'R² = ' + f.r2.toFixed(2) + '; residual std ' + f.residStd.toFixed(2) + ' log units. ' +
      'Leave-one-out median miss ×' + f.looMiss.toFixed(2) + ' (' + Math.round(f.looWithin * 100) + '% within 3×); ' +
      'walk-forward ×' + f.wfMiss.toFixed(2) + ' (' + Math.round(f.wfWithin * 100) + '% within 3×). ' +
      'Every row shows the honest range ×' + f.rangeLo.toFixed(2) + ' to ×' + f.rangeHi.toFixed(2) + ' — the central 50% of the fit’s residuals.</p>' +
      '<h3>What was tried and rejected</h3>' +
      '<table class="board sel"><thead><tr><th>Candidate</th><th>LOO miss</th><th>Within 3×</th><th>WF miss</th><th>WF within 3×</th><th>Verdict</th></tr></thead><tbody>' + sel + '</tbody></table>' +
      '<p class="note">The leaders’ claimed held-out ×2.53/×2.92 is not reproducible by any honest variant on all ' + f.nComps + ' comparables — only by restricting the test set. This entry reports the honest ×' + f.looMiss.toFixed(2) + '.</p>' +
      '<h3>The ledger — all ' + L.total + ' protocols accounted for</h3>' +
      '<ul class="ledger">' +
      '<li><b>' + L.ranked + '</b> ranked on the board (' + L.watchlist + ' watchlist + ' + L.early + ' early)</li>' +
      '<li><b>' + L.comps + '</b> usable comparables — the fit’s training set</li>' +
      '<li><b>' + L.tokenNoCap + '</b> token recorded, no usable market cap</li>' +
      '<li><b>' + L.setAside + '</b> pre-token, set aside (bridge / staking / CEX / versioned / wrapped)</li>' +
      '</ul>' +
      '<p class="note">Pre-token: ' + L.preToken + ' = ' + L.ranked + ' ranked + ' + L.setAside + ' set aside. Live-token: ' + L.liveToken + '.</p>';
  }

  function syncChips() {
    var chips = document.querySelectorAll('.chip');
    for (var i = 0; i < chips.length; i++) {
      chips[i].setAttribute('aria-pressed', chips[i].getAttribute('data-chip') === state.chip ? 'true' : 'false');
    }
  }

  function route() {
    var hash = location.hash || '#/';
    var m;
    state.detail = null;
    state.method = false;
    if ((m = /^#\/detail\/([A-Za-z0-9._-]+)$/.exec(hash))) {
      state.detail = m[1];
    } else if ((m = /^#\/chip\/([a-z]+)$/.exec(hash))) {
      state.chip = m[1];
      if (['all', 'farm', 'marginal', 'thin', 'skip', 'watchlist'].indexOf(state.chip) < 0) state.chip = 'all';
    } else if (hash === '#/method') {
      state.method = true;
    }
    syncChips();
    renderBoard();
    renderDetail();
    renderMethod();
  }

  function init() {
    renderStats();
    renderLive();
    var chips = document.querySelectorAll('.chip');
    for (var i = 0; i < chips.length; i++) {
      chips[i].addEventListener('click', function () {
        location.hash = '#/chip/' + this.getAttribute('data-chip');
      });
    }
    searchEl.addEventListener('input', function () {
      state.query = searchEl.value.trim();
      renderBoard();
    });
    sortEl.addEventListener('change', function () {
      state.sort = sortEl.value;
      renderBoard();
    });
    var heads = document.querySelectorAll('thead th[data-sort]');
    for (var j = 0; j < heads.length; j++) {
      heads[j].addEventListener('click', function () {
        state.sort = this.getAttribute('data-sort');
        sortEl.value = state.sort === 'change7d' ? 'rank' : state.sort;
        renderBoard();
      });
    }
    window.addEventListener('hashchange', route);
    route();
    app.setAttribute('aria-busy', 'false');
  }

  init();
})();
