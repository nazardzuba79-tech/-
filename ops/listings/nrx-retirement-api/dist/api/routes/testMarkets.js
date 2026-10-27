"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.testMarketsRouter = testMarketsRouter;
const express_1 = require("express");
const testAssetConfig_1 = require("../../services/testMarkets/testAssetConfig");
const testMarketSimulation_1 = require("../../services/testMarkets/testMarketSimulation");
const testMarketDepth_1 = require("../../services/testMarkets/testMarketDepth");
const testMarketService_1 = require("../../services/testMarkets/testMarketService");
/**
 * TEST MARKETS — read-only, simulated, never tradable.
 *
 *   GET /market/test-assets                 every test asset with its state
 *   GET /market/test-assets/:pair           one asset (pair as VTA-USDT)
 *   GET /market/test-assets/:pair/candles   ?interval=5m|15m|1h|4h|1d|1w&limit=
 *
 * Mounted AHEAD of the venue-backed routers so the shared Spot endpoints
 * the terminal already calls (candles, ticker, book, trades) answer for a
 * test pair from the simulation — and for every other pair fall straight
 * through to the router that serves them today, untouched.
 *
 * Nothing here writes, and nothing here is cached publicly: the server's
 * clock decides what exists, so no candle after `now` ever leaves it.
 */
function testMarketsRouter(clock = Date.now, env = process.env) {
    const router = (0, express_1.Router)();
    // Retirement covers stale clients and encoded aliases, before venue fallback.
    // Private balances/history/cancel routes do not pass through this public gate.
    router.use((req, res, next) => {
        let path = req.path;
        try {
            path = decodeURIComponent(path);
        }
        catch { /* Express rejects invalid encodings later. */ }
        const marketPath = /^\/(?:market(?:\/|$)|orderbook\/)/i.test(path);
        const target = [path, req.query.pair, req.query.symbol].filter(v => typeof v === 'string').join(' ').toUpperCase();
        if (marketPath && target.includes('NRX')) {
            res.setHeader('Cache-Control', 'no-store');
            return res.status(410).json({ error: 'market_retired', symbol: 'NRX' });
        }
        next();
    });
    const nowFor = (req) => (0, testMarketService_1.resolveSimulationNow)(req.query.simulationPreviewTime, clock, env);
    const noStore = (res) => res.setHeader('Cache-Control', 'no-store');
    router.get('/market/test-assets', (req, res) => {
        const now = nowFor(req);
        noStore(res);
        res.json({ serverTime: now, assets: testAssetConfig_1.TEST_ASSETS.map((asset) => (0, testMarketService_1.publicTestAsset)(asset, now)) });
    });
    router.get('/market/test-assets/:pair', (req, res) => {
        const asset = (0, testAssetConfig_1.testAssetForPair)(pairFromSlug(req.params.pair));
        if (!asset)
            return res.status(404).json({ error: 'unknown_test_asset' });
        noStore(res);
        res.json((0, testMarketService_1.publicTestAsset)(asset, nowFor(req)));
    });
    const sendCandles = (asset, req, res) => {
        const interval = typeof req.query.interval === 'string' ? req.query.interval : '5m';
        const limit = Number(req.query.limit) || 300;
        const now = nowFor(req);
        try {
            noStore(res);
            res.json({ source: 'simulation', pair: asset.pair, interval, isTestAsset: true, serverTime: now,
                candles: (0, testMarketService_1.testMarketCandles)(asset, interval, now, limit) });
        }
        catch (err) {
            if (err instanceof testMarketService_1.UnsupportedTestIntervalError)
                return res.status(400).json({ error: err.message });
            throw err;
        }
    };
    router.get('/market/test-assets/:pair/candles', (req, res) => {
        const asset = (0, testAssetConfig_1.testAssetForPair)(pairFromSlug(req.params.pair));
        if (!asset)
            return res.status(404).json({ error: 'unknown_test_asset' });
        sendCandles(asset, req, res);
    });
    // ── The shared Spot endpoints, answered for test pairs only ─────────
    const forTestPair = (handler) => (req, res, next) => {
        const asset = (0, testAssetConfig_1.testAssetForPair)(pairFromSlug(req.params.pair));
        if (!asset)
            return next();
        handler(asset, req, res);
    };
    router.get('/market/external/candles/:pair', forTestPair(sendCandles));
    const ticker = (asset, req, res) => {
        const state = (0, testMarketSimulation_1.getCurrentTestMarketState)((0, testMarketSimulation_1.simulationFor)(asset), (0, testMarketService_1.effectiveTestMarketNow)(asset, nowFor(req)));
        noStore(res);
        if (state.phase !== 'live' || state.lastPrice === null)
            return res.status(404).json({ error: `No ticker for ${asset.pair}`, isTestAsset: true, listingAt: new Date(asset.listingAt).toISOString() });
        const last = String(state.lastPrice);
        const book = (0, testMarketDepth_1.testMarketDepth)((0, testMarketSimulation_1.simulationFor)(asset), state.serverTime);
        res.json({ source: 'simulation', isTestAsset: true, isTradable: false, ticker: {
                pair: asset.pair, lastPrice: last, bidPrice: book.bids[0].price, askPrice: book.asks[0].price,
                high24h: String(state.high24h), low24h: String(state.low24h),
                volume24h: String(state.volume24h), quoteVolume24h: String(state.quoteVolume24h),
                changePercent24h: String(state.change24hPercent),
            } });
    };
    router.get('/market/external/tickers/:pair', forTestPair(ticker));
    router.get('/market/ticker/:pair', forTestPair(ticker));
    // Read-only display depth. No orders, matching, database reads or mutations.
    const sendBook = (asset, req, res) => {
        noStore(res);
        res.json((0, testMarketDepth_1.testMarketDepth)((0, testMarketSimulation_1.simulationFor)(asset), (0, testMarketService_1.effectiveTestMarketNow)(asset, nowFor(req))));
    };
    router.get('/market/external/orderbook/:pair', forTestPair(sendBook));
    router.get('/market/display/spot-book/:pair', forTestPair(sendBook));
    router.get('/orderbook/:pair', forTestPair(sendBook));
    router.get('/market/external/trades/:pair', forTestPair((asset, req, res) => {
        noStore(res);
        res.json({ source: 'simulation', pair: asset.pair, isTestAsset: true,
            trades: (0, testMarketSimulation_1.simulationFor)(asset).recentTrades((0, testMarketService_1.effectiveTestMarketNow)(asset, nowFor(req))) });
    }));
    return router;
}
function pairFromSlug(slug) {
    return decodeURIComponent(slug).toUpperCase().replace('-', '/');
}
//# sourceMappingURL=testMarkets.js.map