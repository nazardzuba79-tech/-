'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {assertLinux,trustInventory,safeLaunch,inspectNss}=require('./qa-stocks-public-nss.cjs');
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
