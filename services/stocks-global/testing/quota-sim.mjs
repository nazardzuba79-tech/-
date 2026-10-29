// #613 R9: the gateway's private-quota behaviour in simulated time. The real authority adapter
// (authority-adapter.mjs, injected clock and timers) against a model of the private ingress
// (stocksAuthorityIngress.ts: express-rate-limit, one fixed 60 s window per client that starts at the first request
// after the previous one ended, refused requests counted too, RateLimit-* and Retry-After headers) and of the
// authority (identity batches answered for every bearer, commands answered with their actor). The load is the 50+2
// Stocks jobs of driver.cjs: 50 viewers whose state reads each need a live identity check, every second; 2 traders
// with the 4 s order cycle of seven commands, each awaited, a refused one sent again after Retry-After and the
// cycles that fall into the wait skipped, as sustained mode does. Nothing here opens a socket or touches a clock.
import { createAuthorityAdapter } from '../authority-adapter.mjs';
import { accountId } from '../accounts.mjs';

const ISSUER = 'quota-sim', KEY = 'synthetic-quota-sim-capability-000000000';
export function virtualTime() {
  let now = 0, seq = 0; const queue = [];
  const add = (fn, ms, kind) => { const t = { at: now + Math.max(kind === 'immediate' ? 0 : 1, ms), seq: seq++, fn, cancelled: false }; queue.push(t); return t; };
  const cancel = t => { if (t) t.cancelled = true; };
  const timers = { setTimeout: (fn, ms = 0) => add(fn, ms, 'timeout'), clearTimeout: cancel, setImmediate: fn => add(fn, 0, 'immediate'), clearImmediate: cancel };
  const settle = async () => { for (let i = 0; i < 4; i++) await new Promise(resolve => setImmediate(resolve)); };
  async function runUntil(end) {
    for (;;) {
      let next = -1;
      for (let i = 0; i < queue.length; i++) if (!queue[i].cancelled && (next < 0 || queue[i].at < queue[next].at || queue[i].at === queue[next].at && queue[i].seq < queue[next].seq)) next = i;
      if (next < 0 || queue[next].at > end) { now = end; await settle(); return; }
      const [t] = queue.splice(next, 1); now = t.at; t.fn(); await settle();
      if (queue.length > 4096) for (let i = queue.length - 1; i >= 0; i--) if (queue[i].cancelled) queue.splice(i, 1);
    }
  }
  return { clock: { now: () => now }, timers, runUntil, now: () => now };
}

// The private ingress and authority. latency: virtual ms until an answer.
export function ingressModel(vt, { limit = 240, windowMs = 60000, latency = { identities: 6, command: 12 } } = {}) {
  let resetAt = -1, hits = 0;
  const revoked = new Set(); // bearer tokens whose session was signed out
  const log = [];
  const json = (status, body, headers) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });
  const fetchImpl = (url, options) => new Promise(resolve => {
    const route = url.endsWith('/identities') ? 'identities' : 'command', at = vt.now();
    if (resetAt <= at) { resetAt = at + windowMs; hits = 0; }
    hits++;
    const headers = { 'RateLimit-Limit': String(limit), 'RateLimit-Remaining': String(Math.max(0, limit - hits)), 'RateLimit-Reset': String(Math.max(0, Math.ceil((resetAt - at) / 1000))) };
    const refused = hits > limit; log.push({ at, route, status: refused ? 429 : 200, windowEnd: resetAt, hits });
    vt.timers.setTimeout(() => {
      if (refused) return resolve(json(429, { error: 'AUTH_RATE_LIMIT' }, { ...headers, 'Retry-After': headers['RateLimit-Reset'] }));
      const body = JSON.parse(options.body);
      if (route === 'identities') return resolve(json(200, { results: body.tokens.map(token => revoked.has(token) ? { error: 'AUTH_REQUIRED' } : { issuer: ISSUER, subject: 'subject-' + token.slice(0, 12) }) }, headers));
      if (revoked.has(options.headers.Authorization.slice(7))) return resolve(json(401, { error: 'AUTH_REQUIRED' }, headers));
      const subject = 'subject-' + options.headers.Authorization.slice(7, 19);
      resolve(json(200, { value: { id: accountId({ issuer: ISSUER, subject }) }, actor: { issuer: ISSUER, subject } }, headers));
    }, latency[route]);
  });
  return { fetchImpl, log, revoke: token => revoked.add(token) };
}

