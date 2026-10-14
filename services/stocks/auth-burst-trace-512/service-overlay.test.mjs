import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { digest, BASELINE, OVERLAYS, HELPERS, verifyDerivedClosure } from './closure.mjs';
import { transformServiceEntry, ENTRY_SHA256 } from './service-overlay.mjs';

const originalEntry = Buffer.from(fs.readFileSync(new URL('../auth-http-fixture-512/stock-child.mjs', import.meta.url), 'utf8').replace(/\r\n/g, '\n'));
test('service overlay is exact-source guarded and preserves original fixture bytes', () => {
  assert.equal(digest(originalEntry), ENTRY_SHA256);
  const before = Buffer.from(originalEntry), result = transformServiceEntry(before);
  assert.deepEqual(before, originalEntry);
  assert.equal(result.manifest.hunks.length, 9);
  assert.equal(result.manifest.hunks.every(h => h.count === 1), true);
  assert.match(result.output.toString(), /verifyDerivedClosure\(input.contextSha256, input.derivedManifestSha256\)/);
  assert.match(result.output.toString(), /TRACE_WINDOW_REPLAY/);
  assert.match(result.output.toString(), /TRACE_CLOSED_SEED_REQUIRED/);
  assert.match(result.output.toString(), /handler.constructor.name, 'Function'/);
  assert.equal(result.manifest.outputSha256, digest(result.output));
  assert.throws(() => transformServiceEntry(Buffer.concat([before, Buffer.from('\n')])), /TRACE_ENTRY_SOURCE_DRIFT/);
});

