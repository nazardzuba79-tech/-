'use strict';
// Tests for paper_da.js (the second paper ledger, rule "BTC DA"). Run: node --test <this directory>
// Everything is offline (--data or a fake exchange) and writes only to the OS temp directory.
// Adapted from paper/paper_trade.test.js: every protection checked there is checked here, plus the
// weekly-bar logic and a day-for-day replay against an independent computation of rule DA.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const tool = require('./paper_da.js');
const SCRIPT = path.join(__dirname, 'paper_da.js');
const EXPORT = path.join(__dirname, '..', 'exports', 'btcusd_bitstamp_1d_20261126.csv');
const COST = 0.0015;
const DAY_MS = 86400000;
const RULE_HASH = 'dfe77556755a57e5cb4f56fc7d52fb2d90d35be3831d6f6a169c4809cbbd0c6d';
// Column positions in a ledger row (0-based).
const COL = Object.fromEntries(tool.COLUMNS.map((c, i) => [c, i]));
const N_HASHED = tool.COLUMNS.length - 2;

// ---------- helpers ----------

const tmpDirs = [];
function tmpDir() {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'csi-paper-da-test-'));
  tmpDirs.push(d);
  return d;
}
test.after(() => { for (const d of tmpDirs) fs.rmSync(d, { recursive: true, force: true }); });

// Run the tool in-process (fast). Returns exit code and captured text.
async function run(args) {
  const out = [], err = [];
  const code = await tool.main(args, (l) => out.push(l), (l) => err.push(l));
  return { code, out: out.join('\n'), err: err.join('\n') };
}
// Run the tool as a real child process.
function runCli(args) {
  const r = spawnSync(process.execPath, [SCRIPT, ...args], { encoding: 'utf8' });
  return { code: r.status, out: r.stdout, err: r.stderr };
}

const addDays = (date, n) => new Date(Date.parse(date + 'T00:00:00Z') + n * DAY_MS).toISOString().slice(0, 10);
const weekday = (date) => new Date(date + 'T00:00:00Z').getUTCDay(); // 0 = Sunday

// The exported TradingView CSV as [{date, open, close}].
let exportCache = null;
function exportBars() {
  if (!exportCache) {
    exportCache = fs.readFileSync(EXPORT, 'utf8').trim().split('\n').slice(1).map((l) => {
      const c = l.split(',');
      return { date: c[0], open: Number(c[1]), close: Number(c[4]), high: Number(c[2]), low: Number(c[3]) };
    });
  }
  return exportCache;
}
function writeCsv(file, bars) {
  fs.writeFileSync(file, 'time,open,high,low,close\n' + bars.map((b) => `${b.date},${b.open},${b.open},${b.close},${b.close}`).join('\n') + '\n');
  return file;
}
function readLedger(file) {
  const lines = fs.readFileSync(file, 'utf8').trimEnd().split('\n');
  const cols = lines[0].split(',');
  return lines.slice(1).map((l) => Object.fromEntries(l.split(',').map((v, i) => [cols[i], v])));
}
// Rewrite the hash chain after editing cells, so that only the arithmetic check can notice.
function rechain(file, edit) {
  const lines = fs.readFileSync(file, 'utf8').trimEnd().split('\n');
  let prev = 'GENESIS';
  const rows = lines.slice(1).map((l, i) => {
    const cells = l.split(',');
    edit(cells, i);
    cells[COL.prev_row_sha256] = prev;
    cells[COL.row_sha256] = tool.sha256(prev + '|' + cells.slice(0, N_HASHED).join(','));
    prev = cells[COL.row_sha256];
    return cells.join(',');
  });
  fs.writeFileSync(file, [lines[0], ...rows].join('\n') + '\n');
}

// A small slice of real data: start 2020-01-20 (a Monday). Rule DA trades on 01-21 (BUY), 01-26 (SELL),
// 01-27 (BUY) and 03-09 (SELL); the "200D only" account trades on other days.
const SLICE_START = '2020-01-20';
const SLICE_END = '2020-03-20';
const SLICE_TRADES = ['2020-01-21 BUY', '2020-01-26 SELL', '2020-01-27 BUY', '2020-03-09 SELL'];
const sliceBars = (to = SLICE_END) => exportBars().filter((b) => b.date >= '2019-01-01' && b.date <= to);
const sliceArgs = (dir, csv) => ['--data', csv, '--ledger', path.join(dir, 'ledger.csv'), '--start', SLICE_START];

// ---------- (e) the frozen rule ----------

test('(e) frozen rule: values, columns and hash are pinned', () => {
  const r = tool.FROZEN_RULE;
  assert.equal(r.name, 'BTC DA');
  assert.equal(r.start_date, '2026-11-27');
  assert.equal(r.start_equity_usd, 10000);
  assert.equal(r.start_position, 0);
  assert.equal(r.cost_per_position_change, 0.0015);
  assert.deepEqual([r.weekly_sma_weeks, r.sma_benchmark_days, r.min_closed_bars, r.min_closed_bars_for_weekly_average], [20, 200, 200, 147]);
  assert.equal(r.data_endpoint, 'https://www.bitstamp.net/api/v2/ohlc/btcusd/?step=86400&limit=1000');
  assert.equal(r.data_checks.max_jump_close_to_next_open, 0.2);
  assert.equal(r.revision_tolerance, 0.0005);
  // The evaluation thresholds are part of the frozen rule.
  assert.equal(r.evaluation.min_days, 365);
  assert.equal(r.evaluation.min_round_trips, 6);
  assert.match(r.evaluation.compared_with, /^200D only/);
  assert.match(r.evaluation.confirmed, /max drawdown smaller than 200D only AND annualised return divided by max drawdown better than 200D only/);
  assert.match(r.evaluation.verdict_day, /first recorded day on which both minimums are met/);
  assert.match(r.origin, /post-hoc/);
  // If this fails, the rule was edited. A frozen rule must not change.
  assert.equal(tool.makeRule().hash, RULE_HASH);
  assert.equal(tool.sha256(tool.canonicalJson({ b: 1, a: [2, { d: 3, c: 4 }] })), tool.sha256('{"a":[2,{"c":4,"d":3}],"b":1}'));
  assert.deepEqual(tool.COLUMNS, ['seq', 'date', 'open', 'close', 'sma20w', 'week_end', 'sma200', 'above_sma20w', 'pos_held', 'trade', 'cost_usd',
    'target_next', 'equity', 'equity_200d_only', 'pos_200d_only', 'equity_hold', 'data_source', 'rule_sha256', 'prev_row_sha256', 'row_sha256']);
});

test('decide: strictly above the 20-week average; the last completed week ends on a Sunday', () => {
  assert.equal(tool.decide(100, null, 90), null, 'no 20-week average means no decision');
  assert.deepEqual(tool.decide(100, 99.99, 100), { above20w: true, above200: false });
  assert.deepEqual(tool.decide(100, 100, 99.99), { above20w: false, above200: true }, 'strictly greater');
  assert.deepEqual(tool.decide(100, 100.01, null), { above20w: false, above200: false });
  const sunday = (date) => new Date(tool.lastCompletedSunday(Date.parse(date + 'T00:00:00Z') / DAY_MS) * DAY_MS).toISOString().slice(0, 10);
  // 2026-11-29 is a Sunday.
  assert.equal(weekday('2026-11-29'), 0);
  assert.deepEqual(['2026-11-23', '2026-11-27', '2026-11-28', '2026-11-29', '2026-11-30', '2026-12-05', '2026-12-06'].map(sunday),
    ['2026-11-22', '2026-11-22', '2026-11-22', '2026-11-29', '2026-11-29', '2026-11-29', '2026-12-06']);
  for (let d = '2019-12-20'; d <= '2020-01-20'; d = addDays(d, 1)) {
    const s = sunday(d);
    assert.equal(weekday(s), 0, `${d}: ${s} is a Sunday`);
    assert.ok(s <= d && addDays(s, 7) > d, `${d}: the Sunday is the latest one not after the day`);
  }
});

// ---------- (a) weekly bars on a hand-computed series ----------

// Synthetic series: `pre` closed days before the start, then the listed [open, close] days.
function synthetic(dir, pre, days, start = '2020-01-01') {
  const bars = pre.map((p, i) => ({ date: addDays(start, i - pre.length), open: p, close: p }))
    .concat(days.map(([open, close], i) => ({ date: addDays(start, i), open, close })));
  return ['--data', writeCsv(path.join(dir, 'data.csv'), bars), '--ledger', path.join(dir, 'ledger.csv'), '--start', start];
}

test('(a) weekly bars: the 20-week average uses Sunday closes only, changes only on Sundays, and on a Sunday already includes that day', async () => {
  const dir = tmpDir();
  const start = '2020-01-06'; // a Monday
  assert.equal(weekday(start), 1);
  // 210 days (30 full Monday-Sunday weeks) before the start. Sunday closes are 171, 172, ..., 200
  // (the last one on 2020-01-05); every other day closes at 1000 and must not matter.
  const pre = [];
  for (let i = 0; i < 210; i++) pre.push(i % 7 === 6 ? 171 + (i - 6) / 7 : 1000);
  assert.equal(weekday(addDays(start, -1)), 0);
  const days = [
    // week 1: the average is (181 + ... + 200) / 20 = 3810 / 20 = 190.5 all week
    [300, 300], [150, 150], [190.5, 190.5], [190.51, 190.51], [50, 50], [5000, 5000],
    // Sunday 2020-01-12 closes at 190.90: the average becomes (3810 - 181 + 190.9) / 20 = 190.995 on this very row,
    // and 190.90 is NOT above it (against the old 190.5 it would have been)
    [190.9, 190.9],
    // week 2: 190.995 all week
    [190.99, 190.99], [191, 191], [100, 100], [100, 100], [100, 100], [1, 1],
    // Sunday 2020-01-19 closes at 400: (3819.9 - 182 + 400) / 20 = 201.895
    [400, 400],
    // week 3
    [201.89, 201.89], [201.9, 201.9],
  ];
  const args = synthetic(dir, pre, days, start);
  const r = await run(['update', ...args]);
  assert.equal(r.code, 0, r.err);
  const rows = readLedger(path.join(dir, 'ledger.csv'));
  assert.deepEqual(rows.map((x) => [x.date, x.sma20w, x.week_end, x.above_sma20w].join(' ')), [
    '2020-01-06 190.500000 2020-01-05 1',
    '2020-01-07 190.500000 2020-01-05 0',
    '2020-01-08 190.500000 2020-01-05 0', // exactly equal is not "above"
    '2020-01-09 190.500000 2020-01-05 1',
    '2020-01-10 190.500000 2020-01-05 0',
    '2020-01-11 190.500000 2020-01-05 1', // a wild Saturday close does not move the average
    '2020-01-12 190.995000 2020-01-12 0', // Sunday: its own week is already in the average
    '2020-01-13 190.995000 2020-01-12 0',
    '2020-01-14 190.995000 2020-01-12 1',
    '2020-01-15 190.995000 2020-01-12 0',
    '2020-01-16 190.995000 2020-01-12 0',
    '2020-01-17 190.995000 2020-01-12 0',
    '2020-01-18 190.995000 2020-01-12 0',
    '2020-01-19 201.895000 2020-01-19 1',
    '2020-01-20 201.895000 2020-01-19 0',
    '2020-01-21 201.895000 2020-01-19 1',
  ]);
  rows.forEach((x, i) => {
    assert.equal(x.target_next, x.above_sma20w);
    if (i && x.sma20w !== rows[i - 1].sma20w) assert.equal(weekday(x.date), 0, `the average changed on ${x.date}, which must be a Sunday`);
    assert.equal(x.week_end === x.date, weekday(x.date) === 0);
  });
  // The decision of each day is executed at the next open.
  assert.deepEqual(rows.filter((x) => x.trade).map((x) => `${x.date} ${x.trade}`), ['2020-01-07 BUY', '2020-01-08 SELL', '2020-01-10 BUY', '2020-01-11 SELL',
    '2020-01-12 BUY', '2020-01-13 SELL', '2020-01-15 BUY', '2020-01-16 SELL', '2020-01-20 BUY', '2020-01-21 SELL']);
  assert.equal((await run(['verify', ...args])).code, 0);

  // A different close on a day that is not a Sunday (inside the 20 weeks) changes no 20-week average at all.
  const other = tmpDir();
  const pre2 = pre.slice();
  pre2[204] = 5; // Tuesday 2019-12-31
  assert.equal(addDays(start, 204 - 210), '2019-12-31');
  assert.equal(weekday('2019-12-31'), 2);
  assert.equal((await run(['update', ...synthetic(other, pre2, days, start)])).code, 0);
  assert.deepEqual(readLedger(path.join(other, 'ledger.csv')).map((x) => x.sma20w), rows.map((x) => x.sma20w));
  // A different Sunday close inside the 20 weeks does change it: (3810 - 190 + 290) / 20 = 195.5.
  const third = tmpDir();
  const pre3 = pre.slice();
  pre3[139] = 290; // Sunday 2019-10-27, close was 190
  assert.equal(pre[139], 190);
  assert.equal((await run(['update', ...synthetic(third, pre3, days, start)])).code, 0);
  assert.equal(readLedger(path.join(third, 'ledger.csv'))[0].sma20w, '195.500000');
  // A Sunday older than 20 weeks does not: 2019-08-18 (close 180) is the 21st Sunday back.
  const fourth = tmpDir();
  const pre4 = pre.slice();
  pre4[69] = 9999;
  assert.equal(pre[69], 180);
  assert.equal((await run(['update', ...synthetic(fourth, pre4, days, start)])).code, 0);
  assert.deepEqual(readLedger(path.join(fourth, 'ledger.csv')).slice(0, 6).map((x) => x.sma20w), rows.slice(0, 6).map((x) => x.sma20w));
});

// ---------- (b) replay against an independent re-computation of rule DA ----------

// Rule DA written from the text of PREREGISTRATION_TV_WEEKLY.md, independently of the tool:
// weeks are Monday..Sunday (UTC); the weekly close is the close of the last daily bar of the week;
// a week is complete at the close of day d when its Sunday is not later than d; SMA20 is the mean
// of the last 20 completed weekly closes; the signal of day d is close(d) > SMA20(last completed week).
function independentDA(bars) {
  const sundayOf = (date) => { const wd = weekday(date); return wd === 0 ? date : addDays(date, 7 - wd); };
  const weeks = []; // { sunday, close } in order of time
  for (const b of bars) {
    const sunday = sundayOf(b.date);
    if (weeks.length && weeks[weeks.length - 1].sunday === sunday) weeks[weeks.length - 1].close = b.close;
    else weeks.push({ sunday, close: b.close });
  }
  let k = -1; // index of the last week completed at the close of the current day
  return bars.map((b) => {
    while (k + 1 < weeks.length && weeks[k + 1].sunday <= b.date) k++;
    if (k < 19) return { date: b.date, signal: 0, sma: null };
    let sum = 0;
    for (let j = k - 19; j <= k; j++) sum += weeks[j].close;
    return { date: b.date, signal: b.close > sum / 20 ? 1 : 0, sma: sum / 20, sunday: weeks[k].sunday };
  });
}

