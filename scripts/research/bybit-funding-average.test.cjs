// node --test scripts/research/bybit-funding-average.test.cjs
//
// The averaging method on a SYNTHETIC local stand-in for Bybit's v5 market
// API (same paths, same response shape, same paging). No network: every
// request goes to 127.0.0.1. The numbers below are worked by hand.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

const DAY = 86_400_000;
const END = '2026-10-01', end = Date.parse(`${END}T00:00:00Z`), start = end - 30 * DAY;
const script = path.join(__dirname, 'bybit-funding-average.mjs');

/** A Bybit look-alike: contracts with a funding interval (minutes) and a rate by record index. */
function serve(contracts) {
  const records = {};
  for (const [symbol, c] of Object.entries(contracts)) {
    records[symbol] = [];
    for (let t = start - DAY, i = 0; t < end + DAY; t += c.interval * 60_000, i++) if (!c.skip?.(t)) records[symbol].push({ symbol, fundingRate: c.rate(i), fundingRateTimestamp: String(t) });
  }
  const server = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://local');
    res.setHeader('content-type', 'application/json');
    const send = result => res.end(JSON.stringify({ retCode: 0, retMsg: 'OK', result }));
    if (u.pathname === '/v5/market/instruments-info') return send({ category: 'linear', nextPageCursor: '', list: Object.entries(contracts).map(([symbol, c]) => ({
      symbol, contractType: 'LinearPerpetual', quoteCoin: 'USDT', settleCoin: 'USDT', status: 'Trading', launchTime: String(c.launch ?? start - 400 * DAY), fundingInterval: String(c.interval) })) });
    if (u.pathname === '/v5/market/tickers') return send({ category: 'linear', list: Object.keys(contracts).map((symbol, i) => ({ symbol, turnover24h: String(1e9 / (i + 1)) })) });
    if (u.pathname === '/v5/market/funding/history') {
      const from = Number(u.searchParams.get('startTime')), to = Number(u.searchParams.get('endTime')), limit = Number(u.searchParams.get('limit'));
      const list = records[u.searchParams.get('symbol')].filter(r => +r.fundingRateTimestamp >= from && +r.fundingRateTimestamp <= to)
        .sort((a, b) => b.fundingRateTimestamp - a.fundingRateTimestamp).slice(0, limit);
      return send({ category: 'linear', list });
    }
    res.statusCode = 404; res.end('{}');
  });
  return new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve(server)));
}
async function run(contracts, top = 10) {
  const server = await serve(contracts);
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'bybit-funding-'));
  try {
    // Asynchronous on purpose: the stand-in server lives in this process.
    const child = spawn(process.execPath, [script, '--end', END, '--days', '30', '--top', String(top), '--out', out, '--base', `http://127.0.0.1:${server.address().port}`], { stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';
    child.stderr.on('data', chunk => { stderr += chunk; });
    const status = await new Promise(resolve => child.once('exit', resolve));
    const file = path.join(out, `bybit-funding-${END}.json`);
    return { status, stderr, json: fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : null };
  } finally { server.close(); fs.rmSync(out, { recursive: true, force: true }); }
}
const base = {
  BTCUSDT: { interval: 480, rate: () => '0.0001' },
  ETHUSDT: { interval: 480, rate: i => (i % 2 ? '0.0001' : '-0.00005') },
  SOLUSDT: { interval: 480, rate: () => '-0.00002' },
};

test('per-contract arithmetic mean with signs, then an equal-weight mean, rounded to 8 places', async () => {
  // BTC 0.0001; ETH alternates 0.0001 / -0.00005 over 90 records = 0.000025; SOL -0.00002.
  // (0.0001 + 0.000025 - 0.00002) / 3 = 0.000035
  const { status, json } = await run(base);
  assert.equal(status, 0);
  const s = json.summary;
  assert.deepEqual(s.assets.map(a => [a.symbol, a.records, a.mean8hEquivalent]), [
    ['BTCUSDT', 90, '0.000100000000'], ['ETHUSDT', 90, '0.000025000000'], ['SOLUSDT', 90, '-0.000020000000']]);
  assert.equal(s.totalRecords, 270);
  assert.equal(s.fixedRate8h, '0.00003500');
  assert.equal(s.usable, true);
  assert.deepEqual(s.window, { start: '2026-09-01T00:00:00.000Z', endExclusive: '2026-10-01T00:00:00.000Z', days: 30, rule: 'start <= fundingRateTimestamp < end' });
});

test('a 4h contract is normalised to its 8h equivalent; a contract listed inside the window is left out', async () => {
  // XRP settles 0.00005 every 4h = 0.0001 per 8h. NEW launched 5 days before the end.
  // (0.0001 + 0.000025 - 0.00002 + 0.0001) / 4 = 0.00005125
  const { status, json } = await run({ ...base, XRPUSDT: { interval: 240, rate: () => '0.00005' }, NEWUSDT: { interval: 60, rate: () => '0.001', launch: end - 5 * DAY } });
  assert.equal(status, 0);
  const xrp = json.summary.assets.find(a => a.symbol === 'XRPUSDT');
  assert.deepEqual([xrp.records, xrp.intervalsMinutes, xrp.plainMeanOfSettledRates, xrp.mean8hEquivalent], [180, [240], '0.000050000000', '0.000100000000']);
  assert.equal(json.summary.assets.some(a => a.symbol === 'NEWUSDT'), false);
  assert.equal(json.summary.fixedRate8h, '0.00005125');
});

test('a missing settlement makes the run unusable instead of averaging around the hole', async () => {
  const hole = start + 10 * DAY;
  const { status, json } = await run({ ...base, BTCUSDT: { ...base.BTCUSDT, skip: t => t === hole } });
  assert.equal(status, 2);
  assert.equal(json.summary.usable, false);
  assert.deepEqual(json.summary.incomplete, ['BTCUSDT']);
});
