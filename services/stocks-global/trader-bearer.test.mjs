import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createAuthorityAdapter } from './authority-adapter.mjs';
import { accountId } from './accounts.mjs';
import { createServer } from './server.mjs';
import { CATALOG } from './catalog.mjs';

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

// Review 6489779311: two sessions of one trader share the principal's demand. A remembered bearer that was then
// signed out must not move that shared state (instrument, view, lease, market demand, readiness and observed quote,
// the other session's active request) before a live answer refuses it, by a state read or a refresh.
test('a signed-out remembered session cannot move the demand its still-valid sibling session shares', async t => {
  const X = 'BYBIT:AAPLXUSDT', Y = 'BYBIT:NVDAXUSDT', commands = [], identities = [], revoked = new Set();
  const subject = token => 'trader-a', snapshotOf = () => ({ schema: 2, revision: 1, serverTime: Date.now(), wallets: { USDT: { cash: '100.00000000', reserved: '0.00000000' }, USDC: { cash: '0.00000000', reserved: '0.00000000' } }, positions: {}, orders: [], fills: [], quotes: {} });
  const adapter = createAuthorityAdapter({ endpoint: 'http://127.0.0.1:1/api/v1/stocks-test-cash', issuer: ISSUER, gatewayKey: KEY, fetchImpl: async (url, options) => {
    if (url.endsWith('/identities')) {
      const tokens = JSON.parse(options.body).tokens; identities.push(tokens.map(token => token[0]).join(''));
      return new Response(JSON.stringify({ results: tokens.map(token => revoked.has(token[0]) ? { error: 'AUTH_REQUIRED' } : { issuer: ISSUER, subject: subject(token) }) }));
    }
    const token = options.headers.Authorization.slice(7), body = JSON.parse(options.body);
    commands.push({ bearer: token[0], type: body.type, input: body.input });
    if (revoked.has(token[0])) return new Response(JSON.stringify({ error: 'AUTH_REQUIRED' }), { status: 401 });
    const value = body.type === 'ensure' ? { id: accountId({ issuer: ISSUER, subject: subject(token) }) }
      : body.type === 'observe' ? { snapshot: { ...snapshotOf(), quotes: { [body.input.instrumentId]: body.input } }, observation: { durable: true } }
      : body.type === 'submitObserved' ? { result: { id: body.input.order.id, status: 'FILLED' }, snapshot: snapshotOf() } : snapshotOf();
    return new Response(JSON.stringify({ value, metrics: {}, actor: { issuer: ISSUER, subject: subject(token) } }));
  } });
  const demands = [], releases = [];let gate = null;
  const quoteOf = id => ({ instrumentId: id, provider: 'bybit', nativeCurrency: 'USDT', bid: '100', ask: '100', timestamp: Date.now(), receivedAt: Date.now(), verified: true, marketOpen: true, eventId: 'sibling-' + Date.now(), capacity: '1.00000000', prices: { USDT: { buy: '100', sell: '100' } }, fx: {} });
  const hub = { metrics: {}, close() {}, catalogue: async () => CATALOG.map(asset => ({ ...asset, online: true, exists: true })),
    quote: async id => { if (gate && id === X) await gate.promise; return quoteOf(id); },
    setStockDemand: (owner, id) => demands.push(id), releaseStockDemand: owner => releases.push(owner) };
  const gateway = await createServer({ port: 0, financialEnabled: true, accountAuthority: adapter, tradePrincipals: [{ issuer: ISSUER, subject: 'trader-a' }, { issuer: ISSUER, subject: 'trader-b' }], hub });
  t.after(async () => { gate?.resolve(); await gateway.close(); await adapter.close(); });
  const call = (letter, route, { view = 'terminal', body, token } = {}) => fetch(`http://127.0.0.1:${gateway.port}/__stocks_global/${route}`, {
    method: body ? 'POST' : 'GET', signal: AbortSignal.timeout(5000), headers: { authorization: bearer(letter), 'x-stocks-view': view, ...(body ? { 'content-type': 'application/json', 'x-stocks-token': token } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) })
    .then(async response => ({ status: response.status, body: await response.json() }));
  // Sessions P, R and S (to be signed out) and Q (stays valid) of the same trader, each confirmed live once and remembered.
  const first = {};
  for (const letter of ['P', 'R', 'S', 'Q']) { const r = await call(letter, 'state?id=' + encodeURIComponent(X)); assert.equal(r.status, 200, letter); assert.equal(r.body.errors[X], undefined); first[letter] = r.body.token; }
  assert.deepEqual(identities, ['P', 'R', 'S', 'Q']);
  // Q's next poll is in flight (held at the market read) when P, R and S are signed out and try to move the demand.
  let release; gate = { promise: new Promise(resolve => release = resolve), resolve: () => release() };
  const inFlight = call('Q', 'state?id=' + encodeURIComponent(X));
  await new Promise(resolve => setTimeout(resolve, 50));
  for (const letter of ['P', 'R', 'S']) revoked.add(letter);
  const demandsBefore = demands.length;
  // P: another instrument and view by a state read; R: a refresh of another instrument. Both are checked live first.
  assert.deepEqual(await call('P', 'state?id=' + encodeURIComponent(Y), { view: 'elsewhere' }), { status: 401, body: { error: 'AUTH_REQUIRED' } });
  assert.deepEqual(await call('R', 'refresh', { body: { id: Y }, token: first.R, view: 'elsewhere' }), { status: 401, body: { error: 'AUTH_REQUIRED' } });
  assert.deepEqual(identities.slice(-2), ['P', 'R'], 'each was refused by a live check before touching the demand');
  assert.equal(commands.some(c => (c.bearer === 'P' || c.bearer === 'R') && c.type !== 'ensure' && commands.indexOf(c) >= 8), false, 'no command for them');
  // S: the same instrument and view (the staged poll): its own observation is refused and nothing is renewed.
  gate.resolve(); gate = null;
  assert.deepEqual(await call('S', 'state?id=' + encodeURIComponent(X)), { status: 401, body: { error: 'AUTH_REQUIRED' } });
  const sibling = await inFlight;
  assert.equal(sibling.status, 200, 'the valid session\'s active poll was not aborted');
  assert.equal(sibling.body.errors[X], undefined); assert.equal(sibling.body.quotes[X].instrumentId, X);
  assert.deepEqual(demands.slice(demandsBefore).filter(id => id !== X), [], 'the market demand never moved to the other instrument');
  assert.deepEqual(releases, [], 'nothing released the shared demand');
  // The valid session still trades on its observed quote: the order is not source-blocked (instrument, lease, observation intact).
  const order = await call('Q', 'orders', { body: { id: 'sibling-order-0001', instrumentId: X, currency: 'USDT', side: 'BUY', type: 'MARKET', quantity: '0.01' }, token: sibling.body.token });
  assert.equal(order.status, 200);
  assert.equal(commands.filter(c => c.type === 'submitObserved').at(-1).input.sourceBlocked, false);
});

// Review 6490492921: a failed observation of an unconfirmed request waits for its live check; if a sibling session
// moved the shared demand meanwhile, the stale failure must not be recorded (errors, observed quote, observeFailed).
test('a failed observation that waited for its live check is dropped when a sibling moved the demand meanwhile', async t => {
  const X = 'BYBIT:AAPLXUSDT', Y = 'BYBIT:NVDAXUSDT', commands = [];
  let holdA = null, failX = false;
  const snapshotOf = () => ({ schema: 2, revision: 1, serverTime: Date.now(), wallets: { USDT: { cash: '100.00000000', reserved: '0.00000000' }, USDC: { cash: '0.00000000', reserved: '0.00000000' } }, positions: {}, orders: [], fills: [], quotes: {} });
  const adapter = createAuthorityAdapter({ endpoint: 'http://127.0.0.1:1/api/v1/stocks-test-cash', issuer: ISSUER, gatewayKey: KEY, fetchImpl: async (url, options) => {
    if (url.endsWith('/identities')) {
      const tokens = JSON.parse(options.body).tokens;
      if (holdA && tokens.some(token => token[0] === 'A')) { const gate = holdA; gate.entered(); await gate.released; }
      return new Response(JSON.stringify({ results: tokens.map(() => ({ issuer: ISSUER, subject: 'trader-a' })) }));
    }
    const token = options.headers.Authorization.slice(7), body = JSON.parse(options.body);
    commands.push({ bearer: token[0], type: body.type });
    const value = body.type === 'ensure' ? { id: accountId({ issuer: ISSUER, subject: 'trader-a' }) }
      : body.type === 'observe' ? { snapshot: { ...snapshotOf(), quotes: { [body.input.instrumentId]: body.input } }, observation: { durable: true } }
      : body.type === 'observeFailed' ? { snapshot: snapshotOf(), observation: { durable: true } } : snapshotOf();
    return new Response(JSON.stringify({ value, metrics: {}, actor: { issuer: ISSUER, subject: 'trader-a' } }));
  } });
  const quoteOf = id => ({ instrumentId: id, provider: 'bybit', nativeCurrency: 'USDT', bid: '100', ask: '100', timestamp: Date.now(), receivedAt: Date.now(), verified: true, marketOpen: true, eventId: 'stale-' + Date.now(), capacity: '1.00000000', prices: { USDT: { buy: '100', sell: '100' } }, fx: {} });
  const hub = { metrics: {}, close() {}, catalogue: async () => CATALOG.map(asset => ({ ...asset, online: true, exists: true })),
    quote: async id => quoteOf(id), quoteValid: (_q, id) => !(failX && id === X), setStockDemand() {}, releaseStockDemand() {} };
  const gateway = await createServer({ port: 0, financialEnabled: true, accountAuthority: adapter, tradePrincipals: [{ issuer: ISSUER, subject: 'trader-a' }, { issuer: ISSUER, subject: 'trader-b' }], hub });
  t.after(async () => { holdA?.release(); await gateway.close(); await adapter.close(); });
  const call = (letter, id) => fetch(`http://127.0.0.1:${gateway.port}/__stocks_global/state?id=${encodeURIComponent(id)}`, { signal: AbortSignal.timeout(5000), headers: { authorization: bearer(letter), 'x-stocks-view': 'terminal' } })
    .then(async response => ({ status: response.status, body: await response.json() }));
  // Sessions A and B of one trader, each confirmed live once on X and remembered.
  for (const letter of ['A', 'B']) assert.equal((await call(letter, X)).status, 200);
  // A polls X again (the staged poll); X's quote fails, so A's failure waits for A's live check, which is held.
  let entered, release; const enteredP = new Promise(resolve => entered = resolve), releasedP = new Promise(resolve => release = resolve);
  holdA = { entered, released: releasedP, release };
  failX = true;
  const staleA = call('A', X);
  await enteredP;
  // Meanwhile B moves the shared demand to Y (B's own live check is not held).
  failX = false;
  const moved = await call('B', Y);
  assert.equal(moved.status, 200); assert.equal(moved.body.errors[X], undefined);
  const before = commands.length;
  holdA = null; release();
  assert.equal((await staleA).status, 200);
  assert.deepEqual(commands.slice(before).filter(c => c.type === 'observeFailed'), [], 'the stale failure is not recorded');
  const after = await call('B', Y);
  assert.equal(after.status, 200);
  assert.equal(after.body.errors[X], undefined, 'no stale error in the shared demand');
});
