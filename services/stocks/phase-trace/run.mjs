// Opt-in, synthetic local/CI diagnosis only. This is never a capacity acceptance run.
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, readlinkSync, realpathSync, statSync, writeFileSync } from 'node:fs';
import { createServer as createSocketServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

export const REVISIONS = Object.freeze({
  before: 'de565eac17a8477e0dd4c50c2dc936b2bea21990',
  after: '010eb8716755c48aeb62baaf8602fb7ff837859f',
});
export const WORKLOAD = Object.freeze({users: 50, pattern: 'mixed', seconds: 30, cadenceMs: 2000, deadlineMs: 3000, instruments: 20, mode: 'global', cold: false});
export const LIMITS = Object.freeze({cpuVcpu: .05, memoryBytes: 268435456, readBps: 1048576, writeBps: 131072, pids: 32});
const here = dirname(fileURLToPath(import.meta.url));
const sourcePaths = ['services/stocks', 'services/stocks-global', 'services/stocks-simulator'];
const hash = value => createHash('sha256').update(value).digest('hex');
const now = () => Number(process.hrtime.bigint()) / 1e6;
const sleep = ms => new Promise(ok => setTimeout(ok, ms));
const writeJson = (path, value) => writeFileSync(path, JSON.stringify(value, null, 2) + '\n');
const cleanEnvironment = () => Object.fromEntries(['PATH', 'HOME', 'TMPDIR', 'LANG', 'LC_ALL'].filter(key => process.env[key] !== undefined).map(key => [key, process.env[key]]));

// Three repetitions cannot balance each revision perfectly on its own. The six
// within-revision OFF/ON pairs balance three OFF-first and three ON-first overall.
export function buildSchedule() {
  const blocks = [
    [['before', false], ['before', true], ['after', true], ['after', false]],
    [['after', false], ['after', true], ['before', true], ['before', false]],
    [['before', false], ['before', true], ['after', true], ['after', false]],
  ];
  return blocks.flatMap((block, repeat) => block.map(([variant, traceEnabled]) => ({variant, traceEnabled, repeat})))
    .map((run, order) => ({...run, order, runId: `${String(order + 1).padStart(2, '0')}-${run.variant}-r${run.repeat}-${run.traceEnabled ? 'on' : 'off'}`}));
}

function command(binary, args, options = {}) {
  const result = spawnSync(binary, args, {encoding: 'utf8', timeout: 120000, maxBuffer: 32 * 1024 * 1024, env: cleanEnvironment(), ...options});
  if (result.error || result.status !== 0) throw new Error(`DIAGNOSTIC_TOOL_FAILED:${binary}:${args[0] ?? 'none'}:${result.status ?? result.error?.code ?? 'unknown'}`);
  return result.stdout;
}
const docker = args => command('docker', args).trim();
function timeNamespace(path) {
  try {return readlinkSync(path);} catch (error) {
    if (error.code !== 'EACCES' && error.code !== 'EPERM') throw error;
    // GitHub's runner UID may differ from the container's node UID. Read only
    // this kernel namespace link; no container command or state is changed.
    return command('sudo', ['-n', 'readlink', path]).trim();
  }
}

function hashes(root) {
  const files = {};
  const visit = directory => {
    for (const entry of readdirSync(directory, {withFileTypes: true}).sort((a, b) => a.name.localeCompare(b.name))) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) visit(path);
      else if (entry.isFile()) files[relative(root, path).split(sep).join('/')] = hash(readFileSync(path));
      else throw new Error('Source archives must contain only ordinary files and directories');
    }
  };
  for (const path of sourcePaths) visit(join(root, path));
  return files;
}

export function validateCgroup(values) {
  if (values.cpuMax.trim() !== '5000 100000') throw new Error('CPU quota differs from the original 0.05 vCPU budget');
  if (Number(values.memoryMax.trim()) !== LIMITS.memoryBytes) throw new Error('Memory budget differs from 256 MiB');
  if (!values.ioMax.split('\n').some(line => /\brbps=1048576\b/.test(line) && /\bwbps=131072\b/.test(line))) throw new Error('Original read/write limits are not present on the container cgroup');
}

