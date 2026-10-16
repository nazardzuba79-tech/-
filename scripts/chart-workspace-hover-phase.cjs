'use strict';

// QA only. Neither helper is included in a frontend bundle. Keep the browser
// installers self-contained: Playwright/bootstrap serializes their source.
function installCandleFetchObserver(w) {
  const nativeFetch = w.fetch.bind(w);
  w.fetch = function (input, options) {
    const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url, w.location.origin);
    const nativeUrl = url.origin === 'https://market.voltextech.net'
      ? new URL('/api/v1' + url.pathname + url.search, w.location.origin).href : url.href;
    const signal = options?.signal ?? input?.signal;
    const row = { url: url.pathname + url.search, originalUrl: url.href, nativeUrl,
      at: w.performance.now(), state: 'pending', hasSignal: !!signal, abortedAtStart: signal?.aborted ?? false };
    if (signal?.aborted) row.abortedAt = row.at;
    else signal?.addEventListener('abort', () => { row.abortedAt = w.performance.now(); }, { once: true });
    // A later abort is evidence only, not a response-state rewrite: a signal
    // can abort after headers/body success during controller cleanup.
    w.__qa.fetches.push(row);
    let result;
    try {
      result = url.origin === 'https://market.voltextech.net'
        ? nativeFetch('/api/v1' + url.pathname + url.search, options)
        : url.origin !== w.location.origin
          ? Promise.reject(new Error('External network blocked in fixture')) : nativeFetch(input, options);
    } catch (error) {
      row.state = 'rejected'; row.error = error?.name ?? typeof error; row.finishedAt = w.performance.now(); throw error;
    }
    // Return the observed chain. A detached rejection observer would mark an
    // ignored native fetch as handled and suppress its unhandled-rejection
    // signal. Preserve the exact response/error for the caller; ignored errors
    // must remain observable. CDP loadingFinished separately proves body EOF.
    return result.then(response => {
      row.state = 'fulfilled'; row.status = response.status; row.finishedAt = w.performance.now();
      return response;
    }, error => {
      row.state = 'rejected'; row.error = error?.name ?? typeof error; row.finishedAt = w.performance.now();
      throw error;
    });
  };
}

function dataWindowReady(doc = document) {
  const panel = doc.querySelector('[data-cw-data-window]');
  if (!panel) return false;
  const box = panel.getBoundingClientRect(), style = doc.defaultView.getComputedStyle(panel);
  // Before the first hover this panel intentionally contains only a prompt.
  // Rows/UTC belong to the original assertion AFTER all 20 pointer moves.
  return box.width > 0 && box.height > 0 && style.display !== 'none' && style.visibility !== 'hidden' &&
    !!doc.querySelector('[data-chart-state="candles"]') && !doc.querySelector('[data-chart-state][data-cw-compare]');
}

function installCandleTimerObserver(w) {
  const evidence = w.__qaCandleTimers = { timers: [], overflow: false };
  const nativeSet = w.setInterval.bind(w), nativeClear = w.clearInterval.bind(w);
  w.setInterval = function (callback, delay, ...args) {
    if (typeof callback !== 'function' || Number(delay) !== 5000) return nativeSet(callback, delay, ...args);
    if (evidence.timers.length >= 256) { evidence.overflow = true; return nativeSet(callback, delay, ...args); }
    const timer = { id: evidence.timers.length + 1, delay: 5000, scheduledAt: w.performance.now(),
      stack: new Error().stack, active: true, fires: [] };
    const handle = nativeSet(function (...params) {
      if (timer.fires.length < 256) timer.fires.push({ tick: timer.fires.length + 1, at: w.performance.now() });
      else evidence.overflow = true;
      return callback.apply(this, params);
    }, delay, ...args);
    timer.handle = handle; evidence.timers.push(timer);
    return handle;
  };
  w.clearInterval = function (handle) {
    const timer = evidence.timers.find(item => item.handle === handle && item.active);
    if (timer) { timer.active = false; timer.clearedAt = w.performance.now(); }
    return nativeClear(handle);
  };
}

function fault(code, detail) {
  const error = new Error(code); error.code = code; error.detail = detail; return error;
}

