import express from 'express';
import { createServer } from 'http';
import { timingSafeEqual } from 'crypto';
import { WebSocketServer, WebSocket } from 'ws';
import type { LiveSource, LiveFrame } from './contract';

export function collectorServer(source: LiveSource, token: string, diagnostics: () => unknown) {
  if (!token.trim()) throw new Error('MARKET_DATA_COLLECTOR_TOKEN is required');
  const authorized = (header?: string) => {
    const actual = Buffer.from(header ?? ''), expected = Buffer.from(`Bearer ${token}`);
    return actual.length === expected.length && timingSafeEqual(actual, expected);
  };
  const app = express();
  app.disable('x-powered-by');
  app.get('/health', (_req,res) => res.json({ ok: true, status: source.snapshot().status }));
  app.use('/internal', (req,res,next) => {
    if (!authorized(req.headers.authorization)) { res.sendStatus(401); return; }
    res.setHeader('Cache-Control', 'no-store'); next();
  });
  app.get('/internal/v1/snapshot', (_req,res) => res.json(source.snapshot()));
  app.get('/internal/v1/diagnostics', (_req,res) => res.json(diagnostics()));
  const server = createServer(app);
  const wss = new WebSocketServer({ noServer: true, maxPayload: 1024, perMessageDeflate: false });
  server.on('upgrade', (req,socket,head) => {
    if (req.url !== '/internal/v1/stream' || !authorized(req.headers.authorization) || wss.clients.size >= 32) {
      socket.end('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n'); return;
    }
    wss.handleUpgrade(req,socket,head,ws => wss.emit('connection',ws,req));
  });
  wss.on('connection', ws => {
    let needsSnapshot = false, blockedAt = 0, alive = true;
    const send = (frame: LiveFrame) => {
      if (ws.readyState !== WebSocket.OPEN) return;
      if (ws.bufferedAmount > 2_000_000) {
        needsSnapshot = true; blockedAt ||= Date.now();
        if (Date.now() - blockedAt > 30_000) ws.terminate();
        return;
      }
      const out = needsSnapshot ? source.snapshot() : frame;
      needsSnapshot = false; blockedAt = 0; ws.send(JSON.stringify(out));
    };
    const unsubscribe = source.subscribe(send);
    send(source.snapshot());
    const drain = setInterval(() => { if (needsSnapshot) send(source.snapshot()); }, 250);
    const heartbeat = setInterval(() => {
      if (!alive) { ws.terminate(); return; }
      alive = false; ws.ping();
      send({ ...source.snapshot(), type: 'state', rows: [] });
    }, 15_000);
    ws.on('pong', () => { alive = true; });
    ws.on('error', () => ws.terminate());
    ws.on('close', () => { clearInterval(heartbeat); clearInterval(drain); unsubscribe(); });
  });
  const close = () => { for (const ws of wss.clients) ws.terminate(); wss.close(); server.close(); };
  return { app, server, close };
}
