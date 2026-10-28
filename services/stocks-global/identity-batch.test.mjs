import test from 'node:test';
import assert from 'node:assert/strict';
import { createAuthorityAdapter } from './authority-adapter.mjs';

// The gateway multiplexes the live identity checks of concurrent requests into one private
// request. These cases pin what that may never become: a cache, a mix-up between bearers,
// or a way past the authority's per-minute envelope.
const ISSUER = 'identity-batch-fixture', KEY = 'synthetic-identity-batch-capability-0000';
const bearer = n => 'Bearer ' + ('t' + String(n).padStart(5, '0')).repeat(4);
const subjectOf = token => 'subject-' + token.slice(0, 6);
const answer = tokens => new Response(JSON.stringify({ results: tokens.map(token => ({ issuer: ISSUER, subject: subjectOf(token) })) }));
function fixture(fetchImpl) {
  return createAuthorityAdapter({ endpoint: 'http://127.0.0.1:1/api/v1/stocks-test-cash', issuer: ISSUER, gatewayKey: KEY, fetchImpl });
}
const identify = (adapter, authorization, options) => adapter.runWithRequest({ headers: { authorization } }, () => adapter.authenticate(undefined, options));

test('concurrent requests share one live batch; every bearer gets its own answer', async t => {
  const calls = [];
  const adapter = fixture(async (url, options) => {
    calls.push({ url, method: options.method, headers: options.headers, tokens: JSON.parse(options.body).tokens });
    return answer(JSON.parse(options.body).tokens);
  });
  t.after(() => adapter.close());
  const principals = await Promise.all(Array.from({ length: 40 }, (_, n) => identify(adapter, bearer(n))));
  principals.forEach((principal, n) => assert.deepEqual(principal, { issuer: ISSUER, subject: subjectOf(bearer(n).slice(7)) }));
  // 32 bearers is the authority's bound for one batch.
  assert.deepEqual(calls.map(call => call.tokens.length), [32, 8]);
  for (const call of calls) {
    assert.ok(call.url.endsWith('/api/v1/stocks-test-cash/identities') && call.method === 'POST');
    // The capability authenticates the gateway; no user bearer travels in a header.
    assert.equal(call.headers['X-Stocks-Authority-Key'], KEY);
    assert.equal(Object.keys(call.headers).some(name => name.toLowerCase() === 'authorization'), false);
  }
  assert.deepEqual(adapter.metrics().transport, { requests: 2, failures: 0, mutations: 0, identityBatches: 2, identityChecks: 40 });
});

test('a request never joins a batch that was already sent: a revocation in between is seen', async t => {
  let release, revoked = false; const calls = [];
  const adapter = fixture(async (_url, options) => {
    const tokens = JSON.parse(options.body).tokens; calls.push(tokens);
    if (calls.length === 1) { await new Promise(resolve => release = resolve); return answer(tokens); }
    return new Response(JSON.stringify({ results: tokens.map(() => revoked ? { error: 'AUTH_REQUIRED' } : { issuer: ISSUER, subject: 'unexpected' }) }));
  });
  t.after(() => adapter.close());
  const first = identify(adapter, bearer(1));
  while (!release) await new Promise(resolve => setImmediate(resolve));
  // The same bearer arrives while the first check is on the wire, then the session is revoked.
  const second = identify(adapter, bearer(1)).then(() => 'accepted', error => error.code);
  revoked = true;
  while (calls.length < 2) await new Promise(resolve => setImmediate(resolve));
  release();
  assert.deepEqual(await first, { issuer: ISSUER, subject: subjectOf(bearer(1).slice(7)) });
  assert.equal(await second, 'AUTH_REQUIRED');
  assert.deepEqual(calls, [[bearer(1).slice(7)], [bearer(1).slice(7)]]);
});

test('the same bearer twice in one unsent batch is checked once and answers both', async t => {
  const calls = [];
  const adapter = fixture(async (_url, options) => { calls.push(JSON.parse(options.body).tokens); return answer(calls.at(-1)); });
  t.after(() => adapter.close());
  const [a, b, c] = await Promise.all([identify(adapter, bearer(7)), identify(adapter, bearer(8)), identify(adapter, bearer(7))]);
  assert.deepEqual(calls, [[bearer(7).slice(7), bearer(8).slice(7)]]);
  assert.equal(a.subject, subjectOf(bearer(7).slice(7))); assert.equal(c.subject, a.subject);
  assert.equal(b.subject, subjectOf(bearer(8).slice(7)));
});

test('at most two batches per second leave, also under a burst of 100 requests', async t => {
  const sent = [];
  const adapter = fixture(async (_url, options) => { sent.push(performance.now()); return answer(JSON.parse(options.body).tokens); });
  t.after(() => adapter.close());
  const burst = await Promise.all(Array.from({ length: 100 }, (_, n) => identify(adapter, bearer(1000 + n))));
  assert.equal(burst.length, 100);
  for (let n = 0; n < 4; n++) await identify(adapter, bearer(n));
  assert.equal(sent.length, 8);
  // Token bucket: within any span of T ms at most 2 + 2·T/1000 batches (5 ms timer slack).
  for (let i = 0; i < sent.length; i++) for (let j = i + 1; j < sent.length; j++)
    assert.ok(j - i + 1 <= 2 + 2 * (sent[j] - sent[i] + 5) / 1000, `batches ${i}..${j} within ${(sent[j] - sent[i]).toFixed(1)} ms`);
});

