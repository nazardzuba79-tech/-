import http from 'node:http';
import { createHash } from 'node:crypto';
export function profileBody(subject, large = false) {
  // A valid 1x1 PNG plus retained trailing whitespace, accepted by the avatar upload envelope.
  const canonical = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j5XcAAAAASUVORK5CYII=';
  const avatarUrl = large ? canonical + ' '.repeat(1048000 - Buffer.byteLength(JSON.stringify({ image: canonical }))) : null;
  return Buffer.from(JSON.stringify({ id: subject, email: subject + '@isolated.invalid', avatarUrl, displayName: 'Тест', phone: null, country: 'UA', role: 'USER', isAdmin: false, kycStatus: 'NONE', twoFactorEnabled: false, createdAt: '2026-10-13T00:00:00.000Z' }));
}
export async function startAuthority({ port, large = false, nonce }) {
  const bodies = new Map(), stats = { attempts: 0, completed: 0, closedEarly: 0, bytes: 0, inflight: 0, maxInflight: 0, bodyHashes: {} };
  let maxRss = process.memoryUsage().rss;
  const timer = setInterval(() => { maxRss = Math.max(maxRss, process.memoryUsage().rss); }, 100); timer.unref();
  const server = http.createServer((req, res) => {
    if (req.url === '/metrics' && req.headers['x-fixture-control'] === nonce) {
      res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ ...stats, cpu: process.cpuUsage(), memory: process.memoryUsage(), maxRss })); return;
    }
    const match = /^Bearer targeted-fixture-(owner|viewer-\d{1,2})$/.exec(req.headers.authorization || '');
    if (req.method !== 'GET' || req.url !== '/api/v1/me' || !match) { res.writeHead(401); res.end('{}'); return; }
    stats.attempts++; stats.inflight++; stats.maxInflight = Math.max(stats.maxInflight, stats.inflight);
    let finished = false; const finish = complete => { if (!finished) { finished = true; stats.inflight--; stats[complete ? 'completed' : 'closedEarly']++; } };
    res.once('finish', () => finish(true)); res.once('close', () => finish(res.writableFinished));
    const subject = match[1]; if (!bodies.has(subject)) { const body = profileBody(subject, large); bodies.set(subject, body); stats.bodyHashes[subject] = { bytes: body.length, sha256: createHash('sha256').update(body).digest('hex') }; }
    const body = bodies.get(subject); stats.bytes += body.length;
    res.writeHead(200, { 'Content-Type': 'application/json', 'Content-Length': body.length }); res.end(body);
  });
  await new Promise(ok => server.listen(port, '127.0.0.1', ok));
  return { metrics: () => ({ ...stats, bodyHashes: { ...stats.bodyHashes }, cpu: process.cpuUsage(), memory: process.memoryUsage(), maxRss }),
    close: async () => { clearInterval(timer); server.closeAllConnections(); await new Promise(ok => server.close(ok)); } };
}
if (process.argv[1]?.endsWith('/authority.mjs') || process.argv[1]?.endsWith('\\authority.mjs')) {
  const f = await startAuthority({ port: Number(process.env.TARGETED_AUTH_PORT), large: process.env.TARGETED_LARGE_ME === 'true', nonce: process.env.TARGETED_NONCE });
  process.on('message', message => { if (message?.type === 'metrics') process.send?.({ id: message.id, metrics: f.metrics() }); });
  process.send?.({ ready: true });
  process.once('SIGTERM', () => { void f.close().then(() => process.exit(0)); });
}
