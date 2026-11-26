// 1h test per PREREGISTRATION_TV_1H.md.
// Usage: node tv_backtest_1h.js <btc_1h.csv.gz> <eth_1h.csv.gz> <btc_daily.csv> <out.json>
// Mechanics: signal at the close of hour t, executed at the open of hour t+1, long/flat,
// 0.15% cost per position change, last (unclosed) bar dropped. Funding is NOT included.
const fs = require('fs');
const zlib = require('zlib');
const [btcPath, ethPath, dailyPath, outPath] = process.argv.slice(2);
const COST = process.argv[6] !== undefined ? +process.argv[6] : 0.0015; // 7th argument: cost sensitivity run (description only, not part of the criterion)

const readText = (p) => (p.endsWith('.gz') ? zlib.gunzipSync(fs.readFileSync(p)).toString('utf8') : fs.readFileSync(p, 'utf8'));
const parseHeader = (l) => { const o = []; let c = '', q = false; for (const ch of l) { if (ch === '"') { q = !q; continue; } if (ch === ',' && !q) { o.push(c); c = ''; continue; } c += ch; } o.push(c); return o; };
function load(p) {
  const L = readText(p).trim().split('\n');
  const H = parseHeader(L[0]);
  const R = L.slice(1, -1).map((l) => l.split(',')); // drop the unclosed bar
  const col = (j) => R.map((r) => (r[j] === '' || r[j] === undefined ? null : +r[j]));
  return { H, R, N: R.length, time: R.map((r) => r[0]), open: col(1), high: col(2), low: col(3), close: col(4), col };
}

// ---------- indicators ----------
const sma = (a, n) => { const o = new Array(a.length).fill(null); let s = 0; for (let i = 0; i < a.length; i++) { s += a[i]; if (i >= n) s -= a[i - n]; if (i >= n - 1) o[i] = s / n; } return o; };
const ema = (a, n) => { const o = new Array(a.length).fill(null); const k = 2 / (n + 1); let e = null, s = 0; for (let i = 0; i < a.length; i++) { if (i < n) { s += a[i]; if (i === n - 1) { e = s / n; o[i] = e; } } else { e = a[i] * k + e * (1 - k); o[i] = e; } } return o; };
const rma = (a, n) => { const o = new Array(a.length).fill(null); let e = null, s = 0, c = 0; for (let i = 0; i < a.length; i++) { if (a[i] === null) continue; if (c < n) { s += a[i]; c++; if (c === n) { e = s / n; o[i] = e; } } else { e = (e * (n - 1) + a[i]) / n; o[i] = e; } } return o; };
function rsi(close, n) { const up = [null], dn = [null]; for (let i = 1; i < close.length; i++) { const d = close[i] - close[i - 1]; up.push(Math.max(d, 0)); dn.push(Math.max(-d, 0)); } const au = rma(up, n), ad = rma(dn, n); return close.map((_, i) => (au[i] === null ? null : ad[i] === 0 ? 100 : 100 - 100 / (1 + au[i] / ad[i]))); }
function atr(d, n) { const tr = [null]; for (let i = 1; i < d.N; i++) tr.push(Math.max(d.high[i] - d.low[i], Math.abs(d.high[i] - d.close[i - 1]), Math.abs(d.low[i] - d.close[i - 1]))); return rma(tr, n); }
function supertrendUp(d, n, m) { const a = atr(d, n); const up = new Array(d.N).fill(null); let fu = null, fl = null, dir = 1; for (let i = 0; i < d.N; i++) { if (a[i] === null) continue; const hl2 = (d.high[i] + d.low[i]) / 2; const bu = hl2 + m * a[i], bl = hl2 - m * a[i]; if (fu === null) { fu = bu; fl = bl; up[i] = 1; continue; } const pfu = fu, pfl = fl; fu = bu < pfu || d.close[i - 1] > pfu ? bu : pfu; fl = bl > pfl || d.close[i - 1] < pfl ? bl : pfl; if (d.close[i] > pfu) dir = 1; else if (d.close[i] < pfl) dir = -1; up[i] = dir === 1 ? 1 : 0; } return up; }
const rollMax = (a, n) => a.map((_, i) => { if (i < n) return null; let m = -Infinity; for (let k = i - n; k < i; k++) if (a[k] > m) m = a[k]; return m; }); // prior n bars, excluding current
const rollMin = (a, n) => a.map((_, i) => { if (i < n) return null; let m = Infinity; for (let k = i - n; k < i; k++) if (a[k] < m) m = a[k]; return m; });

