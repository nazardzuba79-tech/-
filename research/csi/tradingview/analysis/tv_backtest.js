// Test of the TradingView indicator values per PREREGISTRATION_TV.md.
// Usage: node tv_backtest.js <csv> <out.json>
// Mechanics: signal known at the close of day t, executed at the open of day t+1,
// long/flat only, 0.15% cost per position change, last (unclosed) bar dropped.
const fs = require('fs');
const [csvPath, outPath] = process.argv.slice(2);
const COST = 0.0015;

const L = fs.readFileSync(csvPath, 'utf8').trim().split('\n');
const parseHeader = (l) => { const o = []; let c = '', q = false; for (const ch of l) { if (ch === '"') { q = !q; continue; } if (ch === ',' && !q) { o.push(c); c = ''; continue; } c += ch; } o.push(c); return o; };
const H = parseHeader(L[0]);
let R = L.slice(1).map((l) => l.split(','));
R = R.slice(0, -1); // drop the unclosed bar
const N = R.length;
const date = R.map((r) => r[0]);
const num = (j) => R.map((r) => (r[j] === '' || r[j] === undefined ? null : +r[j]));
const open = num(1), close = num(4);
const year = date.map((d) => +d.slice(0, 4));

const sma = (a, n) => { const o = new Array(a.length).fill(null); let s = 0; for (let i = 0; i < a.length; i++) { s += a[i]; if (i >= n) s -= a[i - n]; if (i >= n - 1) o[i] = s / n; } return o; };

// position[t] in {0,1} decided at close t. Equity is marked open-to-open:
// the position decided at close t is held from open t+1 to open t+2.
function run(pos, from, to) {
  // from/to: indices of decision days (inclusive); returns stats over that span
  let eq = 1, peak = 1, mdd = 0, trades = 0, prev = 0, days = 0, inMkt = 0;
  const curve = [];
  for (let t = from; t <= to && t + 2 < N; t++) {
    const p = pos[t] ? 1 : 0;
    if (p !== prev) { eq *= 1 - COST; trades++; prev = p; }
    if (p) { eq *= open[t + 2] / open[t + 1]; inMkt++; }
    days++;
    if (eq > peak) peak = eq;
    const dd = eq / peak - 1; if (dd < mdd) mdd = dd;
    curve.push(eq);
  }
  if (prev) eq *= 1 - COST; // close the last position
  const yrs = days / 365.25;
  const cagr = yrs > 0 ? Math.pow(eq, 1 / yrs) - 1 : 0;
  return { total: eq - 1, cagr, mdd, calmar: mdd < 0 ? cagr / -mdd : null, trades, exposure: days ? inMkt / days : 0, days, _state: prev, curve };
}
const fmt = (s) => ({ total_pct: +(s.total * 100).toFixed(1), cagr_pct: +(s.cagr * 100).toFixed(1), maxdd_pct: +(s.mdd * 100).toFixed(1), calmar: s.calmar === null ? null : +s.calmar.toFixed(2), trades: s.trades, exposure_pct: +(s.exposure * 100).toFixed(0) });

const idxOfYearStart = (y) => year.findIndex((v) => v >= y);
const idxOfYearEnd = (y) => { let k = -1; for (let i = 0; i < N; i++) if (year[i] <= y) k = i; return k; };

// ---------- rules ----------
const above = (line) => close.map((c, i) => (line[i] !== null && c > line[i] ? 1 : 0));
const hold = close.map(() => 1);
const sma200 = sma(close, 200), sma111 = sma(close, 111), sma350 = sma(close, 350);
const trend200 = above(sma200);

const lines = {
  'Opportunity L1 (c9)': 9, 'Opportunity L4 (c12)': 12, 'Opportunity L5 (c13)': 13,
  'Trader01 L1 (c117)': 117, 'Trader01 L2 (c118)': 118, 'Trader01 L3 (c119)': 119, 'Trader01 L4 (c120)': 120, 'Trader01 L5 (c121)': 121,
  'bottomline L1 (c122)': 122, 'bottomline L2 (c123)': 123, 'bottomline L3 (c124)': 124,
  'ALTS upper (c108)': 108, 'ALTS lower core (c110)': 110, 'Trap line (c125)': 125,
};
const linePos = {}; const lineVals = {};
for (const [k, j] of Object.entries(lines)) { lineVals[k] = num(j); linePos[k] = above(lineVals[k]); }

