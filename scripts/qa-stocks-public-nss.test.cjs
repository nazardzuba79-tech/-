'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {assertLinux,trustInventory,safeLaunch,inspectNss,chromePackage,inspectChrome,retainChromePreflight,CHROME}=require('./qa-stocks-public-nss.cjs');
test('NSS helper accepts Linux only; never invokes Windows certutil',()=>{
  assertLinux('linux');for(const platform of ['win32','darwin',undefined])assert.throws(()=>assertLinux(platform),/NSS_FIXTURE_REQUIRES_LINUX/);
  if(process.platform!=='linux')assert.throws(()=>inspectNss('/never/executed'),/NSS_FIXTURE_REQUIRES_LINUX/);
});
test('NSS inventory requires exactly the private server-CA entry',()=>{
  const header='Certificate Nickname                  Trust Attributes\n  SSL,S/MIME,JAR/XPI\n\n';
  trustInventory(header+'fixture       C,,\n','fixture');
  for(const value of ['fixture P,,','fixture C,,\nother C,,','fixture C,,\nunknown text','fixture ,,',''])assert.throws(()=>trustInventory(header+value,'fixture'));
});
test('owned browser launch rejects every certificate/security bypass spelling',()=>{
  safeLaunch(['chromium','--headless','--user-data-dir=/private/profile']);
  for(const option of ['--ignore-certificate-errors','--ignore-certificate-errors-spki-list=abc','--allow-insecure-localhost','--disable-web-security','--no-sandbox','--disable-setuid-sandbox'])assert.throws(()=>safeLaunch(['chromium',option]),/bypass prohibited/);
});
const installed={requested:CHROME,resolved:CHROME,owner:'google-chrome-stable: '+CHROME,packageVersion:'123.0.4567.89-1',actualVersion:'Google Chrome 123.0.4567.89',uid:0,mode:0o100755,regular:true,symlink:false};
test('installed Chrome requires exact path, package, root ownership and non-writable executable',()=>{
  assert.equal(chromePackage(installed),'123.0.4567.89');
  for(const delta of [{requested:'/tmp/chrome'},{resolved:'/tmp/chrome'},{owner:'chromium: '+CHROME},{uid:1001},{mode:0o100777},{mode:0o100644},{regular:false},{symlink:true}])assert.throws(()=>chromePackage({...installed,...delta}));
});
test('installed Chrome version must match package; no bundled or platform fallback',()=>{
  for(const delta of [{packageVersion:''},{packageVersion:'123.0.4567.89'},{actualVersion:'Chromium 123.0.4567.89'},{actualVersion:'Google Chrome 124.0.4567.89'},{actualVersion:'Google Chrome 123.0.4567.89\nextra'}])assert.throws(()=>chromePackage({...installed,...delta}));
  if(process.platform!=='linux')assert.throws(()=>inspectChrome(CHROME,{}),/NSS_FIXTURE_REQUIRES_LINUX/);
});
test('rejected Chrome identity retains bounded safe observations and the original error without executing it',()=>{
  const observation={status:'IN_PROGRESS',stage:'identity',binaryExecuted:false,file:{path:CHROME,uid:0,gid:0,mode:'775',bytes:100,write:{allowed:false,code:'EACCES'}},process:{uid:1001,gid:1001,groups:[1001]},parents:[{path:'/opt',uid:0,gid:0,mode:'755'}],packageOwner:installed.owner,packageVersion:installed.packageVersion};
  let executed=0,original;
  assert.throws(()=>retainChromePreflight(observation,()=>{
    try{chromePackage({...installed,mode:0o100775});}catch(error){original=error;throw error;}
    executed++;
  }),error=>{
    assert.equal(error,original);assert.match(error.message,/Chrome executable permissions/);assert.equal(error.chromePreflight,observation);return true;
  });
  assert.equal(executed,0);assert.equal(observation.binaryExecuted,false);assert.equal(observation.status,'REJECTED');assert.equal(observation.file.mode,'775');assert.equal(observation.file.write.allowed,false);assert.deepEqual(observation.process.groups,[1001]);assert.equal(observation.rejection.message,original.message);
  const valid={status:'IN_PROGRESS'};assert.equal(retainChromePreflight(valid,()=>42),42);assert.equal(valid.rejection,undefined);
});