// ---------- backtest ----------
function run(d, pos, from, to) {
  let eq = 1, peak = 1, mdd = 0, trades = 0, prev = 0, bars = 0, inMkt = 0;
  for (let t = from; t <= to && t + 2 < d.N; t++) {
    const p = pos[t] ? 1 : 0;
    if (p !== prev) { eq *= 1 - COST; trades++; prev = p; }
    if (p) { eq *= d.open[t + 2] / d.open[t + 1]; inMkt++; }
    bars++; if (eq > peak) peak = eq; const dd = eq / peak - 1; if (dd < mdd) mdd = dd;
  }
  if (prev) eq *= 1 - COST;
  const yrs = bars / (24 * 365.25); const cagr = yrs > 0 ? Math.pow(eq, 1 / yrs) - 1 : 0;
  return { total: eq - 1, cagr, mdd, calmar: mdd < 0 ? cagr / -mdd : (cagr > 0 ? 99 : 0), trades, exposure: bars ? inMkt / bars : 0, bars };
}
const fmt = (s) => ({ total_pct: +(s.total * 100).toFixed(1), cagr_pct: +(s.cagr * 100).toFixed(1), maxdd_pct: +(s.mdd * 100).toFixed(1), calmar: +s.calmar.toFixed(2), trades: s.trades, exposure_pct: +(s.exposure * 100).toFixed(0) });

// ---------- daily regime (CSI Режим ринку): last CLOSED daily bar ----------
function regimeFromDaily(dates, closes) { // returns map date -> allow (1/0) valid for the NEXT day
  const s200 = sma(closes, 200), s111 = sma(closes, 111), s350 = sma(closes, 350); const m = new Map();
  for (let i = 0; i < dates.length; i++) { if (s200[i] === null) { m.set(dates[i], null); continue; } const over = s350[i] !== null && s111[i] > 2 * s350[i]; m.set(dates[i], closes[i] > s200[i] && !over ? 1 : 0); }
  return m;
}
const prevDate = (iso) => { const t = new Date(iso.slice(0, 10) + 'T00:00:00Z'); t.setUTCDate(t.getUTCDate() - 1); return t.toISOString().slice(0, 10); };
function dailyFromHourly(d) { const dates = [], closes = []; for (let i = 0; i < d.N; i++) { const day = d.time[i].slice(0, 10); if (dates.length && dates[dates.length - 1] === day) closes[closes.length - 1] = d.close[i]; else { dates.push(day); closes.push(d.close[i]); } } return { dates, closes }; }

function rules(d, regimeMap) {
  const e200 = ema(d.close, 200), e50 = ema(d.close, 50), r = rsi(d.close, 14), st = supertrendUp(d, 10, 3);
  const hh48 = rollMax(d.high, 48), ll24 = rollMin(d.low, 24);
  const allow = d.time.map((t) => { const v = regimeMap.get(prevDate(t)); return v === undefined ? null : v; });
  const H1 = d.close.map((c, i) => (e200[i] !== null && c > e200[i] ? 1 : 0));
  const H2 = d.close.map((c, i) => (e200[i] !== null && e50[i] > e200[i] ? 1 : 0));
  const H3 = []; { let p = 0; for (let i = 0; i < d.N; i++) { if (hh48[i] !== null) { if (!p && d.close[i] > hh48[i]) p = 1; else if (p && d.close[i] < ll24[i]) p = 0; } H3.push(p); } }
  const H4 = st.map((v) => (v === 1 ? 1 : 0));
  const H5 = []; { let p = 0; for (let i = 0; i < d.N; i++) { if (r[i] !== null) { if (!p && r[i] < 30) p = 1; else if (p && r[i] > 50) p = 0; } H5.push(p); } }
  const gate = (pos) => pos.map((p, i) => (p && allow[i] === 1 ? 1 : 0));
  const H9 = []; { let p = 0; for (let i = 0; i < d.N; i++) { if (r[i] !== null) { if (!p && r[i] < 30 && allow[i] === 1) p = 1; else if (p && (r[i] > 50 || allow[i] !== 1)) p = 0; } H9.push(p); } }
  return { rules: { H1, H2, H3, H4, H5, H6: gate(H1), H7: gate(H3), H8: gate(H4), H9 }, hold: d.close.map(() => 1), regime: allow.map((a) => (a === 1 ? 1 : 0)), allow };
}
const NAMES = { H1: 'закриття вище EMA200', H2: 'EMA50 вище EMA200', H3: 'пробій каналу 48/24', H4: 'Supertrend 10/3', H5: 'відкат RSI<30', H6: 'H1 + денний режим', H7: 'H3 + денний режим', H8: 'H4 + денний режим', H9: 'відкат RSI<30 + денний режим' };

