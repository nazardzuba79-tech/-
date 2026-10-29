import { SimError } from './engine.mjs';

// #613 R9 prototype, off unless createServer({ viewerStream: true }); the release entrypoint never sets it and the
// terminal does not use it. Viewers of an instrument receive its public quote as server-sent events once a period
// instead of each polling the whole state: the quote is read once (the shared quote reader) and serialized once per
// instrument, then written to every subscriber of it. Nothing personal travels on a stream: no account, wallet,
// position, order or token, only the instrument's public quote as the state answer projects it.
// Live authorization stays per delivery: before every event each subscriber's bearer is judged live again (the gateway
// multiplexes those checks into its usual identity batches) and a stream whose session was signed out, blocked or now
// answers for another principal gets `event: revoked` and is closed; nothing is remembered between two deliveries.
// Bounded: at most maxStreams streams (beyond that the caller answers 503 with Retry-After), a subscriber that does not
// read is closed once maxBufferedBytes wait for it, and an instrument without a live quote gets `event: unavailable`.
export function createViewerStream({ authorize, readQuote, project, onDelivered = () => {}, now = Date.now, timers = globalThis, periodMs = 1000, maxStreams = 64, maxBufferedBytes = 64 * 1024 }) {
  const streams = new Set(), counters = { opened: 0, delivered: 0, revoked: 0, slow: 0, refused: 0, waits: 0, unavailable: 0, ticks: 0 };
  let timer = null, running = false, closed = false;
  const event = (name, data) => 'event: ' + name + '\ndata: ' + JSON.stringify(data) + '\n\n';
  const drop = stream => { streams.delete(stream); if (!streams.size && timer) { timers.clearInterval(timer); timer = null; } };
  async function tick() {
    if (running || closed) return; running = true; counters.ticks++;
    try {
      const subscribers = [...streams];
      const ids = [...new Set(subscribers.map(s => s.instrumentId))], payloads = new Map();
      await Promise.all(ids.map(async id => {
        try { payloads.set(id, event('quote', { instrumentId: id, serverTime: now(), quote: project(id, await readQuote(id)) })); }
        catch (error) { counters.unavailable++; payloads.set(id, event('unavailable', { instrumentId: id, error: error instanceof SimError ? error.code : 'SOURCE_UNAVAILABLE' })); }
      }));
      // One live judgement per subscriber per delivery, made after the previous delivery; the checks of one tick
      // travel together in the gateway's identity batches.
      const judged = await Promise.allSettled(subscribers.map(s => authorize(s.authorization)));
      judged.forEach((result, i) => {
        const s = subscribers[i];
        if (!streams.has(s) || s.res.destroyed) return drop(s);
        if (result.status === 'fulfilled' && result.value === s.principalId) {
          if (s.res.writableLength > maxBufferedBytes) { counters.slow++; s.res.destroy(); return drop(s); }
          s.res.write(payloads.get(s.instrumentId)); counters.delivered++; onDelivered(s); return;
        }
        const code = result.status === 'rejected' ? result.reason?.code : 'AUTH_REQUIRED';
        if (code === 'AUTH_RATE_LIMIT' || code === 'AUTH_UNAVAILABLE') {
          // Not judged this time: no price this period, the stream stays and is judged again next period.
          counters.waits++; s.res.write(event('wait', { retryAfterMs: Number.isInteger(result.reason?.retryAfterMs) ? result.reason.retryAfterMs : periodMs })); return;
        }
        counters.revoked++; s.res.end(event('revoked', {})); drop(s);
      });
    } finally { running = false; }
  }
  return {
    // After the request's own live identity check: principalId is the account it answered for.
    open(res, { authorization, principalId, instrumentId }) {
      if (closed || streams.size >= maxStreams) { counters.refused++; throw Object.assign(new SimError('SOURCE_BUSY'), { retryAfterMs: 1000 }); }
      const stream = { res, authorization, principalId, instrumentId };
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
      res.write(': open\n\n'); streams.add(stream); counters.opened++;
      res.once('close', () => drop(stream));
      if (!timer) timer = timers.setInterval(() => void tick(), periodMs);
      return stream;
    },
    tick,
    metrics: () => ({ ...counters, streams: streams.size }),
    close() { closed = true; if (timer) { timers.clearInterval(timer); timer = null; } for (const s of streams) s.res.end(); streams.clear(); },
  };
}
