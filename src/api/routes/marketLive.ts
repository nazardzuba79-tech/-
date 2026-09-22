import { Router, type Request, type Response } from 'express';
import zlib from 'node:zlib';
import type { LiveSource, LiveFrame } from '../../services/marketData/live/contract';

/**
 * What the stream writer needs from whatever it is writing into: a raw
 * `Response`, or a gzip stream sitting in front of one. Express's own
 * `Response` satisfies this structurally, so nothing that already passes a
 * response keeps working by accident — it keeps working by type.
 */
export interface LiveSink {
  write(chunk: string): boolean;
  on(event: 'drain', listener: () => void): unknown;
  off(event: 'drain', listener: () => void): unknown;
  destroy(): void;
}

/**
 * Compress the event stream, which is ~90% redundant text.
 *
 * Measured on 44s of real production traffic — 105 frames, 5 291 delta
 * rows: 4 230 KB uncompressed (95.4 KB/s per connected browser) against
 * 465 KB gzipped (10.5 KB/s). An **89% reduction**, and every byte of it is
 * Render egress that a connected tab was paying for.
 *
 * Also measured, and the reason this PR does NOT do the other thing:
 * stripping the 11 immutable identity fields from delta rows saves 25.6% on
 * its own, but only 2.5 points more once gzip is applied (91.5% vs 89.0%) —
 * because those repeated fields are exactly what a compressor eats for
 * free. That change would have meant a new wire format, a client-side merge
 * instead of a row replace, relaxed per-row validation, and a version
 * negotiation across a live financial stream with strict gap detection. Not
 * worth 2.5 points.
 *
 * The flush is the part that matters. A compressor buffers by design, so
 * without an explicit sync flush after every event the frames would sit in
 * zlib and the stream would look frozen — the one way this change could
 * break SSE. Every write is followed by `Z_SYNC_FLUSH`, which emits a
 * complete deflate block and leaves the stream open.
 *
 * Backpressure is preserved rather than reimplemented: `gzip.write()`
 * reports the same "buffer is full" signal `res.write()` did, and the pipe
 * carries the socket's own backpressure back into it, so the caller's
 * blocked/drain handling is untouched.
 */
function gzipSink(res: Response): LiveSink {
  const gzip = zlib.createGzip();
  gzip.pipe(res);
  // The socket going away must not leave the compressor attached to it.
  res.once('close', () => { if (!gzip.destroyed) gzip.destroy(); });
  return {
    write(chunk) {
      const accepted = gzip.write(chunk);
      // Without this the event never reaches the browser until zlib's
      // buffer happens to fill.
      gzip.flush(zlib.constants.Z_SYNC_FLUSH);
      return accepted;
    },
    on: (event, listener) => gzip.on(event, listener),
    off: (event, listener) => gzip.off(event, listener),
    // Destroying the response, not the compressor: the caller uses this to
    // drop a client that has been blocked too long, and that means the
    // socket.
    destroy: () => res.destroy(),
  };
}

/** Browsers all send `Accept-Encoding: gzip`, so this is effectively on —
 *  but a client that does not ask still gets plain text, and
 *  `MARKET_LIVE_SSE_GZIP=0` turns it off without a code change. */
export function shouldGzipLiveStream(req: Request, env: NodeJS.ProcessEnv = process.env): boolean {
  if (env.MARKET_LIVE_SSE_GZIP === '0') return false;
  return /\bgzip\b/i.test(req.header('accept-encoding') ?? '');
}

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
export function writeLiveStream(res: LiveSink, source: LiveSource, onTerminate: SseTerminationLogger = () => {}): (reason?: SseTerminationReason) => void {
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
    // `!!source` matters: headers are flushed below for BOTH paths, so a
    // Content-Encoding decided here can no longer be taken back. The
    // disabled path writes one plain frame and closes, so it must never be
    // labelled gzip in the first place.
    const gzip = !!source && shouldGzipLiveStream(req);
    res.set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
    // `no-transform` above still stands: it tells intermediaries not to
    // re-encode what we send. Encoding it ourselves is a different thing,
    // and `Vary` keeps a cache from handing a gzipped stream to a client
    // that never asked for one.
    if (gzip) res.set({ 'Content-Encoding': 'gzip', Vary: 'Accept-Encoding' });
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
    const sink: LiveSink = gzip ? gzipSink(res) : res;
    const cleanup = writeLiveStream(sink, source, event=>logTermination({...event,...(correlationId?{correlationId}:{})}));
    let released=false;
    const finish=(reason:SseTerminationReason)=>{if(!released){released=true;clients--;}cleanup(reason);};
    res.once('finish',()=>finish('response_finish'));res.once('error',()=>finish('response_error'));
    res.once('close',()=>finish(res.writableFinished?'response_finish':'peer_close'));
  });
  return router;
}
