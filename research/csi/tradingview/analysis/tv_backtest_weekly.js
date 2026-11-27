// Open weekly moving averages per PREREGISTRATION_TV_WEEKLY.md (reference implementation).
// Usage: node tv_backtest_weekly.js <btc_daily.csv> <coins.json.gz> <out.json>
//        node tv_backtest_weekly.js --selfcheck
// Mechanics: decision s(d) known at the close of day d, filled at the open of d+1,
// held to the open of d+2, long/flat only, 0.15% per position change, last (unclosed) row dropped.
'use strict';
const fs = require('fs');
const zlib = require('zlib');
const crypto = require('crypto');

const COST = 0.0015;
const LEN = { sma20: 20, ema21: 21, sma50: 50, sma200: 200 }; // fixed by the protocol
const BOOT = { seed: 20261127, block: 90, reps: 5000, level: 0.90 };
const WEEKLY = ['WA', 'WB', 'WC', 'WD'], DAILY = ['DA', 'DB', 'DC', 'DD'];
const CODES = ['HOLD', 'T200', ...WEEKLY, ...DAILY];

// ---------- calendar ----------
// Whole days since 1970-01-01 (a Thursday), UTC.
const dayNum = (s) => Math.round(Date.parse(s.slice(0, 10) + 'T00:00:00Z') / 86400000);
// Day number of the Sunday that ends the ISO (Mon..Sun) week containing dn.
const sundayOf = (dn) => dn + (6 - ((dn + 3) % 7));
const isoDate = (dn) => new Date(dn * 86400000).toISOString().slice(0, 10);

// ---------- weekly bars ----------
// Returns completed weeks only (Sunday date <= last daily date). Weeks with no daily bar never appear.
// wOf[i] = index of the last week completed at the close of day i, or -1.
function buildWeeks(dates, close) {
  const dn = dates.map(dayNum);
  const all = [];
  for (let i = 0; i < dn.length; i++) {
    const sun = sundayOf(dn[i]);
    const last = all[all.length - 1];
    if (last && last.sunday === sun) { last.lastIdx = i; last.close = close[i]; last.bars++; }
    else all.push({ sunday: sun, lastIdx: i, close: close[i], bars: 1 });
  }
  const lastDn = dn[dn.length - 1];
  const weeks = all.filter((w) => w.sunday <= lastDn);
  const wOf = new Array(dn.length).fill(-1);
  let k = -1;
  for (let i = 0; i < dn.length; i++) { while (k + 1 < weeks.length && weeks[k + 1].sunday <= dn[i]) k++; wOf[i] = k; }
  return { weeks, wOf, dn, trailingIncomplete: all.length - weeks.length };
}

const sma = (a, n) => { const o = new Array(a.length).fill(null); let s = 0; for (let i = 0; i < a.length; i++) { s += a[i]; if (i >= n) s -= a[i - n]; if (i >= n - 1) o[i] = s / n; } return o; };
// EMA with k = 2/(n+1); seeded with the SMA of the first n values, first value at index n-1.
function ema(a, n) {
  const o = new Array(a.length).fill(null); const k = 2 / (n + 1);
  if (a.length < n) return o;
  let e = 0; for (let i = 0; i < n; i++) e += a[i]; e /= n; o[n - 1] = e;
  for (let i = n; i < a.length; i++) { e = a[i] * k + e * (1 - k); o[i] = e; }
  return o;
}

// ---------- signals ----------
// s[code][d] in {0,1}: decision known after the close of day d.
function buildSignals(dates, close, L = LEN) {
  const W = buildWeeks(dates, close);
  const wc = W.weeks.map((w) => w.close);
  const s20 = sma(wc, L.sma20), e21 = ema(wc, L.ema21), s50 = sma(wc, L.sma50), d200 = sma(close, L.sma200);
  const gt = (x, line) => (line !== null && x > line ? 1 : 0);
  const both = (a, b) => (a === null || b === null ? null : Math.max(a, b));
  const s = {}; for (const c of CODES) s[c] = new Array(close.length).fill(0);
  for (let i = 0; i < close.length; i++) {
    s.HOLD[i] = 1;
    s.T200[i] = gt(close[i], d200[i]);
    const w = W.wOf[i];
    if (w < 0) continue; // no completed week yet -> all weekly-based rules stay 0
    const mx = both(s20[w], e21[w]);
    s.WA[i] = gt(wc[w], s20[w]); s.WB[i] = gt(wc[w], e21[w]); s.WC[i] = gt(wc[w], mx); s.WD[i] = gt(wc[w], s50[w]);
    s.DA[i] = gt(close[i], s20[w]); s.DB[i] = gt(close[i], e21[w]); s.DC[i] = gt(close[i], mx); s.DD[i] = gt(close[i], s50[w]);
  }
  return { s, W, wc, s20, e21, s50, d200 };
}

