'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {assertLinux,trustInventory,safeLaunch,inspectNss,chromePackage,inspectChrome,CHROME}=require('./qa-stocks-public-nss.cjs');
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
