/** Local presentation QA only. No database, production auth or production writes.
 * node scripts/qa-cfd-terminal.cjs
 * /__qa/start?mode=live|unconfigured|error|loading|positions
 * Live prices/config are unmodified public GET responses. Positions/balance
 * fixtures exist only in the explicitly selected positions mode. ALL writes
 * return a local error, including fixture close/submit; nothing is settled.
 */
const express = require('express');
const path = require('node:path');
const app = express();
const port = 4192;
const publicBase = 'https://api.voltextech.net/api/v1';
const modes = new Set(['live', 'unconfigured', 'error', 'loading', 'positions']);
const publicReads = new Set(['/cfd/tickers', '/cfd/config', '/market/external/tickers', '/market/external/symbols',
  '/market/external/ticker', '/market/external/orderbook', '/market/external/candles', '/market/tickers', '/pairs', '/futures/config', '/futures/markets']);
const journal = [];
app.use((req, res, next) => {
  if (req.headers.host !== `127.0.0.1:${port}` || !['127.0.0.1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress)) return res.sendStatus(403);
  res.setHeader('Content-Security-Policy', "connect-src 'self' wss://ws.kraken.com https://api.kraken.com; form-action 'self'");
  res.setHeader('Cache-Control', 'no-store');
  if (req.path.startsWith('/api/')) journal.push({ method: req.method, path: req.path });
  if (!['GET', 'HEAD'].includes(req.method)) return res.status(403).json({ error: 'LOCAL QA ONLY: financial writes are disabled; no position changed' });
  next();
});
app.get('/__qa/start', (req, res) => {
  const mode = modes.has(req.query.mode) ? req.query.mode : 'live';
  res.cookie('cfd_qa_mode', mode, { sameSite: 'strict', httpOnly: true });
  res.type('html').send(`<script>localStorage.setItem('exchange_token','local-cfd-ui-fixture-not-a-production-token');location.replace('/trade?market=cfd');</script>`);
});
app.get('/__qa/journal', (_req, res) => res.json({ environment: 'LOCAL QA ONLY', productionWrites: 0, journal }));
app.use('/api/v1', async (req, res) => {
  const mode = /cfd_qa_mode=([a-z]+)/.exec(req.headers.cookie ?? '')?.[1] ?? 'live';
  if (req.path === '/me') return res.json({ id: 'local-cfd-qa', displayName: 'Local CFD QA', email: 'cfd-qa@example.invalid', createdAt: '2020-01-01', isAdmin: false, kycStatus: 'NOT_STARTED' });
  if (req.path === '/futures/balances') return res.json([{ asset: 'USDT', available: mode === 'positions' ? '1000' : '0', locked: '0' }]);
  if (['/cfd/positions', '/cfd/positions/history'].includes(req.path)) return res.json(mode === 'positions' ? [{
    id: 'LOCAL-QA-FIXTURE-NOT-A-REAL-POSITION', symbol: 'EURUSD', side: 'LONG', size: '100', leverage: 10,
    entryPrice: '1.10', markPrice: null, liquidationPrice: '0.9944', unrealizedPnl: null, roe: null,
    realizedPnl: '-1', status: req.path.endsWith('history') ? 'LIQUIDATED' : 'OPEN',
  }] : []);
  if (req.path === '/cfd/tickers') {
    if (mode === 'unconfigured') return res.json({ source: 'twelvedata', configured: false, tickers: [] });
    if (mode === 'error') return res.status(502).json({ error: 'LOCAL QA provider-error state' });
    if (mode === 'loading') return setTimeout(() => res.json({ configured: false, tickers: [] }), 15000);
  }
  if (publicReads.has(req.path)) {
    try {
      // Deliberately forward no browser headers, Authorization or cookies.
      const response = await fetch(publicBase + req.url, { signal: AbortSignal.timeout(15000) });
      const body = await response.text(); res.status(response.status).type('json').send(body);
    } catch { res.status(502).json({ error: 'Public read unavailable in local QA' }); }
    return;
  }
  if (req.path === '/support/conversations/mine') return res.json({ conversation: null, messages: [] });
  if (req.path.includes('orderbook')) return res.json({ bids: [], asks: [] });
  res.json([]);
});
const dist = path.resolve(__dirname, '../frontend/dist');
app.use(express.static(dist));
app.get('*', (_req, res) => res.sendFile(path.join(dist, 'index.html')));
app.listen(port, '127.0.0.1', () => console.log(`LOCAL QA ONLY: http://127.0.0.1:${port}/__qa/start?mode=live`));
