'use strict';

// Run only in the candidate container with the existing read-only secret mount.
// Unlike runtime-bootstrap.cjs, this never starts the API or collector.
const fs = require('node:fs');
const { spawnSync } = require('node:child_process');
const MIGRATION = '20261015090000_kyc_material_requests';

function plan(argv, env) {
  if (argv.length !== 1 || !['status', 'deploy'].includes(argv[0])) {
    throw new Error('Only explicit status or deploy is supported');
  }
  if (env.VOLTEX_RUNTIME_MODE !== 'production') throw new Error('Wrong runtime mode');
  if (!/^[a-f0-9]{40}$/.test(env.VOLTEX_RELEASE_SHA || '')) throw new Error('Missing exact release SHA');
  if (argv[0] === 'deploy') {
    if (env.KYC_APPROVED_RELEASE_SHA !== env.VOLTEX_RELEASE_SHA) throw new Error('Release approval does not match');
    if (!/^[a-f0-9]{64}$/.test(env.KYC_VERIFIED_BACKUP_SHA256 || '')) throw new Error('Verified backup receipt required');
  }
  return argv[0];
}

function checkLedger(rows, localMigrations) {
  if (rows.some(row => !row.finished_at && !row.rolled_back_at)) throw new Error('Unresolved failed migration');
  const applied = new Set(rows.filter(row => row.finished_at && !row.rolled_back_at).map(row => row.migration_name));
  if ([...applied].some(name => !localMigrations.includes(name))) throw new Error('Applied migration absent from candidate');
  const pending = localMigrations.filter(name => !applied.has(name));
  if (pending.length !== 1 || pending[0] !== MIGRATION) {
    throw new Error('Expected only the KYC migration pending; do not retry an unknown outcome');
  }
}

function redact(text, password, url) {
  let safe = String(text).split(url).join('[redacted connection]');
  for (const value of [password, encodeURIComponent(password)]) {
    if (value) safe = safe.split(value).join('[redacted]');
  }
  return safe.replace(/postgres(?:ql)?:\/\/[^\s"']+/gi, '[redacted connection]');
}

async function main() {
  const action = plan(process.argv.slice(2), process.env);
  if (!fs.existsSync('/run/voltex-cutover-authorized')) throw new Error('Missing existing cutover marker');
  const password = fs.readFileSync('/run/secrets/database_password', 'utf8').trim();
  if (!password) throw new Error('Empty mounted database credential');
  const url = `postgresql://neondb_owner:${encodeURIComponent(password)}@db:5432/voltex_stage?schema=public`;
  const env = { ...process.env, DATABASE_URL: url, DIRECT_URL: url };
  if (action === 'deploy') {
    const { PrismaClient } = require('/app/node_modules/@prisma/client');
    const db = new PrismaClient({ datasources: { db: { url } }, log: [] });
    try {
      const rows = await db.$queryRawUnsafe('SELECT migration_name, finished_at, rolled_back_at FROM "_prisma_migrations"');
      const local = fs.readdirSync('/app/prisma/migrations', { withFileTypes: true })
        .filter(entry => entry.isDirectory()).map(entry => entry.name).sort();
      checkLedger(rows, local);
      const tables = await db.$queryRawUnsafe("SELECT to_regclass('public.\"KycMaterialRequest\"')::text AS name");
      if (tables[0]?.name) throw new Error('KYC table already exists; inspect before retrying');
    } catch (error) {
      // Do not emit ORM diagnostics, which can contain connection details.
      if (/^(Unresolved|Applied migration|Expected only|KYC table)/.test(error.message)) throw error;
      throw new Error('Read-only migration preflight failed; inspect securely on host');
    } finally {
      await db.$disconnect();
    }
  }
  const result = spawnSync(process.execPath, ['/app/node_modules/prisma/build/index.js', 'migrate', action], {
    cwd: '/app', env, encoding: 'utf8', timeout: 120000, maxBuffer: 2 * 1024 * 1024,
  });
  process.stdout.write(redact(result.stdout || '', password, url));
  process.stderr.write(redact(result.stderr || '', password, url));
  if (result.error) throw new Error('Prisma command timed out or could not start; inspect ledger before retry');
  process.exitCode = result.status === 0 ? 0 : 1;
}

// Unexpected SDK/filesystem errors must not bypass the CLI output redaction.
if (require.main === module) main().catch(() => {
  console.error('Migration runner stopped; approval, backup, ledger or runtime gate failed. Inspect securely on host.');
  process.exitCode = 1;
});
module.exports = { plan, checkLedger, redact, MIGRATION };
