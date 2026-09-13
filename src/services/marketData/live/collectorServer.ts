import express from 'express';
import { FuturesChartCandles } from '../../FuturesChartCandles';
import { createServer } from 'http';
import { timingSafeEqual } from 'crypto';
import { WebSocketServer, WebSocket } from 'ws';
import type { LiveSource, LiveFrame } from './contract';
import type { MarketUniverseSnapshot } from '../bybit/MarketUniverse';
import { BybitOptions, OptionsRequestError, optionQuerySchema } from '../bybit/BybitOptions';
import type { CfdQuote } from '../cfd/CfdQuote';
import { CFD_OHLC_INTERVALS, type CfdOhlcInterval, type CfdOhlcSnapshot } from '../cfd/BiquoteCfdOhlcSource';

export function collectorServer(
  source: LiveSource,
  token: string,
  diagnostics: () => unknown,
  options?: BybitOptions,
  universe?: () => MarketUniverseSnapshot,
  cfdDisplay?: {
    getQuotes: () => Promise<CfdQuote[]>;
    getOhlc?: (symbol:string,interval:CfdOhlcInterval,limit:number) => Promise<CfdOhlcSnapshot>;
    diagnostics?: () => unknown | Promise<unknown>;
  }
) {
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
  const futuresCandles=new FuturesChartCandles();
  app.get('/internal/v1/futures/candles/:pair',async(req,res)=>{
    try {res.json(await futuresCandles.get(req.params.pair,String(req.query.interval??'15m'),Number(req.query.limit??520)));}
    catch(error) {res.status(error instanceof RangeError?400:503).json({error:'candles_unavailable'});}
  });
  app.get('/internal/v1/diagnostics', async (_req,res) => {
    let cfd: unknown = null;
    if (typeof cfdDisplay?.diagnostics === 'function') {
      try { cfd = await cfdDisplay.diagnostics(); } catch { cfd = { unavailable:true }; }
    }
    res.json({ market: diagnostics(), cfdDisplay: cfd });
  });
  app.get('/internal/v1/universe', (_req,res) => {
    if (!universe) { res.status(503).json({ error:'universe_unavailable' }); return; }
    res.json(universe());
  });
  app.get('/internal/v1/cfd/tickers', async (_req,res) => {
    if (!cfdDisplay) { res.status(503).json({ error:'cfd_display_unavailable' }); return; }
    try {
      const quotes = await cfdDisplay.getQuotes();
      res.json({ generatedAt:Date.now(), quotes });
    } catch {
      res.status(503).json({ error:'cfd_display_unavailable' });
    }
  });
  app.get('/internal/v1/cfd/ohlc/:symbol', async (req,res) => {
    if (!cfdDisplay?.getOhlc) { res.status(503).json({ error:'cfd_ohlc_unavailable' }); return; }
    const interval=typeof req.query.interval==='string'?req.query.interval:'15m';
    const limit=Math.max(20,Math.min(500,Number(req.query.limit)||240));
    if(!CFD_OHLC_INTERVALS.includes(interval as CfdOhlcInterval)){res.status(400).json({error:'invalid_interval'});return;}
    try{res.json(await cfdDisplay.getOhlc(req.params.symbol.toUpperCase(),interval as CfdOhlcInterval,limit));}
    catch{res.status(503).json({error:'cfd_ohlc_unavailable'});}
  });
  for (const kind of ['instruments','tickers'] as const) app.get(`/internal/v1/options/${kind}`, async (req,res) => {
    const query = optionQuerySchema.safeParse(req.query);
    if (!query.success) { res.status(400).json({ error:'invalid_options_query' }); return; }
    if (!options) { res.status(503).json({ error:'options_unavailable' }); return; }
    try { res.json(await (kind === 'instruments' ? options.instruments(query.data) : options.quotes(query.data))); }
    catch (error) { res.status(error instanceof OptionsRequestError ? error.status : 503).json({ error:error instanceof OptionsRequestError ? error.code : 'options_unavailable' }); }
  });
  const server = createServer(app);
  const wss = new WebSocketServer({ noServer: true, maxPayload: 1024, perMessageDeflate: false });
  server.on('upgrade', (req,socket,head) => {
    if (req.url !== '/internal/v1/stream' || !authorized(req.headers.authorization) || wss.clients.size >= 32) {
      socket.end('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n'); return;
    }
    wss.handleUpgrade(req,socket,head,ws => wss.emit('connection',ws,req));
  });
  wss.on('connection', ws => writeCollectorStream(ws, source));
  const close = () => { for (const ws of wss.clients) ws.terminate(); wss.close(); server.close(); };
  return { app, server, close };
}

/** One bounded writer per authenticated socket; exported for slow-client tests. */
export function writeCollectorStream(ws: WebSocket, source: LiveSource): void {
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
}