test('(b) replay from 2016-01-01: above_sma20w equals rule DA of the weekly protocol, day for day', () => {
  const dir = tmpDir();
  const ledgerFile = path.join(dir, 'ledger.csv');
  const args = ['--data', EXPORT, '--ledger', ledgerFile, '--start', '2016-01-01', '--now', '2026-11-26T18:00:00Z'];
  const res = runCli(['update', ...args]);
  assert.equal(res.code, 0, res.err);
  const rows = readLedger(ledgerFile);

  // The whole export (it has missing days in 2011-2015, which the protocol text allows for) up to the last closed day.
  const bars = exportBars().filter((b) => b.date <= '2026-11-25');
  const da = independentDA(bars);
  const i0 = bars.findIndex((b) => b.date === '2016-01-01');
  const mean = (i, n) => { let s = 0; for (let k = i - n + 1; k <= i; k++) s += bars[k].close; return s / n; };
  // Independent accounts: equity built per trade (entry open to exit open), not per day as the tool does.
  function simulate(signal) {
    let realized = 10000, entryOpen = null, held = 0, target = 0;
    const out = [];
    for (let i = i0; i < bars.length; i++) {
      const b = bars[i];
      let trade = '';
      if (target !== held) {
        if (target) { realized *= 1 - COST; entryOpen = b.open; trade = 'BUY'; } else { realized *= (b.open / entryOpen) * (1 - COST); trade = 'SELL'; }
        held = target;
      }
      out.push({ date: b.date, held, trade, equity: held ? realized * b.close / entryOpen : realized });
      target = signal(i);
    }
    return out;
  }
  const strat = simulate((i) => da[i].signal), only200 = simulate((i) => (bars[i].close > mean(i, 200) ? 1 : 0)), hold = simulate(() => 1);

  assert.equal(rows.length, strat.length);
  assert.equal(rows.length, 3982);
  assert.equal(rows[0].date, '2016-01-01');
  assert.equal(rows[rows.length - 1].date, '2026-11-25');
  const near = (a, b, what) => assert.ok(Math.abs(a - b) <= 1e-6 * Math.abs(b), `${what}: ${a} vs ${b}`);
  let ones = 0;
  rows.forEach((r, i) => {
    const e = strat[i], d = da[i0 + i];
    assert.equal(r.seq, String(i + 1));
    assert.equal(r.date, e.date);
    assert.equal(d.date, r.date);
    assert.equal(r.above_sma20w, String(d.signal), `DA signal ${r.date}`);
    assert.equal(r.week_end, d.sunday, `week used on ${r.date}`);
    near(Number(r.sma20w), d.sma, `20-week average ${r.date}`);
    near(Number(r.sma200), mean(i0 + i, 200), `200-day average ${r.date}`);
    assert.equal(r.target_next, r.above_sma20w);
    assert.equal(r.pos_held, String(e.held), `position ${r.date}`);
    assert.equal(r.trade, e.trade, `trade ${r.date}`);
    assert.equal(r.pos_200d_only, String(only200[i].held), `200D position ${r.date}`);
    near(Number(r.equity), e.equity, `equity ${r.date}`);
    near(Number(r.equity_200d_only), only200[i].equity, `200D ${r.date}`);
    near(Number(r.equity_hold), hold[i].equity, `hold ${r.date}`);
    // The weekly average moves only on Sundays, and a Sunday row uses its own week.
    if (i && r.sma20w !== rows[i - 1].sma20w) assert.equal(weekday(r.date), 0, `average changed on ${r.date}`);
    assert.equal(r.week_end === r.date, weekday(r.date) === 0, `week_end on ${r.date}`);
    if (d.signal) ones++;
  });
  assert.ok(ones > 1500 && ones < 3000, `the signal is not trivial: ${ones} days in the market`);

  // Anchors: the first trades, the number of position changes (about 8 a year), and the days on which
  // the rule and "200D only" held different positions.
  const trades = rows.filter((r) => r.trade).map((r) => `${r.date} ${r.trade}`);
  assert.equal(trades.length, 90);
  assert.deepEqual(trades.slice(0, 4), ['2016-01-02 BUY', '2016-08-03 SELL', '2016-08-04 BUY', '2016-08-30 SELL']);
  assert.deepEqual(trades.slice(-2), ['2026-08-20 BUY', '2026-11-13 SELL']);
  assert.equal(rows.filter((r) => r.pos_held !== r.pos_200d_only).length, 251);
  assert.notEqual(rows[rows.length - 1].equity, rows[rows.length - 1].equity_200d_only);

  const ver = runCli(['verify', ...args]);
  assert.equal(ver.code, 0, ver.err);
  assert.match(ver.out, /^OK\./);

  // Side files: rule file hashes to the recorded rule hash; status is written in Ukrainian.
  const ruleText = fs.readFileSync(path.join(dir, 'frozen_rule.json'), 'utf8');
  assert.equal(tool.sha256(ruleText), rows[0].rule_sha256);
  assert.equal(rows[0].rule_sha256, tool.makeRule('2016-01-01').hash);
  const status = fs.readFileSync(path.join(dir, 'STATUS_UA.md'), 'utf8');
  assert.match(status, /Останній закритий день у журналі: 2026-11-25/);
  assert.match(status, /Середня за 20 тижнів \(за тижнями до неділі 2026-11-22 включно\): 73 741\.21 USD\. BTC нижче неї: 60 382\.11 проти 73 741\.21\./);
  assert.match(status, /тримає: долари \(поза ринком\)/);
  assert.match(status, /Угод за правилом: 90 \(купівель 45, продажів 45\)\. Завершених угод «купив і продав»: 45/);
  assert.match(status, /тримали різне: 251 із 3982/);
  // The drawdowns agree with RESULTS_TV_WEEKLY_UA.md (DA -61.4%, 200-day average -67.4%, hold -83.4%).
  assert.match(status, /Правило «BTC DA»[^\n]*\| -61\.42% \|/);
  assert.match(status, /Лише 200-денна середня[^\n]*\| -67\.43% \|/);
  assert.match(status, /Просто тримати BTC[^\n]*\| -83\.43% \|/);
});

// ---------- (c) no lookahead ----------

test('(c) no lookahead: data truncated at any day K gives a byte-identical prefix', async () => {
  const full = tmpDir();
  const fullCsv = writeCsv(path.join(full, 'data.csv'), sliceBars());
  assert.equal((await run(['update', ...sliceArgs(full, fullCsv)])).code, 0);
  const a = fs.readFileSync(path.join(full, 'ledger.csv'), 'utf8');
  assert.equal(a.split('\n').length - 2, 61);

  // Every day of two full weeks as the cut-off, so that Saturdays, Sundays and Mondays are all covered.
  let n = 0;
  for (let K = '2020-02-17'; K <= '2020-03-01'; K = addDays(K, 1), n++) {
    const cut = tmpDir(), bent = tmpDir(), clock = tmpDir();
    const cutCsv = writeCsv(path.join(cut, 'data.csv'), sliceBars(K));
    // Same history up to K, completely different future (including the coming Sunday close).
    const bentCsv = writeCsv(path.join(bent, 'data.csv'), sliceBars().map((b) => (b.date > K ? { ...b, open: b.open * 3, close: b.close / 2 } : b)));
    assert.equal((await run(['update', ...sliceArgs(cut, cutCsv)])).code, 0);
    assert.equal((await run(['update', ...sliceArgs(bent, bentCsv)])).code, 0);
    assert.equal((await run(['update', ...sliceArgs(clock, fullCsv), '--now', addDays(K, 1) + 'T00:00:00Z'])).code, 0);
    const b = fs.readFileSync(path.join(cut, 'ledger.csv'), 'utf8');
    const c = fs.readFileSync(path.join(bent, 'ledger.csv'), 'utf8');
    const d = fs.readFileSync(path.join(clock, 'ledger.csv'), 'utf8');
    const rowsToK = (Date.parse(K) - Date.parse(SLICE_START)) / DAY_MS + 1;
    assert.ok(b.endsWith('\n') && b.split('\n').length - 2 === rowsToK, `${K}: truncated ledger has ${rowsToK} rows`);
    assert.ok(a.length > b.length && a.startsWith(b), `${K}: truncated file is a prefix of the full one`);
    assert.ok(c.startsWith(b), `${K}: a different future does not change the past`);
    assert.notEqual(a, c);
    assert.equal(d, b, `${K}: cutting by clock equals cutting the file`);
  }
  assert.equal(n, 14);
});

// ---------- (d) catch-up equals daily, idempotency ----------

test('(d) catch-up after a long pause equals running every day', async () => {
  const daily = tmpDir(), once = tmpDir(), sparse = tmpDir();
  const csv = writeCsv(path.join(daily, 'data.csv'), sliceBars());
  const nowAfter = (date) => addDays(date, 1) + 'T00:05:00Z';

  for (let d = SLICE_START; d <= SLICE_END; d = addDays(d, 1)) {
    const r = await run(['update', ...sliceArgs(daily, csv), '--now', nowAfter(d)]);
    assert.equal(r.code, 0, r.err);
  }
  assert.equal((await run(['update', ...sliceArgs(once, csv), '--now', nowAfter(SLICE_END)])).code, 0);
  // Pauses that end on a Saturday, a Sunday and a Monday, and around the trades.
  for (const d of ['2020-01-19', '2020-01-25', '2020-01-26', '2020-02-29', '2020-03-01', '2020-03-09', SLICE_END]) {
    assert.equal((await run(['update', ...sliceArgs(sparse, csv), '--now', nowAfter(d)])).code, 0);
  }
  const a = fs.readFileSync(path.join(daily, 'ledger.csv'), 'utf8');
  assert.equal(fs.readFileSync(path.join(once, 'ledger.csv'), 'utf8'), a);
  assert.equal(fs.readFileSync(path.join(sparse, 'ledger.csv'), 'utf8'), a);

  const rows = readLedger(path.join(daily, 'ledger.csv'));
  assert.equal(rows.length, 61);
  assert.deepEqual(rows.filter((r) => r.trade).map((r) => `${r.date} ${r.trade}`), SLICE_TRADES);
  // The run log (not hashed) has one line per run.
  assert.equal(fs.readFileSync(path.join(daily, 'run_log.csv'), 'utf8').trim().split('\n').length, 62);
});

test('idempotent: a second update appends nothing', () => {
  const dir = tmpDir();
  const csv = writeCsv(path.join(dir, 'data.csv'), sliceBars());
  const first = runCli(['update', ...sliceArgs(dir, csv)]);
  assert.equal(first.code, 0, first.err);
  const before = fs.readFileSync(path.join(dir, 'ledger.csv'), 'utf8');
  const second = runCli(['update', ...sliceArgs(dir, csv)]);
  assert.equal(second.code, 0, second.err);
  assert.match(second.out, /нічого не додано/);
  assert.equal(fs.readFileSync(path.join(dir, 'ledger.csv'), 'utf8'), before);
  // Same inputs in another folder and at another time give the same bytes: no timestamps are hashed.
  const other = tmpDir();
  assert.equal(runCli(['update', ...sliceArgs(other, csv)]).code, 0);
  assert.equal(fs.readFileSync(path.join(other, 'ledger.csv'), 'utf8'), before);
});

// ---------- tamper detection ----------

test('tampering with any earlier cell makes update and verify fail', async () => {
  const dir = tmpDir();
  const ledgerFile = path.join(dir, 'ledger.csv');
  const csvShort = writeCsv(path.join(dir, 'short.csv'), sliceBars('2020-03-10'));
  const csvFull = writeCsv(path.join(dir, 'data.csv'), sliceBars());
  assert.equal((await run(['update', ...sliceArgs(dir, csvShort)])).code, 0);
  const good = fs.readFileSync(ledgerFile, 'utf8');
  const lines = good.trimEnd().split('\n');
  const TARGET = 7; // file line of the 2020-01-26 row (a SELL day, and a Sunday), far from the end

  const mustFail = async (text, what) => {
    fs.writeFileSync(ledgerFile, text);
    for (const cmd of ['update', 'verify']) {
      const r = await run([cmd, ...sliceArgs(dir, csvFull)]);
      assert.equal(r.code, 1, `${cmd} must fail: ${what}`);
      assert.match(r.err, /ПОМИЛКА \[E_(CHAIN|MISMATCH)\]/, what);
      assert.doesNotMatch(r.out, /OK/);
    }
    assert.equal(fs.readFileSync(ledgerFile, 'utf8'), text, `nothing appended: ${what}`);
  };

  const cells = lines[TARGET].split(',');
  assert.equal(cells[COL.date], '2020-01-26');
  assert.equal(cells[COL.trade], 'SELL');
  assert.equal(cells[COL.week_end], '2020-01-26');
  for (let col = 0; col < tool.COLUMNS.length; col++) {
    const c = cells.slice();
    if (c[col] === '') c[col] = 'BUY';
    else if (c[col] === 'SELL') c[col] = '';
    else if (/\d$/.test(c[col])) c[col] = c[col].slice(0, -1) + ((Number(c[col].slice(-1)) + 1) % 10);
    else c[col] = c[col].slice(0, -1) + (c[col].endsWith('a') ? 'b' : 'a');
    assert.notEqual(c[col], cells[col]);
    const edited = lines.slice();
    edited[TARGET] = c.join(',');
    await mustFail(edited.join('\n') + '\n', `column ${tool.COLUMNS[col]}`);
  }
  await mustFail(lines.filter((_, i) => i !== 10).join('\n') + '\n', 'a deleted row');
  await mustFail(lines.slice(0, 1).concat(lines.slice(2)).join('\n') + '\n', 'a deleted first row');
  await mustFail(['x' + lines[0], ...lines.slice(1)].join('\n') + '\n', 'an edited header');
  await mustFail(good.replace(/\n/g, '\r\n'), 'changed line endings');
  await mustFail(good.slice(0, -5), 'a cut last line');

  // A careful forger who also recomputes every hash is caught by the arithmetic check.
  for (const [col, value, name] of [[COL.equity, (c) => (Number(c) + 500).toFixed(6), 'equity'], [COL.week_end, () => '2020-02-09', 'week_end'],
    [COL.equity_200d_only, (c) => (Number(c) + 500).toFixed(6), 'equity_200d_only']]) {
    fs.writeFileSync(ledgerFile, good);
    rechain(ledgerFile, (c, i) => { if (i === 30) c[col] = value(c[col]); });
    for (const cmd of ['update', 'verify']) {
      const r = await run([cmd, ...sliceArgs(dir, csvFull)]);
      assert.equal(r.code, 1);
      assert.match(r.err, new RegExp(`ПОМИЛКА \\[E_MISMATCH\\].*стовпчик ${name}:`));
    }
  }

  // The untouched ledger still works.
  fs.writeFileSync(ledgerFile, good);
  assert.equal((await run(['verify', ...sliceArgs(dir, csvFull)])).code, 0);
  assert.equal((await run(['update', ...sliceArgs(dir, csvFull)])).code, 0);
  assert.ok(fs.readFileSync(ledgerFile, 'utf8').startsWith(good));
});

// ---------- rule hash mismatch ----------

test('a ledger kept under a different rule is refused', async () => {
  const dir = tmpDir();
  const ledgerFile = path.join(dir, 'ledger.csv');
  const csvShort = writeCsv(path.join(dir, 'short.csv'), sliceBars('2020-03-10'));
  const csvFull = writeCsv(path.join(dir, 'data.csv'), sliceBars());
  assert.equal((await run(['update', ...sliceArgs(dir, csvShort)])).code, 0);
  const good = fs.readFileSync(ledgerFile, 'utf8');

  // (a) the current rule differs from the one saved in frozen_rule.json (here: another start date)
  for (const cmd of ['update', 'verify']) {
    const r = await run([cmd, '--data', csvFull, '--ledger', ledgerFile, '--start', '2020-01-21']);
    assert.equal(r.code, 1);
    assert.match(r.err, /ПОМИЛКА \[E_RULE\]/);
  }
  // (b) same, but the saved rule file is gone: the hash inside the ledger rows still gives it away
  fs.rmSync(path.join(dir, 'frozen_rule.json'));
  for (const cmd of ['update', 'verify']) {
    const r = await run([cmd, '--data', csvFull, '--ledger', ledgerFile, '--start', '2020-01-21']);
    assert.equal(r.code, 1);
    assert.match(r.err, /ПОМИЛКА \[E_RULE\]/);
  }
  // (c) a ledger with a valid chain but another rule hash in every row
  assert.equal((await run(['update', ...sliceArgs(dir, csvShort)])).code, 0); // restores frozen_rule.json
  rechain(ledgerFile, (c) => { c[COL.rule_sha256] = tool.sha256('some other rule'); });
  const forged = fs.readFileSync(ledgerFile, 'utf8');
  for (const cmd of ['update', 'verify']) {
    const r = await run([cmd, ...sliceArgs(dir, csvFull)]);
    assert.equal(r.code, 1);
    assert.match(r.err, /ПОМИЛКА \[E_RULE\]/);
  }
  assert.equal(fs.readFileSync(ledgerFile, 'utf8'), forged, 'nothing appended');
  assert.notEqual(forged, good);

  // (d) a folder that holds the frozen rule of another ledger (for example the main paper folder):
  // this program writes nothing there.
  const foreign = tmpDir();
  const foreignRule = '{"name":"BTC daily regime","start_date":"2026-11-26","version":1}';
  fs.writeFileSync(path.join(foreign, 'frozen_rule.json'), foreignRule);
  fs.writeFileSync(path.join(foreign, 'STATUS_UA.md'), 'OTHER LEDGER STATUS\n');
  for (const args of [['update', ...sliceArgs(foreign, csvFull)], ['verify', ...sliceArgs(foreign, csvFull)], ['status', '--ledger', path.join(foreign, 'ledger.csv')]]) {
    const r = await run(args);
    assert.equal(r.code, 1, args[0]);
    assert.match(r.err, /ПОМИЛКА \[E_RULE\]/);
  }
  assert.deepEqual(fs.readdirSync(foreign).sort(), ['STATUS_UA.md', 'frozen_rule.json']);
  assert.equal(fs.readFileSync(path.join(foreign, 'frozen_rule.json'), 'utf8'), foreignRule);
  assert.equal(fs.readFileSync(path.join(foreign, 'STATUS_UA.md'), 'utf8'), 'OTHER LEDGER STATUS\n');
});

// ---------- data revision ----------

