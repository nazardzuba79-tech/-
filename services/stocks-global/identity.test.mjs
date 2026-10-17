import test from 'node:test';
import assert from 'node:assert/strict';
import { getEventListeners } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';
import { identityResolver, IDENTITY_RESPONSE_MAX_BYTES } from './identity.mjs';

const endpoint = 'http://127.0.0.1:1/api/v1/me';
const request = { headers: { authorization: 'Bearer fixture-token-alice-123', 'x-user-id': 'bob' } };
const principal = { issuer: 'identity-contract-fixture', subject: 'alice' };
const resolver = fetchImpl => identityResolver({ endpoint, issuer: principal.issuer, fetchImpl });
const authError = code => error => error.code === code && error.message === code;
const profile = avatarUrl => ({ id: 'alice', email: 'alice@stocks.test', displayName: 'Тест', phone: null, country: 'UA', avatarUrl, role: 'USER', isAdmin: false, kycStatus: 'NONE', twoFactorEnabled: false, createdAt: '2026-10-13T00:00:00.000Z' });
function png(bytes) {
  const image = Buffer.alloc(bytes); image.set([0x89, 0x50, 0x4e, 0x47]);
  return 'data:image/png;base64,' + image.toString('base64');
}
function streamResponse(bytes, { headers, status = 200, chunkBytes = 4093, cancelResult } = {}) {
  const input = Buffer.from(bytes); let at = 0, reads = 0, cancelled = 0;
  const body = new ReadableStream({
    pull(controller) { reads++; if (at === input.length) { controller.close(); return; } const end = Math.min(at + chunkBytes, input.length); controller.enqueue(input.subarray(at, end)); at = end; },
    cancel() { cancelled++; return cancelResult?.(); },
  }, { highWaterMark: 0 });
  const response = new Response(body, { status, headers });
  return { response, body, counts: () => ({ reads, cancelled }) };
}

test('accepts the exact /me profile with no avatar, 20KB avatar and canonical 512KiB decoded avatar', async () => {
  for (const avatar of [null, png(20000), png(512 * 1024)]) {
    const body = JSON.stringify(profile(avatar));
    assert.ok(Buffer.byteLength(body) <= IDENTITY_RESPONSE_MAX_BYTES);
    const fixture = streamResponse(body, { headers: { 'content-length': String(Buffer.byteLength(body)) } });
    assert.deepEqual(await resolver(async () => fixture.response)(request), principal);
    assert.equal(fixture.body.locked, false);
  }
});

test('accepts a padded avatar retained by the real 1MiB upload contract, not only canonical base64', async () => {
  const canonical = png(20000);
  const avatar = canonical + ' '.repeat(1024 * 1024 - Buffer.byteLength(JSON.stringify({ image: canonical })) - 4);
  assert.ok(avatar.length <= 512 * 1024 * 2);
  assert.equal(Buffer.from(avatar.slice('data:image/png;base64,'.length), 'base64').length, 20000);
  assert.ok(Buffer.byteLength(JSON.stringify({ image: avatar })) < 1024 * 1024);
  const body = JSON.stringify(profile(avatar));
  assert.ok(Buffer.byteLength(body) > 768 * 1024);
  const fixture = streamResponse(body);
  assert.deepEqual(await resolver(async () => fixture.response)(request), principal);
  assert.equal(fixture.body.locked, false);
});

test('accepts an exact byte boundary and rejects the next streamed byte without trusting Content-Length', async () => {
  const shell = JSON.stringify({ id: 'alice', padding: '' });
  const body = JSON.stringify({ id: 'alice', padding: 'a'.repeat(IDENTITY_RESPONSE_MAX_BYTES - Buffer.byteLength(shell)) });
  assert.equal(Buffer.byteLength(body), IDENTITY_RESPONSE_MAX_BYTES);
  assert.deepEqual(await resolver(async () => streamResponse(body).response)(request), principal);
  for (const headers of [undefined, { 'content-length': '1' }]) {
    const fixture = streamResponse(body + ' ', { headers });
    await assert.rejects(resolver(async () => fixture.response)(request), authError('AUTH_UNAVAILABLE'));
    assert.equal(fixture.counts().cancelled, 1);
    assert.equal(fixture.body.locked, false);
  }
});