const quarterOf = (iso) => iso.slice(0, 4) + 'Q' + (Math.floor((+iso.slice(5, 7) - 1) / 3) + 1);
function quarters(d) { const q = []; for (let i = 0; i < d.N; i++) { const k = quarterOf(d.time[i]); if (!q.length || q[q.length - 1].k !== k) q.push({ k, a: i, b: i }); else q[q.length - 1].b = i; } return q; }

function walkForward(d, cands, qs) {
  let eq = 1, peak = 1, mdd = 0, trades = 0, prev = 0, bars = 0, inMkt = 0; const picks = [];
  for (let qi = 2; qi < qs.length; qi++) {
    let best = null, bs = -Infinity;
    for (const [k, pos] of Object.entries(cands)) { const s = run(d, pos, qs[0].a, qs[qi - 1].b); if (s.calmar > bs) { bs = s.calmar; best = k; } }
    picks.push(qs[qi].k + ':' + best);
    const pos = cands[best];
    for (let t = qs[qi].a; t <= qs[qi].b && t + 2 < d.N; t++) { const p = pos[t] ? 1 : 0; if (p !== prev) { eq *= 1 - COST; trades++; prev = p; } if (p) { eq *= d.open[t + 2] / d.open[t + 1]; inMkt++; } bars++; if (eq > peak) peak = eq; const dd = eq / peak - 1; if (dd < mdd) mdd = dd; }
  }
  if (prev) eq *= 1 - COST;
  const yrs = bars / (24 * 365.25); const cagr = Math.pow(eq, 1 / yrs) - 1;
  return { picks, from: qs[2].a, to: qs[qs.length - 1].b, result: fmt({ total: eq - 1, cagr, mdd, calmar: mdd < 0 ? cagr / -mdd : (cagr > 0 ? 99 : 0), trades, exposure: inMkt / bars }) };
}

// ================= BTC =================
const btc = load(btcPath);
const dl = fs.readFileSync(dailyPath, 'utf8').trim().split('\n').slice(1).map((l) => l.split(','));
const btcRegime = regimeFromDaily(dl.map((r) => r[0]), dl.map((r) => +r[4]));
const B = rules(btc, btcRegime);
const out = { meta: { cost_per_side: COST, btc: { bars: btc.N, first: btc.time[0], last: btc.time[btc.N - 1] } }, btc: {}, eth: {}, pifagor_1h: {} };
const full = [0, btc.N - 1];
out.btc.benchmarks = { hold: fmt(run(btc, B.hold, ...full)), daily_regime: fmt(run(btc, B.regime, ...full)) };
out.btc.rules_full_period = {}; for (const [k, pos] of Object.entries(B.rules)) out.btc.rules_full_period[k + ' ' + NAMES[k]] = fmt(run(btc, pos, ...full));
const mid = Math.floor(btc.N / 2);
out.btc.rules_by_half = {}; for (const [k, pos] of Object.entries(B.rules)) out.btc.rules_by_half[k] = { first: fmt(run(btc, pos, 0, mid)), second: fmt(run(btc, pos, mid + 1, btc.N - 1)) };
out.btc.bench_by_half = { hold: { first: fmt(run(btc, B.hold, 0, mid)), second: fmt(run(btc, B.hold, mid + 1, btc.N - 1)) }, daily_regime: { first: fmt(run(btc, B.regime, 0, mid)), second: fmt(run(btc, B.regime, mid + 1, btc.N - 1)) } };
const qs = quarters(btc);
const wf = walkForward(btc, B.rules, qs);
out.btc.walk_forward = wf;
out.btc.walk_forward_benchmarks = { hold: fmt(run(btc, B.hold, wf.from, wf.to)), daily_regime: fmt(run(btc, B.regime, wf.from, wf.to)) };