test('revised history is reported and never rewritten', async () => {
  const dir = tmpDir();
  const ledgerFile = path.join(dir, 'ledger.csv');
  const csvShort = writeCsv(path.join(dir, 'short.csv'), sliceBars('2020-03-10'));
  assert.equal((await run(['update', ...sliceArgs(dir, csvShort)])).code, 0);
  const good = fs.readFileSync(ledgerFile, 'utf8');
  const revised = (date, field, factor) => writeCsv(path.join(dir, 'rev.csv'),
    sliceBars().map((b) => (b.date === date ? { ...b, [field]: Math.round(b[field] * factor * 100) / 100 } : b)));

  assert.equal(weekday('2019-12-01'), 0);
  assert.equal(weekday('2019-12-03'), 2);
  for (const [date, field, factor, shown, column] of [['2020-02-10', 'close', 1.001, '2020-02-10', 'close'], ['2020-02-11', 'open', 0.999, '2020-02-11', 'open'],
    // a big change before the start: a Sunday close shifts the recorded 20-week average,
    ['2019-12-01', 'close', 1.5, SLICE_START, 'sma20w'],
    // and a weekday close shifts only the recorded 200-day average
    ['2019-12-03', 'close', 1.5, SLICE_START, 'sma200']]) {
    const csv = revised(date, field, factor);
    for (const cmd of ['update', 'verify']) {
      const r = await run([cmd, ...sliceArgs(dir, csv)]);
      assert.equal(r.code, 1, `${cmd} ${date}`);
      assert.match(r.err, /ПОМИЛКА \[E_REVISION\]: Перегляд даних/);
      assert.ok(r.err.includes(`Перегляд даних за ${shown}: у журналі ${column} = `), r.err);
    }
    assert.equal(fs.readFileSync(ledgerFile, 'utf8'), good, 'old rows untouched, nothing appended');
  }

  // A change inside the 0.05% tolerance is noted, old rows stay as they were, new days are appended.
  const csv = revised('2020-02-10', 'close', 1.0002);
  const ver = await run(['verify', ...sliceArgs(dir, csv)]);
  assert.equal(ver.code, 3, ver.err); // not a failure of the ledger, but not a clean OK either
  assert.equal(ver.err, '');
  assert.doesNotMatch(ver.out, /^OK/m);
  assert.match(ver.out, /Зауваження/);
  assert.match(ver.out, /2020-02-10: close у журналі/);
  const upd = await run(['update', ...sliceArgs(dir, csv)]);
  assert.equal(upd.code, 0, upd.err);
  const after = fs.readFileSync(ledgerFile, 'utf8');
  assert.ok(after.startsWith(good) && after.length > good.length);
});

// ---------- unclosed bar ----------

test('the unclosed last bar is ignored, also when it is a Sunday', async () => {
  const dir = tmpDir();
  const ledgerFile = path.join(dir, 'ledger.csv');
  // The last listed bar (2020-03-20) is still open and holds nonsense values.
  const csv = writeCsv(path.join(dir, 'data.csv'), sliceBars().map((b) => (b.date === SLICE_END ? { ...b, close: 1 } : b)));
  for (const now of ['2020-03-20T00:00:00Z', '2020-03-20T17:54:00Z', '2020-03-20T23:59:59Z']) {
    const r = await run(['update', ...sliceArgs(dir, csv), '--now', now]);
    assert.equal(r.code, 0, r.err);
    const rows = readLedger(ledgerFile);
    assert.equal(rows[rows.length - 1].date, '2020-03-19', now);
  }
  // One second later the bar is closed and gets recorded.
  assert.equal((await run(['update', ...sliceArgs(dir, csv), '--now', '2020-03-21T00:00:00Z'])).code, 0);
  const rows = readLedger(ledgerFile);
  assert.equal(rows[rows.length - 1].date, SLICE_END);
  assert.equal(rows[rows.length - 1].close, '1.00');

  // A Sunday bar that is still open is not a weekly close yet: Saturday's row keeps the previous week.
  const sun = tmpDir();
  const sunCsv = writeCsv(path.join(sun, 'data.csv'), sliceBars('2020-03-15').map((b) => (b.date === '2020-03-15' ? { ...b, close: 999999 } : b)));
  assert.equal(weekday('2020-03-15'), 0);
  assert.equal((await run(['update', ...sliceArgs(sun, sunCsv), '--now', '2020-03-15T23:59:59Z'])).code, 0);
  const sat = readLedger(path.join(sun, 'ledger.csv'));
  assert.equal(sat[sat.length - 1].date, '2020-03-14');
  assert.equal(sat[sat.length - 1].week_end, '2020-03-08');
  assert.equal(sat[sat.length - 1].sma20w, '8445.606500');

  // Before the first day closes: header-only ledger and a "waiting" status.
  const early = tmpDir();
  const r = await run(['update', ...sliceArgs(early, csv), '--now', '2020-01-20T18:30:00Z']);
  assert.equal(r.code, 0, r.err);
  assert.equal(fs.readFileSync(path.join(early, 'ledger.csv'), 'utf8'), tool.HEADER + '\n');
  assert.match(fs.readFileSync(path.join(early, 'STATUS_UA.md'), 'utf8'), /Записів ще немає[\s\S]*2020-01-21 00:00 UTC/);
  assert.match(r.out, /Довідково \(у журнал не записано\): за закритим днем 2020-01-19/);
  const ver = await run(['verify', ...sliceArgs(early, csv), '--now', '2020-01-20T18:30:00Z']);
  assert.equal(ver.code, 0);
  assert.match(ver.out, /^OK\./);
});

// ---------- gaps, duplicates, short history ----------

test('a missing or duplicated day stops the tool', async () => {
  assert.equal(weekday('2019-12-01'), 0);
  const cases = [
    ['E_GAP', 'gap before the start', sliceBars().filter((b) => b.date !== '2019-10-15'), '2019-10-15'],
    ['E_GAP', 'a missing Sunday before the start', sliceBars().filter((b) => b.date !== '2019-12-01'), '2019-12-01'],
    ['E_GAP', 'gap after the start', sliceBars().filter((b) => b.date !== '2020-02-15'), '2020-02-15'],
    ['E_DUPLICATE', 'duplicate before the start', sliceBars().flatMap((b) => (b.date === '2019-10-15' ? [b, b] : [b])), '2019-10-15'],
    ['E_DUPLICATE', 'duplicate after the start', sliceBars().flatMap((b) => (b.date === '2020-02-15' ? [b, { ...b, close: b.close + 1 }] : [b])), '2020-02-15'],
    ['E_HISTORY', 'fewer than 200 closed bars', sliceBars().filter((b) => b.date >= '2019-07-06'), ''],
  ];
  for (const [code, what, bars, date] of cases) {
    const dir = tmpDir();
    const csv = writeCsv(path.join(dir, 'data.csv'), bars);
    for (const cmd of ['update', 'verify']) {
      const r = await run([cmd, ...sliceArgs(dir, csv)]);
      assert.equal(r.code, 1, what);
      assert.ok(r.err.includes(`ПОМИЛКА [${code}]`) && r.err.includes(date), `${what}: ${r.err}`);
    }
    assert.ok(!fs.existsSync(path.join(dir, 'ledger.csv')), `${what}: no ledger written`);
  }
  // Exactly 200 closed bars up to the start day is enough.
  const dir = tmpDir();
  const csv = writeCsv(path.join(dir, 'data.csv'), sliceBars().filter((b) => b.date >= '2019-07-05'));
  assert.equal((await run(['update', ...sliceArgs(dir, csv)])).code, 0);
  assert.equal(readLedger(path.join(dir, 'ledger.csv')).length, 61);

  // A gap appearing later does not let the tool append to an existing ledger either.
  const dir2 = tmpDir();
  const short = writeCsv(path.join(dir2, 'short.csv'), sliceBars('2020-03-01'));
  assert.equal((await run(['update', ...sliceArgs(dir2, short)])).code, 0);
  const before = fs.readFileSync(path.join(dir2, 'ledger.csv'), 'utf8');
  const holed = writeCsv(path.join(dir2, 'data.csv'), sliceBars().filter((b) => b.date !== '2020-03-05'));
  const r = await run(['update', ...sliceArgs(dir2, holed)]);
  assert.equal(r.code, 1);
  assert.match(r.err, /ПОМИЛКА \[E_GAP\].*2020-03-05/);
  assert.equal(fs.readFileSync(path.join(dir2, 'ledger.csv'), 'utf8'), before);
});

// ---------- hand-computed accounting ----------

const flat199 = new Array(199).fill(100);

test('entry, continuing, exit and flat days on a hand-computed series', async () => {
  const dir = tmpDir();
  // 2020-01-01 is a Wednesday; 2020-01-05 is the first Sunday of the paper days.
  const args = synthetic(dir, flat199, [[100, 100], [100, 120], [125, 150], [150, 165], [160, 90], [80, 85], [85, 85]]);
  const r = await run(['update', ...args]);
  assert.equal(r.code, 0, r.err);
  const rows = readLedger(path.join(dir, 'ledger.csv'));
  const pick = (row) => [row.date, row.sma20w, row.week_end, row.sma200, row.above_sma20w, row.pos_held, row.trade, row.cost_usd, row.target_next,
    row.equity, row.equity_200d_only, row.pos_200d_only, row.equity_hold].join(' ');
  // All numbers below are worked out by hand from the specification.
  assert.deepEqual(rows.map(pick), [
    // day 1 (Wed): close 100 is not above the 20-week average 100 -> stay in cash
    '2020-01-01 100.000000 2019-12-29 100.000000 0 0  0.000000 0 10000.000000 10000.000000 0 10000.000000',
    // day 2: still cash; 120 > 100 -> decide to buy. 200D = (199*100+120)/200 = 100.1. Hold enters: 10000*0.9985*120/100
    '2020-01-02 100.000000 2019-12-29 100.100000 1 0  0.000000 1 10000.000000 10000.000000 0 11982.000000',
    // day 3 (entry): cost 15, then 9985*150/125 = 11982. "200D only" enters the same day. Hold: 11982*150/120
    '2020-01-03 100.000000 2019-12-29 100.350000 1 1 BUY 15.000000 1 11982.000000 11982.000000 1 14977.500000',
    // day 4 (Sat, continuing): 11982*165/150 = 13180.2. Hold: 14977.5*165/150
    '2020-01-04 100.000000 2019-12-29 100.675000 1 1  0.000000 1 13180.200000 13180.200000 1 16475.250000',
    // day 5 (Sun, continuing, close to close, the open 160 does not matter): 13180.2*90/165 = 7189.2.
    // The week closes at 90: 20-week average = (19*100+90)/20 = 99.5, and 90 is not above it -> decide to sell
    '2020-01-05 99.500000 2020-01-05 100.625000 0 1  0.000000 0 7189.200000 7189.200000 1 8986.500000',
    // day 6 (exit at open 80): 7189.2*80/90 = 6390.4, cost 9.5856, left 6380.8144. Hold: 8986.5*85/90
    '2020-01-06 99.500000 2020-01-05 100.550000 0 0 SELL 9.585600 0 6380.814400 6380.814400 0 8487.250000',
    // day 7 (flat): unchanged
    '2020-01-07 99.500000 2020-01-05 100.475000 0 0  0.000000 0 6380.814400 6380.814400 0 8487.250000',
  ]);
  assert.equal(rows[0].prev_row_sha256, 'GENESIS');
  assert.equal(rows[0].data_source, tool.SOURCE_TEST);
  rows.forEach((row, i) => {
    const cells = tool.COLUMNS.map((c) => row[c]);
    assert.equal(row.row_sha256, tool.sha256(row.prev_row_sha256 + '|' + cells.slice(0, N_HASHED).join(',')));
    if (i) assert.equal(row.prev_row_sha256, rows[i - 1].row_sha256);
  });
  assert.equal((await run(['verify', ...args])).code, 0);
  const status = fs.readFileSync(path.join(dir, 'STATUS_UA.md'), 'utf8');
  assert.match(status, /тримали різне: 0 із 7/);
});

test('the rule and "200D only" are separate accounts: one buys while the other waits', async () => {
  const dir = tmpDir();
  // 199 days before Wednesday 2020-01-01: Sundays close at 1000, all other days at 100.
  // So the 20-week average is 1000 while the 200-day average is far lower.
  const pre = [];
  for (let i = 0; i < 199; i++) pre.push(weekday(addDays('2020-01-01', i - 199)) === 0 ? 1000 : 100);
  assert.equal(pre.filter((p) => p === 1000).length, 29);
  assert.equal(pre[0], 1000); // 2019-06-16, a Sunday, is the oldest of the 199 days
  const args = synthetic(dir, pre, [[100, 300], [300, 330], [330, 1100], [1100, 1100]]);
  assert.equal((await run(['update', ...args])).code, 0);
  const rows = readLedger(path.join(dir, 'ledger.csv'));
  const pick = (row) => [row.sma20w, row.sma200, row.above_sma20w, row.pos_held, row.trade, row.equity, row.equity_200d_only, row.pos_200d_only].join(' ');
  assert.deepEqual(rows.map(pick), [
    // 200D = (29*1000 + 170*100 + 300)/200 = 231.5: 300 is above it, but not above the 20-week average 1000
    '1000.000000 231.500000 0 0  10000.000000 10000.000000 0',
    // "200D only" enters at the open 300: 9985*330/300. 200D = (46300 - 1000 + 330)/200 (the oldest day, a Sunday, drops out)
    '1000.000000 228.150000 0 0  10000.000000 10983.500000 1',
    // 1100 is above 1000 -> the rule decides to buy. "200D only": 10983.5*1100/330. 200D = (45630 - 100 + 1100)/200
    '1000.000000 233.150000 1 0  10000.000000 36611.666667 1',
    // the rule enters at the open 1100: 10000 - 15 = 9985, then 1100/1100. 200D = (46630 - 100 + 1100)/200
    '1000.000000 238.150000 1 1 BUY 9985.000000 36611.666667 1',
  ]);
  const status = fs.readFileSync(path.join(dir, 'STATUS_UA.md'), 'utf8');
  assert.match(status, /BTC вище неї: 1 100\.00 проти 1 000\.00/);
  assert.match(status, /тримає: BTC/);
  assert.match(status, /Днів, коли «BTC DA» і «лише 200-денна середня» тримали різне: 2 із 4\./);
  assert.match(status, /\| Правило «BTC DA» \(вище 20-тижневої середньої\) \| 9 985\.00 \| -15\.00 \| -0\.15% \| -0\.15% \|/);
  assert.match(status, /\| Лише 200-денна середня \(з нею порівнюємо\) \| 36 611\.67 \| \+26 611\.67 \| \+266\.12% \| 0\.00% \|/);
  assert.equal(tool.differingDays(fs.readFileSync(path.join(dir, 'ledger.csv'), 'utf8').trimEnd().split('\n').slice(1).map(tool.parseRow)), 2);
});

// ---------- status and safety switches ----------

test('status: plain text, warnings, no fetching', async () => {
  const dir = tmpDir();
  const csv = writeCsv(path.join(dir, 'data.csv'), sliceBars());
  const ledger = path.join(dir, 'ledger.csv');

  // No ledger yet.
  const none = await run(['status', '--ledger', ledger, '--start', SLICE_START, '--now', '2020-01-20T12:00:00Z']);
  assert.equal(none.code, 0);
  assert.match(none.out, /Журналу ще немає/);
  assert.match(none.out, /Перший запис з’явиться після того, як закриється перший повний день: 2020-01-21 00:00 UTC/);

  assert.equal((await run(['update', ...sliceArgs(dir, csv), '--now', '2020-03-01T08:00:00Z'])).code, 0);
  const fresh = await run(['status', '--ledger', ledger, '--start', SLICE_START, '--now', '2020-03-01T09:00:00Z']);
  assert.equal(fresh.code, 0, fresh.err);
  assert.match(fresh.out, /Останній закритий день у журналі: 2020-02-29\. Ціна закриття: 8 527\.74 USD/);
  assert.match(fresh.out, /Середня за 20 тижнів \(за тижнями до неділі 2020-02-23 включно\): 8 443\.41 USD\. BTC вище неї: 8 527\.74 проти 8 443\.41\./);
  assert.match(fresh.out, /середня за 200 днів: 8 748\.89 USD\. BTC нижче неї\./);
  assert.match(fresh.out, /Зараз паперовий рахунок тримає: BTC\./);
  assert.match(fresh.out, /Днів від старту \(2020-01-20\): 41/);
  assert.match(fresh.out, /Угод за правилом: 3 \(купівель 2, продажів 1\)\. Завершених угод «купив і продав»: 1\./);
  assert.match(fresh.out, /тримали різне: \d+ із 41\./);
  assert.match(fresh.out, /Ще зарано для висновків/);
  assert.match(fresh.out, /Останній запуск оновлення: 2020-03-01 08:00 UTC/);
  assert.doesNotMatch(fresh.out, /Дані застаріли/);
  assert.match(fresh.out, /Правило «BTC DA»/);
  assert.match(fresh.out, /Лише 200-денна середня \(з нею порівнюємо\)/);
  assert.match(fresh.out, /Просто тримати BTC \(довідка\)/);
  assert.match(fresh.out, /вибрано заднім числом/);
  assert.match(fresh.out, /не є підставою торгувати справжніми грошима/);
  // The count of differing days is the count in the ledger.
  const differ = readLedger(ledger).filter((r) => r.pos_held !== r.pos_200d_only).length;
  assert.ok(differ > 0);
  assert.ok(fresh.out.includes(`тримали різне: ${differ} із 41.`));

  // Two days after the last record is still fine; three days is stale.
  assert.doesNotMatch((await run(['status', '--ledger', ledger, '--start', SLICE_START, '--now', '2020-03-02T23:00:00Z'])).out, /Дані застаріли/);
  assert.match((await run(['status', '--ledger', ledger, '--start', SLICE_START, '--now', '2020-03-03T01:00:00Z'])).out, /Дані застаріли/);

  // Status also refuses a damaged ledger.
  fs.appendFileSync(ledger, 'junk\n');
  const bad = await run(['status', '--ledger', ledger, '--start', SLICE_START]);
  assert.equal(bad.code, 1);
  assert.match(bad.err, /ПОМИЛКА \[E_CHAIN\]/);
});

