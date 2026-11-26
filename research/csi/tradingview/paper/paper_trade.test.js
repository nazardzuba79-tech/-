'use strict';
// Tests for paper_trade.js. Run: node --test <this directory>
// Everything is offline (--data) and writes only to the OS temp directory.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const tool = require('./paper_trade.js');
const SCRIPT = path.join(__dirname, 'paper_trade.js');
const EXPORT = path.join(__dirname, '..', 'exports', 'btcusd_bitstamp_1d_20261126.csv');
const COST = 0.0015;
const DAY_MS = 86400000;

// ---------- helpers ----------

const tmpDirs = [];
function tmpDir() {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'csi-paper-test-'));
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
    cells[19] = prev;
    cells[20] = tool.sha256(prev + '|' + cells.slice(0, 19).join(','));
    prev = cells[20];
    return cells.join(',');
  });
  fs.writeFileSync(file, [lines[0], ...rows].join('\n') + '\n');
}

// A small slice of real data with many trades: start 2020-01-20, trades on 01-29, 02-27, 02-28, 02-29, 03-03, 03-09.
const SLICE_START = '2020-01-20';
const SLICE_END = '2020-03-20';
const sliceBars = (to = SLICE_END) => exportBars().filter((b) => b.date >= '2019-01-01' && b.date <= to);
const sliceArgs = (dir, csv) => ['--data', csv, '--ledger', path.join(dir, 'ledger.csv'), '--start', SLICE_START];

// ---------- the frozen rule ----------

test('frozen rule: values and hash are pinned', () => {
  const r = tool.FROZEN_RULE;
  assert.equal(r.start_date, '2026-11-26');
  assert.equal(r.start_equity_usd, 10000);
  assert.equal(r.cost_per_position_change, 0.0015);
  assert.deepEqual([r.sma_trend, r.sma_fast, r.sma_slow, r.overheat_multiplier], [200, 111, 350, 2]);
  // If this fails, the rule was edited. A frozen rule must not change.
  assert.equal(tool.makeRule().hash, '55ab30e29356d6621f1e68551325190945c1d622760cec217960fab2477dee33');
  assert.equal(tool.sha256(tool.canonicalJson({ b: 1, a: [2, { d: 3, c: 4 }] })), tool.sha256('{"a":[2,{"c":4,"d":3}],"b":1}'));
});

test('decide: regime formula and missing averages', () => {
  assert.equal(tool.decide(100, null, 90, 80), null, 'no SMA200 means no decision');
  assert.deepEqual(tool.decide(100, 90, 500, null), { trendUp: true, overheated: false, regimeUp: true }, 'no SMA350 means not overheated');
  assert.deepEqual(tool.decide(100, 90, 201, 100), { trendUp: true, overheated: true, regimeUp: false });
  assert.deepEqual(tool.decide(100, 90, 200, 100), { trendUp: true, overheated: false, regimeUp: true }, 'strictly greater');
  assert.deepEqual(tool.decide(90, 90, 100, 100), { trendUp: false, overheated: false, regimeUp: false }, 'strictly greater');
});

// ---------- (1) replay against an independent re-computation ----------

test('(1) replay from 2016-01-01 matches an independent re-computation', () => {
  const dir = tmpDir();
  const ledgerFile = path.join(dir, 'ledger.csv');
  const args = ['--data', EXPORT, '--ledger', ledgerFile, '--start', '2016-01-01', '--now', '2026-11-26T18:00:00Z'];
  const res = runCli(['update', ...args]);
  assert.equal(res.code, 0, res.err);
  const rows = readLedger(ledgerFile);

  // Independent re-computation: plain averages over the last N bars, equity built per trade
  // (entry open to exit open), not per day as the tool does.
  const bars = exportBars().filter((b) => b.date <= '2026-11-25');
  const i0 = bars.findIndex((b) => b.date === '2016-01-01');
  const mean = (i, n) => { let s = 0; for (let k = i - n + 1; k <= i; k++) s += bars[k].close; return s / n; };
  function simulate(useOverheat, alwaysIn) {
    let realized = 10000, entryOpen = null, held = 0, target = 0;
    const out = [];
    for (let i = i0; i < bars.length; i++) {
      const b = bars[i];
      let trade = '';
      if (target !== held) {
        if (target) { realized *= 1 - COST; entryOpen = b.open; trade = 'BUY'; } else { realized *= (b.open / entryOpen) * (1 - COST); trade = 'SELL'; }
        held = target;
      }
      const up = b.close > mean(i, 200), hot = mean(i, 111) > 2 * mean(i, 350);
      out.push({ date: b.date, held, trade, equity: held ? realized * b.close / entryOpen : realized, up, hot });
      target = alwaysIn ? 1 : up && !(useOverheat && hot) ? 1 : 0;
    }
    return out;
  }
  const strat = simulate(true, false), only200 = simulate(false, false), hold = simulate(false, true);

  assert.equal(rows.length, strat.length);
  assert.equal(rows.length, 3982);
  assert.equal(rows[rows.length - 1].date, '2026-11-25');
  const near = (a, b, what) => assert.ok(Math.abs(a - b) <= 1e-6 * Math.abs(b), `${what}: ${a} vs ${b}`);
  rows.forEach((r, i) => {
    const e = strat[i];
    assert.equal(r.seq, String(i + 1));
    assert.equal(r.date, e.date);
    assert.equal(r.regime_up, e.up && !e.hot ? '1' : '0', `regime ${r.date}`);
    assert.equal(r.overheated, e.hot ? '1' : '0', `overheated ${r.date}`);
    assert.equal(r.target_next, r.regime_up);
    assert.equal(r.pos_held, String(e.held), `position ${r.date}`);
    assert.equal(r.trade, e.trade, `trade ${r.date}`);
    assert.equal(r.pos_200d_only, String(only200[i].held), `200D position ${r.date}`);
    near(Number(r.equity), e.equity, `equity ${r.date}`);
    near(Number(r.equity_hold), hold[i].equity, `hold ${r.date}`);
    near(Number(r.equity_200d_only), only200[i].equity, `200D ${r.date}`);
  });

  // Anchors known from the earlier study: Pi Cycle crosses and the first trades.
  const byDate = Object.fromEntries(rows.map((r) => [r.date, r]));
  for (const d of ['2017-12-16', '2021-04-12']) {
    assert.equal(byDate[d].overheated, '1', d);
    assert.equal(byDate[addDays(d, -1)].overheated, '0', d);
  }
  const trades = rows.filter((r) => r.trade).map((r) => `${r.date} ${r.trade}`);
  assert.equal(trades.length, 72);
  assert.deepEqual(trades.slice(0, 4), ['2016-01-02 BUY', '2017-12-17 SELL', '2018-03-05 BUY', '2018-03-11 SELL']);
  // The strategy and "200D only" differ, so the overheating term really is exercised.
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
  assert.match(status, /тренд униз/);
  assert.match(status, /Завершених угод «купив і продав»: 36/);
});

