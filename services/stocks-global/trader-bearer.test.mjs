import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createAuthorityAdapter } from './authority-adapter.mjs';
import { accountId } from './accounts.mjs';
import { createServer } from './server.mjs';

// A trader's request may start without a separate identity check once the authority has confirmed its
// bearer live, because its command is judged live by the authority anyway (authority-adapter.mjs,
// "Trader requests"). These cases pin that this never becomes a grant from memory: every answer still
// follows a live judgement made after the request arrived, and a refused bearer is checked again.
const ISSUER = 'trader-bearer-fixture', KEY = 'synthetic-trader-bearer-capability-000';
const bearer = letter => 'Bearer ' + letter.repeat(32);
const SUBJECTS = { A: 'trader-a', B: 'trader-b', V: 'viewer-v' };
const subjectOf = token => SUBJECTS[token[0]];

function authorityDouble({ actor = (subject => ({ issuer: ISSUER, subject })) } = {}) {
  const log = [], revoked = new Set();
  const fetchImpl = async (url, options) => {
    if (url.endsWith('/identities')) {
      const tokens = JSON.parse(options.body).tokens; log.push({ kind: 'identities', tokens: tokens.map(token => token[0]) });
      return new Response(JSON.stringify({ results: tokens.map(token => revoked.has(token[0]) ? { error: 'AUTH_REQUIRED' } : { issuer: ISSUER, subject: subjectOf(token) }) }));
    }
    const token = options.headers.Authorization.slice(7), body = JSON.parse(options.body);
    log.push({ kind: 'command', type: body.type, bearer: token[0] });
    if (revoked.has(token[0])) return new Response(JSON.stringify({ error: 'AUTH_REQUIRED' }), { status: 401 });
    const subject = subjectOf(token), value = body.type === 'ensure' ? { id: accountId({ issuer: ISSUER, subject }) } : { schema: 2, revision: 1, serverTime: 1, wallets: { USDT: { cash: '0', reserved: '0' }, USDC: { cash: '0', reserved: '0' } }, positions: {}, orders: [], fills: [], quotes: {} };
    const named = actor(subject);
    return new Response(JSON.stringify({ value, metrics: {}, ...(named === undefined ? {} : { actor: named }) }));
  };
  return { log, revoked, fetchImpl };
}
const adapterFor = double => createAuthorityAdapter({ endpoint: 'http://127.0.0.1:1/api/v1/stocks-test-cash', issuer: ISSUER, gatewayKey: KEY, fetchImpl: double.fetchImpl });
// One gateway request as server.mjs runs it: identity (deferrable), remember() for a trader, a command.
const traderRequest = (adapter, letter, { command = 'readView' } = {}) => adapter.runWithRequest({ headers: { authorization: bearer(letter) } }, async () => {
  const principal = await adapter.authenticate(undefined, { deferred: true }); adapter.remember();
  if (command) { const handle = await adapter.forPrincipal(principal, { existingOnly: true }); await handle.execute(command); }
  await adapter.confirm();
  return principal;
});
const kinds = log => log.map(entry => entry.kind === 'identities' ? 'identities:' + entry.tokens.join('') : entry.type + ':' + entry.bearer);

test('a confirmed trader bearer starts its next request without a separate check; its own command confirms it', async t => {
  const double = authorityDouble(), adapter = adapterFor(double);
  t.after(() => adapter.close());
  assert.deepEqual(await traderRequest(adapter, 'A'), { issuer: ISSUER, subject: 'trader-a' });
  assert.deepEqual(await traderRequest(adapter, 'A'), { issuer: ISSUER, subject: 'trader-a' });
  assert.deepEqual(kinds(double.log), ['identities:A', 'ensure:A', 'readView:A', 'ensure:A', 'readView:A']);
  assert.equal(adapter.metrics().identityBudget.deferred, 1);
  assert.equal(adapter.metrics().identityBudget.traderBearers, 1);
});

test('a request without a command is answered only after a live check made after it arrived', async t => {
  const double = authorityDouble(), adapter = adapterFor(double);
  t.after(() => adapter.close());
  await traderRequest(adapter, 'A');
  double.log.length = 0;
  await traderRequest(adapter, 'A', { command: null });
  assert.deepEqual(kinds(double.log), ['identities:A']);
  // Signed out between two requests: the deferred request's live check refuses it, the bearer is forgotten.
  double.revoked.add('A'); double.log.length = 0;
  await assert.rejects(traderRequest(adapter, 'A', { command: null }), error => error.code === 'AUTH_REQUIRED');
  assert.equal(adapter.metrics().identityBudget.traderBearers, 0);
  await assert.rejects(traderRequest(adapter, 'A'), error => error.code === 'AUTH_REQUIRED');
  assert.deepEqual(kinds(double.log), ['identities:A', 'identities:A']);
});