function observeCgroup(pid) {
  const membership = readFileSync(`/proc/${pid}/cgroup`, 'utf8').split('\n').find(line => line.startsWith('0::'))?.slice(3);
  if (!membership || !membership.startsWith('/')) throw new Error('A readable unified cgroup v2 is required');
  const path = resolve('/sys/fs/cgroup', '.' + membership);
  if (!path.startsWith('/sys/fs/cgroup/')) throw new Error('Unexpected cgroup path');
  const read = file => readFileSync(join(path, file), 'utf8');
  const bounds = {cpuMax: read('cpu.max'), memoryMax: read('memory.max'), ioMax: read('io.max'), cpusetCpusEffective: read('cpuset.cpus.effective')};
  if (Buffer.byteLength(JSON.stringify(bounds)) > 16384) throw new Error('Cgroup bounds metadata exceeded its limit');
  validateCgroup(bounds);
  const keyValues = (text, allowed) => Object.fromEntries(text.trim().split('\n').map(line => line.trim().split(/\s+/)).filter(([key, value]) => allowed.includes(key) && /^\d+$/.test(value ?? '')).map(([key, value]) => [key, Number(value)]));
  const pressure = text => Object.fromEntries(text.trim().split('\n').map(line => line.trim().split(/\s+/)).filter(([kind]) => ['some', 'full'].includes(kind)).map(([kind, ...fields]) => [kind, Object.fromEntries(fields.map(field => field.split('=')).filter(([key, value]) => ['avg10', 'avg60', 'avg300', 'total'].includes(key) && /^\d+(\.\d+)?$/.test(value ?? '')).map(([key, value]) => [key, Number(value)]))]));
  const io = text => text.trim().split('\n').filter(Boolean).map(line => line.trim().split(/\s+/)).filter(([device]) => /^\d+:\d+$/.test(device)).map(([device, ...fields]) => ({device, ...Object.fromEntries(fields.map(field => field.split('=')).filter(([key, value]) => ['rbytes', 'wbytes', 'rios', 'wios', 'dbytes', 'dios'].includes(key) && /^\d+$/.test(value ?? '')).map(([key, value]) => [key, Number(value)]))}));
  const result = {schemaVersion: 1, clock: 'process.hrtime milliseconds; same Linux host monotonic clock as traces', requestedIntervalMs: 250, maxSamples: 1000, maxBytes: 1048576, maxSampleBytes: 1048576 - 65536, maxEntryBytes: 8192, sampleBytes: 0, droppedSamples: 0, sampleErrors: 0, bounds, samples: [], workload: {}};
  const sample = () => {
    if (result.samples.length >= result.maxSamples) { result.droppedSamples++; return; }
    const monoMs = now(), wallMs = Date.now();
    try {
      const entry = {monoMs, wallMs, cpuStat: keyValues(read('cpu.stat'), ['usage_usec', 'user_usec', 'system_usec', 'nr_periods', 'nr_throttled', 'throttled_usec', 'nr_bursts', 'burst_usec']), ioStat: io(read('io.stat')), memoryCurrent: Number(read('memory.current').trim()), memoryEvents: keyValues(read('memory.events'), ['low', 'high', 'max', 'oom', 'oom_kill', 'oom_group_kill']), cpuPressure: pressure(read('cpu.pressure')), ioPressure: pressure(read('io.pressure')), sampleEndMonoMs: now()};
      const bytes = Buffer.byteLength(JSON.stringify(entry)) + 1;
      if (bytes > result.maxEntryBytes || result.sampleBytes + bytes > result.maxSampleBytes) {result.droppedSamples++; return;}
      result.sampleBytes += bytes; result.samples.push(entry);
    } catch { result.sampleErrors++; }
  };
  sample();
  const timer = setInterval(sample, result.requestedIntervalMs);
  return {sample, boundary(label) {sample(); result.workload[label] = result.samples.at(-1) ?? null;}, stop() {
    clearInterval(timer); sample();
    result.initial = result.samples[0] ?? null;
    result.final = result.samples.at(-1) ?? null;
    result.maxObservedIntervalMs = result.samples.reduce((max, entry, index) => index ? Math.max(max, entry.monoMs - result.samples[index - 1].monoMs) : max, 0);
    return result;
  }};
}