test('the real ledger cannot be produced from test inputs', async () => {
  const dir = tmpDir();
  const csv = writeCsv(path.join(dir, 'data.csv'), sliceBars());
  const real = tool.DEFAULT_LEDGER;
  assert.equal(path.dirname(real), __dirname);
  const snapshot = () => (fs.existsSync(real) ? fs.readFileSync(real, 'utf8') : null);
  const before = snapshot();
  const attempts = [
    ['update', '--data', csv],
    ['update', '--start', '2020-01-20'],
    ['update', '--now', '2030-01-01T00:00:00Z'],
    ['update', '--data', csv, '--start', '2020-01-20', '--ledger', real],
    ['verify', '--data', csv, '--ledger', path.join(path.dirname(real), '.', 'LEDGER.CSV'.toLowerCase())],
    ['update', '--data', csv, '--ledger', path.join(path.dirname(real), 'sub', '..', 'ledger.csv')],
  ];
  for (const args of attempts) {
    const r = await run(args);
    assert.equal(r.code, 1, args.join(' '));
    assert.match(r.err, /ПОМИЛКА \[E_REFUSED\]/);
  }
  const cli = runCli(['update', '--data', csv]);
  assert.equal(cli.code, 1);
  assert.match(cli.err, /E_REFUSED/);
  assert.equal(snapshot(), before, 'real ledger untouched');

  const unknown = await run(['update', '--force']);
  assert.equal(unknown.code, 1);
  assert.equal((await run(['delete'])).code, 1);
  assert.equal(snapshot(), before);
});

// =====================================================================================
// The protections added to the main tool after its review, adapted. Offline, temp directory only.
// =====================================================================================

const REAL_DIR = __dirname;
const README = path.join(REAL_DIR, 'README_UA.md');
const PREREG = path.join(REAL_DIR, '..', 'PREREGISTRATION_PAPER_DA.md');
const LAUNCHER = path.join(REAL_DIR, 'update.cmd');
const ledgerLines = (file) => fs.readFileSync(file, 'utf8').trimEnd().split('\n');

// A fake Bitstamp. `bars` are {date, open, high, low, close}; `dateHeader` is the HTTP Date
// header (null = absent); `mutate` may damage the JSON list. Honours `end` and the 1000 limit.
async function withBitstamp(bars, dateHeader, fn, mutate) {
  const saved = global.fetch;
  const calls = [];
  global.fetch = async (url, init) => {
    calls.push(url);
    assert.ok(String(url).startsWith('https://www.bitstamp.net/api/v2/ohlc/btcusd/?step=86400&limit=1000'), `unexpected URL ${url}`);
    assert.equal(init.headers['User-Agent'], 'csi-paper/1.0');
    const end = /[?&]end=(\d+)/.exec(url);
    let list = bars.map((b) => ({ timestamp: String(Date.parse(b.date + 'T00:00:00Z') / 1000), open: String(b.open), high: String(b.high), low: String(b.low), close: String(b.close), volume: '1.5' }));
    if (end) list = list.filter((r) => Number(r.timestamp) <= Number(end[1]));
    list = list.slice(-1000);
    if (mutate) list = mutate(list);
    return { ok: true, status: 200, headers: { get: (h) => (h.toLowerCase() === 'date' ? dateHeader : null) }, json: async () => ({ data: { ohlc: list } }) };
  };
  try { return await fn(calls); } finally { global.fetch = saved; }
}
// Real history used by the fake exchange: the bar of 2026-06-01 is "still open" at LIVE_DATE.
const LIVE_START = '2026-05-28';
const LIVE_DATE = 'Mon, 01 Jun 2026 10:00:00 GMT';
const liveBars = (to = '2026-06-01') => exportBars().filter((b) => b.date >= '2024-01-01' && b.date <= to);
const liveArgs = (dir, now = '2026-06-01T10:00:05Z') => ['--ledger', path.join(dir, 'ledger.csv'), '--start', LIVE_START, '--now', now];

// The export ends on 2026-11-26; the frozen start date is 2026-11-27. One more (made-up) bar lets
// an offline file reach the frozen start date.
const FROZEN_START = '2026-11-27';
function barsToFrozenStart(factor = 1) {
  const bars = exportBars();
  const last = bars[bars.length - 1];
  assert.equal(last.date, '2026-11-26');
  return bars.concat([{ date: FROZEN_START, open: last.close * factor, close: last.close * factor }]);
}

// A stand-in for the real folder: a temp copy of the program with an empty real ledger.
function toolCopy() {
  const dir = tmpDir();
  fs.copyFileSync(SCRIPT, path.join(dir, 'paper_da.js'));
  fs.writeFileSync(path.join(dir, 'ledger.csv'), tool.HEADER + '\n');
  fs.writeFileSync(path.join(dir, 'frozen_rule.json'), tool.makeRule().json);
  fs.writeFileSync(path.join(dir, 'STATUS_UA.md'), 'REAL STATUS\n');
  fs.writeFileSync(path.join(dir, 'run_log.csv'), tool.RUN_LOG_HEADER + '\n');
  return dir;
}
const snapshotDir = (dir) => Object.fromEntries(fs.readdirSync(dir).sort().map((f) => [f, fs.readFileSync(path.join(dir, f), 'utf8')]));
const runCopy = (dir, args) => {
  const r = spawnSync(process.execPath, [path.join(dir, 'paper_da.js'), ...args], { encoding: 'utf8' });
  return { code: r.status, out: r.stdout, err: r.stderr };
};
const REAL_FILES = ['ledger.csv', 'run_log.csv', 'STATUS_UA.md', 'frozen_rule.json'];
const readReal = () => REAL_FILES.map((f) => (fs.existsSync(path.join(REAL_DIR, f)) ? fs.readFileSync(path.join(REAL_DIR, f), 'utf8') : null));

// ---------- test options can never write into the folder of the program ----------

test('test options cannot write anything into the folder of the program', async () => {
  const real = toolCopy();
  const outside = tmpDir();
  const csv = writeCsv(path.join(outside, 'doctored.csv'), barsToFrozenStart(3));
  const before = snapshotDir(real);
  const inside = (name) => path.join(real, name);

  const attempts = [
    ['update', '--ledger', inside('scratch.csv'), '--data', csv],
    ['update', '--ledger', inside('x.csv'), '--data', csv, '--start', '2025-06-01'],
    ['verify', '--ledger', inside('scratch.csv'), '--data', csv],
    ['status', '--ledger', inside('scratch.csv'), '--now', '2030-01-01T00:00:00Z'],
    ['update', '--ledger', inside('ledger.csv.'), '--data', csv],
    ['update', '--ledger', inside('ledger.csv '), '--data', csv],
    ['update', '--ledger', inside('LEDGER.CSV'), '--data', csv],
    // Even without test options a second ledger next to the real one would overwrite its side files.
    ['update', '--ledger', inside('other.csv')],
    ['status', '--ledger', inside('other.csv')],
  ];
  // The same folder under another name: a directory link.
  const alias = path.join(outside, 'alias');
  let linked = true;
  try { fs.symlinkSync(real, alias, 'junction'); } catch { linked = false; }
  if (linked) {
    attempts.push(['update', '--ledger', path.join(alias, 'ledger.csv'), '--data', csv]);
    attempts.push(['update', '--ledger', path.join(alias, 'scratch.csv'), '--data', csv]);
  }
  if (process.platform === 'win32') {
    // Network and device spellings of a local path.
    const share = (host) => `\\\\${host}\\` + inside('ledger.csv').replace(/^([A-Za-z]):/, '$1$');
    attempts.push(['update', '--ledger', share('localhost'), '--data', csv]);
    attempts.push(['update', '--ledger', share('127.0.0.1'), '--data', csv]);
    attempts.push(['update', '--ledger', '\\\\?\\' + inside('ledger.csv'), '--data', csv]);
    attempts.push(['update', '--ledger', share('localhost').replace('ledger.csv', 'scratch.csv'), '--data', csv]);
  }
  for (const args of attempts) {
    const r = runCopy(real, args);
    assert.equal(r.code, 1, args.join(' ') + '\n' + r.out + r.err);
    assert.match(r.err, /ПОМИЛКА \[E_REFUSED\]/, args.join(' '));
    assert.deepEqual(snapshotDir(real), before, `folder untouched: ${args.join(' ')}`);
  }
  if (linked) fs.rmSync(alias, { recursive: false, force: true });

  // The program run from elsewhere also recognises a folder that holds a copy of itself. It
  // writes nothing there, and it does not quietly work on its own ledger instead of the named one.
  const ownBefore = readReal();
  for (const args of [['update', '--ledger', inside('scratch.csv'), '--data', csv], ['update', '--ledger', inside('ledger.csv'), '--data', csv],
    ['update', '--ledger', inside('ledger.csv')], ['verify', '--ledger', inside('ledger.csv')], ['status', '--ledger', inside('ledger.csv')]]) {
    const r = await run(args);
    assert.equal(r.code, 1, args.join(' ') + r.out);
    assert.match(r.err, /ПОМИЛКА \[E_REFUSED\].*копія цієї програми/);
    assert.equal(r.out, '');
    assert.deepEqual(snapshotDir(real), before);
  }
  assert.deepEqual(readReal(), ownBefore, 'the folder of the running program is untouched as well');

  // A real ledger that somehow got a row made from a test file is refused by every command.
  const lab = tmpDir();
  assert.equal((await run(['update', '--ledger', path.join(lab, 'ledger.csv'), '--data', csv])).code, 0);
  const planted = fs.readFileSync(path.join(lab, 'ledger.csv'), 'utf8');
  assert.equal(planted.trimEnd().split('\n').length, 2, 'one row built with the frozen start date');
  assert.ok(planted.includes(`1,${FROZEN_START},`));
  assert.ok(planted.includes(tool.SOURCE_TEST));
  assert.ok(planted.includes(',181359.33,'), 'the planted row carries the tripled price');
  fs.writeFileSync(inside('ledger.csv'), planted);
  for (const cmd of ['status', 'update', 'verify']) {
    const st = runCopy(real, [cmd]);
    assert.equal(st.code, 1, cmd + st.out);
    assert.match(st.err, /ПОМИЛКА \[E_SOURCE\]/);
    assert.doesNotMatch(st.out, /181/);
  }
});

test('a status made with test options says so in its first line', async () => {
  const dir = tmpDir();
  const csv = writeCsv(path.join(dir, 'data.csv'), sliceBars());
  assert.equal((await run(['update', ...sliceArgs(dir, csv)])).code, 0);
  assert.match(fs.readFileSync(path.join(dir, 'STATUS_UA.md'), 'utf8'), /^\*\*ТЕСТОВИЙ ПРОГІН\. Це не справжній паперовий рахунок\.\*\*/);
  const st = await run(['status', '--ledger', path.join(dir, 'ledger.csv'), '--start', SLICE_START]);
  assert.equal(st.code, 0, st.err);
  assert.match(st.out, /^\*\*ТЕСТОВИЙ ПРОГІН/);
  assert.match(st.out, /не звертається до біржі/);
  // Also with the frozen start date, when the rows come from a file.
  const lab = tmpDir();
  const csv2 = writeCsv(path.join(lab, 'data.csv'), barsToFrozenStart());
  assert.equal((await run(['update', '--ledger', path.join(lab, 'ledger.csv'), '--data', csv2])).code, 0);
  assert.match(fs.readFileSync(path.join(lab, 'STATUS_UA.md'), 'utf8'), /^\*\*ТЕСТОВИЙ ПРОГІН/);
  // The real status (no test options, live source) has no such line.
  const real = fs.readFileSync(path.join(REAL_DIR, 'STATUS_UA.md'), 'utf8');
  assert.doesNotMatch(real, /ТЕСТОВИЙ/);
});

// ---------- differences inside the 0.05% tolerance ----------

test('a price difference inside the tolerance that flips a decision is a data revision', async () => {
  const dir = tmpDir();
  // Day 1: close 100.03 against a 20-week average of 100 -> "hold BTC".
  const honest = synthetic(dir, flat199, [[100, 100.03], [100.03, 110], [110, 112]]);
  assert.equal((await run(['update', ...honest])).code, 0);
  const ledgerFile = path.join(dir, 'ledger.csv');
  const good = fs.readFileSync(ledgerFile, 'utf8');
  assert.deepEqual(readLedger(ledgerFile).map((r) => r.above_sma20w + r.trade), ['1', '1BUY', '1']);

  // (a) The source now says 99.99 for day 1 (0.04% lower): the decision of that day would be "cash".
  const other = tmpDir();
  const revised = synthetic(other, flat199, [[100, 99.99], [100.03, 110], [110, 112], [112, 113]]);
  for (const cmd of ['verify', 'update']) {
    const r = await run([cmd, '--data', revised[1], '--ledger', ledgerFile, '--start', '2020-01-01']);
    assert.equal(r.code, 1, cmd + r.out);
    assert.match(r.err, /ПОМИЛКА \[E_REVISION\]: Перегляд даних за 2020-01-01/);
    assert.match(r.err, /рішення правила було б іншим/);
    assert.doesNotMatch(r.out, /OK/);
  }
  assert.equal(fs.readFileSync(ledgerFile, 'utf8'), good, 'nothing appended');

  // (b) The forgery itself: nudge the recorded close of day 1 by 0.04%, re-derive every later row
  // with the tool's own code and recompute all hashes. The chain and the arithmetic are valid.
  const ruleInfo = tool.makeRule('2020-01-01');
  const ctx = { rule: ruleInfo.rule, ruleHash: ruleInfo.hash, source: tool.SOURCE_TEST };
  const rows = good.trimEnd().split('\n').slice(1).map(tool.parseRow);
  let prev = null;
  const forged = rows.map((r, i) => {
    const inp = { date: r.date, open: r.open, close: i === 0 ? 99.99 : r.close, sma20w: r.sma20w, sma200: r.sma200 };
    prev = tool.deriveRow(prev, inp, ctx);
    return prev.line;
  });
  const forgedDir = tmpDir();
  const forgedFile = path.join(forgedDir, 'ledger.csv');
  fs.writeFileSync(forgedFile, [tool.HEADER, ...forged].join('\n') + '\n');
  fs.writeFileSync(path.join(forgedDir, 'run_log.csv'), tool.RUN_LOG_HEADER + '\n'); // a forger writes this file too
  assert.deepEqual(readLedger(forgedFile).map((r) => r.above_sma20w + r.trade), ['0', '1', '1BUY'], 'a different trade history');
  const status = await run(['status', '--ledger', forgedFile, '--start', '2020-01-01']);
  assert.equal(status.code, 0, 'chain and arithmetic of the forgery are valid: ' + status.err);
  for (const cmd of ['verify', 'update']) {
    const r = await run([cmd, '--data', honest[1], '--ledger', forgedFile, '--start', '2020-01-01']);
    assert.equal(r.code, 1, cmd + r.out);
    assert.match(r.err, /ПОМИЛКА \[E_REVISION\]: Перегляд даних за 2020-01-01/);
    assert.doesNotMatch(r.out, /OK/);
  }

  // (c) Same for the "200D only" benchmark while the decision of the rule is the same either way.
  // Sundays at 1000, other days at 100: the 20-week average is 1000, and the close of day 1 is above
  // its own 200-day average only when it is above 46000/199 = 231.156: 231.20 is just above,
  // 231.12 (0.035% lower) just below.
  const mixed = [];
  for (let i = 0; i < 199; i++) mixed.push(weekday(addDays('2020-01-01', i - 199)) === 0 ? 1000 : 100);
  const dirC = tmpDir(), dirD = tmpDir();
  const up = synthetic(dirC, mixed, [[100, 231.2], [231.2, 240]]);
  const down = synthetic(dirD, mixed, [[100, 231.12], [231.2, 240]]);
  assert.equal((await run(['update', ...up])).code, 0);
  const rowsC = readLedger(path.join(dirC, 'ledger.csv'));
  assert.deepEqual([rowsC[0].above_sma20w, rowsC[0].sma200, rowsC[1].above_sma20w, rowsC[1].pos_200d_only], ['0', '231.156000', '0', '1']);
  const r = await run(['verify', '--data', down[1], '--ledger', path.join(dirC, 'ledger.csv'), '--start', '2020-01-01']);
  assert.equal(r.code, 1, r.out);
  assert.match(r.err, /ПОМИЛКА \[E_REVISION\].*лише 200-денна середня/);
  assert.doesNotMatch(r.err, /рішення правила було б іншим/);

  // (d) A Sunday close revised inside the tolerance moves the 20-week average a little. When that is
  // enough to flip the decision of a LATER day whose own prices did not change, it is a revision too.
  // Recorded: Sunday 2020-01-05 closes at 10004, so the average is (19*10000 + 10004)/20 = 10000.2 and
  // Monday's close 10000.30 is above it. Source now: Sunday 10008 (0.04% higher), average 10000.4,
  // and the same Monday close is no longer above it.
  const flatBig = new Array(199).fill(10000);
  const week = [[10000, 10000], [10000, 10000], [10000, 10000], [10000, 10000]];
  const dirE = tmpDir(), dirF = tmpDir();
  const recorded = synthetic(dirE, flatBig, [...week, [10000, 10004], [10004, 10000.3]]);
  const fresh = synthetic(dirF, flatBig, [...week, [10000, 10008], [10004, 10000.3]]);
  assert.equal((await run(['update', ...recorded])).code, 0);
  const rowsE = readLedger(path.join(dirE, 'ledger.csv'));
  assert.deepEqual(rowsE.slice(4).map((x) => `${x.date} ${x.close} ${x.sma20w} ${x.above_sma20w}`),
    ['2020-01-05 10004.00 10000.200000 1', '2020-01-06 10000.30 10000.200000 1']);
  for (const cmd of ['verify', 'update']) {
    const rev = await run([cmd, '--data', fresh[1], '--ledger', path.join(dirE, 'ledger.csv'), '--start', '2020-01-01']);
    assert.equal(rev.code, 1, rev.out);
    assert.match(rev.err, /ПОМИЛКА \[E_REVISION\]: Перегляд даних за 2020-01-06/);
    assert.match(rev.err, /рішення правила було б іншим: у журналі «тримати BTC», за свіжими даними «долари»/);
  }
});