const out = { meta: { csv: csvPath, bars: N, first: date[0], last: date[N - 1], cost_per_side: COST }, groupA: {}, groupB: {}, own: {}, notes: [] };

// ---------- Group A: full-history description ----------
const span = (y0, y1) => [idxOfYearStart(y0), idxOfYearEnd(y1)];
const periods = { '2016-2026': span(2016, 2026), '2019-2026': span(2019, 2026), '2012-2026': span(2012, 2026) };
const bench = {};
for (const [pn, [a, b]] of Object.entries(periods)) bench[pn] = { hold: fmt(run(hold, a, b)), trend200: fmt(run(trend200, a, b)) };
out.benchmarks = bench;
out.groupA.descriptive_2016_2026 = {};
for (const k of Object.keys(lines)) { const [a, b] = periods['2016-2026']; out.groupA.descriptive_2016_2026[k] = fmt(run(linePos[k], a, b)); }

// what is each line relative to price? (share of days close is above; median ratio line/close)
out.groupA.line_profile = {};
for (const k of Object.keys(lines)) {
  let n = 0, up = 0; const ratios = [];
  for (let i = 0; i < N; i++) if (lineVals[k][i] !== null) { n++; if (close[i] > lineVals[k][i]) up++; ratios.push(lineVals[k][i] / close[i]); }
  ratios.sort((x, y) => x - y);
  out.groupA.line_profile[k] = { days: n, close_above_pct: +(100 * up / n).toFixed(0), median_line_to_price: +ratios[Math.floor(ratios.length / 2)].toFixed(2) };
}

// ---------- Group A: walk-forward 2016..2026 ----------
function walkForward(cands, y0, y1) {
  const picks = []; let eq = 1, peak = 1, mdd = 0, trades = 0, days = 0, inMkt = 0, prev = 0;
  for (let y = y0; y <= y1; y++) {
    const a0 = 0, b0 = idxOfYearEnd(y - 1);
    let best = null, bestScore = -Infinity;
    for (const [k, pos] of Object.entries(cands)) {
      const s = run(pos, a0, b0);
      const score = s.calmar === null ? (s.cagr > 0 ? 1e9 : -1e9) : s.calmar;
      if (score > bestScore) { bestScore = score; best = k; }
    }
    picks.push({ year: y, pick: best, past_calmar: +bestScore.toFixed(2) });
    const pos = cands[best];
    const a = idxOfYearStart(y), b = idxOfYearEnd(y);
    for (let t = a; t <= b && t + 2 < N; t++) {
      const p = pos[t] ? 1 : 0;
      if (p !== prev) { eq *= 1 - COST; trades++; prev = p; }
      if (p) { eq *= open[t + 2] / open[t + 1]; inMkt++; }
      days++;
      if (eq > peak) peak = eq;
      const dd = eq / peak - 1; if (dd < mdd) mdd = dd;
    }
  }
  if (prev) eq *= 1 - COST;
  const yrs = days / 365.25; const cagr = Math.pow(eq, 1 / yrs) - 1;
  return { picks, result: fmt({ total: eq - 1, cagr, mdd, calmar: mdd < 0 ? cagr / -mdd : null, trades, exposure: inMkt / days }) };
}
const wfA = walkForward(linePos, 2016, 2026);
out.groupA.walk_forward_2016_2026 = wfA;
{
  const t = bench['2016-2026'].trend200, w = wfA.result;
  out.groupA.verdict = { smaller_drawdown_than_trend200: w.maxdd_pct > t.maxdd_pct, better_calmar_than_trend200: w.calmar > t.calmar, passed: w.maxdd_pct > t.maxdd_pct && w.calmar > t.calmar };
}

