import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { verifySignedSnapshot } from './verify.mjs';

const CONTENT_LIMIT = 700000;
export function createPublicRelay({ snapshotPath, publicKey, clock = () => Date.now(), read = readFileSync, maxStreams = 64, tickMs = 1000 }) {
  if (!snapshotPath || !publicKey) throw new Error('public snapshot and verification key required');
  const streams = new Set();
  const headers = { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' };
  const readVerified = () => {
    const buf = read(snapshotPath);
    if (buf.length > CONTENT_LIMIT) throw new Error('SOURCE_UNAVAILABLE');
    return verifySignedSnapshot(JSON.parse(buf.toString()), publicKey, clock());
  };
  const response = (res, code, data) => {
    res.writeHead(code, { ...headers, 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(data));
  };
  const server = createServer((req, res) => {
    if (req.method !== 'GET') return response(res, 405, { error: 'METHOD_NOT_ALLOWED' });
    const url = new URL(req.url || '/', 'http://127.0.0.1');
    if (url.pathname === '/health' && !url.search) return response(res, 200, { status: 'ok', transport: 'public-only', streams: streams.size });
    if (!['/v1/public/ohlcv', '/v1/public/stream'].includes(url.pathname)) return response(res, 404, { error: 'NOT_FOUND' });
    if ([...url.searchParams.keys()].some(k => !['instrumentId','interval'].includes(k))
      || !url.searchParams.has('instrumentId') || !url.searchParams.has('interval')) return response(res, 400, { error: 'BAD_REQUEST' });
    const query = { instrumentId: url.searchParams.get('instrumentId'), interval: url.searchParams.get('interval') };
    let signed;
    try { signed = readVerified(); } catch { return response(res, 503, { error: 'SOURCE_UNAVAILABLE' }); }
    if (signed.id.instrumentId !== query.instrumentId || signed.id.interval !== query.interval)
      return response(res, 404, { error: 'SOURCE_UNAVAILABLE' });
    if (url.pathname === '/v1/public/ohlcv') return response(res, 200, signed.raw);
    if (streams.size >= maxStreams) {
      res.setHeader('Retry-After', '1');
      return response(res, 503, { error: 'SOURCE_BUSY' });
    }
    res.writeHead(200, { ...headers, 'Content-Type': 'text/event-stream; charset=utf-8', Connection: 'keep-alive' });
    const client = { res, query, last: '', timer: null, closed: false };
    streams.add(client);
    const deliver = () => {
      if (client.closed) return;
      let next;
      try { next = readVerified(); } catch { next = null; }
      const valid = next && next.id.instrumentId === query.instrumentId && next.id.interval === query.interval;
      const raw = valid ? JSON.stringify(next.raw) : '';
      const event = valid ? `event: signed-page\ndata: ${raw}\n\n` : 'event: unavailable\ndata: {}\n\n';
      if ((raw || 'unavailable') !== client.last) {
        if (res.writableLength > 65536) return res.destroy();
        res.write(event);
        client.last = raw || 'unavailable';
      }
    };
    const close = () => { if (client.closed) return; client.closed = true; clearInterval(client.timer); streams.delete(client); };
    res.once('close', close);
    deliver();
    client.timer = setInterval(deliver, tickMs);
    client.timer.unref?.();
  });
  return { server, activeStreams: () => streams.size, close: () => new Promise(resolve => { for (const c of streams) c.res.destroy(); server.close(resolve); }) };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const host = '127.0.0.1';
  const port = Number(process.env.VOLTEX_PUBLIC_RELAY_PORT || 4477);
  const snap = process.env.VOLTEX_PUBLIC_RELAY_SNAPSHOT;
  const keyPath = process.env.VOLTEX_PUBLIC_RELAY_PUBKEY_FILE;
  if (process.env.VOLTEX_PUBLIC_RELAY_ENABLE !== '1' || !snap || !keyPath || !Number.isInteger(port) || port < 1024 || port > 65535) {
    console.error('OFF: explicit enable, snapshot file and public key file required');
    process.exit(2);
  }
  const { server } = createPublicRelay({ snapshotPath: snap, publicKey: readFileSync(keyPath, 'utf8') });
  server.listen(port, host, () => console.info(`public read-only relay listening on ${host}:${port}; NOT a trade/quote authority`));
}
