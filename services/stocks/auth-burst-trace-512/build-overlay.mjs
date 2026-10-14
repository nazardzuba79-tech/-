// Pure filesystem preparation, outside Git and outside any timed window. No execution.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { derive } from './instrument.mjs';
import { transformServiceEntry, ENTRY } from './service-overlay.mjs';
import { BASELINE, HELPERS, OVERLAYS, digest } from './closure.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
function read(file, max = 16 * 1024 * 1024) {
  const stat = fs.lstatSync(file);
  assert.ok(stat.isFile() && !stat.isSymbolicLink() && stat.size <= max);
  assert.equal(fs.realpathSync(file), path.resolve(file)); return fs.readFileSync(file);
}
export function buildOverlay({ sourceRoot, outputDirectory, sourceSha, contextSha256 }) {
  const root = fs.realpathSync(sourceRoot), out = path.resolve(outputDirectory);
  assert.equal(root, path.resolve(sourceRoot));
  assert.match(sourceSha || '', /^[a-f0-9]{40}$/); assert.match(contextSha256 || '', /^[a-f0-9]{64}$/);
  const parent = path.dirname(out); assert.equal(fs.realpathSync(parent), parent);
  assert.ok(out !== root && !out.startsWith(root + path.sep), 'TRACE_OVERLAY_OUTSIDE_SOURCE');
  assert.ok(!fs.existsSync(out), 'TRACE_OVERLAY_FRESH_DIRECTORY_REQUIRED');
  const original = JSON.parse(read(path.join(root, 'runtime-source-manifest.json'), 1024 * 1024));
  assert.equal(original.schema, 'stocks-auth-http-prepare-512-v1'); assert.equal(original.sourceSha, sourceSha);
  assert.equal(original.contextSha256, contextSha256); assert.equal(digest(JSON.stringify(original.files)), contextSha256);
  assert.ok(Array.isArray(original.files) && original.files.length > 0 && original.files.length <= 10000);
  const seen = new Set();
  for (const row of original.files) {
    assert.ok(typeof row.path === 'string' && !row.path.includes('\\') && !path.posix.isAbsolute(row.path)
      && row.path.split('/').every(s => s && s !== '.' && s !== '..') && !seen.has(row.path)); seen.add(row.path);
    const bytes = read(path.join(root, row.path)); assert.equal(bytes.length, row.bytes); assert.equal(digest(bytes), row.sha256);
  }
  assert.ok(OVERLAYS.every(p => seen.has(p)));
  const service = transformServiceEntry(read(path.join(root, ENTRY))); // guard before any write
  const proof = derive(root, out);
  const write = (name, bytes) => { const dest = path.join(out, name); fs.mkdirSync(path.dirname(dest), { recursive:true }); fs.writeFileSync(dest, bytes, { flag:'wx', mode:0o600 }); };
  write(ENTRY, service.output);
  write(HELPERS[1], read(path.join(here, 'closure.mjs')));
  const overlays = proof.files.map(row => ({ path:row.path, originalSha256:row.originalSha256,
    outputSha256:row.outputSha256, bytes:read(path.join(out,row.path)).length, hunksSha256:digest(JSON.stringify(row.hunks)) }));
  overlays.push(Object.fromEntries(['path','originalSha256','outputSha256','bytes','hunksSha256'].map(k=>[k,service.manifest[k]])));
  assert.deepEqual(overlays.map(x=>x.path).sort(), [...OVERLAYS].sort());
  const helpers = HELPERS.map(name => { const bytes=read(path.join(out,name)); return { path:name,sha256:digest(bytes),bytes:bytes.length }; });
  const manifest = { schema:'stocks-one-burst-derived-512-v1', baseline:BASELINE, sourceSha, contextSha256, overlays, helpers };
  const manifestBytes = Buffer.from(JSON.stringify(manifest,null,2)+'\n');
  const manifestPath = path.join(out,'derived-manifest.json'); fs.writeFileSync(manifestPath,manifestBytes,{flag:'wx',mode:0o600});
  const entryProof = { ...service.manifest, financialRulesChanged:false, commandReplayDenied:true, closedSeedOnly:true };
  fs.writeFileSync(path.join(out,'service-entry-proof.json'),JSON.stringify(entryProof,null,2)+'\n',{flag:'wx',mode:0o600});
  const mounts = [...overlays.map(row=>({source:path.join(out,row.path),target:'/source/'+row.path,sha256:row.outputSha256})),
    ...helpers.map(row=>({source:path.join(out,row.path),target:'/source/'+row.path,sha256:row.sha256})),
    {source:manifestPath,target:'/trace/derived-manifest.json',sha256:digest(manifestBytes)}].map(row=>({...row,readOnly:true}));
  return { manifest, manifestSha256:digest(manifestBytes), manifestPath, mounts,
    instrumentationProofSha256:digest(read(path.join(out,'derived-trace-manifest.json'))),
    entryProofSha256:digest(read(path.join(out,'service-entry-proof.json'))) };
}
