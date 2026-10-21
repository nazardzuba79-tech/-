import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';
import { accountId } from './accounts.mjs';
import { check, SimError } from './engine.mjs';

// Credentials belong to the immutable HTTP request context, not the shared
// per-principal quote context or a cached account handle (two tabs may differ).
export function createAuthorityAdapter({ endpoint, issuer, gatewayKey, fetchImpl = fetch } = {}) {
  const base = new URL(endpoint);
  check((base.protocol === 'https:' || base.protocol === 'http:' && base.hostname === '127.0.0.1') && !base.username && !base.password && !base.search && !base.hash && base.pathname.endsWith('/api/v1/stocks-test-cash'), 'AUTH_CONFIG_INVALID');
  check(typeof issuer === 'string' && issuer.length > 0 && typeof gatewayKey === 'string' && gatewayKey.length >= 32, 'AUTH_CONFIG_INVALID');
  const requests = new AsyncLocalStorage(), inFlight = new Set(); let closed = false, lastMetrics = null;
  const counters = { requests: 0, failures: 0, mutations: 0 };
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
  const authenticate = async (_req, { signal } = {}) => {
    const result = await transport('identity', { signal }); check(result.issuer === issuer, 'AUTH_REQUIRED');
    const principal = { issuer, subject: result.subject }, id = accountId(principal), ctx = requests.getStore();
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
    async close() { await Promise.allSettled([...inFlight]); closed = true; },
  };
}
