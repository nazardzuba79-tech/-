import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildOverlay } from './build-overlay.mjs';
import { OVERLAYS, digest } from './closure.mjs';

const checkout = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
function prepared(t) {
  const temp=fs.mkdtempSync(path.join(os.tmpdir(),'stocks-trace-overlay-'));
  t.after(()=>fs.rmSync(temp,{recursive:true,force:true}));
  const sourceRoot=path.join(temp,'source'), outputDirectory=path.join(temp,'overlay'), sourceSha='a'.repeat(40);
  const files=OVERLAYS.map(name=>{
    const bytes=Buffer.from(fs.readFileSync(path.join(checkout,name),'utf8').replace(/\r\n/g,'\n'));
    const dest=path.join(sourceRoot,name);fs.mkdirSync(path.dirname(dest),{recursive:true});fs.writeFileSync(dest,bytes);
    return {path:name,bytes:bytes.length,sha256:digest(bytes)};
  });
  const contextSha256=digest(JSON.stringify(files));
  fs.writeFileSync(path.join(sourceRoot,'runtime-source-manifest.json'),JSON.stringify({schema:'stocks-auth-http-prepare-512-v1',sourceSha,contextSha256,files}));
  return {sourceRoot,outputDirectory,sourceSha,contextSha256,files};
}
test('overlay builder creates nine explicit readonly mounts without altering originals',t=>{
  const f=prepared(t), result=buildOverlay(f);
  assert.equal(result.mounts.length,9);assert.ok(result.mounts.every(row=>row.readOnly));
  assert.equal(result.manifest.overlays.length,6);assert.equal(result.manifest.helpers.length,2);
  assert.equal(result.manifestSha256,digest(fs.readFileSync(result.manifestPath)));
  for(const row of f.files)assert.equal(digest(fs.readFileSync(path.join(f.sourceRoot,row.path))),row.sha256);
  for(const row of result.mounts)assert.equal(digest(fs.readFileSync(row.source)),row.sha256);
  assert.throws(()=>buildOverlay(f),/TRACE_OVERLAY_FRESH_DIRECTORY_REQUIRED/);
});
test('bad context or source bytes fail before writing an overlay',t=>{
  const f=prepared(t);assert.throws(()=>buildOverlay({...f,contextSha256:'b'.repeat(64)}));
  assert.equal(fs.existsSync(f.outputDirectory),false);
  fs.appendFileSync(path.join(f.sourceRoot,f.files[0].path),'\n');assert.throws(()=>buildOverlay(f));
  assert.equal(fs.existsSync(f.outputDirectory),false);
});
test('same-tree output and changed source head are rejected',t=>{
  const f=prepared(t);assert.throws(()=>buildOverlay({...f,outputDirectory:path.join(f.sourceRoot,'overlay')}),/TRACE_OVERLAY_OUTSIDE_SOURCE/);
  assert.throws(()=>buildOverlay({...f,sourceSha:'b'.repeat(40)}));
});
