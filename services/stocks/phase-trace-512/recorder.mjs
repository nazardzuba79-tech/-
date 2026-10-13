// Disposable benchmark shadow only. No prices, identity, headers, payloads or SQL text.
import { performance } from 'node:perf_hooks';
import { isMainThread, workerData } from 'node:worker_threads';
export const enabled = process.env.STOCKS_PHASE_512 === '1' && process.env.STOCKS_PHASE_512_FIXTURE === 'isolated-issue505';
export const SAMPLE_EVERY = 16;
const commands = ['ensure','ensureBatch','read','readView','portfolioView','interests','observe','observeFailed','observeBackground','observeFailedBackground','submitObserved','submit','cancel','balances','quote','quoteFailed'];
export const STAGES = Object.freeze(['http.state','http.history','http.other','auth','status','json','admission','readState','ledgerParse','ledgerValidate','view','postMessage', ...commands.flatMap(c => ['queue.'+c,'roundtrip.'+c,'execute.'+c])]);
const columns = ['calls','samples','wallMs','maxWallMs','cpuMs','cpuSamples'];
const roleSize = STAGES.length * columns.length;
const buffer = enabled ? (isMainThread ? new SharedArrayBuffer(roleSize * 2 * 8) : workerData?.phase512Buffer) : null;
if (enabled && !buffer) throw Error('DIAGNOSTIC_WORKER_BUFFER_MISSING');
const values = buffer ? new Float64Array(buffer) : null;
const roleOffset = isMainThread ? 0 : roleSize;
const indices = new Map(STAGES.map((name, i) => [name, roleOffset + i * columns.length]));
export const workerTransfer = () => enabled ? {phase512Buffer: buffer} : {};
export function begin(stage) {
  if (!enabled) return null;
  const at = indices.get(stage); if (at === undefined) throw Error('DIAGNOSTIC_STAGE_INVALID');
  const calls = ++values[at];
  if ((calls - 1) % SAMPLE_EVERY) return null;
  return {at, wall: performance.now(), cpu: process.threadCpuUsage?.()};
}
export function end(mark) {
  if (!mark) return;
  const wall = performance.now() - mark.wall;
  const cpu = mark.cpu ? process.threadCpuUsage(mark.cpu) : null;
  values[mark.at+1]++; values[mark.at+2] += wall; values[mark.at+3] = Math.max(values[mark.at+3], wall);
  if (cpu) { values[mark.at+4] += (cpu.user + cpu.system)/1000; values[mark.at+5]++; }
}
// Existing queue/roundtrip timestamps: all commands, no extra clock/CPU syscall.
export function add(stage, wall) {
  if (!enabled) return;
  const at = indices.get(stage); if (at === undefined) throw Error('DIAGNOSTIC_STAGE_INVALID');
  values[at]++; values[at+1]++; values[at+2] += wall; values[at+3] = Math.max(values[at+3],wall);
}
export function sync(stage, fn) { const mark=begin(stage);try{return fn();}finally{end(mark);} }
export async function asyncMeasure(stage, fn) { const mark=begin(stage);try{return await fn();}finally{end(mark);} }
export function http(req,res,fn) {
  if (!enabled) return fn(req,res);
  const stage=req.url?.startsWith('/__stocks_global/state')?'http.state':req.url?.startsWith('/__stocks_global/history')?'http.history':'http.other';
  const mark=begin(stage); if(mark){let done=false;const finish=()=>{if(!done){done=true;end(mark);}};res.once('finish',finish);res.once('close',finish);}
  return fn(req,res);
}
export function snapshot() {
  if (!enabled) return {enabled:false,sampleEvery:SAMPLE_EVERY};
  const roles={};
  for(const [role,offset] of [['main',0],['worker',roleSize]]) roles[role]=Object.fromEntries(STAGES.flatMap((stage,i)=>{const at=offset+i*columns.length;return values[at] ? [[stage,Object.fromEntries(columns.map((key,j)=>[key,values[at+j]]))]]:[];}));
  return {enabled:true,sampleEvery:SAMPLE_EVERY,roles,threadCpuAvailable:typeof process.threadCpuUsage==='function',notes:['Sampled stages are deterministic one in 16; never sum nested phases as independent CPU.','Queue/roundtrip use all commands and existing timestamps; those CPU fields are not measured.','Main and worker counters have separate single writers. Snapshot can include an in-flight sample; inspect pending work.','COMMIT wall time is available in existing SQL diagnostics; no fsync syscall latency is inferred.','Async phase CPU includes other main-thread work during await; only synchronous phase CPU is attribution evidence.']};
}
