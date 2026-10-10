// Explicit one-off import, never reachable from a visitor endpoint.
import { readFileSync,writeFileSync,mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve,join } from 'node:path';
const approvedHosts=new Set(['upload.wikimedia.org']);
const request=JSON.parse(readFileSync(process.argv[2],'utf8'));
const manifest=JSON.parse(readFileSync(new URL('./manifest.json',import.meta.url)));
if(!manifest.some(i=>i.instrumentId===request.instrumentId)||!request.companyId||!request.usageNote||request.rightsConfirmed!==true)throw Error('Verified association and usage rights required');
const url=new URL(request.sourceUrl);if(url.protocol!=='https:'||!approvedHosts.has(url.hostname)||url.username||url.password)throw Error('Unapproved asset source');
const response=await fetch(url,{signal:AbortSignal.timeout(10000),redirect:'error'});if(!response.ok)throw Error('Asset unavailable');
const reader=response.body.getReader(),chunks=[];let size=0;
try{while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>20480)throw Error('Logo exceeds 20 KiB; optimize offline');chunks.push(value);}}finally{await reader.cancel();reader.releaseLock();}
const bytes=Buffer.concat(chunks);if(bytes.length<24||bytes.subarray(0,8).toString('hex')!=='89504e470d0a1a0a')throw Error('Only validated PNG assets; no SVG');
const width=bytes.readUInt32BE(16),height=bytes.readUInt32BE(20);if(width<16||height<16||width>256||height>256)throw Error('Invalid dimensions');
const hash=createHash('sha256').update(bytes).digest('hex'),name=request.instrumentId.replace(':','-')+'-'+hash.slice(0,12)+'.png';
const dir=resolve(new URL('../../frontend/public/assets/stocks/',import.meta.url).pathname.replace(/^\/(\w:)/,'$1'));mkdirSync(dir,{recursive:true});writeFileSync(join(dir,name),bytes);
writeFileSync(join(dir,name+'.json'),JSON.stringify({instrumentId:request.instrumentId,companyId:request.companyId,sourceUrl:url.href,usageNote:request.usageNote,localPath:'/assets/stocks/'+name,contentHash:hash,width,height},null,2));
console.log('Imported verified local asset; update reviewed manifest logoPath explicitly.');
