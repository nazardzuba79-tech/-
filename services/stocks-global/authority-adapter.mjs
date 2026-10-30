import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';
import { accountId } from './accounts.mjs';
import { check, SimError } from './engine.mjs';

// One identity batch (src/api/routes/stocksTestCash.ts accepts up to 64 bearers, 64 KiB): at Q/160
// batches per second that carries 96 requests per second at the default quota.
const IDENTITY_BATCH_MAX = 64, IDENTITY_BATCH_BYTES = 60 * 1024, IDENTITY_TIMEOUT_MS = 3000;
// A batch answers every request in it as late as its oldest one plus the authority's answer time: a request is only
// kept waiting for a batch that goes at least this long before its deadline.
const IDENTITY_SEND_MARGIN_MS = 500;
// Fairness under the traders' priority: while the ingress's window has room at all, waiting viewers get a batch at
// least this often, even when the traders' projected commands would take that room (at most Q/16 of a window at the
// default quota). A command that then finds the window full is refused before it is sent, with Retry-After.
const IDENTITY_MAX_SPACING_MS = 4000;
// How far ahead the traders' commands keep their room in the ingress's window (see identitySlot).
const COMMAND_HORIZON_MS = 5000;
// The private ingress quota (stocksAuthorityIngress.ts: 120..240 per minute, default 240). Each private
// response announces it in RateLimit-Limit; the identity budget follows the announced value.
const INGRESS_QUOTA_DEFAULT = 240, INGRESS_QUOTA_MIN = 120, INGRESS_QUOTA_MAX = 240;
// A trader bearer the authority confirmed live is remembered this long (refreshed by every live answer)
// for at most this many bearers; see "Trader requests" below.
const TRADER_BEARER_MS = 60000, TRADER_BEARERS_MAX = 16;

