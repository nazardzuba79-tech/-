import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';
import { accountId } from './accounts.mjs';
import { check, SimError } from './engine.mjs';

// One identity batch (src/api/routes/stocksTestCash.ts accepts up to 64 bearers, 64 KiB): at Q/160
// batches per second that carries 96 requests per second at the default quota.
const IDENTITY_BATCH_MAX = 64, IDENTITY_BATCH_BYTES = 60 * 1024, IDENTITY_TIMEOUT_MS = 3000;
// The private ingress quota (stocksAuthorityIngress.ts: 120..240 per minute, default 240). Each private
// response announces it in RateLimit-Limit; the identity budget follows the announced value.
const INGRESS_QUOTA_DEFAULT = 240, INGRESS_QUOTA_MIN = 120, INGRESS_QUOTA_MAX = 240;

// Credentials belong to the immutable HTTP request context, not the shared
// per-principal quote context or a cached account handle (two tabs may differ).
export function createAuthorityAdapter({ endpoint, issuer, gatewayKey, fetchImpl = fetch } = {}) {
  const base = new URL(endpoint);
  check((base.protocol === 'https:' || base.protocol === 'http:' && base.hostname === '127.0.0.1') && !base.username && !base.password && !base.search && !base.hash && base.pathname.endsWith('/api/v1/stocks-test-cash'), 'AUTH_CONFIG_INVALID');
  check(typeof issuer === 'string' && issuer.length > 0 && typeof gatewayKey === 'string' && gatewayKey.length >= 32, 'AUTH_CONFIG_INVALID');
  const requests = new AsyncLocalStorage(), inFlight = new Set(); let closed = false, lastMetrics = null;
  const counters = { requests: 0, failures: 0, mutations: 0, identityBatches: 0, identityChecks: 0 };
  let quota = INGRESS_QUOTA_DEFAULT;
  const observeQuota = response => { const limit = Number(response?.headers?.get?.('ratelimit-limit')); if (Number.isInteger(limit) && limit >= INGRESS_QUOTA_MIN && limit <= INGRESS_QUOTA_MAX) quota = limit; };
  async function transport(path, { body, signal } = {}) {
    check(!closed, 'ACCOUNT_UNAVAILABLE');
    const ctx = requests.getStore(); check(ctx && /^Bearer [A-Za-z0-9._~-]{16,4096}$/.test(ctx.authorization ?? ''), 'AUTH_REQUIRED');
    const encoded = body === undefined ? undefined : JSON.stringify(body); check(encoded === undefined || Buffer.byteLength(encoded) <= 8192, 'ACCOUNT_COMMAND_INVALID');
    const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 3000);
    const abort = () => controller.abort(); signal?.addEventListener('abort', abort, { once: true }); if (signal?.aborted) abort();
    let response;
    try {
      counters.requests++;
      response = await fetchImpl(base.href + '/' + path, { method: encoded === undefined ? 'GET' : 'POST', redirect: 'error', headers: { Authorization: ctx.authorization, Accept: 'application/json', 'X-Stocks-Authority-Key': gatewayKey, ...(encoded === undefined ? {} : { 'Content-Type': 'application/json' }) }, body: encoded, signal: controller.signal });
      observeQuota(response);
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
    } finally { clearTimeout(timer); signal?.removeEventListener('abort', abort); if (controller.signal.aborted || response && !response.ok) { try { await response?.body?.cancel(); } catch {} } }
  }
  // Identity checks of concurrent gateway requests travel together (multiplexing, not
  // caching). A request only ever joins a batch that has not been sent yet, so its bearer
  // is checked live by the authority (POST identities: the same requireAuth and actor
  // binding as GET identity) after the request arrived; no result outlives its batch.
  // Token bucket sized from the private quota Q: Q/160 batches per second (3/8 of Q per minute) and
  // bursts of 3Q/8, so identity checks take at most 3/4 of Q in any minute (180 of 240, 90 of 120) and
  // commands always keep a quarter. The burst lets a quiet gateway answer a run of sequential requests
  // (a page load, a restart) at once; under sustained load the rate holds.
  // A batch's answers are handed back with the spacing in which their requests arrived (each request
  // waits as long as the oldest one in its batch), so the work behind them keeps the arrival pattern
  // instead of starting together: a released burst would queue the crypto requests on the same CPUs.
  const ratePerSecond = () => quota / 160, burst = () => quota * 3 / 8;
  const waiting = [], batchAborts = new Set(), releasing = new Set(); let pumpTimer = null, budget = burst(), refilledAt = performance.now();
  const refill = () => { const at = performance.now(); budget = Math.min(burst(), budget + (at - refilledAt) * ratePerSecond() / 1000); refilledAt = at; };
  const settle = (item, error, value) => {
    if (item.done) return; item.done = true; clearTimeout(item.deadline); clearTimeout(item.release); releasing.delete(item); item.signal?.removeEventListener('abort', item.abort);
    const at = waiting.indexOf(item); if (at >= 0) waiting.splice(at, 1);
    if (error) item.reject(error); else item.resolve(value);
  };
  const release = (item, value, delay) => {
    if (item.done) return;
    if (delay < 1) return settle(item, null, value);
    releasing.add(item); item.release = setTimeout(() => settle(item, null, value), delay);
  };
  const schedule = () => {
    if (pumpTimer || !waiting.length || closed) return;
    refill();
    pumpTimer = budget >= 1 ? { immediate: setImmediate(pump) } : { timeout: setTimeout(pump, Math.ceil((1 - budget) * 1000 / ratePerSecond())) };
  };
  function pump() {
    pumpTimer = null; refill();
    while (waiting.length && budget >= 1 && !closed) {
      budget--;
      const batch = new Map(); let bytes = 16;
      while (waiting.length && batch.size <= IDENTITY_BATCH_MAX) {
        const item = waiting[0], token = item.authorization.slice(7);
        if (!batch.has(token)) {
          if (batch.size === IDENTITY_BATCH_MAX || batch.size && bytes + token.length + 3 > IDENTITY_BATCH_BYTES) break;
          bytes += token.length + 3; batch.set(token, []);
        }
        waiting.shift(); batch.get(token).push(item);
      }
      const task = sendIdentities(batch); inFlight.add(task); task.finally(() => inFlight.delete(task));
    }
    schedule();
  }
  async function sendIdentities(batch) {
    const tokens = [...batch.keys()], failAll = error => { for (const items of batch.values()) for (const item of items) if (!releasing.has(item)) settle(item, error); };
    const oldest = Math.min(...[...batch.values()].flat().map(item => item.arrivedAt));
    const controller = new AbortController(), timer = setTimeout(() => controller.abort(), IDENTITY_TIMEOUT_MS);
    batchAborts.add(controller);
    let response;
    try {
      counters.requests++; counters.identityBatches++; counters.identityChecks += tokens.length;
      response = await fetchImpl(base.href + '/identities', { method: 'POST', redirect: 'error', headers: { Accept: 'application/json', 'Content-Type': 'application/json', 'X-Stocks-Authority-Key': gatewayKey }, body: JSON.stringify({ tokens }), signal: controller.signal });
      observeQuota(response);
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
      tokens.forEach((token, i) => {
        const result = results[i];
        for (const item of batch.get(token)) {
          if (result && result.issuer === issuer && typeof result.subject === 'string' && result.subject.length > 0) release(item, { issuer, subject: result.subject }, item.arrivedAt - oldest);
          else settle(item, new SimError(result?.error === 'AUTH_UNAVAILABLE' ? 'AUTH_UNAVAILABLE' : 'AUTH_REQUIRED'));
        }
      });
    } catch {
      counters.failures++; failAll(new SimError('AUTH_UNAVAILABLE'));
    } finally { clearTimeout(timer); batchAborts.delete(controller); failAll(new SimError('AUTH_UNAVAILABLE')); if (controller.signal.aborted || response && !response.ok) { try { await response?.body?.cancel(); } catch {} } }
  }
  const identify = (authorization, signal) => new Promise((resolve, reject) => {
    const item = { authorization, resolve, reject, signal, done: false, arrivedAt: performance.now() };
    // The request's own deadline covers the wait for a send slot and the batch itself.
    item.deadline = setTimeout(() => settle(item, new SimError('AUTH_UNAVAILABLE')), IDENTITY_TIMEOUT_MS);
    item.abort = () => settle(item, new SimError('AUTH_UNAVAILABLE'));
    signal?.addEventListener('abort', item.abort, { once: true });
    if (signal?.aborted) return item.abort();
    waiting.push(item); schedule();
  });
  const authenticate = async (_req, { signal } = {}) => {
    check(!closed, 'ACCOUNT_UNAVAILABLE');
    const ctx = requests.getStore(); check(ctx && /^Bearer [A-Za-z0-9._~-]{16,4096}$/.test(ctx.authorization ?? ''), 'AUTH_REQUIRED');
    const result = await identify(ctx.authorization, signal);
    const principal = { issuer, subject: result.subject }, id = accountId(principal);
    if (ctx.principalId) check(ctx.principalId === id, 'AUTH_REQUIRED'); else ctx.principalId = id;
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
    try { const result = await task; lastMetrics = result.metrics; if (['submitObserved','cancel','observe','observeFailed','observeBackground','observeFailedBackground'].includes(type)) counters.mutations++; return result.value; }
    finally { inFlight.delete(task); }
  };
  return {
    authenticate,
    runWithRequest(req, callback) { return requests.run({ authorization: req.headers.authorization, principalId: null }, callback); },
    async forPrincipal(principal, { existingOnly = false } = {}) {
      check(existingOnly === true, 'AUTH_CONFIG_INVALID'); const owner = structuredClone(principal), id = accountId(owner);
      const result = await execute(owner, 'ensure'); check(result.id === id, 'AUTH_REQUIRED');
      return { id, read: () => execute(owner, 'read'), execute: (type, input, options) => execute(owner, type, input, options) };
    },
    metrics() { return { workerAlive: Number(!closed), authority: 'existing-demo-balance', transport: { ...counters }, identityBudget: { quota, burst: burst(), perSecond: ratePerSecond() }, authorityMetrics: lastMetrics }; },
    async close() {
      closed = true; if (pumpTimer) { clearImmediate(pumpTimer.immediate); clearTimeout(pumpTimer.timeout); pumpTimer = null; }
      for (const item of [...waiting, ...releasing]) settle(item, new SimError('ACCOUNT_UNAVAILABLE'));
      // An identity answer is useless after close; commands keep their own outcome semantics.
      for (const controller of batchAborts) controller.abort();
      await Promise.allSettled([...inFlight]);
    },
  };
}