test('recorded prices that differ from the source inside the tolerance never give a bare OK', async () => {
  const dir = tmpDir(), other = tmpDir();
  // The ledger was written with a BUY at 100.96; the source says 101.00 (0.04% higher).
  const shaded = synthetic(dir, flat199, [[100, 101], [100.96, 110], [110, 112]]);
  const source = synthetic(other, flat199, [[100, 101], [101, 110], [110, 112], [112, 113]]);
  assert.equal((await run(['update', ...shaded])).code, 0);
  const ledgerFile = path.join(dir, 'ledger.csv');
  const good = fs.readFileSync(ledgerFile, 'utf8');
  const args = ['--data', source[1], '--ledger', ledgerFile, '--start', '2020-01-01'];

  const ver = await run(['verify', ...args]);
  assert.equal(ver.code, 3, 'an incomplete match is not exit code 0: ' + ver.err);
  assert.equal(ver.err, '');
  assert.doesNotMatch(ver.out, /^OK/m, 'no line starts with OK');
  assert.doesNotMatch(ver.out, /кожен рядок збігається/);
  assert.match(ver.out, /^ЗБІГ НЕПОВНИЙ/);
  assert.match(ver.out, /Зауваження: у 1 записаних днях/);
  assert.match(ver.out, /2020-01-02: open у журналі 100\.96, зараз 101\.00/);
  // The effect on the money is shown: 9985 * 112/100.96 in the ledger against 9985 * 112/101.
  assert.match(ver.out, /рахунок за правилом був би 11 072\.48 USD, а в журналі 11 076\.86 USD \(журнал відрізняється на \+0\.04%\)/);
  assert.match(ver.out, /«Лише 200-денна середня»: 11 072\.48 USD проти 11 076\.86 USD у журналі/);

  // update goes on (the difference is inside the tolerance) but names the day, also in the status file.
  const upd = await run(['update', ...args]);
  assert.equal(upd.code, 0, upd.err);
  assert.match(upd.out, /2020-01-02: open у журналі 100\.96, зараз 101\.00/);
  const after = fs.readFileSync(ledgerFile, 'utf8');
  assert.ok(after.startsWith(good) && after.length > good.length, 'old rows untouched, one day appended');
  assert.match(fs.readFileSync(path.join(dir, 'STATUS_UA.md'), 'utf8'), /## Попередження[\s\S]*біржа тепер показує трохи інші ціни, ніж у журналі \(2020-01-02\)/);

  // With identical data the plain OK is there.
  const dir2 = tmpDir();
  const same = synthetic(dir2, flat199, [[100, 101], [100.96, 110], [110, 112]]);
  assert.equal((await run(['update', ...same])).code, 0);
  const clean = await run(['verify', ...same]);
  assert.equal(clean.code, 0);
  assert.match(clean.out, /^OK\. Перевірено 3 записів/);

  // The forgery on real prices: every BUY recorded 0.04% cheaper, every SELL 0.04% dearer,
  // all later rows re-derived with the tool's own code, all hashes recomputed.
  const lab = tmpDir(), forgedDir = tmpDir();
  const real = ['--data', EXPORT, '--start', '2023-01-01', '--now', '2026-06-01T00:00:00Z'];
  assert.equal((await run(['update', '--ledger', path.join(lab, 'ledger.csv'), ...real])).code, 0);
  const ruleInfo = tool.makeRule('2023-01-01');
  const ctx = { rule: ruleInfo.rule, ruleHash: ruleInfo.hash, source: tool.SOURCE_TEST };
  const honestRows = ledgerLines(path.join(lab, 'ledger.csv')).slice(1).map(tool.parseRow);
  let prev = null;
  const forged = honestRows.map((r) => {
    const k = r.trade === 'BUY' ? 0.9996 : r.trade === 'SELL' ? 1.0004 : 1;
    prev = tool.deriveRow(prev, { date: r.date, open: Number((r.open * k).toFixed(2)), close: r.close, sma20w: r.sma20w, sma200: r.sma200 }, ctx);
    return prev;
  });
  const trades = honestRows.filter((r) => r.trade);
  assert.ok(trades.length >= 20, `enough trades to matter: ${trades.length}`);
  assert.deepEqual(forged.map((r) => r.trade), honestRows.map((r) => r.trade), 'the same trades, only better prices');
  assert.ok(forged[forged.length - 1].equity > honestRows[honestRows.length - 1].equity * (1 + 0.00035 * trades.length), 'the forgery is worth about 0.04% per trade');
  assert.ok(forged[forged.length - 1].equity > honestRows[honestRows.length - 1].equity * 1.01, 'the forgery is worth more than 1%');
  fs.writeFileSync(path.join(forgedDir, 'ledger.csv'), [tool.HEADER, ...forged.map((r) => r.line)].join('\n') + '\n');
  fs.writeFileSync(path.join(forgedDir, 'run_log.csv'), tool.RUN_LOG_HEADER + '\n');
  const shadedVer = await run(['verify', '--ledger', path.join(forgedDir, 'ledger.csv'), ...real]);
  assert.equal(shadedVer.code, 3, shadedVer.err);
  assert.doesNotMatch(shadedVer.out, /^OK/m);
  assert.match(shadedVer.out, /^ЗБІГ НЕПОВНИЙ/);
  assert.match(shadedVer.out, new RegExp(`Зауваження: у ${trades.length} записаних днях`));
  for (const t of trades) assert.ok(shadedVer.out.includes(`  ${t.date}: open у журналі`), `verify names ${t.date}`);
  const honestMoney = honestRows[honestRows.length - 1].equity.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  assert.ok(shadedVer.out.includes(`рахунок за правилом був би ${honestMoney} USD`), 'the honest money is shown');
});

// ---------- live source (fake exchange) ----------

test('live source: closed days are recorded, the open bar is not', async () => {
  const dir = tmpDir();
  await withBitstamp(liveBars(), LIVE_DATE, async (calls) => {
    const r = await run(['update', ...liveArgs(dir)]);
    assert.equal(r.code, 0, r.err);
    assert.equal(calls.length, 1);
    const rows = readLedger(path.join(dir, 'ledger.csv'));
    assert.deepEqual(rows.map((x) => x.date), ['2026-05-28', '2026-05-29', '2026-05-30', '2026-05-31']);
    assert.ok(rows.every((x) => x.data_source === tool.SOURCE_LIVE));
    const day = liveBars().find((b) => b.date === '2026-05-31');
    assert.equal(rows[3].open, day.open.toFixed(2));
    assert.equal(rows[3].close, day.close.toFixed(2));
    // 2026-05-31 is a Sunday: its row already uses the week that ended that day.
    assert.equal(weekday('2026-05-31'), 0);
    assert.deepEqual(rows.map((x) => x.week_end), ['2026-05-24', '2026-05-24', '2026-05-24', '2026-05-31']);
    const ver = await run(['verify', ...liveArgs(dir)]);
    assert.equal(ver.code, 0, ver.err);
    assert.match(ver.out, /^OK\. Перевірено 4 записів/);
    const again = await run(['update', ...liveArgs(dir)]);
    assert.match(again.out, /нічого не додано/);
  });
  // The live rows equal the rows built from the same prices offline, apart from the source name and the hashes.
  const offline = tmpDir();
  const csv = writeCsv(path.join(offline, 'data.csv'), liveBars());
  assert.equal((await run(['update', '--data', csv, ...liveArgs(offline)])).code, 0);
  const strip = (rows) => rows.map((x) => tool.COLUMNS.slice(0, COL.data_source).map((c) => x[c]).join(','));
  assert.deepEqual(strip(readLedger(path.join(offline, 'ledger.csv'))), strip(readLedger(path.join(dir, 'ledger.csv'))));

  // Paging: history longer than one page is fetched with `end`.
  const long = tmpDir();
  await withBitstamp(exportBars().filter((b) => b.date >= '2020-01-01' && b.date <= '2026-06-01'), LIVE_DATE, async (calls) => {
    const r = await run(['update', '--ledger', path.join(long, 'ledger.csv'), '--start', '2023-12-01', '--now', '2026-06-01T10:00:05Z']);
    assert.equal(r.code, 0, r.err);
    assert.equal(calls.length, 2);
    assert.match(calls[1], /&end=\d+$/);
    assert.equal(readLedger(path.join(long, 'ledger.csv')).length, 913);
  });
  // The exchange has too little history for the 200 days before the start: nothing is written.
  const short = tmpDir();
  await withBitstamp(exportBars().filter((b) => b.date >= '2026-01-01' && b.date <= '2026-06-01'), LIVE_DATE, async () => {
    const r = await run(['update', ...liveArgs(short)]);
    assert.equal(r.code, 1);
    assert.match(r.err, /ПОМИЛКА \[E_HISTORY\]/);
    assert.ok(!fs.existsSync(path.join(short, 'ledger.csv')));
  });
});

test('live source: without the exchange clock nothing is recorded, and a fast PC clock is harmless', async () => {
  // The PC clock is a full day ahead: by that clock the bar of 2026-06-01 looks closed.
  const ahead = '2026-06-02T10:00:00Z';
  const ok = tmpDir();
  await withBitstamp(liveBars(), LIVE_DATE, async () => {
    const r = await run(['update', ...liveArgs(ok, ahead)]);
    assert.equal(r.code, 0, r.err);
    const rows = readLedger(path.join(ok, 'ledger.csv'));
    assert.equal(rows[rows.length - 1].date, '2026-05-31', 'the exchange clock wins');
    assert.match(r.out, /годинник цього комп’ютера поспішає/);
  });
  for (const header of [null, '', 'garbage', '2 June 2026 10:00', '2026-06-01T10:00:00Z', 'Mon, 01 Jun 2026 10:00:00 +0300']) { // only the HTTP date format counts
    const dir = tmpDir();
    await withBitstamp(liveBars(), header, async () => {
      for (const cmd of ['update', 'verify']) {
        const r = await run([cmd, ...liveArgs(dir, ahead)]);
        assert.equal(r.code, 1, `${cmd} with Date header ${header}`);
        assert.match(r.err, /ПОМИЛКА \[E_FETCH\].*час біржі/);
      }
      assert.ok(!fs.existsSync(path.join(dir, 'ledger.csv')), 'nothing written');
    });
    // Also with an existing ledger: nothing is appended.
    fs.copyFileSync(path.join(ok, 'ledger.csv'), path.join(dir, 'ledger.csv'));
    fs.copyFileSync(path.join(ok, 'run_log.csv'), path.join(dir, 'run_log.csv'));
    const before = fs.readFileSync(path.join(dir, 'ledger.csv'), 'utf8');
    await withBitstamp(liveBars(), header, async () => {
      assert.equal((await run(['update', ...liveArgs(dir, ahead)])).code, 1);
    });
    assert.equal(fs.readFileSync(path.join(dir, 'ledger.csv'), 'utf8'), before);
  }
  // A slow PC clock only delays: nothing wrong is written.
  const slow = tmpDir();
  await withBitstamp(liveBars(), LIVE_DATE, async () => {
    const r = await run(['update', ...liveArgs(slow, '2026-05-30T10:00:00Z')]);
    assert.equal(r.code, 0, r.err);
    const rows = readLedger(path.join(slow, 'ledger.csv'));
    assert.equal(rows[rows.length - 1].date, '2026-05-29');
    assert.match(r.out, /годинник цього комп’ютера відстає/);
  });
  // A Sunday bar that the exchange still holds open is not used as a weekly close, whatever the PC clock says.
  const sunday = tmpDir();
  await withBitstamp(liveBars('2026-05-31').map((b) => (b.date === '2026-05-31' ? { ...b, close: b.high } : b)), 'Sun, 31 May 2026 23:59:59 GMT', async () => {
    const r = await run(['update', ...liveArgs(sunday, ahead)]);
    assert.equal(r.code, 0, r.err);
    const rows = readLedger(path.join(sunday, 'ledger.csv'));
    assert.equal(rows[rows.length - 1].date, '2026-05-30');
    assert.ok(rows.every((x) => x.week_end === '2026-05-24'));
  });
});

test('live source: garbage from the exchange is never recorded', async () => {
  // A good ledger up to 2026-05-30, then the answer for 2026-05-31 is damaged in different ways.
  const base = tmpDir();
  await withBitstamp(liveBars('2026-05-31'), 'Sun, 31 May 2026 10:00:00 GMT', async () => {
    assert.equal((await run(['update', ...liveArgs(base, '2026-05-31T10:00:05Z')])).code, 0);
  });
  const good = fs.readFileSync(path.join(base, 'ledger.csv'), 'utf8');
  assert.equal(good.trimEnd().split('\n').length, 4);
  const lastClosed = (list) => list.find((b) => b.timestamp === String(Date.parse('2026-05-31T00:00:00Z') / 1000));
  const openBar = (list) => list[list.length - 1];
  const set = (pick, patch) => (list) => { Object.assign(pick(list), patch); return list; };
  const cases = [
    ['E_DATA', 'close "0.01" outside low..high', set(lastClosed, { close: '0.01' })],
    ['E_DATA', 'close true', set(lastClosed, { close: true })],
    ['E_DATA', 'close null', set(lastClosed, { close: null })],
    ['E_DATA', 'close missing', (list) => { delete lastClosed(list).close; return list; }],
    ['E_DATA', 'close as array', (list) => { const b = lastClosed(list); b.close = [b.close]; return list; }],
    ['E_DATA', 'open as array', (list) => { const b = lastClosed(list); b.open = [b.open]; return list; }],
    ['E_DATA', 'hex close', set(lastClosed, { close: '0x1F4A0' })],
    ['E_DATA', 'exponent close', set(lastClosed, { close: '7e4' })],
    ['E_DATA', 'padded close', (list) => { const b = lastClosed(list); b.close = ` ${b.close} `; return list; }],
    ['E_DATA', 'negative low', set(lastClosed, { low: '-1' })],
    ['E_DATA', 'high below close', (list) => { const b = lastClosed(list); b.high = String(Number(b.close) - 1); return list; }],
    ['E_DATA', 'missing high', (list) => { delete lastClosed(list).high; return list; }],
    ['E_DATA', 'null list element', (list) => list.concat([null])],
    ['E_DATA', 'string list element', (list) => list.concat(['bar'])],
    ['E_DATA', 'array list element', (list) => list.concat([[1, 2]])],
    ['E_DATA', 'odd timestamp', (list) => { const b = lastClosed(list); b.timestamp = String(Number(b.timestamp) + 1); return list; }],
    ['E_DATA', 'garbage in the still-open bar', set(openBar, { open: 'NaN' })],
    // Consistent inside the day, but disconnected from the neighbouring days.
    ['E_SUSPECT', 'whole day at half price', set(lastClosed, { open: '36000', high: '37000', low: '35000', close: '36500' })],
    ['E_SUSPECT', 'close far from the next open', set(lastClosed, { close: '30000', low: '29000' })],
  ];
  for (const [code, what, mutate] of cases) {
    const dir = tmpDir();
    fs.copyFileSync(path.join(base, 'ledger.csv'), path.join(dir, 'ledger.csv'));
    fs.copyFileSync(path.join(base, 'run_log.csv'), path.join(dir, 'run_log.csv'));
    fs.copyFileSync(path.join(base, 'frozen_rule.json'), path.join(dir, 'frozen_rule.json'));
    await withBitstamp(liveBars(), LIVE_DATE, async () => {
      const r = await run(['update', ...liveArgs(dir)]);
      assert.equal(r.code, 1, `${what}: ${r.out}${r.err}`);
      assert.ok(r.err.startsWith(`ПОМИЛКА [${code}]`), `${what}: ${r.err}`);
      assert.doesNotMatch(r.err, /E_INTERNAL|TypeError|\n\s+at /, what);
    }, mutate);
    assert.equal(fs.readFileSync(path.join(dir, 'ledger.csv'), 'utf8'), good, `${what}: nothing appended`);
    assert.ok(!fs.existsSync(path.join(dir, 'STATUS_UA.md')), `${what}: no status written`);
  }
  // A real crash inside one day (connected to its neighbours) is NOT blocked: -45% open to close.
  const crash = tmpDir();
  fs.copyFileSync(path.join(base, 'ledger.csv'), path.join(crash, 'ledger.csv'));
  fs.copyFileSync(path.join(base, 'run_log.csv'), path.join(crash, 'run_log.csv'));
  const bars = liveBars().map((b) => {
    if (b.date === '2026-05-31') return { ...b, low: Math.round(b.open * 50) / 100, close: Math.round(b.open * 55) / 100 };
    if (b.date === '2026-06-01') return { ...b, open: Math.round(b.open * 55) / 100, low: 1 };
    return b;
  });
  await withBitstamp(bars, LIVE_DATE, async () => {
    const r = await run(['update', ...liveArgs(crash)]);
    assert.equal(r.code, 0, r.err);
    assert.equal(readLedger(path.join(crash, 'ledger.csv')).length, 4);
  });
});

test('offline data: only plain decimal prices are accepted', async () => {
  const bad = ['0x1F4A0', '7e4', ' 70000 ', '70000 ', '', 'abc', '-5', '0', '0.00', 'Infinity', 'NaN', '+70000', '70000.', '.5', '1_000', 'true'];
  for (const value of bad) {
    for (const field of ['open', 'close']) {
      const dir = tmpDir();
      const csv = writeCsv(path.join(dir, 'data.csv'), sliceBars().map((b) => (b.date === '2020-03-10' ? { ...b, [field]: value } : b)));
      const r = await run(['update', ...sliceArgs(dir, csv)]);
      assert.equal(r.code, 1, `${field}="${value}"`);
      assert.match(r.err, /ПОМИЛКА \[E_DATA\]/, `${field}="${value}"`);
      assert.ok(!fs.existsSync(path.join(dir, 'ledger.csv')));
    }
  }
  for (const value of ['70000', '70000.5', '70000.123456789', '0.01']) {
    const dir = tmpDir();
    const csv = writeCsv(path.join(dir, 'data.csv'), sliceBars().map((b) => (b.date === '2020-03-10' ? { ...b, close: value } : b)));
    assert.equal((await run(['update', ...sliceArgs(dir, csv)])).code, 0, value);
  }
});

// ---------- recorded rows cannot be removed and written again ----------

test('rows that an earlier run wrote cannot disappear or be replaced', async () => {
  const dir = tmpDir();
  const ledgerFile = path.join(dir, 'ledger.csv'), logFile = path.join(dir, 'run_log.csv');
  const csvA = writeCsv(path.join(dir, 'a.csv'), sliceBars('2020-03-01'));
  const csvB = writeCsv(path.join(dir, 'b.csv'), sliceBars('2020-03-10'));
  const revised = writeCsv(path.join(dir, 'rev.csv'), sliceBars().map((b) => (b.date === '2020-03-05' ? { ...b, close: Math.round(b.close * 110) / 100 } : b)));
  assert.equal((await run(['update', ...sliceArgs(dir, csvA)])).code, 0);
  const copyA = { ledger: fs.readFileSync(ledgerFile, 'utf8'), log: fs.readFileSync(logFile, 'utf8') };
  assert.equal((await run(['update', ...sliceArgs(dir, csvB)])).code, 0);
  const good = fs.readFileSync(ledgerFile, 'utf8'), goodLog = fs.readFileSync(logFile, 'utf8');
  const lines = good.trimEnd().split('\n');
  assert.equal(lines.length, 52);

  // The revision is refused. The obvious "fix" of a stuck owner is to delete the tail or the file.
  const rev = await run(['update', ...sliceArgs(dir, revised)]);
  assert.match(rev.err, /ПОМИЛКА \[E_REVISION\].*2020-03-05/);
  const allCommands = async (what) => {
    for (const args of [['update', ...sliceArgs(dir, revised)], ['verify', ...sliceArgs(dir, revised)], ['update', ...sliceArgs(dir, csvB)],
      ['status', '--ledger', ledgerFile, '--start', SLICE_START]]) {
      const before = fs.existsSync(ledgerFile) ? fs.readFileSync(ledgerFile, 'utf8') : null;
      const r = await run(args);
      assert.equal(r.code, 1, `${what}: ${args[0]} ${r.out}`);
      assert.match(r.err, /ПОМИЛКА \[E_SHRUNK\]/, `${what}: ${args[0]}`);
      assert.equal(fs.existsSync(ledgerFile) ? fs.readFileSync(ledgerFile, 'utf8') : null, before, `${what}: nothing written`);
    }
    assert.equal(fs.readFileSync(logFile, 'utf8'), goodLog, 'failed runs are not logged');
  };
  fs.writeFileSync(ledgerFile, lines.slice(0, 46).join('\n') + '\n'); // rows from 2020-03-05 on are gone
  await allCommands('deleted tail');
  fs.writeFileSync(ledgerFile, tool.HEADER + '\n');
  await allCommands('emptied ledger');
  fs.rmSync(ledgerFile);
  await allCommands('deleted ledger');

  // Rows re-created from other data in a clean folder and copied over the old ones (valid chain, same length).
  const lab = tmpDir();
  assert.equal((await run(['update', '--data', revised, '--ledger', path.join(lab, 'ledger.csv'), '--start', SLICE_START, '--now', '2020-03-11T00:00:00Z'])).code, 0);
  fs.copyFileSync(path.join(lab, 'ledger.csv'), ledgerFile);
  assert.equal(ledgerLines(ledgerFile).length, 52);
  await allCommands('replaced rows');

  // A damaged run log is not ignored either.
  fs.writeFileSync(ledgerFile, good);
  for (const text of [goodLog.replace(',51,', ',x,'), goodLog.slice(0, -3), 'junk\n' + goodLog, goodLog + 'one,two\n']) {
    assert.notEqual(text, goodLog);
    fs.writeFileSync(logFile, text);
    const r = await run(['update', ...sliceArgs(dir, csvB)]);
    assert.equal(r.code, 1);
    assert.match(r.err, /ПОМИЛКА \[E_RUNLOG\]/);
  }

  // Deleting the run log (the file the error message names) does not open the door either.
  fs.rmSync(logFile);
  for (const text of [good, lines.slice(0, 46).join('\n') + '\n']) {
    fs.writeFileSync(ledgerFile, text);
    for (const args of [['update', ...sliceArgs(dir, revised)], ['update', ...sliceArgs(dir, csvB)], ['verify', ...sliceArgs(dir, csvB)], ['status', '--ledger', ledgerFile, '--start', SLICE_START]]) {
      const r = await run(args);
      assert.equal(r.code, 1, args[0] + r.out);
      assert.match(r.err, /ПОМИЛКА \[E_RUNLOG\]: Файла run_log\.csv немає, хоча в журналі вже є записи/);
      assert.equal(fs.readFileSync(ledgerFile, 'utf8'), text, 'nothing written');
      assert.ok(!fs.existsSync(logFile), 'no new run log is started on top of old rows');
    }
  }
  // A first run starts the run log before the first row, so a failed first run can never
  // leave rows without a run log.
  const fresh = tmpDir();
  fs.mkdirSync(path.join(fresh, 'run_log.csv')); // the run log cannot be read or created
  const blocked = await run(['update', ...sliceArgs(fresh, csvA)]);
  assert.equal(blocked.code, 1);
  assert.match(blocked.err, /ПОМИЛКА \[E_(READ|WRITE)\]/);
  assert.ok(!fs.existsSync(path.join(fresh, 'ledger.csv')), 'no ledger without a run log');
  fs.rmdirSync(path.join(fresh, 'run_log.csv'));
  fs.writeFileSync(path.join(fresh, 'ledger.csv'), tool.HEADER + '\n'); // header only and no run log: a normal first run
  assert.equal((await run(['update', ...sliceArgs(fresh, csvA)])).code, 0);
  assert.equal(fs.readFileSync(path.join(fresh, 'ledger.csv'), 'utf8'), copyA.ledger);
  assert.equal(ledgerLines(path.join(fresh, 'run_log.csv')).length, 2);

  // The documented way back: ledger.csv and run_log.csv restored together from one older copy.
  fs.writeFileSync(ledgerFile, copyA.ledger);
  fs.writeFileSync(logFile, copyA.log);
  const back = await run(['update', ...sliceArgs(dir, csvB)]);
  assert.equal(back.code, 0, back.err);
  assert.equal(fs.readFileSync(ledgerFile, 'utf8'), good, 'the same rows again');
  assert.equal((await run(['verify', ...sliceArgs(dir, csvB)])).code, 0);
});

// ---------- status checks what it can without the exchange ----------

test('status refuses a forged or impossible ledger', async () => {
  const dir = tmpDir();
  const ledgerFile = path.join(dir, 'ledger.csv');
  const csv = writeCsv(path.join(dir, 'data.csv'), sliceBars('2020-03-10'));
  assert.equal((await run(['update', ...sliceArgs(dir, csv)])).code, 0);
  const good = fs.readFileSync(ledgerFile, 'utf8');
  const status = (now) => run(['status', '--ledger', ledgerFile, '--start', SLICE_START, '--now', now]);
  assert.equal((await status('2020-03-11T00:00:00Z')).code, 0);

  // Equity multiplied by 1.5 from the second row on, all hashes recomputed.
  rechain(ledgerFile, (c, i) => { if (i > 0) c[COL.equity] = (Number(c[COL.equity]) * 1.5).toFixed(6); });
  let r = await status('2020-03-11T00:00:00Z');
  assert.equal(r.code, 1, r.out);
  assert.match(r.err, /ПОМИЛКА \[E_MISMATCH\].*equity/);
  assert.equal(r.out, '');

  // Other cells with valid hashes: benchmark money, a decision, a position, the week, the source, a trade.
  for (const [name, value] of [['equity_200d_only', '99999.000000'], ['equity_hold', '99999.000000'], ['target_next', null], ['above_sma20w', null],
    ['pos_held', null], ['pos_200d_only', null], ['week_end', '2020-02-02'], ['week_end', '2020-02-10'], ['data_source', 'made_up_source'],
    ['trade', 'BUY'], ['cost_usd', '1.000000']]) {
    fs.writeFileSync(ledgerFile, good);
    rechain(ledgerFile, (c, i) => { if (i === 20) c[COL[name]] = value === null ? (c[COL[name]] === '1' ? '0' : '1') : value; });
    assert.notEqual(fs.readFileSync(ledgerFile, 'utf8'), good);
    r = await status('2020-03-11T00:00:00Z');
    assert.equal(r.code, 1, `column ${name}`);
    assert.match(r.err, /ПОМИЛКА \[E_(MISMATCH|SOURCE)\]/, `column ${name}`);
  }

  // A row for a day that has not closed yet.
  fs.writeFileSync(ledgerFile, good);
  r = await status('2020-03-10T23:59:59Z');
  assert.equal(r.code, 1);
  assert.match(r.err, /ПОМИЛКА \[E_FUTURE\].*2020-03-10/);
  assert.equal((await status('2020-03-11T00:00:00Z')).code, 0);
});

// ---------- failures are explained, never a stack trace ----------

test('unreadable files and failed side-file writes are explained in plain words', async () => {
  const dir = tmpDir();
  const csv = writeCsv(path.join(dir, 'data.csv'), sliceBars('2020-03-01'));
  const full = writeCsv(path.join(dir, 'full.csv'), sliceBars());

  // --ledger pointing at a directory.
  for (const args of [['status', '--ledger', dir, '--start', SLICE_START], ['update', '--data', csv, '--ledger', dir, '--start', SLICE_START],
    ['verify', '--data', csv, '--ledger', dir, '--start', SLICE_START]]) {
    const r = await run(args);
    assert.equal(r.code, 1, args[0] + r.err);
    assert.match(r.err, /ПОМИЛКА \[E_READ\]/);
    assert.doesNotMatch(r.err, /E_INTERNAL|\n\s+at /);
  }
  // Rule file or run log that cannot be read (a directory stands in for a locked file).
  for (const name of ['frozen_rule.json', 'run_log.csv']) {
    const d = tmpDir();
    fs.mkdirSync(path.join(d, name));
    const r = await run(['update', ...sliceArgs(d, csv)]);
    assert.equal(r.code, 1, name + r.err);
    assert.match(r.err, /ПОМИЛКА \[E_READ\]/, name);
    assert.ok(!fs.existsSync(path.join(d, 'ledger.csv')), `${name}: nothing written`);
  }

  // The status file cannot be written: the ledger is already appended, and the message says so.
  const d = tmpDir();
  assert.equal((await run(['update', ...sliceArgs(d, csv)])).code, 0);
  const statusFile = path.join(d, 'STATUS_UA.md');
  const oldStatus = fs.readFileSync(statusFile, 'utf8');
  fs.rmSync(statusFile);
  fs.mkdirSync(statusFile);
  const r = await run(['update', ...sliceArgs(d, full)]);
  assert.equal(r.code, 1);
  assert.match(r.err, /ПОМИЛКА \[E_WRITE\]/);
  assert.match(r.err, /Сам журнал при цьому оновлено правильно: додано днів: 19 \(2020-03-02 … 2020-03-20\)/);
  assert.match(r.err, /Запустіть update\.cmd ще раз/);
  assert.equal(ledgerLines(path.join(d, 'ledger.csv')).length, 62);
  // Running again after the obstacle is gone repairs the status and appends nothing.
  fs.rmdirSync(statusFile);
  const again = await run(['update', ...sliceArgs(d, full)]);
  assert.equal(again.code, 0, again.err);
  assert.match(again.out, /нічого не додано/);
  const newStatus = fs.readFileSync(statusFile, 'utf8');
  assert.notEqual(newStatus, oldStatus);
  assert.match(newStatus, /Останній закритий день у журналі: 2020-03-20/);

  // Nothing new and the status cannot be written: the message does not claim an update.
  fs.rmSync(statusFile);
  fs.mkdirSync(statusFile);
  const idle = await run(['update', ...sliceArgs(d, full)]);
  assert.equal(idle.code, 1);
  assert.match(idle.err, /ПОМИЛКА \[E_WRITE\].*До журналу нічого не додавалося/);
});

test('too little history: the message gives dates, not a confusing count', async () => {
  const dir = tmpDir();
  const csv = writeCsv(path.join(dir, 'data.csv'), exportBars().filter((b) => b.date >= '2025-06-01' && b.date <= '2026-06-01'));
  const r = await run(['update', '--data', csv, '--ledger', path.join(dir, 'ledger.csv'), '--start', '2025-06-01', '--now', '2026-06-01T00:00:00Z']);
  assert.equal(r.code, 1);
  assert.equal(addDays('2025-06-01', -199), '2024-11-14');
  assert.match(r.err, /ПОМИЛКА \[E_HISTORY\].*потрібні 200 закритих днів поспіль, тобто всі дні від 2024-11-14, а отримані дані починаються лише з 2025-06-01/);
  assert.doesNotMatch(r.err, /не більше/);
  assert.ok(!fs.existsSync(path.join(dir, 'ledger.csv')));
});

test('exit codes: verify without a ledger fails, and the launcher passes the code on', async () => {
  const dir = tmpDir();
  const csv = writeCsv(path.join(dir, 'data.csv'), sliceBars());
  const r = await run(['verify', ...sliceArgs(dir, csv)]);
  assert.equal(r.code, 1);
  assert.match(r.err, /ПОМИЛКА \[E_NOLEDGER\]/);
  assert.doesNotMatch(r.out, /OK/);

  const cmd = fs.readFileSync(LAUNCHER, 'utf8');
  assert.match(cmd, /\r\nnode "%~dp0paper_da\.js" update\r\n/, 'works from any current directory');
  assert.match(cmd, /\r\npause\r\nexit \/b %RC%\r\n/, 'keeps the window open, then returns the exit code of the program');
  assert.ok(!cmd.replace(/\r\n/g, '').includes('\n'), 'CRLF line ends only');
  assert.ok(!cmd.startsWith('\uFEFF'));
  assert.doesNotMatch(cmd, /paper_trade/);

  if (process.platform === 'win32') {
    const real = toolCopy();
    fs.copyFileSync(LAUNCHER, path.join(real, 'update.cmd'));
    fs.writeFileSync(path.join(real, 'ledger.csv'), 'broken\n'); // fails before any network access
    const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => k.toLowerCase() !== 'path'));
    const sys = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32');
    const launch = (pathVar) => spawnSync('cmd.exe', ['/d', '/c', path.join(real, 'update.cmd')], { encoding: 'utf8', input: '', cwd: os.tmpdir(), env: { ...env, PATH: pathVar } });
    const failed = launch(path.dirname(process.execPath) + ';' + sys);
    assert.equal(failed.status, 1, failed.stdout + failed.stderr);
    assert.match(failed.stderr, /E_CHAIN/);
    const noNode = launch(sys);
    assert.equal(noNode.status, 9, noNode.stdout + noNode.stderr);
    assert.match(noNode.stdout, /Node\.js/);
    assert.equal(fs.readFileSync(path.join(real, 'ledger.csv'), 'utf8'), 'broken\n');
  }
});

