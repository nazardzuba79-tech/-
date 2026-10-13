import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, stat, chmod } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseArgs,cpuFields,cpuDelta,memoryFields,pressureFields,parseBytes,parseDockerRow,run } from './cx23-24h-readonly.mjs';
import {summarise,percentile,validateTrace} from './cx23-24h-report.mjs';
import { privateMode, privateOutput, safeDockerOptions, createDockerReader, procStat, processIdentity, processInventory, validIoCounters, parseCpuCounters } from './cx23-24h-platform.mjs';

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

test('finite sampler creates private file, appends verified end marker, prevents overwrites',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'cx23-readonly-'));
  const dest=join(dir,'trace.ndjson');
  let clock=0;
  const cfg=parseArgs([`--out=${dest}`,'--hours=0.00001','--interval-seconds=5','--tag=pilot']);
  let calls=0;
  try {
    if(process.platform==='linux') await chmod(dir,0o700);
    const done=await run(cfg,{now:()=>clock,wallNow:()=>Date.UTC(2026,9,13)+clock,sleep:async(ms)=>{clock+=ms;},doSample:async()=>{
      calls++;clock+=1;
      return {counters:{total:calls*100,idle:calls*60,iowait:calls*2},out:hostMetrics()};
    }});
    assert.equal(done.samples,1);
    const raw=await readFile(dest,'utf8'), rows=raw.trim().split('\n').map(JSON.parse);
    assert.deepEqual(rows.map(x=>x.kind),['start','sample','end']);
    assert.equal(rows[2].reason,'duration-completed');
    if(process.platform==='linux') assert.equal((await stat(dest)).mode & 0o777,0o600);
    assert.equal(summarise(raw).completion,'complete');
    await assert.rejects(run(cfg,{now:()=>0,sleep:async()=>{},doSample:async()=>{throw Error('should not call')}}),/EEXIST/);
  }finally{await rm(dir,{recursive:true,force:true});}
});

test('report does not label incomplete samples as proof of capacity',()=>{
  assert.equal(percentile([1,2,3,4],.95),4);
  const report=summarise(JSON.stringify({kind:'start',startedAt:'t',tag:'pilot',durationHours:24,intervalSeconds:60})+'\n'+JSON.stringify({kind:'sample',hostCpuPct:9}));
  assert.equal(report.completion,'incomplete');assert.equal(report.expectedSamples,null);
  assert.equal(report.decision,'NOT_DECIDABLE_FROM_RESOURCE_TRACE_ALONE');
});

