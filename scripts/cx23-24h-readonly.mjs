#!/usr/bin/env node
/**
 * VOLTEX CX23 finite, passive Linux resource sampler. No network traffic or app writes.
 * Opt-in Docker stats uses docker CLI read-only; no Docker API mutation.
 * Does NOT prove trading performance, provider licences, or capacity by itself.
 */
import { readFile, statfs } from 'node:fs/promises';
import { resolve, isAbsolute, dirname, join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { pathToFileURL } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { privateOutput, freeBytes, createDockerReader, processIdentity, processInventory, codeError } from './cx23-24h-platform.mjs';
import { sampleMetricIssues } from './cx23-24h-report.mjs';

const safeNum = value => Number.isFinite(value) ? value : null;

export function parseArgs(argv) {
  const fields = new Map();
  for (const raw of argv) {
    if (!raw.startsWith('--')) throw Error(`Unexpected argument: ${raw}`);
    const index = raw.indexOf('=');
    const key = raw.slice(2, index < 0 ? undefined : index);
    const value = index < 0 ? 'true' : raw.slice(index + 1);
    if (fields.has(key)) throw Error(`Duplicate option: ${key}`);
    if (!['out', 'hours', 'interval-seconds', 'docker', 'tag', 'containers', 'pid', 'max-output-bytes', 'min-free-bytes'].includes(key)) throw Error(`Unsupported option: ${key}`);
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
  if (docker && !containers.length) throw Error('--docker requires explicit --containers');
  const pid = fields.has('pid') ? Number(fields.get('pid')) : null;
  if (pid !== null && (!Number.isSafeInteger(pid) || pid < 1)) throw Error('--pid must be a positive integer');
  const maxOutputBytes = Number(fields.get('max-output-bytes') ?? 16777216), minFreeBytes = Number(fields.get('min-free-bytes') ?? 67108864);
  if (!Number.isSafeInteger(maxOutputBytes) || maxOutputBytes < 65536 || maxOutputBytes > 67108864) throw Error('Invalid output byte budget');
  if (!Number.isSafeInteger(minFreeBytes) || minFreeBytes < 67108864) throw Error('Minimum free bytes must be >=67108864');
  return { out:resolve(out), hours, intervalSeconds, tag, docker, containers, pid, maxOutputBytes, minFreeBytes };
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

async function optionalPressure(name, signal) {
  try { return pressureFields(await readFile('/proc/pressure/' + name, { encoding: 'utf8', signal })); } catch { return null; }
}
export async function sample({ signal, dockerReader, processPin }, prev = null) {
  const at = new Date().toISOString(), options = { encoding: 'utf8', signal };
  const [stat, mem, fs, cpuPressure, ioPressure, memoryPressure, docker, processes] = await Promise.all([
    readFile('/proc/stat', options), readFile('/proc/meminfo', options), statfs('/'), optionalPressure('cpu', signal),
    optionalPressure('io', signal), optionalPressure('memory', signal), dockerReader ? dockerReader.read(signal) : null,
    processInventory(processPin, { signal })]);
  const counters = cpuFields(stat);
  return { counters, out: { kind: 'sample', at, ...cpuDelta(prev?.counters ?? null, counters), ...memoryFields(mem),
    rootFsFreeBytes: fs.bavail * fs.bsize, rootFsTotalBytes: fs.blocks * fs.bsize,
    pressure: { cpu: cpuPressure, io: ioPressure, memory: memoryPressure },
    docker: docker?.available ? { ...docker, rows: undefined, containers: docker.rows.map(r => ({ ...parseDockerRow(r), id: r.ID || r.Container })) } : docker,
    processes, processRssBytes: processes?.available ? processes.rows[0]?.rssBytes ?? null : null } };
}
export function abortable(promise, signal) {
  return new Promise((ok, fail) => {
    const abort = () => fail(signal.reason || codeError('ABORTED'));
    if (signal.aborted) { Promise.resolve(promise).catch(() => {}); return abort(); }
    signal.addEventListener('abort', abort, { once: true });
    Promise.resolve(promise).then(ok, fail).finally(() => signal.removeEventListener('abort', abort));
  });
}
export async function run(config, { doSample = sample, now = () => performance.now(), wallNow = Date.now,
  sleep = (ms, signal) => delay(ms, undefined, { signal }), openOutput = privateOutput, getFree = freeBytes,
  signal: callerSignal, hardStop = code => process.exit(code), graceMs = 2000, sampleTimeoutMs = 12000,
  prepare = async (c, signal) => ({ dockerReader: c.docker ? await createDockerReader(c.containers, join(dirname(c.out), '.docker-empty'), { signal }) : null,
    processPin: c.pid ? await processIdentity(c.pid, undefined, signal) : null }) } = {}) {
  const durationMs = Math.ceil(config.hours * 3600000), step = config.intervalSeconds * 1000;
  if (!(durationMs > 0 && durationMs <= 86400000 && step >= 5000 && step <= 3600000)) throw codeError('INVALID_FINITE_CONFIG');
  const maxBytes = config.maxOutputBytes ?? 16777216, minFree = config.minFreeBytes ?? 67108864;
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 65536 || maxBytes > 67108864 || !Number.isSafeInteger(minFree) || minFree < 67108864) throw codeError('INVALID_DISK_BUDGET');
  const file = await openOutput(config.out), start = now(), wallStart = wallNow(), end = start + durationMs;
  const expected = Math.ceil(durationMs / step), maxStartLatenessMs = Math.min(1000, step / 10), control = new AbortController(), cpuStart = process.cpuUsage();
  let bytes = 0, count = 0, skipped = 0, failures = 0, previous = null, reason = 'duration-completed', signalGrace;
  const stop = label => { reason = label; control.abort(codeError(label)); signalGrace ??= setTimeout(() => hardStop(2), graceMs); };
  const onInt = () => stop('SIGINT'), onTerm = () => stop('SIGTERM'), onCaller = () => stop('CALLER_ABORT');
  let deadline;
  const armDeadline = () => {
    const remaining = end - now();
    // Timers can wake before their requested deadline. Only monotonic time ends the window.
    if (remaining > 0) deadline = setTimeout(armDeadline, Math.max(1, Math.ceil(remaining)));
    else control.abort(codeError('DURATION_DEADLINE'));
  };
  armDeadline();
  // Fail closed if an OS operation/child ignores cancellation or evidence close stalls.
  const watchdog = setTimeout(() => hardStop(2), durationMs + graceMs);
  process.on('SIGINT', onInt); process.on('SIGTERM', onTerm);
  callerSignal?.addEventListener('abort', onCaller, { once: true });
  if (callerSignal?.aborted) onCaller();
  const write = async (value, terminal = false) => {
    const buffer = Buffer.from(JSON.stringify(value) + '\n');
    // Keep a small reserved budget for terminal evidence; never exceed the total cap.
    if (bytes + buffer.length > maxBytes - (terminal ? 0 : 2048)) throw codeError('OUTPUT_BYTE_LIMIT');
    const available = await getFree(config.out);
    if (!Number.isFinite(available) || available < minFree + buffer.length) throw codeError('OUTPUT_FREE_SPACE_LIMIT');
    let offset = 0;
    while (offset < buffer.length) { const r = await file.write(buffer, offset, buffer.length - offset); if (!r.bytesWritten) throw codeError('OUTPUT_WRITE_INCOMPLETE'); offset += r.bytesWritten; bytes += r.bytesWritten; }
  };
  const waitUntil = async target => { let ms; while ((ms = target - now()) > 0) await abortable(sleep(Math.ceil(ms), control.signal), control.signal); };
  try {
    await write({ kind: 'start', schema: 2, startedAt: new Date(wallStart).toISOString(), plannedEndAt: new Date(wallStart + durationMs).toISOString(), timezone: 'UTC',
      tag: config.tag, durationHours: config.hours, durationMs, intervalSeconds: config.intervalSeconds, expectedSamples: expected, maxStartLatenessMs,
      docker: config.docker, containers: config.containers, pid: config.pid, maxOutputBytes: maxBytes, minFreeBytes: minFree,
      nodeVersion: process.version, scope: 'Passive host resources; not trading latency/capacity. Docker explicitly local Unix socket, pinned IDs only.', externalRequests: 0, applicationMutations: 0 });
    const setupTimeout = new AbortController(), setupTimer = setTimeout(() => setupTimeout.abort(codeError('SETUP_TIMEOUT')), Math.min(sampleTimeoutMs, Math.max(1, end - now())));
    let adapters;
    try { const combined = AbortSignal.any([control.signal, setupTimeout.signal]); adapters = await abortable(prepare(config, combined), combined); }
    finally { clearTimeout(setupTimer); }
    let tick = 0;
    while (!control.signal.aborted && now() < end && tick < expected) {
      await waitUntil(start + tick * step);
      if (control.signal.aborted || now() >= end) break;
      if (now() - start - tick * step > maxStartLatenessMs) {
        const to = Math.min(Math.floor((now() - start) / step) + 1, expected);
        await write({ kind: 'gap', fromTick: tick, toTickExclusive: to, reason: 'LATE_WAKEUP' }); skipped += to - tick; tick = to; continue;
      }
      if (tick >= expected || now() >= end) break;
      const begun = now(), elapsedMs = begun - start, cpu = process.cpuUsage();
      const timeout = new AbortController(), timer = setTimeout(() => timeout.abort(codeError('SAMPLE_TIMEOUT')), Math.min(sampleTimeoutMs, Math.max(1, end - now())));
      try {
        const combined = AbortSignal.any([control.signal, timeout.signal]);
        const result = await abortable(doSample({ ...config, ...adapters, signal: combined }, previous ? { counters: previous.counters } : null), combined);
        if (control.signal.aborted || now() >= end) throw codeError('SAMPLE_PAST_DEADLINE');
        const finished = now();
        const entry = { ...result.out, kind: 'sample', tag: config.tag, tick, scheduledMs: tick * step, elapsedMs, completedMs: finished - start,
          collectionMs: (finished - start) - elapsedMs, overhead: { samplerCpuMicros: process.cpuUsage(cpu), samplerRssBytes: process.memoryUsage().rss,
            samplerMaxRssKiB: process.resourceUsage().maxRSS, scope: 'Sampler process only. Docker child CPU unavailable; collection wall includes waiting, not CPU.' } };
        entry.metricIssues = sampleMetricIssues(config, entry, count);
        if (entry.metricIssues.length) failures++;
        await write(entry);
        previous = result; count++;
      } catch (e) {
        if (e.code?.startsWith('OUTPUT_')) throw e;
        failures++; await write({ kind: 'sample-error', tick, elapsedMs, code: control.signal.aborted ? control.signal.reason?.code || 'ABORTED' : e.code === 'SAMPLE_TIMEOUT' ? 'SAMPLE_TIMEOUT' : e.code === 'SAMPLE_PAST_DEADLINE' ? e.code : 'SAMPLE_UNAVAILABLE' });
        if (control.signal.aborted || now() >= end) break;
      } finally { clearTimeout(timer); }
      // Skip missed slots. Never issue a catch-up sample for a target in the past.
      const next = Math.min(expected, Math.max(tick + 1, Math.floor((now() - start) / step) + 1));
      if (next > tick + 1) { await write({ kind: 'gap', fromTick: tick + 1, toTickExclusive: next, reason: 'OVERRUN_NO_CATCHUP' }); skipped += next - tick - 1; }
      tick = next;
    }
    if (!control.signal.aborted && now() < end) await waitUntil(end);
  } catch (e) {
    if (control.signal.reason?.code !== 'DURATION_DEADLINE') { if (!control.signal.aborted) reason = ['OUTPUT_BYTE_LIMIT', 'OUTPUT_FREE_SPACE_LIMIT', 'SETUP_TIMEOUT'].includes(e.code) ? e.code : 'MONITOR_ERROR'; failures++; }
  } finally {
    const elapsedMs = now() - start, interrupted = ['SIGINT', 'SIGTERM', 'CALLER_ABORT'].includes(reason);
    const complete = reason === 'duration-completed' && elapsedMs >= durationMs && count === expected && skipped === 0 && failures === 0;
    try { await write({ kind: 'end', schema: 2, at: new Date(wallNow()).toISOString(), timezone: 'UTC', reason, complete,
      elapsedMs, samples: count, skippedSlots: skipped, sampleFailures: failures, outputBytesBeforeEnd: bytes,
      overhead: { samplerCpuMicros: process.cpuUsage(cpuStart), samplerMaxRssKiB: process.resourceUsage().maxRSS,
        scope: 'Sampler process; no invented child CPU or monitor-free baseline.' } }, true); }
    catch { reason = 'TERMINAL_EVIDENCE_UNAVAILABLE'; }
    try { await file.close(); }
    finally { clearTimeout(deadline); clearTimeout(watchdog); clearTimeout(signalGrace); process.off('SIGINT', onInt); process.off('SIGTERM', onTerm); callerSignal?.removeEventListener('abort', onCaller); }
    return { out: config.out, samples: count, skippedSlots: skipped, sampleFailures: failures, complete: complete && reason !== 'TERMINAL_EVIDENCE_UNAVAILABLE', reason, interrupted };
  }
}

if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href) {
  try {
    if (process.platform!=='linux') throw Error('Linux host required');
    const config=parseArgs(process.argv.slice(2));
    const result=await run(config);
    console.log(JSON.stringify({done:true,...result}));
    if (!result.complete) process.exitCode = 1;
  }catch(e){console.error(`CX23_READONLY_MONITOR_ERROR: ${e.message}`);process.exitCode=1;}
}
