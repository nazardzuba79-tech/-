/* Loopback-only browser test bootstrap. Never bundled into the product.
 * A controllable clock drives the actual production bundle, not a replica.
 * All account mutations remain the existing harness's in-memory fixtures.
 */
(() => {
  if (location.hostname !== '127.0.0.1') throw new Error('Fixture requires loopback');
  localStorage.setItem('exchange_token', location.pathname.startsWith('/admin') ? 'qa-user-admin' : 'qa-user-a');
  localStorage.setItem('exchange_language', 'ru');
  const nativeTimeout = window.setTimeout.bind(window);
  const nativeClear = window.clearTimeout.bind(window);
  let clock = Date.now(), id = 1000000, hidden = false, advancing = false;
  const timers = new Map(), hits = {}, errors = [], requests = new Set();
  Date.now = () => clock;
  Object.defineProperty(document, 'hidden', { configurable: true, get: () => hidden });
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => hidden ? 'hidden' : 'visible' });
  const schedule = (fn, ms, interval, args) => {
    if (ms < 1000 || ms > 3_600_000) return nativeTimeout(fn, ms, ...args);
    const key = ++id; timers.set(key, { fn, ms, interval, args, at: clock + ms }); return key;
  };
  window.setTimeout = (fn, ms = 0, ...args) => schedule(fn, ms, false, args);
  window.setInterval = (fn, ms = 0, ...args) => schedule(fn, ms, true, args);
  window.clearTimeout = window.clearInterval = key => { timers.delete(key); nativeClear(key); };
  const fetchOriginal = window.fetch.bind(window);
  window.fetch = (input, options) => {
    const url = new URL(typeof input === 'string' ? input : input.url, location.origin);
    if (url.origin !== location.origin) {
      if (url.pathname === '/v5/market/tickers') return Promise.resolve(new Response(JSON.stringify({ retCode: 0, time: clock, result: { category: 'linear', list: ['BTC','ETH','SOL','XRP','DOGE'].map((base, i) => ({ symbol: base+'USDT', lastPrice: String([104235,3980,214,2.43,0.38][i]), markPrice: String([104235,3980,214,2.43,0.38][i]), indexPrice: '104230', price24hPcnt: '0.012', highPrice24h: '106000', lowPrice24h: '102000', volume24h: '1000', turnover24h: '104235000', fundingRate: '0.00004', openInterest: '0' })) } }), { headers: { 'content-type':'application/json' } }));
      return Promise.reject(new Error('Fixture blocks external fetch'));
    }
    if (url.pathname.startsWith('/api/')) {
      const key = `${options?.method || 'GET'} ${url.pathname}`; hits[key] = (hits[key] || 0) + 1;
    }
    const request = fetchOriginal(input, options);
    requests.add(request);
    void request.finally(() => requests.delete(request)).catch(() => {});
    return request;
  };
  // The fixture uses HTTP snapshots; never contact a live exchange stream.
  window.WebSocket = class { static OPEN=1; static CLOSED=3; readyState=3; addEventListener(){} removeEventListener(){} send(){} close(){} };
  window.addEventListener('error', event => errors.push(event.message));
  window.addEventListener('unhandledrejection', event => errors.push(String(event.reason)));
  // MessageChannel lets React commit without background-tab timeout throttling.
  // Drain real loopback HTTP first: virtual time must not outrun an in-flight GET.
  const turn = () => new Promise(resolve => {
    const channel = new MessageChannel();
    channel.port1.onmessage = () => { channel.port1.close(); channel.port2.close(); resolve(); };
    channel.port2.postMessage(null);
  });
  const settle = async () => { await Promise.allSettled([...requests]); await turn(); await turn(); };
  async function advance(ms) {
    if (advancing) return;
    advancing = true; render();
    const end = clock + ms;
    for (;;) {
      const entry = [...timers].filter(([,t]) => t.at <= end).sort((a,b) => a[1].at-b[1].at)[0];
      if (!entry) break;
      const [key,t] = entry; clock = t.at;
      if (t.interval) t.at += t.ms; else timers.delete(key);
      t.fn(...t.args); await settle();
    }
    clock = end; await settle(); advancing = false; render();
  }
  let report;
  function render() { if (report) report.textContent = JSON.stringify({ hits, errors, hidden, advancing, scheduledTimers: timers.size, viewport: innerWidth, width: document.documentElement.scrollWidth }); }
  window.addEventListener('DOMContentLoaded', () => {
    const panel = document.createElement('aside'); panel.id = 'budget-qa';
    panel.style = 'position:fixed;bottom:0;left:0;z-index:99999;background:#fff;color:#111;max-width:100%;font:12px monospace;max-height:150px;overflow:auto';
    for (const [label, fn] of [['10 minutes', () => advance(599000)], ['1 hour', () => advance(3599000)], ['Hide / show', () => { hidden=!hidden; document.dispatchEvent(new Event('visibilitychange')); render(); }], ['Read counters', render]]) {
      const button=document.createElement('button'); button.textContent=label; button.onclick=fn; button.style='padding:6px;border:1px solid #555'; panel.append(button);
    }
    report=document.createElement('pre'); report.style='white-space:pre-wrap;overflow-wrap:anywhere'; panel.append(report); document.body.append(panel); render();
  });
})();
