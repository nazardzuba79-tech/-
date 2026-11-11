// Isolated paired 50+2 benchmark. Always keep every round, including failures.
// Build the pinned detached baseline and this worktree before running.
const path = require('node:path');
const fs = require('node:fs');
const { execFileSync, fork } = require('node:child_process');
const { once } = require('node:events');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '../..');
const baseline = process.env.HISTORY20_BASELINE;
const baseSha = '0feb58bd856028dbc79cb8cc13bf68a9db907a61';
const output = path.join(root, 'output/history20-v2-benchmark.json');
const start = Date.UTC(2026, 10, 15);
const warmup = 120,
  measured = 800;
const percentile = (samples, p) => samples.slice().sort((a, b) => a - b)[Math.ceil(samples.length * p) - 1];

async function serve(dir, candidate) {
  const inc = (file) => require(path.join(dir, 'dist', file));
  const express = require('express'),
    BigNumber = require('bignumber.js');
  const { marketRouter } = inc('api/routes/market');
  const { testMarketCandles } = inc('services/testMarkets/testMarketService');
  const { MatchingEngine } = inc('matching-engine/MatchingEngine');
  const registry = candidate ? inc('services/listings/history20RegimePack') : null;
  const replay = registry?.privateRegimes();
  const engine = new MatchingEngine(),
    qty = new BigNumber(1),
    price = new BigNumber(10);
  const app = express();
  // A warm local venue double isolates CPU and event-loop contention from upstream latency.
  app.use(
    marketRouter(
      { getTicker: async (pair) => ({ pair, last: '10', source: 'local-benchmark' }) },
      {},
      {},
      {},
    ),
  );
  const { withStableProfile, listingSimulationConfig, listingPreviewAssetConfig, parseListingConfig } = inc(
    'services/listings/listingConfig',
  );
  const assets = Array.from({ length: 20 }, (_, i) => {
    const cfg = parseListingConfig({
      schemaVersion: 1,
      symbol: 'BH' + i,
      name: 'Bench',
      logo: null,
      initialPrice: '2',
      ownerAllocation: '0',
      seedMode: 'manual',
      seed: 'bench-regime-' + i,
      tradable: false,
      displayTimeZone: 'UTC',
      listingAt: new Date(start).toISOString(),
      ...(candidate ? { history20Regime: { version: 2, id: 'AUTO' } } : {}),
    });
    const config = withStableProfile(cfg, null, i);
    return candidate ? listingPreviewAssetConfig(config) : listingSimulationConfig(config);
  });
  app.get('/view/:index/:step', (req, res) => {
    const asset = assets[Number(req.params.index) % 20],
      step = Number(req.params.step);
    res.json(
      testMarketCandles(
        asset,
        ['5m', '15m', '1h'][step % 3],
        start + 86400000 + step * 10000,
        96,
        replay?.get(asset.history20Regime),
      ),
    );
  });
  let serial = 0,
    fills = 0;
  app.post('/isolated-order/:side', (req, res) => {
    const side = req.params.side;
    const order = {
      id: 'bench-' + ++serial,
      userId: side,
      pair: 'FIXTURE/TEST',
      side,
      type: 'LIMIT',
      price,
      originalQuantity: qty,
      remainingQuantity: qty,
      status: 'OPEN',
      createdAt: serial,
      updatedAt: serial,
    };
    fills += engine.submitOrder(order).trades.length;
    res.json({ accepted: true });
  });
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  process.send({ port: server.address().port });
  process.once('message', () => {
    process.send({ fills, rss: process.memoryUsage().rss, cpu: process.cpuUsage() });
    server.closeAllConnections();
    server.close();
    process.disconnect();
  });
}

