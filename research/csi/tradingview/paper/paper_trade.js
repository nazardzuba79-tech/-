#!/usr/bin/env node
'use strict';
// Paper-trading ledger for the frozen "BTC daily regime" rule.
// Plain Node, zero dependencies. Commands: update | verify | status.
// See PREREGISTRATION_PAPER.md (one level up) and README_UA.md.

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const DAY_S = 86400;
const DAY_MS = DAY_S * 1000;
const API_HOST = 'www.bitstamp.net';
const USER_AGENT = 'csi-paper/1.0';
const SOURCE_LIVE = 'bitstamp_api_v2_ohlc_btcusd_1d';
const SOURCE_TEST = 'offline_csv_test';
const LEDGER_NAME = 'ledger.csv';
const DEFAULT_LEDGER = path.join(__dirname, LEDGER_NAME);
const CLOCK_SKEW_NOTE_S = 300;
const EXIT_INCOMPLETE = 3; // verify: every decision matches, but some recorded prices differ from the source inside the tolerance

// The frozen rule. Any change here changes rule_sha256 and the tool will
// refuse to continue an existing ledger.
const FROZEN_RULE = Object.freeze({
  name: 'BTC daily regime',
  version: 1,
  pine_reference: 'pine/CSI_Market_Regime.pine',
  pine_sha256: '74940e807d18ec6e9a6cb11675e9c2a3f6a6c935fd1147aad245f53172bafd1a',
  data: 'Bitstamp BTCUSD daily bars, UTC midnight to midnight',
  data_endpoint: 'https://www.bitstamp.net/api/v2/ohlc/btcusd/?step=86400&limit=1000',
  bar_closed_when: 'now_utc >= bar_timestamp + 86400 seconds, by the clock of the exchange response',
  data_checks: {
    bar: 'open, high, low, close are plain positive decimals and low <= open, close <= high; otherwise stop',
    max_jump_close_to_next_open: 0.2,
    on_jump: 'stop and record nothing (live source)',
    missing_or_duplicate_day: 'stop and record nothing; the owner decides openly, old rows stay',
  },
  sma_trend: 200,
  sma_fast: 111,
  sma_slow: 350,
  overheat_multiplier: 2,
  regime_up: 'close > SMA200 AND NOT (SMA111 > 2 * SMA350)',
  execution: 'decision at the close of day D sets the position for day D+1, executed at the open of day D+1',
  positions: 'long or flat only, no leverage, no shorts',
  cost_per_position_change: 0.0015,
  start_date: '2026-11-26',
  start_equity_usd: 10000,
  start_position: 0,
  benchmarks: ['buy and hold from the open of the day after start_date, one cost', '200D only: same rule without the overheating term'],
  min_closed_bars: 350,
  revision_tolerance: 0.0005,
  revision_changing_a_decision: 'always a stop, whatever its size',
  rounding: 'prices to 2 decimals, averages to 6 decimals before comparison, equity to 6 decimals each day',
  evaluation: {
    min_days: 365,
    min_round_trips: 6,
    worked: 'max drawdown smaller than buy and hold AND return per drawdown better than buy and hold, same days',
    verdict_day: 'the first recorded day on which both minimums are met; the verdict is taken once, on all days from the start to that day; later recalculations are reference only',
  },
});

const COLUMNS = ['seq', 'date', 'open', 'close', 'sma200', 'sma111', 'sma350', 'regime_up', 'overheated', 'pos_held', 'trade',
  'cost_usd', 'target_next', 'equity', 'equity_hold', 'equity_200d_only', 'pos_200d_only', 'data_source', 'rule_sha256',
  'prev_row_sha256', 'row_sha256'];
const HEADER = COLUMNS.join(',');
const HASHED_FIELDS = COLUMNS.length - 2; // everything except the two hash-chain columns
const MARKET_COLUMNS = ['open', 'close', 'sma200', 'sma111', 'sma350'];
const RUN_LOG_HEADER = 'run_at_utc,command,rows_before,rows_after,last_date,last_row_sha256';

// An expected, explainable failure. `code` is stable and listed in README_UA.md.
class PaperError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}

// ---------- small helpers ----------

const sha256 = (s) => crypto.createHash('sha256').update(s, 'utf8').digest('hex');

// JSON with keys sorted at every level, no whitespace.
function canonicalJson(v) {
  if (Array.isArray(v)) return '[' + v.map(canonicalJson).join(',') + ']';
  if (v && typeof v === 'object') return '{' + Object.keys(v).sort().map((k) => JSON.stringify(k) + ':' + canonicalJson(v[k])).join(',') + '}';
  return JSON.stringify(v);
}

function dateToDay(s) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const day = Date.parse(s + 'T00:00:00Z') / DAY_MS;
  return Number.isInteger(day) && dayToDate(day) === s ? day : null;
}
const dayToDate = (day) => new Date(day * DAY_MS).toISOString().slice(0, 10);
const fmtUtc = (ms) => new Date(ms).toISOString().slice(0, 16).replace('T', ' ') + ' UTC';
const round6 = (x) => Number(x.toFixed(6));
const relDiff = (a, b) => (a === b ? 0 : Math.abs(a - b) / Math.abs(b));

function makeRule(startDate) {
  const rule = { ...FROZEN_RULE, start_date: startDate || FROZEN_RULE.start_date };
  const json = canonicalJson(rule);
  return { rule, json, hash: sha256(json) };
}

