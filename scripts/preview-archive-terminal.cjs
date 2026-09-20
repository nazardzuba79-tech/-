/** Local visual review of the real FuturesPage. No production credentials,
 * no private upstream routes, and no order/balance mutations. Public market
 * responses pass through unchanged; the account is an empty local fixture. */
const express = require('express');
const fs = require('node:fs');
const path = require('node:path');
const { Readable } = require('node:stream');
const app = express();
const port = Number(process.env.PREVIEW_PORT || 4234);
const upstream = 'https://exchange-api-mo5g.onrender.com';
const dist = path.resolve(__dirname, '../frontend/dist');
app.use((_req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
app.use('/api', (req, res, next) => {
  if (req.method !== 'GET') return res.status(405).json({ message:'Перегляд дизайну: операції з рахунком вимкнено.', code:'preview_read_only' });
  next();
});
app.get('/api/v1/me', (_req,res) => res.json({ id:'local-design-review', displayName:'Preview', email:'preview@example.invalid', kycStatus:'NOT_STARTED', isAdmin:false, role:'USER' }));
app.get('/api/v1/private-trading/access', (_req,res) => res.json({ allowed:false, nativeAvailable:false, simulationOnly:false }));
// Optional, explicitly labelled local visual fixture. Never written or proxied upstream.
const hasExample = req => /(?:^|;\s*)archive_example=1(?:;|$)/.test(req.headers.cookie || '');
app.get('/api/v1/futures/positions', (req,res) => res.json(hasExample(req) ? [{
  id:'local-example-long', symbol:'BTC/USDT', side:'LONG', size:'0.450', entryPrice:'79650.00', leverage:50,
  marginType:'CROSS', initialMargin:'716.85', liquidationPrice:null, markPrice:'81485.50',
  unrealizedPnl:'825.975', realizedPnl:'-2.41', roe:String(825.975/716.85*100), openedAt:'2026-09-19T12:00:00.000Z',
  protection:{ takeProfit:{ id:'local-tp',kind:'TAKE_PROFIT',triggerPrice:'83500',status:'PENDING',lastError:null,attempts:0,revision:1,createdAt:'2026-09-19T12:00:00.000Z',updatedAt:'2026-09-19T12:00:00.000Z' },
    stopLoss:{ id:'local-sl',kind:'STOP_LOSS',triggerPrice:'80100',status:'PENDING',lastError:null,attempts:0,revision:1,createdAt:'2026-09-19T12:00:00.000Z',updatedAt:'2026-09-19T12:00:00.000Z' } },
}] : []));
app.get('/api/v1/futures/balances', (req,res) => res.json(hasExample(req) ? [{asset:'USDT', available:'18205.54', locked:'716.85'}] : []));
app.get(['/api/v1/futures/positions/history','/api/v1/futures/orders/me','/api/v1/balances'], (_req,res) => res.json([]));
app.get('/api/v1/wallet/overview', (_req,res) => res.json({ balances:{ spot:[], futures:[], spotValueUsd:0, futuresValueUsd:0, totalValueUsd:0 }, valuationComplete:true, unpricedAssets:[], btcPriceUsd:null }));
// Allowlisted GET paths only: no account request can reach production.
const publicPath = /^\/api\/v1\/(?:market\/(?:live|universe|assets|external\/(?:tickers|symbols|candles|rankings)|futures\/(?:candles|orderbook)|derivatives)(?:\/|$)|futures\/(?:config$|mark-price\/|funding-rate\/|open-interest\/|orderbook\/))/;
const cache = new Map();
app.get('/api/v1/*', async (req,res) => {
  if (!publicPath.test(req.path)) return res.status(404).json({ message:'Not available in local design review' });
  const streaming = req.path === '/api/v1/market/live';
  const cached = cache.get(req.originalUrl);
  if (!streaming && cached && Date.now()-cached.at < 10000) return res.status(cached.status).type('json').send(cached.body);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  res.on('close', () => controller.abort());
  try {
    const result = await fetch(upstream + req.originalUrl, { signal:controller.signal, headers:{ Accept:streaming?'text/event-stream':'application/json' } });
    if (streaming) {
      clearTimeout(timer);
      res.status(result.status).set('Content-Type','text/event-stream');
      Readable.fromWeb(result.body).on('error', () => res.end()).pipe(res);
      return;
    }
    const body = await result.text();
    if (result.ok) { if(cache.size>150) cache.clear(); cache.set(req.originalUrl,{at:Date.now(),status:result.status,body}); }
    res.status(result.status).type('json').send(body);
  } catch {
    if (!res.headersSent) res.status(503).json({ message:'Market data temporarily unavailable' });
  } finally { clearTimeout(timer); }
});
app.use(express.static(dist, { index:false }));
app.get('*', (req,res) => {
  const example = req.query.samplePosition === '1';
  res.set('Set-Cookie', `archive_example=${example ? '1' : '0'}; Path=/; SameSite=Strict; HttpOnly`);
  res.type('html').send(fs.readFileSync(path.join(dist,'index.html'),'utf8').replace('<head>', `<head><script>
localStorage.setItem('exchange_token','local-design-review');
localStorage.setItem('exchange_lang','ru');
</script><style>#local-preview-label{position:fixed;bottom:31px;right:10px;z-index:10000;font:10px/18px system-ui;color:#bac6d4;background:#10141e;padding:0 8px;border-radius:4px;pointer-events:none}</style>`).replace('</body>', `<div id="local-preview-label">Preview дизайну · ${example ? 'приклад позиції · ' : ''}без операцій з рахунком</div></body>`));
});
app.listen(port,'127.0.0.1', () => console.log(`http://127.0.0.1:${port}/futures?terminalDesign=archive`));
