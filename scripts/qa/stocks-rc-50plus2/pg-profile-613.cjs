'use strict';
// Report only. Reads one or more `diagnostic-run-613.cjs --after --pg-profile` outputs (postgres-profile.log,
// <arm>-result.json, <arm>-pg-stats.json) and says, per arm, what PostgreSQL did while each crypto request was
// in flight: lock waits (with the holder's process), statements over 2 ms (by process and kind), checkpoints and
// autovacuum, plus the trader requests that overlapped it. The slowest 5 % of crypto requests are compared with
// all crypto requests, so a cause shows up as over-represented among the slow ones. Never a p95 verdict.
// Usage: node pg-profile-613.cjs <outDir>... [--json out.json]
const fs = require('node:fs'), path = require('node:path');
const {percentile} = require('./policy.cjs');

const LINE = /^(\d{4}-\d\d-\d\d \d\d:\d\d:\d\d\.\d{3}) (\S+) \[(\d+)\] (\S*) ?(LOG|DETAIL|STATEMENT|CONTEXT|HINT|ERROR|WARNING|FATAL|PANIC):\s+(.*)$/;
const APPS = {rc50_crypto_api: 'crypto', rc50_stocks_authority: 'stocks'};
const ARMS = ['baseline', 'mixed'];

function parseLog(text) {
  const entries = [];
  for (const raw of text.split('\n')) {
    const m = raw.match(LINE);
    if (m) entries.push({at: Date.parse(m[1].replace(' ', 'T') + 'Z'), zone: m[2], pid: Number(m[3]), app: m[4], level: m[5], message: m[6]});
    else if (entries.length && /^\s/.test(raw)) entries[entries.length - 1].message += ' ' + raw.trim();
  }
  if (entries.some(e => e.zone !== 'UTC')) throw Error('PG_LOG_TIMEZONE_NOT_UTC');
  const pids = new Map(), statements = [], waits = [], events = [];
  for (let i = 0; i < entries.length; i++) {
    const e = entries[i], next = kind => entries.slice(i + 1, i + 4).find(x => x.pid === e.pid && x.level === kind)?.message;
    let m;
    if ((m = e.message.match(/^connection authorized: user=\S+ database=(\S+) application_name=(\S+)/))) pids.set(e.pid, {database: m[1], app: APPS[m[2]] ?? m[2]});
    else if ((m = e.message.match(/^duration: ([\d.]+) ms {2}(statement|(?:execute|parse|bind) [^:]*): (.*)$/))) {
      const ms = Number(m[1]), phase = m[2].split(' ')[0], sql = m[3];
      statements.push({pid: e.pid, start: e.at - ms, end: e.at, ms, phase, kind: statementKind(sql)});
    } else if ((m = e.message.match(/^process (\d+) still waiting for (\S+) on (.+) after ([\d.]+) ms/))) {
      const holder = (next('DETAIL') ?? '').match(/Process(?:es)? holding the lock: ([\d, ]+)\./), relation = (next('CONTEXT') ?? '').match(/in relation "([^"]+)"/);
      waits.push({pid: Number(m[1]), mode: m[2], object: m[3], start: e.at - Number(m[4]), end: null, ms: null, holders: holder ? holder[1].split(',').map(x => Number(x.trim())) : [], relation: relation?.[1] ?? null});
    } else if ((m = e.message.match(/^process (\d+) acquired (\S+) on (.+) after ([\d.]+) ms/))) {
      const w = [...waits].reverse().find(x => x.pid === Number(m[1]) && x.object === m[3] && x.end === null);
      if (w) { w.end = e.at; w.ms = Number(m[4]); w.start = e.at - w.ms; }
    } else if (/^checkpoint (starting|complete)/.test(e.message) || /^automatic (vacuum|analyze)/.test(e.message)) {
      events.push({pid: e.pid, at: e.at, kind: e.message.startsWith('checkpoint') ? 'checkpoint' : 'autovacuum', message: e.message.slice(0, 160)});
    }
  }
  // A wait never acquired within the log (e.g. cancelled) keeps its known lower bound.
  for (const w of waits) if (w.end === null) { w.end = w.start + 1; w.ms = 1; w.unfinished = true; }
  return {pids, statements, waits, events};
}

