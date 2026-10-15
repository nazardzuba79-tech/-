'use strict';
const assert=require('node:assert/strict'),crypto=require('node:crypto'),zlib=require('node:zlib');
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
function bytesMatch(bytes,expected){assert.equal(bytes.length,expected.bytes,'download size mismatch');assert.equal(sha(bytes),expected.sha256,'download digest mismatch');}
function field(text,key){const rows=text.split('\n').filter(row=>row.startsWith(key+':'));assert.equal(rows.length,1,'unique '+key+' required');return rows[0].slice(key.length+1).trim();}
function signingProof(status,keyListing,manifest,now){
  assert.ok(typeof status==='string'&&status.length<65536);assert.ok(Number.isFinite(now));
  const rows=status.split('\n').filter(Boolean).map(row=>row.trim().split(/\s+/));
  for(const row of rows){assert.ok(row.length>1,'GPG status token required');assert.equal(row[0],'[GNUPG:]');assert.ok(!['BADSIG','ERRSIG','NO_PUBKEY','EXPSIG','EXPKEYSIG','REVKEYSIG','KEYREVOKED','SIGEXPIRED','FAILURE','ERROR','NODATA'].includes(row[1]),'GPG rejection: '+row[1]);}
  const expiredNotices=rows.filter(row=>row[1]==='KEYEXPIRED');
  const valid=rows.filter(row=>row[1]==='VALIDSIG');assert.equal(valid.length,1,'one valid signature required');
  const signature=valid[0],signer=signature[2];assert.match(signer,/^[A-F0-9]{40}$/);
  assert.ok(signer===manifest.googlePrimaryFingerprint||signature.at(-1)===manifest.googlePrimaryFingerprint,'signature must chain to the pinned Google primary');
  assert.ok(['8','9','10','11'].includes(signature[9]),'modern signature digest required');
  const created=Number(signature[4])*1000,expires=Number(signature[5])*1000;
  assert.ok(created>0&&created<=now+manifest.metadataFutureToleranceMs&&now-created<=manifest.metadataMaximumAgeMs,'signature timestamp out of bounds');
  assert.ok(expires===0||expires>now,'signature expired');
  const entries=[];let current;
  for(const line of keyListing.split('\n')){const parts=line.split(':');if(['pub','sub'].includes(parts[0])){current={type:parts[0],validity:parts[1],created:Number(parts[5])*1000,expires:Number(parts[6])*1000,createdText:parts[5],expiresText:parts[6],fingerprintCount:0};entries.push(current);}else if(parts[0]==='fpr'&&current){current.fingerprintCount++;if(!current.fingerprint)current.fingerprint=parts[9];}}
  const primaries=entries.filter(row=>row.type==='pub');assert.equal(primaries.length,1,'only the pinned Google primary may be imported');assert.equal(primaries[0].fingerprint,manifest.googlePrimaryFingerprint);
  const signingKey=entries.find(row=>row.fingerprint===signer);assert.ok(signingKey,'validated signing subkey unavailable');
  for(const entry of [primaries[0],signingKey]){assert.ok(!['r','e','d','i'].includes(entry.validity),'revoked/expired/disabled/invalid signing key');assert.ok(entry.created>0&&entry.created<=now+manifest.metadataFutureToleranceMs);assert.ok(entry.expires===0||entry.expires>now,'signing key expired');}
  if(expiredNotices.length){
    assert.equal(entries[0],primaries[0],'expired notices require a single unambiguous primary-key listing');
    const fingerprints=new Set();
    for(const entry of entries){assert.equal(entry.fingerprintCount,1,'one full fingerprint per key required');assert.match(entry.fingerprint,/^[A-F0-9]{40}$/);assert.ok(!fingerprints.has(entry.fingerprint),'duplicate key fingerprint');fingerprints.add(entry.fingerprint);}
    const news=rows.filter(row=>row[1]==='NEWSIG'),good=rows.filter(row=>row[1]==='GOODSIG');
    assert.equal(news.length,1,'expired notices require one NEWSIG');assert.equal(good.length,1,'expired notices require one GOODSIG');
    assert.equal(good[0][2],signer.slice(-16),'GOODSIG must identify the selected signer');
    const newsIndex=rows.indexOf(news[0]);assert.ok(newsIndex<rows.indexOf(good[0])&&rows.indexOf(good[0])<rows.indexOf(signature),'signature status ordering is ambiguous');
    for(const notice of expiredNotices){
      assert.ok(rows.indexOf(notice)>newsIndex,'expired notice precedes NEWSIG');assert.equal(notice.length,3,'one expired-key timestamp required');assert.match(notice[2],/^[1-9][0-9]*$/);
      const expiredAt=Number(notice[2])*1000;assert.ok(Number.isSafeInteger(expiredAt)&&expiredAt>0,'invalid expired-key timestamp');
      const matches=entries.filter(entry=>entry.expires===expiredAt);assert.equal(matches.length,1,'expired-key timestamp must identify exactly one key');
      const entry=matches[0];assert.equal(entry.type,'sub');assert.equal(entry.validity,'e');assert.notEqual(entry.fingerprint,manifest.googlePrimaryFingerprint);assert.notEqual(entry.fingerprint,signer);
      for(const [text,value] of [[entry.createdText,entry.created],[entry.expiresText,entry.expires]]){assert.match(text,/^[1-9][0-9]*$/);assert.ok(Number.isSafeInteger(value)&&value>0,'canonical safe unused-subkey timestamp required');}
      assert.ok(entry.created>0&&entry.created<=expiredAt&&expiredAt<=now,'expired unused subkey timestamps invalid');
    }
  }
  return {primary:manifest.googlePrimaryFingerprint,signer,created,expires};
}
function releaseProof(text,manifest,now){
  assert.ok(text.length<65536);assert.equal(field(text,'Origin'),'Google LLC');assert.equal(field(text,'Suite'),'stable');assert.equal(field(text,'Codename'),'stable');
  const date=Date.parse(field(text,'Date'));assert.ok(Number.isFinite(date)&&date<=now+manifest.metadataFutureToleranceMs&&now-date<=manifest.metadataMaximumAgeMs,'Release timestamp out of bounds');
  if(/^Valid-Until:/m.test(text)){const until=Date.parse(field(text,'Valid-Until'));assert.ok(Number.isFinite(until)&&until>now,'Release expired');}
  const sections=text.split(/^SHA256:\s*$/m);assert.equal(sections.length,2,'one Release SHA256 section required');
  const rows=sections[1].split('\n').slice(1),matches=[];
  for(const row of rows){if(row&&!/^\s/.test(row))break;const m=/^\s+([a-f0-9]{64})\s+(\d+)\s+(\S+)\s*$/.exec(row);if(m&&m[3]===manifest.packages.path)matches.push(m);}
  assert.equal(matches.length,1,'unique authenticated Packages entry required');assert.equal(matches[0][1],manifest.packages.sha256);assert.equal(Number(matches[0][2]),manifest.packages.bytes);
  return {date,packagesSha256:matches[0][1],packagesBytes:Number(matches[0][2])};
}
function packageProof(compressed,manifest){
  bytesMatch(compressed,manifest.packages);const text=zlib.gunzipSync(compressed,{maxOutputLength:1048576}).toString('utf8');
  const entries=text.split(/\n\n+/).filter(entry=>/^Package: google-chrome-stable$/m.test(entry));assert.equal(entries.length,1,'unique Chrome package required');const entry=entries[0];
  for(const [key,value]of Object.entries({Package:manifest.chrome.name,Version:manifest.chrome.version,Architecture:manifest.chrome.architecture,Filename:manifest.chrome.filename,SHA256:manifest.chrome.sha256}))assert.equal(field(entry,key),value,'Chrome '+key+' mismatch');
  assert.equal(Number(field(entry,'Size')),manifest.chrome.bytes);return {...manifest.chrome};
}
module.exports={sha,bytesMatch,signingProof,releaseProof,packageProof};
