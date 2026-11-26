// Daily regime on ten other coins per PREREGISTRATION_TV_COINS.md.
// Usage: node tv_backtest_coins.js <coins.json> <btc_daily.csv> <out.json>
const fs = require('fs');
const [coinsPath, btcPath, outPath] = process.argv.slice(2);
const COST = 0.0015;
const sma = (a, n) => { const o = new Array(a.length).fill(null); let s = 0; for (let i = 0; i < a.length; i++) { s += a[i]; if (i >= n) s -= a[i - n]; if (i >= n - 1) o[i] = s / n; } return o; };
// regime decided at the close of each day: 1 = close above SMA200 and no Pi overheating
function regime(close) { const s200 = sma(close, 200), s111 = sma(close, 111), s350 = sma(close, 350); return close.map((c, i) => (s200[i] === null ? null : c > s200[i] && !(s350[i] !== null && s111[i] > 2 * s350[i]) ? 1 : 0)); }
function run(open, pos, from, to) {
  const N = open.length; let eq = 1, peak = 1, mdd = 0, trades = 0, prev = 0, days = 0, inMkt = 0;
  for (let t = from; t <= to && t + 2 < N; t++) { const p = pos[t] ? 1 : 0; if (p !== prev) { eq *= 1 - COST; trades++; prev = p; } if (p) { eq *= open[t + 2] / open[t + 1]; inMkt++; } days++; if (eq > peak) peak = eq; const dd = eq / peak - 1; if (dd < mdd) mdd = dd; }
  if (prev) eq *= 1 - COST;
  const yrs = days / 365.25; const cagr = yrs > 0 ? Math.pow(eq, 1 / yrs) - 1 : 0;
  return { total_pct: +((eq - 1) * 100).toFixed(1), cagr_pct: +(cagr * 100).toFixed(1), maxdd_pct: +(mdd * 100).toFixed(1), calmar: +(mdd < 0 ? cagr / -mdd : 0).toFixed(2), trades, exposure_pct: +(100 * inMkt / Math.max(days, 1)).toFixed(0), days };
}
const coins = JSON.parse(fs.readFileSync(coinsPath, 'utf8'));
const bl = fs.readFileSync(btcPath, 'utf8').trim().split('\n').slice(1, -1).map((l) => l.split(','));
const btcReg = new Map(); { const r = regime(bl.map((x) => +x[4])); bl.forEach((x, i) => btcReg.set(x[0], r[i])); }

const out = { meta: { cost_per_side: COST, rule_A: 'власний режим монети', rule_B: 'режим BTC', rule_C: 'обидва' }, coins: {}, summary: {} };
const tally = { A: 0, B: 0, C: 0 }; let counted = 0; const skipped = [];
for (const [k, c] of Object.entries(coins)) {
  const rows = c.rows.slice(0, -1); // drop the unclosed bar
  const date = rows.map((r) => r[0]), open = rows.map((r) => +r[1]), close = rows.map((r) => +r[4]);
  const N = rows.length; const from = 200, to = N - 1;
  if (N - 200 < 600) { skipped.push(`${k}: ${N} днів`); continue; }
  const A = regime(close).map((v) => (v === 1 ? 1 : 0));
  const B = date.map((d) => (btcReg.get(d) === 1 ? 1 : 0));
  const C = A.map((v, i) => (v && B[i] ? 1 : 0));
  const hold = run(open, close.map(() => 1), from, to);
  const res = { symbol: c.symbol, first: date[0], evaluated_from: date[from], last: date[N - 1], hold, A: run(open, A, from, to), B: run(open, B, from, to), C: run(open, C, from, to) };
  for (const r of ['A', 'B', 'C']) { res[r].passed = res[r].maxdd_pct > hold.maxdd_pct && res[r].calmar > hold.calmar; if (res[r].passed) tally[r]++; }
  out.coins[k] = res; counted++;
}
const need = counted - 2;
out.summary = { coins_counted: counted, skipped, passes: tally, needed_to_confirm: need, confirmed: { A: tally.A >= need, B: tally.B >= need, C: tally.C >= need } };
const med = (a) => { const s = [...a].sort((x, y) => x - y); const m = s.length >> 1; return s.length % 2 ? s[m] : +((s[m - 1] + s[m]) / 2).toFixed(1); };
const V = Object.values(out.coins);
out.summary.median = { hold: { cagr_pct: med(V.map((v) => v.hold.cagr_pct)), maxdd_pct: med(V.map((v) => v.hold.maxdd_pct)) } };
for (const r of ['A', 'B', 'C']) out.summary.median[r] = { cagr_pct: med(V.map((v) => v[r].cagr_pct)), maxdd_pct: med(V.map((v) => v[r].maxdd_pct)), trades: med(V.map((v) => v[r].trades)) };
fs.writeFileSync(outPath, JSON.stringify(out, null, 1) + '\n');
const row = (o) => `${o.cagr_pct}%/yr dd ${o.maxdd_pct}% r ${o.calmar} tr ${o.trades}`;
for (const [k, v] of Object.entries(out.coins)) console.log(k.padEnd(5), v.evaluated_from, '| hold', row(v.hold), '| A', row(v.A), v.A.passed ? 'PASS' : 'fail', '| B', row(v.B), v.B.passed ? 'PASS' : 'fail', '| C', row(v.C), v.C.passed ? 'PASS' : 'fail');
console.log(JSON.stringify(out.summary));
