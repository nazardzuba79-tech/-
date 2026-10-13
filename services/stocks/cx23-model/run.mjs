// Linux CI only. The controller/load generator stays OUTSIDE the aggregate container.
import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync, readFileSync, chmodSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MODEL, verifyBudget, keyValues, compareCrypto } from './metrics.mjs';
import { randomBytes } from 'node:crypto';
import { requireEmptyDirectory, requireFreePorts, requireImageRevision, controlJson, cleanupWithEvidence } from './safety.mjs';
const here = fileURLToPath(new URL('.', import.meta.url));
const output = resolve(process.env.CX23_OUTPUT || '.ci-output/stocks-cx23');
const disk = process.env.CX23_DISK, image = process.env.CX23_IMAGE, sourceSha = process.env.CX23_SOURCE_SHA;
const seconds = Number(process.env.CX23_SECONDS || 20);
if (process.platform !== 'linux' || !disk || !image || !/^[a-f0-9]{40}$/.test(sourceSha || '')) throw Error('Linux/disposable disk/image/exact source SHA required');
if (seconds < 20 || seconds > 60 || !Number.isInteger(seconds)) throw Error('Invalid model duration');
requireEmptyDirectory(output); requireEmptyDirectory(disk);
mkdirSync(output, { recursive: true }); mkdirSync(disk, { recursive: true });
const docker = args => { const r = spawnSync('docker', args, { encoding: 'utf8', timeout: 120000 }); if (r.status !== 0) throw Error(`docker ${args[0]}: ${r.stderr}`); return r.stdout.trim(); };
const imageRevision = docker(['image', 'inspect', image, '--format', '{{index .Config.Labels "org.opencontainers.image.revision"}}']);
requireImageRevision(imageRevision, sourceSha);
const sleep = ms => new Promise(ok => setTimeout(ok, ms));
const profiles = [{ profile: 'idle', viewers: 0, pattern: 'shared' }, { profile: 'owner-wallet', viewers: 0, pattern: 'shared' }, ...[5, 10, 20, 50].flatMap(viewers => ['shared', 'distinct'].map(pattern => ({ profile: `${viewers}-${pattern}`, viewers, pattern })))];
// Snapshot instrumentation OFF/ON pair is a separate diagnostic, never A acceptance.
const config = { sourceSha, imageRevision, image, imageId: docker(['image', 'inspect', image, '--format', '{{.Id}}']), model: MODEL, seconds, profiles,
  transport: 'Loopback HTTP per operation, wrapping real OrderService/FuturesPositionService/FuturesProtectionService; disposable PostgreSQL; NOT production API middleware/auth.',
  aggregateBudget: 'Single container cgroup includes supervisor, Stocks main+SQLite worker, crypto Node and all disposable PostgreSQL processes.',
  cpuCaveat: '2 CPU quota is a ceiling on a shared CI host, not guaranteed dedicated cores.',
  ioMode: 'Disposable host bind mount without synthetic I/O throttle. Host storage is not Hetzner.',
  loadGenerator: 'Host process outside container budget, shared host scheduling recorded; not included in 2 CPU/4 GiB.',
  unavailable: { physicalFsyncSyscallLatency: 'No syscall tracer; SQL COMMIT wall is not fsync time.', physicalDiskLatency: 'io.stat counts attributed bytes/operations, not device latency.', actualHetznerHeadroom: 'No production measurement permitted.', productionApiCoverage: 'Fixture HTTP adapter, not actual production auth/routes/collectors.' } };
writeFileSync(join(output, 'configuration.json'), JSON.stringify(config, null, 2));
writeFileSync(join(output, 'scheduled-cases.json'), JSON.stringify({ expectedPrimaryCases: 60, expectedOverheadCases: 6, profiles,
  labels: Array.from({ length: 3 }, (_, repeat) => profiles.flatMap(spec => ['control', 'loaded'].map(role => `${spec.profile}-r${repeat}-${role}-diag-on`))).flat(),
  overheadLabels: Array.from({ length: 3 }, (_, repeat) => ['on', 'off'].map(mode => `overhead-20-shared-r${repeat}-loaded-diag-${mode}`)).flat(),
  missingResultPolicy: 'Every absent, failed, interrupted or incomplete scheduled result is INCOMPLETE, never PASS.' }, null, 2));