// Credentials belong to the immutable HTTP request context, not the shared
// per-principal quote context or a cached account handle (two tabs may differ).
// clock and timers exist for the simulated-time quota tests (quota-sim.test.mjs); the release passes neither.
export function createAuthorityAdapter({ endpoint, issuer, gatewayKey, fetchImpl = fetch, clock = performance, timers = globalThis } = {}) {
  const base = new URL(endpoint);
  check((base.protocol === 'https:' || base.protocol === 'http:' && base.hostname === '127.0.0.1') && !base.username && !base.password && !base.search && !base.hash && base.pathname.endsWith('/api/v1/stocks-test-cash'), 'AUTH_CONFIG_INVALID');
  check(typeof issuer === 'string' && issuer.length > 0 && typeof gatewayKey === 'string' && gatewayKey.length >= 32, 'AUTH_CONFIG_INVALID');
  const requests = new AsyncLocalStorage(), inFlight = new Set(); let closed = false, lastMetrics = null;
  const counters = { requests: 0, failures: 0, mutations: 0, identityBatches: 0, identityChecks: 0 };
  let quota = INGRESS_QUOTA_DEFAULT;
  // The ingress's fixed window as its own answers announce it (express-rate-limit: RateLimit-Remaining, and
  // RateLimit-Reset in whole seconds, rounded up): what was left after private request number announcedSeq and when
  // the window ends. The gateway is the ingress's only client, so every request it sent after that one counts against
  // the same window; once the window has ended, every request sent since counts against the next one.
  let sendSeq = 0, announcedSeq = -1, windowLeft = null, windowEnd = -Infinity;
  const observeQuota = (response, seq) => {
    const headers = response?.headers, limit = Number(headers?.get?.('ratelimit-limit'));
    if (Number.isInteger(limit) && limit >= INGRESS_QUOTA_MIN && limit <= INGRESS_QUOTA_MAX) quota = limit;
    const left = headers?.get?.('ratelimit-remaining'), reset = headers?.get?.('ratelimit-reset');
    if (seq > announcedSeq && /^\d{1,3}$/.test(left ?? '') && /^\d{1,2}$/.test(reset ?? '') && Number(reset) <= 60) {
      announcedSeq = seq; windowLeft = Number(left); windowEnd = clock.now() + Number(reset) * 1000;
    }
  };
  // Requests the ingress's current window can still take; null until an answer announced the window.
  const windowRoom = at => windowLeft === null ? null : at < windowEnd ? windowLeft - (sendSeq - 1 - announcedSeq) : quota - sentSince(windowEnd);
  // Traders' commands have priority over identity batches. A burst (a page load, a short test) keeps their room for
  // the next COMMAND_HORIZON_MS at the pace of the last 15 s. Sustained trading (commands for a minute without a 30 s
  // pause) keeps their room until the window ends at the pace of the last minute.
  const commandTimes = []; let streakSince = null, lastCommandAt = -Infinity;
  const noteCommand = at => { if (at - lastCommandAt > 30000) streakSince = at; lastCommandAt = at; commandTimes.push(at); };
  const commandPace = at => {
    while (commandTimes.length && at - commandTimes[0] >= 60000) commandTimes.shift();
    if (streakSince !== null && at - lastCommandAt <= 30000 && at - streakSince >= 60000) return { sustained: true, ahead: commandTimes.length / 60000 * (at < windowEnd ? windowEnd - at : 60000) };
    let recent = 0; for (let i = commandTimes.length - 1; i >= 0 && at - commandTimes[i] < 15000; i--) recent++;
    return { sustained: false, ahead: recent * COMMAND_HORIZON_MS / 15000 };
  };
  async function transport(path, { body, signal } = {}) {
    check(!closed, 'ACCOUNT_UNAVAILABLE');
    const ctx = requests.getStore(); check(ctx && /^Bearer [A-Za-z0-9._~-]{16,4096}$/.test(ctx.authorization ?? ''), 'AUTH_REQUIRED');
    const encoded = body === undefined ? undefined : JSON.stringify(body); check(encoded === undefined || Buffer.byteLength(encoded) <= 8192, 'ACCOUNT_COMMAND_INVALID');
    // A request the ingress's window cannot take is not sent: the gateway answers the ingress's own 429 with the time
    // until the window ends. Within the window's last second it waits for the next window instead.
    for (let room = windowRoom(clock.now()); room !== null && room < 1; room = windowRoom(clock.now())) {
      const left = windowEnd - clock.now();
      if (left > 1000) throw Object.assign(new SimError('AUTH_RATE_LIMIT'), { retryAfterMs: Math.min(60000, Math.ceil(left / 1000) * 1000) });
      await new Promise(resolve => timers.setTimeout(resolve, Math.max(1, left + 1)));
      check(!closed && !signal?.aborted, encoded === undefined ? 'AUTH_UNAVAILABLE' : 'ACCOUNT_UNAVAILABLE');
    }
    const controller = new AbortController(), timer = timers.setTimeout(() => controller.abort(), 3000);
    const abort = () => controller.abort(); signal?.addEventListener('abort', abort, { once: true }); if (signal?.aborted) abort();
    let response;
    try {
      counters.requests++; const seq = spend(clock.now()); noteCommand(clock.now());
      response = await fetchImpl(base.href + '/' + path, { method: encoded === undefined ? 'GET' : 'POST', redirect: 'error', headers: { Authorization: ctx.authorization, Accept: 'application/json', 'X-Stocks-Authority-Key': gatewayKey, ...(encoded === undefined ? {} : { 'Content-Type': 'application/json' }) }, body: encoded, signal: controller.signal });
      observeQuota(response, seq);
      // A proxy/limiter may return text. Classify rejection before parsing its
      // body; never retry a command, including a known rate-limit rejection.
      if (!response.ok) {
        if ([401,403].includes(response.status)) throw new SimError('AUTH_REQUIRED');
        if (response.status === 429) {
          const value = response.headers.get('retry-after');
          const seconds = /^\d{1,6}$/.test(value ?? '') ? Math.max(1, Math.min(60, Number(value))) : 60;
          throw Object.assign(new SimError('AUTH_RATE_LIMIT'), { retryAfterMs: seconds * 1000 });
        }
      }
      const chunks = []; let size = 0;
      for await (const chunk of response.body) { size += chunk.byteLength; check(size <= 8 * 1024 * 1024, 'ACCOUNT_RESPONSE_TOO_LARGE'); chunks.push(Buffer.from(chunk)); }
      const result = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      if (!response.ok) {
        throw new SimError(typeof result.error === 'string' && /^[A-Z_]+$/.test(result.error) ? result.error : 'ACCOUNT_UNAVAILABLE');
      }
      return result;
    } catch (error) {
      counters.failures++;
      if (error instanceof SimError) throw error;
      throw new SimError(encoded === undefined ? 'AUTH_UNAVAILABLE' : 'ACCOUNT_OUTCOME_UNKNOWN');
    } finally { timers.clearTimeout(timer); signal?.removeEventListener('abort', abort); if (controller.signal.aborted || response && !response.ok) { try { await response?.body?.cancel(); } catch {} } }
  }
  // Identity checks of concurrent gateway requests travel together (multiplexing, not
  // caching). A request only ever joins a batch that has not been sent yet, so its bearer
  // is checked live by the authority (POST identities: the same requireAuth judgement and actor
  // binding as GET identity) after the request arrived; no result outlives its batch.
  // Token bucket sized from the private quota Q: Q/160 batches per second (3/8 of Q per minute) and
  // bursts of Q/4, so identity checks take at most 5/8 of Q in any minute (150 of 240, 75 of 120). The
  // burst lets a quiet gateway answer a run of sequential requests (a page load, a restart: the 50+2
  // warm-up's 50 viewer reads) at once; under sustained load the rate holds. Traders' requests no longer
  // need identity batches (see "Trader requests"), so the burst is smaller than the 3Q/8 it was. On top of
  // that the gateway counts every private request it sends (it is the ingress's only client), commands
  // included: a batch never takes the last minute past Q - Q/16 (225 of 240). That alone did not keep the
  // traders' room: commands sent after a batch still went over the ingress's window (CI sustained run of #613
  // R8), so once the ingress has announced its window the batches are judged against it (identitySlot) and a
  // request the window cannot take is not sent at all (transport).
  // A batch's answers are handed back with the spacing in which their requests arrived (each request
  // waits as long as the oldest one in its batch), so the work behind them keeps the arrival pattern
  // instead of starting together: a released burst would queue the crypto requests on the same CPUs.
  // One deadline timer for every waiting request and one release timer per batch, not one of each per
  // request: those per-request timers were about a third of the gateway's own work under 50 viewers.
  const ratePerSecond = () => quota / 160, burst = () => quota / 4, ceiling = () => Math.floor(quota - quota / 16);
  const sent = [], pending = [], waiting = [], batchAborts = new Set(), releasers = new Set();
  let pumpTimer = null, sweepTimer = null, budget = burst(), refilledAt = clock.now();
  const refill = () => { const at = clock.now(); budget = Math.min(burst(), budget + (at - refilledAt) * ratePerSecond() / 1000); refilledAt = at; };
  const spend = at => { sent.push(at); return sendSeq++; };
  const sentSince = from => { let n = 0; for (let i = sent.length - 1; i >= 0 && sent[i] >= from; i--) n++; return n; };
  const recent = at => { while (sent.length && at - sent[0] >= 60000) sent.shift(); return sent.length; };
  const settle = (item, error, value) => {
    if (item.done) return; item.done = true; item.signal?.removeEventListener('abort', item.abort);
    if (error) item.reject(error); else item.resolve(value);
  };
  // Every waiting request in arrival order; its deadline covers the wait for a send slot and the batch.
  const sweep = () => {
    sweepTimer = null; const at = clock.now();
    while (pending.length && (pending[0].done || pending[0].deadlineAt <= at)) settle(pending.shift(), new SimError('AUTH_UNAVAILABLE'));
    if (pending.length && !closed) sweepTimer = timers.setTimeout(sweep, Math.max(1, pending[0].deadlineAt - at));
  };
  // When there is room under the ceiling again: when enough of the last minute's requests have left it.
  const roomAt = at => { const over = recent(at) + 1 - ceiling(); return over > 0 ? sent[over - 1] + 60000 : at; };
  // Once an answer announced the ingress's window, a batch must also fit that window after the traders' expected
  // commands (commandPace) and a margin of Q/80. Below that the traders' commands go first, and waiting viewers still
  // get a batch at least every IDENTITY_MAX_SPACING_MS while the window has room. Under sustained trading, once the
  // commands need most of what is left, the rest is spread evenly over the window instead of being spent at once.
  // Otherwise the last minute's requests against Q - Q/16, as before. No room left: the batch waits for the window.
  let lastIdentityAt = -Infinity;
  const identitySlot = at => {
    const room = windowRoom(at);
    if (room === null) return roomAt(at);
    if (room < 1) return at < windowEnd ? windowEnd : at + 1000;
    const { sustained, ahead } = commandPace(at), spare = room - ahead - Math.ceil(quota / 80), latest = lastIdentityAt + IDENTITY_MAX_SPACING_MS;
    if (spare < 1) return Math.max(at, Math.min(latest, at < windowEnd ? windowEnd : at + 1000));
    if (sustained && spare < room / 2) return Math.max(at, Math.min(latest, lastIdentityAt + (at < windowEnd ? windowEnd - at : 60000) / spare));
    return roomAt(at);
  };
  // When the next batch may go: a whole token in the bucket, and room in the window (or under the ceiling).
  const nextSlot = at => { refill(); return Math.max(budget >= 1 ? at : at + (1 - budget) * 1000 / ratePerSecond(), identitySlot(at)); };
  const schedule = () => {
    if (pumpTimer || closed) return;
    while (waiting.length && waiting[0].done) waiting.shift();
    if (!waiting.length) return;
    const at = clock.now(), slot = nextSlot(at);
    // A request that cannot be checked before its deadline is refused now with the ingress's own answer (429 and
    // when to retry) instead of failing at its deadline. Retry-After is rounded down to whole seconds, so a client that
    // follows it is back before the batch it was refused for leaves, not just after it.
    if (slot > at) {
      const retryAfterMs = Math.max(1000, Math.min(60000, Math.floor((slot - at) / 1000) * 1000));
      for (const item of waiting) if (item.deadlineAt - IDENTITY_SEND_MARGIN_MS < slot) settle(item, Object.assign(new SimError('AUTH_RATE_LIMIT'), { retryAfterMs }));
      while (waiting.length && waiting[0].done) waiting.shift();
      if (!waiting.length) return;
    }
    const wait = slot - at;
    pumpTimer = wait <= 0 ? { immediate: timers.setImmediate(pump) } : { timeout: timers.setTimeout(pump, Math.ceil(wait)) };
  };
  function pump() {
    pumpTimer = null;
    for (;;) {
      while (waiting.length && waiting[0].done) waiting.shift();
      const at = clock.now();
      if (closed || !waiting.length || nextSlot(at) > at) break;
      const batch = new Map(); let bytes = 16;
      while (waiting.length && batch.size <= IDENTITY_BATCH_MAX) {
        const item = waiting[0];
        if (item.done) { waiting.shift(); continue; }
        const token = item.authorization.slice(7);
        if (!batch.has(token)) {
          if (batch.size === IDENTITY_BATCH_MAX || batch.size && bytes + token.length + 3 > IDENTITY_BATCH_BYTES) break;
          bytes += token.length + 3; batch.set(token, []);
        }
        waiting.shift(); batch.get(token).push(item);
      }
      budget--; lastIdentityAt = at; const seq = spend(at);
      const task = sendIdentities(batch, seq); inFlight.add(task); task.finally(() => inFlight.delete(task));
    }
    schedule();
  }
  // Answers leave in arrival order, each as long after the batch's answer as it arrived after the
  // batch's oldest request; one timer for the whole batch.
  const release = entries => {
    const releaser = { timer: null, entries, next: 0 };
    const run = () => {
      releaser.timer = null; const at = clock.now();
      while (releaser.next < entries.length && entries[releaser.next].due <= at) { const { item, value } = entries[releaser.next++]; settle(item, null, value); }
      if (releaser.next < entries.length && !closed) releaser.timer = timers.setTimeout(run, Math.max(1, entries[releaser.next].due - at)); else releasers.delete(releaser);
    };
    releasers.add(releaser); run();
  };
  async function sendIdentities(batch, seq) {
    const tokens = [...batch.keys()], items = [...batch.values()].flat(), failAll = error => { for (const item of items) if (!item.released) settle(item, error); };
    const oldest = Math.min(...items.map(item => item.arrivedAt));
    const controller = new AbortController(), timer = timers.setTimeout(() => controller.abort(), IDENTITY_TIMEOUT_MS);
    batchAborts.add(controller);
    let response;
    try {
      counters.requests++; counters.identityBatches++; counters.identityChecks += tokens.length;
      response = await fetchImpl(base.href + '/identities', { method: 'POST', redirect: 'error', headers: { Accept: 'application/json', 'Content-Type': 'application/json', 'X-Stocks-Authority-Key': gatewayKey }, body: JSON.stringify({ tokens }), signal: controller.signal });
      observeQuota(response, seq);
      if (!response.ok) {
        counters.failures++;
        if ([401,403].includes(response.status)) return failAll(new SimError('AUTH_REQUIRED'));
        if (response.status === 429) {
          const value = response.headers.get('retry-after');
          const seconds = /^\d{1,6}$/.test(value ?? '') ? Math.max(1, Math.min(60, Number(value))) : 60;
          return failAll(Object.assign(new SimError('AUTH_RATE_LIMIT'), { retryAfterMs: seconds * 1000 }));
        }
        return failAll(new SimError('AUTH_UNAVAILABLE'));
      }
      const chunks = []; let size = 0;
      for await (const chunk of response.body) { size += chunk.byteLength; check(size <= 1024 * 1024, 'AUTH_UNAVAILABLE'); chunks.push(Buffer.from(chunk)); }
      const results = JSON.parse(Buffer.concat(chunks).toString('utf8')).results;
      check(Array.isArray(results) && results.length === tokens.length, 'AUTH_UNAVAILABLE');
      const answeredAt = clock.now(), entries = [];
      tokens.forEach((token, i) => {
        const result = results[i];
        for (const item of batch.get(token)) {
          if (result && result.issuer === issuer && typeof result.subject === 'string' && result.subject.length > 0) {
            item.released = true; entries.push({ item, value: { issuer, subject: result.subject }, due: answeredAt + item.arrivedAt - oldest });
          } else settle(item, new SimError(result?.error === 'AUTH_UNAVAILABLE' ? 'AUTH_UNAVAILABLE' : 'AUTH_REQUIRED'));
        }
      });
      release(entries.sort((a, b) => a.due - b.due));
    } catch {
      counters.failures++; failAll(new SimError('AUTH_UNAVAILABLE'));
    } finally { timers.clearTimeout(timer); batchAborts.delete(controller); failAll(new SimError('AUTH_UNAVAILABLE')); if (controller.signal.aborted || response && !response.ok) { try { await response?.body?.cancel(); } catch {} } }
  }
  const identify = (authorization, signal) => new Promise((resolve, reject) => {
    const arrivedAt = clock.now(), item = { authorization, resolve, reject, signal, done: false, released: false, arrivedAt, deadlineAt: arrivedAt + IDENTITY_TIMEOUT_MS };
    item.abort = () => settle(item, new SimError('AUTH_UNAVAILABLE'));
    signal?.addEventListener('abort', item.abort, { once: true });
    if (signal?.aborted) return item.abort();
    pending.push(item); waiting.push(item);
    if (!sweepTimer) sweepTimer = timers.setTimeout(sweep, IDENTITY_TIMEOUT_MS);
    schedule();
  });
  // Trader requests. Every command carries the request's own bearer, and the authority judges it live
  // inside the command's own transaction (session, user block, binding, expiry, trade policy) and binds
  // the command to that bearer's actor, which it names in its answer (stocksTestCash.ts). A separate
  // identity check before a trader's command only repeats that judgement, at the price of a private
  // request or a wait for a batch. So once the authority has confirmed a bearer live for a principal the
  // gateway lets trade (remember()), that bearer's next request may start without a separate check
  // (authenticate(.., { deferred: true })). Such a request is unconfirmed until a live answer given after
  // it arrived confirms the same principal: the actor named by its own command, or else (no command, or
  // the command failed) a live identity check before the gateway answers it (confirm()). Nothing is
  // granted from memory: the remembered bearer only says which principal to expect. A refused bearer is
  // forgotten at once; viewers' bearers are never remembered (their requests run no command).
  const bearers = new Map();
  let deferred = 0;
  const forget = ctx => { bearers.delete(ctx.authorization); };
  const confirmed = (ctx, subject) => {
    check(typeof subject === 'string' && subject.length > 0 && accountId({ issuer, subject }) === ctx.principalId, 'AUTH_REQUIRED');
    ctx.unconfirmed = false;
    const known = bearers.get(ctx.authorization); if (known) known.at = clock.now();
  };
  const authenticate = async (_req, { signal, deferred: mayDefer = false } = {}) => {
    check(!closed, 'ACCOUNT_UNAVAILABLE');
    const ctx = requests.getStore(); check(ctx && /^Bearer [A-Za-z0-9._~-]{16,4096}$/.test(ctx.authorization ?? ''), 'AUTH_REQUIRED');
    const known = mayDefer && !ctx.principalId ? bearers.get(ctx.authorization) : undefined;
    if (known && clock.now() - known.at < TRADER_BEARER_MS) {
      deferred++; ctx.principalId = known.id; ctx.subject = known.subject; ctx.unconfirmed = true;
      return { issuer, subject: known.subject };
    }
    let result;
    try { result = await identify(ctx.authorization, signal); } catch (error) { if (error?.code === 'AUTH_REQUIRED') forget(ctx); throw error; }
    const principal = { issuer, subject: result.subject }, id = accountId(principal);
    if (ctx.principalId) check(ctx.principalId === id, 'AUTH_REQUIRED'); else { ctx.principalId = id; ctx.subject = result.subject; }
    if (ctx.unconfirmed) confirmed(ctx, result.subject);
    return principal;
  };
  const execute = async (principal, type, input, options = {}) => {
    const ctx = requests.getStore(); check(ctx?.principalId === accountId(principal), 'AUTH_REQUIRED');
    const occurrenceId=['observe','observeFailed','observeBackground','observeFailedBackground'].includes(type)?options.occurrenceId??randomUUID():undefined;
    // Only optional reads/observations honor caller cancellation. Accepted
    // financial commands retain their atomic outcome/UNKNOWN semantics.
    const signal=['readView','portfolioView','observe'].includes(type)?options.signal:undefined;
    const task = transport('command', { body: { type, ...(input === undefined ? {} : { input: structuredClone(input) }),...(occurrenceId?{occurrenceId}:{}) },signal });
    inFlight.add(task);
    try {
      const result = await task; lastMetrics = result.metrics;
      // An authority that does not name the actor leaves the request unconfirmed (confirm() before the answer).
      if (ctx.unconfirmed && result.actor !== undefined) { check(result.actor?.issuer === issuer, 'AUTH_REQUIRED'); confirmed(ctx, result.actor.subject); }
      if (['submitObserved','cancel','observe','observeFailed','observeBackground','observeFailedBackground'].includes(type)) counters.mutations++;
      return result.value;
    } catch (error) { if (error?.code === 'AUTH_REQUIRED') forget(ctx); throw error; }
    finally { inFlight.delete(task); }
  };
  return {
    authenticate,
    runWithRequest(req, callback) { return requests.run({ authorization: req.headers.authorization, principalId: null, subject: null, unconfirmed: false }, callback); },
    // The gateway lets this request's principal trade: keep its bearer, only after a live answer for this request.
    remember() {
      const ctx = requests.getStore();
      if (closed || !ctx?.principalId || ctx.unconfirmed) return;
      bearers.delete(ctx.authorization);
      if (bearers.size >= TRADER_BEARERS_MAX) bearers.delete(bearers.keys().next().value);
      bearers.set(ctx.authorization, { id: ctx.principalId, subject: ctx.subject, at: clock.now() });
    },
    // True for a bearer the authority confirmed live for a principal the gateway lets trade (remember()), recently:
    // only a priority hint for admitting a request under connection load (server.mjs), never a grant.
    isTraderBearer(authorization) { const known = bearers.get(authorization); return Boolean(known) && clock.now() - known.at < TRADER_BEARER_MS; },
    // True while this request started without a separate check and no live answer confirmed it yet: the gateway
    // then changes nothing the principal's other sessions share (server.mjs).
    unconfirmed() { return requests.getStore()?.unconfirmed === true; },
    // Before the gateway answers: a request that started without a separate check and saw no live answer yet.
    async confirm({ signal } = {}) {
      const ctx = requests.getStore(); if (!ctx?.unconfirmed) return;
      try { confirmed(ctx, (await identify(ctx.authorization, signal)).subject); } catch (error) { forget(ctx); throw error; }
    },
    async forPrincipal(principal, { existingOnly = false } = {}) {
      check(existingOnly === true, 'AUTH_CONFIG_INVALID'); const owner = structuredClone(principal), id = accountId(owner);
      const result = await execute(owner, 'ensure'); check(result.id === id, 'AUTH_REQUIRED');
      return { id, read: () => execute(owner, 'read'), execute: (type, input, options) => execute(owner, type, input, options) };
    },
    metrics() { return { workerAlive: Number(!closed), authority: 'existing-demo-balance', transport: { ...counters }, identityBudget: { quota, burst: burst(), perSecond: ratePerSecond(), ceiling: ceiling(), privateLastMinute: recent(clock.now()), traderBearers: bearers.size, deferred }, authorityMetrics: lastMetrics }; },
    async close() {
      closed = true; if (pumpTimer) { timers.clearImmediate(pumpTimer.immediate); timers.clearTimeout(pumpTimer.timeout); pumpTimer = null; }
      if (sweepTimer) { timers.clearTimeout(sweepTimer); sweepTimer = null; }
      bearers.clear();
      // Requests still waiting for a send slot or for their release; those on the wire fail with their batch.
      for (const item of waiting) settle(item, new SimError('ACCOUNT_UNAVAILABLE'));
      for (const releaser of releasers) { timers.clearTimeout(releaser.timer); for (const { item } of releaser.entries.slice(releaser.next)) settle(item, new SimError('ACCOUNT_UNAVAILABLE')); }
      releasers.clear();
      // An identity answer is useless after close; commands keep their own outcome semantics.
      for (const controller of batchAborts) controller.abort();
      await Promise.allSettled([...inFlight]);
    },
  };
}