// Days where a signal differs from the previous day but the day is not the Sunday-dated last bar of its week.
function offSundayChanges(sig, W, from) {
  const bad = [];
  for (let i = Math.max(1, from); i < sig.length; i++) {
    if (sig[i] === sig[i - 1]) continue;
    const isSunday = W.dn[i] === sundayOf(W.dn[i]);
    const lastOfWeek = i + 1 >= sig.length || sundayOf(W.dn[i + 1]) !== sundayOf(W.dn[i]);
    if (!(isSunday && lastOfWeek)) bad.push(i);
  }
  return bad;
}

// ---------- account ----------
// from/to: indices of decision days, inclusive. A day is processed only while open[d+2] exists.
function run(open, pos, from, to) {
  const N = open.length;
  let eq = 1, peak = 1, mdd = 0, trades = 0, prev = 0, days = 0, inMkt = 0;
  const curve = [];
  for (let t = from; t <= to && t + 2 < N; t++) {
    const p = pos[t] ? 1 : 0;
    if (p !== prev) { eq *= 1 - COST; trades++; prev = p; }
    if (p) { eq *= open[t + 2] / open[t + 1]; inMkt++; }
    days++;
    if (eq > peak) peak = eq;
    const dd = eq / peak - 1; if (dd < mdd) mdd = dd; // drawdown on daily values, before the closing cost
    curve.push(eq);
  }
  if (prev) eq *= 1 - COST; // close the open position; not counted in trades
  const cagr = days > 0 ? Math.pow(eq, 365.25 / days) - 1 : null;
  const ratio = cagr !== null && mdd < 0 ? cagr / Math.abs(mdd) : null;
  return { final: eq, total: eq - 1, cagr, mdd, ratio, trades, days, exposure: days ? inMkt / days : 0, curve };
}
const r2 = (x) => (x === null ? null : +(x * 100).toFixed(2));
const r3 = (x) => (x === null ? null : +x.toFixed(3));
const fmt = (st, first, last) => ({ first_decision_day: first, last_decision_day: last, days: st.days, trades: st.trades, exposure_pct: r2(st.exposure), total_pct: r2(st.total), cagr_pct: r2(st.cagr), maxdd_pct: r2(st.mdd), ratio: r3(st.ratio), raw: { final_account: st.final, cagr: st.cagr, maxdd: st.mdd, ratio: st.ratio } });
// One cell of the calendar-year table. The protocol asks for "дохідність за рік", which is the term it defines
// in Mechanics as account^(365.25/days) - 1, so return_pct is that formula (also for the partial last year).
// The plain change of the account over the year (account - 1) is kept next to it as the other reading.
const yearCell = (st) => ({ return_pct: r2(st.cagr), plain_total_pct: r2(st.total), maxdd_pct: r2(st.mdd), trades: st.trades, raw: { final_account: st.final, annual_return: st.cagr, maxdd: st.mdd } });

