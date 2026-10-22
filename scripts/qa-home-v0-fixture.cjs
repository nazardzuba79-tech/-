'use strict';
const prices = { BTC: 76746, ETH: 2479.53, SOL: 99.78, XRP: 1.35, BNB: 610, ADA: .24, DOGE: .095, TRX: .3 };
const tickers = Object.entries(prices).map(([base, price]) => ({ pair: `${base}/USDT`, lastPrice: String(price), bidPrice: String(price * .9999), askPrice: String(price * 1.0001), high24h: String(price * 1.02), low24h: String(price * .98), volume24h: '1000', quoteVolume24h: String(price * 1000), changePercent24h: '1.25' }));
const candles = Array.from({ length: 48 }, (_, i) => { const open = 76000 + i * 9, close = open + (i % 2 ? 14 : -8); return { time: 1799990000 + i * 900, open, high: Math.max(open, close) + 12, low: Math.min(open, close) - 10, close, volume: 40 + i }; });
function fixture(req, res) {
  const p = req.path;
  if (p === '/market/external/tickers') return res.json({ source: 'qa', tickers });
  if (p.startsWith('/market/external/orderbook/')) return res.json({ source: 'qa', pair: 'BTC/USDT', timestamp: Date.now(), bids: Array.from({ length: 8 }, (_, i) => ({ price: String(76745.9 - i * .1), quantity: String(.1 + i * .03) })), asks: Array.from({ length: 8 }, (_, i) => ({ price: String(76746.1 + i * .1), quantity: String(.12 + i * .025) })) });
  if (p.startsWith('/market/external/candles/')) return res.json({ source: 'qa', pair: 'BTC/USDT', interval: '15m', candles });
  if (p.startsWith('/market/external/trades/')) return res.json({ source: 'qa', pair: 'BTC/USDT', trades: Array.from({ length: 6 }, (_, i) => ({ id: `t${i}`, price: String(76746 - i * .2), quantity: String(.02 + i * .01), side: i % 2 ? 'SELL' : 'BUY', time: Date.now() - i * 1000 })) });
  if (p === '/market/external/rankings') return res.json({ source: 'qa', rankings: [] });
  if (p === '/market/global') return res.json({ source: 'qa', global: null, fearGreed: null });
  if (p === '/market/assets/icons') return res.json({ icons: {} });
  if (p === '/cfd/display/tickers' || p === '/cfd/tickers') return res.json({ source: 'qa', configured: true, _display: { mode: 'snapshot', capturedAt: Date.now(), refreshMs: 21600000 }, tickers: Object.entries({ XAUUSD: 4349.19, WTIUSD: 96.607, EURUSD: 1.17, GBPUSD: 1.34, XAGUSD: 34.72, XBRUSD: 99.2, USDJPY: 146.7 }).map(([symbol, price]) => ({ symbol, name: symbol, price: String(price), changePercent24h: '1.02', status: 'sampled', stale: true, marketClosed: false, displayOnly: true, executionAllowed: false, entitlementVerified: false, provider: 'qa', providerSymbol: symbol, providerTimestamp: Date.now(), fetchedAt: Date.now(), asOf: Date.now(), maxQuoteAgeMs: 21600000 })) });
  if (p === '/futures/config') return res.json({ symbols: ['BTC/USDT'], tradingEnabled: false });
  if (p === '/support/conversations/mine') return res.json({ conversation: null, messages: [] });
  if (p === '/auth/me' || p === '/me') return res.status(401).json({ error: 'Unauthenticated' });
  return res.status(503).json({ error: 'Not used in fixture-only home QA' });
}

module.exports = { fixture };
