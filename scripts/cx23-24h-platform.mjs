// Read-only Linux adapters. Never read cmdline, environ, application files or DBs.
import { readFile, readdir, lstat, mkdir, statfs, open, realpath } from 'node:fs/promises';
import { dirname, resolve, posix } from 'node:path';
import { constants } from 'node:fs';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const execute = promisify(execFile);
const hash = s => createHash('sha256').update(s).digest('hex');
export const codeError = code => Object.assign(new Error(code), { code });
export function validIoCounters(text) {
  if (typeof text !== 'string' || !text.trim()) return false;
  const devices = new Set();
  return text.trim().split('\n').every(line => {
    const [device, ...fields] = line.trim().split(/\s+/), keys = new Set();
    if (!/^\d+:\d+$/.test(device) || devices.has(device)) return false;
    devices.add(device);
    for (const field of fields) {
      const pair = field.match(/^([a-z_]+)=(\d+)$/);
      if (!pair || keys.has(pair[1]) || !Number.isSafeInteger(Number(pair[2]))) return false;
      keys.add(pair[1]);
    }
    return keys.has('rbytes') && keys.has('wbytes');
  });
}
export function privateMode(s, type, uid = process.getuid?.()) {
  return !s.isSymbolicLink() && (type === 'directory' ? s.isDirectory() : s.isFile())
    && (s.mode & 0o777) === (type === 'directory' ? 0o700 : 0o600)
    && (uid === undefined || s.uid === uid) && (type !== 'file' || s.nlink === 1);
}
export async function privateOutput(path, { platform = process.platform } = {}) {
  const dir = dirname(path);
  await mkdir(dir, { mode: 0o700 }).catch(e => { if (e.code !== 'EEXIST') throw e; });
  const ds = await lstat(dir);
  if (platform === 'linux' && !privateMode(ds, 'directory')) throw codeError('OUTPUT_DIRECTORY_NOT_PRIVATE');
  // Reject a symlink at the output directory and final file; never chmod existing paths.
  if (ds.isSymbolicLink()) throw codeError('OUTPUT_DIRECTORY_SYMLINK');
  const canonical = await realpath(dir);
  if (resolve(canonical) !== resolve(dir)) throw codeError('OUTPUT_PARENT_SYMLINK');
  const file = await open(path, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | (constants.O_NOFOLLOW || 0), 0o600);
  try { if (platform === 'linux' && !privateMode(await file.stat(), 'file')) throw codeError('OUTPUT_FILE_NOT_PRIVATE'); }
  catch (e) { await file.close(); throw e; }
  return file;
}
export async function freeBytes(path) { const s = await statfs(dirname(path)); return s.bavail * s.bsize; }
export function safeDockerOptions(privateDir, signal) {
  return { signal, timeout: 12000, killSignal: 'SIGKILL', maxBuffer: 256 * 1024,
    env: { PATH: '/usr/bin:/bin', LANG: 'C', LC_ALL: 'C', DOCKER_CONFIG: privateDir } };
}
export const dockerArgs = args => ['--host=unix:///var/run/docker.sock', ...args];
export async function createDockerReader(names, privateDir, { exec = execute, signal } = {}) {
  if (!names.length || names.length > 20) throw codeError('EXPLICIT_CONTAINERS_REQUIRED');
  await mkdir(privateDir, { mode: 0o700 });
  const call = (args, abort) => exec('/usr/bin/docker', dockerArgs(args), safeDockerOptions(privateDir, abort));
  const pinned = (await call(['container', 'inspect', '--format', '{{.Id}}', ...names], signal)).stdout.trim().split(/\s+/);
  if (pinned.length !== names.length || pinned.some(x => !/^[a-f0-9]{64}$/.test(x)) || new Set(pinned).size !== pinned.length) throw codeError('CONTAINER_IDENTITY_UNVERIFIED');
  return { ids: pinned, async read(abort) {
    const started = performance.now();
    try {
      const { stdout } = await call(['stats', '--no-stream', '--no-trunc', '--format', '{{json .}}', ...pinned], abort);
      const rows = stdout.trim().split('\n').filter(Boolean).map(JSON.parse);
      if (rows.length !== pinned.length || rows.some(r => !pinned.includes(r.ID || r.Container))
        || new Set(rows.map(r => r.ID || r.Container)).size !== pinned.length) throw codeError('CONTAINER_IDENTITY_CHANGED');
      return { available: true, rows, elapsedMs: performance.now() - started, childCpu: 'UNAVAILABLE_NOT_INCLUDED_IN_SAMPLER_CPU' };
    } catch (e) { return { available: false, reason: e.code === 'ENOENT' ? 'DOCKER_CLI_UNAVAILABLE' : abort?.aborted ? 'DOCKER_ABORTED' : 'DOCKER_METRICS_UNAVAILABLE', elapsedMs: performance.now() - started }; }
  } };
}
export function procStat(text) {
  const end = text.lastIndexOf(')'), pid = Number(text.slice(0, text.indexOf(' '))), f = text.slice(end + 2).trim().split(/\s+/);
  const r = { pid, parentPid: Number(f[1]), userTicks: Number(f[11]), systemTicks: Number(f[12]), startTimeTicks: f[19] };
  if (end < 0 || !Number.isSafeInteger(pid) || pid < 1 || !/^\d+$/.test(r.startTimeTicks)
    || [r.parentPid, r.userTicks, r.systemTicks].some(v => !Number.isSafeInteger(v) || v < 0)) throw codeError('PROCESS_STAT_INVALID');
  return r;
}
export async function processIdentity(pid, read = readFile, signal) {
  const options = { encoding: 'utf8', signal };
  const [stat, group] = await Promise.all([read('/proc/' + pid + '/stat', options), read('/proc/' + pid + '/cgroup', options)]);
  return { ...procStat(stat), cgroupId: hash(group), group };
}
const sameIdentity = (a, b) => a.pid === b.pid && a.startTimeTicks === b.startTimeTicks && a.cgroupId === b.cgroupId;
export async function processInventory(pin, { read = readFile, list = readdir, signal, maxProcesses = 64, maxTasks = 256 } = {}) {
  if (!pin) return null;
  const options = { encoding: 'utf8', signal }, rows = [], pending = [{pid:pin.pid, parent:null}], seen = new Map(), discovered = new Map([[pin.pid,null]]);
  let tasksRead = 0;
  const tids = async pid => {
    signal?.throwIfAborted();
    const entries = await list('/proc/' + pid + '/task');
    if (!entries.length || entries.some(x => !/^\d+$/.test(x))) throw codeError('PROCESS_TASKS_INVALID');
    return entries.sort((a, b) => Number(a) - Number(b));
  };
  try {
    const current = await processIdentity(pin.pid, read, signal);
    if (!sameIdentity(pin, current)) return { available: false, reason: 'PROCESS_IDENTITY_CHANGED' };
    while (pending.length) {
      const {pid,parent} = pending.shift();
      if (seen.has(pid)) { if (seen.get(pid) !== parent) return { available:false, reason:'PROCESS_PARENT_CHANGED', rows }; continue; }
      seen.set(pid,parent);
      if (seen.size > maxProcesses) return { available: false, reason: 'PROCESS_INVENTORY_LIMIT', rows };
      const before = await processIdentity(pid, read, signal);
      if (parent !== null && before.parentPid !== parent) return { available:false, reason:'PROCESS_PARENT_CHANGED', rows };
      const taskIds = await tids(pid);
      tasksRead += taskIds.length;
      if (tasksRead > maxTasks) return { available: false, reason: 'PROCESS_TASK_LIMIT', rows };
      const status = await read('/proc/' + pid + '/status', options);
      const children = [];
      // Linux children is per TID, not per process. Read every bounded task.
      for (const tid of taskIds) {
        signal?.throwIfAborted();
        const childList = await read('/proc/' + pid + '/task/' + tid + '/children', options);
        if (childList.length > 65536) throw codeError('PROCESS_CHILDREN_LIMIT');
        children.push(childList);
      }
      if ((await tids(pid)).join(',') !== taskIds.join(',')) return { available: false, reason: 'PROCESS_TASKS_CHANGED', rows };
      const after = await processIdentity(pid, read, signal);
      if (!sameIdentity(before, after)) return { available: false, reason: 'PROCESS_INVENTORY_CHANGED', rows };
      if (parent !== null && after.parentPid !== parent) return { available:false, reason:'PROCESS_PARENT_CHANGED', rows };
      const rss = status.match(/^VmRSS:\s*(\d+)\s*kB/m), threads = status.match(/^Threads:\s*(\d+)/m);
      rows.push({ pid, parentPid: before.parentPid, startTimeTicks: before.startTimeTicks, cgroupId: before.cgroupId,
        userTicks: before.userTicks, systemTicks: before.systemTicks, rssBytes: rss ? Number(rss[1]) * 1024 : null, threads: threads ? Number(threads[1]) : null });
      for (const child of children.join(' ').trim().split(/\s+/).filter(Boolean)) {
        const childPid = Number(child);
        if (!/^\d+$/.test(child) || !Number.isSafeInteger(childPid) || childPid < 1) throw codeError('PROCESS_CHILDREN_INVALID');
        if (discovered.has(childPid)) { if (discovered.get(childPid) !== pid) return { available:false, reason:'PROCESS_PARENT_CHANGED', rows }; continue; }
        if (discovered.size >= maxProcesses) return { available:false, reason:'PROCESS_INVENTORY_LIMIT', rows };
        discovered.set(childPid,pid); pending.push({pid:childPid,parent:pid});
      }
    }
    if (!sameIdentity(pin, await processIdentity(pin.pid, read, signal))) return { available: false, reason: 'PROCESS_IDENTITY_CHANGED', rows };
    const unified = pin.group.split('\n').find(x => x.startsWith('0::'))?.slice(3);
    let cgroup = { available: false, reason: 'CGROUP_V2_UNAVAILABLE' };
    if (unified) {
      const base = '/sys/fs/cgroup', path = posix.resolve(base, '.' + unified), rel = posix.relative(base, path);
      if (rel.startsWith('..') || posix.isAbsolute(rel)) throw codeError('CGROUP_PATH_INVALID');
      try {
        const names = ['cpu.stat', 'memory.current', 'memory.peak', 'io.stat', 'pids.current', 'cgroup.procs'];
        const values = await Promise.all(names.map(n => read(path + '/' + n, options)));
        if (values.some(v => v.length > 65536)) throw codeError('CGROUP_EVIDENCE_LIMIT');
        const members = values[5].trim().split(/\s+/).filter(Boolean).map(Number);
        if (!/^usage_usec\s+\d+$/m.test(values[0]) || values[0].trim().split('\n').some(line=>!/^[a-z_]+\s+\d+\s*$/.test(line)) || [1,2,4].some(i => !/^\d+\s*$/.test(values[i]))
          || !members.includes(pin.pid) || new Set(members).size !== members.length || members.some(p => !Number.isSafeInteger(p) || p < 1)) throw codeError('CGROUP_EVIDENCE_INVALID');
        const ioLines = values[3].trim().split('\n').filter(Boolean);
        if (ioLines.length && !validIoCounters(values[3])) throw codeError('CGROUP_EVIDENCE_INVALID');
        cgroup = { available: true, id: pin.cgroupId, scope: 'Entire cgroup; may include other services. Not exclusive process attribution.',
          cpuStat: values[0], memoryCurrentBytes: Number(values[1]), memoryPeakBytes: Number(values[2]), ioStat: values[3], ioAvailable:ioLines.length>0,
          ioUnavailableReason:ioLines.length?null:'NO_BLOCK_IO_COUNTERS_EXPOSED', pidsCurrent: Number(values[4]), memberPids: members };
      } catch { cgroup = { available: false, reason: 'CGROUP_METRICS_UNAVAILABLE' }; }
    }
    if (!sameIdentity(pin, await processIdentity(pin.pid, read, signal))) return { available:false, reason:'PROCESS_IDENTITY_CHANGED', rows };
    return { available: true, identity: { pid: pin.pid, startTimeTicks: pin.startTimeTicks, cgroupId: pin.cgroupId }, rows, tasksRead, cgroup,
      scope: 'Bounded all-TID descendant snapshot, not atomic across Linux process churn. Threads counted within each process, never added again. RSS may share pages.' };
  } catch (e) { return { available: false, reason: signal?.aborted ? 'PROCESS_SAMPLE_ABORTED' : 'PROCESS_UNAVAILABLE', rows }; }
}
