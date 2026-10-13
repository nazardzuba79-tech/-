// Exact-source diagnostic client shadow. The service stays pristine.
import { readFileSync,writeFileSync,readdirSync,mkdirSync,existsSync,cpSync } from 'node:fs';
import { resolve,relative,sep,dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
const here=dirname(fileURLToPath(import.meta.url)),canonical=text=>text.replace(/\r\n/g,'\n'),hash=text=>createHash('sha256').update(text).digest('hex');
export const SOURCE_REVISION='06a0d1a748cd943e45df9aa60d25e4ca5ec1b9cb';
export function transform(source){
 let text=canonical(source);const anchors=[];
 const replace=(label,from,to,count=1)=>{const found=text.split(from).length-1;if(found!==count)throw Error('TIMELINE_ANCHOR_COUNT '+label+' expected='+count+' actual='+found);text=text.split(from).join(to);anchors.push({label,count});};
 text="import * as timeline512 from './phase-trace-512/timeline-recorder.mjs';\n"+text;
 replace('optional local capture argument','export function request(url,{headers={},timeoutMs=3000}={}){','export function request(url,{headers={},timeoutMs=3000,__timeline512}={}){');
 replace('actual response headers','const req=get(url,{headers},res=>{const chunks=[];',"const req=get(url,{headers},res=>{timeline512.headers(__timeline512,res.statusCode);const chunks=[];");
 replace('response bound cancellation',"req.destroy(Error('Response exceeds fixture bound'));return;","req.destroy(Error('Response exceeds fixture bound'));timeline512.cancellation(__timeline512,'response-bound');return;");
 replace('deadline cancellation','req.destroy(error);finish(error);',"req.destroy(error);finish(error);timeline512.cancellation(__timeline512,'deadline');");
 replace('relative attempt start','const start=performance.now();requests++;','const start=performance.now();requests++;const timelineAttempt=timeline512.begin(operation,start-started);');
 replace('pass local capture',"const response=await request(new URL(path,address),{headers:mode==='global'?{authorization:`Bearer fixture-user-${user}`}:{}});","const response=await request(new URL(path,address),{headers:mode==='global'?{authorization:`Bearer fixture-user-${user}`}:{},__timeline512:timelineAttempt});");
 replace('completed response marker','count(statuses,String(response.status));','timeline512.responseComplete(timelineAttempt);count(statuses,String(response.status));');
 replace('safe public failure code','count(httpErrorCodes,key);count(record.httpErrorCodes,key);','timeline512.publicError(timelineAttempt,code);count(httpErrorCodes,key);count(record.httpErrorCodes,key);');
 replace('outcome allowlist','}catch(error){errors++;record.errors++;','}catch(error){timeline512.failure(timelineAttempt,error);errors++;record.errors++;');
 replace('reuse existing duration clock','finally{allLatencies.push(performance.now()-start);}','finally{const timelineDuration=performance.now()-start;allLatencies.push(timelineDuration);timeline512.finish(timelineAttempt,timelineDuration);}');
 replace('export after elapsed measurement','return {fixture:true,mode,pattern,users,','return {requestTimeline:timeline512.snapshot(),fixture:true,mode,pattern,users,');
 return {text,anchors};
}
export function install(source,out){
 source=resolve(source);out=resolve(out);const rel=relative(source,out);
 if(!rel||(!rel.startsWith('..'+sep)&&rel!=='..'))throw Error('TIMELINE_SHADOW_MUST_BE_OUTSIDE_SOURCE');
 if(existsSync(out)&&readdirSync(out).length)throw Error('TIMELINE_SHADOW_MUST_BE_EMPTY');
 const expected=JSON.parse(readFileSync(resolve(here,'sources.json'),'utf8'));
 if(expected.revision!==SOURCE_REVISION)throw Error('TIMELINE_ALLOWLIST_REVISION_INVALID');
 const inventory=[];const visit=folder=>{for(const entry of readdirSync(resolve(source,folder),{withFileTypes:true})){const file=folder+'/'+entry.name;if(entry.isDirectory())visit(file);else if(entry.isFile())inventory.push(file);else throw Error('TIMELINE_SPECIAL_SOURCE_FILE');}};
 for(const folder of ['services/stocks','services/stocks-global','services/stocks-simulator'])visit(folder);
 if(JSON.stringify(inventory.sort())!==JSON.stringify(Object.keys(expected.files).sort()))throw Error('TIMELINE_FILESET_MISMATCH');
 const files=inventory.map(file=>{const raw=readFileSync(resolve(source,file));if(hash(canonical(raw.toString('utf8')))!==expected.files[file])throw Error('TIMELINE_UNVERIFIED_SOURCE '+file);return {file,rawSha256:hash(raw),canonicalSha256:expected.files[file]};});
 const reader='services/stocks/realistic-readers.mjs',changed=transform(readFileSync(resolve(source,reader),'utf8'));
 mkdirSync(out,{recursive:true});for(const folder of ['services/stocks','services/stocks-global','services/stocks-simulator'])cpSync(resolve(source,folder),resolve(out,folder),{recursive:true});
 writeFileSync(resolve(out,reader),changed.text);mkdirSync(resolve(out,'services/stocks/phase-trace-512'),{recursive:true});const recorder=readFileSync(resolve(here,'timeline-recorder.mjs'));writeFileSync(resolve(out,'services/stocks/phase-trace-512/timeline-recorder.mjs'),recorder);
 const manifest={sourceRevision:SOURCE_REVISION,diagnosticOnly:true,clientOnly:true,serverMustUsePristineArchive:true,originalReaderSha256:expected.files[reader],shadowReaderSha256:hash(changed.text),recorderSha256:hash(recorder),anchors:changed.anchors,sourceFiles:files,notes:['Only reader capture/export is transformed; requests, deadlines, cadence, order, safeCode rules, source IDs and criteria are retained.','Execute the client shadow outside the service cgroup. Never build or run a server from this shadow.','Existing acceptance source and previously collected artifacts are untouched.']};
 writeFileSync(resolve(out,'timeline-source-manifest.json'),JSON.stringify(manifest,null,2)+'\n');return manifest;
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){const [source,out]=process.argv.slice(2);if(!source||!out)throw Error('Exact source archive and empty client shadow required');console.log(JSON.stringify(install(source,out)));}
