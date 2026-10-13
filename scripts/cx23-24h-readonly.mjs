#!/usr/bin/env node
/**
 * VOLTEX CX23 finite, passive Linux resource sampler. No network traffic or app writes.
 * Opt-in Docker stats uses docker CLI read-only; no Docker API mutation.
 * Does NOT prove trading performance, provider licences, or capacity by itself.
 */
import { readFile, statfs, open } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { resolve, isAbsolute } from 'node:path';
import { performance } from 'node:perf_hooks';
import { pathToFileURL } from 'node:url';

const execFileAsync = promisify(execFile);
const safeNum = value => Number.isFinite(value) ? value : null;

export function parseArgs(argv) {
  const fields = new Map();
  for (const raw of argv) {
    if (!raw.startsWith('--')) throw Error(`Unexpected argument: ${raw}`);
    const index = raw.indexOf('=');
    const key = raw.slice(2, index < 0 ? undefined : index);
    const value = index < 0 ? 'true' : raw.slice(index + 1);
    if (fields.has(key)) throw Error(`Duplicate option: ${key}`);
    if (!['out', 'hours', 'interval-seconds', 'docker', 'tag', 'containers', 'pid'].includes(key)) throw Error(`Unsupported option: ${key}`);
    fields.set(key, value);
  }
  const out = fields.get('out');
  if (!out || !isAbsolute(out)) throw Error('--out=<absolute path to new .ndjson file> is required');
  const hours = Number(fields.get('hours') ?? 24);
  const intervalSeconds = Number(fields.get('interval-seconds') ?? 60);
  if (!Number.isFinite(hours) || hours <= 0 || hours > 24) throw Error('--hours must be >0 and <=24');
  if (!Number.isFinite(intervalSeconds) || intervalSeconds < 5 || intervalSeconds > 3600) throw Error('--interval-seconds must be between 5 and 3600');
  const tag = fields.get('tag') ?? 'baseline';
  if (!/^[a-z0-9][a-z0-9-]{0,29}$/.test(tag)) throw Error('--tag must be 1-30 lowercase ASCII letters/digits/hyphens');
  const docker = fields.get('docker') === 'true';
  if (fields.has('docker') && !['true','false'].includes(fields.get('docker'))) throw Error('--docker=true or --docker=false');
  const containers = fields.has('containers') ? fields.get('containers').split(',') : [];
  if (containers.some(x=>!/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,127}$/.test(x)) || containers.length>20) throw Error('Invalid --containers list');
  if (containers.length && !docker) throw Error('--containers requires --docker');
  const pid = fields.has('pid') ? Number(fields.get('pid')) : null;
  if (pid !== null && (!Number.isSafeInteger(pid) || pid < 1)) throw Error('--pid must be a positive integer');
  return { out:resolve(out), hours, intervalSeconds, tag, docker, containers, pid };
}

export function cpuFields(content) {
  const line = content.split('\n').find(x => /^cpu\s/.test(x));
  if (!line) throw Error('Linux /proc/stat aggregate CPU counters unavailable');
  const a = line.trim().split(/\s+/).slice(1,9).map(Number);
  if (a.length < 8 || a.some(x=>!Number.isFinite(x))) throw Error('Invalid Linux /proc/stat');
  return { total:a.reduce((x,y)=>x+y,0), idle:a[3]+a[4], iowait:a[4] };
}

export function cpuDelta(prev,next) {
  if (!prev) return { hostCpuPct:null, hostIowaitPct:null };
  const total = next.total - prev.total;
  if (!(total > 0)) return { hostCpuPct:null, hostIowaitPct:null };
  return {hostCpuPct:safeNum(Math.max(0,Math.min(100,100*(1-(next.idle-prev.idle)/total)))),
    hostIowaitPct:safeNum(Math.max(0,100*(next.iowait-prev.iowait)/total))};
}

export function memoryFields(content) {
  const entries = Object.fromEntries(content.split('\n').map(line=>{
    const match=line.match(/^([A-Za-z_()]+):\s*(\d+)\s*kB/);
    return match?[match[1],Number(match[2])*1024]:[];
  }).filter(x=>x.length));
  if (!entries.MemTotal || !Number.isFinite(entries.MemAvailable)) throw Error('Invalid Linux /proc/meminfo');
  return {hostMemTotalBytes:entries.MemTotal,hostMemAvailableBytes:entries.MemAvailable,
    hostMemUsedPct:100*(1-entries.MemAvailable/entries.MemTotal),
    hostSwapUsedBytes:(entries.SwapTotal??0)-(entries.SwapFree??0)};
}

export function pressureFields(content) {
  const lines = content.trim().split('\n');
  const out = {};
  for (const line of lines) {
    const [type,...items] = line.split(/\s+/);
    if (!['some','full'].includes(type)) continue;
    const metrics = Object.fromEntries(items.map(x=>x.split('=')));
    out[type] = {avg10:safeNum(Number(metrics.avg10)),avg60:safeNum(Number(metrics.avg60)),avg300:safeNum(Number(metrics.avg300))};
  }
  return out;
}