test('counts UTF-8 bytes rather than characters across split multibyte chunks', async () => {
  const body = JSON.stringify({ id: 'alice', padding: '界'.repeat(Math.ceil(IDENTITY_RESPONSE_MAX_BYTES / 3)) });
  assert.ok(body.length < IDENTITY_RESPONSE_MAX_BYTES);
  assert.ok(Buffer.byteLength(body) > IDENTITY_RESPONSE_MAX_BYTES);
  const fixture = streamResponse(body, { chunkBytes: 4093 });
  await assert.rejects(resolver(async () => fixture.response)(request), authError('AUTH_UNAVAILABLE'));
  assert.equal(fixture.counts().cancelled, 1);
  assert.equal(fixture.body.locked, false);
});

test('rejects malformed UTF-8 rather than accepting replacement characters in an otherwise valid identity response', async () => {
  const bytes = Buffer.concat([Buffer.from('{"id":"alice","displayName":"'), Buffer.from([0xc3, 0x28]), Buffer.from('"}')]);
  const fixture = streamResponse(bytes, { chunkBytes: 1 });
  await assert.rejects(resolver(async () => fixture.response)(request), authError('AUTH_UNAVAILABLE'));
  assert.equal(fixture.body.locked, false);
});

test('rejects oversized or invalid Content-Length before reading and cancels the unread body', async () => {
  for (const length of [String(IDENTITY_RESPONSE_MAX_BYTES + 1), '-1', 'bad', '9007199254740992']) {
    const fixture = streamResponse(JSON.stringify(profile(null)), { headers: { 'content-length': length } });
    await assert.rejects(resolver(async () => fixture.response)(request), authError('AUTH_UNAVAILABLE'));
    assert.deepEqual(fixture.counts(), { reads: 0, cancelled: 1 });
    assert.equal(fixture.body.locked, false);
  }
});

test('retains fail-closed status, blocked/deleted, invalid identity and malformed JSON behavior', async () => {
  for (const status of [401, 403, 404, 500]) {
    const fixture = streamResponse('private upstream error', { status });
    await assert.rejects(resolver(async () => fixture.response)(request), authError(status === 500 ? 'AUTH_UNAVAILABLE' : 'AUTH_REQUIRED'));
    assert.deepEqual(fixture.counts(), { reads: 0, cancelled: 1 });
  }
  for (const body of [{ id: 'alice', blocked: true }, { id: 'alice', isBlocked: true }, { id: 'alice', deletedAt: '2026-10-13' }, { id: '../bob' }]) {
    const fixture = streamResponse(JSON.stringify(body));
    await assert.rejects(resolver(async () => fixture.response)(request), authError('AUTH_REQUIRED'));
    assert.equal(fixture.body.locked, false);
  }
  for (const body of ['private invalid JSON', 'null', '']) {
    const fixture = streamResponse(body);
    await assert.rejects(resolver(async () => fixture.response)(request), authError('AUTH_UNAVAILABLE'));
    assert.equal(fixture.body.locked, false);
  }
});

test('revalidates every request at the fixed authority and immediately observes revocation', async () => {
  let calls = 0;
  const resolve = resolver(async (url, options) => {
    calls++; assert.equal(url, endpoint); assert.equal(options.method, 'GET'); assert.equal(options.redirect, 'error');
    assert.deepEqual(options.headers, { Authorization: request.headers.authorization, Accept: 'application/json' });
    assert.ok(options.signal instanceof AbortSignal);
    return Response.json(calls < 3 ? profile(png(20000)) : {}, { status: calls < 3 ? 200 : 401 });
  });
  assert.deepEqual(await resolve(request), principal);
  assert.deepEqual(await resolve(request), principal);
  await assert.rejects(resolve(request), authError('AUTH_REQUIRED'));
  assert.equal(calls, 3);
  await assert.rejects(resolve({ headers: { 'x-user-id': 'alice' } }), authError('AUTH_REQUIRED'));
  assert.equal(calls, 3);
});

test('one three-second deadline includes header wait and a stalled body, then cancels and releases', { timeout: 6000 }, async () => {
  let cancelled = 0, signal;
  const body = new ReadableStream({ cancel() { cancelled++; } }, { highWaterMark: 0 });
  const resolve = resolver(async (_, options) => { signal = options.signal; await delay(1200); return new Response(body); });
  const started = performance.now();
  await assert.rejects(resolve(request), authError('AUTH_UNAVAILABLE'));
  const elapsed = performance.now() - started;
  assert.ok(elapsed >= 2900 && elapsed < 3900, `shared deadline took ${elapsed}ms`);
  assert.equal(signal.aborted, true);
  assert.equal(cancelled, 1);
  assert.equal(body.locked, false);
});