function applicationSites(stack) {
  return String(stack).split('\n').flatMap(line => {
    const match = line.match(/(https?:\/\/[^\s)]+\/assets\/[^\s)]+):(\d+):(\d+)\)?$/);
    return match ? [`${match[1]}:${match[2]}:${match[3]}`] : [];
  });
}

function intervalSites(initiator) {
  for (let stack = initiator?.stack; stack; stack = stack.parent) {
    if (stack.description === 'setInterval') {
      return (stack.callFrames || []).filter(frame => /\/assets\//.test(frame.url))
        .map(frame => `${frame.url}:${frame.lineNumber + 1}:${frame.columnNumber + 1}`);
    }
  }
  return [];
}

function selectRefreshPhase(snapshot, request, readyAt) {
  if (snapshot.timers.overflow) throw fault('CANDLE_PHASE_EVIDENCE_OVERFLOW');
  const fetch = snapshot.fetches.find(row => row.at > readyAt && row.nativeUrl === request.url);
  if (!fetch || fetch.state !== 'fulfilled' || fetch.status < 200 || fetch.status >= 300 ||
      request.failed || !request.finished || request.status < 200 || request.status >= 300) {
    throw fault('CANDLE_PHASE_REFRESH_FAILED', { fetch, request });
  }
  const sites = intervalSites(request.initiator);
  const matches = snapshot.timers.timers.filter(timer => {
    const registered = applicationSites(timer.stack).slice(0, 3);
    return timer.active && registered.length === 3 && registered.every((site, i) => site === sites[i]);
  });
  if (matches.length !== 1) throw fault('CANDLE_PHASE_TIMER_AMBIGUOUS', { matches: matches.length, sites });
  const timer = matches[0];
  const fire = timer.fires.filter(item => item.at > readyAt && item.at <= fetch.at).at(-1);
  if (!fire) throw fault('CANDLE_PHASE_NOT_A_NEW_POLL');
  // Use the original interval epoch, not response completion or the last
  // delayed callback: neither resets the next scheduled poll.
  const deadline = timer.scheduledAt + (fire.tick + 1) * timer.delay;
  if (snapshot.at + 400 >= deadline) throw fault('CANDLE_PHASE_EXPIRED', { at: snapshot.at, deadline });
  return { timerId: timer.id, fire, deadline, requestId: request.id, fetch, sites,
    readyAt, startedAt: snapshot.at, counter: snapshot.fetches.length };
}

function hoverVerdict({ phase, before, after, finishedAt, pending, timer }) {
  const reasons = [];
  if (after !== before) reasons.push('CANDLE_FETCH_DURING_HOVER');
  if (finishedAt >= phase.deadline) reasons.push('CANDLE_PHASE_EXPIRED');
  if (pending !== 0) reasons.push('CANDLE_REQUEST_STILL_PENDING');
  if (!timer?.active || timer.fires.length !== phase.fire.tick) reasons.push('CANDLE_POLL_PHASE_CHANGED');
  return { ok: reasons.length === 0, reasons, requestsDuringHover: after - before,
    finishedAt, deadline: phase.deadline, pending };
}

function latestPrimaryTail(fetches, market) {
  const pathname = `/api/v1/market/${market === 'futures' ? 'futures' : 'external'}/candles/BTC-USDT`;
  return fetches.filter(row => {
    const url = new URL(row.nativeUrl);
    // Actual tail endpoints use interval/limit only. Futures history uses
    // endTime (and its fallback uses end). Reject any pagination/unknown key;
    // this selects a poll identity, never filters the measured fetch counter.
    return url.pathname === pathname && url.searchParams.has('interval') &&
      [...url.searchParams.keys()].every(key => key === 'interval' || key === 'limit');
  }).at(-1);
}

async function attachCandlePhase(page) {
  await page.addInitScript({ content: `(${installCandleTimerObserver.toString()})(window);` });
  const session = await page.context().newCDPSession(page);
  await session.send('Network.enable'); await session.send('Debugger.enable');
  await session.send('Debugger.setAsyncCallStackDepth', { maxDepth: 32 });
  const requests = [], pageRequests = [], listeners = new Set();
  let overflow = false;
  const notify = () => { for (const listener of listeners) listener(); };
  page.on('request', request => {
    if (!/candles/.test(request.url())) return;
    if (pageRequests.length >= 5000) { overflow = true; notify(); return; }
    pageRequests.push({ url: request.url(), resourceType: request.resourceType(), method: request.method(), nodeAt: performance.now() });
  });
  session.on('Network.requestWillBeSent', event => {
    if (!/candles/.test(event.request.url)) return;
    if (requests.length >= 5000) { overflow = true; notify(); return; }
    requests.push({ id: event.requestId, url: event.request.url, method: event.request.method,
      resourceType: event.type, wallTime: event.wallTime, timestamp: event.timestamp, initiator: event.initiator }); notify();
  });
  session.on('Network.responseReceived', event => {
    const row = requests.find(item => item.id === event.requestId);
    if (row) { row.status = event.response.status; notify(); }
  });
  session.on('Network.loadingFinished', event => {
    const row = requests.find(item => item.id === event.requestId);
    if (row) { row.finished = true; row.finishedAt = event.timestamp; notify(); }
  });
  session.on('Network.loadingFailed', event => {
    const row = requests.find(item => item.id === event.requestId);
    if (row) { row.failed = event.errorText; notify(); }
  });
  const snapshot = () => page.evaluate(() => ({ at: performance.now(), epoch: performance.timeOrigin + performance.now(),
    fetches: window.__qa.fetches.filter(row => /candles/.test(row.url)), timers: window.__qaCandleTimers }));
  return {
    async nextPrimaryRefresh(market) {
      const ready = await snapshot();
      const nativePath = `/api/v1/market/${market === 'futures' ? 'futures' : 'external'}/candles/BTC-USDT`;
      const current = latestPrimaryTail(ready.fetches, market);
      if (!current) throw fault('CANDLE_PHASE_PRIMARY_MISSING', { nativePath });
      const candidateUrl = current.nativeUrl;
      let evidence = null;
      const phase = await new Promise((resolve, reject) => {
        let done = false, running = false, again = false, candidate;
        const finish = (error, value) => {
          if (done) return; done = true; clearTimeout(timeout); listeners.delete(wake);
          error ? reject(error) : resolve(value);
        };
        const timeout = setTimeout(() => finish(fault('CANDLE_PHASE_READINESS_TIMEOUT', { candidate, evidence })), 17000);
        const wake = () => {
          again = true; if (running || done) return; running = true;
          void (async () => {
            while (again && !done) {
              again = false;
              if (overflow) throw fault('CANDLE_PHASE_EVIDENCE_OVERFLOW');
              candidate ||= requests.find(row => row.method === 'GET' && row.url === candidateUrl && row.wallTime * 1000 > ready.epoch);
              if (!candidate) continue;
              if (candidate.failed || (candidate.status && (candidate.status < 200 || candidate.status >= 300))) {
                throw fault('CANDLE_PHASE_REFRESH_FAILED', candidate);
              }
              if (!candidate.finished) continue;
              evidence = await snapshot();
              const selected = selectRefreshPhase(evidence, candidate, ready.at);
              const pending = evidence.fetches.some(row => row.state === 'pending') || requests.some(row => !row.finished && !row.failed);
              if (!pending) finish(null, selected);
            }
          })().catch(error => finish(error)).finally(() => { running = false; if (again && !done) wake(); });
        };
        listeners.add(wake); wake();
      });
      return { phase, ready, evidence, requests: requests.map(row => ({ ...row })) };
    },
    async finish(phase, before, after) {
      if (overflow) throw fault('CANDLE_PHASE_EVIDENCE_OVERFLOW');
      const end = await snapshot();
      const pending = end.fetches.filter(row => row.state === 'pending').length + requests.filter(row => !row.finished && !row.failed).length;
      return { verdict: hoverVerdict({ phase, before, after, finishedAt: end.at, pending,
        timer: end.timers.timers.find(timer => timer.id === phase.timerId) }), end,
        requests: requests.map(row => ({ ...row })) };
    },
    snapshot,
    async capture() { return { page: await snapshot(), requests: requests.map(row => ({ ...row })), pageRequests, overflow }; },
  };
}

module.exports = { installCandleFetchObserver, installCandleTimerObserver, applicationSites,
  intervalSites, selectRefreshPhase, hoverVerdict, attachCandlePhase, dataWindowReady, latestPrimaryTail };