// ================= ETH =================
const eth = load(ethPath);
const ed = dailyFromHourly(eth);
const E = rules(eth, regimeFromDaily(ed.dates, ed.closes));
out.meta.eth = { bars: eth.N, first: eth.time[0], last: eth.time[eth.N - 1], note: 'денний режим ETH складено з годинних даних; перші 200 днів режим невідомий (правила з фільтром поза ринком)' };
const efull = [0, eth.N - 1];
out.eth.benchmarks = { hold: fmt(run(eth, E.hold, ...efull)), daily_regime_own: fmt(run(eth, E.regime, ...efull)) };
out.eth.rules_full_period = {}; for (const [k, pos] of Object.entries(E.rules)) out.eth.rules_full_period[k + ' ' + NAMES[k]] = fmt(run(eth, pos, ...efull));

// ================= verdicts =================
const bh = out.btc.benchmarks.hold, br = out.btc.benchmarks.daily_regime, eh = out.eth.benchmarks.hold;
out.verdict_per_rule = {};
for (const k of Object.keys(B.rules)) {
  const b = out.btc.rules_full_period[k + ' ' + NAMES[k]], e = out.eth.rules_full_period[k + ' ' + NAMES[k]];
  const c1 = b.total_pct > 0, c2 = b.calmar > bh.calmar && b.calmar > br.calmar, c3 = b.maxdd_pct > bh.maxdd_pct, c4 = e.calmar > eh.calmar;
  out.verdict_per_rule[k] = { positive_net: c1, better_ratio_than_hold_and_regime: c2, smaller_drawdown_than_hold: c3, eth_ratio_better_than_eth_hold: c4, passed: c1 && c2 && c3 && c4 };
}
{ const w = wf.result, wh = out.btc.walk_forward_benchmarks.hold, wr = out.btc.walk_forward_benchmarks.daily_regime;
  out.verdict_walk_forward = { positive_net: w.total_pct > 0, better_ratio_than_hold_and_regime: w.calmar > wh.calmar && w.calmar > wr.calmar, smaller_drawdown_than_hold: w.maxdd_pct > wh.maxdd_pct }; out.verdict_walk_forward.passed = Object.values(out.verdict_walk_forward).every(Boolean); }

// ================= closed indicators on 1h (BTC) =================
const fwd = (h) => { const o = new Array(btc.N).fill(null); for (let t = 0; t + 1 + h < btc.N; t++) o[t] = Math.log(btc.open[t + 1 + h] / btc.open[t + 1]); return o; };
const F = { 24: fwd(24), 72: fwd(72) };
function seededRng(seed) { let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; }
const CLOSED = /^(Opportunity|Pi Pi|div|GLOBAL|Pifagor_ALTS|Trader 01|bottomline|Trap line)/;
out.pifagor_1h.lines = {}; out.pifagor_1h.events = {};
btc.H.forEach((h, j) => {
  if (j < 6 || !CLOSED.test(h)) return;
  const v = btc.col(j); const n = v.filter((x) => x !== null).length; if (!n) return;
  const type = (h.match(/\[(\w+)\]$/) || [])[1];
  if (type === 'line') {
    let up = 0, cnt = 0; for (let i = 0; i < btc.N; i++) if (v[i] !== null) { cnt++; if (btc.close[i] > v[i]) up++; }
    if (cnt < 5000) return; const share = up / cnt; if (share < 0.02 || share > 0.98) { out.pifagor_1h.lines[`c${j} ${h}`] = { close_above_pct: +(share * 100).toFixed(0), note: 'ціна майже завжди з одного боку лінії — правило не відрізняється від еталона' }; return; }
    const pos = btc.close.map((c, i) => (v[i] !== null && c > v[i] ? 1 : 0)); const s = fmt(run(btc, pos, ...full));
    out.pifagor_1h.lines[`c${j} ${h}`] = { close_above_pct: +(share * 100).toFixed(0), ...s, passed: s.total_pct > 0 && s.calmar > bh.calmar && s.calmar > br.calmar && s.maxdd_pct > bh.maxdd_pct };
  } else if (type === 'shapes' || type === 'alertcondition') {
    const ev = []; let prev = false; for (let i = 0; i < btc.N; i++) { const on = v[i] !== null && v[i] !== 0; if (on && !prev) ev.push(i); prev = on; }
    if (ev.length < 30) { if (ev.length) out.pifagor_1h.events[`c${j} ${h}`] = { events: ev.length, note: 'менше 30 подій — довести неможливо' }; return; }
    const res = { events: ev.length };
    for (const hz of [24, 72]) { const f = F[hz]; const valid = []; for (let i = 0; i < btc.N; i++) if (f[i] !== null) valid.push(i); const base = valid.reduce((a, i) => a + f[i], 0) / valid.length; const xs = ev.filter((i) => f[i] !== null); const mean = xs.reduce((a, i) => a + f[i], 0) / xs.length; const half = (lo, hi) => { const z = xs.filter((i) => i >= lo && i < hi); return z.length ? +((z.reduce((a, i) => a + f[i], 0) / z.length - base) * 100).toFixed(2) : null; }; const rng = seededRng(777 + j + hz); const diffs = []; const M = valid.length; for (let b = 0; b < 1000; b++) { const sh = Math.floor(rng() * M); let s = 0; for (const i of xs) s += f[valid[(i + sh) % M]]; diffs.push(s / xs.length - base); } diffs.sort((a, b) => a - b); const lo = diffs[50], hi = diffs[949], dlt = mean - base; res['h' + hz] = { diff_pct: +(dlt * 100).toFixed(2), placebo_90: [+(lo * 100).toFixed(2), +(hi * 100).toFixed(2)], outside: dlt < lo || dlt > hi, first_half: half(0, mid), second_half: half(mid, btc.N) }; }
    const ok = (r) => r.outside && r.first_half !== null && r.second_half !== null && Math.sign(r.first_half) === Math.sign(r.second_half);
    res.passed = ok(res.h24) || ok(res.h72); out.pifagor_1h.events[`c${j} ${h}`] = res;
  }
});

