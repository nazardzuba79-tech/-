/**
 * Candle-realism preview and mathematics check. Local only; no network.
 *
 * Runs ONE base scenario (VTA's seed, listing time and price) as the plain
 * model and under each of the four profiles, then:
 *   - proves the mathematics is the same: every hourly anchor, P48, the price
 *     after 7 days and the 24h statistics' reference prices are identical;
 *   - measures candle character (bodies, shadows, quiet bars, counter bars);
 *   - renders the same windows with the production chart library.
 *
 *   node scripts/preview-candle-profiles.cjs   (QA_PLAYWRIGHT_MODULE optional)
 * Output: docs/qa/candle-realism/{metrics.json,*.png}
 */
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..');
require('ts-node').register({ transpileOnly: true, project: path.join(root, 'tsconfig.json') });
const { TestMarketSimulation, getCurrentTestMarketState, aggregateCandles, HOUR_MS, DAY_MS } = require('../src/services/testMarkets/testMarketSimulation');
const { VOLTORA } = require('../src/services/testMarkets/testAssetConfig');
const { SIMULATION_PROFILES } = require('../src/services/testMarkets/candleRealism');

const out = path.resolve(process.env.QA_OUTPUT || 'docs/qa/candle-realism');
fs.mkdirSync(out, { recursive: true });
const base = { ...VOLTORA, simulationProfile: undefined, candleRealism: undefined };
const L = base.listingAt;
const variants = [['PLAIN (model, before)', { ...base, candleRealism: false }], ...SIMULATION_PROFILES.map((p) => [p, { ...base, simulationProfile: p }])];

/* ---- 1. The mathematics is the same ---- */
const plain = new TestMarketSimulation(variants[0][1]);
const anchors = Array.from({ length: 7 * 24 + 1 }, (_, h) => plain.priceAt(L + h * HOUR_MS));
const statTimes = [0.5, 12, 24, 30.25, 48, 75, 120].map((h) => L + h * HOUR_MS);
const metrics = { scenario: { seed: base.seed, listingAt: new Date(L).toISOString(), initialPrice: base.initialPrice }, variants: {} };
for (const [name, asset] of variants) {
  const sim = new TestMarketSimulation(asset);
  for (let h = 0; h < anchors.length; h++) assert.equal(sim.priceAt(L + h * HOUR_MS), anchors[h], `${name}: hour ${h} anchor moved`);
  for (let h = 0; h < 7 * 24; h++) {
    const a = plain.hourPlan(h), b = sim.hourPlan(h);
    assert.equal(b.regime, a.regime); assert.equal(b.logReturn, a.logReturn); assert.equal(b.open, a.open);
    assert.equal(b.boundaries[12], a.boundaries[12]);
  }
  // Closed hours only: inside a still-forming hour the path (by design) differs.
  const hourly = aggregateCandles(sim.candles5m(L + 7 * DAY_MS), HOUR_MS).slice(0, 7 * 24);
  const plainHourly = aggregateCandles(plain.candles5m(L + 7 * DAY_MS), HOUR_MS).slice(0, 7 * 24);
  assert.deepEqual(hourly.map((c) => [c.open, c.close]), plainHourly.map((c) => [c.open, c.close]));
  const states = statTimes.map((t) => getCurrentTestMarketState(new TestMarketSimulation(asset), t));
  const plainStates = statTimes.map((t) => getCurrentTestMarketState(new TestMarketSimulation(variants[0][1]), t));
  // At a whole hour the 24h reference is an anchor, so it is identical; inside an hour it is a point
  // on the reshaped path and is reported, not asserted.
  states.forEach((s, i) => { if ((statTimes[i] - L) % HOUR_MS === 0 || statTimes[i] - DAY_MS <= L) assert.equal(s.openPrice24h, plainStates[i].openPrice24h); });

  /* ---- 2. Candle character over the first 48 hours (units: the hour's model volatility) ---- */
  const candles = sim.candles5m(L + 48 * HOUR_MS - 1);
  const rows = candles.map((c, i) => {
    const plan = plain.hourPlan(Math.floor(i / 12));
    const top = Math.max(c.open, c.close), bottom = Math.min(c.open, c.close);
    return { regime: plan.regime, body: Math.abs(Math.log(c.close / c.open)) / plan.sigma, range: Math.log(c.high / c.low) / plan.sigma,
      upper: Math.log(c.high / top) / plan.sigma, lower: Math.log(bottom / c.low) / plan.sigma, up: c.close > c.open };
  });
  const share = (f) => Number((rows.filter(f).length / rows.length * 100).toFixed(1));
  const q = (xs, p) => { const s = xs.slice().sort((a, b) => a - b); return Number(s[Math.floor(p * (s.length - 1))].toFixed(2)); };
  const bodies = rows.map((r) => r.body);
  const mean = bodies.reduce((a, b) => a + b, 0) / bodies.length;
  const sd = Math.sqrt(bodies.reduce((a, b) => a + (b - mean) ** 2, 0) / bodies.length);
  metrics.variants[name] = {
    anchorsIdentical: true,
    P48: anchors[48], priceAfter7d: anchors[7 * 24],
    change24hAt: Object.fromEntries(statTimes.map((t, i) => [`+${(t - L) / HOUR_MS}h`, Number(states[i].change24hPercent.toFixed(4))])),
    high24hAt48h: states[4].high24h, low24hAt48h: states[4].low24h,
    bodyP10: q(bodies, 0.1), bodyMedian: q(bodies, 0.5), bodyP90: q(bodies, 0.9), bodyP99: q(bodies, 0.99),
    bodyVariation: Number((sd / mean).toFixed(2)),
    impulseBarsPct: share((r) => r.body > 3),
    greenImpulseInImpulseHoursPct: Number((rows.filter((r) => r.regime === 'impulse' && r.up && r.body > 3).length / rows.filter((r) => r.regime === 'impulse').length * 100).toFixed(1)),
    longUpperWickPct: share((r) => r.upper > 1.5 && r.upper > 2 * r.body),
    longLowerWickPct: share((r) => r.lower > 1.5 && r.lower > 2 * r.body),
    quietBarsPct: share((r) => r.range < 0.9),
    counterBarsInImpulseHoursPct: Number((rows.filter((r) => r.regime === 'impulse' && !r.up).length / rows.filter((r) => r.regime === 'impulse').length * 100).toFixed(1)),
  };
}
fs.writeFileSync(path.join(out, 'metrics.json'), `${JSON.stringify(metrics, null, 2)}\n`);
console.log('mathematics identical for all variants; P48 =', anchors[48], 'price after 7d =', anchors[7 * 24]);
console.table(Object.fromEntries(Object.entries(metrics.variants).map(([k, v]) => [k, {
  bodyMed: v.bodyMedian, bodyP90: v.bodyP90, variation: v.bodyVariation, impulse: v.impulseBarsPct,
  upperWick: v.longUpperWickPct, lowerWick: v.longLowerWickPct, quiet: v.quietBarsPct, counter: v.counterBarsInImpulseHoursPct }])));