test('a signed-out trader is refused by its own command at the next request and checked live after that', async t => {
  const double = authorityDouble(), adapter = adapterFor(double);
  t.after(() => adapter.close());
  await traderRequest(adapter, 'A');
  double.revoked.add('A'); double.log.length = 0;
  await assert.rejects(traderRequest(adapter, 'A'), error => error.code === 'AUTH_REQUIRED');
  assert.deepEqual(kinds(double.log), ['ensure:A']);
  await assert.rejects(traderRequest(adapter, 'A'), error => error.code === 'AUTH_REQUIRED');
  assert.deepEqual(kinds(double.log), ['ensure:A', 'identities:A']);
});

test('a command bound to another actor never confirms the request; without a named actor the live check does', async t => {
  const other = authorityDouble({ actor: () => ({ issuer: ISSUER, subject: 'trader-b' }) }), adapter = adapterFor(other);
  t.after(() => adapter.close());
  await adapter.runWithRequest({ headers: { authorization: bearer('A') } }, async () => { await adapter.authenticate(undefined, { deferred: true }); adapter.remember(); });
  await assert.rejects(traderRequest(adapter, 'A'), error => error.code === 'AUTH_REQUIRED');
  assert.equal(adapter.metrics().identityBudget.traderBearers, 0);
  const silent = authorityDouble({ actor: () => undefined }), older = adapterFor(silent);
  t.after(() => older.close());
  await traderRequest(older, 'A'); silent.log.length = 0;
  await traderRequest(older, 'A');
  assert.deepEqual(kinds(silent.log), ['ensure:A', 'readView:A', 'identities:A']);
});

test('only a request confirmed live is remembered, and only when the gateway calls it a trader', async t => {
  const double = authorityDouble(), adapter = adapterFor(double);
  t.after(() => adapter.close());
  // A viewer: never remembered, every request is checked live.
  for (let n = 0; n < 3; n++) await adapter.runWithRequest({ headers: { authorization: bearer('V') } }, () => adapter.authenticate(undefined, { deferred: true }));
  assert.deepEqual(kinds(double.log), ['identities:V', 'identities:V', 'identities:V']);
  // A deferred request that saw no live answer yet cannot renew the bearer.
  await traderRequest(adapter, 'A');
  await adapter.runWithRequest({ headers: { authorization: bearer('A') } }, async () => {
    await adapter.authenticate(undefined, { deferred: true });
    assert.equal(adapter.metrics().identityBudget.deferred, 1);
    double.revoked.add('A'); adapter.remember();
    await assert.rejects(adapter.confirm(), error => error.code === 'AUTH_REQUIRED');
  });
  assert.equal(adapter.metrics().identityBudget.traderBearers, 0);
  // Without { deferred: true } (for example the portfolio re-check) the check is always live.
  double.revoked.delete('A'); await traderRequest(adapter, 'A'); double.log.length = 0;
  await adapter.runWithRequest({ headers: { authorization: bearer('A') } }, () => adapter.authenticate());
  assert.deepEqual(kinds(double.log), ['identities:A']);
});

test('the gateway: trader answers follow a live judgement; no command means a live check; viewers are unchanged', async t => {
  const double = authorityDouble(), adapter = adapterFor(double);
  const gateway = await createServer({ port: 0, autoPoll: false, financialEnabled: true, accountAuthority: adapter,
    tradePrincipals: [{ issuer: ISSUER, subject: 'trader-a' }, { issuer: ISSUER, subject: 'trader-b' }],
    hub: { metrics: {}, close() {}, catalogue: async () => [] } });
  t.after(async () => { await gateway.close(); await adapter.close(); });
  const call = (letter, route, init = {}) => fetch(`http://127.0.0.1:${gateway.port}/__stocks_global/${route}`, { ...init, headers: { authorization: bearer(letter), ...init.headers } });
  const first = await call('A', 'state');
  assert.equal(first.status, 200); const { token } = await first.json();
  assert.equal((await call('A', 'state')).status, 200);
  assert.deepEqual(kinds(double.log), ['identities:A', 'ensure:A', 'readView:A', 'readView:A']);
  // No command on this route: the answer waits for a live check.
  double.log.length = 0;
  assert.equal((await call('A', 'catalogue')).status, 200);
  assert.deepEqual(kinds(double.log), ['identities:A']);
  // An error answer before any command also follows a live check: signed out, it is 401, not the route's error.
  double.revoked.add('A'); double.log.length = 0;
  const refused = await call('A', 'orders', { method: 'POST', headers: { 'content-type': 'application/json', 'x-stocks-token': token }, body: '{not json' });
  assert.equal(refused.status, 401); assert.deepEqual(await refused.json(), { error: 'AUTH_REQUIRED' });
  assert.deepEqual(kinds(double.log), ['identities:A']);
  assert.equal((await call('A', 'state')).status, 401);
  assert.deepEqual(kinds(double.log), ['identities:A', 'identities:A']);
  // A viewer's every request is checked live before anything else, exactly as before.
  double.log.length = 0;
  for (let n = 0; n < 2; n++) { const viewer = await call('V', 'state'); assert.equal(viewer.status, 200); assert.equal((await viewer.json()).account.canTrade, false); }
  assert.deepEqual(kinds(double.log), ['identities:V', 'identities:V']);
});