const hostMetrics=()=>({at:'2026-10-13T00:00:00Z',hostCpuPct:20,hostIowaitPct:2,hostMemUsedPct:40,hostMemAvailableBytes:1073741824,hostSwapUsedBytes:0,rootFsFreeBytes:1073741824,rootFsTotalBytes:2147483648,docker:null});
async function virtual({duration=10000,interval=5,cost=100,late=0,huge=false,free=1e12,extra={},deps={}}={}) {
  let clock=0,content='',calls=0,closed=false;
  const starts=[];
  const config={out:join(tmpdir(),'unused-fixture.ndjson'),hours:duration/3600000,intervalSeconds:interval,tag:'pilot',docker:false,containers:[],pid:null,...extra};
  const done=await run(config,{now:()=>clock,wallNow:()=>Date.UTC(2026,9,13)+clock,
    sleep:async ms=>{clock+=ms+late;},prepare:async()=>({}),getFree:async()=>free,
    openOutput:async()=>({write:async(b,o,n)=>{const count=Math.min(n,137);content+=b.subarray(o,o+count).toString();return{bytesWritten:count};},close:async()=>{closed=true;}}),
    doSample:async()=>{starts.push(clock);clock+=typeof cost==='function'?cost(calls):cost;calls++;return {counters:{},out:{...hostMetrics(),...(huge?{padding:'x'.repeat(65536)}:{})}};},...deps});
  return {done,content,starts,clock,closed,rows:content.trim().split('\n').filter(Boolean).map(JSON.parse)};
}
test('deadline is exclusive, nondivisible window waits remainder, no late final collection',async()=>{
  for(const duration of [10000,12000]){
    const r=await virtual({duration});
    assert.deepEqual(r.starts,duration===10000?[0,5000]:[0,5000,10000]);
    assert.equal(r.clock,duration);assert.equal(r.done.complete,true);assert.equal(r.closed,true);
    assert.equal(summarise(r.content).completion,'complete');
  }
});
test('full virtual 24-hour plan has exactly 1440 exclusive minute slots',async()=>{
  const r=await virtual({duration:86400000,interval:60});
  assert.equal(r.starts.length,1440);assert.equal(r.starts.at(-1),86340000);assert.equal(r.clock,86400000);
  assert.equal(r.done.complete,true);assert.equal(summarise(r.content).completion,'complete');
});
test('real monotonic one-second window cannot finish early due timer resolution',async()=>{
  let content='';
  const result=await run({out:join(tmpdir(),'unused-clock.ndjson'),hours:1/3600,intervalSeconds:5,tag:'pilot',docker:false,containers:[],pid:null},
    {prepare:async()=>({}),getFree:async()=>1e12,openOutput:async()=>({write:async(b,o,n)=>{content+=b.subarray(o,o+n).toString();return{bytesWritten:n};},close:async()=>{}}),doSample:async()=>({counters:{},out:hostMetrics()})});
  assert.equal(result.complete,true);const report=summarise(content);assert.equal(report.completion,'complete');assert.equal(report.recordedSamples,1);
  assert(JSON.parse(content.trim().split('\n').at(-1)).elapsedMs>=1000);
});
test('overrun skips slots without catch-up; late wake never starts at or after deadline',async()=>{
  const slow=await virtual({duration:20000,cost:n=>n===0?12000:100});
  assert.deepEqual(slow.starts,[0,15000]);assert.equal(slow.done.skippedSlots,2);assert.equal(slow.done.complete,false);
  assert.equal(summarise(slow.content).completion,'incomplete');
  const late=await virtual({duration:10000,late:10000});assert.deepEqual(late.starts,[0]);assert.equal(late.done.complete,false);
});
test('deadline-crossing sample cannot count as successful evidence',async()=>{
  const r=await virtual({duration:10000,cost:10001});
  assert.equal(r.done.samples,0);assert.equal(r.done.sampleFailures,1);assert.equal(r.done.complete,false);
  assert.equal(r.rows.find(x=>x.kind==='sample-error').code,'SAMPLE_PAST_DEADLINE');
});
test('SIGTERM interrupts an unresolved hour sleep promptly',async()=>{
  const start=performance.now();
  const r=await virtual({duration:3600000,interval:3600,deps:{sleep:async()=>{setTimeout(()=>process.emit('SIGTERM'),5);return new Promise(()=>{});}}});
  assert(performance.now()-start<500);assert.equal(r.done.reason,'SIGTERM');assert.equal(r.done.complete,false);assert.equal(r.closed,true);
});
test('hung sample has finite timeout with safe code and no leaked error text',async()=>{
  const r=await virtual({duration:6000,deps:{sampleTimeoutMs:5,doSample:async()=>new Promise(()=>{})}});
  assert.equal(r.done.samples,0);assert.equal(r.done.sampleFailures,2);
  assert(r.rows.filter(x=>x.kind==='sample-error').every(x=>x.code==='SAMPLE_TIMEOUT'));
  const secret=await virtual({deps:{doSample:async()=>{throw Error('PRIVATE_FIXTURE_MARKER');}}});assert(!secret.content.includes('PRIVATE_FIXTURE_MARKER'));
});
test('global watchdog remains armed through hung evidence close',async()=>{
  let unblock;const close=new Promise(ok=>{unblock=ok;});let stops=0;
  const r=await virtual({duration:20,cost:1,deps:{graceMs:5,openOutput:async()=>({write:async(b,o,n)=>({bytesWritten:n}),close:()=>close}),hardStop:code=>{assert.equal(code,2);stops++;unblock();}}});
  assert.equal(stops,1);assert.equal(r.done.samples,1);
});
test('output byte cap and free-space floor stop collection, retain no false success',async()=>{
  const bounded=await virtual({huge:true,extra:{maxOutputBytes:65536}});
  assert.equal(bounded.done.reason,'OUTPUT_BYTE_LIMIT');assert.equal(bounded.done.complete,false);assert(Buffer.byteLength(bounded.content)<=65536);assert.equal(bounded.starts.length,1);
  const disk=await virtual({free:0});assert.equal(disk.starts.length,0);assert.equal(disk.done.reason,'TERMINAL_EVIDENCE_UNAVAILABLE');assert.equal(disk.done.complete,false);
  const unknown=await virtual({free:NaN});assert.equal(unknown.starts.length,0);assert.equal(unknown.done.complete,false);
});
test('coverage rejects missing, duplicated, corrupt, partial and falsely complete records',async()=>{
  const r=await virtual();assert.equal(validateTrace(r.rows,Buffer.byteLength(r.content)).complete,true);
  const mutations=[
    rows=>rows.filter(x=>x.kind!=='sample'),rows=>rows.filter((x,i)=>i!==1),rows=>[rows[0],rows[1],...rows.slice(1)],
    rows=>rows.slice(0,-1),rows=>[...rows,rows.at(-1)],rows=>{rows[1].elapsedMs=10000;return rows;},
    rows=>{rows.at(-1).elapsedMs=9999;return rows;},rows=>{rows[2].tick=0;return rows;},
    rows=>{rows[1].overhead.samplerCpuMicros.user=null;return rows;},rows=>{rows[1].rootFsFreeBytes=null;return rows;},
    rows=>{rows[0].plannedEndAt='unknown';return rows;},rows=>{rows[0].maxOutputBytes=2;return rows;},rows=>{rows[1].kind='secret';return rows;},
  ];
  for(const mutate of mutations){const rows=mutate(structuredClone(r.rows));assert.equal(validateTrace(rows,100).complete,false);}
  assert.equal(validateTrace([],0).complete,false);
  const legacy={kind:'start',durationHours:24,intervalSeconds:60};
  assert.equal(summarise([legacy,{kind:'end',reason:'duration-completed'}].map(JSON.stringify).join('\n')).completion,'incomplete');
});
test('requested Docker/process evidence cannot disappear or silently change identity',async()=>{
  const r=await virtual();
  let rows=structuredClone(r.rows);rows[0].docker=true;rows[0].containers=['api'];assert(validateTrace(rows,100).issues.includes('DOCKER_COVERAGE_UNAVAILABLE'));
  const c={id:'a'.repeat(64),cpuPct:1,memoryBytes:1,memoryLimitBytes:2,blockReadBytes:1,blockWriteBytes:2,pids:3};
  for(const s of rows.filter(r=>r.kind==='sample'))s.docker={available:true,containers:[c]};
  assert.equal(validateTrace(rows,100).complete,true);rows[2].docker={available:true,containers:[{...c,id:'b'.repeat(64)}]};assert(validateTrace(rows,100).issues.includes('CONTAINER_IDENTITY_CHANGED'));
  rows=structuredClone(r.rows);rows[0].pid=42;assert(validateTrace(rows,100).issues.includes('PROCESS_COVERAGE_UNAVAILABLE'));
});
test('Docker counter rates use monotonic time even when wall clock jumps backward',async()=>{
  const r=await virtual(),rows=r.rows;
  rows[0].docker=true;rows[0].containers=['api'];
  const samples=rows.filter(x=>x.kind==='sample');
  samples.forEach((s,i)=>{s.at=i?'2026-10-12T00:00:00Z':'2026-10-13T00:00:00Z';s.docker={available:true,containers:[{id:'a'.repeat(64),cpuPct:1,memoryBytes:1,memoryLimitBytes:2,blockReadBytes:i*500,blockWriteBytes:i*1000,pids:3}]};});
  const report=summarise(rows.map(JSON.stringify).join('\n'));
  assert.equal(report.completion,'complete');assert.equal(report.containers['a'.repeat(64)].blockRead.meanBytesPerSec,100);assert.equal(report.containers['a'.repeat(64)].blockWrite.meanBytesPerSec,200);
});
test('missing requested metrics fail console/end status as well as report',async()=>{
  const r=await virtual({extra:{docker:true,containers:['api']}});
  assert.equal(r.done.complete,false);assert.equal(r.done.sampleFailures,2);assert.equal(r.rows.at(-1).complete,false);
  assert.equal(summarise(r.content).completion,'incomplete');
});
test('overhead is measured self CPU/RSS, never fabricated Docker CPU or capacity',async()=>{
  const r=await virtual(), report=summarise(r.content);
  assert(report.samplerOverhead.cpuMicros.user>=0);assert(report.samplerOverhead.maxRssKiB>0);
  assert.match(report.samplerOverhead.dockerChildCpu,/UNAVAILABLE/);assert.match(report.samplerOverhead.baselineImpact,/UNMEASURED/);assert.equal(report.coverage.capacityAcceptance,false);
});
test('Linux private output guards reject permission, ownership, symlink and hard-link violations',async()=>{
  const stub={mode:0o700,uid:10,nlink:1,isSymbolicLink:()=>false,isDirectory:()=>true,isFile:()=>false};
  assert(privateMode(stub,'directory',10));assert(!privateMode({...stub,mode:0o755},'directory',10));assert(!privateMode(stub,'directory',11));
  assert(!privateMode({...stub,isSymbolicLink:()=>true},'directory',10));
  assert(privateMode({...stub,mode:0o600,isFile:()=>true},'file',10));assert(!privateMode({...stub,mode:0o600,isFile:()=>true,nlink:2},'file',10));
  const dir=await mkdtemp(join(tmpdir(),'cx23-mode-'));try{const p=join(dir,'a.ndjson');const f=await privateOutput(p);await f.close();await assert.rejects(privateOutput(p),/EEXIST/);}finally{await rm(dir,{recursive:true,force:true});}
});
test('Docker is explicit local pinned binary/socket with sanitized environment and bounded execution',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'cx23-docker-')), id='a'.repeat(64), calls=[];
  const options=safeDockerOptions('/safe/config',undefined,{DOCKER_HOST:'tcp://remote',PATH:'/unsafe',HOME:'/private'});
  assert.deepEqual(Object.keys(options.env).sort(),['DOCKER_CONFIG','LANG','LC_ALL','PATH']);assert.equal(options.env.PATH,'/usr/bin:/bin');assert.equal(options.timeout,12000);assert.equal(options.killSignal,'SIGKILL');
  try{const reader=await createDockerReader(['api'],join(dir,'config'),{exec:async(binary,args,opts)=>{calls.push({binary,args,opts});return{stdout:args.includes('inspect')?id:JSON.stringify({ID:id})};}});
    assert.equal((await reader.read()).available,true);assert.equal(calls.length,2);
    for(const c of calls){assert.equal(c.binary,'/usr/bin/docker');assert.equal(c.args[0],'--host=unix:///var/run/docker.sock');assert(!c.args.includes('exec'));}
    assert(calls[1].args.includes(id));await assert.rejects(createDockerReader([],join(dir,'unused')),/EXPLICIT/);
    const bad=await createDockerReader(['api'],join(dir,'changed'),{exec:async(binary,args)=>({stdout:args.includes('inspect')?id:JSON.stringify({ID:'b'.repeat(64)})})});assert.equal((await bad.read()).available,false);
  }finally{await rm(dir,{recursive:true,force:true});}
});
const statText=(pid,start='100',parent=1)=>{const f=Array(24).fill('0');f[0]='S';f[1]=String(parent);f[11]='10';f[12]='20';f[19]=start;return `${pid} (name with ) spaces) ${f.join(' ')}`;};
function procFixture({changed=false,taskChanged=false,taskCount=2}={}){
  let leaderReads=0,lists=0;
  const read=async path=>{
    if(path==='/proc/42/stat')return statText(42,changed&&++leaderReads>2?'101':'100');
    if(path==='/proc/51/stat')return statText(51,'200',42);
    if(/\/cgroup$/.test(path))return '0::/fixture\n';
    if(/\/status$/.test(path))return 'VmRSS: 12 kB\nThreads: 2\n';
    if(path==='/proc/42/task/43/children')return '51';
    if(/\/children$/.test(path))return '';
    if(path.endsWith('cpu.stat'))return 'usage_usec 12\nuser_usec 8\nsystem_usec 4\n';if(path.endsWith('io.stat'))return '8:0 rbytes=0 wbytes=10\n';
    if(path.endsWith('cgroup.procs'))return '42\n51\n';if(path.startsWith('/sys/fs/cgroup/'))return '24\n';
    throw Error('Unexpected fixture path '+path);
  };
  const list=async path=>path==='/proc/42/task'?(taskChanged&&++lists>1?['42']:Array.from({length:taskCount},(_,i)=>String(42+i))):['51'];
  return {read,list};
}
test('process identity parses starttime despite comm parentheses and finds nonleader-TID children',async()=>{
  assert.deepEqual(procStat(statText(42)),{pid:42,parentPid:1,userTicks:10,systemTicks:20,startTimeTicks:'100'});
  const f=procFixture(), pin=await processIdentity(42,f.read), result=await processInventory(pin,f);
  assert.equal(result.available,true);assert.deepEqual(result.rows.map(r=>r.pid),[42,51]);assert.equal(result.tasksRead,3);assert.equal(result.cgroup.available,true);
  assert(!JSON.stringify(result).includes('name with'));assert(!JSON.stringify(result).includes('/fixture'));
  const r=await virtual({extra:{pid:42},deps:{doSample:async()=>({counters:{},out:{...hostMetrics(),processes:result}})}});
  assert.equal(r.done.complete,true);const summary=summarise(r.content);
  assert.equal(Object.keys(summary.processes).length,2);assert.equal(Object.keys(summary.cgroups).length,1);
  assert.equal(Object.values(summary.processes)[0].rssMiB.max,0.01);assert.match(summary.physicalFsyncLatency,/UNAVAILABLE/);
});
test('PID reuse, task churn, inventory bounds and missing process fail closed',async()=>{
  const stable=procFixture(), pin=await processIdentity(42,stable.read);
  const reuse=await processInventory(pin,procFixture({changed:true}));assert.equal(reuse.available,false);
  assert.equal((await processInventory(pin,procFixture({taskChanged:true}))).reason,'PROCESS_TASKS_CHANGED');
  assert.equal((await processInventory(pin,{...stable,maxProcesses:1})).reason,'PROCESS_INVENTORY_LIMIT');
  assert.equal((await processInventory(pin,{...stable,maxTasks:1})).reason,'PROCESS_TASK_LIMIT');
  assert.equal((await processInventory(pin,{...stable,read:async()=>{throw Error('PRIVATE');}})).reason,'PROCESS_UNAVAILABLE');
  const unrelated={...stable,read:async(path,options)=>path==='/proc/51/stat'?statText(51,'200',999):stable.read(path,options)};
  assert.equal((await processInventory(pin,unrelated)).reason,'PROCESS_PARENT_CHANGED');
});
test('cgroup CPU/I/O grammar, target membership and post-read identity fail closed',async()=>{
  const f=procFixture(),pin=await processIdentity(42,f.read);
  for(const [suffix,value] of [['cpu.stat','garbage'],['io.stat','garbage'],['io.stat','259:0 other=1\n'],['io.stat','259:0 rbytes=1 wbytes=2 rbytes=3\n'],['io.stat','259:0 rbytes=1 wbytes=2\n259:0 rbytes=2 wbytes=4\n'],['cgroup.procs','51\n'],['memory.current','unknown']]){
    const broken={...f,read:async(path,options)=>path.endsWith('/'+suffix)?value:f.read(path,options)};
    const inventory=await processInventory(pin,broken);assert.equal(inventory.cgroup.available,false);
    const r=await virtual({extra:{pid:42},deps:{doSample:async()=>({counters:{},out:{...hostMetrics(),processes:inventory}})}});assert.equal(r.done.complete,false);assert.equal(summarise(r.content).completion,'incomplete');
  }
  const empty=await processInventory(pin,{...f,read:async(path,options)=>path.endsWith('/io.stat')?'':f.read(path,options)});
  assert.equal(empty.cgroup.available,true);assert.equal(empty.cgroup.ioAvailable,false);assert.equal(empty.cgroup.ioUnavailableReason,'NO_BLOCK_IO_COUNTERS_EXPOSED');
  let cgroupRead=false;
  const moved=await processInventory(pin,{...f,read:async(path,options)=>{
    if(path.endsWith('/cpu.stat'))cgroupRead=true;
    if(path==='/proc/42/stat'&&cgroupRead)return statText(42,'101');
    return f.read(path,options);
  }});assert.equal(moved.reason,'PROCESS_IDENTITY_CHANGED');
  assert.equal(validIoCounters('259:0 rbytes=0 wbytes=0 rios=0 wios=0\n'),true);
});
test('Linux CPU cgroup dotted extension keys preserve required resource coverage',async()=>{
  // Actual Linux field shape, with local fixture values; not a production observation.
  const cpu='usage_usec 120\nuser_usec 90\nsystem_usec 30\nnr_periods 1\nnr_throttled 0\nthrottled_usec 0\nnr_bursts 0\nburst_usec 0\ncore_sched.force_idle_usec 0\n';
  const f=procFixture(),pin=await processIdentity(42,f.read);
  const inventory=await processInventory(pin,{...f,read:async(path,options)=>path.endsWith('/cpu.stat')?cpu:f.read(path,options)});
  assert.equal(inventory.cgroup.available,true);
  const r=await virtual({extra:{pid:42},deps:{doSample:async()=>({counters:{},out:{...hostMetrics(),processes:inventory}})}});
  assert.equal(r.done.complete,true);assert.equal(summarise(r.content).completion,'complete');
  assert.equal(Object.values(summarise(r.content).cgroups)[0].cpuUsageMicros.first,120);
  assert.equal(parseCpuCounters(cpu)['core_sched.force_idle_usec'],0);
});
test('CPU counter extensions never permit missing, duplicate or malformed evidence',async()=>{
  const base='usage_usec 120\nuser_usec 90\nsystem_usec 30\n';
  assert.equal(parseCpuCounters(base+'future2.namespace_counter 7\n')['future2.namespace_counter'],7);
  const invalid=[...['usage_usec','user_usec','system_usec'].map(k=>base.replace(new RegExp(k+' \\d+\\n'),'')),
    ...['usage_usec','user_usec','system_usec'].map(k=>base+k+' 1\n'),
    base+'future.counter 1\nfuture.counter 2\n',base+'future..counter 1\n',base+'future.counter -1\n',base+'future.counter NaN\n',
    base+'future.counter 1.5\n',base+'future.counter 9007199254740992\n',base+'private text\n'];
  const f=procFixture(),pin=await processIdentity(42,f.read),valid=await processInventory(pin,f);
  for(const cpu of invalid){
    assert.equal(parseCpuCounters(cpu),null);
    const inventory=await processInventory(pin,{...f,read:async(path,options)=>path.endsWith('/cpu.stat')?cpu:f.read(path,options)});
    assert.equal(inventory.cgroup.available,false);
    // Independently reject a tampered raw artifact whose adapter success flag is forged.
    const forged={...valid,cgroup:{...valid.cgroup,cpuStat:cpu}};
    const r=await virtual({extra:{pid:42},deps:{doSample:async()=>({counters:{},out:{...hostMetrics(),processes:forged}})}});
    assert.equal(r.done.complete,false);assert.equal(summarise(r.content).completion,'incomplete');
  }
});