const runClient = (spec, file) => new Promise((ok, fail) => {
  const child = spawn(process.execPath, [join(here, 'workload.mjs')], { env: { ...process.env, CX23_CASE: JSON.stringify(spec), CX23_RESULT: file, CX23_RAW_LOG: file + '.attempts.ndjson' }, stdio: ['ignore', 'pipe', 'pipe'] });
  let stdout = '', stderr = ''; child.stdout.on('data', b => stdout += b); child.stderr.on('data', b => stderr += b);
  const timer = setTimeout(() => { child.kill('SIGTERM'); fail(Error('MODEL_CLIENT_INCOMPLETE')); }, (seconds + 45) * 1000);
  child.on('error', fail); child.on('close', code => {
    clearTimeout(timer);
    try {
      writeFileSync(file + '.log', stdout + '\n' + stderr);
      code ? fail(Error(`MODEL_CLIENT_EXIT_${code}`)) : ok(JSON.parse(readFileSync(file, 'utf8')));
    } catch (error) { fail(error); }
  });
});
async function one(spec, repeat, loaded, diagnostics = true) {
  const label = `${spec.profile}-r${repeat}-${loaded ? 'loaded' : 'control'}-${diagnostics ? 'diag-on' : 'diag-off'}`;
  const dir = join(resolve(disk), label), name = `cx23-${process.pid}`, runId = randomBytes(16).toString('hex');
  const resultPath = join(output, label + '.json');
  let started = false, workloadStarted = false, result;
  try {
    requireEmptyDirectory(dir); await requireFreePorts(); mkdirSync(dir, { recursive: true }); chmodSync(dir, 0o777);
    docker(['run', '-d', '--name', name, '--cpus', '2', '--memory', '4g', '--memory-swap', '4g', '--pids-limit', '128', '--read-only', '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges', '--network', 'host', '--tmpfs', '/tmp:size=128m', '--mount', `type=bind,src=${dir},dst=/data`, '-e', `CX23_RUN_ID=${runId}`, '-e', `CX23_DIAGNOSTICS=${diagnostics}`, image]); started = true;
    let ready;
    for (let n = 0; n < 180; n++) {
      try { ready = await controlJson('http://127.0.0.1:18093/health', runId, 1000); break; } catch (e) { if (e.message === 'MODEL_RUN_ID_MISMATCH') throw e; }
      if (n % 10 === 0 && docker(['inspect', name, '--format', '{{.State.Running}}']) !== 'true') throw Error('MODEL_CONTAINER_EXITED');
      await sleep(500);
    }
    if (!ready) throw Error('MODEL_START_INCOMPLETE'); verifyBudget(ready.quota);
    const initial = await controlJson('http://127.0.0.1:18093/metrics', runId);
    workloadStarted = true;
    const workload = await runClient({ ...spec, seconds, loaded }, join(output, label + '-requests.json'));
    // Quiescent 3.4s window measures no-poll after all chart demand is released.
    const activeEnd = await controlJson('http://127.0.0.1:18093/metrics', runId); await sleep(3400);
    const final = await controlJson('http://127.0.0.1:18093/metrics', runId); verifyBudget(final.cgroup);
    const cpuBefore = keyValues(initial.cgroup.cpuStat), cpuAfter = keyValues(activeEnd.cgroup.cpuStat), events = keyValues(final.cgroup.memoryEvents);
    const crypto = workload.records.filter(r => r.kind === 'crypto');
    const initialProcesses = new Map(initial.processes.map(p => [p.pid, p]));
    const processCpu = activeEnd.processes.map(p => ({ pid: p.pid, name: p.name,
      cpuMs: initialProcesses.has(p.pid) ? p.cpuMs - initialProcesses.get(p.pid).cpuMs : null,
      note: initialProcesses.has(p.pid) ? 'Same PID /proc utime+stime delta; threads already included.' : 'Started after initial sample; full-interval delta unavailable.' }));
    const hg = activeEnd.stocks.hub, h0 = initial.stocks.hub;
    const historyHits = hg.historyCacheHits - h0.historyCacheHits, historyParses = hg.historyParses - h0.historyParses;
    result = { label, runId, repeat, loaded, diagnostics, spec, initial, activeEnd, final, workload, perProcessCpu: processCpu,
      processCpuLimit: 'Short-lived exited PostgreSQL children may be absent. Aggregate cgroup CPU is authoritative; SQL thread CPU is not added again.',
      historyCache: { hits: historyHits, parses: historyParses, hitRatioAmongHitOrParse: historyHits + historyParses ? historyHits / (historyHits + historyParses) : null,
        coalesced: hg.historyCoalesced - h0.historyCoalesced, note: 'Specific native history hit/(hit+parse) diagnostic, not all HTTP request hit rate.' },
      aggregateCpuMs: (cpuAfter.usage_usec - cpuBefore.usage_usec) / 1000,
      aggregateLifetimeMemoryPeakBytes: Number(final.cgroup.memoryPeak), memoryPeakIncludesSchemaStartup: true,
      oomEvents: events.oom ?? null, oomKills: events.oom_kill ?? null,
      idle: { elapsedMs: final.at - activeEnd.at, providerStarts: final.stocks.fixtureTransportStarts - activeEnd.stocks.fixtureTransportStarts,
        accountSql: diagnostics ? final.stocks.accounts.sqlCalls - activeEnd.stocks.accounts.sqlCalls : null,
        cpuMs: (keyValues(final.cgroup.cpuStat).usage_usec - keyValues(activeEnd.cgroup.cpuStat).usage_usec) / 1000 },
      cryptoRecords: crypto, complete: true };
  } catch (error) { result = { label, runId, repeat, loaded, diagnostics, spec, complete: false, infrastructureFailure: !workloadStarted, error: error.stack }; }
  finally {
    // Target only this named disposable container. Preserve result before cleanup.
    const actions = started ? [
        ['stop', ['stop', '-t', '15', name], null], ['logs', ['logs', name], label + '-container.log'],
        ['inspect', ['inspect', name], label + '-inspect.json'], ['rm', ['rm', name], null],
      ].map(([action, args, filename]) => ({ name: action, run: () => {
          const r = spawnSync('docker', args, { encoding: 'utf8', timeout: 30000 });
          if (filename) writeFileSync(join(output, filename), action === 'logs' ? r.stdout + '\n' + r.stderr : r.stdout);
          if (r.status !== 0) throw Error(`cleanup ${action} status=${r.status}: ${r.error?.message || r.stderr}`);
        } })) : [];
    result = await cleanupWithEvidence(result, value => writeFileSync(resultPath, JSON.stringify(value, null, 2)), actions);
  }
  writeFileSync(resultPath, JSON.stringify(result, null, 2)); return result;
}
const results = [], pairs = []; let infrastructureBlocker = false;
matrix: for (let repeat = 0; repeat < MODEL.repeats; repeat++) for (const spec of profiles) {
  const runs = {};
  // Alternate order to expose warm-host/order bias; each member gets a fresh disposable DB/container.
  for (const loaded of repeat % 2 ? [true, false] : [false, true]) {
    const r = await one(spec, repeat, loaded); runs[loaded ? 'loaded' : 'control'] = r; results.push(r);
    console.log(JSON.stringify({ label: r.label, complete: r.complete, functional: r.workload?.functionalContractsPass, stocks: r.workload?.stocks, cpuMs: r.aggregateCpuMs }));
    if (r.infrastructureFailure || (!loaded && r.workload?.crypto.failures > 0)) {
      infrastructureBlocker = true;
      writeFileSync(join(output, 'results.json'), JSON.stringify({ config, results, pairs, complete: false, infrastructureBlocker: true, unexecuted: 'Remaining scheduled-cases.json entries are INCOMPLETE; no repeated run of a broken harness.', productionReady: false }, null, 2));
      break matrix;
    }
  }
  pairs.push({ profile: spec.profile, repeat, complete: runs.loaded.complete && runs.control.complete,
    crypto: runs.loaded.complete && runs.control.complete ? compareCrypto(runs.control.cryptoRecords, runs.loaded.cryptoRecords, { expectedOperations: Math.ceil(seconds * 1000 / 250) * 14 }) : null });
  writeFileSync(join(output, 'results.json'), JSON.stringify({ config, results, pairs, complete: results.length === profiles.length * MODEL.repeats * 2 && results.every(r => r.complete), productionReady: false }, null, 2));
}
// Adjacent OFF/ON pairs alternate order. Same workload; no altered deadline/budget.
const overhead = [];
for (let repeat = 0; !infrastructureBlocker && repeat < MODEL.repeats; repeat++) {
  const pair = {};
  for (const diagnostics of repeat % 2 ? [true, false] : [false, true])
    pair[diagnostics ? 'on' : 'off'] = await one({ profile: 'overhead-20-shared', viewers: 20, pattern: 'shared' }, repeat, true, diagnostics);
  overhead.push({ repeat, ...pair });
}
writeFileSync(join(output, 'instrumentation-overhead.json'), JSON.stringify({ diagnostic: true, overhead, note: 'Adjacent matched full workloads, alternating OFF/ON order; report CPU/attempt, throughput, all-attempt latency, errors and memory. These B diagnostic measurements never replace uninstrumented A acceptance.' }, null, 2));
if (infrastructureBlocker || results.some(r => !r.complete) || overhead.some(p => !p.on.complete || !p.off.complete)) process.exitCode = 1;
