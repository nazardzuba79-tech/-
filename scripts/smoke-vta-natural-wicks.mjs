#!/usr/bin/env node
/** Public GET-only proof for the release marked [verify-vta-wicks].
 * The 95 fixed bars must still fit in the public API's latest-1000 window.
 * node scripts/smoke-vta-natural-wicks.mjs [http://127.0.0.1:<fixture-port>]
 * EXPECTED_API_COMMIT optionally pins the public Render health commit.
 * No credentials are read or sent; response bodies are never logged.
 */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

const cutoff = Date.parse('2026-09-29T14:45:00Z') / 1000;
const start = Date.parse('2026-09-28T15:00:00Z') / 1000;
const interval = 15 * 60;
const fields = ['time', 'open', 'high', 'low', 'close', 'volume'];
const candlePath = '/api/v1/market/test-assets/VTA-USDT/candles?interval=15m&limit=1000';

async function main() {
  const base = new URL(process.argv[2] ?? 'https://api.voltextech.net');
  const localFixture = base.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(base.hostname);
  assert((base.origin === 'https://api.voltextech.net' || localFixture)
    && !base.username && !base.password && base.pathname === '/' && !base.search && !base.hash,
  'Use the public Render origin or a local HTTP fixture');
  const expectedCommit = process.env.EXPECTED_API_COMMIT?.trim();
  assert(!expectedCommit || /^[a-f0-9]{40}$/.test(expectedCommit), 'EXPECTED_API_COMMIT must be a full commit SHA');

  const fixture = JSON.parse(readFileSync(new URL('../docs/qa/simulation-natural-wicks/after.json', import.meta.url), 'utf8'));
  assert.equal(Date.parse(fixture.requestCutoffUtc) / 1000, cutoff, 'The reference cutoff must stay fixed');
  const expected = fixture.cases.find((entry) => entry.id === 'vta-history')?.candles15m
    .map((candle) => ({ time: candle.openTime / 1000, ...Object.fromEntries(fields.slice(1).map((field) => [field, candle[field]])) }));
  assert.equal(expected?.length, 95, 'The reference must contain all 95 closed candles');
  expected.forEach((candle, index) => assert.equal(candle.time, start + index * interval, 'Reference candles must be contiguous'));

  async function get(path) {
    const response = await fetch(new URL(path, base), {
      method: 'GET', redirect: 'error', cache: 'no-store',
      headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(15000),
    });
    assert.equal(response.status, 200, `Public GET ${path} returned HTTP ${response.status}`);
    try { return await response.json(); } catch { throw new Error(`Public GET ${path} did not return JSON`); }
  }
  const health = await get('/health');
  assert.equal(health.status, 'ok', 'Render health must be ok');
  assert(/^[a-f0-9]{40}$/.test(health.commit), 'Render health must identify its deployed commit');
  if (expectedCommit) assert.equal(health.commit, expectedCommit, 'Render is not serving the expected commit');

  const result = await get(candlePath);
  assert.equal(result.source, 'simulation');
  assert.equal(result.pair, 'VTA/USDT');
  assert.equal(result.interval, '15m');
  assert.equal(result.isTestAsset, true);
  assert(Number.isFinite(result.serverTime) && result.serverTime >= cutoff * 1000, 'The API must be past the fixed closed cutoff');
  assert(Array.isArray(result.candles), 'The public candle response must contain an array');
  const actual = result.candles.filter((candle) => candle.time >= start && candle.time < cutoff);
  assert.equal(actual.length, expected.length, 'All 95 fixed closed candles must still be returned');
  actual.forEach((candle, index) => {
    for (const field of fields) {
      assert(Number.isFinite(candle[field]), `Non-finite ${field} in closed candle ${index}`);
      assert.equal(candle[field], expected[index][field], `Closed candle ${index} ${field} differs from the reference`);
    }
  });
  const digest = createHash('sha256').update(JSON.stringify(actual.map((candle) => fields.map((field) => candle[field])))).digest('hex');
  console.log(JSON.stringify({ apiCommit: health.commit, fixedClosedCandles: actual.length,
    cutoffUtc: new Date(cutoff * 1000).toISOString(), fields, sha256: digest }));
}

main().catch((error) => { console.error(`VTA rollout smoke failed: ${error.message.split('\n')[0]}`); process.exitCode = 1; });