// ---------- (2) no lookahead ----------

test('(2) no lookahead: truncated data gives a byte-identical prefix', async () => {
  const K = '2020-02-28';
  const full = tmpDir(), cut = tmpDir(), bent = tmpDir(), clock = tmpDir();
  const fullCsv = writeCsv(path.join(full, 'data.csv'), sliceBars());
  const cutCsv = writeCsv(path.join(cut, 'data.csv'), sliceBars(K));
  // Same history up to K, completely different future.
  const bentCsv = writeCsv(path.join(bent, 'data.csv'), sliceBars().map((b) => (b.date > K ? { ...b, open: b.open * 3, close: b.close / 2 } : b)));

  assert.equal((await run(['update', ...sliceArgs(full, fullCsv)])).code, 0);
  assert.equal((await run(['update', ...sliceArgs(cut, cutCsv)])).code, 0);
  assert.equal((await run(['update', ...sliceArgs(bent, bentCsv)])).code, 0);
  assert.equal((await run(['update', ...sliceArgs(clock, fullCsv), '--now', addDays(K, 1) + 'T00:00:00Z'])).code, 0);

  const a = fs.readFileSync(path.join(full, 'ledger.csv'), 'utf8');
  const b = fs.readFileSync(path.join(cut, 'ledger.csv'), 'utf8');
  const c = fs.readFileSync(path.join(bent, 'ledger.csv'), 'utf8');
  const d = fs.readFileSync(path.join(clock, 'ledger.csv'), 'utf8');
  assert.ok(b.endsWith(`\n`) && b.split('\n').length - 2 === 40, 'truncated ledger has 40 rows');
  assert.ok(a.length > b.length && a.startsWith(b), 'truncated file is a prefix of the full one');
  assert.ok(c.startsWith(b), 'a different future does not change the past');
  assert.notEqual(a, c);
  assert.equal(d, b, 'cutting by clock equals cutting the file');
});

// ---------- (3) catch-up equals daily, (4) idempotency ----------

test('(3) catch-up after a long pause equals running every day', async () => {
  const daily = tmpDir(), once = tmpDir(), sparse = tmpDir();
  const csv = writeCsv(path.join(daily, 'data.csv'), sliceBars());
  const nowAfter = (date) => addDays(date, 1) + 'T00:05:00Z';

  for (let d = SLICE_START; d <= SLICE_END; d = addDays(d, 1)) {
    const r = await run(['update', ...sliceArgs(daily, csv), '--now', nowAfter(d)]);
    assert.equal(r.code, 0, r.err);
  }
  assert.equal((await run(['update', ...sliceArgs(once, csv), '--now', nowAfter(SLICE_END)])).code, 0);
  for (const d of ['2020-01-19', '2020-01-22', '2020-02-28', '2020-02-29', SLICE_END]) {
    assert.equal((await run(['update', ...sliceArgs(sparse, csv), '--now', nowAfter(d)])).code, 0);
  }
  const a = fs.readFileSync(path.join(daily, 'ledger.csv'), 'utf8');
  assert.equal(fs.readFileSync(path.join(once, 'ledger.csv'), 'utf8'), a);
  assert.equal(fs.readFileSync(path.join(sparse, 'ledger.csv'), 'utf8'), a);

  const rows = readLedger(path.join(daily, 'ledger.csv'));
  assert.equal(rows.length, 61);
  assert.deepEqual(rows.filter((r) => r.trade).map((r) => `${r.date} ${r.trade}`),
    ['2020-01-29 BUY', '2020-02-27 SELL', '2020-02-28 BUY', '2020-02-29 SELL', '2020-03-03 BUY', '2020-03-09 SELL']);
  // The run log (not hashed) has one line per run.
  assert.equal(fs.readFileSync(path.join(daily, 'run_log.csv'), 'utf8').trim().split('\n').length, 62);
});