fs.writeFileSync(outPath, JSON.stringify(out, null, 1) + '\n');
const row = (o) => [o.total_pct, o.cagr_pct, o.maxdd_pct, o.calmar, o.trades, o.exposure_pct].join(' / ');
console.log('BTC', out.meta.btc.first, '..', out.meta.btc.last, 'bars', btc.N, '| ETH bars', eth.N, out.meta.eth.first);
console.log('columns: total% / per-year% / maxDD% / ratio / trades / exposure%');
console.log('BTC hold        ', row(bh)); console.log('BTC daily regime', row(br));
for (const k of Object.keys(B.rules)) console.log('BTC', k, NAMES[k].padEnd(28), row(out.btc.rules_full_period[k + ' ' + NAMES[k]]), '| halves ratio', out.btc.rules_by_half[k].first.calmar, out.btc.rules_by_half[k].second.calmar, '| ETH', row(out.eth.rules_full_period[k + ' ' + NAMES[k]]), '| pass', out.verdict_per_rule[k].passed);
console.log('ETH hold', row(eh), '| ETH own regime', row(out.eth.benchmarks.daily_regime_own));
console.log('BTC halves hold', out.btc.bench_by_half.hold.first.calmar, out.btc.bench_by_half.hold.second.calmar, 'regime', out.btc.bench_by_half.daily_regime.first.calmar, out.btc.bench_by_half.daily_regime.second.calmar);
console.log('WF', row(wf.result), '| hold', row(out.btc.walk_forward_benchmarks.hold), '| regime', row(out.btc.walk_forward_benchmarks.daily_regime), '| pass', out.verdict_walk_forward.passed);
console.log('WF picks', wf.picks.join(' '));
console.log('--- closed lines 1h'); for (const [k, v] of Object.entries(out.pifagor_1h.lines)) console.log(k.slice(0, 48).padEnd(48), v.note ? 'above ' + v.close_above_pct + '% (skip)' : row(v) + ' above ' + v.close_above_pct + '% pass ' + v.passed);
console.log('--- closed events 1h'); for (const [k, v] of Object.entries(out.pifagor_1h.events)) console.log(k.slice(0, 60).padEnd(60), 'ev', v.events, v.note ? '(few)' : `24h ${v.h24.diff_pct} [${v.h24.placebo_90}] halves ${v.h24.first_half}/${v.h24.second_half} | 72h ${v.h72.diff_pct} [${v.h72.placebo_90}] halves ${v.h72.first_half}/${v.h72.second_half} | pass ${v.passed}`);