export function parseBytes(text) {
  if (typeof text !== 'string') return null;
  const m = text.trim().match(/^([\d.]+)\s*(B|kB|KB|KiB|MB|MiB|GB|GiB|TB|TiB)$/i);
  if (!m) return null;
  const unit = m[2];
  const powers = { B:1,kB:1e3,KB:1e3,KiB:1024,MB:1e6,MiB:1048576,GB:1e9,GiB:1073741824,TB:1e12,TiB:1099511627776 };
  return safeNum(Number(m[1])*powers[unit]);
}

export function parseDockerRow(row) {
  const parsePair = v => String(v??'').split(' / ').map(parseBytes);
  const [used,limit] = parsePair(row.MemUsage);
  const [read,write] = parsePair(row.BlockIO);
  return {name:row.Name||row.Container||'unknown',cpuPct:safeNum(parseFloat(row.CPUPerc)),
    memoryBytes:used??null,memoryLimitBytes:limit??null,
    blockReadBytes:read??null,blockWriteBytes:write??null,
    pids:safeNum(Number(row.PIDs))};
}

async function dockerSample(names) {
  try {
    const {stdout} = await execFileAsync('docker',['stats','--no-stream','--format','{{json .}}',...names],
      {timeout:12000,maxBuffer:256*1024});
    return {available:true,containers:stdout.split('\n').filter(Boolean).map(x=>parseDockerRow(JSON.parse(x)))};
  } catch(e) {return {available:false,reason:e.code==='ENOENT'?'docker-cli-not-installed':'docker-stats-unavailable'};}
}

async function optionalPressure(name) {
  try {return pressureFields(await readFile(`/proc/pressure/${name}`,'utf8'));} catch {return null;}
}
async function optionalProcRss(pid) {
  if (!pid) return null;
  try {
    const value=(await readFile(`/proc/${pid}/status`,'utf8')).match(/^VmRSS:\s*(\d+)\s*kB/m);
    return value?Number(value[1])*1024:null;
  } catch {return null;}
}

export async function sample({docker=false,containers=[],pid=null},prev=null) {
  const at=new Date().toISOString();
  const [stat,mem,fs,cpuPressure,ioPressure,memoryPressure,containerStats,procRss] = await Promise.all([
    readFile('/proc/stat','utf8'),readFile('/proc/meminfo','utf8'),statfs('/'),optionalPressure('cpu'),
    optionalPressure('io'),optionalPressure('memory'),docker?dockerSample(containers):Promise.resolve(null),optionalProcRss(pid)]);
  const counters=cpuFields(stat);
  const out={kind:'sample',at,tag:prev?.tag??null,...cpuDelta(prev?.counters??null,counters),
    ...memoryFields(mem),rootFsFreeBytes:fs.bavail*fs.bsize,rootFsTotalBytes:fs.blocks*fs.bsize,
    pressure:{cpu:cpuPressure,io:ioPressure,memory:memoryPressure},
    docker:containerStats,processRssBytes:procRss};
  return {out,counters};
}

export async function run(config, {doSample=sample,now=()=>performance.now(),sleep=ms=>new Promise(r=>setTimeout(r,ms))}={}) {
  // 'wx' fails closed instead of overwriting older evidence; Linux creates 0600.
  const file=await open(config.out,'wx',0o600);
  const startedAt=new Date().toISOString(), start=now();
  let previous=null, count=0, stopped=false;
  const stop=()=>{stopped=true;};
  process.on('SIGINT',stop);process.on('SIGTERM',stop);
  const write=async value=>file.write(JSON.stringify(value)+'\n');
  try {
    await write({kind:'start',schema:1,startedAt,tag:config.tag,
      durationHours:config.hours,intervalSeconds:config.intervalSeconds,
      docker:config.docker,containers:config.containers,pid:config.pid,
      scope:'passive Linux host/container resource sample; not Stocks/crypto latency, not provider-budget evidence',
      externalRequests:0,applicationMutations:0});
    const end=start+config.hours*3600000,step=config.intervalSeconds*1000;
    for (let tick=0;!stopped;tick++) {
      const target=start+tick*step;
      if (tick>0&&target>end) break;
      const wait=target-now();if(wait>0)await sleep(wait);
      if (stopped) break;
      const result=await doSample(config,previous?{counters:previous.counters,tag:config.tag}:{tag:config.tag});
      await write({...result.out,tag:config.tag});
      previous=result;count++;
      if (now()>=end) break;
    }
    await write({kind:'end',at:new Date().toISOString(),reason:stopped?'interrupted':'duration-completed',samples:count});
  } catch(e) {
    await write({kind:'error',at:new Date().toISOString(),message:String(e?.message||e).slice(0,160)}).catch(()=>{});
    throw e;
  } finally {
    process.off('SIGINT',stop);process.off('SIGTERM',stop);
    await file.close();
  }
  return {out:config.out,samples:count,interrupted:stopped};
}

if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href) {
  try {
    if (process.platform!=='linux') throw Error('Linux host required');
    const config=parseArgs(process.argv.slice(2));
    const result=await run(config);
    console.log(JSON.stringify({done:true,...result}));
  }catch(e){console.error(`CX23_READONLY_MONITOR_ERROR: ${e.message}`);process.exitCode=1;}
}
