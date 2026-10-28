import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createAuthorityAdapter } from './authority-adapter.mjs';
import { accountId } from './accounts.mjs';
import { createServer } from './server.mjs';

const issuer = 'isolated-rate-regression';
const gatewayKey = 'synthetic-capability-'.repeat(3);
const req = { headers: { authorization: 'Bearer ' + 'A'.repeat(32) } };
async function fixture(t, handler) {
  const server = http.createServer(handler);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }));
  return createAuthorityAdapter({
    endpoint: `http://127.0.0.1:${server.address().port}/api/v1/stocks-test-cash`,
    issuer, gatewayKey,
  });
}

test('non-JSON identity 429 is classified before parsing, bounded and never retried', async t => {
  let calls = 0;
  const adapter = await fixture(t, (request, response) => {
    calls++;
    response.writeHead(429, { 'Content-Type': 'text/plain', 'Retry-After': '28' });
    response.end('Too many requests, please try again later.');
  });
  await adapter.runWithRequest(req, () => assert.rejects(adapter.authenticate(req),
    e => e.code === 'AUTH_RATE_LIMIT' && e.retryAfterMs === 28000));
  assert.equal(calls, 1);
});

test('identity carries capability and non-JSON 401/403 remain AUTH_REQUIRED', async t => {
  let calls = 0; const keys = [];
  const adapter = await fixture(t, (request, response) => {
    keys.push(request.headers['x-stocks-authority-key']);
    response.writeHead(++calls === 1 ? 401 : 403, { 'Content-Type': 'text/plain' });
    response.end('denied');
  });
  for (let i = 0; i < 2; i++) await adapter.runWithRequest(req,
    () => assert.rejects(adapter.authenticate(req), e => e.code === 'AUTH_REQUIRED'));
  assert.equal(calls, 2);
  assert.deepEqual(keys, [gatewayKey, gatewayKey]);
});

test('Retry-After cannot inject text, become negative or exceed 60 seconds', async t => {
  let calls = 0;
  const values = ['99999999999999999', '-1', 'secret-do-not-propagate', '120', '0'];
  const adapter = await fixture(t, (request, response) => {
    response.writeHead(429, { 'Retry-After': values[calls++] }); response.end('not json');
  });
  for (const expected of [60000, 60000, 60000, 60000, 1000]) {
    await adapter.runWithRequest(req, () => assert.rejects(adapter.authenticate(req),
      e => e.code === 'AUTH_RATE_LIMIT' && e.retryAfterMs === expected &&
        !e.message.includes('secret')));
  }
  assert.equal(calls, values.length);
});

test('rate-limited mutation is not retried; lost mutation ACK stays outcome unknown', async t => {
  const principal = { issuer, subject: 'fabricated-a' };
  let submissions = 0;
  const adapter = await fixture(t, async (request, response) => {
    const chunks = []; for await (const chunk of request) chunks.push(chunk);
    const body = JSON.parse(Buffer.concat(chunks));
    if (request.url.endsWith('/identities')) return response.end(JSON.stringify({ results: body.tokens.map(() => principal) }));
    if (body.type === 'ensure') return response.end(JSON.stringify({ value: { id: accountId(principal) } }));
    submissions++;
    if (submissions === 1) { response.writeHead(429, { 'Retry-After': '28' }); response.end('limited'); }
    else request.socket.destroy();
  });
  await adapter.runWithRequest(req, async () => {
    const p = await adapter.authenticate(req), handle = await adapter.forPrincipal(p, { existingOnly: true });
    await assert.rejects(handle.execute('submitObserved', {}), e => e.code === 'AUTH_RATE_LIMIT');
    assert.equal(submissions, 1);
    await assert.rejects(handle.execute('submitObserved', {}), e => e.code === 'ACCOUNT_OUTCOME_UNKNOWN');
    assert.equal(submissions, 2);
  });
});

test('actual gateway returns safe429 and bounded Retry-After, with no account or order command', async t => {
  let calls = 0, commands = 0;
  const adapter = await fixture(t, (request, response) => {
    calls++; if (!request.url.endsWith('/identities')) commands++;
    response.writeHead(429, { 'Retry-After': '28' }); response.end('private upstream detail');
  });
  const gateway = await createServer({
    port: 0, autoPoll: false, accountAuthority: adapter,
    tradePrincipals: [{ issuer, subject: 'fabricated-a' }, { issuer, subject: 'fabricated-b' }],
    hub: { metrics: {}, close() {} },
  });
  t.after(() => gateway.close());
  const result = await fetch(`http://127.0.0.1:${gateway.port}/__stocks_global/state`, { headers: req.headers });
  assert.equal(result.status, 429);
  assert.equal(result.headers.get('retry-after'), '28');
  assert.deepEqual(await result.json(), { error: 'AUTH_RATE_LIMIT', retryAfterMs: 28000 });
  assert.equal(calls, 1); assert.equal(commands, 0);
});
