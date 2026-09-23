// Standalone process: no dotenv file, DB, Prisma, account or execution imports.
import { BybitMarketDataService } from './services/marketData/bybit/BybitMarketDataService';
import { BybitLiveTickerCollector } from './services/marketData/bybit/BybitLiveTickerCollector';
import { collectorServer } from './services/marketData/live/collectorServer';
import { BybitOptions } from './services/marketData/bybit/BybitOptions';
import { BiquoteCfdQuoteSource } from './services/marketData/cfd/BiquoteCfdQuoteSource';
import { DerivPublicStreamQuoteSource } from './services/marketData/cfd/DerivPublicStreamQuoteSource';
import { EiaOilDisplaySource } from './services/marketData/cfd/EiaOilDisplaySource';
import { CfdDisplayQuoteRouter } from './services/marketData/cfd/CfdDisplayQuoteRouter';
import { BiquoteCfdOhlcSource } from './services/marketData/cfd/BiquoteCfdOhlcSource';

const token = process.env.MARKET_DATA_COLLECTOR_TOKEN;
if (!token) throw new Error('MARKET_DATA_COLLECTOR_TOKEN is required');
const liveBaseAssets = (process.env.MARKET_DATA_LIVE_BASE_ASSETS ?? 'BTC,ETH,SOL,XRP,DOGE,TRX')
  .split(',').map(x => x.trim().toUpperCase()).filter(Boolean);
const slowRefreshMs = Number(process.env.MARKET_DATA_SLOW_REFRESH_MS ?? 20_000);
const collector = new BybitLiveTickerCollector(new BybitMarketDataService({ baseUrl: process.env.BYBIT_REST_URL }), {
  spotUrl: process.env.BYBIT_SPOT_WS_URL, linearUrl: process.env.BYBIT_LINEAR_WS_URL,
  inverseUrl: process.env.BYBIT_INVERSE_WS_URL,
  liveBaseAssets,
  slowRefreshMs: Number.isFinite(slowRefreshMs) ? slowRefreshMs : 20_000,
});
const options = new BybitOptions(collector.rest);

// Public CFD display feeds are owned by the same Frankfurt collector rather
// than by each API instance/browser. This keeps one upstream connection set,
// gives the API region a fast authenticated hop, and still keeps all rows
// display-only. Nothing here is connected to accounts or execution.
const cfdBiquote = new BiquoteCfdQuoteSource({ baseUrl:'https://biquote.io', cacheMs:1_000, timeoutMs:3_000 });
const cfdDeriv = new DerivPublicStreamQuoteSource({ shadow:true, maxQuoteAgeMs:10_000 });
const cfdEia = new EiaOilDisplaySource({ timeoutMs:5_000, cacheMs:6*60*60*1000 });
const cfdOhlc = new BiquoteCfdOhlcSource('https://biquote.io');
const cfdDisplayRouter = new CfdDisplayQuoteRouter([
  { id:'biquote', priority:10, source:cfdBiquote },
  { id:'deriv', priority:20, source:cfdDeriv },
  { id:'eia-oil', priority:30, source:cfdEia },
], { providerWaitMs:3_200, freshAgeMs:120_000 });
const cfdDisplay={
  getQuotes:()=>cfdDisplayRouter.getQuotes(),
  getOhlc:(symbol:Parameters<BiquoteCfdOhlcSource['getOhlc']>[0],interval:Parameters<BiquoteCfdOhlcSource['getOhlc']>[1],limit:Parameters<BiquoteCfdOhlcSource['getOhlc']>[2])=>cfdOhlc.getOhlc(symbol,interval,limit),
  diagnostics:()=>cfdDisplayRouter.diagnostics(),
};

function runCfdDisplaySelfTest():void{
  void Promise.allSettled([
    cfdDisplayRouter.getQuotes(),
    cfdOhlc.getOhlc('XAUUSD','15m',20),
    cfdOhlc.getOhlc('WTIUSD','15m',20),
  ]).then(([quotesResult,xauResult,wtiResult])=>{
    const quotes=quotesResult.status==='fulfilled'?quotesResult.value:[];
    const priced=quotes.filter(q=>q.last!==null&&Number.isFinite(q.last)&&q.last>0).length;
    console.log(JSON.stringify({
      event:'cfd_display_selftest',
      quoteRows:quotes.length,
      pricedRows:priced,
      xauOhlcBars:xauResult.status==='fulfilled'?xauResult.value.bars.length:0,
      wtiOhlcBars:wtiResult.status==='fulfilled'?wtiResult.value.bars.length:0,
      quotesOk:quotesResult.status==='fulfilled',
      xauOhlcOk:xauResult.status==='fulfilled',
      wtiOhlcOk:wtiResult.status==='fulfilled',
    }));
  }).catch(()=>{});
}

const runtime = collectorServer(
  collector.feed,
  token,
  () => ({ ...collector.diagnostics(), options:options.diagnostics() }),
  options,
  () => collector.universe.snapshot(),
  cfdDisplay,
  (providerSymbol) => collector.rest.getOrderBook('linear', providerSymbol),
);
const bindHost = process.env.MARKET_DATA_BIND_HOST?.trim() || '0.0.0.0';
runtime.server.listen(Number(process.env.PORT || 10000), bindHost, () => {
  console.log(`Market data collector listening on ${bindHost}:${process.env.PORT || 10000}`);
  collector.start();
  cfdDeriv.start();
  runCfdDisplaySelfTest();
});
let stopping = false;
for (const signal of ['SIGINT','SIGTERM'] as const) process.on(signal, () => {
  if (stopping) return; stopping = true;
  cfdDeriv.stop();
  collector.stop(); runtime.close();
  setTimeout(() => process.exit(0), 1000).unref();
});
