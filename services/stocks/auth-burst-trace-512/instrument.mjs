// Applies only to a disposable reviewed source archive, never the source checkout.
import { readFileSync,writeFileSync,mkdirSync,readdirSync,existsSync,lstatSync } from 'node:fs';
import { resolve,dirname,relative,sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
const here=dirname(fileURLToPath(import.meta.url)),hash=value=>createHash('sha256').update(value).digest('hex');
const canonical=value=>value.replace(/\r\n/g,'\n');
export const SOURCE_REVISION='f045d7255f1195ef3c7b6cca5a5e63f4c851a2a8';
export const PATHS=Object.freeze(['services/stocks-global/server.mjs','services/stocks-global/identity.mjs','services/stocks-global/account-worker.mjs','services/stocks-global/account-worker-runtime.mjs','services/stocks-global/accounts.mjs']);
const expected=JSON.parse(readFileSync(resolve(here,'sources.json'),'utf8'));
if(expected.sourceRevision!==SOURCE_REVISION||JSON.stringify(Object.keys(expected.files).sort())!==JSON.stringify([...PATHS].sort()))throw Error('TRACE_SOURCE_MANIFEST_INVALID');
const prelude="import * as __bt from '../stocks/auth-burst-trace-512/recorder.mjs';\n";
export function transform(file,input) {
  const raw=Buffer.isBuffer(input)?input:Buffer.from(input),original=raw.toString('utf8'),textInput=canonical(original);
  if(!PATHS.includes(file)||hash(textInput)!==expected.files[file])throw Error('TRACE_SOURCE_HASH_MISMATCH '+file);
  if(textInput.includes('\r')||original.includes('\r\n')&&original.replace(/\r\n/g,'').includes('\n')||textInput.includes('__bt'))throw Error('TRACE_SOURCE_FORMAT_INVALID');
  let text=textInput;const hunks=[];
  const replace=(label,from,to,count=1)=>{const found=text.split(from).length-1;if(found!==count||!from||from===to)throw Error('TRACE_HUNK_COUNT '+label);text=text.split(from).join(to);hunks.push({label,count,from,to});};
  if(file.endsWith('/server.mjs')){
    replace('request-lifetime-wrapper','const server=http.createServer(async(req,res)=>{let cleanupRequest;try{','const server=http.createServer((req,res)=>__bt.http(req,res,async(req,res)=>{let cleanupRequest;try{');
    replace('request-lifetime-end','}else res.end();}finally{cleanupRequest?.();}});','}else res.end();}finally{cleanupRequest?.();}}));');
    replace('auth-wall-only','const principal=await authenticate(req,{signal});',"const __btAuth=__bt.beginWall(__bt.E.AUTH_BEGIN);let principal;try{principal=await authenticate(req,{signal});__bt.endWall(__btAuth,__bt.E.AUTH_END);}catch(__btError){__bt.endWall(__btAuth,__bt.E.AUTH_FAIL);throw __btError;}");
    replace('context-start','const id=accountId(principal);','__bt.record(__bt.E.CONTEXT_BEGIN);const id=accountId(principal);');
    replace('context-ready','    return ctx;','    __bt.record(__bt.E.CONTEXT_END);return ctx;');
    const old="  const status=async(ctx,committed,signal)=>({... (committed??await(accounts?ctx.store.execute('readView',undefined,{signal}):ctx.store.read())),...(accounts?{account:{id:ctx.id,mode:'isolated-paper',quoteView:'volatile',canTrade:ctx.ownerMayTrade===true}}:{}),catalogue,errors:{...ctx.errors},metrics:{...hub.metrics,rssBytes:process.memoryUsage().rss,cpu:process.cpuUsage(),polling:now()-ctx.lease<12000}});";
    replace('status-sync-after-original-await',old,"  const status=async(ctx,committed,signal)=>{const __btView=committed??await(accounts?ctx.store.execute('readView',undefined,{signal}):ctx.store.read());return __bt.sync(__bt.E.STATUS_SYNC_BEGIN,__bt.E.STATUS_SYNC_END,()=>({...__btView,...(accounts?{account:{id:ctx.id,mode:'isolated-paper',quoteView:'volatile',canTrade:ctx.ownerMayTrade===true}}:{}),catalogue,errors:{...ctx.errors},metrics:{...hub.metrics,rssBytes:process.memoryUsage().rss,cpu:process.cpuUsage(),polling:now()-ctx.lease<12000}}));};");
    replace('response-json-sync','res.end(JSON.stringify(body));};','res.end(__bt.sync(__bt.E.RESPONSE_JSON_BEGIN,__bt.E.RESPONSE_JSON_END,()=>JSON.stringify(body)));};');
  }
  if(file.endsWith('/identity.mjs')){
    replace('identity-deadline','const timer = setTimeout(() => controller.abort(), IDENTITY_TIMEOUT_MS);','const __btDeadline = __bt.bindRecord(__bt.E.IDENTITY_DEADLINE);const timer = setTimeout(() => { __btDeadline(); controller.abort(); }, IDENTITY_TIMEOUT_MS);');
    replace('identity-abort','const onAbort = () => controller.abort();','const __btAbort = __bt.bindRecord(__bt.E.IDENTITY_ABORT);const onAbort = () => { __btAbort(); controller.abort(); };');
    replace('fetch-dispatch','return fetchImpl(url.href,','__bt.record(__bt.E.FETCH_DISPATCH);return fetchImpl(url.href,');
    replace('fetch-headers','response = value;','response = value;__bt.record(__bt.E.FETCH_HEADERS);');
    replace('body-begin','reader = response.body.getReader();','__bt.record(__bt.E.BODY_BEGIN);let __btFirst=false;reader = response.body.getReader();');
    replace('first-body-chunk',"check(value instanceof Uint8Array, 'AUTH_UNAVAILABLE');","check(value instanceof Uint8Array, 'AUTH_UNAVAILABLE');if(!__btFirst){__btFirst=true;__bt.record(__bt.E.BODY_FIRST_CHUNK);}");
    replace('body-end-parse',"const user = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(body.subarray(0, size)));","__bt.record(__bt.E.BODY_END);const user = __bt.sync(__bt.E.AUTH_JSON_BEGIN,__bt.E.AUTH_JSON_END,()=>JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(body.subarray(0, size))));");
    replace('identity-result','accountId(principal); return principal;','accountId(principal);__bt.record(__bt.E.IDENTITY_RESULT);return principal;');
  }
  if(file.endsWith('/account-worker.mjs')){
    replace('QA-startup-environment-buffer',"const worker=new Worker(new URL('./account-worker-runtime.mjs',import.meta.url),{workerData:{path,diagnostics:!!diagnostics,clock:clock?.buffer,testControl,registrationControl}});","const worker=__bt.withWorkerTrace(()=>new Worker(new URL('./account-worker-runtime.mjs',import.meta.url),{workerData:{path,diagnostics:!!diagnostics,clock:clock?.buffer,testControl,registrationControl}}));");
    replace('main-clone-sync','worker.postMessage(','__bt.mainPost(worker,',2);
    replace('main-admission-clone',"payload=structuredClone({principal,type,input});encoded=JSON.stringify(payload);","__bt.sync(__bt.E.MAIN_CLONE_BEGIN,__bt.E.MAIN_CLONE_END,()=>{payload=structuredClone({principal,type,input});encoded=JSON.stringify(payload);});");
    replace('bind-existing-command-id','bytes+=size;counters.accepted++;','__bt.workerBind(entry.requestId,type);bytes+=size;counters.accepted++;');
    replace('main-worker-result','    const group=active;','    __bt.workerResult(message.requestId);const group=active;');
    replace('settle-original-promise',"const settle=(entry,code,value)=>{clearTimeout(entry.timer);","const settle=(entry,code,value)=>{__bt.workerSettle(entry.requestId);clearTimeout(entry.timer);");
  }
  if(file.endsWith('/account-worker-runtime.mjs')){
    replace('worker-entry','  busy=true;','  busy=true;__bt.workerEnter(message.requestId,message.type);');
    replace('worker-finally','finally{busy=false;}','finally{__bt.workerExit();busy=false;}');
    replace('read-view-sync',"else if(type==='readView')value=observations.view(store.id,store.readState());","else if(type==='readView'){const __btState=store.readState();value=__bt.sync(__bt.E.VIEW_BEGIN,__bt.E.VIEW_END,()=>observations.view(store.id,__btState));}");
    replace('worker-clone-original-envelope','parentPort.postMessage(','__bt.workerPost(parentPort,',6);
  }
  if(file.endsWith('/accounts.mjs')){
    replace('native-read-sync',"sql('read','sqlReadCalls',()=>read.get(id))","sql('read','sqlReadCalls',()=>__bt.sync(__bt.E.SQL_READ_BEGIN,__bt.E.SQL_READ_END,()=>read.get(id)))");
    replace('ledger-parse-sync','JSON.parse(row.ledger)','__bt.sync(__bt.E.LEDGER_PARSE_BEGIN,__bt.E.LEDGER_PARSE_END,()=>JSON.parse(row.ledger))');
    replace('ledger-validate-sync','validate(state); return state;','__bt.sync(__bt.E.VALIDATE_BEGIN,__bt.E.VALIDATE_END,()=>validate(state)); return state;');
  }
  let reversed=text;for(const h of [...hunks].reverse()){if(reversed.split(h.to).length-1!==h.count)throw Error('TRACE_REVERSE_COUNT');reversed=reversed.split(h.to).join(h.from);}if(reversed!==textInput)throw Error('TRACE_REVERSE_MISMATCH');
  const output=(prelude+text).replace(/\n/g,original.includes('\r\n')?'\r\n':'\n');
  const roundtrip=reversed.replace(/\n/g,original.includes('\r\n')?'\r\n':'\n');if(Buffer.compare(Buffer.from(roundtrip),raw)!==0)throw Error('TRACE_ORIGINAL_BYTES_CHANGED');
  return{text:output,proof:{path:file,originalSha256:hash(raw),canonicalSha256:hash(textInput),outputSha256:hash(output),reverseOriginalBytesVerified:true,hunks:hunks.map(({label,count,from,to})=>({label,count,originalFragmentSha256:hash(from),replacementSha256:hash(to)}))}};
}
export function derive(sourceDir,outputDir) {
  const source=resolve(sourceDir),out=resolve(outputDir),rel=relative(source,out);
  if(!rel||(!rel.startsWith('..'+sep)&&rel!=='..'))throw Error('TRACE_OUTPUT_MUST_BE_OUTSIDE_SOURCE');
  if(existsSync(out)&&(lstatSync(out).isSymbolicLink()||!lstatSync(out).isDirectory()||readdirSync(out).length))throw Error('TRACE_OUTPUT_MUST_BE_EMPTY');
  const prepared=PATHS.map(file=>{const p=resolve(source,file);if(lstatSync(p).isSymbolicLink()||!lstatSync(p).isFile())throw Error('TRACE_SOURCE_SPECIAL_FILE');return transform(file,readFileSync(p));});
  // All originals and transformations are validated before writing the overlay.
  const recorder=readFileSync(resolve(here,'recorder.mjs'));mkdirSync(out,{recursive:true});
  for(const item of prepared){const p=resolve(out,item.proof.path);mkdirSync(dirname(p),{recursive:true});writeFileSync(p,item.text);}
  const recorderPath='services/stocks/auth-burst-trace-512/recorder.mjs';mkdirSync(dirname(resolve(out,recorderPath)),{recursive:true});writeFileSync(resolve(out,recorderPath),recorder);
  const manifest={schema:1,sourceRevision:SOURCE_REVISION,diagnosticOnly:true,capacityAcceptance:'NOT_EVALUATED',files:prepared.map(x=>x.proof),recorder:{path:recorderPath,sha256:hash(recorder)},instrumentSha256:hash(readFileSync(fileURLToPath(import.meta.url))),financialInvariants:{reverseOriginalBytesVerified:true,onlyGuardedOriginalsOverlaid:true,originalMessagesAndValuesPreserved:true,originalAbortDeadlinesQueuesAndLimitsPreserved:true,originalSQLAndTransactionTextPreserved:true,engineCommandsObservationsUnmodified:true,asyncCPUAttributed:false,semanticsClaim:'Trace hooks observe existing execution. CPU/timing changes from probes are expected and are not a capacity result.'}};
  writeFileSync(resolve(out,'derived-trace-manifest.json'),JSON.stringify(manifest,null,2)+'\n');return manifest;
}
