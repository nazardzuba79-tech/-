// Standalone process: no dotenv file, DB, Prisma, account or execution imports.
import { BybitMarketDataService } from './services/marketData/bybit/BybitMarketDataService';
import { BybitLiveTickerCollector } from './services/marketData/bybit/BybitLiveTickerCollector';
import { collectorServer } from './services/marketData/live/collectorServer';
import { BybitOptions } from './services/marketData/bybit/BybitOptions';

const token = process.env.MARKET_DATA_COLLECTOR_TOKEN;
if (!token) throw new Error('MARKET_DATA_COLLECTOR_TOKEN is required');
const collector = new BybitLiveTickerCollector(new BybitMarketDataService({ baseUrl: process.env.BYBIT_REST_URL }), {
  spotUrl: process.env.BYBIT_SPOT_WS_URL, linearUrl: process.env.BYBIT_LINEAR_WS_URL,
  inverseUrl: process.env.BYBIT_INVERSE_WS_URL,
});
const options = new BybitOptions(collector.rest);
const runtime = collectorServer(
  collector.feed,
  token,
  () => ({ ...collector.diagnostics(), options:options.diagnostics() }),
  options,
  () => collector.universe.snapshot()
);
runtime.server.listen(Number(process.env.PORT || 10000), '0.0.0.0', () => {
  console.log('Market data collector listening'); collector.start();
});
let stopping = false;
for (const signal of ['SIGINT','SIGTERM'] as const) process.on(signal, () => {
  if (stopping) return; stopping = true;
  collector.stop(); runtime.close();
  setTimeout(() => process.exit(0), 1000).unref();
});