// ---------- evaluation: one verdict day, fixed in advance, against "200D only" ----------

// Independent statistics of one account over the first n rows.
function accountStats(rows, key, n) {
  let peak = 10000, dd = 0;
  for (let i = 0; i < n; i++) { const v = Number(rows[i][key]); if (v > peak) peak = v; dd = Math.min(dd, v / peak - 1); }
  const last = Number(rows[n - 1][key]);
  return { dd, ratio: (Math.pow(last / 10000, 365.25 / n) - 1) / -dd, total: last / 10000 - 1 };
}
const mainLines = (text) => text.split('\n').filter((l) => /Мінімум набрано|Основний висновок \(станом/.test(l)).join('\n');

test('the main verdict is taken once, on the first day both minimums are met, against "200D only"', async () => {
  const dir = tmpDir();
  const ledgerFile = path.join(dir, 'ledger.csv');
  const args = ['--data', EXPORT, '--ledger', ledgerFile, '--start', '2016-01-01'];
  const statusAt = async (now) => {
    const r = await run(['update', ...args, '--now', now]);
    assert.equal(r.code, 0, r.err);
    return fs.readFileSync(path.join(dir, 'STATUS_UA.md'), 'utf8');
  };

  // The day before the minimum is reached: too early, no verdict of any kind.
  const early = await statusAt('2016-12-30T00:00:00Z');
  assert.match(early, /Ще зарано для висновків/);
  assert.doesNotMatch(early, /Основний висновок|Довідка на сьогодні|підтвердилося на нових днях|не підтвердилося/);

  // The first evaluable day, found independently from the ledger: 365 days and 6 SELL rows.
  const first = await statusAt('2016-12-31T00:00:00Z');
  const rows = readLedger(ledgerFile);
  let sells = 0;
  const idx = rows.findIndex((r, i) => { if (r.trade === 'SELL') sells++; return i + 1 >= 365 && sells >= 6; });
  assert.equal(rows[idx].date, '2016-12-30');
  assert.equal(idx, rows.length - 1);
  assert.equal(sells, 9);
  // Independent verdict for that day: drawdown and yearly return per drawdown, rule against "200D only".
  const s = accountStats(rows, 'equity', idx + 1), o = accountStats(rows, 'equity_200d_only', idx + 1);
  assert.ok(s.total > 0 && o.total > 0);
  const confirmed = s.dd > o.dd && s.ratio > o.ratio;
  assert.equal(confirmed, false, 'on this history the first evaluable day says "not confirmed"');
  assert.match(first, /Мінімум набрано 2016-12-30: 365 дн\. і 9 завершених угод/);
  assert.match(first, /Порівнюємо з рахунком «лише 200-денна середня», а не з «просто тримати»/);
  assert.match(first, /Найбільше падіння менше, ніж у «лише 200-денної середньої»: ні \(-33\.50% проти -29\.56%\)/);
  assert.match(first, /краща, ніж у «лише 200-денної середньої»: ні \(2\.36 проти 4\.07\)/);
  assert.match(first, /Днів, коли два рахунки тримали різне: 15 із 365\./);
  assert.match(first, /Основний висновок \(станом на 2016-12-30\): не підтвердилося \(потрібні обидві умови\)/);
  assert.match(first, /не підстава торгувати справжніми грошима/);
  assert.doesNotMatch(first, /Довідка на сьогодні/, 'on the verdict day itself there is nothing else to show');
  assert.doesNotMatch(first, /Ще зарано/);

  // Later the day-to-day comparison flips, the main verdict does not move.
  const later = await statusAt('2017-06-01T00:00:00Z');
  const last = await statusAt('2026-11-26T00:00:00Z');
  assert.equal(mainLines(later), mainLines(first));
  assert.equal(mainLines(last), mainLines(first));
  assert.match(last, /### Довідка на сьогодні \(за всіма 3982 днями до 2026-11-25\)[\s\S]*За сьогоднішніми числами було б: «підтвердилося»/);
  assert.match(last, /Основного висновку вони не замінюють/);

  // The exported helpers agree with the text.
  const parsed = fs.readFileSync(ledgerFile, 'utf8').trimEnd().split('\n').slice(1).map(tool.parseRow);
  assert.equal(tool.verdictIndex(parsed, tool.FROZEN_RULE.evaluation), idx);
  assert.equal(tool.judge(parsed.slice(0, idx + 1), 10000).confirmed, false);
  assert.equal(tool.judge(parsed, 10000).confirmed, true);
});

test('verdict wording: "confirmed on new days", and the tie-break when both accounts lost money', async () => {
  const verdictFor = async (start, dayAfter) => {
    const dir = tmpDir();
    const ledgerFile = path.join(dir, 'ledger.csv');
    const r = await run(['update', '--data', EXPORT, '--ledger', ledgerFile, '--start', start, '--now', dayAfter + 'T00:00:00Z']);
    assert.equal(r.code, 0, r.err);
    const rows = readLedger(ledgerFile);
    let sells = 0;
    const idx = rows.findIndex((x, i) => { if (x.trade === 'SELL') sells++; return i + 1 >= 365 && sells >= 6; });
    assert.equal(idx, rows.length - 1, `${start}: the last row is the verdict day`);
    return { rows, sells, status: fs.readFileSync(path.join(dir, 'STATUS_UA.md'), 'utf8'), s: accountStats(rows, 'equity', rows.length), o: accountStats(rows, 'equity_200d_only', rows.length) };
  };

  // Start 2019-01-01: the sixth round trip ends on 2021-09-22 (day 996). Both accounts are up; both conditions hold.
  const a = await verdictFor('2019-01-01', '2021-09-23');
  assert.equal(a.rows.length, 996);
  assert.equal(a.sells, 6);
  assert.ok(a.s.total > 0 && a.o.total > 0 && a.s.dd > a.o.dd && a.s.ratio > a.o.ratio);
  assert.match(a.status, /Мінімум набрано 2021-09-22: 996 дн\. і 6 завершених угод/);
  assert.match(a.status, /Основний висновок \(станом на 2021-09-22\): підтвердилося на нових днях \(виконано обидві умови\)/);
  assert.match(a.status, /слабкий доказ у будь-який бік/);
  assert.match(a.status, /не підстава торгувати справжніми грошима/);
  assert.doesNotMatch(a.status, /Обидва рахунки в мінусі|було в мінусі/);

  // Start 2018-01-01: on the verdict day (2019-03-26) both accounts are below the start. The second
  // condition then reads "the rule lost less", and the status says plainly that the rule lost money.
  const b = await verdictFor('2018-01-01', '2019-03-27');
  assert.equal(b.rows.length, 450);
  assert.ok(b.s.total < 0 && b.o.total < 0 && b.s.total > b.o.total && b.s.dd > b.o.dd);
  assert.match(b.status, /Обидва рахунки в мінусі, тому порівнюємо збиток: менший збиток у правила «BTC DA»: так \(-44\.\d\d% проти -53\.\d\d%\)/);
  assert.match(b.status, /Основний висновок \(станом на 2019-03-26\): підтвердилося на нових днях/);
  assert.match(b.status, /Саме правило на той день було в мінусі \(-44\.\d\d%\)/);

  // The tie-break in the other direction, and the plain cases, on made-up equity curves.
  const mk = (pairs) => pairs.map(([equity, other]) => ({ equity, equity_200d_only: other }));
  // both lost, the rule lost more -> not confirmed even with the smaller drawdown
  let j = tool.judge(mk([[9000, 8000], [8500, 9500]]), 10000);
  assert.deepEqual([j.bothLosing, j.ddOk, j.ratioOk, j.confirmed], [true, true, false, false]);
  // both lost, the rule lost less but fell deeper on the way -> not confirmed
  j = tool.judge(mk([[7000, 9000], [9500, 9000]]), 10000);
  assert.deepEqual([j.bothLosing, j.ddOk, j.ratioOk, j.confirmed], [true, false, true, false]);
  // only the rule lost -> the ratio comparison applies and fails
  j = tool.judge(mk([[9900, 9000], [9950, 12000]]), 10000);
  assert.deepEqual([j.bothLosing, j.ddOk, j.ratioOk, j.confirmed], [false, true, false, false]);
  // an exactly equal drawdown is not "smaller"
  j = tool.judge(mk([[9000, 9000], [20000, 12000]]), 10000);
  assert.deepEqual([j.ddOk, j.ratioOk, j.confirmed], [false, true, false]);
  // "200D only" never fell: nothing can have a smaller drawdown than zero
  j = tool.judge(mk([[10000, 10000], [20000, 10500]]), 10000);
  assert.equal(j.confirmed, false);
  // smaller drawdown and better ratio -> confirmed
  j = tool.judge(mk([[9500, 9000], [20000, 12000]]), 10000);
  assert.deepEqual([j.ddOk, j.ratioOk, j.confirmed], [true, true, true]);
});

test('the "too early" warning names only the condition that is not met', async () => {
  const dir = tmpDir();
  const warn = async (start, now) => {
    const d = tmpDir();
    const r = await run(['update', '--data', EXPORT, '--ledger', path.join(d, 'ledger.csv'), '--start', start, '--now', now]);
    assert.equal(r.code, 0, r.err);
    const status = fs.readFileSync(path.join(d, 'STATUS_UA.md'), 'utf8');
    assert.doesNotMatch(status, /Основний висновок|Оцінка за планом/);
    return status.split('\n').find((l) => l.includes('Ще зарано'));
  };
  // 335 days and 8 round trips: only the days are missing.
  const days = await warn('2016-01-01', '2016-12-01T01:00:00Z');
  assert.match(days, /Оцінка можлива лише після 365 днів і 6 завершених угод одночасно\. Ще не минуло 365 днів \(зараз 335\)\.$/);
  assert.doesNotMatch(days, /менше ніж 6|нічого не доводять/);
  // 374 days and no round trip: only the trades are missing.
  const trades = await warn('2017-01-01', '2018-01-10T05:00:00Z');
  assert.match(trades, /Завершених угод менше ніж 6 \(зараз 0\); так мало угод нічого не доводять\.$/);
  assert.doesNotMatch(trades, /Ще не минуло/);
  // 41 days and 1 round trip: both.
  const csv = writeCsv(path.join(dir, 'data.csv'), sliceBars('2020-02-29'));
  assert.equal((await run(['update', ...sliceArgs(dir, csv)])).code, 0);
  const both = fs.readFileSync(path.join(dir, 'STATUS_UA.md'), 'utf8');
  assert.match(both, /Ще не минуло 365 днів \(зараз 41\)\. Завершених угод менше ніж 6 \(зараз 1\)/);
});

// ---------- the real folder matches the program (read-only) ----------

test('the real paper_da folder is consistent with the frozen rule in the program', async () => {
  const read = (name) => fs.readFileSync(path.join(REAL_DIR, name), 'utf8');
  const ruleInfo = tool.makeRule();
  assert.equal(ruleInfo.hash, RULE_HASH);
  assert.equal(read('frozen_rule.json'), ruleInfo.json, 'frozen_rule.json is the rule of the program, byte for byte');
  assert.equal(tool.sha256(read('frozen_rule.json')), ruleInfo.hash);
  const lines = read('ledger.csv').trimEnd().split('\n');
  assert.equal(lines[0], tool.HEADER);
  for (const line of lines.slice(1)) {
    const r = tool.parseRow(line);
    assert.equal(r.rule_sha256, ruleInfo.hash, `row ${r.date} was written under the current rule`);
    assert.equal(r.data_source, tool.SOURCE_LIVE, `row ${r.date} comes from the live source`);
    assert.ok(r.date >= FROZEN_START, `row ${r.date} is not older than the frozen start date`);
  }
  assert.ok(read('run_log.csv').startsWith(tool.RUN_LOG_HEADER + '\n'));
  // The status file was written by the current program: honest reminder, no test banner.
  const status = read('STATUS_UA.md');
  assert.doesNotMatch(status, /ТЕСТОВИЙ/);
  assert.match(status, /найімовірніше гірші/);
  assert.match(status, /вибрано заднім числом/);
  assert.doesNotMatch(status, /трохи інші числа/);
  if (lines.length === 1) assert.match(status, /Перший запис з’явиться після того, як закриється перший повний день: 2026-11-28 00:00 UTC/);
  // `status` on the real folder is offline and read-only, and it accepts the folder as it is.
  const before = REAL_FILES.map(read);
  const st = await run(['status']);
  assert.equal(st.code, 0, st.err);
  assert.deepEqual(REAL_FILES.map(read), before);
});

// ---------- the two ledgers are independent ----------

test('the program stands alone: nothing is loaded from the main paper folder', () => {
  const source = fs.readFileSync(SCRIPT, 'utf8');
  const required = [...source.matchAll(/require\(([^)]*)\)/g)].map((m) => m[1]);
  assert.deepEqual(required.sort(), ["'node:crypto'", "'node:fs'", "'node:path'"]);
  assert.doesNotMatch(source, /import\s*\(/);
  // The only host it talks to, and how it introduces itself.
  assert.deepEqual([...new Set(source.match(/https?:\/\/[^/'"`$]+/g))], ['https://www.bitstamp.net']);
  assert.match(source, /const API_HOST = 'www\.bitstamp\.net';/);
  assert.match(source, /const USER_AGENT = 'csi-paper\/1\.0';/);
  // It runs from a folder that contains nothing but itself (no ../paper next to it).
  const lone = tmpDir();
  fs.copyFileSync(SCRIPT, path.join(lone, 'paper_da.js'));
  const r = spawnSync(process.execPath, [path.join(lone, 'paper_da.js'), 'status'], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /Журналу ще немає/);
  assert.match(r.stdout, /2026-11-28 00:00 UTC/);
  assert.deepEqual(fs.readdirSync(lone), ['paper_da.js'], 'status writes nothing');
});

// ---------- the Ukrainian documents match the program ----------

test('documents: honest wording, every column, every error code, the fixed plan', () => {
  const readme = fs.readFileSync(README, 'utf8');
  const plan = fs.readFileSync(PREREG, 'utf8');
  const source = fs.readFileSync(SCRIPT, 'utf8');

  // Unmodelled costs are not played down.
  for (const [name, text] of [['README', readme], ['program', source], ['plan', plan]]) {
    assert.doesNotMatch(text, /торгівля дала б трохи інші числа|числа були б трохи іншими/, name);
    assert.match(text, /найімовірніше гірш/, name);
  }
  // Every ledger column and every error code of the program is explained in the README.
  for (const col of tool.COLUMNS) assert.ok(readme.includes('`' + col + '`'), `README explains column ${col}`);
  const codes = [...new Set(source.match(/'E_[A-Z]+'/g).map((c) => c.slice(1, -1)))];
  assert.ok(codes.length >= 15, codes.join(' '));
  for (const code of codes) assert.ok(readme.includes('`' + code + '`'), `README explains ${code}`);
  // No claim that an error never leaves anything written.
  assert.doesNotMatch(readme, /Якщо сталася помилка, програма нічого не записує\./);
  // The way back after lost rows is one documented step, not silent regeneration.
  assert.match(readme, /`E_SHRUNK`[^\n]*разом/);
  assert.match(readme, /`E_RUNLOG`[^\n]*видалено/);
  assert.match(readme, /видалити одразу і `ledger\.csv`, і `run_log\.csv`/, 'the remaining blind spot is said openly');
  assert.match(plan, /видалено одразу і журнал, і файл запусків/);
  // The exit code of an incomplete verify is documented.
  assert.match(readme, /3 — лише в команди `verify`: «ЗБІГ НЕПОВНИЙ»/);
  // A missing exchange day: what happens is said in advance, in both documents.
  assert.match(readme, /`E_GAP`[^\n]*не торгувала/);
  assert.match(plan, /не має бару за якийсь день/);
  // The README says where the rule comes from and what the row hash covers.
  assert.match(readme, /вибрано заднім числом/);
  assert.match(readme, /нічого не доводять/);
  assert.ok(readme.includes(`перші ${N_HASHED} стовпчиків через кому`));

  // The plan. First: where the rule comes from and why its history proves nothing.
  const firstSection = plan.slice(0, plan.indexOf('## Заморожене правило'));
  assert.match(firstSection, /заднім числом/);
  assert.match(firstSection, /з восьми/);
  assert.match(firstSection, /\*\*Воно не пройшло\.\*\*/);
  assert.match(firstSection, /нічого не доводять/);
  // The frozen rule, its hash and the start.
  assert.ok(plan.includes(RULE_HASH), 'plan quotes the current rule hash');
  assert.match(plan, /Перший день рішення: 2026-11-27\. Його бар закривається 2026-11-28 о 00:00 UTC/);
  assert.match(plan, /10 000 USD/);
  assert.match(plan, /0\.15%/);
  assert.match(plan, /147 закритих днів/);
  // The comparison that matters, the single verdict day, the three possible verdicts, the tie-break.
  assert.match(plan, /Важить порівняння з «лише 200-денною середньою», а не з «просто тримати»/);
  assert.match(plan, /365 записаних днів/);
  assert.match(plan, /щонайменше 6 угод «купив і продав»/);
  assert.match(plan, /за станом на перший записаний день, коли виконано обидві умови/);
  assert.match(plan, /«підтвердилося на нових днях»/);
  assert.match(plan, /«не підтвердилося»/);
  assert.match(plan, /«ще зарано»/);
  assert.match(plan, /Якщо обидва рахунки в мінусі/);
  // Honest limits and what will not be done.
  assert.match(plan, /за півтора–два роки/);
  assert.match(plan, /слабкий доказ у будь-який бік/);
  assert.match(plan, /жменьку днів/);
  assert.match(plan, /STATUS_UA\.md/);
  assert.match(plan, /не перевірялося на інших монетах/);
  assert.match(plan, /не є підставою торгувати справжніми грошима/);
  assert.match(plan, /окремим рішенням власника/);
  assert.match(plan, /## Чого НЕ буде зроблено/);
  assert.match(plan, /Жодне інше правило зі списку восьми \*\*не буде\*\* додано на папір/);
  assert.doesNotMatch(plan, /Зміну будь-якої старої цифри програма виявить\./);
  assert.match(plan, /git/);
  // The thresholds of the plan are the thresholds of the frozen rule.
  const ev = tool.FROZEN_RULE.evaluation;
  assert.ok(plan.includes(`щонайменше ${ev.min_days} записаних днів`));
  assert.ok(plan.includes(`щонайменше ${ev.min_round_trips} угод`));
});

// ---------- findings of the second review ----------

test('status: a difference below one cent is never printed as two equal numbers', async () => {
  // A flat market at 500.00; only the close of the last Sunday (2024-12-29) is a few cents away, so the
  // 20-week average is 500.00 after rounding to cents, yet not equal to the close of 2024-12-30.
  assert.equal(weekday('2024-12-29'), 0);
  const flat = (sundayClose) => {
    const bars = [];
    for (let d = '2024-06-01'; d <= '2024-12-30'; d = addDays(d, 1)) bars.push({ date: d, open: 500, close: d === '2024-12-29' ? sundayClose : 500 });
    return bars;
  };
  const build = async (sundayClose, start = '2024-12-30') => {
    const dir = tmpDir();
    const csv = writeCsv(path.join(dir, 'data.csv'), flat(sundayClose));
    const r = await run(['update', '--data', csv, '--ledger', path.join(dir, 'ledger.csv'), '--start', start]);
    assert.equal(r.code, 0, r.err);
    const rows = fs.existsSync(path.join(dir, 'ledger.csv')) ? readLedger(path.join(dir, 'ledger.csv')) : [];
    return { out: r.out, row: rows[0], status: fs.readFileSync(path.join(dir, 'STATUS_UA.md'), 'utf8') };
  };
  const sameTwice = /(вище|нижче) неї: (\S+) проти \2[. ]/;

  // Slightly above: the ledger holds 499.995500, and the status shows exactly that.
  const up = await build('499.91');
  assert.equal(up.row.sma20w, '499.995500');
  assert.equal(up.row.sma200, '499.999550');
  assert.equal(up.row.above_sma20w, '1');
  assert.ok(up.status.includes('- Середня за 20 тижнів (за тижнями до неділі 2024-12-29 включно): 499.995500 USD. BTC вище неї: 500.00 проти 499.995500. Різниця менша за цент, тому середню показано з шістьма знаками після коми, як у журналі.'), up.status);
  assert.ok(up.status.includes('- Для порівняння, середня за 200 днів: 499.999550 USD. BTC вище неї: 500.00 проти 499.999550. Різниця менша за цент'), up.status);
  assert.doesNotMatch(up.status, sameTwice);
  assert.doesNotMatch(up.status, /500\.00 проти 500\.00/);

  // Slightly below.
  const down = await build('500.09');
  assert.equal(down.row.sma20w, '500.004500');
  assert.equal(down.row.above_sma20w, '0');
  assert.ok(down.status.includes('500.004500 USD. BTC нижче неї: 500.00 проти 500.004500. Різниця менша за цент'), down.status);
  assert.ok(down.status.includes('середня за 200 днів: 500.000450 USD. BTC нижче неї: 500.00 проти 500.000450.'), down.status);
  assert.doesNotMatch(down.status, sameTwice);

  // An exact tie is the only case in which two equal numbers stand side by side, and it is said in words.
  const tie = await build('500');
  assert.equal(tie.row.sma20w, '500.000000');
  assert.equal(tie.row.above_sma20w, '0');
  assert.ok(tie.status.includes('500.00 USD. BTC рівно на ній (за правилом це «не вище»): 500.00 проти 500.00.'), tie.status);
  assert.doesNotMatch(tie.status, /Різниця менша за цент/);
  assert.doesNotMatch(tie.status, sameTwice);

  // The reference line printed before the first row follows the same rule.
  const refUp = await build('499.91', '2024-12-31');
  assert.equal(refUp.row, undefined);
  assert.match(refUp.out, /за закритим днем 2024-12-30 закриття 500\.00 було вище середньої за 20 тижнів \(499\.995500\)/);
  const refDown = await build('500.09', '2024-12-31');
  assert.match(refDown.out, /закриття 500\.00 було не вище середньої за 20 тижнів \(500\.004500\)/);
  const refTie = await build('500', '2024-12-31');
  assert.match(refTie.out, /закриття 500\.00 було не вище середньої за 20 тижнів \(500\.00\)/);

  // An ordinary day keeps cents: nothing changes in the usual wording.
  const dir = tmpDir();
  const csv = writeCsv(path.join(dir, 'data.csv'), sliceBars());
  const usual = await run(['update', ...sliceArgs(dir, csv), '--now', '2020-03-01T08:00:00Z']);
  assert.equal(usual.code, 0, usual.err);
  assert.match(usual.out, /Середня за 20 тижнів \(за тижнями до неділі 2020-02-23 включно\): 8 443\.41 USD\. BTC вище неї: 8 527\.74 проти 8 443\.41\.\n/);
  assert.match(usual.out, /середня за 200 днів: 8 748\.89 USD\. BTC нижче неї\.\n/);
  assert.doesNotMatch(usual.out, /Різниця менша за цент/);
});

test('live source: a broken Sunday close inside the 20-week average stops the tool', async () => {
  // The fake exchange is fine for every day that would be recorded (2026-05-28 … 05-31). Only one
  // Sunday far back in the history, which is never a row of this ledger, is wrong.
  for (const d of ['2026-03-01', '2026-01-11', '2026-01-04']) assert.equal(weekday(d), 0);
  const attempt = async (edit) => {
    const dir = tmpDir();
    let result;
    await withBitstamp(liveBars().map((b) => edit(b) || b), LIVE_DATE, async () => { result = await run(['update', ...liveArgs(dir)]); });
    return { ...result, dir };
  };
  const refused = (r, sunday, what) => {
    assert.equal(r.code, 1, `${what}: ${r.out}`);
    assert.ok(r.err.startsWith(`ПОМИЛКА [E_SUSPECT]: Ціни за неділю ${sunday} (її закриття входить у середню за 20 тижнів для дня 2026-05-28) виглядають неправдоподібно:`), `${what}: ${r.err}`);
    assert.match(r.err, /Це стрибок понад 20%, схоже на збій у даних біржі\. Нічого не записано\./);
    assert.deepEqual(fs.readdirSync(r.dir), [], `${what}: nothing written at all`);
  };
  // Without the damage the same run records four days.
  const clean = await attempt(() => null);
  assert.equal(clean.code, 0, clean.err);
  assert.equal(readLedger(path.join(clean.dir, 'ledger.csv')).length, 4);

  // The Sunday close ten times too high (inside its own high..low, so the bar itself looks valid):
  // unchecked, it would move the 20-week average by almost half and flip the decision.
  const tenfold = (date) => (b) => (b.date === date ? { ...b, close: b.close * 10, high: b.close * 10 } : null);
  refused(await attempt(tenfold('2026-03-01')), '2026-03-01', 'close x10');
  // The whole Sunday at half price: the jump is between the Saturday close and the Sunday open.
  const r = await attempt((b) => (b.date === '2026-03-01' ? { ...b, open: b.open / 2, high: b.high / 2, low: b.low / 2, close: b.close / 2 } : null));
  refused(r, '2026-03-01', 'half price');
  assert.match(r.err, /закриття 2026-02-28 було [\d.]+, а відкриття 2026-03-01 вже/);
  // The oldest Sunday of the average (20 weeks back from 2026-05-24) is checked as well …
  refused(await attempt(tenfold('2026-01-11')), '2026-01-11', 'oldest Sunday');
  // … and a Sunday that no recorded day uses (one week older) is not: the check covers exactly the average.
  const outside = await attempt(tenfold('2026-01-04'));
  assert.equal(outside.code, 0, outside.err);
  assert.equal(readLedger(path.join(outside.dir, 'ledger.csv')).length, 4);

  // With rows already recorded: the next day is not appended while a Sunday of its average is broken.
  const base = tmpDir();
  await withBitstamp(liveBars('2026-05-31'), 'Sun, 31 May 2026 10:00:00 GMT', async () => {
    assert.equal((await run(['update', ...liveArgs(base, '2026-05-31T10:00:05Z')])).code, 0);
  });
  const good = fs.readFileSync(path.join(base, 'ledger.csv'), 'utf8');
  assert.equal(good.trimEnd().split('\n').length, 4, 'three rows: 05-28, 05-29, 05-30');
  await withBitstamp(liveBars().map((b) => tenfold('2026-03-01')(b) || b), LIVE_DATE, async () => {
    const again = await run(['update', ...liveArgs(base)]);
    assert.equal(again.code, 1);
    assert.match(again.err, /ПОМИЛКА \[E_(SUSPECT|REVISION)\]/, 'stopped either as broken data or as a revision of recorded days');
  });
  assert.equal(fs.readFileSync(path.join(base, 'ledger.csv'), 'utf8'), good, 'nothing appended');

  // Offline test files are not subject to this check (as in the main tool): the replay of real history is unaffected.
  const offline = tmpDir();
  const csv = writeCsv(path.join(offline, 'data.csv'), liveBars().map((b) => tenfold('2026-03-01')(b) || b));
  assert.equal((await run(['update', '--data', csv, ...liveArgs(offline)])).code, 0);
});

test('the folder of the main paper ledger is recognised: this program writes nothing there', async () => {
  // A stand-in for ../paper in the one state in which nothing else would stop this program:
  // the main program is there, but its frozen_rule.json is missing.
  const mainDir = tmpDir();
  fs.writeFileSync(path.join(mainDir, 'paper_trade.js'), '// the program of the main paper ledger\n');
  fs.writeFileSync(path.join(mainDir, 'ledger.csv'), 'seq,date,open,close,sma200\n');
  fs.writeFileSync(path.join(mainDir, 'run_log.csv'), tool.RUN_LOG_HEADER + '\n');
  fs.writeFileSync(path.join(mainDir, 'STATUS_UA.md'), 'MAIN STATUS\n');
  const csv = writeCsv(path.join(tmpDir(), 'data.csv'), sliceBars());
  const before = snapshotDir(mainDir);
  const inside = (name) => path.join(mainDir, name);
  const attempts = [
    ['update', '--ledger', inside('x.csv'), '--data', csv, '--start', SLICE_START],
    ['update', '--ledger', inside('x.csv'), '--data', csv, '--start', SLICE_START, '--now', '2020-03-01T08:00:00Z'],
    ['update', '--ledger', inside('ledger.csv'), '--data', csv, '--start', SLICE_START],
    ['verify', '--ledger', inside('x.csv'), '--data', csv, '--start', SLICE_START],
    ['status', '--ledger', inside('x.csv'), '--start', SLICE_START],
    ['status', '--ledger', inside('ledger.csv')],
    ['update', '--ledger', inside('x.csv')],
    ['update', '--ledger', path.join(mainDir, 'sub', '..', 'x.csv'), '--data', csv, '--start', SLICE_START],
  ];
  // No attempt may reach the exchange either.
  const savedFetch = global.fetch;
  global.fetch = async () => { throw new Error('the exchange must not be asked'); };
  try {
    for (const args of attempts) {
      const r = await run(args);
      assert.equal(r.code, 1, args.join(' ') + '\n' + r.out + r.err);
      assert.match(r.err, /ПОМИЛКА \[E_REFUSED\].*програма іншого паперового журналу \(paper_trade\.js\)/, args.join(' '));
      assert.equal(r.out, '');
      assert.deepEqual(snapshotDir(mainDir), before, `folder untouched: ${args.join(' ')}`);
    }
  } finally { global.fetch = savedFetch; }
  // The same from a real child process.
  const cli = runCli(['update', '--ledger', inside('x.csv'), '--data', csv, '--start', SLICE_START]);
  assert.equal(cli.code, 1);
  assert.match(cli.err, /E_REFUSED/);
  assert.deepEqual(snapshotDir(mainDir), before);
  // The real folder of the main ledger, as it is today, is refused in the same way (nothing is read or written there).
  const realMain = path.join(REAL_DIR, '..', 'paper');
  if (fs.existsSync(path.join(realMain, 'paper_trade.js'))) {
    const names = fs.readdirSync(realMain).sort();
    const r = await run(['status', '--ledger', path.join(realMain, 'x.csv')]);
    assert.equal(r.code, 1);
    assert.match(r.err, /ПОМИЛКА \[E_REFUSED\]/);
    assert.deepEqual(fs.readdirSync(realMain).sort(), names);
  }
  // An ordinary folder next to it is still fine for test runs.
  const lab = tmpDir();
  assert.equal((await run(['update', ...sliceArgs(lab, csv)])).code, 0);
});

test('documents: the clarifications made before the first row', () => {
  const read = (...parts) => fs.readFileSync(path.join(REAL_DIR, ...parts), 'utf8');
  const plan = read('..', 'PREREGISTRATION_PAPER_DA.md'), readme = read('README_UA.md');
  const mainReadme = read('..', 'paper', 'README_UA.md'), topReadme = read('..', 'README_UA.md');
  const firstSection = plan.slice(0, plan.indexOf('## Заморожене правило'));

  // Where the rule comes from: DC was as good or better on the first criterion, and the reader is told.
  assert.match(firstSection, /найкращим за дохідністю і за відношенням дохідності до просадки/);
  assert.match(firstSection, /Споріднене правило DC[^\n]*мало трохи меншу просадку \(−60\.7%\)[^\n]*0\.99 проти 0\.85/);
  assert.match(firstSection, /вибір саме DA[^\n]*теж вибір заднім числом/);
  // The day-for-day match is claimed only for the history that the test covers.
  assert.match(plan, /На закритій історії від 2016 року програма журналу дає той самий сигнал день у день/);
  assert.doesNotMatch(plan, /На закритій історії програма журналу дає/);
  assert.match(readme, /на закритій історії від 2016 року/);
  // How long the wait is: no single optimistic figure.
  assert.doesNotMatch(plan, /приблизно за півтора року/);
  assert.doesNotMatch(readme, /приблизно півтора року/);
  assert.match(plan, /найімовірніше, за півтора–два роки/);
  assert.match(plan, /понад три роки \(до 1186 днів\)/);
  assert.match(plan, /майже в чотирьох випадках із десяти — пізніше ніж за два роки/);
  assert.match(readme, /найчастіше від півтора до двох років[^\n]*понад два роки, інколи понад три/);
  // The 20% check covers the Sundays of the average, in the plan and in the README.
  assert.match(plan, /для кожної з 20 неділь, закриття яких входять у середню за 20 тижнів/);
  assert.match(readme, /`E_SUSPECT`[^\n]*кожна з 20 неділь/);
  assert.match(readme, /`E_REFUSED`[^\n]*paper_trade\.js/);
  assert.match(readme, /відрізняються менш ніж на цент, середню показано з шістьма знаками після коми/);
  // The dated note is the last section of the plan, says that no row existed, and that the rule is the same.
  const note = plan.slice(plan.lastIndexOf('\n## '));
  assert.match(note, /^\n## Уточнення від 2026-11-27, до першого рядка журналу\n/);
  assert.match(note, /не було жодного рядка/);
  assert.match(note, /відбиток правила не змінилися/);
  for (const topic of ['Звідки правило', 'Збіг з історією', 'Стрибок понад 20%', 'Скільки чекати', 'Збереження на GitHub', 'Файл стану', 'Чужа тека']) assert.ok(note.includes(`- **${topic}.**`), topic);
  assert.ok(plan.includes(RULE_HASH), 'the hash quoted in the plan is still the hash of the program');

  // Saving to GitHub: only after the plan, the rule file and the program are in git; said in all three places.
  assert.match(note, /лише тоді, коли цей план, файл `paper_da\/frozen_rule\.json` і програма вже збережені в git/);
  assert.match(readme, /лише тоді, коли план `\.\.\/PREREGISTRATION_PAPER_DA\.md`, файл `frozen_rule\.json` і програма `paper_da\.js` уже збережені в git/);
  // The paragraph added to the main README no longer contradicts the older sentence below it.
  const para = mainReadme.split(/\r?\n/).find((l) => l.startsWith('**Другий журнал.**'));
  assert.ok(para, 'the added paragraph is one line');
  assert.match(para, /збій в одному не заважає зберегти інший/);
  assert.match(para, /слова «на GitHub нічого не надсилається» нижче стосуються лише того журналу, в якому сталася помилка/);
  assert.match(para, /тільки після того, як у git уже збережено його план, файл `frozen_rule\.json` і програму/);
  assert.equal(mainReadme.split('**Другий журнал.**').length, 2, 'still one added paragraph');
  // The folder table of the top README: one line, and it says that the ledger runs daily and how to update it by hand.
  const rows = topReadme.split(/\r?\n/).filter((l) => l.startsWith('| `paper_da/` |'));
  assert.equal(rows.length, 1);
  assert.match(rows[0], /нічого не доводять/);
  assert.match(rows[0], /тим самим щоденним запуском/);
  assert.match(rows[0], /`paper_da\/update\.cmd`/);
});

// ---------- the daily runner that serves both ledgers ----------

// "node --test <this directory>" runs this file only (see "main" in package.json), so the checks
// of ../paper/auto_update.js are loaded from here. They use a fake command runner: no update is
// started, nothing is fetched and no git command is executed.
require('./auto_update.checks.js');
