#!/usr/bin/env node
/** Human-readable summary from a finite readonly CX23 resource trace. */
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const round = (n,d=2)=>n===null||!Number.isFinite(n)?null:Number(n.toFixed(d));
export const percentile=(a,p)=>{
  const xs=a.filter(x=>Number.isFinite(x)).sort((a,b)=>a-b);
  return xs.length?xs[Math.ceil(p*xs.length)-1]:null;
};
export function summarise(content) {
  const rows=content.trim().split('\n').filter(Boolean).map((x,i)=>{
    try{return JSON.parse(x);}catch{throw Error(`Invalid NDJSON line ${i+1}`);}
  });
  const start=rows.find(x=>x.kind==='start'),finish=rows.find(x=>x.kind==='end');
  if (!start) throw Error('Missing start record');
  const samples=rows.filter(x=>x.kind==='sample');
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
    if(!containers.has(entry.name))containers.set(entry.name,[]);
    containers.get(entry.name).push({...entry,at:Date.parse(sample.at)});
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
        const prev=observations[i-1],next=observations[i],seconds=(next.at-prev.at)/1000;
        if (seconds>0 && Number.isFinite(prev[key]) && Number.isFinite(next[key]) && next[key]>=prev[key]) values.push((next[key]-prev[key])/seconds);
      }
      return {n:values.length,meanBytesPerSec:values.length?round(values.reduce((a,b)=>a+b,0)/values.length):null,p95BytesPerSec:round(percentile(values,.95)),maxBytesPerSec:round(values.length?Math.max(...values):null)};
    };
    docker[name]={cpuPct:calc(observations,'cpuPct'),memoryMiB:calc(observations.map(x=>({memoryMiB:Number.isFinite(x.memoryBytes)?x.memoryBytes/1048576:null})),'memoryMiB'),blockRead:rates('blockReadBytes'),blockWrite:rates('blockWriteBytes')};
  }
  const expected=Math.floor(start.durationHours*3600/start.intervalSeconds)+1;
  return {
    schema:1,tag:start.tag,start:start.startedAt,end:finish?.at??null,
    completion:finish?.reason==='duration-completed'?'complete':finish?.reason==='interrupted'?'incomplete',
    expectedSamples:expected,recordedSamples:samples.length,
    hostCpuPct:quant('hostCpuPct'),hostIowaitPct:quant('hostIowaitPct'),
    hostMemUsedPct:quant('hostMemUsedPct'),
    cpuPressureAvg10Pct:pressureQuant('cpu','avg10'),ioPressureAvg10Pct:pressureQuant('io','avg10'),memoryPressureAvg10Pct:pressureQuant('memory','avg10'),
    hostMemAvailableMiB:calc(samples.map(x=>({available:Number.isFinite(x.hostMemAvailableBytes)?x.hostMemAvailableBytes/1048576:null})),'available'),
    hostSwapUsedMiB:calc(samples.map(x=>({swap:Number.isFinite(x.hostSwapUsedBytes)?x.hostSwapUsedBytes/1048576:null})),'swap'),
    rootFsFreeGiB:calc(samples.map(x=>({free:Number.isFinite(x.rootFsFreeBytes)?x.rootFsFreeBytes/1073741824:null})),'free'),
    rootFsMinimumFreeGiB:round(samples.map(x=>x.rootFsFreeBytes/1073741824).filter(Number.isFinite).reduce((min,x)=>Math.min(min,x),Infinity)),
    dockerObserved:samples.filter(x=>x.docker?.available).length,
    dockerUnavailable:samples.filter(x=>x.docker&&x.docker.available===false).length,
    containers:docker,
    decision:'NOT_DECIDABLE_FROM_RESOURCE_TRACE_ALONE',
    limitations:['Read-only sampled resource usage, not continuous peaks','No Stocks order or HTTP latency/errors','No market-data provider starts/rights','No verified production Stocks enablement','Must compare same traffic before/after and +5% crypto-p95 release gate','Low 24h traffic cannot establish peak capacity']
  };
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href) {
  try {
    if(process.argv.length!==3)throw Error('Usage: node scripts/cx23-24h-report.mjs /absolute/path/to/trace.ndjson');
    const report=summarise(await readFile(process.argv[2],'utf8'));
    console.log(JSON.stringify(report,null,2));
  }catch(e){console.error(`CX23_REPORT_ERROR: ${e.message}`);process.exitCode=1;}
}