async function measure(candidate) {
  const child = fork(__filename, ['serve', candidate ? root : baseline, candidate ? '1' : '0'], {
    stdio: ['ignore', 'ignore', 'inherit', 'ipc'],
  });
  const first = await Promise.race([
    once(child, 'message'),
    once(child, 'exit').then(([code]) => {
      throw Error('server exited ' + code);
    }),
  ]);
  const origin = 'http://127.0.0.1:' + first[0].port;
  const samples = [];
  try {
    for (let step = 0; step < warmup + measured; step++) {
      await Promise.all(
        Array.from({ length: 52 }, async (_, i) => {
          const trader = i >= 50,
            crypto = !trader && i % 2 === step % 2;
          const url = crypto
            ? '/market/external/tickers/BTC-USDT'
            : trader
              ? '/isolated-order/' + (i === 50 ? 'SELL' : 'BUY')
              : '/view/' + i + '/' + step;
          const at = performance.now();
          const res = await fetch(origin + url, { method: trader ? 'POST' : 'GET' });
          const body = await res.json();
          const duration = performance.now() - at;
          assert(
            res.ok && (crypto ? body.ticker?.pair === 'BTC/USDT' : trader ? body.accepted : body.length > 0),
          );
          if (crypto && step >= warmup) samples.push(duration);
        }),
      );
    }
    const stats = once(child, 'message');
    child.send('stop');
    const [usage] = await stats;
    assert.equal(usage.fills, warmup + measured);
    return { p95Ms: percentile(samples, 0.95), samples: samples.length, ...usage };
  } finally {
    child.kill();
  }
}
async function main() {
  if (process.argv[2] === 'serve') return serve(process.argv[3], process.argv[4] === '1');
  if (process.argv[2] === 'trial') {
    const result = await measure(process.argv[3] === '1');
    process.send(result);
    process.disconnect();
    return;
  }
  assert.equal(
    execFileSync('git', ['-C', baseline, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
    baseSha,
  );
  // Each trial uses a fresh load-generator process. A persistent client biases later
  // trials with open pools, JIT state, and delayed garbage collection. Compare two
  // identical baseline builds and the candidate in a balanced three-way crossover.
  async function trial(candidate) {
    const child = fork(__filename, ['trial', candidate ? '1' : '0'], {
      stdio: ['ignore', 'ignore', 'inherit', 'ipc'],
    });
    const [result] = await Promise.race([
      once(child, 'message'),
      once(child, 'exit').then(([code]) => {
        throw Error('client exited ' + code);
      }),
    ]);
    return result;
  }
  const plans = [
    ['baseline', 'control', 'candidate'],
    ['control', 'candidate', 'baseline'],
    ['candidate', 'baseline', 'control'],
    ['candidate', 'control', 'baseline'],
    ['baseline', 'candidate', 'control'],
    ['control', 'baseline', 'candidate'],
  ];
  const rounds = [];
  for (const order of plans) {
    const row = {};
    for (const name of order) row[name] = await trial(name === 'candidate');
    rounds.push(row);
    console.log('paired round', rounds.length, row.baseline.p95Ms, row.control.p95Ms, row.candidate.p95Ms);
  }
  const median = (key) => {
    const sorted = rounds.map((r) => r[key].p95Ms).sort((a, b) => a - b);
    return (sorted[2] + sorted[3]) / 2;
  };
  const baselineMs = median('baseline'),
    controlMs = median('control'),
    candidateMs = median('candidate');
  const changePct = 100 * (candidateMs / baselineMs - 1),
    calibrationPct = 100 * Math.abs(controlMs / baselineMs - 1);
  const report = {
    baseSha,
    scope:
      'Loopback; 25 crypto ticker readers + 25 listing chart readers + 2 in-memory matching clients; fixed upstream; no DB or external venue.',
    plans,
    warmup,
    measured,
    rounds,
    baselineMs,
    controlMs,
    candidateMs,
    changePct,
    calibrationPct,
    pass: changePct <= 5 && calibrationPct <= 5,
    node: process.version,
  };
  fs.writeFileSync(output, JSON.stringify(report, null, 2) + '\n');
  console.log({ baselineMs, candidateMs, changePct });
  if (!report.pass) process.exitCode = 1;
}
main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
