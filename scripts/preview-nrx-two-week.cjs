/**
 * Offline NRX scheduled-market review. Uses the real compiled canonical engine;
 * no production access, financial API, database, or remote chart library.
 * Build backend first: npm run build
 * node scripts/preview-nrx-two-week.cjs [--screenshots] [--serve] [--port=4410]
 * QA_OUT and QA_PLAYWRIGHT_MODULE may override local artifact/runtime paths.
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const { pathToFileURL } = require('node:url');

const root = path.resolve(__dirname, '..');
const out = path.resolve(process.env.QA_OUT || path.join(root, 'output/nrx-two-week'));
const { NEURIX } = require('../dist/services/testMarkets/neurix');
const { simulationFor, aggregateCandles, getCurrentTestMarketState, TICK_MS, MINUTE_MS, CANDLE_MS, HOUR_MS, DAY_MS } = require('../dist/services/testMarkets/testMarketSimulation');
const { nrxPublicResponse } = require('../dist/services/testMarkets/nrxPublic');
const { testMarketCandles } = require('../dist/services/testMarkets/testMarketService');
const schedule = NEURIX.scheduledScenario;
assert(schedule && schedule.version === 3, 'Build the candidate with NEURIX.scheduledScenario version3 first.');
assert.equal(schedule.endAt - schedule.from, 14 * DAY_MS, 'The review covers exactly14days.');

const intervals = { '1m': MINUTE_MS, '5m': CANDLE_MS, '15m': 15 * MINUTE_MS, '1h': HOUR_MS };
const phases = [
  { id: 'growth1', label: 'Перший імпульс', from: schedule.from, to: schedule.firstTargetAt },
  { id: 'pause', label: 'Нічний діапазон', from: schedule.firstTargetAt, to: schedule.breakoutAt },
  { id: 'growth2', label: 'Другий імпульс', from: schedule.breakoutAt, to: schedule.secondTargetAt },
  { id: 'growth3', label: 'Третій імпульс', from: schedule.secondTargetAt, to: schedule.thirdTargetAt },
  { id: 'range', label: 'Верхній діапазон', from: schedule.thirdTargetAt, to: schedule.rangeEndAt },
  { id: 'selloff', label: 'Зниження', from: schedule.rangeEndAt, to: schedule.selloffEndAt },
  { id: 'accumulation', label: 'Подальша консолідація', from: schedule.selloffEndAt, to: schedule.endAt },
];
const variants = { before: { ...NEURIX, scheduledScenario: undefined }, after: NEURIX };
const checks = [];
const check = (name, pass, details = {}) => checks.push({ name, pass: Boolean(pass), ...details });
const near = (a, b, absolute = 1e-8) => Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) <= Math.max(absolute, Math.abs(b) * 1e-8);
const sum = (rows, key) => rows.reduce((value, row) => value + row[key], 0);
const quantile = (values, q) => {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.round((sorted.length - 1) * q)];
};
const kyiv = value => new Intl.DateTimeFormat('uk-UA', { timeZone: 'Europe/Kyiv', dateStyle: 'short', timeStyle: 'short', hour12: false }).format(value);

function candleMetrics(rows) {
  const body = rows.map(c => Math.abs(c.close - c.open));
  const ranges = rows.map(c => c.high - c.low);
  const upper = rows.map(c => c.high - Math.max(c.open, c.close));
  const lower = rows.map(c => Math.min(c.open, c.close) - c.low);
  const nonzeroBody = rows.flatMap((_, i) => body[i] > 0 ? [(upper[i] + lower[i]) / body[i]] : []);
  const wickShare = rows.flatMap((_, i) => ranges[i] > 0 ? [(upper[i] + lower[i]) / ranges[i]] : []);
  let longestColorRun = 0, run = 0, previous = 0;
  for (const c of rows) {
    const sign = Math.sign(c.close - c.open);
    run = sign && sign === previous ? run + 1 : sign ? 1 : 0;
    longestColorRun = Math.max(longestColorRun, run); previous = sign;
  }
  return {
    candles: rows.length, open: rows[0]?.open ?? null, close: rows.at(-1)?.close ?? null,
    high: rows.length ? Math.max(...rows.map(c => c.high)) : null,
    low: rows.length ? Math.min(...rows.map(c => c.low)) : null,
    baseVolume: sum(rows, 'volume'), quoteVolume: sum(rows, 'quoteVolume'),
    bullish: rows.filter(c => c.close > c.open).length, bearish: rows.filter(c => c.close < c.open).length,
    zeroBody: body.filter(value => value === 0).length,
    bothWicks: rows.filter((_, i) => upper[i] > 0 && lower[i] > 0).length,
    wickShareP50: quantile(wickShare, .5), wickShareP90: quantile(wickShare, .9),
    wickToBodyP50: quantile(nonzeroBody, .5), wickToBodyP90: quantile(nonzeroBody, .9),
    wickToBodyP99: quantile(nonzeroBody, .99), longestColorRun,
  };
}

// The20% reference is an observation threshold, not a clipping constraint.
// Time outside is sampled from completed canonical10s tick closes; the tick's
// internal high/low does not imply that price spent the full10s at that extreme.
function observedRangeMetrics(simulation, phase, rows, center) {
  const lower = center * (1 - schedule.rangeFraction), upper = center * (1 + schedule.rangeFraction);
  const outside = price => price < lower || price > upper;
  let sampledTicks = 0, outsideTicks = 0, active = null, boundaryHitTicks = 0, boundaryRun = 0, longestBoundaryRun = 0;
  const excursions = [];
  for (let at = phase.from + TICK_MS; at <= phase.to; at += TICK_MS) {
    sampledTicks++;
    const price = simulation.priceAt(at);
    const boundaryHit = near(price, lower) || near(price, upper);
    boundaryRun = boundaryHit ? boundaryRun + 1 : 0;
    if (boundaryHit) boundaryHitTicks++;
    longestBoundaryRun = Math.max(longestBoundaryRun, boundaryRun);
    if (outside(price)) {
      outsideTicks++;
      if (!active) active = { from: at - TICK_MS, sampledTicks: 0 };
      active.sampledTicks++;
    } else if (active) {
      excursions.push({ ...active, recoveredAt: at, sampledMinutes: active.sampledTicks * TICK_MS / MINUTE_MS });
      active = null;
    }
  }
  if (active) excursions.push({ ...active, recoveredAt: null, sampledMinutes: active.sampledTicks * TICK_MS / MINUTE_MS });
  const bodyLow = Math.min(...rows.map(c => Math.min(c.open, c.close)));
  const bodyHigh = Math.max(...rows.map(c => Math.max(c.open, c.close)));
  const wickLow = Math.min(...rows.map(c => c.low)), wickHigh = Math.max(...rows.map(c => c.high));
  return {
    center, thresholdFraction: schedule.rangeFraction, thresholdLow: lower, thresholdHigh: upper,
    oneMinuteCandles: rows.length, bodyLow, bodyHigh, wickLow, wickHigh,
    bodyDeviationPercent: { low: (bodyLow / center - 1) * 100, high: (bodyHigh / center - 1) * 100 },
    wickDeviationPercent: { low: (wickLow / center - 1) * 100, high: (wickHigh / center - 1) * 100 },
    closeOutsideCount: rows.filter(c => outside(c.close)).length,
    bodyOutsideCount: rows.filter(c => outside(c.open) || outside(c.close)).length,
    wickOutsideCount: rows.filter(c => c.low < lower || c.high > upper).length,
    sampledTickMs: TICK_MS, sampledTicks, outsideTicks, boundaryHitTicks, longestBoundaryRun,
    sampledOutsideMinutes: outsideTicks * TICK_MS / MINUTE_MS,
    sampledOutsidePercent: 100 * outsideTicks / sampledTicks,
    recoveredExcursions: excursions.filter(e => e.recoveredAt !== null).length,
    unrecoveredExcursions: excursions.filter(e => e.recoveredAt === null).length,
    maxExcursionSampledMinutes: Math.max(0, ...excursions.map(e => e.sampledMinutes)), excursions,
  };
}

function validateSeries(name, rows, size) {
  const faults = [];
  for (let i = 0; i < rows.length; i++) {
    const c = rows[i], previous = rows[i - 1];
    if (![c.openTime, c.open, c.high, c.low, c.close, c.volume, c.quoteVolume].every(Number.isFinite)
      || c.low <= 0 || c.high < Math.max(c.open, c.close) || c.low > Math.min(c.open, c.close)
      || c.volume < 0 || c.quoteVolume < 0 || c.openTime < schedule.from || c.openTime >= schedule.endAt
      || (previous && (c.openTime !== previous.openTime + size || !near(previous.close, c.open)))) faults.push(c.openTime);
  }
  check(`${name}: positive finite OHLCV, continuous time/open, no future candle`, faults.length === 0, { violations: faults.length, examples: faults.slice(0, 5) });
  check(`${name}: complete14-day candle count`, rows.length === 14 * DAY_MS / size, { count: rows.length });
}

// Independent reducer: the production aggregateCandles intentionally treats5m
// input as canonical and therefore cannot validate a1m→5m reconstruction.
function aggregateMinuteRows(rows, size) {
  const result = [];
  for (const c of rows) {
    const openTime = Math.floor(c.openTime / size) * size;
    const previous = result.at(-1);
    if (!previous || previous.openTime !== openTime) result.push({ ...c, openTime });
    else {
      previous.high = Math.max(previous.high, c.high); previous.low = Math.min(previous.low, c.low);
      previous.close = c.close; previous.volume += c.volume; previous.quoteVolume += c.quoteVolume;
    }
  }
  return result;
}

function compareAggregation(name, actual, expected, size) {
  const differences = [];
  const fields = ['open', 'high', 'low', 'close', 'volume', 'quoteVolume'];
  // Each1m and5m volume is separately rounded by the canonical engine.
  // Bound the maximum sum error from those declared4dp/2dp precisions.
  const roundedComponents = size / MINUTE_MS + size / CANDLE_MS;
  const roundingBound = { volume: roundedComponents * .00005 + 1e-7, quoteVolume: roundedComponents * .005 + 1e-6 };
  const maxDifference = { volume: 0, quoteVolume: 0 };
  if (actual.length !== expected.length) differences.push({ reason: 'length', actual: actual.length, expected: expected.length });
  for (let i = 0; i < Math.min(actual.length, expected.length); i++) {
    if (actual[i].openTime !== expected[i].openTime) differences.push({ index: i, field: 'openTime' });
    for (const field of fields) {
      const delta = Math.abs(actual[i][field] - expected[i][field]);
      if (field in maxDifference) maxDifference[field] = Math.max(maxDifference[field], delta);
      const matches = field in roundingBound ? delta <= roundingBound[field] : near(actual[i][field], expected[i][field]);
      if (!matches) differences.push({ index: i, field, actual: actual[i][field], expected: expected[i][field] });
    }
  }
  check(name, differences.length === 0, { violations: differences.length, maxVolumeDifference: maxDifference, roundingBound, examples: differences.slice(0, 8) });
}

async function readPublic(pathname, now) {
  const response = nrxPublicResponse(new Request(`https://offline.invalid${pathname}`), () => now);
  assert(response, `Public NRX route missing: ${pathname}`);
  assert.equal(response.status, 200, `Public NRX route failed: ${pathname}`);
  return response.json();
}

async function makeVariant(name, asset) {
  const simulation = simulationFor(asset);
  const closed = rows => rows.filter(c => c.openTime >= schedule.from && c.openTime < schedule.endAt);
  const one = closed(simulation.candles1m(schedule.endAt, schedule.from));
  const five = closed(simulation.candles5m(schedule.endAt, schedule.from));
  const series = { '1m': one, '5m': five, '15m': aggregateCandles(five, 15 * MINUTE_MS), '1h': aggregateCandles(five, HOUR_MS) };
  for (const [interval, rows] of Object.entries(series)) validateSeries(`${name}/${interval}`, rows, intervals[interval]);
  compareAggregation(`${name}:1m → canonical5m`, aggregateMinuteRows(one, CANDLE_MS), five, CANDLE_MS);
  compareAggregation(`${name}:1m →15m`, aggregateMinuteRows(one, 15 * MINUTE_MS), series['15m'], 15 * MINUTE_MS);
  compareAggregation(`${name}:1m →1h`, aggregateMinuteRows(one, HOUR_MS), series['1h'], HOUR_MS);
  const phaseSeries = Object.fromEntries(phases.map(phase => {
    const phaseMinute = simulation.candles1m(phase.to, phase.from).filter(c => c.openTime < phase.to);
    const phaseFive = simulation.candles5m(phase.to, Math.floor(phase.from / HOUR_MS) * HOUR_MS).filter(c => c.openTime < phase.to);
    const candles = { '1m': phaseMinute, '5m': phaseFive, '15m': aggregateCandles(phaseFive, 15 * MINUTE_MS), '1h': aggregateCandles(phaseFive, HOUR_MS) };
    return [phase.id, Object.fromEntries(Object.entries(candles).map(([tf, rows]) => [tf, rows.filter(c => c.openTime >= Math.floor(phase.from / intervals[tf]) * intervals[tf])]))];
  }));
  const rangeCenters = {
    pause: asset.initialPrice * (1 + schedule.firstGainPercent / 100),
    range: asset.initialPrice * (1 + schedule.thirdGainPercent / 100),
    accumulation: asset.initialPrice * (1 + schedule.thirdGainPercent / 100) * (1 - schedule.selloffFraction),
  };
  const phaseMetrics = phases.map(phase => ({ ...phase, fromKyiv: kyiv(phase.from), toKyiv: kyiv(phase.to),
    priceAtStart: simulation.priceAt(phase.from), priceAtEnd: simulation.priceAt(phase.to),
    intervalMetrics: Object.fromEntries(Object.entries(phaseSeries[phase.id]).map(([interval, rows]) => [interval, candleMetrics(rows)])),
    observedRange: phase.id in rangeCenters ? observedRangeMetrics(simulation, phase,
      one.filter(c => c.openTime >= phase.from && c.openTime + MINUTE_MS <= phase.to), rangeCenters[phase.id]) : null,
  }));
  const snapshots = [];
  for (const now of [schedule.from, ...phases.map(phase => phase.to)]) {
    const state = getCurrentTestMarketState(simulation, now);
    const window = simulation.candles5m(now, now - DAY_MS);
    const lastTrade = simulation.recentTrades(now, 1)[0];
    check(`${name}:ticker/canonical last @${new Date(now).toISOString()}`, near(state.lastPrice, simulation.priceAt(now)) && near(state.lastPrice, window.at(-1).close)
      && (!lastTrade || near(state.lastPrice, Number(lastTrade.price))));
    check(`${name}:rolling24h OHLCV @${new Date(now).toISOString()}`,
      near(state.high24h, Math.max(...window.map(c => c.high))) && near(state.low24h, Math.min(...window.map(c => c.low)))
      && near(state.volume24h, sum(window, 'volume'), .00011) && near(state.quoteVolume24h, sum(window, 'quoteVolume'), .011));
    if (name === 'after') {
      const { ticker } = await readPublic('/market/ticker/NRX-USDT', now);
      check(`after:public ticker/canonical @${new Date(now).toISOString()}`,
        [['lastPrice', 'lastPrice'], ['high24h', 'high24h'], ['low24h', 'low24h'], ['volume24h', 'volume24h'], ['quoteVolume24h', 'quoteVolume24h']]
          .every(([publicKey, stateKey]) => near(Number(ticker[publicKey]), state[stateKey], publicKey === 'quoteVolume24h' ? .011 : .00011)));
      for (const interval of Object.keys(intervals)) {
        const response = await readPublic(`/market/test-assets/NRX-USDT/candles?interval=${interval}&limit=1000`, now);
        const expected = testMarketCandles(asset, interval, now, 1000);
        check(`after:public ${interval} canonical payload @${new Date(now).toISOString()}`, JSON.stringify(response.candles) === JSON.stringify(expected));
      }
    }
    snapshots.push({ at: now, atKyiv: kyiv(now), ...state });
  }
  return { series, phaseSeries, metrics: Object.fromEntries(Object.entries(series).map(([interval, rows]) => [interval, candleMetrics(rows)])), phaseMetrics, snapshots };
}

function htmlFor(data, library) {
  const payload = JSON.stringify(data).replace(/</g, '\\u003c');
  return `<!doctype html><html lang="uk"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>NRX ·14-day simulation review</title>
<style>*{box-sizing:border-box}body{margin:0;background:#0d1117;color:#e7ecf3;font:14px system-ui,sans-serif}header,main{max-width:1600px;margin:auto;padding:22px 28px}header{border-bottom:1px solid #26303d}.brand{font-weight:750;letter-spacing:2px;color:#f4ce70}.badge{display:inline-block;margin-left:15px;padding:5px 9px;border:1px solid #9a7935;border-radius:4px;color:#f4ce70;font-size:11px;font-weight:650;letter-spacing:.6px}h1{font-size:24px;margin:14px 0 8px}p{color:#9caabd;line-height:1.6;margin:0}button,select{font:inherit;color:#c6d0de;border:1px solid #334153;background:#17202b;border-radius:5px;padding:9px 12px;cursor:pointer}button[aria-pressed=true]{color:#f4ce70;border-color:#b78f38;background:#2a2518}.controls,.phases{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px}.controls{align-items:center;justify-content:space-between}.frames{display:flex;gap:6px}.phases button{font-size:12px}.summary{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin:18px 0}.metric{padding:13px 15px;border:1px solid #283342;border-radius:6px}.metric small{display:block;color:#96a4b6;font-size:12px;margin-bottom:8px}.metric strong{font-size:20px;font-variant-numeric:tabular-nums}.chart-shell{border:1px solid #283342;border-radius:7px;overflow:hidden;background:#10151d}.chart-caption{display:flex;justify-content:space-between;padding:12px 16px;border-bottom:1px solid #283342;color:#a8b4c4;font-size:12px;gap:15px}#chart{height:600px}.note{font-size:12px;margin-top:10px}.table-wrap{overflow:auto;margin-top:24px;border:1px solid #283342;border-radius:6px}table{border-collapse:collapse;width:100%;font-size:12px;white-space:nowrap}th,td{text-align:right;padding:11px 13px;border-bottom:1px solid #24303d;font-variant-numeric:tabular-nums}th:first-child,td:first-child{text-align:left}th{color:#9facbe;font-weight:500;background:#131b26}td{color:#d5dfeb}.pass{color:#26bb8c}.fail{color:#ff667e}.footer{margin-top:20px;font-size:12px;overflow-wrap:anywhere}.legend{display:flex;gap:15px;margin-top:9px;color:#93a1b3;font-size:12px}@media(max-width:650px){header,main{padding:16px}h1{font-size:20px}.badge{margin:10px 0 0;display:block;width:max-content}.summary{grid-template-columns:repeat(2,1fr)}.metric strong{font-size:17px}#chart{height:430px}.controls{align-items:stretch}.frames{flex-wrap:wrap}.chart-caption{flex-direction:column;gap:4px}.phases{gap:6px}.phases button{padding:7px 9px}}</style>
<header><span class="brand">VOLTEX / NRX</span><span class="badge">SIMULATION · OFFLINE · REVIEW ONLY</span><h1>Чотирнадцять днів: ціна, свічки та обсяг</h1><p>Локальний сценарій, а не прогноз або активований ринок. Усі свічки й показники взяті з одного канонічного генератора.</p><p id="dates"></p></header>
<main><div class="controls"><div class="frames" id="frames"></div><select id="variant" aria-label="Варіант"><option value="after">Запропонований сценарій</option><option value="before">Базовий генератор без нового сценарію</option></select></div><div class="phases" id="phases"></div><div class="summary"><div class="metric"><small>Остання закрита свічка</small><strong id="last"></strong></div><div class="metric"><small>Від ціни лістингу 0.80 USDT</small><strong id="gain"></strong></div><div class="metric"><small>Діапазон обраного вікна</small><strong id="range"></strong></div><div class="metric"><small>Канонічні перевірки</small><strong id="checks"></strong></div></div><section class="chart-shell"><div class="chart-caption"><span id="caption"></span><span>Звичайна шкала · Авто · час UTC</span></div><div id="chart"></div></section><div class="legend"><span>Зелена: close&gt;open</span><span>Червона: close&lt;open</span><span>Обсяг: NRX</span></div><p class="note">Колесо миші змінює масштаб, перетягування переміщує графік. Кнопки фаз повертають точне вікно. На 1m/5m наблизьте фазу, щоб розглянути хвости; дані не підміняються іншим таймфреймом.</p><div class="table-wrap"><table id="metrics"></table></div><div class="table-wrap"><table id="ranges"></table></div><p class="note">±20% — орієнтовний коридор, а не жорсткі стінки. Метрики показують фактичні виходи тіл і хвостів. Час поза коридором оцінюється за закриттями канонічних 10-секундних тіків; внутрішній хвіст тіка не рахується як повні 10 секунд поза коридором.</p><p class="note">Wick/body обчислюється лише для ненульового тіла. Хвости, кольори та серії свічок показані як спостережувані метрики, а не доказ «реалістичності». Фазові вікна використовують канонічні свічки станом на кінець фази, включно з останньою частковою свічкою. Діапазони фаз підписані за Europe/Kyiv; вісь графіка — UTC.</p><div class="footer" id="footer"></div></main>
<script>${library}</script><script>
const DATA=${payload};
const fmt=(n,d=4)=>new Intl.NumberFormat('en-US',{maximumFractionDigits:d}).format(n);
const date=n=>new Intl.DateTimeFormat('uk-UA',{timeZone:'Europe/Kyiv',dateStyle:'short',timeStyle:'short',hour12:false}).format(n);
let interval='1h',variant='after',phase='all';
const chart=LightweightCharts.createChart(document.querySelector('#chart'),{autoSize:true,layout:{background:{color:'#10151d'},textColor:'#a9b5c7',fontFamily:'system-ui'},grid:{vertLines:{color:'#1d2632'},horzLines:{color:'#1d2632'}},rightPriceScale:{mode:0,autoScale:true,borderColor:'#2a3441'},timeScale:{timeVisible:true,secondsVisible:false,borderColor:'#2a3441'},crosshair:{mode:0},localization:{priceFormatter:p=>fmt(p,6)}});
const candles=chart.addSeries(LightweightCharts.CandlestickSeries,{upColor:'#26a69a',downColor:'#ef5350',borderVisible:false,wickUpColor:'#26a69a',wickDownColor:'#ef5350',priceLineVisible:false});
const volume=chart.addSeries(LightweightCharts.HistogramSeries,{priceFormat:{type:'volume'},priceLineVisible:false,lastValueVisible:false},1);chart.panes()[1].setHeight(110);
for(const value of ['1m','5m','15m','1h']){const button=document.createElement('button');button.textContent=value;button.dataset.interval=value;button.onclick=()=>{interval=value;render()};document.querySelector('#frames').append(button)}
for(const p of [{id:'all',label:'Усі 14 днів'},...DATA.phases]){const button=document.createElement('button');button.textContent=p.label;button.dataset.phase=p.id;button.onclick=()=>{phase=p.id;render()};document.querySelector('#phases').append(button)}
document.querySelector('#variant').onchange=e=>{variant=e.target.value;render()};
document.querySelector('#dates').textContent=date(DATA.schedule.from)+' — '+date(DATA.schedule.endAt)+' · Europe/Kyiv';
function render(){const data=DATA.variants[variant],all=data.series[interval],p=DATA.phases.find(p=>p.id===phase),start=p?.from??DATA.schedule.from,end=p?.to??DATA.schedule.endAt,visible=p?data.phaseSeries[p.id][interval]:all;
candles.setData(visible.map(c=>({time:c.openTime/1000,open:c.open,high:c.high,low:c.low,close:c.close})));
volume.setData(visible.map(c=>({time:c.openTime/1000,value:c.volume,color:c.close>=c.open?'#236256':'#6c353b'})));
chart.priceScale('right').applyOptions({autoScale:true,mode:0});chart.timeScale().setVisibleRange({from:visible[0].openTime/1000,to:visible.at(-1).openTime/1000});
document.querySelectorAll('[data-interval]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.interval===interval)));document.querySelectorAll('[data-phase]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.phase===phase)));
const last=visible.at(-1)?.close??0;document.querySelector('#last').textContent=fmt(last,6)+' USDT';document.querySelector('#gain').textContent=(last>=DATA.initialPrice?'+':'')+fmt((last/DATA.initialPrice-1)*100,2)+'%';
document.querySelector('#range').textContent=fmt(Math.min(...visible.map(c=>c.low)),4)+' — '+fmt(Math.max(...visible.map(c=>c.high)),4);
document.querySelector('#checks').textContent=DATA.checks.filter(c=>c.pass).length+'/'+DATA.checks.length;document.querySelector('#checks').className=DATA.checks.every(c=>c.pass)?'pass':'fail';
document.querySelector('#caption').textContent='NRX/USDT · '+interval+' · '+(p?.label??'Усі 14 днів')+' · '+date(start)+' — '+date(end);
const metrics=p?data.phaseMetrics.find(v=>v.id===phase).intervalMetrics:data.metrics;
document.querySelector('#metrics').innerHTML='<thead><tr><th>Таймфрейм</th><th>Свічок</th><th>Зелені / червоні</th><th>Нульове тіло</th><th>Обидва хвости</th><th>Wick/body P50</th><th>Wick/body P90</th><th>Найдовша серія</th><th>Обсяг NRX</th></tr></thead><tbody>'+Object.entries(metrics).map(([tf,m])=>'<tr><td>'+tf+'</td><td>'+fmt(m.candles,0)+'</td><td>'+m.bullish+' / '+m.bearish+'</td><td>'+m.zeroBody+'</td><td>'+m.bothWicks+'</td><td>'+(m.wickToBodyP50==null?'—':fmt(m.wickToBodyP50,2))+'</td><td>'+(m.wickToBodyP90==null?'—':fmt(m.wickToBodyP90,2))+'</td><td>'+m.longestColorRun+'</td><td>'+fmt(m.baseVolume,2)+'</td></tr>').join('')+'</tbody>';
document.querySelector('#footer').textContent='Source SHA: '+DATA.sourceHead+(DATA.workingTreeDirty?' · local changes (source hashes in metrics.json)':'')+' · Canonical ticks →1m/5m →15m/1h. Жодних production-запитів або фінансових операцій.';
const rangeRows=data.phaseMetrics.filter(v=>v.observedRange&&(!p||p.id===v.id));
document.querySelector('#ranges').closest('.table-wrap').hidden=rangeRows.length===0;
const signed=n=>(n>=0?'+':'')+fmt(n,2)+'%';
document.querySelector('#ranges').innerHTML='<thead><tr><th>Діапазон</th><th>Тіла: min / max</th><th>Хвости: min / max</th><th>1m хвости поза20%</th><th>Час поза20%, хв</th><th>Частка поза20%</th><th>Найдовший вихід, хв</th><th>Повернулось / виходів</th></tr></thead><tbody>'+rangeRows.map(p=>{const r=p.observedRange;return '<tr><td>'+p.label+'</td><td>'+signed(r.bodyDeviationPercent.low)+' / '+signed(r.bodyDeviationPercent.high)+'</td><td>'+signed(r.wickDeviationPercent.low)+' / '+signed(r.wickDeviationPercent.high)+'</td><td>'+r.wickOutsideCount+' / '+r.oneMinuteCandles+'</td><td>'+fmt(r.sampledOutsideMinutes,2)+'</td><td>'+fmt(r.sampledOutsidePercent,3)+'%</td><td>'+fmt(r.maxExcursionSampledMinutes,2)+'</td><td>'+r.recoveredExcursions+' / '+r.excursions.length+'</td></tr>'}).join('')+'</tbody>';
window.__NRX_PREVIEW_STATE__={interval,variant,phase,count:all.length,visible:visible.length};window.__NRX_PREVIEW_READY__=true;}
render();
</script></html>`;
}

async function screenshots(htmlPath) {
  const { chromium } = require(process.env.QA_PLAYWRIGHT_MODULE || 'playwright');
  const browser = await chromium.launch({ headless: true });
  const result = { pageErrors: [], consoleErrors: [], externalRequests: [], screenshots: [] };
  try {
    for (const width of [1440, 390]) {
      const context = await browser.newContext({ viewport: { width, height: width === 1440 ? 1080 : 844 }, reducedMotion: 'reduce', serviceWorkers: 'block' });
      await context.route('**/*', route => {
        if (route.request().url() === pathToFileURL(htmlPath).href) return route.continue();
        result.externalRequests.push(route.request().url()); return route.abort();
      });
      if (context.routeWebSocket) await context.routeWebSocket('**/*', socket => { result.externalRequests.push(socket.url()); socket.close(); });
      const page = await context.newPage(); page.on('pageerror', error => result.pageErrors.push(error.message));
      page.on('console', message => { if (message.type() === 'error') result.consoleErrors.push(message.text()); });
      await page.goto(pathToFileURL(htmlPath).href);
      await page.waitForFunction(() => window.__NRX_PREVIEW_READY__ === true);
      for (const [phase, interval] of [['all', '1h'], ['growth1', '1m'], ['pause', '5m'], ['growth2', '5m'], ['growth3', '5m'], ['range', '15m'], ['selloff', '5m'], ['accumulation', '1h']]) {
        await page.locator(`[data-phase="${phase}"]`).click();
        await page.locator(`[data-interval="${interval}"]`).click();
        await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false, 'Preview horizontal overflow');
        const name = `${phase}-${interval}-${width}.png`;
        await page.screenshot({ path: path.join(out, name), fullPage: width === 390, animations: 'disabled' });
        result.screenshots.push({ width, phase, interval, file: name, ...await page.evaluate(() => window.__NRX_PREVIEW_STATE__) });
      }
      await context.close();
    }
  } finally { await browser.close(); }
  fs.writeFileSync(path.join(out, 'browser-report.json'), JSON.stringify(result, null, 2));
  assert.deepEqual(result.pageErrors, []); assert.deepEqual(result.consoleErrors, []); assert.deepEqual(result.externalRequests, []);
  return result;
}