async function jsonFetch(url, options = {}) {
  const response = await fetch(url, {...options, signal: AbortSignal.timeout(10000)});
  if (!response.ok) throw new Error(`Fixture control HTTP ${response.status}`);
  return response.json();
}

async function waitReady() {
  const deadline = now() + 60000;
  while (now() < deadline) {
    try { if ((await fetch('http://127.0.0.1:8092/__stocks_global/health', {signal: AbortSignal.timeout(1000)})).ok) return; } catch {}
    await sleep(250);
  }
  throw new Error('Fixture did not become healthy within 60 seconds');
}

async function assertPortsFree() {
  const servers = [];
  try {
    for (const port of [8092, 8093]) {
      const server = createSocketServer(); servers.push(server);
      await new Promise((ok, fail) => {server.once('error', () => fail(new Error('Diagnostic loopback port already occupied'))); server.listen(port, '127.0.0.1', ok);});
    }
  } finally {await Promise.all(servers.filter(server => server.listening).map(server => new Promise(ok => server.close(ok))));}
}

async function reader(root, traceDir, traceEnabled, clientCpu) {
  return new Promise((ok, fail) => {
    const child = spawn('taskset', ['-c', clientCpu, process.execPath, join(root, 'services/stocks/realistic-readers.mjs')], {env: {...cleanEnvironment(), STOCK_REALISTIC_URL: 'http://127.0.0.1:8092', STOCK_REALISTIC_USERS: '50', STOCK_REALISTIC_PATTERN: 'mixed', STOCK_REALISTIC_SECONDS: '30', STOCK_REALISTIC_CADENCE_MS: '2000', STOCK_REALISTIC_MODE: 'global', STOCK_REALISTIC_COLD: 'false', STOCK_REALISTIC_INSTRUMENTS: '20', STOCKS_PHASE_TRACE: traceEnabled ? '1' : '0', STOCKS_PHASE_TRACE_DIR: traceDir, STOCKS_PHASE_TRACE_ROLE: 'client', STOCKS_PHASE_TRACE_FIXTURE: 'isolated-issue505'}, stdio: ['ignore', 'pipe', 'pipe']});
    let stdout = '', stderr = '', finished = false;
    const finish = (error, value) => { if (finished) return; finished = true; clearTimeout(timer); error ? fail(error) : ok(value); };
    const timer = setTimeout(() => {child.kill('SIGKILL'); finish(new Error('Diagnostic reader exceeded its 90 second watchdog'));}, 90000);
    child.stdout.on('data', data => {stdout += data; if (stdout.length > 1024 * 1024) {child.kill('SIGKILL'); finish(new Error('Reader output exceeded its bound'));}});
    child.stderr.on('data', data => {stderr = (stderr + data).slice(-16000);});
    child.on('error', error => finish(error));
    child.on('close', code => {
      if (code !== 0) return finish(new Error(`DIAGNOSTIC_READER_EXIT:${Number.isInteger(code) ? code : 'signal'}`));
      try {finish(null, {value: JSON.parse(stdout.trim()), stderrBytes: Buffer.byteLength(stderr)});} catch {finish(new Error('Reader did not produce its original JSON result'));}
    });
  });
}

