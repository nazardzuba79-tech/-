'use strict';
// placement.cjs (#613 R8 isolated clients) on synthetic /sys and /proc trees, plus one live check of this process on
// Linux. No workload.
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const p = require('./placement.cjs');
const tmp = t => { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'rc50-placement-')); t.after(() => fs.rmSync(d, {recursive: true, force: true})); return d; };
const write = (file, text) => { fs.mkdirSync(path.dirname(file), {recursive: true}); fs.writeFileSync(file, text); };
// cpus: {n: {siblings, core, online}}
function sys(t, cpus) {
  const d = tmp(t);
  for (const [n, c] of Object.entries(cpus)) {
    write(path.join(d, 'cpu' + n, 'topology', 'thread_siblings_list'), c.siblings + '\n');
    write(path.join(d, 'cpu' + n, 'topology', 'core_id'), String(c.core) + '\n');
    write(path.join(d, 'cpu' + n, 'topology', 'physical_package_id'), '0\n');
    if (n !== '0') write(path.join(d, 'cpu' + n, 'online'), c.online === false ? '0\n' : '1\n');
  }
  return d;
}
// procs: {pid: {ppid, threads: {tid: allowedList}}}
function proc(t, procs) {
  const d = tmp(t);
  for (const [pid, x] of Object.entries(procs)) {
    write(path.join(d, pid, 'stat'), `${pid} (node) S ${x.ppid} 0 0`);
    for (const [tid, allowed] of Object.entries(x.threads)) write(path.join(d, pid, 'task', tid, 'status'), `Name:\tnode\nPid:\t${tid}\nCpus_allowed_list:\t${allowed}\n`);
    write(path.join(d, pid, 'status'), `Name:\tnode\nVmHWM:\t  2048 kB\nVmRSS:\t  1024 kB\n`);
    write(path.join(d, pid, 'smaps_rollup'), `Rss: 1024 kB\nPss:   512 kB\n`);
  }
  return d;
}

test('CPU lists parse exactly and refuse anything else', () => {
  assert.deepEqual(p.cpus('0-1,3'), [0, 1, 3]);
  assert.deepEqual(p.cpus('2,3'), [2, 3]);
  assert.deepEqual(p.cpus(p.SERVER), [0, 1]);
  assert.deepEqual(p.cpus(p.CLIENT), [2, 3]);
  for (const bad of ['', '0-', '1-0', 'a', '0;1', null]) assert.throws(() => p.cpus(bad), /CPU_LIST_INVALID/);
});

test('admission: SMT pairs 0,1 / 2,3 isolate; sets that split a core, overlap, or are offline are refused', t => {
  const smt = p.topology([0, 1, 2, 3], sys(t, {0: {siblings: '0-1', core: 0}, 1: {siblings: '0-1', core: 0}, 2: {siblings: '2-3', core: 1}, 3: {siblings: '2-3', core: 1}}));
  assert.deepEqual(p.checkSets([0, 1], [2, 3], smt), []);
  // Linux enumerates siblings as 0,2 / 1,3 on many hosts: CPUs 0,1 would then be one thread of each core.
  const split = p.topology([0, 1, 2, 3], sys(t, {0: {siblings: '0,2', core: 0}, 1: {siblings: '1,3', core: 1}, 2: {siblings: '0,2', core: 0}, 3: {siblings: '1,3', core: 1}}));
  assert.deepEqual(p.checkSets([0, 1], [2, 3], split), ['SERVER_CPU_SHARES_A_CORE_OUTSIDE_ITS_SET:0', 'SERVER_CPU_SHARES_A_CORE_OUTSIDE_ITS_SET:1', 'CLIENT_CPU_SHARES_A_CORE_OUTSIDE_ITS_SET:2', 'CLIENT_CPU_SHARES_A_CORE_OUTSIDE_ITS_SET:3']);
  const noSmt = p.topology([0, 1, 2, 3], sys(t, {0: {siblings: '0', core: 0}, 1: {siblings: '1', core: 1}, 2: {siblings: '2', core: 2}, 3: {siblings: '3', core: 3}}));
  assert.deepEqual(p.checkSets([0, 1], [2, 3], noSmt), [], 'without SMT every CPU is its own core');
  assert.ok(p.checkSets([0, 1], [1, 2], noSmt).includes('SETS_OVERLAP'));
  assert.ok(p.checkSets([0, 1, 2], [3], noSmt).includes('SERVER_SET_NOT_TWO_CPUS'));
  const offline = p.topology([0, 1, 2, 3], sys(t, {0: {siblings: '0', core: 0}, 1: {siblings: '1', core: 1}, 2: {siblings: '2', core: 2, online: false}, 3: {siblings: '3', core: 3}}));
  assert.deepEqual(p.checkSets([0, 1], [2, 3], offline), ['CLIENT_CPU_OFFLINE_OR_UNKNOWN:2']);
  assert.deepEqual(p.checkSets([0, 1], [2, 3], p.topology([0, 1, 2, 3], tmp(t))).length, 4, 'a host without topology files is refused');
});

