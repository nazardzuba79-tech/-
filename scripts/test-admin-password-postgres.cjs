// Uses a new disposable loopback cluster. Never reads production database URLs.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const net = require('node:net');
const { once } = require('node:events');
const { spawnSync } = require('node:child_process');
const { createRequire } = require('node:module');

const qa = createRequire(path.resolve('node_modules/.cache/deposit-qa/package.json'));

async function run() {
  const bin = qa(process.platform === 'win32' ? '@embedded-postgres/windows-x64' : '@embedded-postgres/linux-x64');
  const probe = net.createServer().listen(0, '127.0.0.1');
  await once(probe, 'listening');
  const port = probe.address().port;
  await new Promise(resolve => probe.close(resolve));
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'voltex-admin-password-'));
  const data = path.join(folder, 'data');
  const init = spawnSync(bin.initdb, ['-D', data, '-U', 'postgres', '-A', 'trust', '--encoding=UTF8', '--locale=C'], { windowsHide: true, encoding: 'utf8' });
  if (init.status !== 0) throw new Error(init.stderr || 'Disposable PostgreSQL init failed');
  const start = spawnSync(bin.pg_ctl, ['-D', data, '-l', path.join(folder, 'postgres.log'), '-o', `-h 127.0.0.1 -p ${port}`, 'start', '-w'], { windowsHide: true, stdio: 'ignore' });
  if (start.status !== 0) throw new Error('Disposable PostgreSQL startup failed');

  let sql;
  try {
    sql = new (qa('pg').Client)({ host: '127.0.0.1', port, user: 'postgres', database: 'postgres' });
    await sql.connect();
    await sql.query('CREATE DATABASE voltex_admin_password_test');
    await sql.end();
    sql = new (qa('pg').Client)({ host: '127.0.0.1', port, user: 'postgres', database: 'voltex_admin_password_test' });
    await sql.connect();
    for (const name of fs.readdirSync('prisma/migrations').sort()) {
      const file = path.join('prisma/migrations', name, 'migration.sql');
      if (fs.existsSync(file)) await sql.query(fs.readFileSync(file, 'utf8'));
    }
    const test = spawnSync(process.execPath,
      ['node_modules/jest/bin/jest.js', '--runInBand', '--forceExit', '--silent', '--runTestsByPath', 'src/api/routes/__tests__/adminPasswordVault.pg.test.ts'],
      { windowsHide: true, encoding: 'utf8', maxBuffer: 8e6, timeout: 120000,
        env: { ...process.env, ADMIN_PASSWORD_TEST_URL: `postgresql://postgres@127.0.0.1:${port}/voltex_admin_password_test` } });
    if (test.stdout) process.stdout.write(test.stdout);
    if (test.stderr) process.stderr.write(test.stderr);
    process.exitCode = test.status ?? 1;
  } finally {
    await sql?.end().catch(() => {});
    spawnSync(bin.pg_ctl, ['-D', data, 'stop', '-m', 'fast', '-w'], { windowsHide: true, stdio: 'ignore' });
  }
}

run().catch(error => { console.error(error); process.exitCode = 1; });
