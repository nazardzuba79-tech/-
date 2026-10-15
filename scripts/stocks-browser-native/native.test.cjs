'use strict';
// Pure source/fixture tests: no Chrome, container, provider or privileged operation.
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {manifest,EXECUTABLE,requested,selectExecutable,ancestors,canonicalRelative,validateProof,validateClosure}=require('./installation.cjs');
const {sha,signingProof,releaseProof}=require('./chain.cjs');
const sourceSha='a'.repeat(40),now=Date.parse('2026-10-15T10:00:00Z'),created=Math.floor(now/1000)-3600,primary=manifest.googlePrimaryFingerprint,sub='0123456789ABCDEF0123456789ABCDEF01234567';
const signature=`[GNUPG:] VALIDSIG ${sub} 2026-10-15 ${created} 0 4 0 1 8 01 ${primary}\n`;
const listing=`pub:-:4096:1:key:${created}:0:::::\nfpr:::::::::${primary}:\nsub:-:4096:1:sub:${created}:0:::::\nfpr:::::::::${sub}:\n`;
function fixture(){return {schema:1,status:'PASS_AUTHENTICATED_EXTRACTION',prefix:manifest.prefix,executable:EXECUTABLE,package:{...manifest.chrome},playwrightVersion:manifest.playwrightVersion,sourceSha,runId:'1-1',manifestSha256:sha(fs.readFileSync(path.join(__dirname,'manifest.json'))),files:['chrome/chrome','playwright/package.json','playwright/package-lock.json','playwright/node_modules/playwright/package.json','playwright/node_modules/playwright-core/package.json'].map(path=>({path,sha256:'b'.repeat(64),bytes:10,mode:0o644})),sourceFiles:['scripts/stocks-browser-native/provision.py','scripts/stocks-browser-native/extract.py','scripts/stocks-browser-native/installation.cjs','scripts/qa-stocks-public-nss.cjs','scripts/qa-stocks-browser-launch.cjs','scripts/qa-stocks-chrome-preflight.cjs'].map(path=>({path,sha256:'c'.repeat(64),bytes:10})),dependencies:[{name:'libc6',version:'fixture-only'}],npmArchives:[{},{}]};}
test('native selection is explicit and fixed, with no arbitrary path or fallback',()=>{
  assert.equal(requested({}),false);assert.equal(selectExecutable({}),'/opt/google/chrome/chrome');assert.equal(selectExecutable({VOLTEX_STOCKS_NATIVE_BROWSER:'1'}),EXECUTABLE);
  for(const value of ['','0','true','/tmp/chrome'])assert.throws(()=>selectExecutable({VOLTEX_STOCKS_NATIVE_BROWSER:value}));
  assert.deepEqual(ancestors(EXECUTABLE),[manifest.prefix+'/chrome',manifest.prefix,'/usr/lib','/usr','/']);
  assert.ok(!manifest.prefix.startsWith('/opt/')&&!manifest.prefix.startsWith('/usr/share/'));
});
test('native proof requires exact source, package, path, manifest and complete mandatory payload',()=>{
  assert.equal(validateProof(fixture(),sourceSha).sourceSha,sourceSha);
  for(const update of [{sourceSha:'d'.repeat(40)},{prefix:'/tmp/chrome'},{executable:'/opt/google/chrome/chrome'},{manifestSha256:'0'.repeat(64)},{package:{...manifest.chrome,sha256:'0'.repeat(64)}},{playwrightVersion:'1.57.0'},{status:'PASS'},{sourceFiles:[]},{files:fixture().files.slice(1)}])assert.throws(()=>validateProof({...fixture(),...update},sourceSha));
  assert.throws(()=>validateProof(fixture(),''));
});
test('canonical payload inventory rejects aliases, duplicates, omissions and unexpected executable files',()=>{
  for(const value of ['/a','a/../b','a//b','a/./b','a\\b','a:stream','a\0b',''])assert.throws(()=>canonicalRelative(value));
  const good=fixture();validateClosure(good.files.map(row=>row.path),good.files);
  assert.throws(()=>validateClosure([...good.files.map(row=>row.path),'chrome/unreviewed.so'],good.files));
  assert.throws(()=>validateClosure(good.files.slice(1).map(row=>row.path),good.files));
  assert.throws(()=>validateProof({...good,files:[...good.files,good.files[0]]},sourceSha));
  assert.throws(()=>validateProof({...good,files:good.files.map((row,index)=>index?row:{...row,mode:0o4755})},sourceSha));
});
test('pinned GPG proof rejects bad, expired, revoked, wrong signer and weak-digest records',()=>{
  assert.equal(signingProof(signature,listing,manifest,now).primary,primary);
  for(const bad of ['BADSIG','ERRSIG','NO_PUBKEY','EXPSIG','EXPKEYSIG','REVKEYSIG','KEYEXPIRED','SIGEXPIRED','FAILURE','ERROR','NODATA'])assert.throws(()=>signingProof(signature+'[GNUPG:] '+bad+' bad\n',listing,manifest,now));
  assert.throws(()=>signingProof(signature.replace(primary,'A'.repeat(40)),listing,manifest,now));assert.throws(()=>signingProof(signature.replace(' 1 8 01',' 1 2 01'),listing,manifest,now));
  for(const invalid of ['r','e','d','i'])assert.throws(()=>signingProof(signature,listing.replace('sub:-:','sub:'+invalid+':'),manifest,now));
  assert.throws(()=>signingProof(signature,listing,manifest,now+manifest.metadataMaximumAgeMs));
});
test('signed Release age and exact Packages digest are not relaxed',()=>{
  const release=`Origin: Google LLC\nSuite: stable\nCodename: stable\nDate: Thu, 15 Oct 2026 09:00:00 GMT\nSHA256:\n ${manifest.packages.sha256} ${manifest.packages.bytes} ${manifest.packages.path}\n`;
  assert.equal(releaseProof(release,manifest,now).packagesBytes,manifest.packages.bytes);
  assert.throws(()=>releaseProof(release.replace(manifest.packages.sha256,'0'.repeat(64)),manifest,now));assert.throws(()=>releaseProof(release,manifest,now+manifest.metadataMaximumAgeMs));
});
test('a launcher rejection after attempt never claims that Chrome did not start or cleanup succeeded',()=>{
  const {beginLaunch,failureEvidence}=require('./qualification.cjs');const report={launchAttempted:false,browserLaunched:false,cleanup:{status:'NOT_CREATED'}};
  beginLaunch(report);failureEvidence(report,Error('renderer proof failed'));
  assert.equal(report.launchAttempted,true);assert.equal(report.browserLaunched,'UNCONFIRMED');assert.equal(report.cleanup.status,'UNCONFIRMED');assert.equal(report.status,'FAIL');
  const error=Error('renderer proof failed');error.serverCleanup='owned server close failed';error.browserCleanup='owned browser close failed';error.scratchCleanup='owned scratch cleanup failed';failureEvidence(report,error);assert.equal(report.cleanup.status,'FAIL');assert.deepEqual(report.cleanup.errors.map(row=>row.stage),['browserCleanup','serverCleanup','scratchCleanup']);
});
