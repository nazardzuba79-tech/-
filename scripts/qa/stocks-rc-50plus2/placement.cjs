'use strict';
// #613 R8 isolated-client placement (diagnostic-run-613.cjs --isolated-clients). The server side (PostgreSQL, the
// crypto API, the Stocks authority and gateway) gets exactly the CPUs of SERVER and nothing else; the load driver
// (the 50 viewers', 2 traders' and crypto clients) and the synthetic market (the stand-in for the external exchanges)
// get CLIENT. Linux only; everything is read from /proc and /sys, nothing is changed here.
const fs = require('node:fs');
const SERVER = '0,1', CLIENT = '2,3';

// '0-1,3' -> [0, 1, 3]; throws on anything else.
function cpus(list) {
  if (typeof list !== 'string' || !/^\d+(-\d+)?(,\d+(-\d+)?)*$/.test(list.trim())) throw Error('CPU_LIST_INVALID');
  const out = [];
  for (const range of list.trim().split(',')) { const [a, b = a] = range.split('-').map(Number); if (b < a) throw Error('CPU_LIST_INVALID'); for (let n = a; n <= b; n++) out.push(n); }
  return [...new Set(out)].sort((x, y) => x - y);
}
const same = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);

// Hardware threads of each CPU: its SMT siblings, core and package (sysfs topology), and whether it is online.
function topology(numbers, sys = '/sys/devices/system/cpu') {
  const read = file => fs.readFileSync(file, 'utf8').trim();
  return Object.fromEntries(numbers.map(n => {
    const dir = sys + '/cpu' + n;
    let online = true; try { online = read(dir + '/online') === '1'; } catch {} // cpu0 often has no 'online' file
    try { return [n, {online, siblings: cpus(read(dir + '/topology/thread_siblings_list')), core: Number(read(dir + '/topology/core_id')), packageId: Number(read(dir + '/topology/physical_package_id'))}]; }
    catch { return [n, {online: false, siblings: null, core: null, packageId: null}]; }
  }));
}

// The two sets must be disjoint and each must hold whole physical cores: no client CPU may be an SMT sibling of a
// server CPU, or the clients would still take execution resources from the server's core.
function checkSets(server, client, topo) {
  const failures = [];
  if (server.length !== 2) failures.push('SERVER_SET_NOT_TWO_CPUS');
  if (!client.length) failures.push('CLIENT_SET_EMPTY');
  if (server.some(n => client.includes(n))) failures.push('SETS_OVERLAP');
  for (const [name, set] of [['SERVER', server], ['CLIENT', client]]) for (const n of set) {
    const t = topo[n];
    if (!t || !t.online || !t.siblings) { failures.push(name + '_CPU_OFFLINE_OR_UNKNOWN:' + n); continue; }
    if (t.siblings.some(s => !set.includes(s))) failures.push(name + '_CPU_SHARES_A_CORE_OUTSIDE_ITS_SET:' + n);
  }
  return failures;
}

// Every thread of a process with its allowed CPUs (/proc/<pid>/task/<tid>/status).
function threads(pid, proc = '/proc') {
  const out = [];
  for (const tid of fs.readdirSync(proc + '/' + pid + '/task')) try {
    const status = fs.readFileSync(proc + '/' + pid + '/task/' + tid + '/status', 'utf8');
    out.push({tid: Number(tid), name: (status.match(/^Name:\s*(.*)$/m) || [])[1] ?? '', allowed: cpus((status.match(/^Cpus_allowed_list:\s*(\S+)/m) || [])[1])});
  } catch {} // a thread that exited meanwhile
  return out;
}
// The process and all its live descendants (PostgreSQL backends are children of the postmaster).
function family(root, proc = '/proc') {
  const parent = new Map();
  for (const name of fs.readdirSync(proc)) if (/^\d+$/.test(name)) try {
    const stat = fs.readFileSync(proc + '/' + name + '/stat', 'utf8');
    parent.set(Number(name), Number(stat.slice(stat.lastIndexOf(')') + 2).split(' ')[1]));
  } catch {}
  const out = [root];
  for (let i = 0; i < out.length; i++) for (const [pid, ppid] of parent) if (ppid === out[i] && !out.includes(pid)) out.push(pid);
  return out;
}
// Placement proof at one moment: every thread of every process of each side may run only on exactly that side's
// CPUs. sides: {side: {set: [cpus], roles: {role: {pid, family}}}}; with family the process's live descendants are
// judged too (PostgreSQL backends, the Stocks processes the API worker forks). Each process is judged once, under the
// first role that reaches it. A role's own process that is gone is a violation.
function proof(sides, proc = '/proc') {
  const result = {roles: {}, violations: [], checkedThreads: 0}, seen = new Set();
  for (const [side, {set, roles}] of Object.entries(sides)) for (const [role, {pid, family: descendants}] of Object.entries(roles)) {
    let pids; try { pids = descendants ? family(pid, proc) : [pid]; } catch { pids = [pid]; }
    let count = 0, processes = 0;
    for (const p of pids) {
      if (seen.has(p)) continue; seen.add(p);
      let list; try { list = threads(p, proc); } catch { list = []; }
      if (!list.length) { if (p === pid) result.violations.push(side + ':' + role + ':PROCESS_GONE'); continue; }
      processes++;
      for (const t of list) { count++; if (!same(t.allowed, set)) result.violations.push(side + ':' + role + ':' + p + '/' + t.tid + '(' + t.name + ')=' + t.allowed.join(',')); }
    }
    result.roles[side + ':' + role] = {pid, processes, threads: count};
    result.checkedThreads += count;
  }
  result.ok = result.violations.length === 0;
  return result;
}