function statementKind(sql) {
  const s = sql.replace(/\s+/g, ' ').trim(), word = s.split(' ')[0].toUpperCase();
  const table = (s.match(/(?:FROM|INTO|UPDATE) "?(?:public"?\."?)?"?(\w+)"?/i) ?? [])[1];
  return ['COMMIT', 'BEGIN', 'ROLLBACK'].includes(word) ? word : word + (table ? ' ' + table : '') + (/FOR (NO KEY )?UPDATE/i.test(s) ? ' FOR UPDATE' : '');
}

const overlaps = (a0, a1, b0, b1) => a0 < b1 && b0 < a1;
const share = (part, all) => all ? Math.round(part / all * 1000) / 10 : null;

function arm(log, out, name) {
  const file = path.join(out, name + '-result.json');
  if (!fs.existsSync(file)) return null;
  const r = JSON.parse(fs.readFileSync(file, 'utf8')), t0 = Date.parse(r.startedAt);
  if (!Number.isFinite(t0) || !Array.isArray(r.samples)) throw Error('ARM_RESULT_INVALID_' + name);
  const database = db => db?.endsWith('_' + name);
  const of = pid => log.pids.get(pid) ?? {app: 'unknown', database: null};
  const statements = log.statements.filter(s => database(of(s.pid).database)).map(s => ({...s, app: of(s.pid).app}));
  const waits = log.waits.filter(w => database(of(w.pid).database)).map(w => ({...w, app: of(w.pid).app, holderApps: w.holders.map(h => of(h).app)}));
  const requests = r.samples.map(x => ({...x, start: t0 + x.at, end: t0 + x.at + x.ms}));
  const crypto = requests.filter(x => x.kind === 'crypto'), p95 = percentile(crypto.map(x => x.ms), .95), slow = crypto.filter(x => x.ms >= p95);
  const traders = requests.filter(x => x.kind === 'trader');
  const features = q => {
    const w = waits.filter(x => x.app === 'crypto' && overlaps(q.start, q.end, x.start, x.end));
    const own = statements.filter(x => x.app === 'crypto' && overlaps(q.start, q.end, x.start, x.end));
    return {
      lockWait: w.length > 0, lockWaitOnStocks: w.some(x => x.holderApps.includes('stocks')), lockWaitMs: w.reduce((t, x) => t + x.ms, 0),
      slowStatement: own.length > 0, slowCommit: own.some(x => x.kind === 'COMMIT'), slowStatementMs: own.reduce((t, x) => t + x.ms, 0),
      stocksStatement: statements.some(x => x.app === 'stocks' && overlaps(q.start, q.end, x.start, x.end)),
      checkpointOrVacuum: log.events.some(x => x.at >= q.start - 1000 && x.at <= q.end + 1000),
      trader0: traders.some(x => x.index === 0 && overlaps(q.start, q.end, x.start, x.end)),
      trader0Command: traders.some(x => x.index === 0 && x.op !== 'state' && overlaps(q.start, q.end, x.start, x.end)),
    };
  };
  const rate = (set, key) => share(set.filter(q => features(q)[key]).length, set.length);
  const keys = ['lockWait', 'lockWaitOnStocks', 'slowStatement', 'slowCommit', 'stocksStatement', 'checkpointOrVacuum', 'trader0', 'trader0Command'];
  const pgShareOfSlow = slow.length ? slow.reduce((t, q) => t + Math.min(q.ms, features(q).slowStatementMs + features(q).lockWaitMs), 0) / slow.reduce((t, q) => t + q.ms, 0) : null;
  const byKind = list => Object.entries(list.reduce((m, s) => { const k = s.app + ' ' + s.kind; (m[k] ??= []).push(s.ms); return m; }, {}))
    .map(([kind, ms]) => ({kind, count: ms.length, totalMs: Math.round(ms.reduce((a, b) => a + b, 0) * 10) / 10, p95Ms: percentile(ms, .95)})).sort((a, b) => b.totalMs - a.totalMs).slice(0, 12);
  const cryptoWaits = waits.filter(w => w.app === 'crypto');
  let stats = null;
  try { stats = JSON.parse(fs.readFileSync(path.join(out, name + '-pg-stats.json'), 'utf8')); } catch {}
  const delta = (k, o = 'wal') => stats?.before?.[o] && stats?.after?.[o] ? Number(stats.after[o][k]) - Number(stats.before[o][k]) : null;
  return {
    arm: name, cryptoRequests: crypto.length, cryptoP95Ms: p95, slowRequests: slow.length,
    rates: {all: Object.fromEntries(keys.map(k => [k, rate(crypto, k)])), slowest5: Object.fromEntries(keys.map(k => [k, rate(slow, k)]))},
    pgTimeShareOfSlowRequests: pgShareOfSlow === null ? null : Math.round(pgShareOfSlow * 1000) / 10,
    cryptoLockWaits: {count: cryptoWaits.length, onStocksHolder: cryptoWaits.filter(w => w.holderApps.includes('stocks')).length,
      totalMs: Math.round(cryptoWaits.reduce((t, w) => t + w.ms, 0) * 10) / 10, maxMs: cryptoWaits.reduce((m, w) => Math.max(m, w.ms), 0),
      relations: [...new Set(cryptoWaits.map(w => w.relation ?? w.object))]},
    stocksLockWaits: waits.filter(w => w.app === 'stocks').length,
    slowStatements: byKind(statements),
    checkpointsOrVacuum: log.events.filter(e => e.at >= t0 && e.at <= t0 + 20000).map(e => e.kind + ': ' + e.message),
    wal: stats ? {records: delta('wal_records'), syncs: delta('wal_sync'), syncMs: delta('wal_sync_time'), writes: delta('wal_write'), writeMs: delta('wal_write_time'),
      commits: delta('xact_commit', 'database'), blockReadMs: delta('blk_read_time', 'database')} : null,
  };
}

function profile(dirs) {
  return dirs.map(out => {
    const logFile = path.join(out, 'postgres-profile.log');
    if (!fs.existsSync(logFile)) return {out: path.basename(out), error: 'PG_PROFILE_LOG_MISSING'};
    const log = parseLog(fs.readFileSync(logFile, 'utf8'));
    return {out: path.basename(path.dirname(out)) + '/' + path.basename(out), connections: log.pids.size, arms: Object.fromEntries(ARMS.map(a => [a, arm(log, out, a)]))};
  });
}

function markdown(runs) {
  const f = x => x === null || x === undefined ? '—' : typeof x === 'number' ? String(Math.round(x * 100) / 100) : String(x);
  const lines = ['PostgreSQL profile of crypto requests (report only, logging on in both arms; not a p95 verdict).', ''];
  for (const run of runs) {
    if (run.error) { lines.push(`${run.out}: ${run.error}`); continue; }
    lines.push(`**${run.out}**`, '', '| arm | crypto p95 ms | share of all / slowest 5 % with: crypto lock wait | … held by Stocks | crypto statement ≥2 ms | crypto COMMIT ≥2 ms | Stocks statement ≥2 ms | trader 0 command | checkpoint/vacuum | PG share of slow time % | WAL syncs / ms | crypto lock waits (on Stocks) total ms |', '|---|---|---|---|---|---|---|---|---|---|---|---|');
    for (const a of Object.values(run.arms)) if (a) {
      const pair = k => `${f(a.rates.all[k])} / ${f(a.rates.slowest5[k])}`;
      lines.push(`| ${a.arm} | ${f(a.cryptoP95Ms)} | ${pair('lockWait')} | ${pair('lockWaitOnStocks')} | ${pair('slowStatement')} | ${pair('slowCommit')} | ${pair('stocksStatement')} | ${pair('trader0Command')} | ${pair('checkpointOrVacuum')} | ${f(a.pgTimeShareOfSlowRequests)} | ${f(a.wal?.syncs)} / ${f(a.wal?.syncMs)} | ${a.cryptoLockWaits.count} (${a.cryptoLockWaits.onStocksHolder}) ${f(a.cryptoLockWaits.totalMs)} |`);
    }
    for (const a of Object.values(run.arms)) if (a) lines.push('', `${a.arm} statements ≥2 ms: ` + a.slowStatements.map(s => `${s.kind} ×${s.count} (${s.totalMs} ms)`).join('; '));
    lines.push('');
  }
  return lines.join('\n');
}

module.exports = {parseLog, statementKind, profile, markdown};

if (require.main === module) {
  const argv = process.argv.slice(2), j = argv.indexOf('--json'), json = j >= 0 ? argv.splice(j, 2)[1] : null;
  const runs = profile(argv);
  console.log(markdown(runs));
  if (json) fs.writeFileSync(json, JSON.stringify(runs, null, 2));
}
