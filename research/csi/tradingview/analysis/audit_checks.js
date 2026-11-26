// Re-check of the three audit claims that change wording in RESULTS_TV_UA.md (see AUDIT_TV_UA.md).
// Usage: node audit_checks.js <btc_daily.csv> <out.json>
// Same mechanics as tv_backtest.js: signal at close t, fill at open t+1, 0.15% per position change.
const fs = require('fs');
const [csvPath, outPath] = process.argv.slice(2);
const COST = 0.0015;
const R = fs.readFileSync(csvPath, 'utf8').trim().split('\n').slice(1, -1).map((l) => l.split(','));
const N = R.length, date = R.map((r) => r[0]), year = date.map((d) => +d.slice(0, 4));
const num = (j) => R.map((r) => (r[j] === '' || r[j] === undefined ? null : +r[j]));
const open = num(1), close = num(4);
const sma = (a, n) => { const o = new Array(a.length).fill(null); let s = 0; for (let i = 0; i < a.length; i++) { s += a[i]; if (i >= n) s -= a[i - n]; if (i >= n - 1) o[i] = s / n; } return o; };
function run(pos, from, to) { let eq = 1, peak = 1, mdd = 0, tr = 0, prev = 0, days = 0; for (let t = from; t <= to && t + 2 < N; t++) { const p = pos[t] ? 1 : 0; if (p !== prev) { eq *= 1 - COST; tr++; prev = p; } if (p) eq *= open[t + 2] / open[t + 1]; days++; if (eq > peak) peak = eq; const dd = eq / peak - 1; if (dd < mdd) mdd = dd; } if (prev) eq *= 1 - COST; const cagr = Math.pow(eq, 365.25 / days) - 1; return { cagr_pct: +(cagr * 100).toFixed(1), maxdd_pct: +(mdd * 100).toFixed(1), calmar: +(mdd < 0 ? cagr / -mdd : 0).toFixed(2), trades: tr }; }
const first = (y) => year.findIndex((v) => v >= y); const last = (y) => { let k = -1; for (let i = 0; i < N; i++) if (year[i] <= y) k = i; return k; };
const above = (line) => close.map((c, i) => (line[i] !== null && c > line[i] ? 1 : 0));
const out = {};

// ---- 1. Walk-forward over the 14 lines with a like-for-like selection window ----
const cols = [9, 12, 13, 117, 118, 119, 120, 121, 122, 123, 124, 108, 110, 125];
const cands = Object.fromEntries(cols.map((j) => ['c' + j, above(num(j))]));
function walkForward(selStart) {
  let eq = 1, peak = 1, mdd = 0, tr = 0, prev = 0, days = 0; const picks = [];
  for (let y = 2016; y <= 2026; y++) {
    let best = null, bs = -Infinity; for (const [k, pos] of Object.entries(cands)) { const s = run(pos, selStart, last(y - 1)); if (s.calmar > bs) { bs = s.calmar; best = k; } }
    picks.push(y + ':' + best); const pos = cands[best];
    for (let t = first(y); t <= last(y) && t + 2 < N; t++) { const p = pos[t] ? 1 : 0; if (p !== prev) { eq *= 1 - COST; tr++; prev = p; } if (p) eq *= open[t + 2] / open[t + 1]; days++; if (eq > peak) peak = eq; const dd = eq / peak - 1; if (dd < mdd) mdd = dd; }
  }
  if (prev) eq *= 1 - COST; const cagr = Math.pow(eq, 365.25 / days) - 1;
  return { picks: [...new Set(picks.map((p) => p.split(':')[1]))], cagr_pct: +(cagr * 100).toFixed(1), maxdd_pct: +(mdd * 100).toFixed(1), calmar: +(cagr / -mdd).toFixed(2), trades: tr };
}
const s200 = sma(close, 200), s111 = sma(close, 111), s350 = sma(close, 350);
const trend = above(s200);
out.walk_forward = { literal_from_2011_08_18: walkForward(0), like_for_like_from_2013_04_08: walkForward(date.indexOf('2013-04-08')), like_for_like_from_2014_01_01: walkForward(first(2014)), trend200_2016_2026: run(trend, first(2016), last(2026)) };
out.trap_vs_trend200 = { '2016-2026': { trap: run(cands.c125, first(2016), last(2026)), trend200: run(trend, first(2016), last(2026)) }, '2022-2026': { trap: run(cands.c125, first(2022), last(2026)), trend200: run(trend, first(2022), last(2026)) } };

