import { Router, type Response } from 'express';
import type { LiveSource, LiveFrame } from '../../services/marketData/live/contract';

/** No queue of deltas: a blocked writer gets ONE latest snapshot on drain.
 * A permanently slow client is closed and reconnects from current state. */
export function writeLiveStream(res: Response, source: LiveSource): () => void {
  let blocked = false, dirty = false, blockedAt = 0, closed = false;
  const write = (frame: LiveFrame) => {
    if (closed) return;
    if (blocked) { dirty = true; return; }
    blocked = !res.write(`event: ${frame.type}\ndata: ${JSON.stringify(frame)}\n\n`);
    if (blocked) blockedAt = Date.now();
  };
  const drain = () => { blocked = false; if (dirty) { dirty = false; write(source.snapshot()); } };
  res.on('drain', drain);
  const unsubscribe = source.subscribe(write);
  write(source.snapshot());
  const heartbeat = setInterval(() => {
    if (blocked) { if (Date.now() - blockedAt > 30_000) res.destroy(); return; }
    write({ ...source.snapshot(), type: 'state', rows: [] });
  }, 15_000);
  return () => { closed = true; clearInterval(heartbeat); res.off('drain', drain); unsubscribe(); };
}
export function marketLiveRouter(source: LiveSource | null): Router {
  const router = Router();
  let clients = 0;
  router.get('/market/live', (req,res) => {
    if (clients >= 2000) { res.status(503).end(); return; }
    res.set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
    res.flushHeaders();
    if (!source) {
      res.end('event: state\ndata: {"version":1,"type":"state","status":"disabled","rows":[]}\n\n'); return;
    }
    clients++;
    const cleanup = writeLiveStream(res, source);
    res.once('close', () => { clients--; cleanup(); });
  });
  return router;
}
