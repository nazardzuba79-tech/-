/**
 * Loopback-only review of the production frontend + unchanged public Analytics services.
 * No database, credentials, private data, execution calls or synthetic market figures.
 * Only the local identity is a fixture. Native VOLTEX book metrics stay unavailable.
 * Run after both builds: node scripts/qa-analytics-readonly.cjs
 */
const express = require('express');
const path = require('node:path');
const { AnalyticsDataService } = require('../dist/services/AnalyticsDataService');
const { KrakenMarketDataService } = require('../dist/services/KrakenMarketDataService');
const { CoinGeckoService } = require('../dist/services/CoinGeckoService');
const { FearGreedService } = require('../dist/services/FearGreedService');
const { MarketDataGateway } = require('../dist/services/marketData/MarketDataGateway');
const { BinanceDerivativesService } = require('../dist/services/marketData/derivatives/BinanceDerivativesService');
const { OkxDerivativesService } = require('../dist/services/marketData/derivatives/OkxDerivativesService');
const { ExternalDerivativesService } = require('../dist/services/marketData/derivatives/ExternalDerivativesService');
const { DerivedAnalyticsService } = require('../dist/services/analytics/DerivedAnalyticsService');
const { DeribitAnalyticsService } = require('../dist/services/analytics/DeribitAnalyticsService');
const { LiquidationStreamService } = require('../dist/services/analytics/LiquidationStreamService');
const kraken = new KrakenMarketDataService();
const gecko = new CoinGeckoService();
const gateway = new MarketDataGateway(kraken, gecko, new FearGreedService(), null);
const liquidations = new LiquidationStreamService();
const analytics = new AnalyticsDataService(
  null, gateway, null, { list: () => [] },
  new ExternalDerivativesService(new BinanceDerivativesService(), new OkxDerivativesService()),
  new DerivedAnalyticsService(gateway), gecko, new DeribitAnalyticsService(), liquidations,
);
const app = express(), port = 4197, evidence = [];
app.use((req,res,next) => {
  if(req.headers.host !== '127.0.0.1:' + port || !['127.0.0.1','::ffff:127.0.0.1'].includes(req.socket.remoteAddress)) return res.sendStatus(403);
  res.setHeader('Cache-Control','no-store');
  if(!['GET','HEAD'].includes(req.method)) return res.sendStatus(405);
  next();
});
app.get('/__qa/start', (_req,res) => res.type('html').send('<script>localStorage.setItem("exchange_token","local-analytics-review-only");location.replace("/analytics");</script>'));
app.get('/__qa/evidence', (_req,res) => res.json(evidence));
app.get('/api/v1/me', (_req,res) => res.json({id:'local-analytics-review',displayName:'LOCAL REVIEW',email:'local@example.invalid',createdAt:'2020-01-01',isAdmin:false,kycStatus:'NOT_STARTED'}));
app.get('/api/v1/analytics/overview', async (req,res) => {
  try {
    const result = await analytics.getSnapshot(typeof req.query.asset === 'string' ? req.query.asset.slice(0,12) : undefined);
    evidence.push({at:Date.now(),asset:result.selectedAsset,generatedAt:result.generatedAt,sections:Object.fromEntries(Object.entries(result.sections).map(([key,s]) => [key,{available:s.available,stale:s.stale}]))});
    if(evidence.length > 100) evidence.shift();
    res.json(result);
  } catch { res.status(503).json({error:'Unavailable'}); }
});
app.get('/api/v1/market/external/candles/:pair', async(req,res) => {
  try {
    const pair = req.params.pair.replace('-','/');
    if(!['BTC/USDT','ETH/USDT','SOL/USDT','XRP/USDT'].includes(pair)) return res.sendStatus(400);
    const result = await gateway.getCandles(pair,'1h',168);
    if(!result.available) return res.sendStatus(503);
    res.json({pair,interval:'1h',candles:result.value});
  } catch { res.sendStatus(503); }
});
app.use('/api', (_req,res) => res.status(503).json({error:'Not part of read-only Analytics review'}));
const dist = path.resolve(__dirname,'../frontend/dist');
app.use(express.static(dist));
app.get('*', (_req,res) => res.sendFile(path.join(dist,'index.html')));
const server = app.listen(port,'127.0.0.1',() => {
  liquidations.start();
  console.log('Local public-data Analytics review: http://127.0.0.1:' + port + '/__qa/start');
});
function stop() { liquidations.stop(); server.close(); }
process.on('SIGINT',stop); process.on('SIGTERM',stop);
