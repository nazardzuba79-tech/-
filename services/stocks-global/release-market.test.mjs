import test from 'node:test';
import assert from 'node:assert/strict';
import { createReleaseMarket } from './release-market.mjs';
import { VENUE_CATALOG } from './catalog.mjs';

// Issue #561: the release feed wiring. No network: these hubs are only constructed and inspected,
// or answer from their own fail-closed branch.
test('default OFF: no provider, every row SOURCE_UNAVAILABLE, venue/host settings refused while data is off', async () => {
  const hub = createReleaseMarket({});
  assert.equal(hub.metrics.dataEnabled, false);
  assert.ok((await hub.catalogue()).every(row => row.online === false && row.sourceError === 'SOURCE_UNAVAILABLE'));
  await assert.rejects(hub.quote('BINANCE:AAPLBUSDT'), /SOURCE_UNAVAILABLE/);
  await assert.rejects(hub.history('BINANCE:AAPLBUSDT', '15m'), /SOURCE_UNAVAILABLE/);
  for (const env of [{ STOCKS_VENUES_ENABLED: 'gate', STOCKS_VENUE_RIGHTS_CONFIRMED: 'gate' }, { STOCKS_BINANCE_HOST: 'data-api.binance.vision' }])
    assert.throws(() => createReleaseMarket(env), /STOCKS_RELEASE_FEED_CONFIG_INVALID/);
});

test('a venue opens only with the data-rights attestation; unknown venues and hosts are refused', () => {
  const on = { STOCKS_MARKET_DATA_ENABLED: 'true' };
  assert.deepEqual([...createReleaseMarket(on).venues], []);
  assert.throws(() => createReleaseMarket({ ...on, STOCKS_VENUES_ENABLED: 'gate' }), /DATA_RIGHTS_UNVERIFIED/);
  assert.throws(() => createReleaseMarket({ ...on, STOCKS_VENUES_ENABLED: 'gate,mexc', STOCKS_VENUE_RIGHTS_CONFIRMED: 'gate' }), /DATA_RIGHTS_UNVERIFIED/);
  assert.throws(() => createReleaseMarket({ ...on, STOCKS_VENUES_ENABLED: 'nasdaq', STOCKS_VENUE_RIGHTS_CONFIRMED: 'nasdaq' }), /VENUE_UNKNOWN/);
  assert.throws(() => createReleaseMarket({ ...on, STOCKS_BINANCE_HOST: 'binance.example.invalid' }), /STOCKS_RELEASE_FEED_CONFIG_INVALID/);
  const hub = createReleaseMarket({ ...on, STOCKS_VENUES_ENABLED: 'gate,mexc', STOCKS_VENUE_RIGHTS_CONFIRMED: 'gate,mexc', STOCKS_BINANCE_HOST: 'data-api.binance.vision' });
  assert.deepEqual([...hub.venues].sort(), ['gate', 'mexc']);
  assert.equal(hub.binanceHost, 'data-api.binance.vision');
  assert.equal(createReleaseMarket(on).binanceHost, 'api.binance.com');
});

test('an enabled venue reads only its own real symbols; a venue left out answers DATA_RIGHTS_UNVERIFIED without a request', async () => {
  const requests = [];
  const hub = createReleaseMarket({ STOCKS_MARKET_DATA_ENABLED: 'true', STOCKS_VENUES_ENABLED: 'gate', STOCKS_VENUE_RIGHTS_CONFIRMED: 'gate' });
  hub.fetch = async url => { requests.push(String(url)); return new Response('{}', { status: 503 }); };
  const mexc = VENUE_CATALOG.find(row => row.provider === 'mexc');
  await assert.rejects(hub.quote(mexc.id), /DATA_RIGHTS_UNVERIFIED/);
  await assert.rejects(hub.history(mexc.id, '15m'), /DATA_RIGHTS_UNVERIFIED/);
  assert.deepEqual(requests, []);
  const rows = await hub.catalogue();
  assert.ok(rows.some(row => row.provider === 'gate'));
  assert.ok(!rows.some(row => row.provider === 'mexc'));
  assert.ok(requests.every(url => /^https:\/\/(api\.gateio\.ws|api\.binance\.com|api\.bybit\.com|iss\.moex\.com)\//.test(url)), requests.join('\n'));
});
