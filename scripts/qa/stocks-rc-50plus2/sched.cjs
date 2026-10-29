'use strict';
// Report only. Linux scheduler accounting of one process (/proc/<pid>/task/*/schedstat: time on a CPU and time
// spent runnable but waiting for one, in ns), for the main thread and summed over all threads (Prisma's query
// engine works on its own threads). Waiting time that grows between two arms means CPU contention. null where
// /proc has no schedstat (non-Linux, or the process is gone).
const fs = require('node:fs');
function read(pid = 'self') {
  try {
    const parse = file => fs.readFileSync(file, 'utf8').trim().split(/\s+/).map(Number);
    const [mainCpuNs, mainDelayNs] = parse(`/proc/${pid}/schedstat`);
    let cpuNs = 0, delayNs = 0, threads = 0;
    for (const task of fs.readdirSync(`/proc/${pid}/task`)) try { const [c, d] = parse(`/proc/${pid}/task/${task}/schedstat`); cpuNs += c; delayNs += d; threads++; } catch {}
    return [mainCpuNs, mainDelayNs, cpuNs, delayNs].every(Number.isFinite) ? {mainCpuNs, mainDelayNs, cpuNs, delayNs, threads} : null;
  } catch { return null; }
}
// Runnable-but-waiting milliseconds between two reads of the same process (main thread and all threads).
const delayMs = (before, after) => before && after ? {main: (after.mainDelayNs - before.mainDelayNs) / 1e6, all: (after.delayNs - before.delayNs) / 1e6,
  cpuMain: (after.mainCpuNs - before.mainCpuNs) / 1e6, cpuAll: (after.cpuNs - before.cpuNs) / 1e6} : null;
// Scheduling class of every thread of one process ('policy/nice' -> thread count; Linux policy 0 = normal,
// 5 = idle), from /proc/<pid>/task/*/stat fields 41 and 19. null where /proc has no such file.
function policies(pid = 'self') {
  try {
    const counts = {};
    for (const task of fs.readdirSync(`/proc/${pid}/task`)) try {
      const stat = fs.readFileSync(`/proc/${pid}/task/${task}/stat`, 'utf8'), fields = stat.slice(stat.lastIndexOf(')') + 2).split(' ');
      const key = fields[38] + '/' + fields[16]; counts[key] = (counts[key] ?? 0) + 1;
    } catch {}
    return Object.keys(counts).length ? counts : null;
  } catch { return null; }
}
// CPUs one process's main thread may run on (/proc/<pid>/status Cpus_allowed_list), or null.
function allowed(pid = 'self') {
  try { return (fs.readFileSync(`/proc/${pid}/status`, 'utf8').match(/^Cpus_allowed_list:\s*(\S+)/m) || [])[1] ?? null; } catch { return null; }
}
module.exports = {read, delayMs, policies, allowed};
