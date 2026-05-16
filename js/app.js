(() => {
  'use strict';

  // ---- demo mode（在 URL 加 ?demo=1 跳過 Supabase 用假資料預覽） ----
  const DEMO = location.search.includes('demo=1') || location.hash.includes('demo');

  // ---- state ----
  const S = {
    week: null,                    // 目前查看的 week_end (YYYY-MM-DD)
    weeks: [],                     // 可選週末清單
    stocksById: new Map(),         // stock_id → { name, industry, capital }
    detailCharts: [],              // 卸載時 destroy()
  };

  // ---- DOM ----
  const $ = (id) => document.getElementById(id);
  const loginScreen = $('login-screen');
  const mainScreen = $('main-screen');

  // ============================================================
  // 啟動
  // ============================================================
  function init() {
    if (DEMO) {
      // demo 模式：直接進主畫面
      Auth.set('viewer', '__demo__');
      showMain();
    } else if (Auth.isLoggedIn()) {
      showMain();
    } else {
      showLogin();
    }
    bindEvents();
  }

  function bindEvents() {
    $('login-form').addEventListener('submit', onLoginSubmit);
    $('logout-btn').addEventListener('click', onLogout);
    $('week-selector').addEventListener('change', onWeekChange);
    document.querySelectorAll('.tab').forEach((b) => {
      b.addEventListener('click', () => switchTab(b.dataset.tab));
    });
    $('detail-close').addEventListener('click', closeDetail);
    document.querySelector('#detail-modal .modal-backdrop').addEventListener('click', closeDetail);
  }

  // ============================================================
  // 登入
  // ============================================================
  async function onLoginSubmit(e) {
    e.preventDefault();
    const passcode = $('passcode-input').value.trim();
    const errBox = $('login-error');
    errBox.classList.add('hidden');
    if (!passcode) return;

    const role = await Auth.verify(passcode);
    if (!role) {
      errBox.textContent = '存取碼錯誤';
      errBox.classList.remove('hidden');
      return;
    }
    Auth.set(role, passcode);
    showMain();
  }

  function onLogout() {
    Auth.clear();
    showLogin();
  }

  function showLogin() {
    mainScreen.classList.add('hidden');
    loginScreen.classList.remove('hidden');
    $('passcode-input').value = '';
    $('passcode-input').focus();
  }

  async function showMain() {
    loginScreen.classList.add('hidden');
    mainScreen.classList.remove('hidden');
    await loadWeeks();
    await loadAlerts();
  }

  // ============================================================
  // Week selector
  // ============================================================
  async function loadWeeks() {
    // 從 st_alerts 撈最近 12 週有資料的 week_end
    const url = `${REST}/st_alerts?select=week_end&order=week_end.desc&limit=500`;
    const rows = await fetchJSON(url);
    const uniq = [...new Set(rows.map((r) => r.week_end))].slice(0, 12);
    S.weeks = uniq;
    const sel = $('week-selector');
    sel.innerHTML = '';
    if (uniq.length === 0) {
      // 還沒資料：放一個 placeholder
      const opt = document.createElement('option');
      opt.value = '';
      opt.textContent = '尚無資料';
      sel.appendChild(opt);
      S.week = null;
      return;
    }
    for (const w of uniq) {
      const opt = document.createElement('option');
      opt.value = w;
      opt.textContent = w;
      sel.appendChild(opt);
    }
    S.week = uniq[0];
    sel.value = S.week;
  }

  function onWeekChange() {
    S.week = $('week-selector').value;
    loadAlerts();
  }

  // ============================================================
  // 警示清單
  // ============================================================
  async function loadAlerts() {
    const loading = $('alerts-loading');
    const empty = $('alerts-empty');
    const redSec = $('red-section');
    const yelSec = $('yellow-section');
    loading.classList.remove('hidden');
    empty.classList.add('hidden');
    redSec.classList.add('hidden');
    yelSec.classList.add('hidden');

    if (!S.week) {
      loading.classList.add('hidden');
      empty.classList.remove('hidden');
      return;
    }

    const url = `${REST}/st_alerts?week_end=eq.${S.week}&select=*&order=level.asc,stock_id.asc`;
    const rows = await fetchJSON(url);

    // 同步抓 stock_id 對應的 name
    const ids = [...new Set(rows.map((r) => r.stock_id))];
    if (ids.length > 0) {
      const nameUrl = `${REST}/st_stocks?stock_id=in.(${ids.join(',')})&select=stock_id,name,industry,capital`;
      const stocks = await fetchJSON(nameUrl);
      for (const s of stocks) S.stocksById.set(s.stock_id, s);
    }

    loading.classList.add('hidden');
    if (rows.length === 0) {
      empty.classList.remove('hidden');
      return;
    }

    const reds = rows.filter((r) => r.level === 'red');
    const yels = rows.filter((r) => r.level === 'yellow');

    renderList('red-list', reds, redSec);
    renderList('yellow-list', yels, yelSec);
  }

  function renderList(ulId, items, sectionEl) {
    const ul = $(ulId);
    ul.innerHTML = '';
    if (items.length === 0) return;
    sectionEl.classList.remove('hidden');
    for (const a of items) {
      const meta = S.stocksById.get(a.stock_id) || {};
      const lt = a.large_ratio_trend || [];
      const st = a.small_ratio_trend || [];
      const li = document.createElement('li');
      li.className = `alert-item ${a.level}`;
      li.innerHTML = `
        <div class="alert-head">
          <span class="stock-code">${a.stock_id}</span>
          <span class="stock-name">${escapeHtml(meta.name || '')}</span>
          <span class="stock-close">${Number(a.close).toFixed(2)}</span>
        </div>
        <div class="alert-body">
          <span class="kv"><b>大戶比</b> ${fmtArr(lt)}</span>
          <span class="kv"><b>散戶比</b> ${fmtArr(st)}</span>
        </div>
        ${meta.industry ? `<div class="alert-foot">${escapeHtml(meta.industry)}</div>` : ''}
      `;
      li.addEventListener('click', () => openDetail(a.stock_id, meta.name));
      ul.appendChild(li);
    }
  }

  function fmtArr(arr) {
    if (!arr || arr.length === 0) return '—';
    return arr.map((x) => Number(x).toFixed(1)).join(' → ');
  }

  // ============================================================
  // 詳情 modal
  // ============================================================
  async function openDetail(stockId, name) {
    const modal = $('detail-modal');
    const title = $('detail-title');
    const body = $('detail-body');
    title.textContent = `${stockId} ${name || ''}`;
    body.innerHTML = '<div class="loading">載入中…</div>';
    modal.classList.remove('hidden');

    const [holdings, prices] = await Promise.all([
      fetchJSON(`${REST}/st_holdings?stock_id=eq.${stockId}&select=week_end,large_ratio,small_ratio,total_holders&order=week_end.asc&limit=16`),
      fetchJSON(`${REST}/st_prices?stock_id=eq.${stockId}&select=week_end,close&order=week_end.asc&limit=16`),
    ]);

    body.innerHTML = `
      <div class="chart-block">
        <h3>持股比例 — 最近 ${holdings.length} 週</h3>
        <div class="chart-wrap"><canvas id="ratio-chart"></canvas></div>
      </div>
      <div class="chart-block">
        <h3>週收盤</h3>
        <div class="chart-wrap"><canvas id="price-chart"></canvas></div>
      </div>
      <div class="detail-meta">
        <div><b>本週股東總人數：</b> ${holdings.at(-1)?.total_holders?.toLocaleString() || '—'}</div>
        <div class="hint">資料來源：集保戶股權分散表（FinMind）</div>
      </div>
    `;

    destroyDetailCharts();
    S.detailCharts.push(Charts.ratioChart(
      $('ratio-chart'),
      holdings.map((h) => h.week_end.slice(5)),
      holdings.map((h) => Number(h.large_ratio)),
      holdings.map((h) => Number(h.small_ratio)),
    ));
    S.detailCharts.push(Charts.priceChart(
      $('price-chart'),
      prices.map((p) => p.week_end.slice(5)),
      prices.map((p) => Number(p.close)),
    ));
  }

  function closeDetail() {
    $('detail-modal').classList.add('hidden');
    destroyDetailCharts();
  }

  function destroyDetailCharts() {
    for (const c of S.detailCharts) {
      try { c.destroy(); } catch { /* noop */ }
    }
    S.detailCharts = [];
  }

  // ============================================================
  // Tab
  // ============================================================
  function switchTab(tab) {
    document.querySelectorAll('.tab').forEach((b) => {
      b.classList.toggle('active', b.dataset.tab === tab);
    });
    document.querySelectorAll('.tab-panel').forEach((p) => {
      p.classList.toggle('hidden', p.id !== `tab-${tab}`);
    });
    if (tab === 'watchlist') {
      $('watchlist-content').innerHTML = '<div class="empty"><p>觀察清單功能將在後續版本加入 🚧</p></div>';
    }
  }

  // ============================================================
  // utils
  // ============================================================
  async function fetchJSON(url) {
    if (DEMO) return mockFetch(url);
    const res = await fetch(url, { headers: REST_HEADERS });
    if (!res.ok) {
      console.error('fetch failed', url, res.status);
      return [];
    }
    return res.json();
  }

  // ---- demo 假資料（只在 ?demo=1 時觸發） ----
  function mockFetch(url) {
    const W = ['2026-04-24', '2026-05-01', '2026-05-08', '2026-05-15'];
    const STOCKS = [
      { stock_id: '2546', name: '根基', industry: '建材營造', capital: 1_200_000_000 },
      { stock_id: '3169', name: '亞信', industry: '通信網路', capital: 800_000_000 },
      { stock_id: '6116', name: '彩晶', industry: '光電', capital: 9_500_000_000 },
      { stock_id: '2342', name: '茂矽', industry: '半導體', capital: 4_700_000_000 },
      { stock_id: '1453', name: '大將', industry: '紡織纖維', capital: 320_000_000 },
    ];
    const ALERTS = [
      { stock_id: '2546', week_end: '2026-05-15', level: 'red',    close: 12.85, large_ratio_trend: [38.2, 39.1, 40.5, 42.3], small_ratio_trend: [18.4, 17.9, 17.2, 16.5], notes: '' },
      { stock_id: '3169', week_end: '2026-05-15', level: 'red',    close:  8.42, large_ratio_trend: [25.1, 26.8, 28.4, 30.2], small_ratio_trend: [22.1, 21.5, 20.8, 19.6], notes: '' },
      { stock_id: '6116', week_end: '2026-05-15', level: 'yellow', close:  6.18, large_ratio_trend: [44.2, 44.8, 44.6, 45.5], small_ratio_trend: [14.1, 13.8, 13.9, 13.3], notes: '' },
      { stock_id: '2342', week_end: '2026-05-15', level: 'yellow', close:  9.55, large_ratio_trend: [33.5, 34.1, 34.8, 35.0], small_ratio_trend: [19.8, 19.5, 19.6, 19.0], notes: '' },
    ];
    if (url.includes('st_alerts') && url.includes('select=week_end')) {
      return Promise.resolve(W.slice().reverse().map((w) => ({ week_end: w })));
    }
    if (url.includes('st_alerts') && url.includes('week_end=eq.')) {
      return Promise.resolve(ALERTS);
    }
    if (url.includes('st_stocks') && url.includes('stock_id=in.')) {
      return Promise.resolve(STOCKS);
    }
    if (url.includes('st_holdings')) {
      const sid = (url.match(/stock_id=eq\.(\d+)/) || [])[1] || '2546';
      const base = ALERTS.find((a) => a.stock_id === sid) || ALERTS[0];
      return Promise.resolve(W.map((w, i) => ({
        week_end: w,
        large_ratio: base.large_ratio_trend[i],
        small_ratio: base.small_ratio_trend[i],
        total_holders: 12345 + i * 30,
      })));
    }
    if (url.includes('st_prices')) {
      const sid = (url.match(/stock_id=eq\.(\d+)/) || [])[1] || '2546';
      const base = ALERTS.find((a) => a.stock_id === sid) || ALERTS[0];
      return Promise.resolve(W.map((w, i) => ({
        week_end: w,
        close: (base.close * (0.95 + i * 0.02)).toFixed(2),
      })));
    }
    return Promise.resolve([]);
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[c]));
  }

  history.scrollRestoration = 'manual';
  init();
})();
