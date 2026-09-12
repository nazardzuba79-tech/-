import { Router, type Request, type Response } from 'express';
import type { LiveSource, LiveFrame } from '../../services/marketData/live/contract';

export type SseTerminationReason = 'peer_close' | 'response_finish' | 'response_error' | 'backpressure_destroy' | 'server_cleanup';
export type SseTerminationEvent = {
  event: 'market_sse_terminated';
  reason: SseTerminationReason;
  elapsedMs: number;
  blockedMs: number;
  backpressureActive: boolean;
  correlationId?: string;
};
type SseTerminationLogger = (event: SseTerminationEvent) => void;

function safeCorrelationId(req: Request): string | undefined {
  const value = req.header('cf-ray')?.trim();
  return value && /^[A-Fa-f0-9]{16}(?:-[A-Za-z]{3})?$/.test(value) ? value : undefined;
}
function defaultTerminationLogger(event: SseTerminationEvent): void {
  console.info(JSON.stringify(event));
}

/** No queue of deltas: a blocked writer gets ONE latest snapshot on drain.
 * A permanently slow client is closed and reconnects from current state. */
export function writeLiveStream(res: Response, source: LiveSource, onTerminate: SseTerminationLogger = () => {}): (reason?: SseTerminationReason) => void {
  const startedAt = Date.now();
  let blocked = false, dirty = false, blockedAt = 0, closed = false, pendingReason: SseTerminationReason | null = null;
  const cleanup = (reason: SseTerminationReason = 'server_cleanup') => {
    if (closed) return;
    const now = Date.now();
    closed = true; clearInterval(heartbeat); res.off('drain', drain); unsubscribe();
    try{onTerminate({ event: 'market_sse_terminated', reason: pendingReason ?? reason, elapsedMs: Math.max(0, now - startedAt),
      blockedMs: blocked ? Math.max(0, now - blockedAt) : 0, backpressureActive: blocked });}catch{}
  };
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
    if (blocked) { if (Date.now() - blockedAt > 30_000) { pendingReason='backpressure_destroy';res.destroy(); } return; }
    write({ ...source.snapshot(), type: 'state', rows: [] });
  }, 15_000);
  return cleanup;
}
export function marketLiveRouter(source: LiveSource | null, logTermination: SseTerminationLogger = defaultTerminationLogger): Router {
  const router = Router();
  let clients = 0;
  router.get('/market/live', (req,res) => {
    if (clients >= 2000) { res.status(503).end(); return; }
    res.set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
    res.flushHeaders();
    if (!source) {
      const startedAt=Date.now(),correlationId=safeCorrelationId(req);let logged=false;
      const finish=(reason:SseTerminationReason)=>{if(logged)return;logged=true;try{logTermination({event:'market_sse_terminated',reason,
        elapsedMs:Math.max(0,Date.now()-startedAt),blockedMs:0,backpressureActive:false,...(correlationId?{correlationId}:{})});}catch{}};
      res.once('finish',()=>finish('response_finish'));res.once('error',()=>finish('response_error'));
      res.once('close',()=>finish(res.writableFinished?'response_finish':'peer_close'));
      res.end('event: state\ndata: {"version":1,"type":"state","status":"disabled","rows":[]}\n\n'); return;
    }
    clients++;
    const correlationId=safeCorrelationId(req);
    const cleanup = writeLiveStream(res, source, event=>logTermination({...event,...(correlationId?{correlationId}:{})}));
    let released=false;
    const finish=(reason:SseTerminationReason)=>{if(!released){released=true;clients--;}cleanup(reason);};
    res.once('finish',()=>finish('response_finish'));res.once('error',()=>finish('response_error'));
    res.once('close',()=>finish(res.writableFinished?'response_finish':'peer_close'));
  });
  return router;
}