test('a waiting request that is aborted fails closed at once and is never sent', async t => {
  const releases = [], calls = [];
  const adapter = fixture(async (_url, options) => {
    const tokens = JSON.parse(options.body).tokens; calls.push(tokens);
    await new Promise(resolve => releases.push(resolve)); return answer(tokens);
  });
  t.after(() => adapter.close());
  // Two batches in flight spend the burst; the third request waits for a send slot.
  const held = [identify(adapter, bearer(1)), identify(adapter, bearer(2))];
  await new Promise(resolve => setImmediate(resolve));
  const held2 = identify(adapter, bearer(2));
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(calls.length, 2);
  const controller = new AbortController(), started = performance.now();
  const waiting = identify(adapter, bearer(3), { signal: controller.signal });
  controller.abort();
  await assert.rejects(waiting, error => error.code === 'AUTH_UNAVAILABLE');
  assert.ok(performance.now() - started < 100);
  await new Promise(resolve => setTimeout(resolve, 700));
  assert.equal(calls.flat().includes(bearer(3).slice(7)), false);
  releases.forEach(release => release());
  await Promise.all([...held, held2]);
});

test('batch failures fail closed; answers never cross between bearers', async t => {
  const cases = [
    [() => new Response('not json'), ['AUTH_UNAVAILABLE', 'AUTH_UNAVAILABLE']],
    [() => new Response(JSON.stringify({ error: 'unavailable' }), { status: 503 }), ['AUTH_UNAVAILABLE', 'AUTH_UNAVAILABLE']],
    [() => new Response(JSON.stringify({ error: 'IDENTITY_BATCH_INVALID' }), { status: 422 }), ['AUTH_UNAVAILABLE', 'AUTH_UNAVAILABLE']],
    [() => new Response('denied', { status: 403 }), ['AUTH_REQUIRED', 'AUTH_REQUIRED']],
    // One answer too few must not shift the answers onto the wrong bearers.
    [tokens => new Response(JSON.stringify({ results: [{ issuer: ISSUER, subject: subjectOf(tokens[1]) }] })), ['AUTH_UNAVAILABLE', 'AUTH_UNAVAILABLE']],
    [tokens => new Response(JSON.stringify({ results: [{ issuer: 'another-issuer', subject: subjectOf(tokens[0]) }, { issuer: ISSUER, subject: subjectOf(tokens[1]) }] })), ['AUTH_REQUIRED', 'ok']],
    [tokens => new Response(JSON.stringify({ results: [{ error: 'AUTH_REQUIRED' }, { issuer: ISSUER, subject: subjectOf(tokens[1]) }] })), ['AUTH_REQUIRED', 'ok']],
    [tokens => new Response(JSON.stringify({ results: [{ error: 'AUTH_UNAVAILABLE' }, { issuer: ISSUER, subject: '' }] })), ['AUTH_UNAVAILABLE', 'AUTH_REQUIRED']],
  ];
  for (const [reply, expected] of cases) {
    const adapter = fixture(async (_url, options) => reply(JSON.parse(options.body).tokens));
    const outcomes = await Promise.all([bearer(1), bearer(2)].map(authorization => identify(adapter, authorization).then(
      principal => { assert.equal(principal.subject, subjectOf(authorization.slice(7))); return 'ok'; }, error => error.code)));
    assert.deepEqual(outcomes, expected);
    await adapter.close();
  }
  t.diagnostic(`${cases.length} failure shapes`);
});

test('a batch that never answers ends at the request deadline; close() refuses waiting requests', async () => {
  let calls = 0;
  const adapter = fixture((_url, options) => { calls++; return new Promise((_, reject) => options.signal.addEventListener('abort', () => reject(Error('aborted')), { once: true })); });
  const started = performance.now();
  await assert.rejects(identify(adapter, bearer(1)), error => error.code === 'AUTH_UNAVAILABLE');
  const elapsed = performance.now() - started;
  assert.ok(elapsed >= 2900 && elapsed < 3500, `deadline after ${elapsed.toFixed(0)} ms`);
  // Spend both send slots, then close with one request still waiting for a slot.
  const pending = [identify(adapter, bearer(2))];
  await new Promise(resolve => setImmediate(resolve));
  pending.push(identify(adapter, bearer(3)));
  await new Promise(resolve => setImmediate(resolve));
  const waiting = identify(adapter, bearer(4));
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(calls, 3);
  const closing = performance.now();
  await adapter.close();
  assert.ok(performance.now() - closing < 500, 'close does not wait for unanswered identity batches');
  await assert.rejects(waiting, error => error.code === 'ACCOUNT_UNAVAILABLE');
  for (const request of pending) await assert.rejects(request, error => error.code === 'AUTH_UNAVAILABLE');
  assert.equal(calls, 3);
  await assert.rejects(identify(adapter, bearer(5)), error => error.code === 'ACCOUNT_UNAVAILABLE');
});
