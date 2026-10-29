// #613 R9 micro-benchmark (report only, never run by CI): the gateway's own CPU for 50 viewers that poll their state
// every second (the acceptance scenario) against the same 50 viewers on the opt-in event stream (viewer-stream.mjs),
// one event a second. The gateway runs in a child process (createServer with an in-process authority double that
// answers identity batches at once and a synthetic quote hub), pinned to CPUs 0,1 when the host has 4; the viewers run
// in this process. Usage: node r9-stream.bench.mjs [seconds=20] [rounds=2]
import { fork, execFileSync } from 'node:child_process';
import http from 'node:http';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

if (process.argv[2] === 'gateway') {
  const { createServer } = await import('../server.mjs');
  const { createAuthorityAdapter } = await import('../authority-adapter.mjs');
  const { CATALOG } = await import('../catalog.mjs');
  const ISSUER = 'r9-stream-bench';
  const adapter = createAuthorityAdapter({ endpoint: 'http://127.0.0.1:1/api/v1/stocks-test-cash', issuer: ISSUER, gatewayKey: 'synthetic-r9-stream-bench-capability-0000',
    fetchImpl: async (_url, options) => new Response(JSON.stringify({ results: JSON.parse(options.body).tokens.map(token => ({ issuer: ISSUER, subject: 'viewer-' + token.slice(0, 8) })) })) });
  const quoteOf = id => ({ instrumentId: id, provider: 'bybit', nativeCurrency: 'USDT', bid: '100', ask: '100.5', timestamp: Date.now(), receivedAt: Date.now(), verified: true, marketOpen: true, eventId: 'bench-' + Date.now(), capacity: '1.00000000', prices: { USDT: { buy: '100.5', sell: '100' }, USDC: { buy: '100.5', sell: '100' } }, fx: {} });
  const app = await createServer({ port: 0, autoPoll: false, financialEnabled: true, accountAuthority: adapter, viewerStream: true,
    tradePrincipals: [{ issuer: ISSUER, subject: 'trader-a' }, { issuer: ISSUER, subject: 'trader-b' }],
    hub: { metrics: {}, close() {}, catalogue: async () => CATALOG.map(asset => ({ ...asset, online: true, exists: true })), quote: async id => quoteOf(id), setStockDemand() {} } });
  process.send({ port: app.port });
  process.on('message', m => { if (m === 'cpu') process.send({ cpu: process.cpuUsage(), streams: app.streamMetrics() }); });
} else {
  const seconds = Number(process.argv[2] || 20), rounds = Number(process.argv[3] || 2);
  const child = fork(fileURLToPath(import.meta.url), ['gateway'], { stdio: ['ignore', 'inherit', 'inherit', 'ipc'] });
  const { port } = await new Promise(resolve => child.once('message', resolve));
  if (os.cpus().length === 4) { execFileSync('taskset', ['-a', '-p', '-c', '0,1', String(child.pid)], { stdio: 'ignore' }); execFileSync('taskset', ['-a', '-p', '-c', '2,3', String(process.pid)], { stdio: 'ignore' }); }
  const cpu = () => new Promise(resolve => { child.once('message', resolve); child.send('cpu'); });
  const { CATALOG } = await import('../catalog.mjs');
  const ids = CATALOG.filter(i => i.provider === 'bybit').slice(0, 20).map(i => i.id);
  const token = i => ('v' + String(i).padStart(7, '0')).repeat(4);
  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
  const agent = new http.Agent({ keepAlive: true, maxSockets: 256 });
  async function polling(ms) {
    const end = Date.now() + ms; let answers = 0;
    await Promise.all(Array.from({ length: 50 }, async (_, i) => {
      await sleep(i * 20); const held = new Map();
      while (Date.now() < end) {
        const started = Date.now();
        await new Promise((resolve, reject) => http.get({ host: '127.0.0.1', port, agent, path: '/__stocks_global/state?id=' + encodeURIComponent(ids[i % ids.length]) + (held.has(i) ? '&catalogue=' + held.get(i) : ''), headers: { authorization: 'Bearer ' + token(i) } }, res => {
          let body = ''; res.on('data', c => body += c); res.on('end', () => { try { const j = JSON.parse(body); if (j.catalogueVersion) held.set(i, j.catalogueVersion); } catch {} answers++; resolve(); });
        }).on('error', reject));
        await sleep(Math.max(0, 1000 - (Date.now() - started)));
      }
    }));
    return answers;
  }
  async function streaming(ms) {
    let events = 0; const requests = [], others = {};
    const statuses = {};
    await Promise.all(Array.from({ length: 50 }, (_, i) => new Promise(resolve => { const r = http.get({ host: '127.0.0.1', port, agent: false, path: '/__stocks_global/stream?id=' + encodeURIComponent(ids[i % ids.length]), headers: { authorization: 'Bearer ' + token(i) } }, res => { statuses[res.statusCode] = (statuses[res.statusCode] ?? 0) + 1; res.setEncoding('utf8'); res.on('data', chunk => { events += (chunk.match(/event: quote/g) ?? []).length; for (const other of chunk.match(/event: (?!quote)\w+/g) ?? []) others[other] = (others[other] ?? 0) + 1; }); resolve(); }); requests.push(r); })));
    const start = events; await sleep(ms); const delivered = events - start;
    for (const r of requests) r.destroy();
    console.log('stream opens', JSON.stringify(statuses), 'other events', JSON.stringify(others));
    return delivered;
  }
  const results = [];
  for (let r = 0; r < rounds; r++) for (const [kind, run] of (r % 2 ? [['streaming', streaming], ['polling', polling]] : [['polling', polling], ['streaming', streaming]])) {
    await (kind === 'polling' ? polling(3000) : streaming(3000)); await sleep(1500);
    const a = await cpu(); const count = await run(seconds * 1000); const b = await cpu();
    results.push({ kind, gatewayCpuMs: Math.round((b.cpu.user + b.cpu.system - a.cpu.user - a.cpu.system) / 1000), answersOrEvents: count, ...(kind === 'streaming' ? { streamMetrics: b.streams } : {}) });
    console.log(JSON.stringify(results.at(-1))); await sleep(2000);
  }
  const mean = kind => Math.round(results.filter(x => x.kind === kind).reduce((s, x) => s + x.gatewayCpuMs, 0) / rounds);
  console.log(JSON.stringify({ seconds, rounds, meanGatewayCpuMs: { polling: mean('polling'), streaming: mean('streaming') } }));
  child.kill(); process.exit(0);
}
