// Independent end-to-end oracle: compare the serving path against raw CSV at
// every UTC bucket, including the first/last observed minute and empty-volume bars.
const assert = require('node:assert/strict');
const fs = require('node:fs'),
  path = require('node:path'),
  crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const root = path.resolve(__dirname, '../..'),
  dir = process.env.HISTORY20_PRIVATE_REGIME_DIR;
const catalog = require('../../src/shared/history20Regimes.json');
const { regimeCandles } = require('../../dist/services/listings/history20RegimePack');
const baseline = process.env.HISTORY20_BASELINE;
assert.equal(
  execFileSync('git', ['-C', baseline, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
  '0feb58bd856028dbc79cb8cc13bf68a9db907a61',
);
const { testMarketCandles } = require(path.join(baseline, 'dist/services/testMarkets/testMarketService'));
const {
  listingPreviewAssetConfig,
  parseListingConfig,
  withStableProfile,
} = require('../../dist/services/listings/listingConfig');
const { REGIME_MINUTES } = require('../../dist/shared/history20MinuteReplay');
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');
const close = (a, b) => assert(Math.abs(a - b) <= 2e-10 * Math.max(1, Math.abs(b)), a + ' != ' + b);
const evidence = path.join(root, 'output/history20-v2-verification');
fs.mkdirSync(evidence, { recursive: true });
const report = [];
for (const [index, record] of catalog.records.entries()) {
  const start = Date.parse(record.start),
    end = Date.parse(record.endExclusive);
  const asset = listingPreviewAssetConfig(
    withStableProfile(
      parseListingConfig({
        schemaVersion: 1,
        symbol: 'TST',
        name: 'Offline QA',
        initialPrice: '2',
        logo: null,
        listingAt: new Date(start).toISOString(),
        displayTimeZone: 'UTC',
        ownerAllocation: '0',
        tradable: false,
        seedMode: 'manual',
        seed: 'regime-proof-705',
        history20Regime: { version: 2, id: record.id },
      }),
      null,
      index,
    ),
  );
  const source = [];
  for (const archive of record.sources.filter((s) => s.url.includes('/1m/'))) {
    const file = path.join(dir, path.basename(archive.url));
    assert.equal(sha(fs.readFileSync(file)), archive.sha256);
    const csv = execFileSync('tar', ['-xOf', file, path.basename(file, '.zip') + '.csv'], {
      encoding: 'utf8',
      maxBuffer: 32 * 1024 ** 2,
    });
    for (const line of csv.trim().split(/\r?\n/)) {
      const v = line.split(',').slice(0, 6).map(Number);
      if (v[0] >= start && v[0] < end) source.push(v);
    }
  }
  assert.equal(source.length, record.rows);
  const mean = source.reduce((sum, r) => sum + r[5], 0) / source.length,
    scale = 2 / source[0][1];
  const counts = {};
  for (const [interval, minutes] of Object.entries(REGIME_MINUTES)) {
    const expected = [];
    for (let i = 0; i < source.length; i += minutes) {
      const group = source.slice(i, i + minutes);
      expected.push({
        time: group[0][0] / 1000,
        open: group[0][1] * scale,
        high: Math.max(...group.map((r) => r[2])) * scale,
        low: Math.min(...group.map((r) => r[3])) * scale,
        close: group.at(-1)[4] * scale,
        volume: group.reduce((a, r) => a + r[5], 0) / mean,
      });
    }
    let compared = 0;
    for (let from = 0; from < expected.length; from += 500) {
      const batch = expected.slice(from, from + 500);
      const until = batch.at(-1).time * 1000 + minutes * 60000;
      const actual = regimeCandles(asset, interval, until, 501).filter(
        (r) => r.time >= batch[0].time && r.time < until / 1000,
      );
      assert.equal(actual.length, batch.length);
      for (let j = 0; j < batch.length; j++) {
        assert.equal(actual[j].time, batch[j].time);
        for (const field of ['open', 'high', 'low', 'close', 'volume'])
          close(actual[j][field], batch[j][field]);
      }
      compared += actual.length;
    }
    counts[interval] = compared;
    if (interval === record.sourceFrame) {
      const { history20Regime, ...legacy } = asset;
      const comparison = [];
      for (const phase of [0.15, 0.5, 0.95]) {
        const stop = Math.max(1, Math.floor(expected.length * phase)),
          first = Math.max(0, stop - 60);
        const until = expected[stop - 1].time * 1000 + minutes * 60000;
        const right = regimeCandles(asset, interval, until, 61).filter(
          (r) => r.time >= expected[first].time && r.time < until / 1000,
        );
        const before = testMarketCandles(
          { ...legacy, simulationProfile: 'CALM_TREND', naturalWicks: { futureFrom: start } },
          interval,
          until,
          61,
        ).filter((r) => r.time >= expected[first].time && r.time < until / 1000);
        comparison.push({ phase, source: expected.slice(first, stop), right, before });
      }
      fs.writeFileSync(path.join(evidence, record.id + '.json'), JSON.stringify(comparison));
    }
  }
  report.push({ id: record.id, sha256: record.sha256, counts });
}
fs.writeFileSync(path.join(evidence, 'parity.json'), JSON.stringify(report, null, 2));
console.log(
  'All',
  report.length,
  'source windows matched in all 6 frames:',
  report.reduce((a, r) => a + Object.values(r.counts).reduce((x, y) => x + y, 0), 0),
  'compared OHLCV bars',
);
