// Explicit reviewed QA entrypoint only. Disabled source policy admits no preparation
// or workload. No automatic discovery, deployment, image purchase or provider call.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { prepare, validateConfig as validatePreparationConfig } from '../auth-http-fixture-512/prepare.mjs';
import * as gate from './launch-gate.mjs';
import { buildOverlay } from './build-overlay.mjs';
import { createTraceAdapter } from './adapter.mjs';
import { runTrace } from './trace-run.mjs';
import { analyzeTrace } from './analyze.mjs';
import { validateTraceFreeze } from './trace-plan.mjs';
import { TRACE_BOUNDS } from './trace-plan.mjs';
import { acquireImageLease } from './image-lease.mjs';

const SCHEMA = 'stocks-one-burst-launcher-512-v1';
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const keys = (value, names) => assert.deepEqual(Object.keys(value).sort(), [...names].sort(), 'TRACE_LAUNCHER_FIELDS');
const absolute = value => { assert.ok(typeof value === 'string' && path.isAbsolute(value) && !value.includes('\0')); return path.resolve(value); };
function outside(file, repository) {
  const resolved = absolute(file), root = absolute(repository);
  assert.ok(resolved !== root && !resolved.startsWith(root + path.sep), 'TRACE_LAUNCHER_OUTSIDE_GIT_REQUIRED'); return resolved;
}
function readJson(file, max = 2 * 1024 ** 2) {
  const stat = fs.lstatSync(file); assert.ok(stat.isFile() && !stat.isSymbolicLink() && stat.size <= max);
  assert.equal(fs.realpathSync(file), path.resolve(file)); return JSON.parse(fs.readFileSync(file, 'utf8'));
}
function save(file, value, max = 16 * 1024 ** 2) {
  const resolved = absolute(file); assert.equal(fs.realpathSync(path.dirname(resolved)), path.dirname(resolved));
  const bytes = Buffer.from(JSON.stringify(value, null, 2) + '\n'); assert.ok(bytes.length <= max, 'TRACE_REPORT_BOUND');
  fs.writeFileSync(file, bytes, { flag: 'wx', mode: 0o600 }); return { bytes: bytes.length, sha256: hash(bytes) };
}
export function validateLauncherConfig(config) {
  assert.equal(config?.schema, SCHEMA); assert.ok(['prepare', 'run'].includes(config.mode)); absolute(config.repository);
  keys(config.gate, ['input', 'policy']);
  if (config.mode === 'prepare') {
    keys(config, ['schema', 'mode', 'repository', 'gate', 'preparation']); validatePreparationConfig(config.preparation);
    assert.equal(config.preparation.sourceSha, config.gate.input.event.headSha);
    assert.equal(String(config.preparation.stage.runId), String(config.gate.input.event.runId));
    outside(config.preparation.output, config.repository);
  } else {
    keys(config, ['schema', 'mode', 'repository', 'gate', 'freeze', 'adapter', 'attemptMarker', 'resultPath', 'imageOwnership',
      ...(config.imageOwnership === 'verified-archive-lease' ? ['imageLease'] : [])]);
    validateTraceFreeze(config.freeze); assert.ok(['external-preloaded', 'verified-archive-lease'].includes(config.imageOwnership), 'TRACE_IMAGE_OWNERSHIP_REQUIRED');
    if (config.imageOwnership === 'verified-archive-lease') {
      keys(config.imageLease, ['archivePath', 'archiveSha256', 'archiveBytes', 'dockerConfigDirectory']);
      absolute(config.imageLease.archivePath); outside(config.imageLease.dockerConfigDirectory, config.repository);
      assert.match(config.imageLease.archiveSha256, /^[a-f0-9]{64}$/); assert.ok(Number.isSafeInteger(config.imageLease.archiveBytes) && config.imageLease.archiveBytes > 0 && config.imageLease.archiveBytes <= 3 * 1024 ** 3);
    }
    outside(config.attemptMarker, config.repository); outside(config.resultPath, config.repository);
    assert.notEqual(path.resolve(config.attemptMarker), path.resolve(config.resultPath));
    keys(config.adapter, ['sourceRoot', 'preparationPath', 'preparationSha256', 'seedPath', 'overlay', 'disk', 'device', 'outputDirectory', 'driverFiles']);
    for (const name of ['sourceRoot', 'preparationPath', 'seedPath', 'disk', 'device', 'outputDirectory']) absolute(config.adapter[name]);
    outside(config.adapter.outputDirectory, config.repository);
    assert.match(config.adapter.preparationSha256, /^[a-f0-9]{64}$/);
  }
  return config;
}

