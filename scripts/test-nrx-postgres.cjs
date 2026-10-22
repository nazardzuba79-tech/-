// Creates a NEW disposable loopback cluster. Never reads DATABASE_URL or production credentials.
const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), net = require('node:net');
const { once } = require('node:events');
const { spawnSync } = require('node:child_process');
const { createRequire } = require('node:module');
const qa = createRequire(path.resolve('node_modules/.cache/deposit-qa/package.json'));
async function run() {
  const bin = qa(process.platform === 'win32' ? '@embedded-postgres/windows-x64' : '@embedded-postgres/linux-x64');
  const probe = net.createServer().listen(0, '127.0.0.1'); await once(probe, 'listening');
  const port = probe.address().port; await new Promise(resolve => probe.close(resolve));
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'voltex-nrx-'));
  const data = path.join(folder, 'data');
  const init = spawnSync(bin.initdb, ['-D', data, '-U', 'postgres', '-A', 'trust', '--encoding=UTF8', '--locale=C'], { windowsHide: true, encoding: 'utf8' });
  if (init.status !== 0) throw new Error(init.stderr);
  const start = spawnSync(bin.pg_ctl, ['-D', data, '-l', path.join(folder, 'postgres.log'), '-o', `-h 127.0.0.1 -p ${port}`, 'start', '-w'], { windowsHide: true, stdio: 'ignore' });
  if (start.status !== 0) throw new Error('Disposable PostgreSQL startup failed');
  let sql;
  try {
    const groups = [{ database: 'voltex_nrx_test', variable: 'VOLTEX_NRX_TEST_URL', tests: ['src/services/testMarkets/__tests__/nrxSpot.pg.test.ts'] }];
    if (process.argv.includes('--listings-audit')) groups.push(
      { database: 'voltex_listing_test', variable: 'VOLTEX_LISTING_TEST_URL', tests: ['src/services/listings/__tests__/ownerAllocation.pg.test.ts'] },
      { database: 'voltex_vta_test', variable: 'VOLTEX_PG_TEST_URL', tests: ['src/services/testMarkets/__tests__/vtaDemoSales.pg.test.ts', 'src/services/testMarkets/__tests__/vtaNativeCoexistence.pg.test.ts'] },
    );
    // Separate freshly-created databases keep each suite's ledger fixtures isolated.
    // Names and connection destinations are fixed here; inherited database URLs are never used.
    for (const group of groups) {
      sql = new (qa('pg').Client)({ host: '127.0.0.1', port, user: 'postgres', database: 'postgres' });
      await sql.connect(); await sql.query(`CREATE DATABASE ${group.database}`); await sql.end();
      sql = new (qa('pg').Client)({ host: '127.0.0.1', port, user: 'postgres', database: group.database }); await sql.connect();
      for (const name of fs.readdirSync('prisma/migrations').sort()) {
        const file = path.join('prisma/migrations', name, 'migration.sql');
        if (fs.existsSync(file)) await sql.query(fs.readFileSync(file, 'utf8'));
      }
      const url = `postgresql://postgres@127.0.0.1:${port}/${group.database}`;
      const result = spawnSync(process.execPath, ['node_modules/jest/bin/jest.js', '--runInBand', '--silent', '--runTestsByPath', ...group.tests], {
        windowsHide: true, stdio: 'inherit', env: { ...process.env, DATABASE_URL: url, DIRECT_URL: url, [group.variable]: url },
      });
      await sql.end(); sql = null;
      if (result.status !== 0) { process.exitCode = result.status ?? 1; break; }
    }
  } finally {
    await sql?.end().catch(() => {});
    spawnSync(bin.pg_ctl, ['-D', data, 'stop', '-m', 'fast', '-w'], { windowsHide: true, stdio: 'ignore' });
    // Retain temporary evidence; no broad filesystem deletion.
  }
}
run().catch(error => { console.error(error); process.exitCode = 1; });