// ---------- bootstrap ----------
function mulberry32(seed) { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
// Circular block bootstrap of the mean of x; returns the percentile interval of the resampled means.
function blockBootstrap(x, { seed, block, reps, level }) {
  const n = x.length, rng = mulberry32(seed), means = new Array(reps);
  for (let b = 0; b < reps; b++) {
    let sum = 0, cnt = 0;
    while (cnt < n) { const st = Math.floor(rng() * n); for (let j = 0; j < block && cnt < n; j++, cnt++) sum += x[(st + j) % n]; }
    means[b] = sum / n;
  }
  means.sort((a, b) => a - b);
  const tail = (1 - level) / 2;
  return { lo: means[Math.floor(tail * reps)], hi: means[Math.floor((1 - tail) * reps)] };
}

// ---------- self-check ----------
function selfcheck() {
  let fails = 0;
  const ok = (cond, msg) => { console.log((cond ? 'ok   ' : 'FAIL ') + msg); if (!cond) fails++; };
  const near = (a, b) => Math.abs(a - b) <= 1e-12 * Math.max(1, Math.abs(b));
  const c = 1 - COST;

  // 1. Fill timing. Open-to-open ratios are all different: 2, 1.5, 2.5, 1.2, 1.1.
  const o = [100, 200, 300, 750, 900, 990];
  let r = run(o, [1, 0, 0, 0, 0, 0], 0, 5);
  ok(r.days === 4 && r.trades === 2 && near(r.final, c * 1.5 * c), 'decision at close of day 0 is filled at open 1 and held to open 2 (x1.5, not x2)');
  r = run(o, [0, 1, 1, 0, 0, 0], 0, 5);
  ok(r.trades === 2 && near(r.final, c * 2.5 * 1.2 * c), 'decisions at closes 1,2 earn open3/open2 and open4/open3; exit at close 3 costs once');
  r = run(o, [0, 0, 0, 1, 1, 1], 0, 5);
  ok(r.days === 4 && r.trades === 1 && near(r.final, c * 1.1 * c) && near(r.curve[3], c * 1.1), 'days without open[d+2] are not processed; closing cost applied once and not counted as a trade');
  r = run(o, [1, 1, 1, 1, 1, 1], 0, 5);
  ok(r.mdd === 0 && near(r.final, c * 1.5 * 2.5 * 1.2 * 1.1 * c), 'drawdown is measured before the closing cost');
  r = run(o, [1, 1, 1, 1, 1, 1], 2, 5);
  ok(r.days === 2 && r.trades === 1 && near(r.final, c * 1.2 * 1.1 * c), 'a window starts flat even if the signal was already 1 before it');
  ok(near(r.cagr, Math.pow(c * 1.2 * 1.1 * c, 365.25 / 2) - 1) && near(r.total, c * 1.2 * 1.1 * c - 1), 'return per year = account^(365.25/days) - 1 with days = processed decision days');
  const yc = yearCell({ final: 1.21, total: 0.21, cagr: Math.pow(1.21, 365.25 / 327) - 1, mdd: -0.1, trades: 2 });
  ok(yc.return_pct === 23.73 && yc.plain_total_pct === 21 && yc.maxdd_pct === -10, 'year table: return_pct is the protocol formula (23.73 for 1.21 over 327 days), the plain change (21) is stored separately');

  // 2. Tiny hand-made weeks. 2024-01-01 is a Monday. Weekly closes 10, 12, 11, 15; SMA length 2.
  const dates = [], close = [];
  const sundayClose = [10, 12, 11, 15];
  for (let i = 0; i < 31; i++) { dates.push(isoDate(dayNum('2024-01-01') + i)); close.push(i % 7 === 6 ? sundayClose[(i - 6) / 7] : (i % 2 ? 100 : 1)); }
  // days 28..30 are an unfinished 5th week with wild closes (1, 100, 1)
  const T = buildSignals(dates, close, { sma20: 2, ema21: 3, sma50: 4, sma200: 5 });
  ok(T.W.weeks.length === 4 && T.W.trailingIncomplete === 1, 'four completed weeks; the unfinished trailing week is not a weekly bar');
  ok(T.wc.join() === '10,12,11,15', 'weekly close is the close of the last daily bar of the week');
  ok(T.s20[0] === null && T.s20[1] === 11 && T.s20[2] === 11.5 && T.s20[3] === 13, 'weekly SMA uses completed weeks including the current one; no value before a full window');
  ok(T.e21[1] === null && T.e21[2] === 11 && near(T.e21[3], 15 * 0.5 + 11 * 0.5), 'weekly EMA starts as the SMA of the first n closes at week n, then k = 2/(n+1)');
  const expWA = []; for (let i = 0; i < 31; i++) expWA.push(i < 13 ? 0 : i < 20 ? 1 : i < 27 ? 0 : 1);
  ok(T.s.WA.join('') === expWA.join(''), 'weekly rule: 0 until Sunday of week 2, then 1, 0 from Sunday of week 3, 1 from Sunday of week 4');
  const chg = []; for (let i = 1; i < 31; i++) if (T.s.WA[i] !== T.s.WA[i - 1]) chg.push(i);
  ok(chg.join() === '13,20,27' && offSundayChanges(T.s.WA, T.W, 0).length === 0, 'weekly rule changes only on days 13, 20, 27 (Sundays, last daily bars of their weeks)');
  ok(T.s.DA[13] === 1 && T.s.DA[14] === 0 && T.s.DA[15] === 1 && T.s.DA[12] === 0 && T.s.DA[19] === 1, 'daily rule compares each daily close with the line of the last completed week');
  ok(T.s.WD.slice(0, 27).every((v) => v === 0) && T.s.WD[27] === 1, 'no decision before the average exists (s = 0)');
  // weekly decision at Sunday close (day 13) -> filled at Monday open (day 14)
  const o2 = dates.map((_, i) => 100 + i * i);
  r = run(o2, T.s.WA, 0, 30);
  ok(near(r.curve[13], c * o2[15] / o2[14]) && r.curve[12] === 1, 'weekly decision at Sunday close is filled at Monday open');

  // 3. Protocol lengths on a longer synthetic series that starts mid-week (Wednesday 2020-01-01).
  const rng = mulberry32(7); const d3 = [], c3 = []; let p = 100;
  for (let i = 0; i < 700; i++) { d3.push(isoDate(dayNum('2020-01-01') + i)); p *= Math.exp((rng() - 0.5) * 0.08 + 0.02 * Math.sin(i / 40)); c3.push(p); }
  const S = buildSignals(d3, c3);
  let changes = 0, bad = 0;
  for (const k of WEEKLY) { for (let i = 1; i < 700; i++) if (S.s[k][i] !== S.s[k][i - 1]) changes++; bad += offSundayChanges(S.s[k], S.W, 0).length; }
  ok(changes > 4 && bad === 0, `weekly rules WA..WD changed ${changes} times, never on a day other than the last daily bar of a week`);
  ok(S.W.weeks[0].bars === 5 && S.W.wOf[4] === 0 && S.W.wOf[3] === -1, 'a partial first week counts as a weekly bar once its Sunday has closed');
  let m = 0; for (let i = 0; i < 21; i++) m += S.wc[i]; m /= 21;
  ok(S.e21[19] === null && near(S.e21[20], m) && near(S.e21[21], S.wc[21] * 2 / 22 + m * 20 / 22), 'EMA21: first value on week 21 = SMA of 21 closes; coefficient 2/22');
  ok(S.s20[18] === null && S.s20[19] !== null && S.s50[48] === null && S.s50[49] !== null, 'SMA20 appears on week 20, SMA50 on week 50');
  let dchg = 0; for (let i = 1; i < 700; i++) if (S.s.DA[i] !== S.s.DA[i - 1] && S.W.dn[i] !== sundayOf(S.W.dn[i])) dchg++;
  ok(dchg > 0, 'daily rules are allowed to change mid-week (the check above is not vacuous)');

  // 4. Literal protocol with a missing Sunday bar: week closes on Saturday's close but is complete only at the next bar.
  const d4 = dates.filter((_, i) => i !== 13), c4 = close.filter((_, i) => i !== 13); c4[12] = 12;
  const G = buildSignals(d4, c4, { sma20: 2, ema21: 3, sma50: 4, sma200: 5 });
  ok(G.wc.join() === '10,12,11,15' && G.s.WA[12] === 0 && G.s.WA[13] === 1, 'missing Sunday: weekly close = Saturday close, decision appears on the next available bar (literal rule)');

  console.log(fails ? `SELFCHECK FAILED (${fails})` : 'SELFCHECK PASSED');
  process.exit(fails ? 1 : 0);
}

// ---------- main ----------
function main(csvPath, coinsPath, outPath) {
  const sha = (buf) => crypto.createHash('sha256').update(buf).digest('hex');
  const csvBuf = fs.readFileSync(csvPath);
  const L = csvBuf.toString('utf8').replace(/\r/g, '').trim().split('\n');
  const parseHeader = (l) => { const o = []; let c = '', q = false; for (const ch of l) { if (ch === '"') { q = !q; continue; } if (ch === ',' && !q) { o.push(c); c = ''; continue; } c += ch; } o.push(c); return o; };
  const H = parseHeader(L[0]);
  const col = (name) => { const j = H.indexOf(name); if (j < 0) throw new Error('column not found: ' + name); return j; };
  const jT = col('time'), jO = col('open'), jC = col('close');
  const R = L.slice(1).map((l) => l.split(',')).slice(0, -1); // drop the unclosed last row
  const N = R.length;
  const date = R.map((r) => r[jT].slice(0, 10)), open = R.map((r) => +r[jO]), close = R.map((r) => +r[jC]);
  for (let i = 0; i < N; i++) if (!(open[i] > 0) || !(close[i] > 0) || (i && date[i] <= date[i - 1])) throw new Error('bad row ' + i);

  const B = buildSignals(date, close);
  const firstIdx = (y) => date.findIndex((d) => +d.slice(0, 4) >= y);
  const lastIdx = (y) => { let k = -1; for (let i = 0; i < N; i++) if (+date[i].slice(0, 4) <= y) k = i; return k; };
  const windows = { P1: [firstIdx(2016), N - 1], P2: [firstIdx(2022), N - 1], P3: [firstIdx(2012), N - 1] };
  const lastProcessed = (a, b) => Math.min(b, N - 3);

  const out = {
    meta: {
      protocol: 'PREREGISTRATION_TV_WEEKLY.md', script: 'analysis/tv_backtest_weekly.js',
      csv: csvPath, csv_sha256: sha(csvBuf), coins: coinsPath, coins_sha256: null,
      days_total: N, first_day: date[0], last_day: date[N - 1],
      weeks_total: B.W.weeks.length, first_week_sunday: isoDate(B.W.weeks[0].sunday), first_week_daily_bars: B.W.weeks[0].bars,
      last_week_sunday: isoDate(B.W.weeks[B.W.weeks.length - 1].sunday), trailing_incomplete_weeks_not_counted: B.W.trailingIncomplete,
      cost_per_position_change: COST, lengths: LEN, bootstrap: BOOT,
    },
    data_checks: {}, rules: {}, verdicts: {}, bootstrap_WA_vs_T200_P1: null, years: [], coins: {}, coins_summary: null, reading_notes: [],
  };

  // data checks
  const gaps = []; for (let i = 1; i < N; i++) if (B.W.dn[i] - B.W.dn[i - 1] !== 1) gaps.push(`${date[i - 1]}->${date[i]}`);
  const shortWeeks = B.W.weeks.filter((w) => w.bars < 7).map((w) => `${isoDate(w.sunday)}:${w.bars}`);
  const noSunday = B.W.weeks.filter((w) => B.W.dn[w.lastIdx] !== w.sunday).map((w) => isoDate(w.sunday));
  let emptyWeeks = 0; for (let k = 1; k < B.W.weeks.length; k++) emptyWeeks += (B.W.weeks[k].sunday - B.W.weeks[k - 1].sunday) / 7 - 1;
  const off = {}; for (const k of WEEKLY) off[k] = { whole_history: offSundayChanges(B.s[k], B.W, 0).map((i) => date[i]), inside_windows_from_2012: offSundayChanges(B.s[k], B.W, windows.P3[0]).map((i) => date[i]) };
  const firstVal = (a) => { const k = a.findIndex((v) => v !== null); return k < 0 ? null : k; };
  out.data_checks = {
    daily_gaps: gaps, weeks_with_fewer_than_7_bars: shortWeeks, weeks_without_sunday_bar: noSunday, empty_weeks_skipped: emptyWeeks,
    weekly_rule_changes_not_on_last_bar_of_week: off,
    first_day_with_value: { SMA20w: date[B.W.weeks[firstVal(B.s20)].lastIdx], EMA21w: date[B.W.weeks[firstVal(B.e21)].lastIdx], SMA50w: date[B.W.weeks[firstVal(B.s50)].lastIdx], SMA200d: date[firstVal(B.d200)] },
  };
  for (const k of WEEKLY) if (off[k].inside_windows_from_2012.length) throw new Error(`weekly rule ${k} changed off-Sunday inside a window`);

  // rules x windows
  const stats = {};
  for (const code of CODES) {
    stats[code] = {}; out.rules[code] = {};
    for (const [w, [a, b]] of Object.entries(windows)) { const st = run(open, B.s[code], a, b); stats[code][w] = st; out.rules[code][w] = fmt(st, date[a], date[lastProcessed(a, b)]); }
  }

  // verdicts: unrounded numbers, strict in P1, "not worse" in P2
  const t1 = stats.T200.P1, t2 = stats.T200.P2;
  for (const code of [...WEEKLY, ...DAILY]) {
    const s1 = stats[code].P1, s2 = stats[code].P2;
    const ddSmaller = Math.abs(s1.mdd) < Math.abs(t1.mdd), ratioBetter = s1.ratio !== null && t1.ratio !== null && s1.ratio > t1.ratio;
    const p2NotWorse = s2.ratio !== null && t2.ratio !== null && s2.ratio >= t2.ratio;
    const passed = ddSmaller && ratioBetter;
    out.verdicts[code] = { main_rule: code === 'WA', p1_drawdown_smaller_than_T200: ddSmaller, p1_ratio_better_than_T200: ratioBetter, p2_ratio_not_worse_than_T200: p2NotWorse, passed, passed_steadily: passed && p2NotWorse, label: passed ? (p2NotWorse ? 'пройшло стійко' : 'пройшло') : 'не пройшло' };
  }

  // bootstrap: daily difference of log changes of the two accounts in P1 (daily values, costs inside)
  {
    const a = stats.WA.P1.curve, b = stats.T200.P1.curve, n = a.length, x = new Array(n);
    for (let i = 0; i < n; i++) x[i] = Math.log(a[i] / (i ? a[i - 1] : 1)) - Math.log(b[i] / (i ? b[i - 1] : 1));
    const mean = x.reduce((u, v) => u + v, 0) / n;
    const ci = blockBootstrap(x, BOOT);
    const lo = ci.lo * 365.25, hi = ci.hi * 365.25;
    out.bootstrap_WA_vs_T200_P1 = { days: n, ...BOOT, rng: 'mulberry32', method: 'circular block bootstrap, percentile interval, sorted[floor(q*reps)]', mean_diff_annual_pct: r2(mean * 365.25), ci90_low_pct: r2(lo), ci90_high_pct: r2(hi), contains_zero: lo <= 0 && hi >= 0, raw: { mean_daily: mean, mean_annual: mean * 365.25, ci_low_annual: lo, ci_high_annual: hi } };
  }

  // calendar years: each year is its own window (starts flat, closing cost at the end)
  for (let y = 2016; y <= 2026; y++) {
    const a = firstIdx(y), b = lastIdx(y), row = { year: y, first_decision_day: date[a], last_decision_day: date[lastProcessed(a, b)] };
    for (const [key, code] of [['wa', 'WA'], ['t200', 'T200']]) { const st = run(open, B.s[code], a, b); row.days = st.days; row[key] = yearCell(st); }
    out.years.push(row);
  }

  // other coins, WA only
  const coinsBuf = fs.readFileSync(coinsPath); out.meta.coins_sha256 = sha(coinsBuf);
  const coinsRaw = coinsBuf[0] === 0x1f && coinsBuf[1] === 0x8b ? zlib.gunzipSync(coinsBuf) : coinsBuf;
  out.meta.coins_unpacked_sha256 = sha(coinsRaw);
  const coins = JSON.parse(coinsRaw.toString('utf8'));
  let passedCoins = 0, counted = 0;
  for (const [k, cn] of Object.entries(coins)) {
    const rows = cn.rows.slice(0, -1); // drop the unclosed last row
    const cd = rows.map((r) => String(r[0]).slice(0, 10)), co = rows.map((r) => +r[1]), cc = rows.map((r) => +r[4]);
    const n = rows.length, from = 200, to = n - 1; // evaluation from the 201st day
    const S = buildSignals(cd, cc);
    const offC = offSundayChanges(S.s.WA, S.W, 0);
    const h = run(co, S.s.HOLD, from, to), w = run(co, S.s.WA, from, to);
    const ddSmaller = Math.abs(w.mdd) < Math.abs(h.mdd), ratioBetter = w.ratio !== null && h.ratio !== null && w.ratio > h.ratio;
    const passed = ddSmaller && ratioBetter; counted++; if (passed) passedCoins++;
    out.coins[k] = { symbol: cn.symbol, days_total: n, first_day: cd[0], evaluated_from: cd[from], last_day: cd[n - 1], weeks_total: S.W.weeks.length, wa_changes_not_on_last_bar_of_week: offC.map((i) => cd[i]), hold: fmt(h, cd[from], cd[Math.min(to, n - 3)]), wa: fmt(w, cd[from], cd[Math.min(to, n - 3)]), drawdown_smaller_than_hold: ddSmaller, ratio_better_than_hold: ratioBetter, passed };
  }
  out.coins_summary = { coins_counted: counted, passed: passedCoins, needed: 8, confirmed: passedCoins >= 8 };

  out.reading_notes = [
    'Week is complete at the close of day d when its Sunday date <= date(d); a partial first week (history starts on a Thursday) counts as weekly bar 1.',
    'With a missing Sunday bar the weekly close is the last available bar of the week and the decision appears on the next available bar (2011 only, before every window).',
    'd+1 and d+2 are the next rows of the series, not calendar days; SMA200 counts rows.',
    'Calendar years are treated as separate windows: flat at the start, closing cost at the end. return_pct applies the protocol formula for "дохідність за рік", account^(365.25/days) - 1, with days = processed decision days of that year (366, 365 or 327 for 2026); plain_total_pct = final account - 1 is the other reading of the same phrase.',
    'Bootstrap uses the daily account values (before the closing cost); interval = percentile method on resampled means times 365.25.',
    'Coins: all ten counted, pass test on unrounded numbers.',
  ];

  fs.writeFileSync(outPath, JSON.stringify(out, null, 1) + '\n');

  // compact summary
  const pad = (v, n) => String(v).padStart(n);
  console.log(`days ${N} (${date[0]}..${date[N - 1]}), weeks ${B.W.weeks.length} (last Sunday ${out.meta.last_week_sunday}), seed ${BOOT.seed}`);
  for (const w of ['P1', 'P2', 'P3']) {
    console.log(`${w}: ${out.rules.HOLD[w].first_decision_day}..${out.rules.HOLD[w].last_decision_day}, ${out.rules.HOLD[w].days} days`);
    for (const code of CODES) { const o = out.rules[code][w]; console.log(`  ${code.padEnd(5)} cagr ${pad(o.cagr_pct, 8)}%  dd ${pad(o.maxdd_pct, 7)}%  ratio ${pad(o.ratio, 6)}  trades ${pad(o.trades, 4)}`); }
  }
  for (const [code, v] of Object.entries(out.verdicts)) console.log(`verdict ${code}: ${v.label}${code === 'WA' ? '  <- main rule' : ''}`);
  const bs = out.bootstrap_WA_vs_T200_P1; console.log(`bootstrap WA-T200 P1: mean ${bs.mean_diff_annual_pct}%/yr, CI90 [${bs.ci90_low_pct}, ${bs.ci90_high_pct}], contains zero: ${bs.contains_zero}`);
  for (const y of out.years) console.log(`${y.year} (${pad(y.days, 3)} days): WA ${pad(y.wa.return_pct, 8)}% (plain ${pad(y.wa.plain_total_pct, 8)}%) dd ${pad(y.wa.maxdd_pct, 7)}% | T200 ${pad(y.t200.return_pct, 8)}% (plain ${pad(y.t200.plain_total_pct, 8)}%) dd ${pad(y.t200.maxdd_pct, 7)}%`);
  for (const [k, v] of Object.entries(out.coins)) console.log(`${k.padEnd(5)} from ${v.evaluated_from} | hold ${pad(v.hold.cagr_pct, 7)}% dd ${pad(v.hold.maxdd_pct, 7)}% | WA ${pad(v.wa.cagr_pct, 7)}% dd ${pad(v.wa.maxdd_pct, 7)}% tr ${pad(v.wa.trades, 3)} | ${v.passed ? 'PASS' : 'fail'}`);
  console.log(`coins passed ${passedCoins}/${counted}, confirmed: ${out.coins_summary.confirmed}`);
}

const args = process.argv.slice(2);
if (args.includes('--selfcheck')) selfcheck();
else if (args.length === 3) main(args[0], args[1], args[2]);
else { console.error('Usage: node tv_backtest_weekly.js <btc_daily.csv> <coins.json.gz> <out.json> | --selfcheck'); process.exit(2); }
