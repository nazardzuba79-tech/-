import { fork, spawnSync } from 'node:child_process';
import { createServer } from 'node:http';
import { readFileSync, readdirSync } from 'node:fs';
import { cgroupSnapshot, verifyBudget } from './metrics.mjs';
import { INERT, IDS } from './stocks-fixture.mjs';
if (process.env.CX23_DISPOSABLE !== 'true' || process.platform !== 'linux' || !/^[a-f0-9]{32}$/.test(process.env.CX23_RUN_ID || '')) throw Error('LINUX_DISPOSABLE_FIXTURE_REQUIRED');
const runId = process.env.CX23_RUN_ID;
const quota = cgroupSnapshot(); verifyBudget(quota);
const children = [], replies = new Map(); let serial = 0;
function start(file) {
  return new Promise((ok, fail) => {
    const child = fork(new URL(file, import.meta.url), [], { env: process.env, stdio: ['ignore', 'inherit', 'inherit', 'ipc'] });
    children.push(child); const timer = setTimeout(() => fail(Error('CHILD_START_TIMEOUT')), 20000);
    child.on('error', fail); child.on('exit', code => { if (code) fail(Error(`CHILD_EXIT_${code}`)); });
    child.on('message', m => { if (m.ready) { clearTimeout(timer); ok(child); } else if (m.id && replies.has(m.id)) { replies.get(m.id)(m.value); replies.delete(m.id); } });
  });
}
function metrics(child) {
  return new Promise((ok, fail) => { const id = ++serial; const t = setTimeout(() => { replies.delete(id); fail(Error('METRICS_TIMEOUT')); }, 3000); replies.set(id, value => { clearTimeout(t); ok(value); }); child.send({ type: 'metrics', id }); });
}
const hz = Number(spawnSync('getconf', ['CLK_TCK'], { encoding: 'utf8' }).stdout.trim());
function processes() {
  const result = [];
  for (const pid of readdirSync('/proc').filter(x => /^\d+$/.test(x))) {
    try {
      const stat = readFileSync(`/proc/${pid}/stat`, 'utf8'), end = stat.lastIndexOf(')'), name = stat.slice(stat.indexOf('(') + 1, end), fields = stat.slice(end + 2).split(' ');
      if (!['node', 'postgres'].includes(name)) continue;
      // utime/stime already include worker-thread CPU; do not add SQL worker CPU again.
      result.push({ pid: Number(pid), name, cpuMs: (Number(fields[11]) + Number(fields[12])) * 1000 / hz, rssBytes: Number(fields[21]) * 4096,
        cgroupMembership: readFileSync(`/proc/${pid}/cgroup`, 'utf8').trim() });
    } catch { /* a PostgreSQL process may exit between proc listing and reading */ }
  }
  return result;
}
const stocks = await start('./stocks-fixture.mjs'), crypto = await start('./crypto-fixture.cjs');
let simultaneousRssPeak = 0;
const sample = setInterval(() => { simultaneousRssPeak = Math.max(simultaneousRssPeak, processes().reduce((n, p) => n + p.rssBytes, 0)); }, 250); sample.unref();
const server = createServer(async (req, res) => {
  if (req.headers.host !== '127.0.0.1:18093') { res.writeHead(403); return res.end(); }
  try {
    if (req.method !== 'GET' || !['/health', '/metrics', '/metadata'].includes(req.url)) { res.writeHead(404); return res.end(); }
    const members = processes(), membership = readFileSync('/proc/self/cgroup', 'utf8').trim();
    if (!members.length || members.some(p => p.cgroupMembership !== membership)) throw Error('AGGREGATE_MEMBERSHIP_UNVERIFIED');
    const body = req.url === '/metadata' ? { fixture: true, catalogue: [...IDS.map(id => ({ id, fixture: true, metadataOnly: true })), ...INERT] } : req.url === '/health' ? { ready: true, quota, membership } : { at: Date.now(), cgroup: cgroupSnapshot(), processes: members, supervisorCpu: process.cpuUsage(), simultaneousSampledRssPeakBytes: simultaneousRssPeak,
      stocks: await metrics(stocks), crypto: await metrics(crypto) };
    res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ ...body, runId }));
  } catch (e) { res.writeHead(503); res.end(JSON.stringify({ error: e.message })); }
});
await new Promise(ok => server.listen(18093, '127.0.0.1', ok));
const stop = async () => { clearInterval(sample); await new Promise(ok => server.close(ok)); for (const c of children) c.kill('SIGTERM'); };
process.on('SIGTERM', stop);