export async function main() {
  const output = resolve(process.env.STOCK_PHASE_TRACE_OUTPUT ?? '.ci-output/stocks-phase-trace');
  const disk = process.env.STOCK_PHASE_TRACE_DISK, device = process.env.STOCK_BENCH_DEVICE;
  const cpu = process.env.BENCH_CPU, clientCpu = process.env.LOAD_CPU;
  if (process.platform !== 'linux' || process.version !== 'v24.21.0' || !disk || !device || !/^\d+$/.test(cpu ?? '') || !/^\d+$/.test(clientCpu ?? '') || Number(cpu) === Number(clientCpu)) throw new Error('Linux Node 24.21.0, a disposable disk, verified block device and two distinct CPU IDs are required');
  if (!isAbsolute(disk) || !isAbsolute(device) || !statSync(device).isBlockDevice()) throw new Error('A real absolute block device and disposable absolute disk path are required');
  if (existsSync(join(output, 'manifest.json'))) throw new Error('Refusing to overwrite an existing diagnostic manifest');
  mkdirSync(output, {recursive: true}); mkdirSync(disk, {recursive: true});
  // Keep the observer and reader off the server CPU. No extra sampler runs inside its quota.
  command('taskset', ['-pc', clientCpu, String(process.pid)]);
  const work = mkdtempSync(join(tmpdir(), 'stocks-phase-trace-'));
  const diskRoot = mkdtempSync(join(resolve(disk), 'joined-trace-'));
  const repo = resolve(here, '../../..');
  const mountedDevice = command('findmnt', ['-n', '-o', 'MAJ:MIN', '-T', diskRoot]).trim();
  const blockRows = command('lsblk', ['-nrpo', 'NAME,MAJ:MIN']).trim().split('\n').map(line => line.trim().split(/\s+/));
  const backingDevice = blockRows.find(([, majorMinor]) => majorMinor === mountedDevice)?.[0];
  if (!backingDevice || !command('lsblk', ['-snrpo', 'NAME', backingDevice]).trim().split('\n').some(path => realpathSync(path.trim()) === realpathSync(device))) throw new Error('Configured block device does not back the disposable bind filesystem');
  await assertPortsFree();
  const manifest = {schemaVersion: 1, diagnosticOnly: true, acceptance: false, revisions: REVISIONS, workload: WORKLOAD, limits: LIMITS, cpu, clientCpu, device, deviceProof: {mountMajorMinor: mountedDevice, backingDevice, configuredDevice: realpathSync(device)}, hostTimeNamespace: timeNamespace('/proc/self/ns/time'), observerIntervalMs: 250, topology: 'Original realistic fixture: host-network loopback server container, separate host reader pinned to another CPU', fixture: true, externalApiCalls: 0, traceOffMode: 'Same instrumented shadow and numeric request header; trace buffers, ALS and phase instrumentation disabled', overheadLimits: null, startedAt: new Date().toISOString(), startedMonoMs: now(), sources: {}, diagnosticToolHashes: Object.fromEntries(readdirSync(here).filter(file => /\.(mjs|json)$/.test(file) || file === 'Dockerfile').sort().map(file => [file, hash(readFileSync(join(here, file)))])), runs: [], complete: false};
  const persist = () => {const value = JSON.stringify(manifest, null, 2) + '\n'; if (Buffer.byteLength(value) > 65536) throw new Error('Diagnostic manifest exceeded 64 KiB'); writeFileSync(join(output, 'manifest.json'), value);};
  persist();
  const contexts = {};
  const images = [];
  const bounded = (directory, network = 'host') => ['--cpus', '.05', '--cpuset-cpus', cpu, '--memory', '256m', '--memory-swap', '256m', '--pids-limit', '32', '--read-only', '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges', '--device-read-bps', `${device}:1048576`, '--device-write-bps', `${device}:131072`, '--mount', `type=bind,src=${directory},dst=/data`, '--network', network];
  let activeContainer;
  try {
    for (const [variant, revision] of Object.entries(REVISIONS)) {
      if (command('git', ['rev-parse', `${revision}^{commit}`], {cwd: repo}).trim() !== revision) throw new Error('Exact revision unavailable');
      const original = join(work, `${variant}-original`), shadow = join(work, `${variant}-shadow`);
      mkdirSync(original);
      const archive = command('git', ['archive', '--format=tar', revision, ...sourcePaths], {cwd: repo, encoding: null});
      command('tar', ['-xf', '-', '-C', original], {input: archive});
      const originalHashes = hashes(original);
      command(process.execPath, [join(here, 'instrument.mjs'), '--source', original, '--out', shadow]);
      // Build instructions are identical to the original fixture, with no install, migrations or network code.
      copyFileSync(join(here, 'Dockerfile'), join(shadow, 'services/stocks/phase-trace/Dockerfile'));
      if (hash(readFileSync(join(original, 'services/stocks/io-proof.mjs'))) !== hash(readFileSync(join(shadow, 'services/stocks/io-proof.mjs')))) throw new Error('Original I/O proof script changed in diagnostic shadow');
      const shadowHashes = hashes(shadow);
      const hashPath = join(output, `${variant}-source-hashes.json`);
      const instrumentationManifest = JSON.parse(readFileSync(join(shadow, 'source-manifest.json'), 'utf8'));
      if (instrumentationManifest.sourceRevision !== revision) throw new Error('Transformed shadow revision differs from exact archive');
      writeJson(hashPath, {revision, gitTree: command('git', ['rev-parse', `${revision}^{tree}`], {cwd: repo}).trim(), archiveSha256: hash(archive), originalHashes, shadowHashes, instrumentationManifest});
      const image = `voltex-stocks-phase-${process.pid}-${variant}`;
      const buildLog = docker(['build', '--network', 'none', '-t', image, '-f', join(shadow, 'services/stocks/phase-trace/Dockerfile'), shadow]);
      writeFileSync(join(output, `${variant}-build.log`), buildLog + '\n');
      images.push(image);
      contexts[variant] = {root: shadow, image};
      manifest.sources[variant] = {revision, imageId: docker(['image', 'inspect', '--format', '{{.Id}}', image]), sourceHashesPath: relative(output, hashPath), workloadHash: hash(readFileSync(join(original, 'services/stocks/realistic-readers.mjs'))), fixtureHash: hash(readFileSync(join(original, 'services/stocks/realistic-global-fixture.mjs')))};
      persist();
    }
    if (manifest.sources.before.workloadHash !== manifest.sources.after.workloadHash || manifest.sources.before.fixtureHash !== manifest.sources.after.fixtureHash) throw new Error('Exact revisions have different original workloads or fixtures; paired diagnostic invalid');
    const probe = join(diskRoot, 'probe'); mkdirSync(probe); chmodSync(probe, 0o777);
    activeContainer = `stocks-phase-${process.pid}-probe`;
    const proof = JSON.parse(docker(['run', '--rm', '--name', activeContainer, ...bounded(probe, 'none'), '-e', 'STOCKS_PHASE_TRACE=0', '-e', 'STOCKS_PHASE_TRACE_FIXTURE=isolated-issue505', contexts.after.image, 'node', 'io-proof.mjs']));
    activeContainer = undefined;
    writeJson(join(output, 'io-proof.json'), proof); manifest.ioProofPath = 'io-proof.json'; persist();
    for (const entry of buildSchedule()) {
      const runDir = join(output, entry.runId), dataDir = join(diskRoot, entry.runId), traceDir = join(dataDir, 'trace');
      mkdirSync(runDir); mkdirSync(traceDir, {recursive: true}); chmodSync(dataDir, 0o777); chmodSync(traceDir, 0o777);
      const name = `stocks-phase-${process.pid}-${entry.order}`;
      const run = {...entry, revision: REVISIONS[entry.variant], diagnosticOnly: true, acceptance: false, workloadSignature: hash(JSON.stringify(WORKLOAD)), resourceSignature: hash(JSON.stringify({...LIMITS, cpu, clientCpu, device})), startedMonoMs: now(), startedAt: new Date().toISOString(), readerPath: `${entry.runId}/reader.json`, metricsPath: `${entry.runId}/metrics.json`, cgroupPath: `${entry.runId}/cgroup.json`, traceDir: `${entry.runId}/trace`, sourceHashesPath: manifest.sources[entry.variant].sourceHashesPath, events: [], complete: false};
      manifest.runs.push(run); persist();
      let observer, cgroup;
      const event = name => run.events.push({name, monoMs: now(), wallMs: Date.now()});
      try {
        event('containerStart'); activeContainer = name;
        docker(['run', '-d', '--name', name, ...bounded(dataDir), '-e', 'STOCK_REALISTIC_DB=/data/accounts.sqlite', '-e', `STOCKS_PHASE_TRACE=${entry.traceEnabled ? '1' : '0'}`, '-e', 'STOCKS_PHASE_TRACE_DIR=/data/trace', '-e', 'STOCKS_PHASE_TRACE_FIXTURE=isolated-issue505', contexts[entry.variant].image]);
        const pid = Number(docker(['inspect', '--format', '{{.State.Pid}}', name]));
        run.containerTimeNamespace = timeNamespace(`/proc/${pid}/ns/time`);
        run.commonMonotonicDomain = manifest.hostTimeNamespace === run.containerTimeNamespace;
        if (!run.commonMonotonicDomain) throw new Error('Host and server do not share the verified Linux monotonic time namespace');
        observer = observeCgroup(pid);
        await waitReady(); event('ready');
        await jsonFetch('http://127.0.0.1:8093/reset', {method: 'POST'}); event('metricsReset');
        observer.boundary('start'); event('readerStart');
        const result = await reader(contexts[entry.variant].root, traceDir, entry.traceEnabled, clientCpu);
        event('readerEnd'); observer.boundary('end'); writeJson(join(runDir, 'reader.json'), result.value);
        run.readerStderrBytes = result.stderrBytes;
        const metrics = await jsonFetch('http://127.0.0.1:8093/metrics'); event('metricsRead');
        writeJson(join(runDir, 'metrics.json'), metrics);
        if (result.value.externalApiCalls !== 0 || metrics.externalApiCalls !== 0 || result.value.fixture !== true || metrics.fixture !== true) throw new Error('Offline fixture isolation was not confirmed');
        observer.sample(); cgroup = observer.stop(); observer = null;
        run.flushAccounting = 'Cgroup workload start/end precede trace serialization and container stop. Flush cost is outside the workload and is not included in its CPU/I/O comparison.';
        event('containerStop'); docker(['stop', '-t', '15', name]); event('containerStopped');
        run.containerExitCode = Number(docker(['inspect', '--format', '{{.State.ExitCode}}', name]));
        mkdirSync(join(runDir, 'trace'));
        const traceFiles = readdirSync(traceDir);
        for (const file of traceFiles) {
          if (!/^(main|worker|client)(\.bin|\.meta\.json)$/.test(file) && file !== 'meta.json') throw new Error('Unexpected diagnostic trace filename');
          const maximumBytes = file.endsWith('.json') ? 65536 : (file.startsWith('client') ? 2 : 4) * 1024 * 1024;
          if (statSync(join(traceDir, file)).size > maximumBytes) throw new Error('Trace file exceeded its bound');
          copyFileSync(join(traceDir, file), join(runDir, 'trace', file));
        }
        run.traceRoles = entry.traceEnabled ? Object.fromEntries(['main', 'worker', 'client'].map(role => {
          const present = traceFiles.includes(role + '.bin') && traceFiles.includes(role + '.meta.json');
          if (!present) return [role, {present: false, complete: false}];
          const metadata = JSON.parse(readFileSync(join(traceDir, role + '.meta.json'), 'utf8'));
          return [role, {present: true, count: metadata.count, dropped: metadata.dropped, writerStopped: metadata.writerStopped, complete: metadata.complete === true}];
        })) : {};
        run.traceComplete = entry.traceEnabled ? Object.values(run.traceRoles).every(role => role.complete) : traceFiles.length === 0;
        run.complete = run.containerExitCode === 0 && run.traceComplete && cgroup.droppedSamples === 0 && cgroup.sampleErrors === 0;
      } finally {
        if (observer) cgroup = observer.stop();
        if (cgroup) {
          const encoded = JSON.stringify(cgroup);
          if (Buffer.byteLength(encoded) > cgroup.maxBytes) throw new Error('Encoded observer data exceeded 1 MiB');
          writeFileSync(join(runDir, 'cgroup.json'), encoded);
        }
        if (activeContainer) {try {docker(['rm', '-f', activeContainer]);} finally {activeContainer = undefined;}}
        run.endedMonoMs = now(); run.endedAt = new Date().toISOString(); persist();
      }
      console.log(JSON.stringify({runId: run.runId, diagnosticOnly: true, acceptance: false, complete: run.complete}));
    }
    manifest.complete = manifest.runs.length === 12 && manifest.runs.every(run => run.complete);
  } catch (error) {
    manifest.error = {name: error.name, message: String(error.message).slice(0, 16000)};
    throw error;
  } finally {
    manifest.endedMonoMs = now(); manifest.endedAt = new Date().toISOString(); persist();
    if (activeContainer) {try {docker(['rm', '-f', activeContainer]);} catch {}}
    // Only images created by this diagnostic invocation; bind data and source hashes are retained.
    for (const image of images) {try {docker(['image', 'rm', image]);} catch {}}
  }
  console.log(JSON.stringify({output, diagnosticOnly: true, acceptance: false, runs: manifest.runs.length, complete: manifest.complete}));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => {console.error(error.message); process.exitCode = 1;});
}
