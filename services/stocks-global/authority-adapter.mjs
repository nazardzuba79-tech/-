import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';
import { accountId } from './accounts.mjs';
import { check, SimError } from './engine.mjs';

// One identity batch (src/api/routes/stocksTestCash.ts accepts up to 32 bearers, 64 KiB).
const IDENTITY_BATCH_MAX = 32, IDENTITY_BATCH_BYTES = 60 * 1024, IDENTITY_TIMEOUT_MS = 3000;
const IDENTITY_BATCHES_PER_SECOND = 2, IDENTITY_BURST = 2;

// Credentials belong to the immutable HTTP request context, not the shared
// per-principal quote context or a cached account handle (two tabs may differ).
export function createAuthorityAdapter({ endpoint, issuer, gatewayKey, fetchImpl = fetch } = {}) {
  const base = new URL(endpoint);
  check((base.protocol === 'https:' || base.protocol === 'http:' && base.hostname === '127.0.0.1') && !base.username && !base.password && !base.search && !base.hash && base.pathname.endsWith('/api/v1/stocks-test-cash'), 'AUTH_CONFIG_INVALID');
  check(typeof issuer === 'string' && issuer.length > 0 && typeof gatewayKey === 'string' && gatewayKey.length >= 32, 'AUTH_CONFIG_INVALID');
  const requests = new AsyncLocalStorage(), inFlight = new Set(); let closed = false, lastMetrics = null;
  const counters = { requests: 0, failures: 0, mutations: 0, identityBatches: 0, identityChecks: 0 };
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
  // At most IDENTITY_BATCHES_PER_SECOND batches leave per second (burst 2): half of the
  // authority's 240/min private envelope, so commands keep the other half.
  const waiting = [], batchAborts = new Set(); let pumpTimer = null, budget = IDENTITY_BURST, refilledAt = performance.now();
  const refill = () => { const at = performance.now(); budget = Math.min(IDENTITY_BURST, budget + (at - refilledAt) * IDENTITY_BATCHES_PER_SECOND / 1000); refilledAt = at; };
  const settle = (item, error, value) => {
    if (item.done) return; item.done = true; clearTimeout(item.deadline); item.signal?.removeEventListener('abort', item.abort);
    const at = waiting.indexOf(item); if (at >= 0) waiting.splice(at, 1);
    if (error) item.reject(error); else item.resolve(value);
  };
  const schedule = () => {
    if (pumpTimer || !waiting.length || closed) return;
    refill();
    pumpTimer = budget >= 1 ? { immediate: setImmediate(pump) } : { timeout: setTimeout(pump, Math.ceil((1 - budget) * 1000 / IDENTITY_BATCHES_PER_SECOND)) };
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
    const tokens = [...batch.keys()], failAll = error => { for (const items of batch.values()) for (const item of items) settle(item, error); };
    const controller = new AbortController(), timer = setTimeout(() => controller.abort(), IDENTITY_TIMEOUT_MS);
    batchAborts.add(controller);
    let response;
    try {
      counters.requests++; counters.identityBatches++; counters.identityChecks += tokens.length;
      response = await fetchImpl(base.href + '/identities', { method: 'POST', redirect: 'error', headers: { Accept: 'application/json', 'Content-Type': 'application/json', 'X-Stocks-Authority-Key': gatewayKey }, body: JSON.stringify({ tokens }), signal: controller.signal });
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
          if (result && result.issuer === issuer && typeof result.subject === 'string' && result.subject.length > 0) settle(item, null, { issuer, subject: result.subject });
          else settle(item, new SimError(result?.error === 'AUTH_UNAVAILABLE' ? 'AUTH_UNAVAILABLE' : 'AUTH_REQUIRED'));
        }
      });
    } catch {
      counters.failures++; failAll(new SimError('AUTH_UNAVAILABLE'));
    } finally { clearTimeout(timer); batchAborts.delete(controller); failAll(new SimError('AUTH_UNAVAILABLE')); if (controller.signal.aborted || response && !response.ok) { try { await response?.body?.cancel(); } catch {} } }
  }
  const identify = (authorization, signal) => new Promise((resolve, reject) => {
    const item = { authorization, resolve, reject, signal, done: false };
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
    metrics() { return { workerAlive: Number(!closed), authority: 'existing-demo-balance', transport: { ...counters }, authorityMetrics: lastMetrics }; },
    async close() {
      closed = true; if (pumpTimer) { clearImmediate(pumpTimer.immediate); clearTimeout(pumpTimer.timeout); pumpTimer = null; }
      for (const item of [...waiting]) settle(item, new SimError('ACCOUNT_UNAVAILABLE'));
      // An identity answer is useless after close; commands keep their own outcome semantics.
      for (const controller of batchAborts) controller.abort();
      await Promise.allSettled([...inFlight]);
    },
  };
}
