import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseArgs,cpuFields,cpuDelta,memoryFields,pressureFields,parseBytes,parseDockerRow,run } from './cx23-24h-readonly.mjs';
import {summarise,percentile} from './cx23-24h-report.mjs';

test('validates bounded finite options and does not accept default output path',()=>{
  assert.throws(()=>parseArgs([]),/absolute path/);
  assert.throws(()=>parseArgs(['--out=relative.ndjson']),/absolute path/);
  assert.throws(()=>parseArgs(['--out=/tmp/a','--hours=25']),/<=24/);
  assert.throws(()=>parseArgs(['--out=/tmp/a','--hours=0']),/>0/);
  assert.throws(()=>parseArgs(['--out=/tmp/a','--interval-seconds=0']),/between/);
  assert.throws(()=>parseArgs(['--out=/tmp/a','--container=secret']),/Unsupported/);
  assert.throws(()=>parseArgs(['--out=/tmp/a','--containers=api']),/requires --docker/);
  assert.throws(()=>parseArgs(['--out=/tmp/a','--pid=0']),/positive/);
  assert.throws(()=>parseArgs(['--out=/tmp/a','--tag=MY_TAG']),/tag/);
  assert.throws(()=>parseArgs(['--out=/tmp/a','--out=/tmp/b']),/Duplicate/);
  assert.deepEqual(parseArgs(['--out=/tmp/a','--docker=true','--containers=api,db','--hours=1']).containers,['api','db']);
});

test('Linux host resources parsed with correct units and null initial CPU',()=>{
  const a=cpuFields('cpu  100 0 50 850 10 0 0 0 0 0\ncpu0 1 2 3');
  const b=cpuFields('cpu  140 0 80 920 20 0 0 0 0 0');
  assert.equal(cpuDelta(null,b).hostCpuPct,null);
  assert.equal(cpuDelta(a,b).hostCpuPct, (1-80/150)*100);
  assert.equal(cpuDelta(a,b).hostIowaitPct,100*10/150);
  const mem=memoryFields('MemTotal: 4096000 kB\nMemAvailable: 2048000 kB\nSwapTotal: 102400 kB\nSwapFree: 51200 kB\n');
  assert.equal(mem.hostMemUsedPct,50);
  assert.equal(mem.hostSwapUsedBytes,51200*1024);
  assert.equal(pressureFields('some avg10=1.25 avg60=0.50 avg300=0.15 total=200').some.avg10,1.25);
});

test('Docker values parsed without shell interpolation or credentials',()=>{
  assert.equal(parseBytes('1.5GiB'),1.5*1073741824);
  assert.equal(parseBytes('500kB'),500000);
  assert.equal(parseBytes('secret'),null);
  const d=parseDockerRow({Name:'voltex-api-1',CPUPerc:'12.5%',MemUsage:'20MiB / 4GiB',BlockIO:'1MB / 2MB',PIDs:'5'});
  assert.equal(d.cpuPct,12.5);assert.equal(d.memoryBytes,20971520);
  assert.equal(d.blockWriteBytes,2000000);assert.equal(d.pids,5);
});

test('finite sampler creates 0600 file, appends end marker, prevents overwrites',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'cx23-readonly-'));
  const dest=join(dir,'trace.ndjson');
  let clock=0;
  const cfg=parseArgs([`--out=${dest}`,'--hours=0.00001','--interval-seconds=5','--tag=pilot']);
  let calls=0;
  try {
    const done=await run(cfg,{now:()=>clock,sleep:async(ms)=>{clock+=ms;},doSample:async()=>{
      calls++;clock+=100;
      return {counters:{total:calls*100,idle:calls*60,iowait:calls*2},out:{kind:'sample',at:'2026-10-13T00:00:00Z',hostCpuPct:20,hostIowaitPct:2,hostMemUsedPct:40,hostMemAvailableBytes:1073741824,hostSwapUsedBytes:0,rootFsFreeBytes:1073741824,docker:null}};
    }});
    assert.equal(done.samples,1);
    const raw=await readFile(dest,'utf8'), rows=raw.trim().split('\n').map(JSON.parse);
    assert.deepEqual(rows.map(x=>x.kind),['start','sample','end']);
    assert.equal(rows[2].reason,'duration-completed');
    assert.equal((await stat(dest)).mode & 0o777,0o600);
    assert.equal(summarise(raw).completion,'complete');
    await assert.rejects(run(cfg,{now:()=>0,sleep:async()=>{},doSample:async()=>{throw Error('should not call')}}),/EEXIST/);
  }finally{await rm(dir,{recursive:true,force:true});}
});

test('report does not label incomplete samples as proof of capacity',()=>{
  assert.equal(percentile([1,2,3,4],.95),4);
  const report=summarise(JSON.stringify({kind:'start',startedAt:'t',tag:'pilot',durationHours:24,intervalSeconds:60})+'\n'+JSON.stringify({kind:'sample',hostCpuPct:9}));
  assert.equal(report.completion,'incomplete');assert.equal(report.expectedSamples,1441);
  assert.equal(report.decision,'NOT_DECIDABLE_FROM_RESOURCE_TRACE_ALONE');
});