/* ---- 3. Pictures: the same windows, drawn by the production chart library ---- */
async function render() {
  const { chromium } = require(process.env.QA_PLAYWRIGHT_MODULE || '/opt/node22/lib/node_modules/playwright');
  const lib = fs.readFileSync(path.join(root, 'frontend/node_modules/lightweight-charts/dist/lightweight-charts.standalone.production.js'), 'utf8');
  const series = (asset, from, to, interval) => {
    // Closed candles only, so each window ends on a model anchor.
    const five = new TestMarketSimulation(asset).candles5m(to, from).filter((c) => c.openTime < to);
    return aggregateCandles(five, interval).map((c) => ({ time: c.openTime / 1000, open: c.open, high: c.high, low: c.low, close: c.close }));
  };
  const windows = [
    ['5m-hours-20-24', L + 20 * HOUR_MS, L + 24 * HOUR_MS, 5 * 60_000, '5m · hours 20–24 after listing'],
    ['5m-hours-37-41', L + 37 * HOUR_MS, L + 41 * HOUR_MS, 5 * 60_000, '5m · hours 37–41 (VTA today)'],
    ['15m-first-48h', L, L + 48 * HOUR_MS, 15 * 60_000, '15m · first 48 hours'],
    ['1h-first-7d', L, L + 7 * DAY_MS, HOUR_MS, '1h · first 7 days: identical trend'],
  ];
  const browser = await chromium.launch();
  try {
    for (const [file, from, to, interval, label] of windows) {
      const data = variants.map(([name, asset]) => ({ name, candles: series(asset, from, to, interval) }));
      const page = await browser.newPage({ viewport: { width: 1500, height: 1240 }, locale: 'en-GB' });
      page.on('pageerror', (e) => console.error('PAGE', e.message)); page.on('console', (m) => m.type() === 'error' && console.error('CONSOLE', m.text()));
      await page.setContent(`<html><body style="margin:0;background:#0b0e14;color:#c9d1e0;font:13px system-ui">
        <div style="padding:8px 14px;font-weight:600">VTA seed · ${label} · same base scenario for every row</div><div id="rows"></div></body></html>`);
      await page.addScriptTag({ content: lib });
      await page.evaluate((payload) => {
        const rows = document.getElementById('rows');
        for (const { name, candles } of payload) {
          const box = document.createElement('div');
          box.style.cssText = 'position:relative;height:238px;border-top:1px solid #1d2330';
          box.innerHTML = `<div style="position:absolute;z-index:3;left:12px;top:6px;font-weight:600">${name}</div>`;
          rows.appendChild(box);
          const chart = LightweightCharts.createChart(box, { width: 1500, height: 238, layout: { background: { color: '#0b0e14' }, textColor: '#8a94a8' }, localization: { locale: 'en-GB' },
            grid: { vertLines: { color: '#141926' }, horzLines: { color: '#141926' } }, timeScale: { timeVisible: true, secondsVisible: false }, rightPriceScale: { borderColor: '#1d2330' } });
          const s = chart.addSeries(LightweightCharts.CandlestickSeries, { upColor: '#16c784', downColor: '#ea3943', wickUpColor: '#16c784', wickDownColor: '#ea3943', borderVisible: false,
            priceFormat: { type: 'price', precision: 4, minMove: 0.0001 } });
          s.setData(candles);
          chart.timeScale().fitContent();
        }
      }, data);
      await page.waitForTimeout(400);
      await page.screenshot({ path: path.join(out, `${file}.png`) });
      await page.close();
      console.log('wrote', path.relative(root, path.join(out, `${file}.png`)));
    }
  } finally { await browser.close(); }
}
render().catch((error) => { console.error(error); process.exitCode = 1; });
