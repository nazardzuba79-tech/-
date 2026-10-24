'use strict';
// Filesystem-only candidate gate. Never connects to a database or applies SQL.
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
function entries(rows) {
  if (!Array.isArray(rows) || rows.some(r => !/^\d{14}_[a-z0-9_]+$/.test(r.name) || !/^[a-f0-9]{64}$/.test(r.sha256))) throw Error('INVALID_MIGRATION_MANIFEST');
  const map = new Map(rows.map(r => [r.name, r.sha256]));
  if (map.size !== rows.length) throw Error('DUPLICATE_MIGRATION');
  return map;
}
function review(baseline, candidate, approvedPending) {
  const previous = entries(baseline), current = entries(candidate), approved = entries(approvedPending);
  if (!previous.size) throw Error('EMPTY_BASELINE');
  if ([...approved.keys()].some(name => previous.has(name))) throw Error('APPROVAL_OVERLAPS_HISTORY');
  const missing = [...previous.keys()].filter(name => !current.has(name));
  const changedHistory = [...previous].filter(([name, sha]) => current.has(name) && current.get(name) !== sha).map(([name]) => name);
  const pending = [...current.keys()].filter(name => !previous.has(name));
  const unexpected = pending.filter(name => !approved.has(name));
  const missingApproved = [...approved.keys()].filter(name => !current.has(name));
  const changedPending = pending.filter(name => approved.has(name) && approved.get(name) !== current.get(name));
  const passed = ![missing, changedHistory, unexpected, missingApproved, changedPending].some(list => list.length);
  return { status: passed ? 'PASS_FILE_REVIEW_ONLY' : 'BLOCKED', missing, changedHistory, pending, unexpected, missingApproved, changedPending,
    sqlExecuted: false, productionAuthorized: false };
}
function readDirectory(directory) {
  const root = fs.realpathSync(directory);
  return fs.readdirSync(root, { withFileTypes: true }).filter(entry => entry.name !== 'migration_lock.toml').map(entry => {
    if (!entry.isDirectory() || entry.isSymbolicLink()) throw Error('UNSAFE_MIGRATION_ENTRY');
    const file = path.join(root, entry.name, 'migration.sql');
    if (fs.lstatSync(file).isSymbolicLink() || fs.realpathSync(file) !== file) throw Error('UNSAFE_MIGRATION_FILE');
    return { name: entry.name, sha256: hash(fs.readFileSync(file)) };
  }).sort((a, b) => a.name.localeCompare(b.name));
}
module.exports = { review, readDirectory, hash };
if (require.main === module) {
  try {
    const [baselinePath, directory, approvedPath] = process.argv.slice(2);
    if (!baselinePath || !directory || !approvedPath || process.argv.length !== 5) throw Error('USAGE: node stocks-migration-review.cjs baseline.json candidate-migrations approved-pending.json');
    const baseline = JSON.parse(fs.readFileSync(baselinePath, 'utf8'));
    const result = review(baseline.migrations, readDirectory(directory), JSON.parse(fs.readFileSync(approvedPath, 'utf8')));
    console.log(JSON.stringify(result, null, 2));
    process.exitCode = result.status === 'BLOCKED' ? 1 : 0;
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
