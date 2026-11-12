const assert = require('node:assert/strict');
const cp = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');
const crypto = require('node:crypto');
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');
const root = path.resolve(__dirname, '../..');
function snapshot(repo) {
  const inc = (file) => require(path.join(repo, 'dist', file));
  const { listingSimulationConfig, parseListingConfig } = inc('services/listings/listingConfig');
  const { testMarketCandles } = inc('services/testMarkets/testMarketService');
  const assets = [
    inc('services/testMarkets/neurix').NEURIX,
    inc('services/testMarkets/testAssetConfig').VOLTORA,
  ];
  const dir = path.join(repo, 'config/test-markets');
  for (const file of fs
    .readdirSync(dir)
    .filter((f) => /^(eclv|nryia|aelri|qvtr|aith)[.-].*draft\.json$|^aith\.draft\.json$/.test(f))) {
    assets.push(
      listingSimulationConfig(parseListingConfig(JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8')))),
    );
  }
  const snapshots = {};
  for (const asset of assets) {
    const payload = [];
    for (const at of [-1, 0, 60001, 7200000, 86400000, 2 * 86400000 + 15999]) {
      for (const frame of ['1m', '5m', '15m', '1h', '4h', '1d'])
        payload.push(testMarketCandles(asset, frame, asset.listingAt + at, 80));
    }
    snapshots[asset.symbol] = sha(JSON.stringify([asset, payload]));
  }
  assert.equal(Object.keys(snapshots).length, 7);
  return snapshots;
}
if (process.argv[2]) console.log(JSON.stringify(snapshot(process.argv[2])));
else {
  const baseline = process.env.HISTORY20_BASELINE;
  const pin = cp.execFileSync('git', ['-C', baseline, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  assert.equal(pin, '0feb58bd856028dbc79cb8cc13bf68a9db907a61');
  const run = (repo) =>
    JSON.parse(cp.execFileSync(process.execPath, [__filename, repo], { encoding: 'utf8' }));
  const before = run(baseline),
    after = run(root);
  assert.deepEqual(before, after);
  fs.writeFileSync(
    path.join(root, 'output/history20-v2-verification/legacy.json'),
    JSON.stringify({ baseline: pin, before, after }, null, 2),
  );
  console.log('7 unchanged listing configs and 252 interval/time snapshots match pinned main');
}