function writeAtomic(file, text) {
  const tmp = `${file}.tmp-${process.pid}`;
  try {
    const fd = fs.openSync(tmp, 'w');
    try { fs.writeSync(fd, text, null, 'utf8'); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
    fs.renameSync(tmp, file);
  } catch (e) {
    try { fs.unlinkSync(tmp); } catch { /* nothing to clean up */ }
    throw new PaperError('E_WRITE', `Не вдалося записати файл ${file} (${e.code || e.message}). Можливо, він відкритий в іншій програмі. Закрийте її і запустіть ще раз.`);
  }
}

// File text, or null when the file does not exist. Any other failure is explained in plain words.
function readText(file) {
  try {
    return fs.readFileSync(file, 'utf8');
  } catch (e) {
    if (e.code === 'ENOENT') return null;
    throw new PaperError('E_READ', `Не вдалося прочитати файл ${file} (${e.code || e.message}). Якщо він відкритий в іншій програмі, закрийте її і запустіть ще раз. Нічого не записано.`);
  }
}

// ---------- which folder is the real one ----------

const IS_WIN = process.platform === 'win32';
const isNetworkPath = (p) => /^[\\/]{2}/.test(p); // \\server\share, \\?\..., //server/share
function realDir(dir) {
  let full = path.resolve(dir);
  try { full = fs.realpathSync.native(full); } catch { /* directory missing */ }
  return IS_WIN ? full.toLowerCase() : full;
}

// 'same' when `dir` is the folder of this program under any name (the same path after resolving
// links, or the same directory on disk); 'copy' when it is another folder that holds a copy of
// this very program file, i.e. somebody's real paper folder; otherwise null.
function toolFolderKind(dir) {
  if (realDir(dir) === realDir(__dirname)) return 'same';
  try {
    const a = fs.statSync(dir, { bigint: true }), b = fs.statSync(__dirname, { bigint: true });
    if (a.ino !== 0n && a.ino === b.ino && a.dev === b.dev) return 'same';
  } catch { /* directory missing: it cannot be this folder */ }
  const twin = path.join(dir, path.basename(__filename));
  try {
    if (fs.existsSync(twin) && fs.readFileSync(twin).equals(fs.readFileSync(__filename))) return 'copy';
  } catch { return 'copy'; } // cannot tell: assume it is
  return null;
}

// ---------- the rule ----------

// Decision at the close of a day. Returns null when SMA200 is unavailable.
function decide(close, sma200, sma111, sma350, multiplier = FROZEN_RULE.overheat_multiplier) {
  if (sma200 === null) return null;
  const trendUp = close > sma200;
  const overheated = sma111 !== null && sma350 !== null && sma111 > multiplier * sma350;
  return { trendUp, overheated, regimeUp: trendUp && !overheated };
}

// One account, one day. Equity is marked at the close of the day.
function markDay(equity, heldPrev, heldNow, open, close, prevClose, costRate) {
  let eq = equity, cost = 0, trade = '';
  if (!heldPrev && heldNow) { // entry at the open
    cost = eq * costRate; eq -= cost; eq *= close / open; trade = 'BUY';
  } else if (heldPrev && heldNow) { // continuing long
    eq *= close / prevClose;
  } else if (heldPrev && !heldNow) { // exit at the open
    eq *= open / prevClose; cost = eq * costRate; eq -= cost; trade = 'SELL';
  }
  return { equity: round6(eq), cost: round6(cost), trade };
}

// Build the ledger row for one closed day from the previous row and that day's numbers.
// `prev` is a parsed row or null for the first row. Everything a later row needs is
// taken from the printed values of the previous row, so catch-up equals daily runs.
function deriveRow(prev, inp, ctx) {
  const { rule } = ctx;
  const d = decide(inp.close, inp.sma200, inp.sma111, inp.sma350, rule.overheat_multiplier);
  const c = rule.cost_per_position_change;
  const prevClose = prev ? prev.close : null;

  const strat = markDay(prev ? prev.equity : rule.start_equity_usd, prev ? prev.pos_held : 0,
    prev ? prev.target_next : rule.start_position, inp.open, inp.close, prevClose, c);
  // Buy and hold: cash on the first row, in the market from the second row on.
  const hold = markDay(prev ? prev.equity_hold : rule.start_equity_usd, prev && prev.seq > 1 ? 1 : 0,
    prev ? 1 : 0, inp.open, inp.close, prevClose, c);
  const pos200 = prev ? (prev.close > prev.sma200 ? 1 : 0) : 0;
  const only200 = markDay(prev ? prev.equity_200d_only : rule.start_equity_usd, prev ? prev.pos_200d_only : 0,
    pos200, inp.open, inp.close, prevClose, c);

  const cells = [
    String(prev ? prev.seq + 1 : 1), inp.date, inp.open.toFixed(2), inp.close.toFixed(2),
    inp.sma200.toFixed(6), inp.sma111.toFixed(6), inp.sma350.toFixed(6),
    d.regimeUp ? '1' : '0', d.overheated ? '1' : '0',
    String(prev ? prev.target_next : rule.start_position), strat.trade, strat.cost.toFixed(6),
    d.regimeUp ? '1' : '0', strat.equity.toFixed(6), hold.equity.toFixed(6), only200.equity.toFixed(6),
    String(pos200), ctx.source, ctx.ruleHash,
  ];
  const prevHash = prev ? prev.row_sha256 : 'GENESIS';
  cells.push(prevHash, sha256(prevHash + '|' + cells.join(',')));
  return parseRow(cells.join(','));
}

const recordedInputs = (r) => ({ date: r.date, open: r.open, close: r.close, sma200: r.sma200, sma111: r.sma111, sma350: r.sma350 });

// ---------- ledger file ----------

function parseRow(line) {
  const cells = line.split(',');
  if (cells.length !== COLUMNS.length) return null;
  const r = { line, cells };
  COLUMNS.forEach((name, i) => { r[name] = cells[i]; });
  for (const k of ['seq', 'open', 'close', 'sma200', 'sma111', 'sma350', 'regime_up', 'overheated', 'pos_held', 'cost_usd',
    'target_next', 'equity', 'equity_hold', 'equity_200d_only', 'pos_200d_only']) r[k] = Number(r[k]);
  return r;
}

function readLedger(file) {
  const text = readText(file);
  if (text === null) return { exists: false, text: '', rows: [] };
  const broken = (why) => new PaperError('E_CHAIN', `Журнал пошкоджено або змінено вручну: ${why}. Нічого не записано. Відновіть файл ledger.csv з останньої копії.`);
  if (!text.endsWith('\n')) throw broken('файл не закінчується повним рядком');
  const lines = text.slice(0, -1).split('\n');
  if (lines[0] !== HEADER) throw broken('перший рядок (заголовок) не такий, як має бути');
  const rows = lines.slice(1).map((line, i) => {
    const r = parseRow(line);
    if (!r) throw broken(`рядок ${i + 1} має не ту кількість стовпчиків`);
    return r;
  });
  return { exists: true, text, rows };
}

// Everything that can be checked without market data: hash chain, rule hash, numbering and
// dates, the data source, and the arithmetic of every row (each row must follow from the
// previous row and its own recorded prices). `nowMs` is given only by `status`, which has no
// exchange data to compare with: a row for a day that has not closed yet is then refused here.
function checkChain(rows, o, nowMs = null) {
  const ruleInfo = o.ruleInfo;
  let prevHash = 'GENESIS';
  for (const r of rows) {
    const expected = sha256(prevHash + '|' + r.cells.slice(0, HASHED_FIELDS).join(','));
    if (r.prev_row_sha256 !== prevHash || r.row_sha256 !== expected) {
      throw new PaperError('E_CHAIN', `Ланцюжок записів порушено на рядку з датою ${r.date}: цей або попередній рядок змінено після запису. Нічого не записано. Відновіть файл ledger.csv з останньої копії.`);
    }
    prevHash = r.row_sha256;
  }
  for (const r of rows) {
    if (r.rule_sha256 !== ruleInfo.hash) {
      throw new PaperError('E_RULE', `Журнал вели за іншим правилом (рядок ${r.date}: відбиток правила ${r.rule_sha256.slice(0, 12)}…, зараз ${ruleInfo.hash.slice(0, 12)}…). Правило заморожене, тому продовжувати цей журнал не можна. Нічого не записано.`);
    }
  }
  const startDay = dateToDay(ruleInfo.rule.start_date);
  rows.forEach((r, i) => {
    if (r.seq !== i + 1 || r.date !== dayToDate(startDay + i)) {
      throw new PaperError('E_CHAIN', `Порядок записів порушено на рядку ${i + 1} (дата ${r.date}): дні мають іти поспіль від ${ruleInfo.rule.start_date}. Нічого не записано.`);
    }
  });
  let prev = null;
  for (const r of rows) {
    if (r.data_source !== SOURCE_LIVE && r.data_source !== SOURCE_TEST) {
      throw new PaperError('E_SOURCE', `У рядку ${r.date} записано невідоме джерело даних «${r.data_source}». Нічого не записано. Відновіть файл ledger.csv з останньої копії.`);
    }
    if (o.real && r.data_source !== SOURCE_LIVE) {
      throw new PaperError('E_SOURCE', `У справжньому журналі є рядок ${r.date}, записаний не з живих даних Bitstamp, а з тестового файла. Такого рядка тут бути не може. Нічого не записано. Відновіть файл ledger.csv з останньої копії.`);
    }
    const again = deriveRow(prev, recordedInputs(r), { rule: ruleInfo.rule, ruleHash: ruleInfo.hash, source: r.data_source });
    if (again.line !== r.line) {
      const i = again.cells.findIndex((c, j) => c !== r.cells[j]);
      throw new PaperError('E_MISMATCH', `Перший незбіг: рядок ${r.date}, стовпчик ${COLUMNS[i]}: у журналі "${r.cells[i]}", а за розрахунком має бути "${again.cells[i]}". Нічого не записано. Відновіть файл ledger.csv з останньої копії.`);
    }
    prev = r;
  }
  if (nowMs !== null && rows.length) {
    const last = rows[rows.length - 1];
    if ((dateToDay(last.date) + 1) * DAY_MS > nowMs) {
      throw new PaperError('E_FUTURE', `У журналі є запис за ${last.date}, але за годинником цього комп’ютера цей день ще не закрився. Такого запису бути не може. Перевірте годинник комп’ютера. Якщо годинник правильний, відновіть файл ledger.csv з останньої копії.`);
    }
  }
}

// ---------- run log ----------

function readRunLog(file) {
  const text = readText(file);
  if (text === null) return { text: null, runs: [] };
  const bad = (n) => new PaperError('E_RUNLOG', `Файл run_log.csv пошкоджено або змінено вручну (рядок ${n}). Нічого не записано. Відновіть його з останньої копії.`);
  if (!text.endsWith('\n')) throw bad('останній');
  const lines = text.slice(0, -1).split('\n');
  if (lines[0] !== RUN_LOG_HEADER) throw bad(1);
  const runs = lines.slice(1).map((line, i) => {
    const c = line.split(',');
    const atMs = Date.parse(c[0]), before = Number(c[2]), after = Number(c[3]);
    if (c.length !== 6 || !Number.isFinite(atMs) || !Number.isInteger(before) || !Number.isInteger(after) || before < 0 || after < before) throw bad(i + 2);
    return { atMs, before, after, lastDate: c[4], lastHash: c[5] };
  });
  return { text, runs };
}

// Rows that an earlier run reported as written must still be there, unchanged. Without this,
// deleting the tail of the ledger (or the whole file) would let the tool quietly write the
// same days again from different data.
function checkRunLog(ledger, runs) {
  const rows = ledger.rows;
  for (const run of runs) {
    if (run.after === 0) continue;
    const when = fmtUtc(run.atMs);
    if (rows.length < run.after) {
      throw new PaperError('E_SHRUNK', `${ledger.exists ? `У журналі зараз записів: ${rows.length}` : 'Файла ledger.csv зараз немає'}, а після запуску ${when} записів було ${run.after} (останній день ${run.lastDate}). Записи зникли. Записані дні не можна стерти й записати заново. Нічого не записано. Відновіть ledger.csv і run_log.csv разом з однієї копії (див. README_UA.md).`);
    }
    const r = rows[run.after - 1];
    if (r.row_sha256 !== run.lastHash || r.date !== run.lastDate) {
      throw new PaperError('E_SHRUNK', `Запис за ${run.lastDate} зараз не той, що був після запуску ${when}: рядки журналу стерли й записали заново. Записані дні не переписуються. Нічого не записано. Відновіть ledger.csv і run_log.csv разом з однієї копії (див. README_UA.md).`);
    }
  }
}

// ---------- market data ----------

function loadCsvBars(file) {
  let text;
  try { text = fs.readFileSync(file, 'utf8'); } catch (e) { throw new PaperError('E_DATA', `Не вдалося прочитати файл даних ${file}: ${e.message}`); }
  const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/).filter((l) => l !== '');
  const head = (lines[0] || '').split(',').slice(0, 5).map((s) => s.replace(/"/g, '').trim()).join(',');
  if (head !== 'time,open,high,low,close') throw new PaperError('E_DATA', 'Файл даних має починатися зі стовпчиків time,open,high,low,close.');
  return lines.slice(1).map((line, i) => {
    const c = line.split(',');
    const m = /^(\d{4}-\d{2}-\d{2})(T00:00:00(\.000)?Z)?$/.exec(c[0]);
    const day = m ? dateToDay(m[1]) : null;
    if (day === null) throw new PaperError('E_DATA', `Файл даних, рядок ${i + 2}: незрозуміла дата "${c[0]}".`);
    return makeBar(day, c[1], c[4]);
  });
}

// A price is a plain positive decimal: "60381.88" or a finite number. Nothing else
// (no hex, no exponent, no spaces, no arrays, no booleans). Returns whole cents or null.
function priceCents(v) {
  let x;
  if (typeof v === 'string' && /^\d{1,9}(\.\d+)?$/.test(v)) x = Number(v);
  else if (typeof v === 'number' && Number.isFinite(v)) x = v;
  else return null;
  const cents = Math.round(x * 100);
  return cents >= 1 && cents < 1e13 ? cents : null;
}

// `high` and `low` are given for exchange bars and must then agree with open and close.
function makeBar(day, open, close, high, low) {
  const show = (v) => (typeof v === 'string' ? `"${v}"` : JSON.stringify(v) ?? String(v));
  const fail = (why) => new PaperError('E_DATA', `Дані за ${dayToDate(day)} незрозумілі: ${why}. Нічого не записано. Запустіть пізніше.`);
  const openCents = priceCents(open), closeCents = priceCents(close);
  if (openCents === null || closeCents === null) throw fail(`open=${show(open)}, close=${show(close)}`);
  if (high !== undefined || low !== undefined) {
    const hi = priceCents(high), lo = priceCents(low);
    if (hi === null || lo === null) throw fail(`high=${show(high)}, low=${show(low)}`);
    if (!(lo <= openCents && openCents <= hi && lo <= closeCents && closeCents <= hi)) {
      throw fail(`ціни відкриття і закриття мають лежати між найнижчою і найвищою ціною дня (open=${show(open)}, high=${show(high)}, low=${show(low)}, close=${show(close)})`);
    }
  }
  // Prices are kept in whole cents so that sums are exact.
  return { day, openCents, closeCents };
}

// Fetch daily bars from Bitstamp, paging backwards until `fromDay` is covered.
async function fetchBitstampBars(fromDay) {
  const bars = [];
  let end = null, serverNowS = null;
  for (let page = 0; page < 30; page++) {
    const url = `https://${API_HOST}/api/v2/ohlc/btcusd/?step=${DAY_S}&limit=1000` + (end === null ? '' : `&end=${end}`);
    let list, res;
    try {
      res = await fetch(url, { headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' }, redirect: 'error', signal: AbortSignal.timeout(30000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = await res.json();
      list = body && body.data && body.data.ohlc;
      if (!Array.isArray(list)) throw new Error('unexpected response shape');
    } catch (e) {
      throw new PaperError('E_FETCH', `Не вдалося отримати дані з Bitstamp (${e.message}). Перевірте інтернет і запустіть ще раз. Журнал не змінено.`);
    }
    if (page === 0) {
      // The exchange clock decides which bar is closed. Without it the tool does not guess
      // from the PC clock: a wrong PC clock could turn a still-open bar into a final row.
      // Only the standard HTTP form counts ("Thu, 26 Nov 2026 19:02:12 GMT"); anything else is no clock.
      const header = (res.headers && res.headers.get('date')) || '';
      const t = /^[A-Z][a-z]{2}, \d{2} [A-Z][a-z]{2} \d{4} \d{2}:\d{2}:\d{2} GMT$/.test(header) ? Date.parse(header) : NaN;
      if (!Number.isFinite(t)) {
        throw new PaperError('E_FETCH', 'Не вдалося дізнатися точний час біржі (у відповіді Bitstamp немає дати). Без нього програма не може бути певна, що день уже закрився. Журнал не змінено. Запустіть пізніше.');
      }
      serverNowS = Math.floor(t / 1000);
    }
    if (list.length === 0) break;
    let oldest = Infinity;
    for (const b of list) {
      if (b === null || typeof b !== 'object' || Array.isArray(b)) throw new PaperError('E_DATA', 'Bitstamp повернув незрозумілий запис замість денного бару. Нічого не записано. Запустіть пізніше.');
      const ts = typeof b.timestamp === 'string' && /^\d{1,12}$/.test(b.timestamp) ? Number(b.timestamp) : typeof b.timestamp === 'number' ? b.timestamp : NaN;
      if (!Number.isInteger(ts) || ts % DAY_S !== 0) throw new PaperError('E_DATA', `Bitstamp повернув бар із незвичним часом (${JSON.stringify(b.timestamp)}). Нічого не записано. Запустіть пізніше.`);
      bars.push(makeBar(ts / DAY_S, b.open, b.close, b.high, b.low));
      if (ts < oldest) oldest = ts;
    }
    if (oldest / DAY_S <= fromDay || list.length < 1000) break;
    end = oldest - DAY_S;
  }
  return { bars, serverNowS };
}

// Keep only closed bars and index them by day. Duplicates are kept so they can be reported.
// Bars that are still open go to `pending`: only their opening price is ever looked at.
function buildSeries(bars, nowS) {
  const byDay = new Map(), pending = new Map();
  let first = null, last = null;
  for (const b of bars) {
    if (b.day * DAY_S + DAY_S > nowS) { pending.set(b.day, b); continue; } // still open
    if (!byDay.has(b.day)) byDay.set(b.day, []);
    byDay.get(b.day).push(b);
    if (first === null || b.day < first) first = b.day;
    if (last === null || b.day > last) last = b.day;
  }
  return { byDay, pending, first, last };
}

// Every day in [fromDay, toDay] must be present exactly once. No guessing.
function requireWindow(series, fromDay, toDay) {
  if (series.first === null || series.first > fromDay) {
    throw new PaperError('E_HISTORY', `Замало історії: для розрахунку потрібні ${FROZEN_RULE.min_closed_bars} закритих днів поспіль, тобто всі дні від ${dayToDate(fromDay)}, а отримані дані починаються лише з ${dayToDate(series.first)}. Нічого не записано.`);
  }
  for (let day = fromDay; day <= toDay; day++) {
    const list = series.byDay.get(day);
    if (!list) throw new PaperError('E_GAP', `У даних бракує дня ${dayToDate(day)}. Програма не вгадує пропущені дні. Нічого не записано. Спробуйте пізніше. Якщо дня так і не з’явиться, дивіться README_UA.md, рядок E_GAP.`);
    if (list.length > 1) throw new PaperError('E_DUPLICATE', `У даних день ${dayToDate(day)} трапляється двічі. Програма не вибирає навмання. Нічого не записано. Спробуйте пізніше.`);
  }
}

// Numbers for one closed day, rounded exactly as they are recorded.
function dayInputs(series, day) {
  const sma = (n) => {
    let cents = 0;
    for (let d = day - n + 1; d <= day; d++) cents += series.byDay.get(d)[0].closeCents;
    return round6(cents / (n * 100));
  };
  const bar = series.byDay.get(day)[0];
  return { date: dayToDate(day), open: bar.openCents / 100, close: bar.closeCents / 100,
    sma200: sma(FROZEN_RULE.sma_trend), sma111: sma(FROZEN_RULE.sma_fast), sma350: sma(FROZEN_RULE.sma_slow) };
}

// Exchange data only: a day about to be recorded must connect to its neighbours. A 24-hour
// market does not jump by a fifth between one day's close and the next day's open, so such
// a jump means broken data. Stop instead of writing a wrong final row.
function requirePlausible(series, day, rule) {
  const jump = rule.data_checks.max_jump_close_to_next_open;
  const bar = series.byDay.get(day)[0], prev = series.byDay.get(day - 1)[0];
  const next = series.byDay.has(day + 1) ? series.byDay.get(day + 1)[0] : series.pending.get(day + 1);
  const pairs = [[prev.closeCents, bar.openCents, day]];
  if (next) pairs.push([bar.closeCents, next.openCents, day + 1]);
  for (const [close, open, openDay] of pairs) {
    if (Math.abs(open / close - 1) > jump) {
      throw new PaperError('E_SUSPECT', `Ціни за ${dayToDate(day)} виглядають неправдоподібно: закриття ${dayToDate(openDay - 1)} було ${(close / 100).toFixed(2)}, а відкриття ${dayToDate(openDay)} вже ${(open / 100).toFixed(2)}. Це стрибок понад ${(jump * 100).toFixed(0)}%, схоже на збій у даних біржі. Нічого не записано. Запустіть пізніше.`);
    }
  }
}

const SAY_DECISION = (up) => (up ? 'тримати BTC' : 'долари');

// Compare every recorded row with fresh market data. The arithmetic of the rows is already
// checked by checkChain. Throws on a revision above the tolerance, and on ANY difference
// that would change a decision of the rule or of the "200D only" benchmark. Returns the list
// of small differences (inside the tolerance) and the last row of a ledger re-derived from
// the fresh numbers alone, so the effect of those differences on the money can be shown.
function verifyRows(rows, ruleInfo, series, source) {
  const ctx = { rule: ruleInfo.rule, ruleHash: ruleInfo.hash, source };
  const tol = ruleInfo.rule.revision_tolerance;
  const notes = [];
  let freshPrev = null;
  for (const r of rows) {
    if (r.data_source !== source) {
      throw new PaperError('E_MISMATCH', `Перший незбіг: рядок ${r.date}, стовпчик data_source: у журналі "${r.data_source}", а дані зараз беруться з "${source}". Нічого не записано.`);
    }
    const fresh = dayInputs(series, dateToDay(r.date));
    for (const k of MARKET_COLUMNS) {
      if (r[k] === fresh[k]) continue;
      const recorded = r.cells[COLUMNS.indexOf(k)];
      if (!(relDiff(r[k], fresh[k]) <= tol)) {
        throw new PaperError('E_REVISION', `Перегляд даних за ${r.date}: у журналі ${k} = ${recorded}, а джерело тепер дає ${fresh[k]}. Різниця більша за ${(tol * 100).toFixed(2)}%. Старі записи не переписуються. Нічого не записано.`);
      }
      notes.push({ date: r.date, column: k, recorded, fresh: fresh[k].toFixed(k === 'open' || k === 'close' ? 2 : 6) });
    }
    const was = decide(r.close, r.sma200, r.sma111, r.sma350, ctx.rule.overheat_multiplier);
    const now = decide(fresh.close, fresh.sma200, fresh.sma111, fresh.sma350, ctx.rule.overheat_multiplier);
    if (was.regimeUp !== now.regimeUp || was.overheated !== now.overheated || was.trendUp !== now.trendUp) {
      const what = was.regimeUp !== now.regimeUp
        ? `рішення правила було б іншим: у журналі «${SAY_DECISION(was.regimeUp)}», за свіжими даними «${SAY_DECISION(now.regimeUp)}»`
        : was.trendUp !== now.trendUp
          ? `рішення рахунку «лише 200-денна середня» було б іншим: у журналі «${SAY_DECISION(was.trendUp)}», за свіжими даними «${SAY_DECISION(now.trendUp)}»`
          : `позначка перегріву була б іншою: у журналі ${was.overheated ? 1 : 0}, за свіжими даними ${now.overheated ? 1 : 0}`;
      throw new PaperError('E_REVISION', `Перегляд даних за ${r.date}: записані ціни відрізняються від свіжих даних джерела зовсім трохи, але цього досить, щоб ${what}. Старі записи не переписуються. Нічого не записано.`);
    }
    freshPrev = deriveRow(freshPrev, fresh, ctx);
  }
  return { notes, freshLast: freshPrev };
}

// Plain-language lines about small differences between the ledger and fresh data.
function describeNotes(rows, check, tol, maxDates) {
  const byDate = new Map();
  for (const n of check.notes) {
    if (!byDate.has(n.date)) byDate.set(n.date, []);
    byDate.get(n.date).push(`${n.column} у журналі ${n.recorded}, зараз ${n.fresh}`);
  }
  const dates = [...byDate.keys()];
  const lines = [`Зауваження: у ${dates.length} записаних днях джерело тепер дає трохи інші числа, ніж записано в журналі (різниця в межах допуску ${(tol * 100).toFixed(2)}%, жодне рішення правила від цього не змінюється). Записи не змінювалися.`];
  for (const d of dates.slice(0, maxDates)) lines.push(`  ${d}: ${byDate.get(d).join('; ')}.`);
  if (dates.length > maxDates) lines.push(`  … і ще днів: ${dates.length - maxDates}. Повний перелік: node paper_trade.js verify`);
  const last = rows[rows.length - 1], f = check.freshLast;
  lines.push(`  Якби всі дні перерахувати за свіжими даними, рахунок за правилом був би ${fmtUsd(f.equity)} USD, а в журналі ${fmtUsd(last.equity)} USD (журнал відрізняється на ${fmtPct(last.equity / f.equity - 1)}). «Просто тримати»: ${fmtUsd(f.equity_hold)} USD проти ${fmtUsd(last.equity_hold)} USD у журналі.`);
  return lines;
}

// ---------- status text ----------

function fmtUsd(x) {
  const [int, frac] = Math.abs(x).toFixed(2).split('.');
  return (x < 0 ? '-' : '') + int.replace(/\B(?=(\d{3})+(?!\d))/g, ' ') + '.' + frac;
}
const fmtPct = (x) => (x > 0 ? '+' : '') + (x * 100).toFixed(2) + '%';

function accountStats(rows, key, start) {
  let peak = start, maxDd = 0;
  for (const r of rows) {
    if (r[key] > peak) peak = r[key];
    const dd = r[key] / peak - 1;
    if (dd < maxDd) maxDd = dd;
  }
  const last = rows[rows.length - 1][key];
  const total = last / start - 1;
  const perYear = Math.pow(last / start, 365.25 / rows.length) - 1;
  return { last, total, maxDd, perYear, ratio: maxDd < 0 ? perYear / -maxDd : null };
}

// The pre-registered comparison of the rule with buy and hold over the given rows.
function judge(rows, start) {
  const s = accountStats(rows, 'equity', start), h = accountStats(rows, 'equity_hold', start);
  const ddOk = s.maxDd > h.maxDd;
  const bothLosing = s.total < 0 && h.total < 0;
  const ratioOk = bothLosing ? s.total > h.total : s.ratio !== null && h.ratio !== null && s.ratio > h.ratio;
  return { s, h, ddOk, bothLosing, ratioOk, worked: ddOk && ratioOk };
}

// Index of the first row on which both pre-registered minimums are met, or -1.
// It depends only on the rows up to that day, so it never moves once it exists.
function verdictIndex(rows, ev) {
  let sells = 0;
  for (let i = 0; i < rows.length; i++) {
    if (rows[i].trade === 'SELL') sells++;
    if (i + 1 >= ev.min_days && sells >= ev.min_round_trips) return i;
  }
  return -1;
}

function judgeLines(j) {
  const fr = (a) => (a.ratio === null ? 'немає' : a.ratio.toFixed(2));
  return [
    `- Найбільше падіння менше, ніж у «просто тримати»: ${j.ddOk ? 'так' : 'ні'} (${(j.s.maxDd * 100).toFixed(2)}% проти ${(j.h.maxDd * 100).toFixed(2)}%).`,
    j.bothLosing
      ? `- Обидва рахунки в мінусі, тому порівнюємо збиток: менший збиток у правила: ${j.ratioOk ? 'так' : 'ні'} (${fmtPct(j.s.total)} проти ${fmtPct(j.h.total)}).`
      : `- Дохідність за рік, поділена на найбільше падіння, краща, ніж у «просто тримати»: ${j.ratioOk ? 'так' : 'ні'} (${fr(j.s)} проти ${fr(j.h)}).`,
  ];
}

// Plain Ukrainian status. `nowMs` is the moment the status is produced.
// opts: { test: test options were used, extraWarnings: [] }
function renderStatus(rows, ruleInfo, lastRunMs, nowMs, opts = {}) {
  const rule = ruleInfo.rule;
  const out = [];
  if (opts.test || rule.start_date !== FROZEN_RULE.start_date || rows.some((r) => r.data_source !== SOURCE_LIVE)) {
    out.push('**ТЕСТОВИЙ ПРОГІН. Це не справжній паперовий рахунок.** Числа нижче отримано з тестових даних, з іншою датою старту або з підставленим часом. Висновків з них робити не можна.', '');
  }
  out.push('# Паперова торгівля: поточний стан', '',
    'Це навчальний рахунок без справжніх грошей. Він нічого не обіцяє і не є порадою купувати чи продавати.', '');
  const startDay = dateToDay(rule.start_date);
  const firstCloseMs = (startDay + 1) * DAY_MS;
  const today = Math.floor(nowMs / DAY_MS);
  const warnings = [];
  const runLine = `- Останній запуск оновлення: ${lastRunMs === null ? 'ще не було' : fmtUtc(lastRunMs)}.`;

  if (rows.length === 0) {
    out.push('Записів ще немає.', '',
      `Перший запис з’явиться після того, як закриється перший повний день: ${fmtUtc(firstCloseMs)}.`,
      'Після цього часу запустіть update.cmd ще раз.', '',
      `- Перший день паперової торгівлі: ${rule.start_date}.`,
      `- Стартова сума на папері: ${fmtUsd(rule.start_equity_usd)} USD, без позиції.`, runLine);
    if (today - startDay > 2) warnings.push('Перший день уже закрився, а записів немає. Запустіть update.cmd.');
  } else {
    const last = rows[rows.length - 1];
    const lastDay = dateToDay(last.date);
    const regime = last.overheated ? 'перегрів' : last.close > last.sma200 ? 'тренд угору' : 'тренд униз';
    const start = rule.start_equity_usd;
    const s = accountStats(rows, 'equity', start), h = accountStats(rows, 'equity_hold', start), o = accountStats(rows, 'equity_200d_only', start);
    const buys = rows.filter((r) => r.trade === 'BUY').length, sells = rows.filter((r) => r.trade === 'SELL').length;
    const costs = rows.reduce((a, r) => a + r.cost_usd, 0);
    const nextDate = dayToDate(lastDay + 1);
    let holds;
    if (last.target_next === 1) holds = last.pos_held === 1 ? 'BTC' : `BTC (купівля за ціною відкриття ${nextDate}; її буде записано в наступному рядку)`;
    else holds = last.pos_held === 0 ? 'долари (поза ринком)' : `долари (продаж за ціною відкриття ${nextDate}; його буде записано в наступному рядку)`;
    const row = (name, a) => `| ${name} | ${fmtUsd(a.last)} | ${fmtPct(a.total)} | ${(a.maxDd * 100).toFixed(2)}% |`;
    out.push(
      `- Останній закритий день у журналі: ${last.date}. Ціна закриття: ${fmtUsd(last.close)} USD.`,
      `- Режим ринку за цим днем: ${regime}.`,
      `- Зараз паперовий рахунок тримає: ${holds}.`,
      `- Днів від старту (${rule.start_date}): ${rows.length}.`,
      `- Угод за правилом: ${buys + sells} (купівель ${buys}, продажів ${sells}). Завершених угод «купив і продав»: ${sells}.`,
      `- Умовної комісії списано: ${fmtUsd(costs)} USD.`,
      runLine, '',
      `## Гроші на папері (старт: ${fmtUsd(start)} USD)`, '',
      '| Рахунок | Зараз, USD | Зміна від старту | Найбільше падіння від вершини |',
      '|---|---|---|---|',
      row('Правило «BTC денний режим»', s), row('Просто тримати BTC', h), row('Лише 200-денна середня', o), '');

    const ev = rule.evaluation;
    const vi = verdictIndex(rows, ev);
    if (vi < 0) {
      const unmet = [];
      if (rows.length < ev.min_days) unmet.push(`Ще не минуло ${ev.min_days} днів (зараз ${rows.length}).`);
      if (sells < ev.min_round_trips) unmet.push(`Завершених угод менше ніж ${ev.min_round_trips} (зараз ${sells}); так мало угод нічого не доводять.`);
      warnings.push(`Ще зарано для висновків. Оцінка можлива лише після ${ev.min_days} днів і ${ev.min_round_trips} завершених угод одночасно. ${unmet.join(' ')}`);
    } else {
      const at = rows.slice(0, vi + 1);
      const j = judge(at, start);
      const sellsAt = at.filter((r) => r.trade === 'SELL').length;
      out.push('## Оцінка за планом, записаним заздалегідь', '',
        `Мінімум набрано ${rows[vi].date}: ${at.length} дн. і ${sellsAt} завершених угод. Основний висновок робиться один раз, за всіма днями від старту до цього дня, і більше не змінюється. План: PREREGISTRATION_PAPER.md.`, '',
        ...judgeLines(j),
        `- Основний висновок (станом на ${rows[vi].date}): ${j.worked ? 'правило спрацювало за обома умовами' : 'правило не спрацювало (потрібні обидві умови)'}. Це не обіцянка на майбутнє.`);
      if (j.s.total < 0) out.push(`- Саме правило на той день було в мінусі (${fmtPct(j.s.total)}). Порівняння вище показує лише, чи втратило воно менше, ніж «просто тримати».`);
      out.push('');
      if (vi < rows.length - 1) {
        const t = judge(rows, start);
        out.push(`### Довідка на сьогодні (за всіма ${rows.length} днями до ${last.date})`, '',
          'Ці числа щодня змінюються. Основного висновку вони не замінюють.', '',
          ...judgeLines(t),
          `- За сьогоднішніми числами було б: ${t.worked ? '«спрацювало»' : '«не спрацювало»'}.`, '');
      }
    }
    if (today - lastDay > 2) warnings.push(`Дані застаріли: останній записаний день ${last.date}, це більше двох днів тому. Запустіть update.cmd.`);
  }
  for (const w of opts.extraWarnings || []) warnings.push(w);
  out.push('', '## Попередження', '');
  if (warnings.length === 0) out.push('- Немає.');
  for (const w of warnings) out.push(`- ${w}`);
  out.push('', '## Нагадування', '',
    '- У розрахунку немає прослизання ціни, затримок виконання та плати за фінансування. Справжня торгівля дала б інші числа, найімовірніше гірші. Наскільки, ця перевірка не показує.',
    '- Якщо цей файл старший за два дні, спершу запустіть update.cmd.', '');
  return out.join('\n').replace(/\n{3,}/g, '\n\n');
}

// ---------- commands ----------

function parseArgs(argv) {
  const opts = { cmd: argv[0] || '', data: null, now: null, ledger: null, start: null };
  for (let i = 1; i < argv.length; i++) {
    const name = argv[i];
    if (!['--data', '--now', '--ledger', '--start'].includes(name) || argv[i + 1] === undefined) {
      throw new PaperError('E_ARGS', `Незрозумілий параметр: ${name}`);
    }
    opts[name.slice(2)] = argv[++i];
  }
  if (!['update', 'verify', 'status'].includes(opts.cmd)) {
    throw new PaperError('E_ARGS', 'Команди: node paper_trade.js update | verify | status');
  }
  // The real record lives in the folder of this program and can only be built from live data,
  // the real clock and the frozen start date. Test runs must use another folder: the status,
  // the run log and the rule file are written next to the ledger.
  let ledger = DEFAULT_LEDGER, real = true;
  if (opts.ledger) {
    ledger = path.resolve(opts.ledger);
    const dir = path.dirname(ledger);
    if (isNetworkPath(ledger) || isNetworkPath(realDir(dir))) {
      throw new PaperError('E_REFUSED', 'Відмова: параметр --ledger не приймає мережевих шляхів (тих, що починаються з \\\\). Тестовий журнал має лежати в окремій теці на цьому комп’ютері.');
    }
    const kind = toolFolderKind(dir);
    if (kind === 'copy') {
      // Another paper folder with its own copy of the program. This program must not write
      // there, and it must not quietly work on its own ledger instead of the one that was named.
      throw new PaperError('E_REFUSED', 'Відмова: у теці, вказаній через --ledger, лежить копія цієї програми, тобто це чиясь справжня тека паперової торгівлі. Запускайте ту копію програми, що лежить у тій теці, без параметра --ledger.');
    }
    if (kind === 'same') {
      const base = path.basename(ledger);
      // Windows ignores case and trailing dots and spaces in file names.
      const isDefault = IS_WIN ? base.replace(/[. ]+$/, '').toLowerCase() === LEDGER_NAME : base === LEDGER_NAME;
      if (!isDefault) {
        throw new PaperError('E_REFUSED', 'Відмова: у теці програми може лежати лише справжній журнал ledger.csv. Для перевірок вкажіть через --ledger файл в іншій теці, інакше перевірка переписала б справжні STATUS_UA.md і run_log.csv.');
      }
      ledger = DEFAULT_LEDGER;
    } else {
      real = false;
    }
  }
  const test = Boolean(opts.data || opts.start || opts.now);
  if (real && test) {
    throw new PaperError('E_REFUSED', 'Відмова: параметри --data, --start і --now дозволені лише для перевірок з окремим файлом журналу в іншій теці (--ledger). Справжній журнал ведеться тільки за живими даними Bitstamp і замороженою датою старту.');
  }
  if (opts.start && dateToDay(opts.start) === null) throw new PaperError('E_ARGS', `Незрозуміла дата старту: ${opts.start}`);
  let nowMs = null;
  if (opts.now) {
    nowMs = Date.parse(opts.now);
    if (!Number.isFinite(nowMs)) throw new PaperError('E_ARGS', `Незрозумілий час: ${opts.now}`);
  }
  const dir = path.dirname(ledger);
  return { cmd: opts.cmd, data: opts.data, nowMs, ledger, real, test, ruleInfo: makeRule(opts.start),
    ruleFile: path.join(dir, 'frozen_rule.json'), statusFile: path.join(dir, 'STATUS_UA.md'), runLog: path.join(dir, 'run_log.csv') };
}

function checkRuleFile(o) {
  const text = readText(o.ruleFile);
  if (text !== null && text !== o.ruleInfo.json) {
    throw new PaperError('E_RULE', 'Файл frozen_rule.json не збігається з правилом у програмі. Правило заморожене: його не можна міняти під час паперової торгівлі. Нічого не записано.');
  }
}

// Load the ledger and run every check that needs no market data; with `needData` also load
// market data and compare every recorded row with it. Shared by update, verify and status.
async function loadAndCheck(o, needData) {
  checkRuleFile(o);
  const ledger = readLedger(o.ledger);
  const clockMs = o.nowMs !== null ? o.nowMs : Date.now();
  checkChain(ledger.rows, o, needData ? null : clockMs);
  const runLog = readRunLog(o.runLog);
  if (runLog.text === null && ledger.rows.length) {
    throw new PaperError('E_RUNLOG', `Файла run_log.csv немає, хоча в журналі вже є записи (${ledger.rows.length}). Без нього програма не може перевірити, що записані дні не стирали й не записували заново. Нічого не записано. Відновіть ledger.csv і run_log.csv разом з однієї копії (див. README_UA.md).`);
  }
  checkRunLog(ledger, runLog.runs);
  if (!needData) return { ledger, runLog, clockMs };

  const startDay = dateToDay(o.ruleInfo.rule.start_date);
  const need = o.ruleInfo.rule.min_closed_bars - 1;
  let bars, nowS, source, skewS = 0;
  if (o.data) {
    bars = loadCsvBars(o.data);
    nowS = o.nowMs !== null ? o.nowMs / 1000 : Infinity; // without --now every listed bar is closed
    source = SOURCE_TEST;
  } else {
    const fromDay = Math.min(startDay, Math.floor(clockMs / DAY_MS) - 1) - need;
    const got = await fetchBitstampBars(fromDay);
    bars = got.bars;
    // Use the earlier of the local clock and Bitstamp's clock, so a wrong PC clock
    // can never make an open bar look closed. The exchange clock is always known here.
    nowS = Math.min(clockMs / 1000, got.serverNowS);
    skewS = clockMs / 1000 - got.serverNowS;
    source = SOURCE_LIVE;
  }
  const series = buildSeries(bars, nowS);
  if (series.last === null) throw new PaperError('E_HISTORY', 'У даних немає жодного закритого дня. Нічого не записано.');
  requireWindow(series, Math.min(startDay, series.last) - need, series.last);
  const rows = ledger.rows;
  if (rows.length && dateToDay(rows[rows.length - 1].date) > series.last) {
    throw new PaperError('E_DATA', `Отримані дані закінчуються ${dayToDate(series.last)}, а журнал уже має ${rows[rows.length - 1].date}. Перевірити нічого не можна. Нічого не записано.`);
  }
  const check = verifyRows(rows, o.ruleInfo, series, source);
  return { ledger, runLog, series, source, check, clockMs, startDay, skewS };
}

function lastRunMs(runs) {
  return runs.length ? runs[runs.length - 1].atMs : null;
}

function skewNote(skewS) {
  if (Math.abs(skewS) <= CLOCK_SKEW_NOTE_S) return null;
  return `Увага: годинник цього комп’ютера ${skewS > 0 ? 'поспішає' : 'відстає'} відносно часу біржі приблизно на ${Math.round(Math.abs(skewS) / 60)} хв. Програма бере раніший із двох часів, тому зайвого не запише. Годинник варто виправити.`;
}

async function cmdUpdate(o, say) {
  const { ledger, runLog, series, source, check, clockMs, startDay, skewS } = await loadAndCheck(o, true);
  const rows = ledger.rows.slice();
  const before = rows.length;
  const ctx = { rule: o.ruleInfo.rule, ruleHash: o.ruleInfo.hash, source };
  const firstNew = before ? dateToDay(rows[before - 1].date) + 1 : startDay;
  for (let day = firstNew; day <= series.last; day++) {
    if (source === SOURCE_LIVE) requirePlausible(series, day, o.ruleInfo.rule);
    rows.push(deriveRow(rows.length ? rows[rows.length - 1] : null, dayInputs(series, day), ctx));
  }
  const added = rows.slice(before);
  const tol = o.ruleInfo.rule.revision_tolerance;
  const noteLines = check.notes.length ? describeNotes(ledger.rows, check, tol, 10) : [];
  const noteDates = [...new Set(check.notes.map((n) => n.date))];
  const extraWarnings = noteDates.length
    ? [`У ${noteDates.length} записаних днях біржа тепер показує трохи інші ціни, ніж у журналі (${noteDates.slice(0, 5).join(', ')}${noteDates.length > 5 ? ' та інші' : ''}). Різниця в межах допуску ${(tol * 100).toFixed(2)}%, рішення правила ті самі, записи не змінювалися. Подробиці: node paper_trade.js verify.`]
    : [];

  // Old bytes are kept as they are; new rows are only appended. The ledger is written before
  // the run-log entry: the run log must never claim rows that are not on disk. The run log
  // itself (header only) is created before the first row, because a ledger with rows and no
  // run log is refused.
  if (runLog.text === null) writeAtomic(o.runLog, RUN_LOG_HEADER + '\n');
  if (!ledger.exists || added.length) {
    writeAtomic(o.ledger, (ledger.exists ? ledger.text : HEADER + '\n') + added.map((r) => r.line + '\n').join(''));
  }
  const last = rows.length ? rows[rows.length - 1] : null;
  const status = renderStatus(rows, o.ruleInfo, clockMs, clockMs, { test: o.test, extraWarnings });
  try {
    if (!fs.existsSync(o.ruleFile)) writeAtomic(o.ruleFile, o.ruleInfo.json);
    writeAtomic(o.runLog, (runLog.text === null ? RUN_LOG_HEADER + '\n' : runLog.text)
      + [new Date(clockMs).toISOString(), 'update', before, rows.length, last ? last.date : '', last ? last.row_sha256 : ''].join(',') + '\n');
    writeAtomic(o.statusFile, status);
  } catch (e) {
    if (!(e instanceof PaperError) || e.code !== 'E_WRITE') throw e;
    throw new PaperError('E_WRITE', `${e.message} ${added.length ? `Сам журнал при цьому оновлено правильно: додано днів: ${added.length} (${added[0].date} … ${added[added.length - 1].date}).` : 'До журналу нічого не додавалося.'} Але файл стану STATUS_UA.md може бути старим. Запустіть update.cmd ще раз, і його буде записано.`);
  }

  say(`Дані отримано (${source === SOURCE_LIVE ? 'Bitstamp BTCUSD, день' : 'файл для перевірки'}). Останній закритий день: ${dayToDate(series.last)}.`);
  if (o.test) say('ТЕСТОВИЙ ПРОГІН: це не справжній паперовий рахунок.');
  const skew = source === SOURCE_LIVE ? skewNote(skewS) : null;
  if (skew) say(skew);
  say(`Перевірка журналу: ланцюжок цілий, записаних днів було ${before}.`);
  for (const l of noteLines) say(l);
  if (!ledger.exists) say(`Створено журнал: ${o.ledger}`);
  if (added.length === 0) say('Нових закритих днів немає. До журналу нічого не додано.');
  else say(`Додано днів: ${added.length} (${added[0].date} … ${added[added.length - 1].date}).`);
  for (const r of added.slice(-10)) {
    const trade = r.trade === 'BUY' ? 'купівля за відкриттям' : r.trade === 'SELL' ? 'продаж за відкриттям' : 'без угоди';
    say(`  ${r.date}: закриття ${r.close.toFixed(2)}, ${trade}, рахунок ${fmtUsd(r.equity)} USD, на завтра: ${r.target_next ? 'тримати BTC' : 'долари'}.`);
  }
  if (rows.length === 0 && series.last < startDay) {
    const p = dayInputs(series, series.last);
    const d = decide(p.close, p.sma200, p.sma111, p.sma350);
    say(`Довідково (у журнал не записано): за закритим днем ${p.date} режим був «${d.overheated ? 'перегрів' : d.trendUp ? 'тренд угору' : 'тренд униз'}».`);
  }
  say(`Відбиток правила: ${o.ruleInfo.hash}`);
  say(`Стан записано у файл: ${o.statusFile}`);
  say('');
  say(status);
}

async function cmdVerify(o, say) {
  const { ledger, check } = await loadAndCheck(o, true);
  const n = ledger.rows.length;
  let code = 0;
  if (!ledger.exists) throw new PaperError('E_NOLEDGER', 'Журналу ще немає, перевіряти нічого. Спершу запустіть оновлення (update.cmd).');
  if (n === 0) say('OK. Журнал порожній (лише заголовок), записів для перевірки ще немає. Дані джерела доступні, правило не змінювалося.');
  else if (check.notes.length === 0) say(`OK. Перевірено ${n} записів (${ledger.rows[0].date} … ${ledger.rows[n - 1].date}): ланцюжок цілий, кожен рядок збігається з розрахунком за свіжими даними.`);
  else {
    code = EXIT_INCOMPLETE;
    say(`ЗБІГ НЕПОВНИЙ. Перевірено ${n} записів (${ledger.rows[0].date} … ${ledger.rows[n - 1].date}): ланцюжок цілий, розрахунок у кожному рядку правильний і всі рішення правила збігаються зі свіжими даними, але частина записаних цін трохи відрізняється від того, що джерело дає зараз.`);
    for (const l of describeNotes(ledger.rows, check, o.ruleInfo.rule.revision_tolerance, Infinity)) say(l);
  }
  say(`Відбиток правила: ${o.ruleInfo.hash}`);
  return code;
}

async function cmdStatus(o, say) {
  const { ledger, runLog, clockMs } = await loadAndCheck(o, false);
  if (!ledger.exists) say('Журналу ще немає. Спершу запустіть оновлення (update.cmd).\n');
  say(renderStatus(ledger.rows, o.ruleInfo, lastRunMs(runLog.runs), clockMs, { test: o.test }));
  say('Ця команда не звертається до біржі: вона перевірила лише цілість журналу і розрахунок у кожному рядку. Ціни з біржею звіряють команди update і verify.');
}

// Returns the process exit code. `say` / `complain` receive output lines.
async function main(argv, say = console.log, complain = console.error) {
  try {
    const o = parseArgs(argv);
    const code = await { update: cmdUpdate, verify: cmdVerify, status: cmdStatus }[o.cmd](o, say);
    return code || 0;
  } catch (e) {
    if (e instanceof PaperError) { complain(`ПОМИЛКА [${e.code}]: ${e.message}`); return 1; }
    complain(`ПОМИЛКА [E_INTERNAL]: несподіваний збій програми: ${e && e.stack ? e.stack : e}`);
    return 2;
  }
}

module.exports = { FROZEN_RULE, COLUMNS, HEADER, RUN_LOG_HEADER, SOURCE_LIVE, SOURCE_TEST, DEFAULT_LEDGER, makeRule, canonicalJson, sha256, decide, markDay,
  deriveRow, parseRow, judge, verdictIndex, main };

if (require.main === module) main(process.argv.slice(2)).then((code) => { process.exitCode = code; });
