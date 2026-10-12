import { readFileSync,writeFileSync,mkdirSync,existsSync,readdirSync } from 'node:fs';
import { resolve,dirname,relative,sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const here=dirname(fileURLToPath(import.meta.url));
const hash=value=>createHash('sha256').update(value).digest('hex');
const canonical=value=>value.replace(/\r\n/g,'\n');
const expected=JSON.parse(readFileSync(resolve(here,'sources.json'),'utf8'));
export function transform(file,input){
 let text=canonical(input);const changes=[];
 const replace=(name,from,to,count=1)=>{
  const actual=text.split(from).length-1;
  if(actual!==count)throw Error('TRACE_ANCHOR_COUNT '+file+' '+name+' expected='+count+' actual='+actual);
  text=text.split(from).join(to);changes.push({name,count});
 };
 const prelude="import * as phase from '../stocks/phase-trace/recorder.mjs';\n";
 if(file==='services/stocks-global/server.mjs'){
  text=prelude+text;
  replace('auth phases',"    const principal=await authenticate(req),id=accountId(principal);","    phase.event(phase.EVENTS.AUTH_START);\n    const principal=await authenticate(req),id=accountId(principal);\n    phase.event(phase.EVENTS.AUTH_END);\n    const phaseId=phase.contextId(contexts.get(id)??contextFlights.get(id));");
  replace('physical context init',"      const pending=accounts.forPrincipal(principal).then(store=>{const ctx=context(store,id);contexts.set(id,ctx);return ctx;}).finally(()=>contextFlights.delete(id));","      phase.event(phase.EVENTS.CONTEXT_INIT,phaseId);\n      const pending=accounts.forPrincipal(principal).then(store=>{const ctx=context(store,id);if(phase.enabled)ctx.__phaseContext=phaseId;contexts.set(id,ctx);return ctx;}).finally(()=>contextFlights.delete(id));");
  replace('shared context correlation',"      contextFlights.set(id,pending);","      if(phase.enabled)pending.__phaseContext=phaseId;\n      contextFlights.set(id,pending);");
  replace('context wait ready',"    const ctx=contexts.get(id)??await contextFlights.get(id);ctx.accessed=now();return ctx;","    phase.event(phase.EVENTS.CONTEXT_WAIT,phaseId,Number(contexts.has(id)));\n    const ctx=contexts.get(id)??await contextFlights.get(id);phase.event(phase.EVENTS.CONTEXT_READY,phaseId);ctx.accessed=now();return ctx;");
  replace('serialize begin',"const send=(res,code,body,headers={})=>{res.writeHead(code,","const send=(res,code,body,headers={})=>{phase.event(phase.EVENTS.RESPONSE_BEGIN,code);res.writeHead(code,");
  replace('serialize end',"res.end(JSON.stringify(body));};","res.end(JSON.stringify(body));phase.event(phase.EVENTS.RESPONSE_END,code);};");
  replace('HTTP ALS wrapper',"const server=http.createServer(async(req,res)=>{try{","const server=http.createServer((req,res)=>phase.http(req,res,async(req,res)=>{try{");
  replace('HTTP wrapper close',"}else res.end();}});","}else res.end();}}));");
  replace('history response begin',"res.writeHead(200,{'Content-Type':'application/json','Content-Length':body.length","phase.event(phase.EVENTS.RESPONSE_BEGIN,200);res.writeHead(200,{'Content-Type':'application/json','Content-Length':body.length");
  replace('history response end',"res.end(body);return;}","res.end(body);phase.event(phase.EVENTS.RESPONSE_END,200);return;}");
 }
 if(file==='services/stocks-global/account-worker.mjs'){
  text=prelude+text;
  replace('worker shared buffers',"workerData:{path,diagnostics:!!diagnostics,clock:clock?.buffer,testControl,registrationControl}","workerData:{path,diagnostics:!!diagnostics,clock:clock?.buffer,testControl,registrationControl,...phase.workerTransfer()}");
  replace('queue settlement',"const settle=(entry,code,value)=>{clearTimeout(entry.timer);","const settle=(entry,code,value)=>{phase.settle(entry,code,bytes);clearTimeout(entry.timer);");
  replace('physical dispatch',"    active={entries,requestId:first.requestId,registrationBatch,dispatchedAt:performance.now()};","    phase.dispatch(entries,queue.length,bytes);\n    active={entries,requestId:first.requestId,registrationBatch,dispatchedAt:performance.now()};");
  replace('batch message correlation',"{kind:'ensureBatch',requestId:first.requestId,principals:","{kind:'ensureBatch',requestId:first.requestId,...phase.message(first),principals:");
  replace('command message correlation',"{kind:'command',requestId:first.requestId,principal:","{kind:'command',requestId:first.requestId,...phase.message(first),principal:");
  replace('main message receipt',"  worker.on('message',message=>{","  worker.on('message',message=>{\n    phase.receipt(message);");
  replace('admitted entry correlation',"      bytes+=size;counters.accepted++;","      phase.admit(entry,pending,bytes+size);\n      bytes+=size;counters.accepted++;");
  // Same rules for both revisions; conditional matches represent pre-existing syntax only.
  const rejection="return Promise.reject(error('";
  for(const code of ['ACCOUNT_UNAVAILABLE','ACCOUNT_COMMAND_INVALID','ACCOUNT_BUSY','ACCOUNT_READ_ABORTED']){
   const from=rejection+code+"'));",count=text.split(from).length-1;
   if(count)replace('admission rejection '+code,from,"return (phase.reject(type,'"+code+"'),Promise.reject(error('"+code+"')));",count);
  }
 }
 if(file==='services/stocks-global/account-worker-runtime.mjs'){
  text=prelude+text;
  replace('worker start',"  busy=true;","  busy=true;phase.workerStart(message);");
  replace('existing postMessage phases',"parentPort.postMessage(","phase.post(parentPort,",6);
  replace('worker context cleanup',"finally{busy=false;}","finally{busy=false;phase.workerClear();}");
 }
 if(file==='services/stocks-global/accounts.mjs'){
  text=prelude+text;
  replace('SQL start',"    const started=performance.now(),cpu=process.threadCpuUsage?.();","    phase.sqlStart(stage,kind);\n    const started=performance.now(),cpu=process.threadCpuUsage?.();");
  replace('SQL end',"      counters.sqlCalls++;counters[kind]++;","      phase.sqlEnd(stage,kind,wallMs,used?cpuMs:-1);\n      counters.sqlCalls++;counters[kind]++;");
 }
 if(file==='services/stocks/realistic-readers.mjs'){
  text="import * as phase from './phase-trace/recorder.mjs';\n"+text;
  replace('numeric request ID',"export function request(url,{headers={},timeoutMs=3000}={}){\n  return new Promise","export function request(url,{headers={},timeoutMs=3000}={}){\n  const phaseId=phase.clientStart(url,timeoutMs);headers={...headers,'x-stocks-phase-request':String(phaseId)};\n  return new Promise");
  replace('request terminal outcome',"settled=true;clearTimeout(deadline);error?fail(error):ok(value);","settled=true;clearTimeout(deadline);if(phase.enabled)phase.clientEnd(phaseId,error,value,value&&value.status!==200?safeHttpErrorCode(value.body):null);error?fail(error):ok(value);");
  replace('response headers',"const req=get(url,{headers},res=>{const chunks=[];","const req=get(url,{headers},res=>{phase.clientHeaders(phaseId,res.statusCode);const chunks=[];");
  replace('request deadline',"const deadline=setTimeout(()=>{const error=Error('Request deadline exceeded');","const deadline=setTimeout(()=>{phase.clientDeadline(phaseId);const error=Error('Request deadline exceeded');");
  replace('socket phases',"    req.on('error',finish);","    if(phase.enabled)req.once('socket',socket=>phase.clientSocket(phaseId,req,socket));\n    req.on('error',finish);");
 }
 return {text,changes};
}
export function instrument(source,out){
 source=resolve(source);out=resolve(out);
 const rel=relative(source,out);
 if(!rel||(!rel.startsWith('..'+sep)&&rel!=='..'))throw Error('TRACE_SHADOW_MUST_BE_OUTSIDE_SOURCE');
 if(existsSync(out)&&readdirSync(out).length)throw Error('TRACE_SHADOW_MUST_BE_EMPTY');
 const inputs=expected.files.map(file=>{const bytes=readFileSync(resolve(source,file)),text=bytes.toString('utf8');return{file,bytes,text,sha256:hash(canonical(text)),rawSha256:hash(bytes)};});
 const revisions=Object.entries(expected.revisions).filter(([,files])=>inputs.every(item=>files[item.file]===item.sha256)).map(([rev])=>rev);
 if(revisions.length!==1)throw Error('TRACE_UNVERIFIED_SOURCE_REVISION');
 const prepared=inputs.map(item=>({...item,...transform(item.file,item.text)}));
 mkdirSync(out,{recursive:true});
 const files=prepared.map(item=>{const dest=resolve(out,item.file);mkdirSync(dirname(dest),{recursive:true});writeFileSync(dest,item.text);return{file:item.file,sourceSha256:item.sha256,rawSourceSha256:item.rawSha256,shadowSha256:hash(item.text),changed:item.changes.length>0,anchors:item.changes};});
 const recorder=readFileSync(resolve(here,'recorder.mjs'));const target=resolve(out,'services/stocks/phase-trace/recorder.mjs');mkdirSync(dirname(target),{recursive:true});writeFileSync(target,recorder);
 const manifest={version:1,sourceRevision:revisions[0],transformSha256:hash(readFileSync(fileURLToPath(import.meta.url))),sourceAllowlistSha256:hash(readFileSync(resolve(here,'sources.json'))),recorderSha256:hash(recorder),files,diagnosticOnly:true,originalAcceptanceUnchanged:true,readerScheduleUnchanged:true,offAndOnSameTransformedFiles:true,notes:['Canonical source hashes normalize CRLF to LF; raw source hashes are retained.','Only disposable copies are transformed. No business prices, order rules, queue budgets, TTLs, cadence, deadlines, or acceptance criteria are changed.','Diagnostic reader adds a numeric correlation header in both OFF and ON; phase listeners/clocks/buffers only ON.','No principals, tokens, bodies, quotes, SQL text, or arbitrary error strings are traced.']};
 writeFileSync(resolve(out,'source-manifest.json'),JSON.stringify(manifest,null,2));return manifest;
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const args=process.argv.slice(2),value=key=>{const index=args.indexOf(key);return index>=0?args[index+1]:null;};
 const source=value('--source'),out=value('--out');if(!source||!out)throw Error('Usage: instrument.mjs --source <exact archive> --out <empty outside shadow>');
 const manifest=instrument(source,out);console.log(JSON.stringify({sourceRevision:manifest.sourceRevision,files:manifest.files.length,changed:manifest.files.filter(f=>f.changed).length,transformSha256:manifest.transformSha256}));
}