// ---- 2. Where does "200D and no Pi overheating" differ from plain 200D? ----
const hot = close.map((c, i) => (s350[i] !== null && s111[i] > 2 * s350[i] ? 1 : 0));
const combo = trend.map((v, i) => (v && !hot[i] ? 1 : 0));
const episodes = []; let cur = null;
for (let i = first(2016); i <= last(2026); i++) { const diff = trend[i] !== combo[i]; if (diff) { if (!cur) cur = { from: date[i], to: date[i], days: 0 }; cur.to = date[i]; cur.days++; } else if (cur) { episodes.push(cur); cur = null; } }
if (cur) episodes.push(cur);
const merged = []; for (const e of episodes) { const p = merged[merged.length - 1]; if (p && (new Date(e.from) - new Date(p.to)) / 864e5 < 120) { p.to = e.to; p.days += e.days; } else merged.push({ ...e }); }
out.overheating_episodes_2016_2026 = { days_different_from_200D: episodes.reduce((a, e) => a + e.days, 0), episodes: merged };

// ---- 3. Event test with the PRE-REGISTERED method: 90% block bootstrap (90-day blocks) of the difference ----
function rng(seed) { let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; }
function blockCI(col, isOn, h, seed) {
  const v = num(col); const ev = new Array(N).fill(0); let prev = false; for (let i = 0; i < N; i++) { const on = v[i] !== null && isOn(v[i]); if (on && !prev) ev[i] = 1; prev = on; }
  const f = new Array(N).fill(null); for (let t = 0; t + 1 + h < N; t++) f[t] = Math.log(open[t + 1 + h] / open[t + 1]);
  const idx = []; for (let i = 0; i < N; i++) if (f[i] !== null) idx.push(i); const M = idx.length, B = 90, r = rng(seed);
  const stat = (ix) => { let sa = 0, se = 0, ne = 0; for (const i of ix) { sa += f[i]; if (ev[i]) { se += f[i]; ne++; } } return ne ? se / ne - sa / ix.length : null; };
  const obs = stat(idx); const d = [];
  for (let b = 0; b < 3000; b++) { const ix = []; while (ix.length < M) { const s = Math.floor(r() * M); for (let k = 0; k < B && ix.length < M; k++) ix.push(idx[(s + k) % M]); } const x = stat(ix); if (x !== null) d.push(x); }
  d.sort((a, b) => a - b); const lo = d[Math.floor(0.05 * d.length)], hi = d[Math.floor(0.95 * d.length)];
  return { events: ev.reduce((a, b) => a + b, 0), diff_pct: +(obs * 100).toFixed(1), ci90: [+(lo * 100).toFixed(1), +(hi * 100).toFixed(1)], excludes_zero: lo > 0 || hi < 0 };
}
const one = (v) => v === 1;
out.events_block_bootstrap = {
  'div 2DIV (c57) 90d': blockCI(57, one, 90, 11), 'div 2DIV (c57) 30d': blockCI(57, one, 30, 12), 'div 1DIV (c56) 90d': blockCI(56, one, 90, 13),
  'GLOBAL c84 30d': blockCI(84, one, 30, 14), 'GLOBAL c91 30d': blockCI(91, one, 30, 15), 'GLOBAL Alert (c105) 30d': blockCI(105, one, 30, 16),
};
fs.writeFileSync(outPath, JSON.stringify(out, null, 1) + '\n');
console.log(JSON.stringify(out, null, 1));
