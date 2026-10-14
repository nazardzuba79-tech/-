// Disposable diagnostic overlay only. This module is never imported by product code.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';

export const BASELINE = 'f045d7255f1195ef3c7b6cca5a5e63f4c851a2a8';
export const OVERLAYS = Object.freeze([
  'services/stocks-global/server.mjs', 'services/stocks-global/identity.mjs',
  'services/stocks-global/account-worker.mjs', 'services/stocks-global/account-worker-runtime.mjs',
  'services/stocks-global/accounts.mjs', 'services/stocks/auth-http-fixture-512/stock-child.mjs',
]);
export const HELPERS = Object.freeze([
  'services/stocks/auth-burst-trace-512/recorder.mjs',
  'services/stocks/auth-burst-trace-512/closure.mjs',
]);
export const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const hash = value => assert.match(value || '', /^[a-f0-9]{64}$/);
const keys = (value, names) => assert.deepEqual(Object.keys(value).sort(), [...names].sort(), 'TRACE_CLOSURE_UNKNOWN_FIELD');
function relative(value) {
  assert.equal(typeof value, 'string');
  assert.ok(value.length < 512 && !value.includes('\\') && !path.posix.isAbsolute(value)
    && value.split('/').every(x => x && x !== '.' && x !== '..'), 'TRACE_CLOSURE_PATH');
}
function regular(file, maximum = 16 * 1024 * 1024) {
  const stat = fs.lstatSync(file);
  assert.ok(stat.isFile() && !stat.isSymbolicLink() && stat.size <= maximum, 'TRACE_CLOSURE_FILE');
  assert.equal(fs.realpathSync(file), path.resolve(file), 'TRACE_CLOSURE_REALPATH');
  return fs.readFileSync(file);
}

// The expected digest arrives through the private, bounded RPC from the verified
// host adapter; it is not obtained from the untrusted manifest itself.
export function verifyDerivedClosure(contextSha256, expectedDigest, {
  root = '/source', manifestPath = '/trace/derived-manifest.json',
} = {}) {
  hash(contextSha256); hash(expectedDigest);
  const bytes = regular(manifestPath, 128 * 1024);
  assert.equal(digest(bytes), expectedDigest, 'TRACE_DERIVED_MANIFEST_DIGEST');
  const derived = JSON.parse(bytes);
  keys(derived, ['schema', 'baseline', 'sourceSha', 'contextSha256', 'overlays', 'helpers']);
  assert.equal(derived.schema, 'stocks-one-burst-derived-512-v1');
  assert.equal(derived.baseline, BASELINE);
  assert.match(derived.sourceSha || '', /^[a-f0-9]{40}$/);
  assert.equal(derived.contextSha256, contextSha256);
  assert.ok(Array.isArray(derived.overlays) && Array.isArray(derived.helpers));
  assert.deepEqual(derived.overlays.map(x => x.path).sort(), [...OVERLAYS].sort());
  assert.deepEqual(derived.helpers.map(x => x.path).sort(), [...HELPERS].sort());
  const overlays = new Map();
  for (const row of derived.overlays) {
    keys(row, ['path', 'originalSha256', 'outputSha256', 'bytes', 'hunksSha256']);
    relative(row.path); hash(row.originalSha256); hash(row.outputSha256); hash(row.hunksSha256);
    assert.ok(Number.isSafeInteger(row.bytes) && row.bytes > 0 && row.bytes <= 16 * 1024 * 1024);
    assert.notEqual(row.originalSha256, row.outputSha256, 'TRACE_EMPTY_OVERLAY');
    overlays.set(row.path, row);
  }
  const original = JSON.parse(regular(path.join(root, 'runtime-source-manifest.json'), 1024 * 1024));
  assert.equal(original.schema, 'stocks-auth-http-prepare-512-v1');
  assert.equal(original.sourceSha, derived.sourceSha, 'TRACE_SOURCE_HEAD');
  assert.equal(original.contextSha256, contextSha256);
  assert.equal(digest(JSON.stringify(original.files)), contextSha256, 'TRACE_SOURCE_MANIFEST_DIGEST');
  assert.ok(Array.isArray(original.files) && original.files.length > 0 && original.files.length <= 10000);
  const seen = new Set(); let modified = 0;
  for (const row of original.files) {
    relative(row.path); hash(row.sha256);
    assert.ok(!seen.has(row.path), 'TRACE_SOURCE_DUPLICATE'); seen.add(row.path);
    // A successful silent compiler produces the original, digest-bound empty log.
    const emptyBuildLog = row.path === 'build.log' && row.bytes === 0 && row.sha256 === digest(Buffer.alloc(0));
    assert.ok(Number.isSafeInteger(row.bytes) && (row.bytes > 0 || emptyBuildLog) && row.bytes <= 16 * 1024 * 1024);
    const output = regular(path.join(root, row.path));
    const change = overlays.get(row.path);
    if (change) {
      assert.equal(change.originalSha256, row.sha256, 'TRACE_ORIGINAL_BINDING');
      assert.equal(output.length, change.bytes); assert.equal(digest(output), change.outputSha256);
      modified++;
    } else {
      assert.equal(output.length, row.bytes); assert.equal(digest(output), row.sha256, 'TRACE_UNREVIEWED_RUNTIME_CHANGE');
    }
  }
  assert.equal(modified, OVERLAYS.length, 'TRACE_OVERLAY_NOT_IN_IMAGE');
  for (const row of derived.helpers) {
    keys(row, ['path', 'sha256', 'bytes']); relative(row.path); hash(row.sha256);
    assert.ok(!seen.has(row.path), 'TRACE_HELPER_ALREADY_IN_BASE');
    assert.ok(Number.isSafeInteger(row.bytes) && row.bytes > 0 && row.bytes <= 1024 * 1024);
    const output = regular(path.join(root, row.path), 1024 * 1024);
    assert.equal(output.length, row.bytes); assert.equal(digest(output), row.sha256, 'TRACE_HELPER_DIGEST');
  }
  return { contextSha256, derivedManifestSha256: expectedDigest, baseline: BASELINE,
    sourceSha: derived.sourceSha, verifiedFiles: seen.size, reviewedOverlays: modified, helpers: HELPERS.length };
}