// Per-CPU time from /proc/stat in ms (USER_HZ ticks): user, nice, system, idle, iowait, irq, softirq, steal.
const FIELDS = ['user', 'nice', 'system', 'idle', 'iowait', 'irq', 'softirq', 'steal'];
function cpuTimes(text = fs.readFileSync('/proc/stat', 'utf8'), hz = 100) {
  const out = {};
  for (const line of text.split('\n')) {
    const m = line.match(/^cpu(\d+)\s+(.*)$/); if (!m) continue;
    const v = m[2].trim().split(/\s+/).map(Number);
    out[m[1]] = Object.fromEntries(FIELDS.map((k, i) => [k, (v[i] ?? 0) * 1000 / hz]));
  }
  return out;
}
// Time per category over a window, summed over one set of CPUs; busy = everything but idle and iowait. capacityMs is
// the set's wall-clock capacity (CPUs x elapsed), so busy / capacity is the set's utilisation.
function setUsage(before, after, set, elapsedMs) {
  const sum = Object.fromEntries(FIELDS.map(k => [k + 'Ms', set.reduce((t, n) => t + ((after[n]?.[k] ?? NaN) - (before[n]?.[k] ?? NaN)), 0)]));
  sum.busyMs = sum.userMs + sum.niceMs + sum.systemMs + sum.irqMs + sum.softirqMs + sum.stealMs;
  sum.capacityMs = set.length * elapsedMs;
  sum.utilization = sum.capacityMs > 0 ? sum.busyMs / sum.capacityMs : null;
  return sum;
}

// Memory of one process (VmRSS and its peak VmHWM, kB) and, with smaps_rollup, its proportional share (Pss, kB) —
// the PostgreSQL cluster's shared buffers count once when the Pss of its processes is summed.
function memory(pid, proc = '/proc') {
  try {
    const status = fs.readFileSync(proc + '/' + pid + '/status', 'utf8'), kb = key => Number((status.match(new RegExp('^' + key + ':\\s*(\\d+)\\s*kB', 'm')) || [])[1]);
    let pssKb = null; try { pssKb = Number((fs.readFileSync(proc + '/' + pid + '/smaps_rollup', 'utf8').match(/^Pss:\s*(\d+)\s*kB/m) || [])[1]); } catch {}
    return {rssKb: kb('VmRSS'), hwmKb: kb('VmHWM'), pssKb: Number.isFinite(pssKb) ? pssKb : null};
  } catch { return null; }
}
function clusterMemory(root, proc = '/proc') {
  let rssKb = 0, pssKb = 0, processes = 0, pssComplete = true;
  for (const pid of family(root, proc)) { const m = memory(pid, proc); if (!m) continue; processes++; rssKb += m.rssKb || 0; if (m.pssKb === null) pssComplete = false; else pssKb += m.pssKb; }
  return {processes, rssKb, pssKb: pssComplete ? pssKb : null};
}

module.exports = {SERVER, CLIENT, cpus, same, topology, checkSets, threads, family, proof, cpuTimes, setUsage, memory, clusterMemory, FIELDS};