test('(4) idempotent: a second update appends nothing', () => {
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

// ---------- (5) tamper detection ----------

test('(5) tampering with any earlier cell makes update and verify fail', async () => {
  const dir = tmpDir();
  const ledgerFile = path.join(dir, 'ledger.csv');
  const csvShort = writeCsv(path.join(dir, 'short.csv'), sliceBars('2020-03-10'));
  const csvFull = writeCsv(path.join(dir, 'data.csv'), sliceBars());
  assert.equal((await run(['update', ...sliceArgs(dir, csvShort)])).code, 0);
  const good = fs.readFileSync(ledgerFile, 'utf8');
  const lines = good.trimEnd().split('\n');
  const TARGET = 41; // file line of the 2020-02-29 row (a SELL day), far from the end

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
  assert.equal(cells[1], '2020-02-29');
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
  fs.writeFileSync(ledgerFile, good);
  rechain(ledgerFile, (c, i) => { if (i === 30) c[13] = (Number(c[13]) + 500).toFixed(6); });
  for (const cmd of ['update', 'verify']) {
    const r = await run([cmd, ...sliceArgs(dir, csvFull)]);
    assert.equal(r.code, 1);
    assert.match(r.err, /ПОМИЛКА \[E_MISMATCH\].*equity/);
  }

  // The untouched ledger still works.
  fs.writeFileSync(ledgerFile, good);
  assert.equal((await run(['verify', ...sliceArgs(dir, csvFull)])).code, 0);
  assert.equal((await run(['update', ...sliceArgs(dir, csvFull)])).code, 0);
  assert.ok(fs.readFileSync(ledgerFile, 'utf8').startsWith(good));
});

// ---------- (6) rule hash mismatch ----------

test('(6) a ledger kept under a different rule is refused', async () => {
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
  rechain(ledgerFile, (c) => { c[18] = tool.sha256('some other rule'); });
  const forged = fs.readFileSync(ledgerFile, 'utf8');
  for (const cmd of ['update', 'verify']) {
    const r = await run([cmd, ...sliceArgs(dir, csvFull)]);
    assert.equal(r.code, 1);
    assert.match(r.err, /ПОМИЛКА \[E_RULE\]/);
  }
  assert.equal(fs.readFileSync(ledgerFile, 'utf8'), forged, 'nothing appended');
  assert.notEqual(forged, good);
});

// ---------- (7) data revision ----------

test('(7) revised history is reported and never rewritten', async () => {
  const dir = tmpDir();
  const ledgerFile = path.join(dir, 'ledger.csv');
  const csvShort = writeCsv(path.join(dir, 'short.csv'), sliceBars('2020-03-10'));
  assert.equal((await run(['update', ...sliceArgs(dir, csvShort)])).code, 0);
  const good = fs.readFileSync(ledgerFile, 'utf8');
  const revised = (date, field, factor) => writeCsv(path.join(dir, 'rev.csv'),
    sliceBars().map((b) => (b.date === date ? { ...b, [field]: Math.round(b[field] * factor * 100) / 100 } : b)));

  for (const [date, field, factor, shown] of [['2020-02-10', 'close', 1.001, '2020-02-10'], ['2020-02-11', 'open', 0.999, '2020-02-11'],
    ['2019-12-01', 'close', 1.5, SLICE_START]]) { // a big change before the start shifts the recorded averages
    const csv = revised(date, field, factor);
    for (const cmd of ['update', 'verify']) {
      const r = await run([cmd, ...sliceArgs(dir, csv)]);
      assert.equal(r.code, 1, `${cmd} ${date}`);
      assert.match(r.err, /ПОМИЛКА \[E_REVISION\]: Перегляд даних/);
      assert.ok(r.err.includes(shown), r.err);
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

// ---------- (8) unclosed bar ----------

test('(8) the unclosed last bar is ignored', async () => {
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

  // Before the first day closes: header-only ledger and a "waiting" status.
  const early = tmpDir();
  const r = await run(['update', ...sliceArgs(early, csv), '--now', '2020-01-20T18:30:00Z']);
  assert.equal(r.code, 0, r.err);
  assert.equal(fs.readFileSync(path.join(early, 'ledger.csv'), 'utf8'), tool.HEADER + '\n');
  assert.match(fs.readFileSync(path.join(early, 'STATUS_UA.md'), 'utf8'), /Записів ще немає[\s\S]*2020-01-21 00:00 UTC/);
  const ver = await run(['verify', ...sliceArgs(early, csv), '--now', '2020-01-20T18:30:00Z']);
  assert.equal(ver.code, 0);
  assert.match(ver.out, /^OK\./);
});

// ---------- (9) gaps, duplicates, short history ----------

test('(9) a missing or duplicated day stops the tool', async () => {
  const cases = [
    ['E_GAP', 'gap before the start', sliceBars().filter((b) => b.date !== '2019-06-15'), '2019-06-15'],
    ['E_GAP', 'gap after the start', sliceBars().filter((b) => b.date !== '2020-02-15'), '2020-02-15'],
    ['E_DUPLICATE', 'duplicate before the start', sliceBars().flatMap((b) => (b.date === '2019-06-15' ? [b, b] : [b])), '2019-06-15'],
    ['E_DUPLICATE', 'duplicate after the start', sliceBars().flatMap((b) => (b.date === '2020-02-15' ? [b, { ...b, close: b.close + 1 }] : [b])), '2020-02-15'],
    ['E_HISTORY', 'fewer than 350 closed bars', sliceBars().filter((b) => b.date >= '2019-02-06'), ''],
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
  // Exactly 350 closed bars up to the start day is enough.
  const dir = tmpDir();
  const csv = writeCsv(path.join(dir, 'data.csv'), sliceBars().filter((b) => b.date >= '2019-02-05'));
  assert.equal((await run(['update', ...sliceArgs(dir, csv)])).code, 0);

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

// ---------- (10) hand-computed accounting ----------

// Synthetic series: 349 flat days before the start, then the listed days.
function synthetic(dir, pre, days) {
  const start = '2020-01-01';
  const bars = pre.map((p, i) => ({ date: addDays(start, i - pre.length), open: p, close: p }))
    .concat(days.map(([open, close], i) => ({ date: addDays(start, i), open, close })));
  return ['--data', writeCsv(path.join(dir, 'data.csv'), bars), '--ledger', path.join(dir, 'ledger.csv'), '--start', start];
}

test('(10) entry, continuing, exit and flat days on a hand-computed series', async () => {
  const dir = tmpDir();
  const args = synthetic(dir, new Array(349).fill(100), [[100, 100], [100, 120], [125, 150], [150, 165], [160, 90], [80, 85], [85, 85]]);
  const r = await run(['update', ...args]);
  assert.equal(r.code, 0, r.err);
  const rows = readLedger(path.join(dir, 'ledger.csv'));
  const pick = (row) => [row.date, row.sma200, row.regime_up, row.pos_held, row.trade, row.cost_usd, row.target_next, row.equity, row.equity_hold, row.equity_200d_only, row.pos_200d_only].join(' ');
  // All numbers below are worked out by hand from the specification.
  assert.deepEqual(rows.map(pick), [
    // day 1: flat, close 100 is not above the 200D average 100 -> stay in cash
    '2020-01-01 100.000000 0 0  0.000000 0 10000.000000 10000.000000 10000.000000 0',
    // day 2: still cash; 200D = (199*100+120)/200 = 100.1 -> decide to buy. Hold enters: 10000*0.9985*120/100
    '2020-01-02 100.100000 1 0  0.000000 1 10000.000000 11982.000000 10000.000000 0',
    // day 3 (entry): cost 15, then 9985*150/125 = 11982. Hold: 11982*150/120
    '2020-01-03 100.350000 1 1 BUY 15.000000 1 11982.000000 14977.500000 11982.000000 1',
    // day 4 (continuing): 11982*165/150 = 13180.2. Hold: 14977.5*165/150
    '2020-01-04 100.675000 1 1  0.000000 1 13180.200000 16475.250000 13180.200000 1',
    // day 5 (continuing, close to close, the open 160 does not matter): 13180.2*90/165 = 7189.2 -> decide to sell
    '2020-01-05 100.625000 0 1  0.000000 0 7189.200000 8986.500000 7189.200000 1',
    // day 6 (exit at open 80): 7189.2*80/90 = 6390.4, cost 9.5856, left 6380.8144. Hold: 8986.5*85/90
    '2020-01-06 100.550000 0 0 SELL 9.585600 0 6380.814400 8487.250000 6380.814400 0',
    // day 7 (flat): unchanged
    '2020-01-07 100.475000 0 0  0.000000 0 6380.814400 8487.250000 6380.814400 0',
  ]);
  assert.equal(rows[1].sma111, (11120 / 111).toFixed(6));
  assert.equal(rows[1].sma350, (35020 / 350).toFixed(6));
  assert.equal(rows[0].prev_row_sha256, 'GENESIS');
  assert.equal(rows[0].data_source, tool.SOURCE_TEST);
  rows.forEach((row, i) => {
    const cells = tool.COLUMNS.map((c) => row[c]);
    assert.equal(row.row_sha256, tool.sha256(row.prev_row_sha256 + '|' + cells.slice(0, 19).join(',')));
    if (i) assert.equal(row.prev_row_sha256, rows[i - 1].row_sha256);
  });
  assert.equal((await run(['verify', ...args])).code, 0);
});

test('(10b) overheating keeps the strategy in cash while "200D only" buys', async () => {
  const dir = tmpDir();
  // 239 days at 100, then 110 days at 1000, then the paper days.
  const pre = new Array(239).fill(100).concat(new Array(110).fill(1000));
  const args = synthetic(dir, pre, [[1000, 1000], [1000, 1100], [1100, 1100]]);
  assert.equal((await run(['update', ...args])).code, 0);
  const rows = readLedger(path.join(dir, 'ledger.csv'));
  const pick = (row) => [row.sma200, row.sma111, row.sma350, row.regime_up, row.overheated, row.pos_held, row.trade, row.equity, row.equity_200d_only, row.pos_200d_only].join(' ');
  assert.deepEqual(rows.map(pick), [
    // 111D = 1000 > 2 * 350D = 2 * 134900/350 -> overheated, although close 1000 > 200D 599.5
    `599.500000 1000.000000 ${(134900 / 350).toFixed(6)} 0 1 0  10000.000000 10000.000000 0`,
    // "200D only" enters at the open: 9985 * 1100/1000.
    // 200D = (88*100 + 111*1000 + 1100)/200, 111D = (110*1000 + 1100)/111, 350D = (238*100 + 111*1000 + 1100)/350
    `${(120900 / 200).toFixed(6)} ${(111100 / 111).toFixed(6)} ${(135900 / 350).toFixed(6)} 0 1 0  10000.000000 10983.500000 1`,
    // 200D = (87*100 + 111*1000 + 2*1100)/200, and so on
    `${(121900 / 200).toFixed(6)} ${(111200 / 111).toFixed(6)} ${(136900 / 350).toFixed(6)} 0 1 0  10000.000000 10983.500000 1`,
  ]);
  const status = fs.readFileSync(path.join(dir, 'STATUS_UA.md'), 'utf8');
  assert.match(status, /Режим ринку за цим днем: перегрів/);
  assert.match(status, /тримає: долари/);
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
  assert.match(fresh.out, /Останній закритий день у журналі: 2020-02-29/);
  assert.match(fresh.out, /Днів від старту \(2020-01-20\): 41/);
  assert.match(fresh.out, /Угод за правилом: 4 \(купівель 2, продажів 2\)/);
  assert.match(fresh.out, /Ще зарано для висновків/);
  assert.match(fresh.out, /Останній запуск оновлення: 2020-03-01 08:00 UTC/);
  assert.doesNotMatch(fresh.out, /Дані застаріли/);
  assert.match(fresh.out, /Просто тримати BTC/);
  assert.match(fresh.out, /Лише 200-денна середня/);

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
// Tests added after the review of the tool. Same rules: offline, temp directory only.
// =====================================================================================

const REAL_DIR = __dirname;
const README = path.join(REAL_DIR, 'README_UA.md');
const PREREG = path.join(REAL_DIR, '..', 'PREREGISTRATION_PAPER.md');
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

// A stand-in for the real folder: a temp copy of the program with an empty real ledger.
function toolCopy() {
  const dir = tmpDir();
  fs.copyFileSync(SCRIPT, path.join(dir, 'paper_trade.js'));
  fs.writeFileSync(path.join(dir, 'ledger.csv'), tool.HEADER + '\n');
  fs.writeFileSync(path.join(dir, 'frozen_rule.json'), tool.makeRule().json);
  fs.writeFileSync(path.join(dir, 'STATUS_UA.md'), 'REAL STATUS\n');
  fs.writeFileSync(path.join(dir, 'run_log.csv'), tool.RUN_LOG_HEADER + '\n');
  return dir;
}
const snapshotDir = (dir) => Object.fromEntries(fs.readdirSync(dir).sort().map((f) => [f, fs.readFileSync(path.join(dir, f), 'utf8')]));
const runCopy = (dir, args) => {
  const r = spawnSync(process.execPath, [path.join(dir, 'paper_trade.js'), ...args], { encoding: 'utf8' });
  return { code: r.status, out: r.stdout, err: r.stderr };
};

// ---------- test options can never write into the folder of the program ----------

test('test options cannot write anything into the folder of the program', async () => {
  const real = toolCopy();
  const outside = tmpDir();
  const csv = writeCsv(path.join(outside, 'doctored.csv'), exportBars().map((b) => (b.date === '2026-11-26' ? { ...b, open: b.open * 3, close: b.close * 3 } : b)));
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
  const ownFiles = () => ['ledger.csv', 'run_log.csv', 'STATUS_UA.md', 'frozen_rule.json'].map((f) => fs.readFileSync(path.join(REAL_DIR, f), 'utf8'));
  const ownBefore = ownFiles();
  for (const args of [['update', '--ledger', inside('scratch.csv'), '--data', csv], ['update', '--ledger', inside('ledger.csv'), '--data', csv],
    ['update', '--ledger', inside('ledger.csv')], ['verify', '--ledger', inside('ledger.csv')], ['status', '--ledger', inside('ledger.csv')]]) {
    const r = await run(args);
    assert.equal(r.code, 1, args.join(' ') + r.out);
    assert.match(r.err, /ПОМИЛКА \[E_REFUSED\].*копія цієї програми/);
    assert.equal(r.out, '');
    assert.deepEqual(snapshotDir(real), before);
  }
  assert.deepEqual(ownFiles(), ownBefore, 'the folder of the running program is untouched as well');

  // A real ledger that somehow got a row made from a test file is refused by every command.
  const lab = tmpDir();
  assert.equal((await run(['update', '--ledger', path.join(lab, 'ledger.csv'), '--data', csv])).code, 0);
  const planted = fs.readFileSync(path.join(lab, 'ledger.csv'), 'utf8');
  assert.equal(planted.trimEnd().split('\n').length, 2, 'one row built with the frozen start date');
  assert.ok(planted.includes(tool.SOURCE_TEST));
  fs.writeFileSync(inside('ledger.csv'), planted);
  const st = runCopy(real, ['status']);
  assert.equal(st.code, 1, st.out);
  assert.match(st.err, /ПОМИЛКА \[E_SOURCE\]/);
  assert.doesNotMatch(st.out, /181/);
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
  // The real status (no test options, live source) has no such line.
  const real = fs.readFileSync(path.join(REAL_DIR, 'STATUS_UA.md'), 'utf8');
  assert.doesNotMatch(real, /ТЕСТОВИЙ/);
});

// ---------- differences inside the 0.05% tolerance ----------

// 349 flat days at 100, then the listed paper days.
const flat349 = new Array(349).fill(100);

test('a price difference inside the tolerance that flips a decision is a data revision', async () => {
  const dir = tmpDir();
  // Day 1: close 100.03 against a 200D average of 100.00015 -> "hold BTC".
  const honest = synthetic(dir, flat349, [[100, 100.03], [100.03, 110], [110, 112]]);
  assert.equal((await run(['update', ...honest])).code, 0);
  const ledgerFile = path.join(dir, 'ledger.csv');
  const good = fs.readFileSync(ledgerFile, 'utf8');
  assert.deepEqual(readLedger(ledgerFile).map((r) => r.regime_up + r.trade), ['1', '1BUY', '1']);

  // (a) The source now says 99.99 for day 1 (0.04% lower): the decision of that day would be "cash".
  const other = tmpDir();
  const revised = synthetic(other, flat349, [[100, 99.99], [100.03, 110], [110, 112], [112, 113]]);
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
    const inp = { date: r.date, open: r.open, close: i === 0 ? 99.99 : r.close, sma200: r.sma200, sma111: r.sma111, sma350: r.sma350 };
    prev = tool.deriveRow(prev, inp, ctx);
    return prev.line;
  });
  const forgedDir = tmpDir();
  const forgedFile = path.join(forgedDir, 'ledger.csv');
  fs.writeFileSync(forgedFile, [tool.HEADER, ...forged].join('\n') + '\n');
  fs.writeFileSync(path.join(forgedDir, 'run_log.csv'), tool.RUN_LOG_HEADER + '\n'); // a forger writes this file too
  assert.deepEqual(readLedger(forgedFile).map((r) => r.regime_up + r.trade), ['0', '1', '1BUY'], 'a different trade history');
  const status = await run(['status', '--ledger', forgedFile, '--start', '2020-01-01']);
  assert.equal(status.code, 0, 'chain and arithmetic of the forgery are valid: ' + status.err);
  for (const cmd of ['verify', 'update']) {
    const r = await run([cmd, '--data', honest[1], '--ledger', forgedFile, '--start', '2020-01-01']);
    assert.equal(r.code, 1, cmd + r.out);
    assert.match(r.err, /ПОМИЛКА \[E_REVISION\]: Перегляд даних за 2020-01-01/);
    assert.doesNotMatch(r.out, /OK/);
  }

  // (c) Same for the "200D only" benchmark while the rule itself is overheated either way.
  const hot = new Array(239).fill(100).concat(new Array(110).fill(1000));
  const dirC = tmpDir(), dirD = tmpDir();
  // 200D average after day 1 is (89*100 + 110*1000 + close)/200, so the close is above its own average only when
  // it is above 118900/199 = 597.487: 597.60 is just above, 597.40 (0.03% lower) just below.
  const up = synthetic(dirC, hot, [[1000, 597.6], [597.6, 600]]);
  const down = synthetic(dirD, hot, [[1000, 597.4], [597.6, 600]]);
  assert.equal((await run(['update', ...up])).code, 0);
  const rowsC = readLedger(path.join(dirC, 'ledger.csv'));
  assert.deepEqual([rowsC[0].regime_up, rowsC[0].overheated, rowsC[1].pos_200d_only], ['0', '1', '1']);
  const r = await run(['verify', '--data', down[1], '--ledger', path.join(dirC, 'ledger.csv'), '--start', '2020-01-01']);
  assert.equal(r.code, 1, r.out);
  assert.match(r.err, /ПОМИЛКА \[E_REVISION\].*лише 200-денна середня/);
});

test('recorded prices that differ from the source inside the tolerance never give a bare OK', async () => {
  const dir = tmpDir(), other = tmpDir();
  // The ledger was written with a BUY at 100.96; the source says 101.00 (0.04% higher).
  const shaded = synthetic(dir, flat349, [[100, 101], [100.96, 110], [110, 112]]);
  const source = synthetic(other, flat349, [[100, 101], [101, 110], [110, 112], [112, 113]]);
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

  // update goes on (the difference is inside the tolerance) but names the day, also in the status file.
  const upd = await run(['update', ...args]);
  assert.equal(upd.code, 0, upd.err);
  assert.match(upd.out, /2020-01-02: open у журналі 100\.96, зараз 101\.00/);
  const after = fs.readFileSync(ledgerFile, 'utf8');
  assert.ok(after.startsWith(good) && after.length > good.length, 'old rows untouched, one day appended');
  assert.match(fs.readFileSync(path.join(dir, 'STATUS_UA.md'), 'utf8'), /## Попередження[\s\S]*біржа тепер показує трохи інші ціни, ніж у журналі \(2020-01-02\)/);

  // With identical data the plain OK is there.
  const dir2 = tmpDir();
  const same = synthetic(dir2, flat349, [[100, 101], [100.96, 110], [110, 112]]);
  assert.equal((await run(['update', ...same])).code, 0);
  const clean = await run(['verify', ...same]);
  assert.equal(clean.code, 0);
  assert.match(clean.out, /^OK\. Перевірено 3 записів/);

  // The reviewers' forgery on real prices: every BUY recorded 0.04% cheaper, every SELL 0.04% dearer,
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
    prev = tool.deriveRow(prev, { date: r.date, open: Number((r.open * k).toFixed(2)), close: r.close, sma200: r.sma200, sma111: r.sma111, sma350: r.sma350 }, ctx);
    return prev;
  });
  assert.deepEqual(forged.map((r) => r.trade), honestRows.map((r) => r.trade), 'the same trades, only better prices');
  assert.ok(forged[forged.length - 1].equity > honestRows[honestRows.length - 1].equity * 1.01, 'the forgery is worth more than 1%');
  fs.writeFileSync(path.join(forgedDir, 'ledger.csv'), [tool.HEADER, ...forged.map((r) => r.line)].join('\n') + '\n');
  fs.writeFileSync(path.join(forgedDir, 'run_log.csv'), tool.RUN_LOG_HEADER + '\n');
  const shadedVer = await run(['verify', '--ledger', path.join(forgedDir, 'ledger.csv'), ...real]);
  assert.equal(shadedVer.code, 3, shadedVer.err);
  assert.doesNotMatch(shadedVer.out, /^OK/m);
  assert.match(shadedVer.out, /^ЗБІГ НЕПОВНИЙ/);
  const trades = honestRows.filter((r) => r.trade);
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
    const ver = await run(['verify', ...liveArgs(dir)]);
    assert.equal(ver.code, 0, ver.err);
    assert.match(ver.out, /^OK\. Перевірено 4 записів/);
    const again = await run(['update', ...liveArgs(dir)]);
    assert.match(again.out, /нічого не додано/);
  });
  // Paging: history longer than one page is fetched with `end`.
  const long = tmpDir();
  await withBitstamp(exportBars().filter((b) => b.date >= '2020-01-01' && b.date <= '2026-06-01'), LIVE_DATE, async (calls) => {
    const r = await run(['update', '--ledger', path.join(long, 'ledger.csv'), '--start', '2023-12-01', '--now', '2026-06-01T10:00:05Z']);
    assert.equal(r.code, 0, r.err);
    assert.equal(calls.length, 2);
    assert.match(calls[1], /&end=\d+$/);
    assert.equal(readLedger(path.join(long, 'ledger.csv')).length, 913);
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
  rechain(ledgerFile, (c, i) => { if (i > 0) c[13] = (Number(c[13]) * 1.5).toFixed(6); });
  let r = await status('2020-03-11T00:00:00Z');
  assert.equal(r.code, 1, r.out);
  assert.match(r.err, /ПОМИЛКА \[E_MISMATCH\].*equity/);
  assert.equal(r.out, '');

  // Other cells with valid hashes: benchmark money, a decision, a flag, a position, the source, a trade.
  for (const [col, value] of [[14, '99999.000000'], [15, '99999.000000'], [12, null], [7, null], [8, null], [9, null], [16, null], [17, 'made_up_source'], [10, 'BUY'], [11, '1.000000']]) {
    fs.writeFileSync(ledgerFile, good);
    rechain(ledgerFile, (c, i) => { if (i === 20) c[col] = value === null ? (c[col] === '1' ? '0' : '1') : value; });
    r = await status('2020-03-11T00:00:00Z');
    assert.equal(r.code, 1, `column ${tool.COLUMNS[col]}`);
    assert.match(r.err, /ПОМИЛКА \[E_(MISMATCH|SOURCE)\]/, `column ${tool.COLUMNS[col]}`);
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
  assert.match(r.err, /ПОМИЛКА \[E_HISTORY\].*всі дні від 2024-06-17, а отримані дані починаються лише з 2025-06-01/);
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
  assert.match(cmd, /\r\nnode "%~dp0paper_trade\.js" update\r\n/, 'works from any current directory');
  assert.match(cmd, /\r\npause\r\nexit \/b %RC%\r\n/, 'keeps the window open, then returns the exit code of the program');
  assert.ok(!cmd.replace(/\r\n/g, '').includes('\n'), 'CRLF line ends only');
  assert.ok(!cmd.startsWith('\uFEFF'));

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

// ---------- evaluation: one verdict day, fixed in advance ----------

test('the main verdict is taken once, on the first day both minimums are met', async () => {
  const dir = tmpDir();
  const ledgerFile = path.join(dir, 'ledger.csv');
  const args = ['--data', EXPORT, '--ledger', ledgerFile, '--start', '2019-01-01'];
  const statusAt = async (now) => {
    const r = await run(['update', ...args, '--now', now]);
    assert.equal(r.code, 0, r.err);
    return fs.readFileSync(path.join(dir, 'STATUS_UA.md'), 'utf8');
  };
  const main = (text) => text.split('\n').filter((l) => /Мінімум набрано|Основний висновок \(станом/.test(l)).join('\n');

  // The day before the minimum is reached: too early, no verdict of any kind.
  const early = await statusAt('2021-04-13T00:00:00Z');
  assert.match(early, /Ще зарано для висновків/);
  assert.doesNotMatch(early, /Основний висновок|Довідка на сьогодні|спрацювало/);

  // The first evaluable day, found independently from the ledger: 365 days and 6 SELL rows.
  const first = await statusAt('2021-04-14T00:00:00Z');
  const rows = readLedger(ledgerFile);
  let sells = 0;
  const idx = rows.findIndex((r, i) => { if (r.trade === 'SELL') sells++; return i + 1 >= 365 && sells >= 6; });
  assert.equal(rows[idx].date, '2021-04-13');
  assert.equal(idx, rows.length - 1);
  // Independent verdict for that day: drawdown and yearly return per drawdown, rule against hold.
  const stats = (key, n) => {
    let peak = 10000, dd = 0;
    for (let i = 0; i < n; i++) { const v = Number(rows[i][key]); if (v > peak) peak = v; dd = Math.min(dd, v / peak - 1); }
    const last = Number(rows[n - 1][key]);
    return { dd, ratio: (Math.pow(last / 10000, 365.25 / n) - 1) / -dd, total: last / 10000 - 1 };
  };
  const s = stats('equity', idx + 1), h = stats('equity_hold', idx + 1);
  assert.ok(s.total > 0 && h.total > 0);
  const worked = s.dd > h.dd && s.ratio > h.ratio;
  assert.equal(worked, false, 'on this history the first evaluable day says "did not work"');
  assert.match(first, /Мінімум набрано 2021-04-13: 834 дн\. і 6 завершених угод/);
  assert.match(first, /Основний висновок \(станом на 2021-04-13\): правило не спрацювало/);
  assert.doesNotMatch(first, /Довідка на сьогодні/, 'on the verdict day itself there is nothing else to show');

  // Later the day-to-day comparison flips, the main verdict does not move.
  const later = await statusAt('2021-06-01T00:00:00Z');
  const last = await statusAt('2026-11-26T00:00:00Z');
  assert.equal(main(later), main(first));
  assert.equal(main(last), main(first));
  assert.match(last, /### Довідка на сьогодні \(за всіма 2886 днями до 2026-11-25\)[\s\S]*За сьогоднішніми числами було б: «спрацювало»/);
  assert.match(last, /Основного висновку вони не замінюють/);

  // The exported helpers agree with the text.
  const parsed = fs.readFileSync(ledgerFile, 'utf8').trimEnd().split('\n').slice(1).map(tool.parseRow);
  assert.equal(tool.verdictIndex(parsed, tool.FROZEN_RULE.evaluation), idx);
  assert.equal(tool.judge(parsed.slice(0, idx + 1), 10000).worked, false);
  assert.equal(tool.judge(parsed, 10000).worked, true);
  assert.match(tool.FROZEN_RULE.evaluation.verdict_day, /first recorded day on which both minimums are met/);
});

test('the "too early" warning names only the condition that is not met', async () => {
  const dir = tmpDir();
  const warn = async (start, now) => {
    const d = tmpDir();
    const r = await run(['update', '--data', EXPORT, '--ledger', path.join(d, 'ledger.csv'), '--start', start, '--now', now]);
    assert.equal(r.code, 0, r.err);
    return fs.readFileSync(path.join(d, 'STATUS_UA.md'), 'utf8').split('\n').find((l) => l.includes('Ще зарано'));
  };
  // 334 days and 8 round trips: only the days are missing.
  const days = await warn('2021-01-01', '2021-12-01T01:00:00Z');
  assert.match(days, /Ще не минуло 365 днів \(зараз 334\)\.$/);
  assert.doesNotMatch(days, /менше ніж 6|нічого не доводять/);
  // 375 days and no round trip: only the trades are missing.
  const trades = await warn('2016-01-01', '2017-01-10T05:00:00Z');
  assert.match(trades, /Завершених угод менше ніж 6 \(зараз 0\); так мало угод нічого не доводять\.$/);
  assert.doesNotMatch(trades, /Ще не минуло/);
  // 41 days and 2 round trips: both.
  const csv = writeCsv(path.join(dir, 'data.csv'), sliceBars('2020-02-29'));
  assert.equal((await run(['update', ...sliceArgs(dir, csv)])).code, 0);
  const both = fs.readFileSync(path.join(dir, 'STATUS_UA.md'), 'utf8');
  assert.match(both, /Ще не минуло 365 днів \(зараз 41\)\. Завершених угод менше ніж 6 \(зараз 2\)/);
});

// ---------- the real folder matches the program (read-only) ----------

test('the real paper folder is consistent with the frozen rule in the program', async () => {
  const read = (name) => fs.readFileSync(path.join(REAL_DIR, name), 'utf8');
  const ruleInfo = tool.makeRule();
  assert.equal(read('frozen_rule.json'), ruleInfo.json, 'frozen_rule.json is the rule of the program, byte for byte');
  assert.equal(tool.sha256(read('frozen_rule.json')), ruleInfo.hash);
  const lines = read('ledger.csv').trimEnd().split('\n');
  assert.equal(lines[0], tool.HEADER);
  for (const line of lines.slice(1)) {
    const r = tool.parseRow(line);
    assert.equal(r.rule_sha256, ruleInfo.hash, `row ${r.date} was written under the current rule`);
    assert.equal(r.data_source, tool.SOURCE_LIVE, `row ${r.date} comes from the live source`);
  }
  assert.ok(read('run_log.csv').startsWith(tool.RUN_LOG_HEADER + '\n'));
  // The status file was written by the current program: honest reminder, no test banner.
  const status = read('STATUS_UA.md');
  assert.doesNotMatch(status, /ТЕСТОВИЙ/);
  assert.match(status, /найімовірніше гірші/);
  assert.doesNotMatch(status, /трохи інші числа/);
  // `status` on the real folder is offline and read-only, and it accepts the folder as it is.
  const before = ['ledger.csv', 'run_log.csv', 'STATUS_UA.md', 'frozen_rule.json'].map(read);
  const st = await run(['status']);
  assert.equal(st.code, 0, st.err);
  assert.deepEqual(['ledger.csv', 'run_log.csv', 'STATUS_UA.md', 'frozen_rule.json'].map(read), before);
});

// ---------- the Ukrainian documents match the program ----------

test('documents: honest wording, every column, every error code, the fixed plan', () => {
  const readme = fs.readFileSync(README, 'utf8');
  const plan = fs.readFileSync(PREREG, 'utf8');
  const source = fs.readFileSync(SCRIPT, 'utf8');

  // Unmodelled costs are not played down.
  for (const [name, text] of [['README', readme], ['program', source]]) {
    assert.doesNotMatch(text, /торгівля дала б трохи інші числа|числа були б трохи іншими/, name);
    assert.match(text, /найімовірніше гірш/, name);
  }
  // Every ledger column and every error code of the program is explained in the README.
  for (const col of tool.COLUMNS) assert.ok(readme.includes('`' + col + '`'), `README explains column ${col}`);
  const codes = [...new Set(source.match(/'E_[A-Z]+'/g).map((c) => c.slice(1, -1)))];
  assert.ok(codes.length >= 15, codes.join(' '));
  for (const code of codes) assert.ok(readme.includes('`' + code + '`'), `README explains ${code}`);
  // The one-day shift between the chart and the ledger is explained.
  assert.match(readme, /TradingView[\s\S]*`pos_held`/);
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

  // The plan: current rule hash, one verdict day, missing day, and no overclaim about tamper detection.
  assert.ok(plan.includes(tool.makeRule().hash), 'plan quotes the current rule hash');
  assert.match(plan, /Основний висновок робиться один раз/);
  assert.match(plan, /перший день, коли виконано обидві умови/);
  assert.match(plan, /не має бару за якийсь день/);
  assert.doesNotMatch(plan, /Зміну будь-якої старої цифри програма виявить\./);
  assert.match(plan, /git/);
  assert.match(plan, /ще зарано/);
  assert.match(plan, /найімовірніше гірш/);
});
