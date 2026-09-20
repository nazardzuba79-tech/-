const http = require('http');
const { PrismaClient, Prisma } = require('@prisma/client');

const sourceUrl = process.env.SOURCE_DATABASE_URL;
const targetUrl = process.env.TARGET_DATABASE_URL;
if (!sourceUrl || !targetUrl) throw new Error('SOURCE_DATABASE_URL and TARGET_DATABASE_URL are required');

const source = new PrismaClient({ datasources: { db: { url: sourceUrl } } });
const target = new PrismaClient({ datasources: { db: { url: targetUrl } } });

const modelMeta = Prisma.dmmf.datamodel.models;
const delegate = name => name[0].toLowerCase() + name.slice(1);

function topoOrder() {
  const names = new Set(modelMeta.map(m => m.name));
  const deps = new Map();
  for (const m of modelMeta) {
    const d = new Set();
    for (const f of m.fields) {
      if (f.kind === 'object' && Array.isArray(f.relationFromFields) && f.relationFromFields.length && f.type !== m.name && names.has(f.type)) d.add(f.type);
    }
    deps.set(m.name, d);
  }
  const result = [], pending = new Set(names);
  while (pending.size) {
    const ready = [...pending].filter(n => [...deps.get(n)].every(d => !pending.has(d)));
    if (!ready.length) throw new Error('Relation cycle among models: ' + [...pending].join(', '));
    ready.sort();
    for (const n of ready) { result.push(n); pending.delete(n); }
  }
  return result;
}

async function tableNames(db) {
  return db.$queryRawUnsafe("SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename");
}

async function ensureMigrationTable() {
  await target.$executeRawUnsafe(\`
    CREATE TABLE IF NOT EXISTS "_prisma_migrations" (
      "id" VARCHAR(36) PRIMARY KEY NOT NULL,
      "checksum" VARCHAR(64) NOT NULL,
      "finished_at" TIMESTAMPTZ,
      "migration_name" VARCHAR(255) NOT NULL,
      "logs" TEXT,
      "rolled_back_at" TIMESTAMPTZ,
      "started_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
      "applied_steps_count" INTEGER NOT NULL DEFAULT 0
    )
  \`);
}

async function copyPrismaMigrations() {
  await ensureMigrationTable();
  const existing = await target.$queryRawUnsafe('SELECT count(*)::int AS n FROM "_prisma_migrations"');
  if (existing[0].n !== 0) throw new Error('Target _prisma_migrations is not empty');
  const rows = await source.$queryRawUnsafe('SELECT * FROM "_prisma_migrations" ORDER BY started_at, id');
  for (const r of rows) {
    await target.$executeRawUnsafe(
      'INSERT INTO "_prisma_migrations" ("id","checksum","finished_at","migration_name","logs","rolled_back_at","started_at","applied_steps_count") VALUES ($1,$2,$3,$4,$5,$6,$7,$8)',
      r.id, r.checksum, r.finished_at, r.migration_name, r.logs, r.rolled_back_at, r.started_at, r.applied_steps_count
    );
  }
  return rows.length;
}

async function main() {
  console.log('NEON_MIGRATION_START');
  await source.$connect();
  await target.$connect();

  const srcTables = (await tableNames(source)).map(r => r.tablename);
  const dstTables = (await tableNames(target)).map(r => r.tablename);
  const modelTables = new Set(modelMeta.map(m => m.dbName || m.name));
  const ignored = new Set(['_prisma_migrations']);
  const sourceExtras = srcTables.filter(t => !modelTables.has(t) && !ignored.has(t));
  const targetExtras = dstTables.filter(t => !modelTables.has(t) && !ignored.has(t));
  if (sourceExtras.length || targetExtras.length) {
    throw new Error('Unmodelled tables detected. source=' + JSON.stringify(sourceExtras) + ' target=' + JSON.stringify(targetExtras));
  }

  const order = topoOrder();
  console.log('MODEL_ORDER ' + order.join(','));

  for (const name of order) {
    const d = delegate(name);
    const n = await target[d].count();
    if (n !== 0) throw new Error('Target model not empty before migration: ' + name + '=' + n);
  }

  const copied = {};
  for (const name of order) {
    const d = delegate(name);
    const srcCount = await source[d].count();
    let offset = 0;
    const batch = 250;
    while (offset < srcCount) {
      const rows = await source[d].findMany({ skip: offset, take: batch });
      if (!rows.length) break;
      const res = await target[d].createMany({ data: rows });
      if (res.count !== rows.length) throw new Error('Short createMany for ' + name);
      offset += rows.length;
    }
    const dstCount = await target[d].count();
    if (dstCount !== srcCount) throw new Error('Count mismatch ' + name + ': source=' + srcCount + ' target=' + dstCount);
    copied[name] = dstCount;
    console.log('COPIED ' + name + ' ' + dstCount);
  }

  const migrationRows = await copyPrismaMigrations();

  const verify = {};
  for (const name of order) {
    const d = delegate(name);
    const a = await source[d].count();
    const b = await target[d].count();
    if (a !== b) throw new Error('Final count mismatch ' + name + ': source=' + a + ' target=' + b);
    verify[name] = b;
  }

  await target.$executeRawUnsafe(\`
    CREATE TABLE IF NOT EXISTS "__voltex_neon_migration_marker" (
      "id" TEXT PRIMARY KEY,
      "completedAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
      "sourceProject" TEXT NOT NULL,
      "targetProject" TEXT NOT NULL,
      "summary" JSONB NOT NULL
    )
  \`);
  await target.$executeRawUnsafe(
    'INSERT INTO "__voltex_neon_migration_marker" ("id","sourceProject","targetProject","summary") VALUES ($1,$2,$3,$4::jsonb)',
    '2026-09-20-prod-move',
    'icy-union-39901311',
    'steep-night-37181865',
    JSON.stringify({ models: verify, prismaMigrations: migrationRows })
  );

  console.log('NEON_MIGRATION_COMPLETE ' + JSON.stringify({ models: verify, prismaMigrations: migrationRows }));
}

let status = 'running', detail = '';
main().then(() => { status = 'complete'; detail = 'ok'; })
  .catch(err => { status = 'failed'; detail = err && err.stack ? err.stack : String(err); console.error('NEON_MIGRATION_FAILED', detail); })
  .finally(async () => { await Promise.allSettled([source.$disconnect(), target.$disconnect()]); });

const port = Number(process.env.PORT || 10000);
http.createServer((req, res) => {
  res.writeHead(status === 'failed' ? 500 : status === 'complete' ? 200 : 202, {'content-type':'application/json'});
  res.end(JSON.stringify({ status, detail: status === 'failed' ? detail.slice(0, 4000) : detail }));
}).listen(port, '0.0.0.0', () => console.log('migration status server on', port));
