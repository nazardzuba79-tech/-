'use strict';
// Offline, build-context-only reconstruction. Never connects to a database.
const fs = require('node:fs');
const path = require('node:path');
const cp = require('node:child_process');
const { createHash } = require('node:crypto');

const SOURCE = 'f97b7f9c6cf9086887101db33c3daa9fb98101cc';
const BASE = '59db30e27a9803a879ca1f714055b34093bbad2a';
const MANIFEST_SHA = 'ddc65bbfdc91263cb6e79c85de9de6b8818da976c139094c851e42902e3ea3fe';
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const PENDING = Object.freeze([
  { name: '20261016000000_stocks_test_cash_authority', sha256: '0cfe2bc2e8b0c847a5da87c87db76b0e8ed214e3df4ed29f1b953c22c459a5cb' },
  { name: '20261016170000_native_funding_model', sha256: '3fb628ed357985986033bb7fdb3634fe8888f8a8e78cffa31cfafb84f78ff8d8' },
]);
function command(file, args, cwd) {
  const result = cp.spawnSync(file, args, { cwd, timeout: 120000, maxBuffer: 16 * 1024 * 1024 });
  if (result.error || result.status !== 0) {
    throw Error(`${file} failed: ${result.error?.message ?? result.stderr.toString()}`);
  }
  return result.stdout;
}
function validateManifest(rows) {
  if (!Array.isArray(rows) || rows.length !== 44 ||
      new Set(rows.map(r => r.migration_name)).size !== 44 ||
      rows.some(r => !/^\d{14}_[a-z0-9_]+$/.test(r.migration_name) ||
        !/^[a-f0-9]{64}$/.test(r.sha256) || !Number.isSafeInteger(r.bytes) || r.bytes <= 0)) {
    throw Error('INVALID_ATTESTED_44_FILE_MANIFEST');
  }
}
function exactBytes(raw, row) {
  // Insert CR only before LF not already preceded by CR. No decoding, trimming,
  // bare-CR replacement or other normalization is allowed.
  const converted = [];
  for (let i = 0; i < raw.length; i++) {
    if (raw[i] === 10 && (i === 0 || raw[i - 1] !== 13)) converted.push(13);
    converted.push(raw[i]);
  }
  const derived = Buffer.from(converted);
  const matches = b => b.length === row.bytes && hash(b) === row.sha256;
  const status = matches(raw) ? 'RAW_MATCH' :
    matches(derived) ? 'EXACT_BYTES_DERIVED_AND_HASH_VERIFIED' : 'MISMATCH';
  const result = { name: row.migration_name, status,
    expected: { bytes: row.bytes, sha256: row.sha256 },
    git: { bytes: raw.length, sha256: hash(raw) },
    derived: { bytes: derived.length, sha256: hash(derived) } };
  if (status === 'MISMATCH') throw Error('SQL_BYTE_MISMATCH ' + JSON.stringify(result));
  return { bytes: status === 'RAW_MATCH' ? raw : derived, result };
}
function prepare(source, output) {
  source = fs.realpathSync(source);
  output = path.resolve(output);
  if (fs.existsSync(output)) throw Error('NEW_OUTPUT_DIRECTORY_REQUIRED');
  if (command('git', ['rev-parse', 'HEAD'], source).toString().trim() !== SOURCE) throw Error('SOURCE_HEAD_MISMATCH');
  command('git', ['merge-base', '--is-ancestor', BASE, SOURCE], source);
  const manifestBytes = fs.readFileSync(path.join(__dirname, 'fixtures/stocks-production-files-20261020.json'));
  if (hash(manifestBytes) !== MANIFEST_SHA) throw Error('ATTESTED_MANIFEST_HASH_MISMATCH');
  const manifest = JSON.parse(manifestBytes);
  validateManifest(manifest);
  // Verify EVERY file before creating any output or invoking Docker.
  const history = manifest.map(row => exactBytes(command('git',
    ['show', `${SOURCE}:prisma/migrations/${row.migration_name}/migration.sql`], source), row));
  const pending = PENDING.map(row => {
    const bytes = command('git', ['show', `${SOURCE}:prisma/migrations/${row.name}/migration.sql`], source);
    if (hash(bytes) !== row.sha256) throw Error('PENDING_SQL_MISMATCH ' + row.name);
    return { ...row, bytes };
  });
  fs.mkdirSync(output); // non-recursive; never overwrites an existing context
  const context = path.join(output, 'context');
  command('git', ['clone', '--no-checkout', '--shared', source, context], output);
  command('git', ['-c', 'core.autocrlf=false', 'checkout', '--detach', SOURCE], context);
  const snapshot = path.join(output, 'derived44'), pendingDir = path.join(output, 'pending2');
  for (const file of history) {
    const dir = path.join(snapshot, file.result.name);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'migration.sql'), file.bytes, { flag: 'wx' });
  }
  for (const file of pending) {
    const dir = path.join(pendingDir, file.name);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'migration.sql'), file.bytes, { flag: 'wx' });
  }
  const baselineFile = path.join(output, 'baseline.json');
  fs.writeFileSync(baselineFile, JSON.stringify({
    provenance: 'Byte-equivalent reconstruction, NOT original production export or build provenance.',
    manifestSha256: MANIFEST_SHA,
    migrations: manifest.map(row => ({ name: row.migration_name, sha256: row.sha256 })),
  }, null, 2) + '\n', { flag: 'wx' });
  // Load the ORIGINAL checker from the pinned application source, not a copy
  // modified for this build. It still rejects every historical raw-byte mismatch.
  const packager = require(path.join(context, 'scripts/qa/stocks-release-package.cjs'));
  const packageResult = packager.stage({
    snapshot, baselineFile, pending: pendingDir,
    output: path.join(context, 'stocks-release-migrations'),
  });
  if (packageResult.status !== 'PASS_FILE_REVIEW_ONLY' ||
      packageResult.historicalCount !== 44 || packageResult.pendingCount !== 2) throw Error('STRICT_PACKAGE_GATE_FAILED');
  const receipt = { source: SOURCE, base: BASE, manifestSha256: MANIFEST_SHA,
    provenance: 'EXACT_BYTES_DERIVED_AND_HASH_VERIFIED; not original export receipt',
    rows: history.map(file => file.result), pending: PENDING,
    packageResult, originalSqlFilesChanged: false, sqlExecuted: false };
  fs.writeFileSync(path.join(output, 'sql-byte-receipt.json'), JSON.stringify(receipt, null, 2) + '\n');
  return receipt;
}
module.exports = { SOURCE, BASE, MANIFEST_SHA, PENDING, hash, validateManifest, exactBytes, prepare };
if (require.main === module) {
  try {
    if (process.argv.length !== 4) throw Error('USAGE: source-checkout NEW-output-directory');
    const result = prepare(process.argv[2], process.argv[3]);
    console.log(JSON.stringify({ source: result.source, historical: result.rows.length,
      raw: result.rows.filter(r => r.status === 'RAW_MATCH').length,
      derived: result.rows.filter(r => r.status === 'EXACT_BYTES_DERIVED_AND_HASH_VERIFIED').length,
      pending: result.pending.length, strictGate: result.packageResult.status, sqlExecuted: false }));
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
