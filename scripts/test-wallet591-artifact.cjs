'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const {audit,releaseEnv,root,profiles}=require('./wallet591-frontend-artifact.cjs');
const profile=process.env.RELEASE_TEST_PROFILE||'production';
const dist=path.join(root,'output',`wallet591-${profile}-dist`);
function sample(){const dir=fs.mkdtempSync(path.join(root,'output','negative-artifact-'));fs.cpSync(dist,dir,{recursive:true});return dir;}
test('explicit regional API and conversion OFF; contradictory inherited env rejected',()=>{
  for(const p of ['production','ru']) {
    assert.equal(releaseEnv({},p).VITE_API_URL,profiles[p].env.VITE_API_URL);
    assert.equal(releaseEnv({},p).VITE_WALLET_CONVERSION_ENABLED,'false');
    for(const env of [{VITE_API_URL:'/api/v1'},{VITE_API_URL:'https://wrong.invalid/api/v1'},{VITE_WALLET_CONVERSION_ENABLED:'true'},{VITE_STOCKS_ENABLED:'true'}])assert.throws(()=>releaseEnv(env,p));
  }
});
test('actual artifact validates',()=>assert(audit(dist,profile).files['.vite/manifest.json']));
test('old relative-API emitted bundle is rejected even if receipt claims correct API',()=>{
  const dir=sample();
  for(const file of fs.readdirSync(path.join(dir,'assets')).filter(f=>f.endsWith('.js'))) {
    const p=path.join(dir,'assets',file),s=fs.readFileSync(p,'utf8');
    fs.writeFileSync(p,s.split(profiles[profile].env.VITE_API_URL).join('/api/v1'));
  }
  assert.throws(()=>audit(dir,profile),/Compiled JS missing VITE_API_URL/);
});
test('missing lazy route chunk fails before upload',()=>{
  const dir=sample(),graph=JSON.parse(fs.readFileSync(path.join(dir,'.vite','manifest.json')));
  const lazy=Object.values(graph).find(x=>x.isDynamicEntry);assert(lazy);
  // Simulate absent download without deleting anything.
  graph[Object.keys(graph).find(k=>graph[k]===lazy)].file='assets/missing-route.js';
  fs.writeFileSync(path.join(dir,'.vite','manifest.json'),JSON.stringify(graph));
  assert.throws(()=>audit(dir,profile),/Missing graph asset/);
});
test('regional mix and forged ON receipt fail',()=>{
  const dir=sample(),receipt=JSON.parse(fs.readFileSync(path.join(dir,'release-build.json')));
  receipt.env.VITE_WALLET_CONVERSION_ENABLED='true';fs.writeFileSync(path.join(dir,'release-build.json'),JSON.stringify(receipt));
  assert.throws(()=>audit(dir,profile));
  assert.throws(()=>audit(dist,profile==='production'?'ru':'production'));
});
