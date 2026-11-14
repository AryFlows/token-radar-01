// Frost Radar — the dashboard's rendering: board, detail view, filters, sorting, live set.
// Reads window.RADAR (written by main.ts into data.js). No network, no fetch, no framework.
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

  var state = { tab: 'radar', q: '', cat: '', chain: '', watchOnly: false, sort: 'rank', dir: 1, detail: null };

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

  function filteredRows() {
    var q = state.q.trim().toLowerCase();
    var rows = R.rows.filter(function (r) {
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

  function rowHtml(r) {
    var chg = r.change_7d;
    var cls = chg == null ? '' : chg >= 0 ? 'up' : 'down';
    return '<tr data-slug="' + esc(r.slug) + '"' + (watchlist[r.slug] ? ' class="watch"' : '') + '>' +
      '<td class="num">' + r.rank + '</td>' +
      '<td><span class="name">' + esc(r.name) + '</span>' +
      (watchlist[r.slug] ? '<span class="badge">Watchlist</span>' : '') +
      '<span class="slug">' + esc(r.slug) + '</span></td>' +
      '<td>' + esc(r.category || '—') + '</td>' +
      '<td>' + esc((r.chains || []).slice(0, 2).join(', ') || '—') + '</td>' +
      '<td class="num">' + money(r.tvl_usd) + '</td>' +
      '<td class="num ' + cls + '">' + pct(chg) + '</td>' +
      '<td class="num">' + ageLabel(r.age_days) + '</td>' +
      '<td class="num value">' + money(r.implied_value_usd) + '</td></tr>';
  }

  function renderBoard() {
    var rows = filteredRows();
    $('count').textContent = rows.length + ' of ' + R.rows.length + ' protocols shown' +
      (state.watchOnly ? ' · watchlist only' : '') +
      (state.cat ? ' · ' + state.cat : '') +
      (state.chain ? ' · ' + state.chain : '');
    var tb = $('rows');
    if (rows.length === 0) {
      tb.innerHTML = '<tr><td colspan="8" class="empty">Nothing matches these filters.</td></tr>';
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
    var base = Math.round(r.tvl_usd * R.model.base_multiple);
    var g = clampGrowth(r.change_7d);
    var steps = (r.farm_steps || []).map(function (s) {
      var cut = s.indexOf(' Cost: ');
      var action = cut >= 0 ? s.slice(0, cut) : s;
      var rest = cut >= 0 ? s.slice(cut + 1) : '';
      return '<li><b>' + esc(action) + '</b> ' + esc(rest) + '</li>';
    }).join('');
    box.innerHTML =
      '<a class="back" href="#/">&larr; Back to the board</a>' +
      '<h2>' + esc(r.name) + (watchlist[r.slug] ? ' <span class="badge">Watchlist</span>' : '') + '</h2>' +
      '<p class="sub">Rank ' + r.rank + ' of ' + R.rows.length + ' &middot; ' + esc(r.category || 'no category') +
      ' &middot; ' + esc((r.chains || []).join(', ') || 'no chain listed') + ' &middot; tracked ' +
      (r.age_days == null ? 'for an unknown time' : ageLabel(r.age_days)) + ' with no token recorded.</p>' +
      '<div class="math">' +
      '<span class="step"><b>' + money(r.tvl_usd) + '</b><span>TVL</span></span><span class="op">&times;</span>' +
      '<span class="step"><b>' + R.model.base_multiple.toFixed(2) + '</b><span>base multiple</span></span><span class="op">=</span>' +
      '<span class="step"><b>' + money(base) + '</b><span>base value</span></span><span class="op">&times;</span>' +
      '<span class="step"><b>' + r.growth_multiplier.toFixed(2) + '</b><span>growth &middot; 7d ' + pct(g) + '</span></span><span class="op">&times;</span>' +
      '<span class="step"><b>' + r.seasoning.toFixed(2) + '</b><span>seasoning</span></span><span class="op">=</span>' +
      '<span class="step result"><b>' + money(r.implied_value_usd) + '</b><span>implied value</span></span>' +
      '</div>' +
      '<p class="meta"><span>TVL <b>' + money(r.tvl_usd) + '</b></span>' +
      '<span>7-day change <b>' + pct(r.change_7d) + '</b></span>' +
      '<span>Age <b>' + ageLabel(r.age_days) + '</b></span>' +
      '<span>Model <b>' + esc(R.model_version) + '</b></span></p>' +
      '<h3>Farm plan — ' + (r.farm_steps || []).length + ' steps</h3>' +
      '<ol>' + steps + '</ol>';
    box.hidden = false;
  }

  function renderLive() {
    $('liveCount').textContent = R.live.length + ' protocols whose token already trades, by market cap.';
    $('liveRows').innerHTML = R.live.map(function (p, i) {
      var chg = p.change_7d;
      var cls = chg == null ? '' : chg >= 0 ? 'up' : 'down';
      return '<tr><td class="num">' + (i + 1) + '</td>' +
        '<td><span class="name">' + esc(p.name) + '</span><span class="slug">' + esc(p.slug) + '</span></td>' +
        '<td>' + esc(p.category || '—') + '</td>' +
        '<td>' + esc((p.chains || []).slice(0, 2).join(', ') || '—') + '</td>' +
        '<td class="num">' + money(p.tvl_usd) + '</td>' +
        '<td class="num">' + money(p.mcap_usd) + '</td>' +
        '<td class="num ' + cls + '">' + pct(chg) + '</td></tr>';
    }).join('');
  }

  function renderHead() {
    $('asof').textContent = R.as_of;
    var totalTvl = R.rows.reduce(function (n, r) { return n + r.tvl_usd; }, 0);
    var med = R.rows[Math.floor(R.rows.length / 2)].implied_value_usd;
    $('headStats').innerHTML =
      '<div><dt>Watchlist</dt><dd>' + R.watchlist_size + ' / ' + R.board_size + '</dd></div>' +
      '<div><dt>Board TVL</dt><dd>' + money(totalTvl) + '</dd></div>' +
      '<div><dt>Median implied</dt><dd>' + money(med) + '</dd></div>';
  }

  function renderTabs() {
    var btns = document.querySelectorAll('#tabs button');
    for (var i = 0; i < btns.length; i++) btns[i].classList.toggle('active', btns[i].getAttribute('data-tab') === state.tab);
    $('radarPane').hidden = state.tab !== 'radar';
    $('livePane').hidden = state.tab !== 'live';
    if (state.tab === 'live') renderLive();
  }

  function render() {
    renderHead();
    renderTabs();
    if (state.tab === 'radar') {
      renderBoard();
      renderDetail();
    }
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
    } else if (h === '#/live') {
      state.tab = 'live';
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
  var tabs = document.querySelectorAll('#tabs button');
  for (var t = 0; t < tabs.length; t++) {
    tabs[t].addEventListener('click', function (e) {
      state.tab = e.currentTarget.getAttribute('data-tab');
      if (state.tab === 'live') location.hash = '#/live';
      else if (location.hash === '#/live') location.hash = '#/';
      renderTabs();
      if (state.tab === 'radar') renderBoard();
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
