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
  assert.throws(()=>signingProof(signature+'[GNUPG:]\n',listing,manifest,now));
  for(const bad of ['BADSIG','ERRSIG','NO_PUBKEY','EXPSIG','EXPKEYSIG','REVKEYSIG','KEYREVOKED','KEYEXPIRED','SIGEXPIRED','FAILURE','ERROR','NODATA'])assert.throws(()=>signingProof(signature+'[GNUPG:] '+bad+' bad\n',listing,manifest,now));
  assert.throws(()=>signingProof(signature.replace(primary,'A'.repeat(40)),listing,manifest,now));assert.throws(()=>signingProof(signature.replace(' 1 8 01',' 1 2 01'),listing,manifest,now));
  for(const invalid of ['r','e','d','i'])assert.throws(()=>signingProof(signature,listing.replace('sub:-:','sub:'+invalid+':'),manifest,now));
  assert.throws(()=>signingProof(signature,listing,manifest,now+manifest.metadataMaximumAgeMs));
});
function publicWitness(){
  const bytes=fs.readFileSync(path.join(__dirname,'fixtures/gpg-status-926291d6.json'));
  assert.equal(sha(bytes),'ab511cd860788f7e61acb234b2a0f4de9b5c633770e0ad346f9be85186353efe');
  const witness=JSON.parse(bytes);assert.equal(witness.complete,true);assert.deepEqual(witness.commandExitCodes,{decrypt:0,listKeys:0});
  for(const stream of Object.values(witness.streams)){assert.equal(Buffer.byteLength(stream.text),stream.bytes);assert.equal(sha(stream.text),stream.sha256);}
  return {status:witness.streams.status.text,keys:witness.streams.keyListing.text,at:witness.observedAtUnixMs};
}
test('actual public GPG witness accepts only expired unused subkey notices with a valid current signer',()=>{
  const value=publicWitness(),proof=signingProof(value.status,value.keys,manifest,value.at);
  assert.equal(proof.primary,primary);assert.equal(proof.signer,'0E225917414670F4442C250DFD533C07C264648F');
  const notices=value.status.match(/^\[GNUPG:\] KEYEXPIRED \d+$/gm);assert.equal(notices.length,15);assert.equal(new Set(notices).size,5);
  assert.deepEqual(signingProof(value.status.replace(/^\[GNUPG:\] KEYEXPIRED.*\n/gm,''),value.keys,manifest,value.at),proof);
  for(const bad of ['BADSIG','ERRSIG','NO_PUBKEY','EXPSIG','EXPKEYSIG','REVKEYSIG','KEYREVOKED','SIGEXPIRED','FAILURE','ERROR','NODATA'])assert.throws(()=>signingProof(value.status+'[GNUPG:] '+bad+' bad\n',value.keys,manifest,value.at),undefined,bad);
});
test('expired-subkey exception rejects malformed notices, ambiguous keys and unbound signature status',()=>{
  const base=publicWitness(),notice='[GNUPG:] KEYEXPIRED 1555048520',news='[GNUPG:] NEWSIG\n';
  const good=base.status.match(/^\[GNUPG:\] GOODSIG.*\n/m)[0],valid=base.status.match(/^\[GNUPG:\] VALIDSIG.*\n/m)[0];
  const expiredKey=base.keys.match(/^sub:e:.*1555048520.*\nfpr:.*\n/m)[0],expiredFingerprint='3B068FB4789ABE4AEFA3BB491397BC53640DB551';
  const changes=[
    x=>x.status+='[GNUPG:]\n',
    x=>x.status=x.status.replace(news,''),x=>x.status+=news,
    x=>x.status=notice+'\n'+x.status.replace(notice+'\n',''),
    x=>x.status=x.status.replace(good,''),x=>x.status+=good,
    x=>x.status=x.status.replace(good,good.replace('FD533C07C264648F','0000000000000000')),
    x=>x.status=x.status.replace(good,'').replace(valid,valid+good),
    x=>x.keys=x.keys.replace('sub:e:4096:1:1397BC53640DB551','sub:-:4096:1:1397BC53640DB551'),
    x=>x.keys=x.keys.replace('sub:e:4096:1:1397BC53640DB551','sub:r:4096:1:1397BC53640DB551'),
    x=>x.keys=x.keys.replace(expiredFingerprint,'bad'),
    x=>x.keys=x.keys.replace(expiredFingerprint,primary),
    x=>x.keys=x.keys.replace('fpr:::::::::'+expiredFingerprint+':','fpr:::::::::'+expiredFingerprint+':\nfpr:::::::::'+expiredFingerprint+':'),
    x=>x.keys+=expiredKey,
    x=>x.keys+=expiredKey.replace(expiredFingerprint,'A'.repeat(40)).replace('sub:e:','sub:-:'),
    x=>x.keys=expiredKey+x.keys.replace(expiredKey,''),
    x=>x.keys=x.keys.replace(':1460440520:1555048520:',':1555048521:1555048520:'),
    x=>x.keys=x.keys.replace(':1736268781:1830876781:',':1736268781:1555048520:'),
    x=>x.keys=x.keys.replace(':1460440275::',':1460440275:1555048520:'),
    x=>x.keys=x.keys.replace('sub:-:4096:1:FD533C07C264648F','sub:e:4096:1:FD533C07C264648F'),
    x=>x.status=x.status.replace(' 1 8 01 '+primary,' 1 2 01 '+primary),
    x=>x.at+=manifest.metadataMaximumAgeMs,
  ];
  for(const timestamp of ['', '0','-1','1.5','1e3','+1555048520','01555048520','1555048520 extra','9007199254740992','1'])changes.push(x=>x.status=x.status.replace(notice,'[GNUPG:] KEYEXPIRED '+timestamp));
  for(const timestamp of ['1.460440520e9','1460440520.0','1_460_440_520','+1460440520','01460440520','-1460440520','0',' 1460440520 ','9007199254741'])changes.push(x=>x.keys=x.keys.replace(':1460440520:1555048520:',':'+timestamp+':1555048520:'));
  for(const timestamp of ['1.555048520e9','1555048520.0','1_555_048_520','+1555048520','01555048520','-1555048520','0',' 1555048520 ','9007199254741'])changes.push(x=>x.keys=x.keys.replace(':1460440520:1555048520:',':1460440520:'+timestamp+':'));
  for(const change of changes){const value={...base};change(value);assert.throws(()=>signingProof(value.status,value.keys,manifest,value.at));}
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