// ---------- Group B: events ----------
const fwd = (h) => { const o = new Array(N).fill(null); for (let t = 0; t + 1 + h < N; t++) o[t] = Math.log(open[t + 1 + h] / open[t + 1]); return o; };
const F = { 30: fwd(30), 90: fwd(90) };
function events(col, isOn) { const v = num(col); const ev = []; let prev = false; for (let i = 0; i < N; i++) { const on = v[i] !== null && isOn(v[i]); if (on && !prev) ev.push(i); prev = on; } return ev; }
function seededRng(seed) { let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; }
function eventTest(name, ev, expected) {
  const res = { events: ev.length, dates: ev.slice(0, 12).map((i) => date[i]), expected };
  for (const h of [30, 90]) {
    const f = F[h];
    const all = []; for (let i = 0; i < N; i++) if (f[i] !== null) all.push(f[i]);
    const base = all.reduce((a, b) => a + b, 0) / all.length;
    const xs = ev.filter((i) => f[i] !== null).map((i) => f[i]);
    if (!xs.length) { res['h' + h] = null; continue; }
    const mean = xs.reduce((a, b) => a + b, 0) / xs.length;
    const half = (pred) => { const z = ev.filter((i) => f[i] !== null && pred(year[i])).map((i) => f[i]); return z.length ? +((z.reduce((a, b) => a + b, 0) / z.length - base) * 100).toFixed(1) : null; };
    // circular block bootstrap of the event-day indicator shifted in time (placebo): shift events by random offsets
    const rng = seededRng(12345 + h + ev.length);
    const diffs = [];
    const valid = []; for (let i = 0; i < N; i++) if (f[i] !== null) valid.push(i);
    const M = valid.length;
    for (let b = 0; b < 2000; b++) {
      const shift = Math.floor(rng() * M);
      let s = 0, c = 0;
      for (const i of ev) { const k = valid[(i + shift) % M]; if (k !== undefined) { s += f[k]; c++; } }
      if (c) diffs.push(s / c - base);
    }
    diffs.sort((a, b) => a - b);
    const lo = diffs[Math.floor(0.05 * diffs.length)], hi = diffs[Math.floor(0.95 * diffs.length)];
    const d = mean - base;
    res['h' + h] = { n: xs.length, mean_after_pct: +(mean * 100).toFixed(1), all_days_pct: +(base * 100).toFixed(1), diff_pct: +(d * 100).toFixed(1), placebo_90pct_range: [+(lo * 100).toFixed(1), +(hi * 100).toFixed(1)], outside_placebo: d < lo || d > hi, diff_before_2019: half((y) => y < 2019), diff_from_2019: half((y) => y >= 2019) };
  }
  const ok = (r) => r && r.n >= 10 && r.outside_placebo && r.diff_before_2019 !== null && r.diff_from_2019 !== null && Math.sign(r.diff_before_2019) === Math.sign(r.diff_from_2019);
  res.enough_events = ev.length >= 10;
  res.passed = ok(res.h30) || ok(res.h90);
  return res;
}
const evCols = {
  'Pi Pi SHORT (c50)': [50, (v) => v !== 0, 'нижче середнього'],
  'Pi Pi LONG1 (c51)': [51, (v) => v === 1, 'вище середнього'],
  'div 1DIV (c56)': [56, (v) => v === 1, 'невідомо'],
  'div 2DIV (c57)': [57, (v) => v === 1, 'невідомо'],
  'ALTS сигнал покупки (c106)': [106, (v) => v === 1, 'вище середнього'],
  'ALTS сигнал выхода (c107)': [107, (v) => v === 1, 'нижче середнього'],
  'GLOBAL Alert (c105)': [105, (v) => v === 1, 'невідомо'],
};
for (const j of [75, 76, 84, 85, 86, 87, 88, 89, 90, 91, 93, 94]) evCols[`GLOBAL позначка (c${j})`] = [j, (v) => v === 1, 'невідомо'];
for (const [k, [j, f, e]] of Object.entries(evCols)) out.groupB[k] = eventTest(k, events(j, f), e);

// states as rules
const stateRule = (j, on) => num(j).map((v) => (v !== null && on(v) ? 1 : 0));
out.groupB_states = {};
for (const [k, pos] of Object.entries({ 'GLOBAL фон = 1 (c73)': stateRule(73, (v) => v === 1), 'GLOBAL фон = 0 (c73)': stateRule(73, (v) => v === 0), 'GLOBAL Alert = 1 (c105)': stateRule(105, (v) => v === 1), 'GLOBAL Alert = 0 (c105)': stateRule(105, (v) => v === 0) })) {
  out.groupB_states[k] = {}; for (const pn of ['2016-2026', '2019-2026']) { const [a, b] = periods[pn]; out.groupB_states[k][pn] = fmt(run(pos, a, b)); }
}