const token = (kind, n) => (kind + String(n).padStart(4, '0')).repeat(4);
const percentile = (list, p) => { const s = [...list].sort((a, b) => a - b); return s.length ? s[Math.min(s.length - 1, Math.ceil(p * s.length) - 1)] : null; };

// Runs the 50+2 load for durationMs after a warm-up of each viewer once (as api-worker.cjs) and reports per minute.
export async function simulate({ debug = false, revokeAt = null, durationMs = 180000, viewers = 50, traders = 2, viewerPeriodMs = 1000, traderCycleMs = 4000, commandsPerCycle = 7 } = {}) {
  const vt = virtualTime(), ingress = ingressModel(vt);
  const adapter = createAuthorityAdapter({ endpoint: 'http://127.0.0.1:1/api/v1/stocks-test-cash', issuer: ISSUER, gatewayKey: KEY, fetchImpl: ingress.fetchImpl, clock: vt.clock, timers: vt.timers });
  const viewerResults = [], traderResults = [];
  let inflight = 0, maxInflight = 0;
  const identify = (authorization) => adapter.runWithRequest({ headers: { authorization } }, () => adapter.authenticate(undefined, {}));
  // Viewers: open-loop polls; a 429 defers the viewer's next polls until Retry-After (the terminal's pause).
  const viewerState = Array.from({ length: viewers }, () => ({ pausedUntil: 0 }));
  const poll = (i, scheduledAt) => {
    const v = viewerState[i];
    if (vt.now() < v.pausedUntil) { viewerResults.push({ viewer: i, at: scheduledAt, outcome: 'deferred' }); return; }
    inflight++; maxInflight = Math.max(maxInflight, inflight);
    identify('Bearer ' + token('v', i)).then(() => ({ outcome: 'answered' }), error => ({ outcome: error.code, retryAfterMs: error.retryAfterMs })).then(r => {
      inflight--;
      if (r.outcome === 'AUTH_RATE_LIMIT') v.pausedUntil = vt.now() + (r.retryAfterMs ?? 60000);
      viewerResults.push({ viewer: i, at: scheduledAt, outcome: r.outcome, ms: vt.now() - scheduledAt, retryAfterMs: r.retryAfterMs });
    });
  };
  // Advances simulated time until the promise settles.
  const drive = async promise => { let done = false; promise.then(() => { done = true; }, () => { done = true; }); while (!done) await vt.runUntil(vt.now() + 10); return promise; };
  // A trader request as the gateway runs it: a remembered bearer starts without a separate identity check
  // (authenticate deferred), the gateway lets it trade (remember), its command confirms it.
  const traderRequest = (i, fn) => adapter.runWithRequest({ headers: { authorization: 'Bearer ' + token('t', i) } }, async () => {
    await adapter.authenticate(undefined, { deferred: true }); adapter.remember(); return fn(); });
  const stores = [];
  for (let i = 0; i < traders; i++) stores.push(await drive(traderRequest(i, () => adapter.forPrincipal({ issuer: ISSUER, subject: 'subject-' + token('t', i).slice(0, 12) }, { existingOnly: true }))));
  const traderState = Array.from({ length: traders }, () => ({ busyUntil: 0, running: false, skipped: 0 }));
  const command = async (i, n) => {
    for (;;) {
      const at = vt.now();
      try { await traderRequest(i, () => stores[i].execute('read')); traderResults.push({ at, trader: i, n, outcome: 'ok', ms: vt.now() - at }); return; }
      catch (error) {
        traderResults.push({ at, trader: i, n, outcome: error.code, retryAfterMs: error.retryAfterMs });
        if (error.code !== 'AUTH_RATE_LIMIT') return;
        await new Promise(resolve => vt.timers.setTimeout(resolve, error.retryAfterMs ?? 60000));
      }
    }
  };
  const cycle = async i => {
    const t = traderState[i]; if (t.running) { t.skipped++; return; }
    t.running = true; try { for (let n = 0; n < commandsPerCycle; n++) await command(i, n); } finally { t.running = false; }
  };
  // Warm-up: each viewer once, sequentially, then the measured window starts on the next whole second.
  for (let i = 0; i < viewers; i++) await drive(identify('Bearer ' + token('v', i)).catch(() => {}));
  const start = Math.ceil((vt.now() + 1000) / 1000) * 1000, end = start + durationMs;
  for (let i = 0; i < viewers; i++) for (let at = start + i * 20; at < end; at += viewerPeriodMs) { const scheduled = at; vt.timers.setTimeout(() => poll(i, scheduled), at - vt.now()); }
  for (let i = 0; i < traders; i++) for (let at = start + 500 + i * 2000; at < end; at += traderCycleMs) vt.timers.setTimeout(() => void cycle(i), at - vt.now());
  if (revokeAt !== null) vt.timers.setTimeout(() => { ingress.revoke(token('v', 0)); if (traders > 1) ingress.revoke(token('t', 1)); }, start + revokeAt - vt.now());
  await vt.runUntil(end + 5000);
  await adapter.close();
  const minutes = Math.ceil(durationMs / 60000), perMinute = [];
  for (let m = 0; m < minutes; m++) {
    const from = start + m * 60000, to = from + 60000, inside = x => x.at >= from && x.at < to;
    const views = viewerResults.filter(inside), sends = ingress.log.filter(inside);
    perMinute.push({ minute: m + 1, identityBatches: sends.filter(x => x.route === 'identities').length, commands: sends.filter(x => x.route === 'command').length,
      ingress429: sends.filter(x => x.status === 429).length, viewerScheduled: views.length, viewerAnswered: views.filter(x => x.outcome === 'answered').length,
      viewerAnsweredP95Ms: percentile(views.filter(x => x.outcome === 'answered').map(x => x.ms), 0.95), traderRefused: traderResults.filter(inside).filter(x => x.outcome === 'AUTH_RATE_LIMIT').length });
  }
  const gaps = []; for (let i = 0; i < viewers; i++) { const answered = viewerResults.filter(x => x.viewer === i && x.outcome === 'answered').map(x => x.at).sort((a, b) => a - b); let gap = answered.length ? answered[0] - start : durationMs; for (let k = 1; k < answered.length; k++) gap = Math.max(gap, answered[k] - answered[k - 1]); gaps.push(gap); }
  const outcomes = viewerResults.reduce((m, x) => (m[x.outcome] = (m[x.outcome] ?? 0) + 1, m), {});
  let busiest = 0; { const t = ingress.log.map(x => x.at).sort((a, b) => a - b); for (let i = 0, j = 0; i < t.length; i++) { while (t[i] - t[j] >= 60000) j++; busiest = Math.max(busiest, i - j + 1); } }
  return { ...(debug ? { start, viewerTimeline: viewerResults.map(x => ({ ...x, at: x.at - start })), ingressLog: ingress.log } : {}), perMinute, viewerOutcomes: outcomes, viewerAnsweredShare: (outcomes.answered ?? 0) / viewerResults.length, maxConcurrentViewerReads: maxInflight,
    traderCommands: traderResults.filter(x => x.outcome === 'ok').length, traderRefused: traderResults.filter(x => x.outcome === 'AUTH_RATE_LIMIT').length,
    traderOtherErrors: traderResults.filter(x => !['ok', 'AUTH_RATE_LIMIT'].includes(x.outcome)).length, traderCyclesSkipped: traderState.reduce((s, t) => s + t.skipped, 0),
    ingress429: ingress.log.filter(x => x.status === 429).length, ingress429Routes: ingress.log.filter(x => x.status === 429).reduce((m, x) => (m[x.route] = (m[x.route] ?? 0) + 1, m), {}),
    busiestSlidingMinute: busiest, viewerMaxGapMs: Math.max(...gaps), viewerMaxGapMsExceptRevoked: Math.max(...gaps.slice(1)),
    viewer429WithoutRetryAfter: viewerResults.filter(x => x.outcome === 'AUTH_RATE_LIMIT' && !(x.retryAfterMs >= 1000 && x.retryAfterMs <= 60000)).length,
    traderOutcomes: traderResults.reduce((m, x) => (m[x.outcome] = (m[x.outcome] ?? 0) + 1, m), {}), viewerOutcomesByViewer0: viewerResults.filter(x => x.viewer === 0).reduce((m, x) => (m[x.outcome] = (m[x.outcome] ?? 0) + 1, m), {}), viewerRetryAfterMaxMs: Math.max(0, ...viewerResults.filter(x => x.retryAfterMs).map(x => x.retryAfterMs)) };
}