(async () => {
  fs.mkdirSync(out, { recursive: true });
  const data = { sourceHead: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
    workingTreeDirty: Boolean(execFileSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8' }).trim()),
    canonicalSourceSha256: Object.fromEntries(['neurix.ts', 'simulationSchedule.ts', 'testMarketSimulation.ts', 'testAssetConfig.ts', 'testMarketService.ts', 'nrxPublic.ts']
      .map(file => [file, crypto.createHash('sha256').update(fs.readFileSync(path.join(root, 'src/services/testMarkets', file))).digest('hex')])),
    simulation: true, reviewOnly: true, productionAccess: false, financialWrites: 0,
    initialPrice: NEURIX.initialPrice, schedule, phases, variants: {}, checks };
  for (const [name, asset] of Object.entries(variants)) data.variants[name] = await makeVariant(name, asset);
  const candidate = simulationFor(NEURIX);
  const firstTarget = NEURIX.initialPrice * (1 + schedule.firstGainPercent / 100);
  const secondTarget = NEURIX.initialPrice * (1 + schedule.secondGainPercent / 100);
  const thirdTarget = NEURIX.initialPrice * (1 + schedule.thirdGainPercent / 100);
  check('First target gain is relative to listing price', near(candidate.priceAt(schedule.firstTargetAt), firstTarget), { expected: firstTarget, actual: candidate.priceAt(schedule.firstTargetAt) });
  check('Second target gain is relative to listing price', near(candidate.priceAt(schedule.secondTargetAt), secondTarget), { expected: secondTarget, actual: candidate.priceAt(schedule.secondTargetAt) });
  check('Third target gain is relative to listing price', near(candidate.priceAt(schedule.thirdTargetAt), thirdTarget), { expected: thirdTarget, actual: candidate.priceAt(schedule.thirdTargetAt) });
  check('Selloff target is60% below third target', near(candidate.priceAt(schedule.selloffEndAt), thirdTarget * (1 - schedule.selloffFraction)), { expected: thirdTarget * (1 - schedule.selloffFraction), actual: candidate.priceAt(schedule.selloffEndAt) });
  const baseline = simulationFor(variants.before);
  const prior = simulation => simulation.candles1m(schedule.from, NEURIX.listingAt).filter(c => c.openTime + MINUTE_MS <= schedule.from);
  check('Canonical history before scheduled start is unchanged', JSON.stringify(prior(candidate)) === JSON.stringify(prior(baseline)));
  check('Scheduled start preserves original canonical anchor', near(candidate.priceAt(schedule.from), baseline.priceAt(schedule.from)));
  const observedRanges = data.variants.after.phaseMetrics.filter(phase => phase.observedRange);
  for (const phase of observedRanges) {
    const metrics = phase.observedRange;
    check(`${phase.id}: at least95% of sampled tick closes within approximate±20% reference`, metrics.sampledOutsidePercent <= 5, { sampledOutsidePercent: metrics.sampledOutsidePercent });
    check(`${phase.id}: excursions beyond20% recover within20minutes`, metrics.unrecoveredExcursions === 0 && metrics.maxExcursionSampledMinutes <= 20,
      { excursions: metrics.excursions.length, unrecovered: metrics.unrecoveredExcursions, maxSampledMinutes: metrics.maxExcursionSampledMinutes });
    check(`${phase.id}: no repeated tick-close piling at exact±20% walls`, metrics.longestBoundaryRun <= 1,
      { boundaryHitTicks: metrics.boundaryHitTicks, longestBoundaryRun: metrics.longestBoundaryRun });
  }
  check('Ranges include occasional actual tick-price overshoot, not only cosmetic wicks', observedRanges.some(phase => phase.observedRange.outsideTicks > 0));
  const libraryPath = path.join(root, 'frontend/node_modules/lightweight-charts/dist/lightweight-charts.standalone.production.js');
  const library = fs.readFileSync(libraryPath, 'utf8');
  data.chartLibrarySha256 = crypto.createHash('sha256').update(library).digest('hex');
  fs.writeFileSync(path.join(out, 'metrics.json'), JSON.stringify(data, null, 2));
  const htmlPath = path.join(out, 'index.html'); fs.writeFileSync(htmlPath, htmlFor(data, library));
  if (process.argv.includes('--screenshots')) await screenshots(htmlPath);
  const failures = checks.filter(value => !value.pass);
  console.log(JSON.stringify({ artifact: htmlPath, sourceHead: data.sourceHead, checks: checks.length, passed: checks.length - failures.length, failures, candleCounts: Object.fromEntries(Object.entries(data.variants.after.series).map(([tf, candles]) => [tf, candles.length])), productionAccess: false, financialWrites: 0 }, null, 2));
  if (failures.length) process.exitCode = 1;
  if (process.argv.includes('--serve')) {
    const express = require('express'), app = express();
    app.use((req, res, next) => ['GET', 'HEAD'].includes(req.method) ? next() : res.sendStatus(405));
    app.use(express.static(out));
    const port = Number(process.argv.find(value => value.startsWith('--port='))?.slice(7) || 4410);
    app.listen(port, '127.0.0.1', () => console.log(`Offline NRX preview: http://127.0.0.1:${port}/`));
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
