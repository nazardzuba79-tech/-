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
const batch = 6,
  warmup = 144,
  measured = 1440;
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

async function launch(candidate) {
  const child = fork(__filename, ['serve', candidate ? root : baseline, candidate ? '1' : '0'], {
    stdio: ['ignore', 'ignore', 'inherit', 'ipc'],
  });
  const [message] = await Promise.race([
    once(child, 'message'),
    once(child, 'exit').then(([code]) => {
      throw Error('server exited ' + code);
    }),
  ]);
  return { child, origin: 'http://127.0.0.1:' + message.port, samples: [] };
}

async function traffic(run, step) {
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
      const res = await fetch(run.origin + url, { method: trader ? 'POST' : 'GET' });
      const body = await res.json();
      const duration = performance.now() - at;
      assert(
        res.ok && (crypto ? body.ticker?.pair === 'BTC/USDT' : trader ? body.accepted : body.length > 0),
      );
      if (crypto && step >= warmup) run.samples.push(duration);
    }),
  );
}

async function main() {
  if (process.argv[2] === 'serve') return serve(process.argv[3], process.argv[4] === '1');
  assert.equal(
    execFileSync('git', ['-C', baseline, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
    baseSha,
  );
  const plans = [
    ['baseline', 'control', 'candidate'],
    ['control', 'candidate', 'baseline'],
    ['candidate', 'baseline', 'control'],
    ['candidate', 'control', 'baseline'],
    ['baseline', 'candidate', 'control'],
    ['control', 'baseline', 'candidate'],
  ];
  // Keep three warm, independent servers. Interleave short batches in every order so
  // the identical A/A control and the candidate experience the same host load.
  // Only one server receives traffic at a time: exactly 50 viewers and two traders.
  const runs = {},
    rounds = [];
  try {
    for (const name of plans[0]) runs[name] = await launch(name === 'candidate');
    for (let step = 0; step < warmup + measured; step += batch) {
      const order = plans[(step / batch) % plans.length],
        round = { step };
      for (const name of order) {
        const run = runs[name],
          offset = run.samples.length;
        for (let i = 0; i < batch; i++) await traffic(run, step + i);
        if (step >= warmup) round[name] = percentile(run.samples.slice(offset), 0.95);
      }
      if (step >= warmup) rounds.push(round);
    }
    const results = {};
    for (const [name, run] of Object.entries(runs)) {
      const stats = once(run.child, 'message');
      run.child.send('stop');
      const [usage] = await stats;
      assert.equal(usage.fills, warmup + measured);
      assert.equal(run.samples.length, measured * 25);
      results[name] = { p95Ms: percentile(run.samples, 0.95), samples: run.samples.length, ...usage };
    }
    const baselineMs = results.baseline.p95Ms,
      controlMs = results.control.p95Ms,
      candidateMs = results.candidate.p95Ms;
    const changePct = 100 * (candidateMs / baselineMs - 1),
      calibrationPct = 100 * Math.abs(controlMs / baselineMs - 1);
    const report = {
      baseSha,
      scope:
        'Local ticker router, 25 crypto + 25 chart viewers + two in-memory matching clients. Fixed upstream; no database or external venue.',
      plans,
      batch,
      warmup,
      measured,
      rounds,
      results,
      baselineMs,
      controlMs,
      candidateMs,
      changePct,
      calibrationPct,
      pass: changePct <= 5 && calibrationPct <= 5,
      node: process.version,
    };
    fs.writeFileSync(output, JSON.stringify(report, null, 2) + '\n');
    console.log({ baselineMs, controlMs, candidateMs, changePct, calibrationPct, pass: report.pass });
    if (!report.pass) process.exitCode = 1;
  } finally {
    for (const run of Object.values(runs)) run.child.kill();
  }
}
main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