function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'stocks-trace-closure-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const root = path.join(dir, 'source'), manifestPath = path.join(dir, 'derived.json');
  const write = (name, bytes) => { const target = path.join(root, name); fs.mkdirSync(path.dirname(target), { recursive: true }); fs.writeFileSync(target, bytes); };
  const sourceSha = 'a'.repeat(40);
  const baseRows = [...OVERLAYS, 'services/stocks-simulator/engine.mjs'].map((name, i) => {
    const original = Buffer.from('original-' + i), output = Buffer.from('derived-' + i);
    write(name, OVERLAYS.includes(name) ? output : original);
    return { path: name, bytes: original.length, sha256: digest(original), output };
  });
  const original = { schema: 'stocks-auth-http-prepare-512-v1', sourceSha,
    files: baseRows.map(({ output, ...row }) => row) };
  original.contextSha256 = digest(JSON.stringify(original.files));
  const derived = { schema: 'stocks-one-burst-derived-512-v1', baseline: BASELINE, sourceSha,
    contextSha256: original.contextSha256,
    overlays: baseRows.filter(row => OVERLAYS.includes(row.path)).map(row => ({ path: row.path,
      originalSha256: row.sha256, outputSha256: digest(row.output), bytes: row.output.length, hunksSha256: 'b'.repeat(64) })),
    helpers: HELPERS.map((name, i) => { const b = Buffer.from('helper-' + i); write(name, b); return { path: name, sha256: digest(b), bytes: b.length }; }),
  };
  const save = () => { write('runtime-source-manifest.json', JSON.stringify(original)); fs.writeFileSync(manifestPath, JSON.stringify(derived)); return digest(fs.readFileSync(manifestPath)); };
  const verify = () => verifyDerivedClosure(original.contextSha256, save(), { root, manifestPath });
  return { root, manifestPath, original, derived, write, save, verify };
}
test('derived closure verifies every original file and only six declared overlays', t => {
  const f = fixture(t), result = f.verify();
  assert.equal(result.reviewedOverlays, 6); assert.equal(result.verifiedFiles, 7); assert.equal(result.helpers, 2);
});
// Actual f045 compiled artifact 11880234688: successful tsc emitted no output.
const silentBuildLog = { path: 'build.log', bytes: 0,
  sha256: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855' };
function addSilentLog(f) {
  f.original.files.push({ ...silentBuildLog }); f.write('build.log', Buffer.alloc(0));
  f.original.contextSha256 = digest(JSON.stringify(f.original.files));
  f.derived.contextSha256 = f.original.contextSha256;
}
test('actual silent compiler log row passes only with exact manifest length and digest', t => {
  const f = fixture(t); addSilentLog(f);
  assert.equal(f.verify().verifiedFiles, 8);
  f.write('build.log', 'tampered'); assert.throws(f.verify);
  f.write('build.log', Buffer.alloc(0)); f.original.files.at(-1).sha256 = 'f'.repeat(64);
  f.original.contextSha256 = digest(JSON.stringify(f.original.files));
  f.derived.contextSha256 = f.original.contextSha256;
  assert.throws(f.verify);
});
test('empty log exception does not permit empty source, overlay or helper', t => {
  for (const kind of ['source', 'overlay', 'helper']) {
    const f = fixture(t); addSilentLog(f);
    if (kind === 'source') {
      const row = f.original.files.find(r => r.path === 'services/stocks-simulator/engine.mjs');
      row.bytes = 0; row.sha256 = silentBuildLog.sha256; f.write(row.path, Buffer.alloc(0));
      f.original.contextSha256 = digest(JSON.stringify(f.original.files));
      f.derived.contextSha256 = f.original.contextSha256;
    } else {
      const row = kind === 'overlay' ? f.derived.overlays[0] : f.derived.helpers[0];
      row.bytes = 0; f.write(row.path, Buffer.alloc(0));
      row[kind === 'overlay' ? 'outputSha256' : 'sha256'] = silentBuildLog.sha256;
    }
    assert.throws(f.verify, undefined, kind);
  }
});
test('independent manifest digest is mandatory', t => {
  const f = fixture(t); f.save();
  assert.throws(() => verifyDerivedClosure(f.original.contextSha256, 'c'.repeat(64), f), /TRACE_DERIVED_MANIFEST_DIGEST/);
});
test('unrelated financial source mutation is rejected', t => {
  const f = fixture(t); f.write('services/stocks-simulator/engine.mjs', 'tampered!!');
  assert.throws(f.verify, /TRACE_UNREVIEWED_RUNTIME_CHANGE/);
});
test('source head mismatch and original overlay hash mismatch are rejected', t => {
  const f = fixture(t); f.derived.sourceSha = 'b'.repeat(40);
  assert.throws(f.verify, /TRACE_SOURCE_HEAD/);
  f.derived.sourceSha = f.original.sourceSha; f.derived.overlays[0].originalSha256 = 'd'.repeat(64);
  assert.throws(f.verify, /TRACE_ORIGINAL_BINDING/);
});
test('extra overlay, extra helper and unknown manifest fields are rejected', t => {
  const f = fixture(t); f.derived.overlays.push({ ...f.derived.overlays[0], path: '../bad' });
  assert.throws(f.verify); f.derived.overlays.pop();
  f.derived.helpers.push({ ...f.derived.helpers[0], path: 'extra.mjs' }); assert.throws(f.verify); f.derived.helpers.pop();
  f.derived.allowUnknown = true; assert.throws(f.verify, /TRACE_CLOSURE_UNKNOWN_FIELD/);
});
test('duplicate or traversing base rows are rejected', t => {
  const f = fixture(t); f.original.files.push({ ...f.original.files[0] });
  f.original.contextSha256 = digest(JSON.stringify(f.original.files)); f.derived.contextSha256 = f.original.contextSha256;
  assert.throws(f.verify, /TRACE_SOURCE_DUPLICATE/);
  f.original.files.pop(); f.original.files[0].path = '../escape';
  f.original.contextSha256 = digest(JSON.stringify(f.original.files)); f.derived.contextSha256 = f.original.contextSha256;
  assert.throws(f.verify, /TRACE_CLOSURE_PATH/);
});
