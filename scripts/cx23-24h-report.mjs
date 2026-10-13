#!/usr/bin/env node
/** Human-readable summary from a finite readonly CX23 resource trace. */
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { validIoCounters, parseCpuCounters } from './cx23-24h-platform.mjs';

const round = (n,d=2)=>n===null||!Number.isFinite(n)?null:Number(n.toFixed(d));
export const percentile=(a,p)=>{
  const xs=a.filter(x=>Number.isFinite(x)).sort((a,b)=>a-b);
  return xs.length?xs[Math.ceil(p*xs.length)-1]:null;
};
export function sampleMetricIssues(start, s, n) {
  const issues = [], finite = v => Number.isFinite(v) && v >= 0;
  for (const key of ['hostMemAvailableBytes','hostMemUsedPct','hostSwapUsedBytes','rootFsFreeBytes','rootFsTotalBytes']) if (!finite(s[key])) issues.push('REQUIRED_HOST_METRIC_UNAVAILABLE');
  if (n > 0 && (!finite(s.hostCpuPct) || !finite(s.hostIowaitPct))) issues.push('CPU_INTERVAL_UNAVAILABLE');
  if (!finite(s.overhead?.samplerCpuMicros?.user) || !finite(s.overhead?.samplerCpuMicros?.system) || !finite(s.overhead?.samplerRssBytes)) issues.push('SAMPLER_OVERHEAD_UNAVAILABLE');
  if (start.docker) {
    const ds = s.docker, cs = ds?.containers;
    if (!ds?.available || !Array.isArray(cs) || !Array.isArray(start.containers) || cs.length !== start.containers.length || new Set(cs.map(c => c?.id)).size !== cs.length
      || cs.some(c => !/^[a-f0-9]{64}$/.test(c?.id) || ['cpuPct','memoryBytes','memoryLimitBytes','blockReadBytes','blockWriteBytes','pids'].some(k => !finite(c?.[k])))) issues.push('DOCKER_COVERAGE_UNAVAILABLE');
  }
  if (start.pid) {
    const ps = s.processes, id = ps?.identity;
    if (!ps?.available || id?.pid !== start.pid || !/^\d+$/.test(id?.startTimeTicks || '') || !/^[a-f0-9]{64}$/.test(id?.cgroupId || '')
      || !Array.isArray(ps.rows) || !ps.rows.length || !ps.rows.some(r => r?.pid === start.pid)
      || ps.rows.some(r => !r || !Number.isSafeInteger(r.pid) || r.pid < 1 || !/^\d+$/.test(r.startTimeTicks || '') || !/^[a-f0-9]{64}$/.test(r.cgroupId || '')
        || ['userTicks','systemTicks','rssBytes','threads'].some(k => !finite(r[k])))
      || new Set(ps.rows.map(r => r?.pid)).size !== ps.rows.length || !Number.isSafeInteger(ps.tasksRead) || ps.tasksRead < ps.rows.length
      || !ps.cgroup?.available || ps.cgroup.id !== id.cgroupId || ['memoryCurrentBytes','memoryPeakBytes','pidsCurrent'].some(k => !finite(ps.cgroup[k]))
      || !parseCpuCounters(ps.cgroup.cpuStat) || !Array.isArray(ps.cgroup.memberPids) || !ps.cgroup.memberPids.includes(start.pid)
      || ps.cgroup.memberPids.some(p => !Number.isSafeInteger(p) || p < 1) || new Set(ps.cgroup.memberPids).size !== ps.cgroup.memberPids.length) issues.push('PROCESS_COVERAGE_UNAVAILABLE');
    const io = ps?.cgroup?.ioStat;
    if (ps?.cgroup?.ioAvailable !== true || !validIoCounters(io)) issues.push('CGROUP_IO_UNAVAILABLE');
  }
  return [...new Set(issues)];
}
export function validateTrace(rows, bytes) {
  const issues = [], starts = rows.filter(r => r?.kind === 'start'), ends = rows.filter(r => r?.kind === 'end');
  const start = starts[0] || {}, finish = ends[0], samples = rows.filter(r => r?.kind === 'sample');
  if (starts.length !== 1 || ends.length !== 1 || rows[0] !== start || rows.at(-1) !== finish) issues.push('START_END_CARDINALITY_OR_ORDER');
  if (start?.schema !== 2 || finish?.schema !== 2) issues.push('LEGACY_OR_UNKNOWN_SCHEMA_NO_COVERAGE_PROOF');
  if (rows.some(r => !r || !['start','sample','end','gap','sample-error'].includes(r.kind))) issues.push('UNKNOWN_RECORD');
  const duration = start?.durationMs, step = start?.intervalSeconds * 1000, expected = Math.ceil(duration / step);
  if (!(Number.isFinite(duration) && duration > 0 && duration <= 86400000 && Number.isFinite(step) && step >= 5000 && step <= 3600000)
    || Math.ceil(start?.durationHours * 3600000) !== duration || start?.expectedSamples !== expected || start?.maxStartLatenessMs !== Math.min(1000, step / 10)) issues.push('INVALID_SCHEDULE');
  const began = Date.parse(start?.startedAt), planned = Date.parse(start?.plannedEndAt), ended = Date.parse(finish?.at);
  if (![began,planned,ended].every(Number.isFinite) || planned - began !== duration || start?.timezone !== 'UTC' || finish?.timezone !== 'UTC') issues.push('INVALID_UTC_WINDOW');
  if (finish?.reason !== 'duration-completed' || finish.complete !== true || !Number.isFinite(finish.elapsedMs) || finish.elapsedMs < duration || finish.elapsedMs > duration + 2000
    || !Number.isFinite(ended - began) || Math.abs(ended - began - finish.elapsedMs) > 5000) issues.push('DURATION_OR_INTERRUPTION_INCOMPLETE');
  if (samples.length !== expected || finish?.samples !== samples.length || finish?.skippedSlots !== 0 || finish?.sampleFailures !== 0
    || rows.some(r => ['gap','sample-error'].includes(r?.kind))) issues.push('MISSING_OR_FAILED_SLOTS');
  if (!Number.isSafeInteger(start?.maxOutputBytes) || start.maxOutputBytes < 65536 || start.maxOutputBytes > 67108864 || bytes > start.maxOutputBytes) issues.push('INVALID_OUTPUT_BUDGET');
  let prior = -1, processKey, dockerKey;
  const finite = v => Number.isFinite(v) && v >= 0;
  for (const [n, s] of samples.entries()) {
    if (s.tick !== n || s.scheduledMs !== n * step || !finite(s.elapsedMs) || s.elapsedMs < s.scheduledMs || s.elapsedMs - s.scheduledMs > start.maxStartLatenessMs
      || s.elapsedMs >= duration || !finite(s.completedMs) || s.completedMs < s.elapsedMs || s.completedMs >= duration || s.elapsedMs <= prior
      || !finite(s.collectionMs) || Math.abs(s.collectionMs - (s.completedMs - s.elapsedMs)) > 0.001 || s.tag !== start.tag) issues.push('INVALID_SAMPLE_TIMELINE');
    prior = s.elapsedMs;
    if (!Number.isFinite(Date.parse(s.at))) issues.push('INVALID_SAMPLE_UTC');
    const metricIssues = sampleMetricIssues(start, s, n); issues.push(...metricIssues);
    if (start.docker) {
      const ds = s.docker, cs = ds?.containers;
      if (!metricIssues.includes('DOCKER_COVERAGE_UNAVAILABLE')) { const key = cs.map(c => c.id).sort().join(','); if (dockerKey && dockerKey !== key) issues.push('CONTAINER_IDENTITY_CHANGED'); dockerKey = key; }
    }
    if (start.pid) {
      const ps = s.processes, id = ps?.identity, key = id && [id.pid,id.startTimeTicks,id.cgroupId].join(':');
      if (!metricIssues.includes('PROCESS_COVERAGE_UNAVAILABLE') && processKey && key !== processKey) issues.push('PROCESS_IDENTITY_CHANGED');
      processKey = key;
    }
  }
  return { complete: issues.length === 0, issues: [...new Set(issues)], expectedSamples: Number.isSafeInteger(expected) ? expected : null, recordedSamples: samples.length,
    classification: issues.length ? 'INCOMPLETE' : 'FINITE_SAMPLE_COVERAGE_COMPLETE', capacityAcceptance: false };
}
export function summarise(content) {
  const rows=content.trim().split('\n').filter(Boolean).map((x,i)=>{
    try{return JSON.parse(x);}catch{throw Error(`Invalid NDJSON line ${i+1}`);}
  });
  const start=rows.find(x=>x?.kind==='start'),finish=rows.find(x=>x?.kind==='end');
  if (!start) throw Error('Missing start record');
  const samples=rows.filter(x=>x?.kind==='sample');
  const coverage = validateTrace(rows, Buffer.byteLength(content));
  const quant=(name)=>{
    const xs=samples.map(x=>x[name]).filter(Number.isFinite);
    return {n:xs.length,mean:xs.length?round(xs.reduce((a,b)=>a+b,0)/xs.length):null,p95:round(percentile(xs,0.95)),max:round(xs.length?Math.max(...xs):null)};
  };
  const pressureQuant=(kind,level)=>{
    const xs=samples.map(s=>s.pressure?.[kind]?.some?.[level]).filter(Number.isFinite);
    return {n:xs.length,mean:xs.length?round(xs.reduce((a,b)=>a+b,0)/xs.length):null,p95:round(percentile(xs,.95)),max:round(xs.length?Math.max(...xs):null)};
  };
  const containers=new Map();
  for(const sample of samples) for (const entry of sample.docker?.containers??[]) {
    const identity=entry.id || entry.name;
    if(!containers.has(identity))containers.set(identity,[]);
    containers.get(identity).push({...entry,monotonicMs:Number.isFinite(sample.elapsedMs)?sample.elapsedMs:null});
  }
  const calc = (rows,key)=>{
    const xs=rows.map(x=>x[key]).filter(Number.isFinite);
    return {n:xs.length,p95:round(percentile(xs,.95)),max:round(xs.length?Math.max(...xs):null)};
  };
  const docker={};
  for (const [name,observations] of containers) {
    const rates=(key)=>{
      const values=[];
      for (let i=1;i<observations.length;i++) {
        const prev=observations[i-1],next=observations[i],seconds=Number.isFinite(prev.monotonicMs)&&Number.isFinite(next.monotonicMs)?(next.monotonicMs-prev.monotonicMs)/1000:null;
        if (seconds>0 && Number.isFinite(prev[key]) && Number.isFinite(next[key]) && next[key]>=prev[key]) values.push((next[key]-prev[key])/seconds);
      }
      return {n:values.length,meanBytesPerSec:values.length?round(values.reduce((a,b)=>a+b,0)/values.length):null,p95BytesPerSec:round(percentile(values,.95)),maxBytesPerSec:round(values.length?Math.max(...values):null)};
    };
    docker[name]={cpuPct:calc(observations,'cpuPct'),memoryMiB:calc(observations.map(x=>({memoryMiB:Number.isFinite(x.memoryBytes)?x.memoryBytes/1048576:null})),'memoryMiB'),blockRead:rates('blockReadBytes'),blockWrite:rates('blockWriteBytes')};
  }
  const byProcess = new Map(), byCgroup = new Map();
  for (const s of samples) {
    if (!s.processes?.available) continue;
    for (const p of s.processes.rows || []) {
      const key = [p.pid,p.startTimeTicks,p.cgroupId].join(':');
      if (!byProcess.has(key)) byProcess.set(key, []);
      byProcess.get(key).push(p);
    }
    const c = s.processes.cgroup;
    if (c?.available) {
      if (!byCgroup.has(c.id)) byCgroup.set(c.id, []);
      const cpu = parseCpuCounters(c.cpuStat);
      const io = field => { const xs = [...(c.ioStat || '').matchAll(new RegExp('(?:^|\\s)' + field + '=(\\d+)', 'g'))].map(m => Number(m[1])); return xs.length ? xs.reduce((a,b) => a+b, 0) : null; };
      byCgroup.get(c.id).push({...c, cpuUsageMicros:cpu?.usage_usec??null, readBytes:io('rbytes'), writeBytes:io('wbytes')});
    }
  }
  const counter = (rs, key) => {
    const xs = rs.map(r => r[key]).filter(Number.isFinite), monotonic = xs.every((v,i) => i === 0 || v >= xs[i-1]);
    return {n:xs.length,first:xs[0]??null,last:xs.at(-1)??null,observedDelta:xs.length>1&&monotonic?xs.at(-1)-xs[0]:null,counterReset:!monotonic};
  };
  const processes = Object.fromEntries([...byProcess].map(([key, rs]) => [key, {pid:rs[0].pid,startTimeTicks:rs[0].startTimeTicks,cgroupId:rs[0].cgroupId,observations:rs.length,
    rssMiB:calc(rs.map(r=>({value:Number.isFinite(r.rssBytes)?r.rssBytes/1048576:null})),'value'),threads:calc(rs,'threads'),userTicks:counter(rs,'userTicks'),systemTicks:counter(rs,'systemTicks'),scope:'Per process; RSS may share pages, threads not added again; CPU tick frequency not inferred.'}]));
  const cgroups = Object.fromEntries([...byCgroup].map(([key, rs]) => [key, {observations:rs.length,scope:'Entire pinned cgroup, not exclusive process attribution.',kernelPeakScope:'Lifetime since cgroup creation; may predate the observation window.',
    memoryMiB:calc(rs.map(r=>({value:Number.isFinite(r.memoryCurrentBytes)?r.memoryCurrentBytes/1048576:null})),'value'),kernelPeakMiB:calc(rs.map(r=>({value:Number.isFinite(r.memoryPeakBytes)?r.memoryPeakBytes/1048576:null})),'value'),
    pids:calc(rs,'pidsCurrent'),cpuUsageMicros:counter(rs,'cpuUsageMicros'),readBytes:counter(rs,'readBytes'),writeBytes:counter(rs,'writeBytes')}]));
  const expected=coverage.expectedSamples;
  return {
    schema:2,tag:start.tag,start:start.startedAt,end:finish?.at??null,
    completion:coverage.complete?'complete':['SIGINT','SIGTERM','CALLER_ABORT','interrupted'].includes(finish?.reason)?'interrupted':'incomplete', coverage,
    expectedSamples:expected,recordedSamples:samples.length,
    hostCpuPct:quant('hostCpuPct'),hostIowaitPct:quant('hostIowaitPct'),
    hostMemUsedPct:quant('hostMemUsedPct'),
    cpuPressureAvg10Pct:pressureQuant('cpu','avg10'),ioPressureAvg10Pct:pressureQuant('io','avg10'),memoryPressureAvg10Pct:pressureQuant('memory','avg10'),
    hostMemAvailableMiB:calc(samples.map(x=>({available:Number.isFinite(x.hostMemAvailableBytes)?x.hostMemAvailableBytes/1048576:null})),'available'),
    hostSwapUsedMiB:calc(samples.map(x=>({swap:Number.isFinite(x.hostSwapUsedBytes)?x.hostSwapUsedBytes/1048576:null})),'swap'),
    rootFsFreeGiB:calc(samples.map(x=>({free:Number.isFinite(x.rootFsFreeBytes)?x.rootFsFreeBytes/1073741824:null})),'free'),
    rootFsMinimumFreeGiB:round(samples.filter(x=>Number.isFinite(x.rootFsFreeBytes)).map(x=>x.rootFsFreeBytes/1073741824).reduce((min,x)=>Math.min(min,x),Infinity)),
    dockerObserved:samples.filter(x=>x.docker?.available).length,
    dockerUnavailable:samples.filter(x=>x.docker&&x.docker.available===false).length,
    containers:docker,processes,cgroups,physicalFsyncLatency:'UNAVAILABLE; no syscall tracing or artificial filesystem workload',
    samplerOverhead:{cpuMicros:finish?.overhead?.samplerCpuMicros??null,maxRssKiB:finish?.overhead?.samplerMaxRssKiB??null,
      collectionMs:quant('collectionMs'),dockerChildCpu:'UNAVAILABLE; not part of process.cpuUsage',baselineImpact:'UNMEASURED; no monitor-off comparison'},
    decision:'NOT_DECIDABLE_FROM_RESOURCE_TRACE_ALONE',
    limitations:['Read-only sampled resource usage, not continuous peaks','No Stocks order or HTTP latency/errors','No market-data provider starts/rights','No verified production Stocks enablement','Must compare same traffic before/after and +5% crypto-p95 release gate','Low 24h traffic cannot establish peak capacity']
  };
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href) {
  try {
    if(process.argv.length!==3)throw Error('Usage: node scripts/cx23-24h-report.mjs /absolute/path/to/trace.ndjson');
    const report=summarise(await readFile(process.argv[2],'utf8'));
    console.log(JSON.stringify(report,null,2));
    if (!report.coverage.complete) process.exitCode=1;
  }catch(e){console.error(`CX23_REPORT_ERROR: ${e.message}`);process.exitCode=1;}
}