test('proof: every thread of every process and descendant on its side; a stray thread, a stray backend or a gone process fails', t => {
  const server = {set: [0, 1], roles: {}}, client = {set: [2, 3], roles: {}};
  const good = proc(t, {10: {ppid: 1, threads: {10: '0-1', 11: '0-1'}}, 20: {ppid: 1, threads: {20: '0-1'}}, 21: {ppid: 20, threads: {21: '0-1'}}, 30: {ppid: 1, threads: {30: '2-3', 31: '2-3'}}, 40: {ppid: 30, threads: {40: '2-3'}}});
  const sides = {server: {...server, roles: {api: {pid: 10, family: true}, postgres: {pid: 20, family: true}}}, client: {...client, roles: {driver: {pid: 30, family: false}, market: {pid: 40, family: true}}}};
  const ok = p.proof(sides, good);
  assert.equal(ok.ok, true, ok.violations.join(', '));
  assert.equal(ok.checkedThreads, 7);
  assert.deepEqual(ok.roles['server:postgres'], {pid: 20, processes: 2, threads: 2}, 'the backend (child of the postmaster) is judged');
  // The driver's own children are servers: with family false they are not judged as clients.
  const withChild = proc(t, {10: {ppid: 30, threads: {10: '0-1'}}, 20: {ppid: 1, threads: {20: '0-1'}}, 30: {ppid: 1, threads: {30: '2-3'}}, 40: {ppid: 30, threads: {40: '2-3'}}});
  assert.equal(p.proof(sides, withChild).ok, true);
  const stray = proc(t, {10: {ppid: 1, threads: {10: '0-1', 11: '0-3'}}, 20: {ppid: 1, threads: {20: '0-1'}}, 21: {ppid: 20, threads: {21: '0-3'}}, 30: {ppid: 1, threads: {30: '2-3'}}, 40: {ppid: 30, threads: {40: '0-1'}}});
  const bad = p.proof(sides, stray);
  assert.equal(bad.ok, false);
  assert.deepEqual(bad.violations, ['server:api:10/11(node)=0,1,2,3', 'server:postgres:21/21(node)=0,1,2,3', 'client:market:40/40(node)=0,1']);
  const gone = p.proof({server: {...server, roles: {api: {pid: 99, family: true}}}}, good);
  assert.deepEqual(gone.violations, ['server:api:PROCESS_GONE']);
});

test('per-CPU time: busy, steal and utilisation of a set over a window; memory with and without smaps_rollup', t => {
  const before = p.cpuTimes('cpu  1 2 3 4\ncpu0 100 0 50 1000 5 0 10 2\ncpu1 200 0 20 900 0 0 0 0\ncpu2 10 0 10 2000 0 0 0 0\n', 100);
  const after = p.cpuTimes('cpu0 300 0 70 1700 5 0 20 12\ncpu1 250 10 30 1800 0 0 0 0\ncpu2 20 0 10 2990 0 0 0 0\n', 100);
  const u = p.setUsage(before, after, [0, 1], 10000);
  assert.equal(u.userMs, 2500); assert.equal(u.niceMs, 100); assert.equal(u.systemMs, 300); assert.equal(u.softirqMs, 100); assert.equal(u.stealMs, 100);
  assert.equal(u.busyMs, 3100); assert.equal(u.capacityMs, 20000); assert.equal(u.utilization, 0.155);
  assert.equal(p.setUsage(before, after, [2], 10000).busyMs, 100);
  const d = proc(t, {10: {ppid: 1, threads: {10: '0-1'}}, 11: {ppid: 10, threads: {11: '0-1'}}});
  assert.deepEqual(p.memory(10, d), {rssKb: 1024, hwmKb: 2048, pssKb: 512});
  assert.deepEqual(p.clusterMemory(10, d), {processes: 2, rssKb: 2048, pssKb: 1024});
  fs.rmSync(path.join(d, '11', 'smaps_rollup'));
  assert.equal(p.clusterMemory(10, d).pssKb, null, 'an unreadable Pss is reported as unknown, not as zero');
  assert.equal(p.memory(12345, d), null);
});

test('live: this process passes a proof against its own CPUs and fails one against any other set', {skip: process.platform !== 'linux'}, () => {
  const own = p.cpus(require('./sched.cjs').allowed());
  assert.equal(p.proof({client: {set: own, roles: {self: {pid: process.pid, family: false}}}}).ok, true);
  const other = own.length > 1 ? own.slice(0, 1) : [own[0] + 1];
  assert.equal(p.proof({client: {set: other, roles: {self: {pid: process.pid, family: false}}}}).ok, false);
  const times = p.cpuTimes();
  for (const n of own) assert.ok(times[n] && times[n].idle >= 0);
});
