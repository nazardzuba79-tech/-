import { createServer } from '../../stocks-global/server.mjs';
import { MarketHub } from '../../stocks-global/market.mjs';
import { CATALOG } from '../../stocks-global/catalog.mjs';
import { nativeHistoryFixture } from '../realistic-provider-fixture.mjs';
export const IDS = CATALOG.filter(i => i.provider !== 'moex').map(i => i.id);
export const INERT = Array.from({ length: 250 - IDS.length }, (_, i) => ({
  id: `FIXTURE_METADATA_ONLY:${i}`, name: `Inert fixture metadata ${i}`, provider: 'fixture-metadata',
  fixture: true, tradable: false, exists: false, online: false, display: null, sourceError: 'METADATA_ONLY',
}));
export function fixtureBody(url, now = Date.now()) {
  const u = new URL(url), symbol = u.searchParams.get('symbol');
  if (u.pathname.endsWith('/kline') || u.pathname.endsWith('/klines')) return nativeHistoryFixture(u, now);
  if (u.hostname === 'api.bybit.com' && u.pathname === '/v5/market/orderbook')
    return { retCode: 0, result: { s: symbol, ts: now, cts: now, u: now, b: [['100', '10']], a: [['100', '10']] } };
  if (u.hostname === 'api.bybit.com' && u.pathname === '/v5/market/tickers')
    return { retCode: 0, time: now, result: { list: [{ symbol, lastPrice: '100', price24hPcnt: '0', volume24h: '100' }] } };
  if (u.hostname === 'api.binance.com' && u.pathname === '/api/v3/trades')
    return [{ time: now, id: now, price: symbol === 'USDCUSDT' ? '0.999' : '100' }];
  if (u.hostname === 'api.binance.com' && u.pathname === '/api/v3/ticker/24hr')
    return { symbol, lastPrice: '100', priceChangePercent: '0', volume: '100', closeTime: now };
  throw Error('FIXTURE_TRANSPORT_DENIED');
}
export async function startStocks({ path, port = 18092, diagnostics = true } = {}) {
  let starts = 0, transportInflight = 0; const startsByHost = {};
  const hub = new MarketHub({ fetchImpl: async url => {
    transportInflight++; let finished = false;
    const finish = () => { if (!finished) { finished = true; transportInflight--; } };
    try { const u = new URL(url); const body = fixtureBody(u); starts++; startsByHost[u.hostname] = (startsByHost[u.hostname] || 0) + 1;
      const reader = new Response(JSON.stringify(body)).body.getReader();
      const stream = new ReadableStream({ async pull(controller) { try { const r = await reader.read();
        if (r.done) { finish(); controller.close(); } else controller.enqueue(r.value);
      } catch (error) { finish(); controller.error(error); } }, async cancel() { try { await reader.cancel(); } finally { finish(); } } });
      return new Response(stream, { headers: { 'Content-Type': 'application/json' } });
    } catch (error) { finish(); throw error; }
  } });
  // The real quote/history adapters and their TTL, start budgets and queues remain intact.
  // Only discovery is fixture-seeded. Inert metadata never enters this runtime catalogue.
  hub.catalogue = async () => {
    for (const i of CATALOG.filter(i => i.provider !== 'moex')) hub.verified.set(i.id, { exists: true, online: true, multiplier: null, checkedAt: Date.now() });
    return CATALOG.filter(i => i.provider !== 'moex').map(i => ({ ...i, exists: true, online: true, fixture: true }));
  };
  await hub.catalogue();
  const app = await createServer({ port, accountsPath: path, hub, autoPoll: true, accountDiagnostics: diagnostics,
    ownerOnlyMode: true, tradeOwnerSubject: 'owner', authenticate: async req => {
      const m = /^Bearer cx23-fixture-(owner|viewer-[0-9]{1,2})$/.exec(req.headers.authorization || '');
      if (!m) throw Error('FIXTURE_IDENTITY_REQUIRED'); return { issuer: 'cx23-disposable-fixture', subject: m[1] };
    } });
  return { app, metrics: () => ({ pid: process.pid, cpu: process.cpuUsage(), memory: process.memoryUsage(),
    fixtureTransportStarts: starts, startsByHost: { ...startsByHost }, hub: { ...hub.metrics },
    live: { transportInflight, quoteInflight: hub.inflight.size, historyInflight: hub.historyFlights.size, historyActive: hub.historyActive, historyQueued: hub.historyQueue.length },
    accounts: app.accountMetrics(), externalApiCalls: 0, activeInstrumentCount: IDS.length, inertMetadataCount: INERT.length }) };
}
if (process.argv[1]?.endsWith('stocks-fixture.mjs')) {
  if (process.env.CX23_DISPOSABLE !== 'true') throw Error('DISPOSABLE_FIXTURE_REQUIRED');
  const f = await startStocks({ path: '/data/accounts.sqlite', diagnostics: process.env.CX23_DIAGNOSTICS !== 'false' });
  process.on('message', message => { if (message?.type === 'metrics') process.send?.({ id: message.id, value: f.metrics() }); });
  process.send?.({ ready: true, kind: 'stocks', pid: process.pid });
  process.on('SIGTERM', async () => { await f.app.close(); process.exit(); });
}