test('a stalled header fetch times out and a late response is cancelled without reading', { timeout: 6000 }, async () => {
  let deliver, signal;
  const resolve = resolver((_, options) => { signal = options.signal; return new Promise(done => { deliver = done; }); });
  const started = performance.now();
  await assert.rejects(resolve(request), authError('AUTH_UNAVAILABLE'));
  assert.ok(performance.now() - started < 3900);
  assert.equal(signal.aborted, true);
  const fixture = streamResponse(JSON.stringify(profile(null)));
  deliver(fixture.response);
  await delay(0);
  assert.deepEqual(fixture.counts(), { reads: 0, cancelled: 1 });
  assert.equal(fixture.body.locked, false);
});

test('a failing or nonsettling cancellation cannot hold an oversized response or leak a locked reader', async () => {
  for (const cancelResult of [() => Promise.reject(Error('private cancel failure')), () => new Promise(() => {})]) {
    const fixture = streamResponse(Buffer.alloc(IDENTITY_RESPONSE_MAX_BYTES + 1), { chunkBytes: IDENTITY_RESPONSE_MAX_BYTES + 1, cancelResult });
    const started = performance.now();
    await assert.rejects(resolver(async () => fixture.response)(request), authError('AUTH_UNAVAILABLE'));
    assert.ok(performance.now() - started < 1000);
    assert.equal(fixture.counts().cancelled, 1);
    assert.equal(fixture.body.locked, false);
  }
});

test('pre-aborted and immediately abandoned requests never invoke the identity authority', async () => {
  for (const alreadyAborted of [true, false]) {
    const caller = new AbortController(); let calls = 0;
    const resolve = resolver(async () => { calls++; return Response.json(profile(null)); });
    if (alreadyAborted) caller.abort();
    const result = resolve(request, { signal: caller.signal });
    caller.abort();
    await assert.rejects(result, authError('AUTH_UNAVAILABLE'));
    assert.equal(calls, 0);
    assert.equal(getEventListeners(caller.signal, 'abort').length, 0);
  }
});

test('abandoning one pending identity fetch cancels its late body without aborting a live request', { timeout: 2000 }, async () => {
  const abandoned = new AbortController(), live = new AbortController();
  const pending = []; let bothEntered;
  const entered = new Promise(done => { bothEntered = done; });
  const resolve = resolver((_, options) => new Promise(deliver => {
    pending.push({ signal: options.signal, deliver });
    if (pending.length === 2) bothEntered();
  }));
  const abandonedResult = assert.rejects(resolve(request, { signal: abandoned.signal }), authError('AUTH_UNAVAILABLE'));
  const liveResult = resolve(request, { signal: live.signal });
  await entered;
  abandoned.abort(Error('private caller reason'));
  await abandonedResult;
  assert.equal(pending[0].signal.aborted, true);
  assert.equal(pending[1].signal.aborted, false);
  assert.equal(live.signal.aborted, false);
  const late = streamResponse(JSON.stringify(profile(null)));
  pending[0].deliver(late.response);
  pending[1].deliver(Response.json(profile(null)));
  assert.deepEqual(await liveResult, principal);
  await delay(0);
  assert.deepEqual(late.counts(), { reads: 0, cancelled: 1 });
  assert.equal(late.body.locked, false);
  assert.equal(getEventListeners(abandoned.signal, 'abort').length, 0);
  assert.equal(getEventListeners(live.signal, 'abort').length, 0);
});

test('request cancellation interrupts a stalled identity body and releases its reader', { timeout: 2000 }, async () => {
  const caller = new AbortController(); let reading, cancelled = 0, upstreamSignal;
  const entered = new Promise(done => { reading = done; });
  const body = new ReadableStream({ pull() { reading(); }, cancel() { cancelled++; } }, { highWaterMark: 0 });
  const resolve = resolver(async (_, options) => { upstreamSignal = options.signal; return new Response(body); });
  const result = assert.rejects(resolve(request, { signal: caller.signal }), authError('AUTH_UNAVAILABLE'));
  await entered;
  assert.equal(body.locked, true);
  caller.abort();
  await result;
  assert.equal(upstreamSignal.aborted, true);
  assert.equal(cancelled, 1);
  assert.equal(body.locked, false);
  assert.equal(getEventListeners(caller.signal, 'abort').length, 0);
});

test('authentication failures detach the caller lifetime listener without aborting the caller', async () => {
  const caller = new AbortController();
  for (const status of [401, 500]) {
    await assert.rejects(resolver(async () => Response.json({}, { status }))(request, { signal: caller.signal }), authError(status === 401 ? 'AUTH_REQUIRED' : 'AUTH_UNAVAILABLE'));
    assert.equal(caller.signal.aborted, false);
    assert.equal(getEventListeners(caller.signal, 'abort').length, 0);
  }
});
