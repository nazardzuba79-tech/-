'use strict';
// Local stand-in for the public market data the backend reads, so a
// measurement run never depends on (or hammers) the real providers. Kraken
// AssetPairs/Ticker are served for three majors; every other path (collector,
// Bybit, CoinGecko...) answers 404, which the backend already treats as
// "provider unavailable". Nothing here touches a database.
const http = require('node:http');
const port = Number(process.argv[2] || 4599);
const pairs = { XXBTZUSD: ['XBTUSD', 'XBT/USD'], XETHZUSD: ['ETHUSD', 'ETH/USD'], SOLUSD: ['SOLUSD', 'SOL/USD'] };
const prices = { XXBTZUSD: '65000.0', XETHZUSD: '3200.0', SOLUSD: '150.0' };
let hits = 0;
http.createServer((req, res) => {
  hits++;
  const url = new URL(req.url, 'http://x');
  res.setHeader('content-type', 'application/json');
  if (url.pathname === '/0/public/AssetPairs') {
    const result = {};
    for (const [id, [alt, ws]] of Object.entries(pairs)) result[id] = { altname: alt, wsname: ws, base: id, quote: 'ZUSD' };
    return res.end(JSON.stringify({ error: [], result }));
  }
  if (url.pathname === '/0/public/Ticker') {
    const result = {};
    for (const id of Object.keys(pairs)) {
      const p = prices[id];
      result[id] = { a: [p, '1', '1'], b: [p, '1', '1'], c: [p, '0.1'], v: ['1000', '100000'], p: [p, p], t: [100, 1000], l: [p, p], h: [p, p], o: p };
    }
    return res.end(JSON.stringify({ error: [], result }));
  }
  if (url.pathname === '/__hits') return res.end(JSON.stringify({ hits }));
  res.statusCode = 404; res.end('{"error":"stub"}');
}).listen(port, '127.0.0.1', () => console.log(`market stub on ${port}`));
