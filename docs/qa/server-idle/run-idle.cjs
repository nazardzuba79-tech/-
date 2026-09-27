'use strict';
// Boots one real backend build against its own local PostgreSQL database,
// leaves it completely idle (no HTTP requests at all), and counts every SQL
// statement PostgreSQL executed for that database during the window, from
// the server log (log_statement = 'all'). This is a LOCAL measurement: it is
// not Neon, and not Neon billing.
//
//   node run-idle.cjs <label> <distDir> <db> <port> <minutes> [extraEnvJson]
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const [label, distDir, db, port, minutes, extra] = process.argv.slice(2);
const LOG = '/var/log/postgresql/postgresql-16-main.log';
const out = path.join(__dirname, `result-${label}.json`);
const url = `postgresql://postgres:postgres@127.0.0.1:5432/${db}`;
const env = {
  ...process.env,
  NODE_ENV: 'production',
  NODE_PATH: '/home/user/-/node_modules',
  DATABASE_URL: url, DIRECT_URL: url,
  PORT: String(port),
  JWT_SECRET: 'idle-measurement-secret-not-used-anywhere-0123456789',
  API_KEY_ENCRYPTION_SECRET: '0000000000000000000000000000000000000000000000000000000000000001',
  ALLOWED_ORIGINS: 'http://localhost',
  // Production-like switches: demo trading on, collector configured (so the
  // native limit pass exists), CFD configured (so its sweep queries).
  PRIVATE_TRADING_ENABLED: 'true',
  PRIVATE_TRADING_OWNER_ID: '00000000-0000-4000-8000-00000000a11a',
  MARKET_DATA_COLLECTOR_URL: 'http://127.0.0.1:4599',
  MARKET_DATA_COLLECTOR_TOKEN: 'stub',
  TWELVE_DATA_API_KEY: 'stub-key',
  KRAKEN_API_BASE_URL: 'http://127.0.0.1:4599',
  COINGECKO_API_BASE_URL: 'http://127.0.0.1:4599',
  FEAR_GREED_API_BASE_URL: 'http://127.0.0.1:4599',
  BINANCE_FUTURES_API_BASE_URL: 'http://127.0.0.1:4599',
  OKX_API_BASE_URL: 'http://127.0.0.1:4599',
  DERIBIT_API_BASE_URL: 'http://127.0.0.1:4599',
  BINANCE_LIQUIDATION_WS_URL: 'ws://127.0.0.1:4599/ws',
  ...(extra ? JSON.parse(extra) : {}),
};
const startOffset = fs.statSync(LOG).size;
const startedAt = new Date();
const child = spawn(process.execPath, [path.join(distDir, 'index.js')], { env, stdio: ['ignore', 'pipe', 'pipe'] });
let stdout = '';
child.stdout.on('data', d => { stdout += d; });
child.stderr.on('data', d => { stdout += d; });
const ms = Number(minutes) * 60_000;
setTimeout(() => {
  child.kill('SIGTERM');
  setTimeout(() => {
    const endedAt = new Date();
    const fd = fs.openSync(LOG, 'r');
    const size = fs.statSync(LOG).size;
    const buf = Buffer.alloc(size - startOffset);
    fs.readSync(fd, buf, 0, buf.length, startOffset);
    const lines = buf.toString('utf8').split('\n');
    const re = new RegExp(`^(\\S+ \\S+) UTC \\[\\d+\\] db=${db} LOG:  (?:statement|execute [^:]*): (.*)$`);
    // A statement may span lines ($queryRaw templates start with a newline):
    // continuation lines carry no log prefix, so fold them into the statement
    // they follow. DETAIL/other prefixed lines end the statement.
    const stmts = [];
    let current = null;
    for (const line of lines) {
      const m = line.match(re);
      if (m) { current = { at: m[1], sql: m[2] }; stmts.push(current); continue; }
      if (/^\d{4}-\d\d-\d\d /.test(line)) { current = null; continue; }
      if (current && current.sql.trim() === '') current.sql = line.trim();
    }
    const kind = s => {
      const k = s.trim().split(/\s+/)[0].toUpperCase();
      return ['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'BEGIN', 'COMMIT', 'ROLLBACK'].includes(k) ? k : k === 'WITH' ? 'SELECT' : 'OTHER';
    };
    const byKind = {};
    const shapes = {};
    const perMinute = {};
    for (const s of stmts) {
      const k = kind(s.sql);
      byKind[k] = (byKind[k] || 0) + 1;
      const shape = s.sql.replace(/\$\d+/g, '?').replace(/'[^']*'/g, "'?'").slice(0, 140);
      shapes[shape] = (shapes[shape] || 0) + 1;
      const minute = Math.floor((new Date(s.at.replace(' ', 'T') + 'Z') - startedAt) / 60_000);
      perMinute[minute] = (perMinute[minute] || 0) + 1;
    }
    const reads = (byKind.SELECT || 0);
    const writes = (byKind.INSERT || 0) + (byKind.UPDATE || 0) + (byKind.DELETE || 0);
    const result = {
      label, db, distDir, startedAt, endedAt, minutes: Number(minutes),
      statements: stmts.length, reads, writes, byKind,
      topShapes: Object.entries(shapes).sort((a, b) => b[1] - a[1]).slice(0, 25),
      perMinute,
      serverLogTail: stdout.split('\n').slice(-25),
    };
    fs.writeFileSync(out, JSON.stringify(result, null, 2));
    console.log(JSON.stringify({ label, statements: stmts.length, reads, writes, byKind }, null, 0));
    process.exit(0);
  }, 3000);
}, ms);