// ---------- own open formulas ----------
const piTopRisk = close.map((c, i) => (sma111[i] !== null && sma350[i] !== null && sma111[i] > 2 * sma350[i] ? 0 : 1)); // out of market while 111D > 2 x 350D
const mayer = close.map((c, i) => (sma200[i] ? c / sma200[i] : null));
const mayerRule = mayer.map((m) => (m !== null && m > 1 && m < 2.4 ? 1 : 0)); // classic Mayer thresholds
const trendAndPi = close.map((c, i) => (trend200[i] && piTopRisk[i] ? 1 : 0));
const ownRules = { 'Тренд 200D (еталон)': trend200, 'Pi Cycle: поза ринком, коли 111D > 2×350D': piTopRisk, 'Маєр: у ринку при 1.0 < ціна/200D < 2.4': mayerRule, 'Тренд 200D і не перегрів Pi': trendAndPi };
for (const [k, pos] of Object.entries(ownRules)) { out.own[k] = {}; for (const pn of Object.keys(periods)) { const [a, b] = periods[pn]; out.own[k][pn] = fmt(run(pos, a, b)); } }
// Pi cross dates (111D crossing above 2x350D) for reference
out.own.pi_cross_up_dates = []; for (let i = 1; i < N; i++) if (sma350[i - 1] !== null && sma111[i - 1] <= 2 * sma350[i - 1] && sma111[i] > 2 * sma350[i]) out.own.pi_cross_up_dates.push(date[i]);

// ---------- is a closed line just a standard moving average? (best-fitting SMA/EMA length, description only) ----------
function bestMaFit(line) {
  let best = null;
  const ema = (n) => { const o = new Array(N).fill(null); const k = 2 / (n + 1); let e = close[0]; for (let i = 0; i < N; i++) { e = i ? close[i] * k + e * (1 - k) : close[0]; o[i] = i >= n ? e : null; } return o; };
  for (const [type, fn] of [['SMA', (n) => sma(close, n)], ['EMA', ema]]) for (const n of [20, 50, 100, 111, 140, 150, 200, 250, 300, 350, 365, 400, 471, 500, 600, 700, 730, 1000, 1400, 1458]) {
    const m = fn(n); const errs = [];
    for (let i = 0; i < N; i++) if (m[i] !== null && line[i] !== null) errs.push(Math.abs(Math.log(line[i] / m[i])));
    if (errs.length < 500) continue; errs.sort((a, b) => a - b);
    const med = errs[Math.floor(errs.length / 2)];
    if (!best || med < best.median_log_error) best = { type, length: n, median_log_error: +med.toFixed(4), implied_multiplier: null };
    // multiplier fit
    const rat = []; for (let i = 0; i < N; i++) if (m[i] !== null && line[i] !== null) rat.push(line[i] / m[i]); rat.sort((a, b) => a - b);
    const mult = rat[Math.floor(rat.length / 2)]; const e2 = []; for (let i = 0; i < N; i++) if (m[i] !== null && line[i] !== null) e2.push(Math.abs(Math.log(line[i] / (m[i] * mult)))); e2.sort((a, b) => a - b);
    const med2 = e2[Math.floor(e2.length / 2)];
    if (med2 < best.median_log_error) best = { type, length: n, median_log_error: +med2.toFixed(4), implied_multiplier: +mult.toFixed(3) };
  }
  return best;
}
out.groupA.closest_standard_average = {}; for (const k of Object.keys(lines)) out.groupA.closest_standard_average[k] = bestMaFit(lineVals[k]);

fs.writeFileSync(outPath, JSON.stringify(out, null, 1) + '\n');
console.log(JSON.stringify({ benchmarks: out.benchmarks, verdictA: out.groupA.verdict, wf: out.groupA.walk_forward_2016_2026.result }, null, 0));