export async function launch(config, hooks = {}) {
  const now = hooks.now || (() => performance.now()), started = now(), runEnd = started + TRACE_BOUNDS.totalMs;
  validateLauncherConfig(config);
  const git = hooks.git || (args => { const timeout = Math.floor(Math.min(10000, config.mode === 'run' ? runEnd-now() : 10000));
    assert.ok(timeout>0,'TRACE_LAUNCHER_DEADLINE'); return execFileSync('/usr/bin/git', args, { cwd: config.repository,
      env: { PATH: '/usr/bin:/bin', LANG: 'C' }, timeout, maxBuffer: 16 * 1024 ** 2 }); });
  if (config.mode === 'prepare') {
    const eligibility = (hooks.validateSource || gate.validatePreparationSource)(config.gate.input, config.gate.policy, { git });
    assert.equal(eligibility.preparationEligible, true, 'TRACE_PREPARATION_NOT_ELIGIBLE');
    const report = await (hooks.prepare || prepare)(config.preparation, { root: config.repository });
    assert.equal(report.status, 'PREPARED_NOT_AUTHORIZED', 'TRACE_PREPARATION_INCOMPLETE');
    assert.equal(report.sourceSha, eligibility.sourceSha);
    const overlay = (hooks.buildOverlay || buildOverlay)({ sourceRoot: path.join(config.preparation.output, 'public-context'),
      outputDirectory: path.join(config.preparation.output, 'trace-overlay'), sourceSha: report.sourceSha, contextSha256: report.contextSha256 });
    const result = { schema: SCHEMA, mode: 'prepare', status: 'PREPARED_NOT_AUTHORIZED', eligibility,
      preparationPath: path.join(config.preparation.output, 'preparation.json'), overlay,
      workloadExecuted: false, imageOwnership: 'Preparation exported the image and removed its own daemon copy; run requires explicitly verified preloading by the owning job.' };
    (hooks.save || save)(path.join(config.preparation.output, 'trace-preparation-result.json'), result); return result;
  }
  // Local same-job receipt gate remains a separate phase from source preparation.
  const validateRun = hooks.validateRun || gate.validateLocalLaunch;
  assert.equal(typeof validateRun, 'function', 'TRACE_LOCAL_RECEIPT_GATE_UNAVAILABLE');
  const eligibility = validateRun(config.gate.input, config.gate.policy, { git });
  assert.equal(eligibility.eligible, true, 'TRACE_LAUNCH_NOT_ELIGIBLE');
  assert.equal(config.freeze.sourceSha, eligibility.sourceSha); assert.equal(config.freeze.reviewedPacketSha256, eligibility.policySha256);
  assert.ok(now()<runEnd-TRACE_BOUNDS.cleanupMs,'TRACE_LAUNCHER_DEADLINE');
  // Atomic and persistent. Failure, timeout, process restart and cleanup never delete it.
  const attempt = { schema: 1, runId: eligibility.runId, sourceSha: eligibility.sourceSha, policySha256: eligibility.policySha256,
    planSha256: config.freeze.planSha256, maximumBursts: 1 };
  (hooks.save || save)(config.attemptMarker, attempt, 4096);
  const overallEnd = runEnd;
  let adapter, report, lease;
  try {
    if (config.imageOwnership === 'verified-archive-lease') {
      const binding = eligibility.localFileBindings?.inputs?.find(row => row.path === 'runtime-image.tar');
      assert.deepEqual(binding, { path:'runtime-image.tar',bytes:config.imageLease.archiveBytes,sha256:config.imageLease.archiveSha256 });
      const dockerConfig = absolute(config.imageLease.dockerConfigDirectory);
      if (!hooks.imageExecute) { assert.equal(fs.realpathSync(path.dirname(dockerConfig)), path.dirname(dockerConfig)); fs.mkdirSync(dockerConfig, { mode:0o700 }); }
      const env = { PATH:'/usr/bin:/bin',LANG:'C',DOCKER_HOST:'unix:///var/run/docker.sock',DOCKER_CONFIG:dockerConfig };
      const execute = hooks.imageExecute || ((binary,args,cap) => {
        assert.equal(binary,'/usr/bin/docker'); const timeout=Math.floor(Math.min(cap,overallEnd-now())); assert.ok(timeout>0,'TRACE_LAUNCHER_DEADLINE');
        return execFileSync(binary,args,{env,encoding:'utf8',timeout,maxBuffer:1024**2});
      });
      lease = await (hooks.acquireImageLease || acquireImageLease)({ imageId:config.freeze.imageId,sourceSha:config.freeze.sourceSha,
        archivePath:config.imageLease.archivePath,archiveSha256:config.imageLease.archiveSha256,archiveBytes:config.imageLease.archiveBytes,execute,now });
    }
    const remaining = Math.floor(overallEnd-now()-(lease?30000:0)); assert.ok(remaining>TRACE_BOUNDS.cleanupMs,'TRACE_LAUNCHER_DEADLINE');
    adapter = (hooks.createAdapter || createTraceAdapter)({ ...config.adapter, repository: config.repository, launch: config.gate });
    report = await (hooks.runTrace || runTrace)({ freeze: config.freeze, adapter, budgetMs:remaining });
    report.observedStatus ??= report.status;
    if (report.status === 'FAIL') report.observedStatus = 'FAIL';
  }
  catch (error) {
    // runTrace normally retains failures itself. Guard initialization/programming
    // errors without authorizing another attempt, and preserve a bounded failure.
    report = { status: 'INCOMPLETE', observedStatus: 'INCOMPLETE', safetyStatus: 'NOT_EVALUATED', captureStatus: 'INCOMPLETE',
      errors: [/^[A-Z][A-Z0-9_]+$/.test(error?.message || '') ? error.message : 'TRACE_LAUNCH_FAILED'],
      ordinary: [], capacityAcceptance: 'NOT_EVALUATED' };
    if (error?.evidence) report.imageLease = error.evidence;
    if (adapter) try { report.cleanup = await adapter.close(Math.max(1,Math.min(30000,overallEnd-now()))); } catch { report.cleanup = { removed: false, errors: ['TRACE_CLEANUP_INCOMPLETE'] }; }
    else report.cleanup = { removed:true,errors:[],scope:'No adapter created.' };
  } finally {
    const incomplete = code => {
      report.errors ||= []; if (!report.errors.includes(code)) report.errors.push(code);
      report.status = report.observedStatus === 'FAIL' || report.status === 'FAIL' ? 'FAIL' : 'INCOMPLETE';
    };
    report.cleanupStatus = report.cleanup?.removed === true && Array.isArray(report.cleanup.errors)
      && report.cleanup.errors.length === 0 ? 'COMPLETE' : 'INCOMPLETE';
    if (report.cleanupStatus === 'INCOMPLETE') incomplete('TRACE_CLEANUP_INCOMPLETE');
    report.imageCleanupStatus = lease ? 'INCOMPLETE' : 'NOT_APPLICABLE';
    if (lease) {
      report.imageLease = lease.evidence;
      if (report.cleanup?.removed === true) {
        try { report.imageCleanup = await lease.release({containersClosed:true});
          assert.ok(['REMOVED','ABSENT','PRESERVED'].includes(report.imageCleanup.status) && report.imageCleanup.errors.length===0,'TRACE_IMAGE_CLEANUP_INCOMPLETE');
          report.imageCleanupStatus = 'COMPLETE';
        } catch { incomplete('TRACE_IMAGE_CLEANUP_INCOMPLETE'); }
      } else incomplete('TRACE_IMAGE_RETAINED_FOR_UNCLOSED_CONTAINERS');
    }
    if (now() >= overallEnd) incomplete('TRACE_LAUNCHER_DEADLINE');
    report.launcherElapsedMs=now()-started;
  }
  let evidence, rawEvidenceAvailable = true;
  try { evidence = (hooks.readEvidence || readJson)(path.join(config.adapter.outputDirectory, 'adapter-evidence.json'), 32 * 1024 ** 2);
    assert.ok(Array.isArray(evidence.events) && evidence.events.length <= 20000); }
  catch { evidence = { events: [] }; rawEvidenceAvailable = false; report.errors ||= []; report.errors.push('TRACE_ADAPTER_EVIDENCE_UNAVAILABLE'); }
  const authorityEvents = evidence.events.filter(row => /^trace_\d{2}$/.test(row.requestId || ''));
  report.analysis = (hooks.analyzeTrace || analyzeTrace)({ trace: report.trace, ordinary: report.ordinary, authorityEvents, cgroupWindow: report.cgroupWindow });
  report.captureStatus = rawEvidenceAvailable && report.analysis.captureStatus === 'COMPLETE'
    && report.captureStatus !== 'INCOMPLETE' ? 'COMPLETE' : 'INCOMPLETE';
  if (report.captureStatus !== 'COMPLETE') report.status = report.observedStatus === 'FAIL' || report.status === 'FAIL' ? 'FAIL' : 'INCOMPLETE';
  report.launch = { eligibility, attempt, imageOwnership: config.imageOwnership,
    productionAccess: false, capacityAcceptance: false };
  (hooks.save || save)(config.resultPath, report); return report;
}

export async function main(args = process.argv.slice(2)) {
  assert.ok(args.length === 2 && ['--prepare', '--run'].includes(args[0]), 'TRACE_EXPLICIT_MODE_AND_CONFIG_REQUIRED');
  const config = readJson(absolute(args[1])); assert.equal(config.mode, args[0].slice(2));
  const result = await launch(config); process.stdout.write(JSON.stringify({ status: result.status, workloadAccepted: false }) + '\n');
  if (!['PASS', 'PREPARED_NOT_AUTHORIZED'].includes(result.status)) process.exitCode = 1;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
