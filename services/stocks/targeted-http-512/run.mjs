// Linux Docker, disposable fixtures only. No invocation occurs merely by importing.
import { execFileSync, spawn } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';
import { schedule, LIMITS, validateLimits, descriptor } from './plan.mjs';
import { hash, ROOTS, prepare } from './source.mjs';
import { summarize, delta, accountDeltas, drained, journalIssues, traceIssues, quoteIssues, preflightGate, kernelCounters, ioCounters, finite } from './metrics.mjs';
const here = dirname(fileURLToPath(import.meta.url)), root = resolve(here, '../../..'), sleep = ms => new Promise(ok => setTimeout(ok, ms));
const json = (path, value) => writeFileSync(path, JSON.stringify(value, null, 2));
function cgroup(pid) {
  const line = readFileSync(`/proc/${pid}/cgroup`, 'utf8').split('\n').find(row => row.startsWith('0::'));
  if (!line || line.includes('..')) throw Error('CGROUP_V2_REQUIRED');
  const path = '/sys/fs/cgroup' + line.slice(3), read = file => readFileSync(join(path, file), 'utf8');
  return { path, cpuMax: read('cpu.max'), memoryMax: read('memory.max'), swapMax: read('memory.swap.max'), ioMax: read('io.max'), cpuStat: read('cpu.stat'), ioStat: read('io.stat'), memoryPeak: read('memory.peak'), memoryEvents: read('memory.events'), cpuset: read('cpuset.cpus.effective') };
}
function cpuUse(raw) { const m = /^usage_usec (\d+)$/m.exec(raw || ''); return m && Number.isSafeInteger(Number(m[1])) ? Number(m[1]) / 1000 : null; }
export async function main() {
  if (process.platform !== 'linux' || process.env.TARGETED_HTTP_512_APPROVED !== 'true') throw Error('LINUX_EXPLICIT_REVIEWED_PLAN_REQUIRED');
  const sha = process.env.TARGETED_SOURCE_SHA, cpu = process.env.BENCH_CPU, loadCpu = process.env.LOAD_CPU, disk = resolve(process.env.STOCK_REALISTIC_DISK || ''), device = process.env.STOCK_BENCH_DEVICE;
  if (!/^[a-f0-9]{40}$/.test(sha || '') || !/^\d+$/.test(cpu || '') || !/^\d+$/.test(loadCpu || '') || cpu === loadCpu || !device?.startsWith('/dev/') || !statSync(device).isBlockDevice()) throw Error('VERIFIED_CPU_DISK_SHA_REQUIRED');
  const out = resolve(process.env.TARGETED_OUTPUT || '.ci-output/stocks-targeted-http512'); mkdirSync(out, { recursive: true }); if (readdirSync(out).length) throw Error('OUTPUT_NOT_EMPTY');
  const env = { PATH: '/usr/bin:/bin', LANG: 'C.UTF-8', DOCKER_HOST: 'unix:///var/run/docker.sock', DOCKER_CONFIG: join(out, 'docker-config') }; mkdirSync(env.DOCKER_CONFIG);
  const command = (bin, args, options = {}) => execFileSync(bin, args, { cwd: root, env, encoding: 'utf8', timeout: 120000, maxBuffer: 8 * 1024 * 1024, ...options }).trim();
  const git = args => command('/usr/bin/git', args), docker = args => command('/usr/bin/docker', args);
  if (git(['rev-parse', 'HEAD']) !== sha || git(['status', '--porcelain', '--', ...ROOTS])) throw Error('SOURCE_NOT_EXACT_CLEAN_HEAD');
  const mounted = command('/usr/bin/findmnt', ['-n', '-o', 'MAJ:MIN', '-T', disk]);
  const devices = JSON.parse(command('/usr/bin/lsblk', ['-J', '-p', '-o', 'NAME,MAJ:MIN,PKNAME']));
  const flattened = []; const flatten = rows => { for (const row of rows) { flattened.push(row); flatten(row.children || []); } }; flatten(devices.blockdevices);
  let backing = flattened.find(row => row['maj:min'] === mounted), chain = [];
  for (let n = 0; backing && n < 8; n++) { chain.push(backing.name); if (backing.name === device) break; backing = flattened.find(row => row.name === backing.pkname || row.name === '/dev/' + backing.pkname); }
  if (chain.at(-1) !== device) throw Error('IO_DEVICE_NOT_MOUNT_BACKING'); const deviceNumber = backing['maj:min'];
  const runId = 'targeted512-' + randomBytes(6).toString('hex'), base = join(disk, runId); mkdirSync(base, { mode: 0o755 });
  const source = join(base, 'source'); mkdirSync(source); const archive = join(base, 'source.tar');
  git(['archive', '--format=tar', '--output=' + archive, sha, ...ROOTS]); command('/usr/bin/tar', ['-xf', archive, '-C', source]);
  const reviewed = JSON.parse(readFileSync(join(source, 'services/stocks/targeted-http-512/reviewed-sources.json'), 'utf8'));
  const report = { sourceSha: sha, startedUtc: new Date().toISOString(), complete: false, capacityAcceptance: 'NOT_EVALUATED', limits: LIMITS,
    authorityLimits: { cpu: .5, memory: 268435456, swap: 0, cpuset: loadCpu }, clientLimits: { cpu: .5, memory: 268435456, swap: 0, cpuset: loadCpu },
    serviceCpu: cpu, loadCpu, networkIsolation:'service network=none; authority/client share service network namespace; no external interface or route', measurementScope:'whole service process CPU includes matched fixture instrumentation; authority cgroup includes bounded snapshot probe processes; cold registration and fixture trades excluded setup', backingDevice: { mounted, chain, device, deviceNumber }, reviewed, schedule: schedule(), runs: schedule().map((entry, index) => ({ ...entry, index, status: 'INCOMPLETE', reason: 'Not started' })) };
  const save = () => json(join(out, 'results.json'), report); save();
  const images = new Map(), active = new Set(); let authorityContainer=null, serviceContainer=null;
  const control = async (port, nonce, path) => JSON.parse(docker(['exec',authorityContainer,'node','services/stocks/targeted-http-512/probe.mjs',String(port),path]));
  const wait = async (port, nonce) => { const end = performance.now() + 20000; do { try { return await control(port, nonce, '/metrics'); } catch { await sleep(100); } } while (performance.now() < end); throw Error('STARTUP_DEADLINE'); };
  const inspect = name => JSON.parse(docker(['inspect', name]))[0];
  const common = (name, quota, pin) => ['--name', name, '--label', 'voltex.targeted.run=' + runId, '--read-only', '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges', '--pids-limit', '32', '--cpus', String(quota), '--cpuset-cpus', pin, '--memory', '256m', '--memory-swap', '256m', '--tmpfs', '/tmp:size=16m'];
  const runClient = async (image, name, variables) => {
    const args = ['run', ...common(name, .5, loadCpu), '--network','container:'+serviceContainer, ...Object.entries(variables).flatMap(([k, v]) => ['-e', k + '=' + v]), image, 'node', 'services/stocks/targeted-http-512/client.mjs']; active.add(name);
    return new Promise((ok, fail) => { const child = spawn('/usr/bin/docker', args, { env, stdio: ['ignore', 'pipe', 'pipe'] }); let stdout = '', stderr = '', overflow = false;
      const preserve=()=>{writeFileSync(join(out,name+'-stdout.json'),stdout);writeFileSync(join(out,name+'-stderr.log'),stderr);};
      const timer = setTimeout(() => { child.kill('SIGTERM'); try { preserve(); fail(Error('CLIENT_WATCHDOG')); } catch(error) { fail(error); } }, 110000);
      child.stdout.on('data', value => { stdout += value; if (stdout.length > 8 * 1024 * 1024) { overflow = true; child.kill('SIGTERM'); } }); child.stderr.on('data', value => { stderr += value; if (stderr.length > 1024 * 1024) { overflow = true; child.kill('SIGTERM'); } });
      child.once('error', e => { clearTimeout(timer); try { preserve(); fail(e); } catch(error) { fail(error); } }); child.once('close', code => { clearTimeout(timer); try { preserve(); const result = JSON.parse(stdout); ok({ exitCode: code, result, stderr, overflow }); } catch (e) { fail(Error('CLIENT_RESULT_INVALID: ' + e.message)); } });
    });
  };
  const stopped = name => { if (!active.has(name)) return; const state = inspect(name); if (state.Config.Labels?.['voltex.targeted.run'] !== runId) throw Error('CONTAINER_OWNERSHIP_MISMATCH'); docker(['stop', '-t', '8', name]); writeFileSync(join(out, name + '.log'), docker(['logs', name])); docker(['rm', name]); active.delete(name); };
  try {
    // All source hashes are verified and every counterfactual built BEFORE any measured pair.
    for (const profile of ['projection20', 'projection50', 'wallet', 'history', 'identity']) for (const variant of ['control', 'target']) {
      const tree = join(base, profile + '-' + variant), manifest = prepare(source, tree, profile, variant, sha, reviewed), tag = runId + '-' + profile + '-' + variant;
      json(join(out, tag + '-source.json'), manifest);
      writeFileSync(join(out, tag + '-build.log'), docker(['build', '--network', 'none', '--build-arg', 'SOURCE_SHA=' + sha, '--build-arg', 'TREE_SHA=' + manifest.measuredTreeHash, '-f', join(tree, 'services/stocks/targeted-http-512/Dockerfile'), '-t', tag, tree]));
      const image = JSON.parse(docker(['image', 'inspect', tag]))[0]; if (image.Config.Labels?.['org.opencontainers.image.revision'] !== sha || image.Config.Labels?.['voltex.targeted.tree'] !== manifest.measuredTreeHash) throw Error('IMAGE_SOURCE_MISMATCH');
      images.set(profile + '-' + variant, image.Id); json(join(out, tag + '-image.json'), { id: image.Id, repoDigests: image.RepoDigests, source: manifest.measuredTreeHash });
    }
    report.preflight = { profile: 'projection20', variant: 'target', repeat: -1, index: 30, preflight: true, status: 'INCOMPLETE' };
    for (const row of [report.preflight, ...report.runs]) {
      const prefix = runId + '-' + row.index, image = images.get(row.profile + '-' + row.variant), nonce = randomBytes(16).toString('hex');
      const port = 28000 + row.index * 3, controlPort = port + 1, authPort = port + 2, data = join(base, 'data-' + row.index); mkdirSync(data, { mode: 0o777 }); command('/usr/bin/chmod', ['777', data]);
      const variables = { TARGETED_PORT: port, TARGETED_CONTROL_PORT: controlPort, TARGETED_AUTH_PORT: authPort, TARGETED_NONCE: nonce, TARGETED_PROFILE: row.profile, TARGETED_VARIANT: row.variant };
      row.startedUtc = new Date().toISOString(); delete row.reason; save();
      try {
        const authName = prefix + '-authority', serviceName = prefix + '-service';
        serviceContainer=serviceName;authorityContainer=authName;
        active.add(serviceName);docker(['run', '-d', ...common(serviceName, .05, cpu),'--network','none', '--device-read-bps', device + ':1048576', '--device-write-bps', device + ':131072', '--mount', `type=bind,src=${data},dst=/data`, ...Object.entries({ ...variables, TARGETED_DISPOSABLE: 'true' }).flatMap(([k, v]) => ['-e', k + '=' + v]), image]);
        active.add(authName);docker(['run', '-d', ...common(authName, .5, loadCpu),'--network','container:'+serviceName, ...Object.entries({ ...variables, TARGETED_LARGE_ME: row.profile === 'identity' && row.variant === 'target' }).flatMap(([k, v]) => ['-e', k + '=' + v]), image, 'node', 'services/stocks/targeted-http-512/authority.mjs']); await wait(authPort, nonce); await wait(controlPort, nonce);
        const serviceState = inspect(serviceName), authorityState = inspect(authName); row.resourceProof = cgroup(serviceState.State.Pid); validateLimits(row.resourceProof, deviceNumber);
        if(serviceState.HostConfig.NetworkMode!=='none'||!['container:'+serviceState.Id,'container:'+serviceName].includes(authorityState.HostConfig.NetworkMode))throw Error('NETWORK_ISOLATION_MISSING');
        row.networkProof={service:serviceState.HostConfig.NetworkMode,authority:authorityState.HostConfig.NetworkMode,serviceId:serviceState.Id};
        if (row.resourceProof.cpuset.trim() !== cpu) throw Error('SERVICE_CPU_PLACEMENT_MISMATCH');
        row.authorityResourceProof = cgroup(authorityState.State.Pid);
        if (row.authorityResourceProof.cpuMax.trim() !== '50000 100000' || Number(row.authorityResourceProof.memoryMax) !== 268435456 || Number(row.authorityResourceProof.swapMax) !== 0 || row.authorityResourceProof.cpuset.trim() !== loadCpu) throw Error('AUTHORITY_LIMITS_MISSING');
        row.setup = await runClient(image, prefix + '-setup', { ...variables, TARGETED_PHASE: row.preflight ? 'preflight' : 'setup' }); if (row.setup.exitCode !== 0 || row.setup.result.setupOnly !== true) throw Error('SETUP_FAILED');
        if (row.preflight) { if (row.setup.result.pass !== true) throw Error('CHEAP_PREFLIGHT_FAILED'); row.status = 'PASS'; continue; }
        row.ledgerBefore = await control(controlPort, nonce, '/ledger-proof');
        row.before = await control(controlPort, nonce, '/metrics'); row.authorityBefore = await control(authPort, nonce, '/metrics'); row.cgroupBefore = cgroup(serviceState.State.Pid);row.authorityCgroupBefore=cgroup(authorityState.State.Pid);
        row.client = await runClient(image, prefix + '-client', { ...variables, TARGETED_PHASE: 'measure' });
        row.drainSamples=[];const drainEnd=performance.now()+4000;
        do { const sample=await control(controlPort,nonce,'/metrics');row.drainSamples.push(sample);if(drained(sample))break;await sleep(50); } while(performance.now()<drainEnd);
        row.after = row.drainSamples.at(-1); row.cgroupAfter = cgroup(serviceState.State.Pid); row.authorityAfter = await control(authPort, nonce, '/metrics');row.authorityCgroupAfter=cgroup(authorityState.State.Pid); row.ledgerAfter = await control(controlPort, nonce, '/ledger-proof');
        const trace=await control(controlPort,nonce,'/trace');json(join(out, prefix + '-provider-trace.json'),trace);
        const spec=descriptor(row.profile),expected=row.profile==='history'?25:row.profile==='identity'?75:spec.users*spec.waves;
        row.summary = summarize(row.client.result.records || [], expected, row.before, row.after);
        row.account=accountDeltas(row.before,row.after);
        row.account.sqlCpuAvailable=row.after.accounts?.sqlThreadCpuAvailable>0;
        if(!row.account.sqlCpuAvailable)row.account.sql.sqlCpuMs=null;
        row.evidenceIssues=[...row.account.issues,...journalIssues(row.client.result,row.profile),...traceIssues(trace.trace,row.after),...quoteIssues(row.client.result.records,trace.trace)];
        if(!drained(row.before)||!drained(row.after))row.evidenceIssues.push('QUEUE_NOT_DRAINED');
        row.serviceIoBefore=ioCounters(row.cgroupBefore.ioStat);row.serviceIoAfter=ioCounters(row.cgroupAfter.ioStat);
        row.memoryEvents={before:kernelCounters(row.cgroupBefore.memoryEvents),after:kernelCounters(row.cgroupAfter.memoryEvents)};
        row.serviceMemoryPeak=Number(row.cgroupAfter.memoryPeak);
        if(!row.serviceIoBefore||!row.serviceIoAfter||!finite(row.serviceMemoryPeak)||row.serviceMemoryPeak<=0||!['oom','oom_kill','high','max'].every(k=>finite(row.memoryEvents.before?.[k])&&finite(row.memoryEvents.after?.[k])))row.evidenceIssues.push('CGROUP_METRICS_MISSING');
        row.serviceIoDelta=row.serviceIoBefore&&row.serviceIoAfter?Object.fromEntries(['rbytes','wbytes','rios','wios'].map(k=>[k,delta(row.serviceIoBefore.totals,row.serviceIoAfter.totals,k)])):null;
        if(!row.serviceIoDelta||Object.values(row.serviceIoDelta).includes(null))row.evidenceIssues.push('IO_COUNTER_INCOMPLETE');
        row.cgroupCpuMs = delta({ cpu: cpuUse(row.cgroupBefore.cpuStat) }, { cpu: cpuUse(row.cgroupAfter.cpuStat) }, 'cpu');
        row.providerCounters = { before: row.before.transport, after: row.after.transport, logicalBefore: row.before.logical, logicalAfter: row.after.logical };
        row.providerDeltas={native:Object.fromEntries(['starts','completed','failed','cancelled','bytes'].map(k=>[k,delta(row.before.transport,row.after.transport,k)])),logical:Object.fromEntries(['requested','completed','failed'].map(k=>[k,delta(row.before.logical,row.after.logical,k)]))};
        if([...Object.values(row.providerDeltas.native),...Object.values(row.providerDeltas.logical)].includes(null))row.evidenceIssues.push('PROVIDER_DELTA_INCOMPLETE');
        row.authorityCpuMs=delta({cpuMs:(row.authorityBefore.cpu?.user+row.authorityBefore.cpu?.system)/1000},{cpuMs:(row.authorityAfter.cpu?.user+row.authorityAfter.cpu?.system)/1000},'cpuMs');
        row.authorityCgroupCpuMs=delta({cpu:cpuUse(row.authorityCgroupBefore.cpuStat)},{cpu:cpuUse(row.authorityCgroupAfter.cpuStat)},'cpu');
        if(row.authorityCpuMs===null||row.authorityCgroupCpuMs===null||!finite(row.authorityAfter.maxRss)||!finite(row.client.result.clientCpuMs)||!finite(row.client.result.memory?.rss)||row.authorityAfter.inflight!==0)row.evidenceIssues.push('AUXILIARY_METRICS_MISSING');
        const clientProof = row.client.result.cgroup;
        row.clientMemoryEvents=kernelCounters(clientProof?.['memory.events']);row.clientMemoryPeak=Number(clientProof?.['memory.peak']);
        row.authorityMemoryEvents=kernelCounters(row.authorityCgroupAfter.memoryEvents);row.authorityMemoryPeak=Number(row.authorityCgroupAfter.memoryPeak);
        if(!['oom','oom_kill'].every(k=>finite(row.clientMemoryEvents?.[k])&&finite(row.authorityMemoryEvents?.[k]))||!finite(row.clientMemoryPeak)||!row.clientMemoryPeak||!finite(row.authorityMemoryPeak)||!row.authorityMemoryPeak)row.evidenceIssues.push('AUXILIARY_CGROUP_MEMORY_MISSING');
        const complete = row.client.exitCode === 0 && row.client.result.complete === true && !row.client.overflow && row.summary.completeness === 'COMPLETE' && row.cgroupCpuMs !== null
          && row.evidenceIssues.length===0 && clientProof?.['cpu.max']?.trim() === '50000 100000' && clientProof?.['cpuset.cpus.effective']?.trim()===loadCpu && Number(clientProof?.['memory.max']) === 268435456 && clientProof?.['memory.swap.max']?.trim()==='0';
        const contracts = row.client.result.contracts?.length > 0 && row.client.result.contracts.every(c => c.ok), providers = Object.values(row.after.transport.startsByHost).every(n => n <= 100);
        row.ledgerUnchanged = /^[a-f0-9]{64}$/.test(row.ledgerBefore.sha256||'')&&row.ledgerBefore.sha256 === row.ledgerAfter.sha256&&row.ledgerBefore.accounts===row.ledgerAfter.accounts;
        row.status = !complete ? 'INCOMPLETE' : row.summary.errors || !contracts || !providers || !row.ledgerUnchanged || row.providerDeltas.native.failed || row.providerDeltas.native.cancelled || row.providerDeltas.logical.failed || row.account.queue.rejected || row.account.queue.timedOut || row.memoryEvents.after.oom || row.memoryEvents.after.oom_kill || row.clientMemoryEvents.oom || row.clientMemoryEvents.oom_kill || row.authorityMemoryEvents.oom || row.authorityMemoryEvents.oom_kill ? 'FAIL' : 'PASS';
        if(row.profile==='wallet'){row.postMeasure=await runClient(image,prefix+'-verify',{...variables,TARGETED_PHASE:'verify-wallet'});row.usedCapacityUnchanged=!!row.setup.result.usedCapacity&&JSON.stringify(row.setup.result.usedCapacity)===JSON.stringify(row.postMeasure.result.usedCapacity);if(row.postMeasure.exitCode!==0||row.postMeasure.result.complete!==true||!row.usedCapacityUnchanged)row.status='FAIL';}
      } catch (error) { row.reason = String(error.message).slice(0, 2000); row.status = 'INCOMPLETE'; }
      finally { row.cleanup = []; for (const name of [...active].filter(n => n.startsWith(prefix + '-')).reverse()) { try { stopped(name); } catch (error) { row.cleanup.push(String(error.message).slice(0, 1000)); } } if (row.cleanup.length) row.status = 'INCOMPLETE'; row.endedUtc = new Date().toISOString(); save(); preflightGate(row); }
      if (row.preflight && row.status !== 'PASS') throw Error('CHEAP_PREFLIGHT_FAILED_NO_MEASURED_RUNS_STARTED');
    }
    report.complete = report.runs.every(row => row.status !== 'INCOMPLETE'); report.endedUtc = new Date().toISOString();
    report.pairs = report.schedule.filter(r => r.variant === 'target').map(({ profile, repeat }) => { const target = report.runs.find(r => r.profile === profile && r.repeat === repeat && r.variant === 'target'), control = report.runs.find(r => r.profile === profile && r.repeat === repeat && r.variant === 'control');
      const percent = (a, b) => Number.isFinite(a) && a > 0 && Number.isFinite(b) ? 100 * (b / a - 1) : null;
      const hashes=r=>[...new Set((r.client?.result.records||[]).filter(x=>x.outcome==='SUCCESS'&&x.financialHash).map(x=>x.financialHash))].sort();
      const financialEquivalent=profile==='history'||control.status==='INCOMPLETE'||target.status==='INCOMPLETE'?null:JSON.stringify(hashes(control))===JSON.stringify(hashes(target))&&hashes(control).length>0;
      if(financialEquivalent===false){control.status='FAIL';target.status='FAIL';}
      return { profile, repeat, controlStatus: control.status, targetStatus: target.status, financialEquivalent, cpuPerAttemptPercent: percent(control.summary?.cpuMsPerAttempt, target.summary?.cpuMsPerAttempt), allAttemptP95Percent: percent(control.summary?.allAttemptLatencyMs?.p95, target.summary?.allAttemptLatencyMs?.p95), errors: [control.summary?.errors ?? null, target.summary?.errors ?? null], interpretation: profile === 'identity' ? 'body-size diagnostic, not optimization benefit' : 'target-only counterfactual, not original acceptance' }; }); save();
    if (report.runs.some(row => row.status !== 'PASS')) process.exitCode = 1;
  } finally { for (const name of [...active].reverse()) try { stopped(name); } catch (e) { report.finalCleanupError = String(e.message);report.complete=false;process.exitCode=1; } save();json(join(out,'receipt.json'),{sourceSha:sha,resultsSha256:hash(readFileSync(join(out,'results.json'))),complete:report.complete}); }
}
if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) await main();
