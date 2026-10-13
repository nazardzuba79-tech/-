import { readFileSync,writeFileSync,mkdirSync,existsSync,readdirSync,cpSync } from 'node:fs';
import { resolve,dirname,relative,sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
const here=dirname(fileURLToPath(import.meta.url)),canonical=s=>s.replace(/\r\n/g,'\n'),hash=s=>createHash('sha256').update(s).digest('hex');
export const SOURCE_REVISION='06a0d1a748cd943e45df9aa60d25e4ca5ec1b9cb';
export function transform(file,source){
 let text=canonical(source);const anchors=[];
 const replace=(label,from,to,count=1)=>{const found=text.split(from).length-1;if(found!==count)throw Error('TRACE_ANCHOR_COUNT '+file+' '+label+' expected='+count+' actual='+found);text=text.split(from).join(to);anchors.push({label,count});};
 const prelude="import * as phase512 from '../stocks/phase-trace-512/recorder.mjs';\n";
 if(file==='services/stocks-global/server.mjs'){
  text=prelude+text;
  replace('auth','await authenticate(req)','await phase512.asyncMeasure(\'auth\',()=>authenticate(req))');
  const line=text.split('\n').find(l=>l.includes('const status=async(ctx,committed,signal)=>('));
  if(!line)throw Error('TRACE_STATUS_ANCHOR');
  replace('status',line,line.replace('=>(','=>phase512.asyncMeasure(\'status\',async()=>(').replace(/;$/,');'));
  replace('JSON response','res.end(JSON.stringify(body));};',"res.end(phase512.sync('json',()=>JSON.stringify(body)));};");
  replace('HTTP wrapper','const server=http.createServer(async(req,res)=>{try{','const server=http.createServer((req,res)=>phase512.http(req,res,async(req,res)=>{try{');
  replace('HTTP close','}else res.end();}});','}else res.end();}}));');
 }
 if(file==='services/stocks-global/account-worker.mjs'){
  text=prelude+text;
  replace('shared buffer','workerData:{path,diagnostics:!!diagnostics,clock:clock?.buffer,testControl,registrationControl}','workerData:{path,diagnostics:!!diagnostics,clock:clock?.buffer,testControl,registrationControl,...phase512.workerTransfer()}');
  replace('main postMessage alias','  let ready=false,dead=false,',"  const phaseWorkerPost=message=>phase512.sync('postMessage',()=>worker.postMessage(message));\n  let ready=false,dead=false,");
  replace('main postMessage calls','worker.postMessage(','phaseWorkerPost(',3);
  replace('main alias transport',"const phaseWorkerPost=message=>phase512.sync('postMessage',()=>phaseWorkerPost(message));","const phaseWorkerPost=message=>phase512.sync('postMessage',()=>worker.postMessage(message));");
  replace('queue timing','counters.waitMs+=waited;',"phase512.add('queue.'+entry.type,waited);counters.waitMs+=waited;");
  replace('roundtrip timing','counters.workMs+=elapsed;',"phase512.add('roundtrip.'+(group.registrationBatch?'ensureBatch':group.entries[0].type),elapsed);counters.workMs+=elapsed;");
  replace('admission clone','payload=structuredClone({principal,type,input});encoded=JSON.stringify(payload);',"phase512.sync('admission',()=>{payload=structuredClone({principal,type,input});encoded=JSON.stringify(payload);});");
 }
 if(file==='services/stocks-global/account-worker-runtime.mjs'){
  text=prelude+text;
  replace('worker begin','  busy=true;',"  busy=true;const phaseMark=phase512.begin('execute.'+(message.kind==='ensureBatch'?'ensureBatch':message.type));");
  replace('worker end','finally{busy=false;}','finally{phase512.end(phaseMark);busy=false;}');
  replace('read view','observations.view(store.id,store.readState())',"phase512.sync('view',()=>observations.view(store.id,store.readState()))");
  replace('read state','store.readState()',"phase512.sync('readState',()=>store.readState())",4);
  // postMessage's synchronous structured clone is included in this sampled stage.
  replace('port alias',"const clock=workerData.clock?", "const phasePost=message=>phase512.sync('postMessage',()=>parentPort.postMessage(message));\nconst clock=workerData.clock?");
  replace('port calls','parentPort.postMessage(', 'phasePost(',7);
  // Restore the actual transport in the alias (all other original calls stay wrapped).
  replace('alias transport',"const phasePost=message=>phase512.sync('postMessage',()=>phasePost(message));","const phasePost=message=>phase512.sync('postMessage',()=>parentPort.postMessage(message));");
 }
 if(file==='services/stocks-global/accounts.mjs'){
  text=prelude+text;
  replace('ledger parse','JSON.parse(row.ledger)',"phase512.sync('ledgerParse',()=>JSON.parse(row.ledger))");
  replace('ledger validate','validate(state); return state;',"phase512.sync('ledgerValidate',()=>validate(state)); return state;");
 }
 if(file==='services/stocks/realistic-global-fixture.mjs'){
  text="import * as phase512 from './phase-trace-512/recorder.mjs';\n"+text;
  replace('fixture metrics','return {fixture:true,externalApiCalls:0,accountDatabase:true,observationMetrics,', "return {phase512:phase512.snapshot(),phase512MemoryPeak:readCgroup('memory.peak'),fixture:true,externalApiCalls:0,accountDatabase:true,observationMetrics,");
 }
 return {text,anchors};
}
export function instrument(source,out){
 source=resolve(source);out=resolve(out);const rel=relative(source,out);
 if(!rel||(!rel.startsWith('..'+sep)&&rel!=='..'))throw Error('TRACE_SHADOW_MUST_BE_OUTSIDE_SOURCE');
 if(existsSync(out)&&readdirSync(out).length)throw Error('TRACE_SHADOW_MUST_BE_EMPTY');
 const expected=JSON.parse(readFileSync(resolve(here,'sources.json'),'utf8'));
 const inventory=[];const visit=folder=>{for(const entry of readdirSync(resolve(source,folder),{withFileTypes:true})){const file=folder+'/'+entry.name;if(entry.isDirectory())visit(file);else if(entry.isFile())inventory.push(file);else throw Error('TRACE_ARCHIVE_SPECIAL_FILE');}};
 for(const folder of ['services/stocks','services/stocks-global','services/stocks-simulator'])visit(folder);
 if(JSON.stringify(inventory.sort())!==JSON.stringify(Object.keys(expected.files).sort()))throw Error('TRACE_ARCHIVE_FILESET_MISMATCH');
 const prepared=Object.entries(expected.files).map(([file,want])=>{const raw=readFileSync(resolve(source,file)),text=canonical(raw.toString('utf8'));if(hash(text)!==want)throw Error('TRACE_UNVERIFIED_SOURCE '+file);return {file,rawSha256:hash(raw),sourceSha256:want,...transform(file,text)};});
 // Only disposable code archives. No env, databases, credentials or working checkout.
 mkdirSync(out,{recursive:true});for(const folder of ['services/stocks','services/stocks-global','services/stocks-simulator'])cpSync(resolve(source,folder),resolve(out,folder),{recursive:true});
 for(const item of prepared){const file=resolve(out,item.file);mkdirSync(dirname(file),{recursive:true});writeFileSync(file,item.text);}
 const recorder=readFileSync(resolve(here,'recorder.mjs'));mkdirSync(resolve(out,'services/stocks/phase-trace-512'),{recursive:true});writeFileSync(resolve(out,'services/stocks/phase-trace-512/recorder.mjs'),recorder);
 const manifest={sourceRevision:SOURCE_REVISION,diagnosticOnly:true,sameTransformedFilesOffAndOn:true,sampleEvery:16,recorderSha256:hash(recorder),transformSha256:hash(readFileSync(fileURLToPath(import.meta.url))),files:prepared.map(({file,rawSha256,sourceSha256,text,anchors})=>({file,rawSha256,sourceSha256,shadowSha256:hash(text),anchors}))};
 writeFileSync(resolve(out,'source-manifest.json'),JSON.stringify(manifest,null,2));return manifest;
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){const [source,out]=process.argv.slice(2);if(!source||!out)throw Error('source archive and empty shadow required');console.log(JSON.stringify(instrument(source,out)));}
