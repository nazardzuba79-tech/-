/** Local terminal review only: fixture identity, no fixture market/account values.
 * Anonymous public GETs are proxied without credentials. ALL writes are blocked.
 */
const express = require('express');
const path = require('node:path');
const app = express(), port = Number(process.env.TERMINAL_QA_PORT || 4196);
app.use((req,res,next)=>{
  if(req.headers.host !== `127.0.0.1:${port}` || !['127.0.0.1','::ffff:127.0.0.1'].includes(req.socket.remoteAddress))return res.sendStatus(403);
  res.setHeader('Cache-Control','no-store');
  if(!['GET','HEAD'].includes(req.method))return res.status(403).json({error:'LOCAL QA: all financial writes blocked'});
  next();
});
app.get('/__qa/start',(req,res)=>{
  const route = req.query.market === 'futures' ? '/futures' : '/trade';
  const selectedDesign = ['studio', 'graphite', 'focus'].includes(req.query.terminalDesign) ? req.query.terminalDesign : null;
  const design = selectedDesign ? `?terminalDesign=${selectedDesign}` : '';
  res.type('html').send(`<script>localStorage.setItem('exchange_token','local-terminal-review-no-production-credentials');location.replace('${route}${design}');</script>`);
});
// Exercise the candidate's actual public candle adapter before backend deployment.
const { FuturesChartCandles } = require('../dist/services/FuturesChartCandles');
const futuresChartCandles = new FuturesChartCandles();
app.get('/api/v1/market/futures/candles/:pair',async(req,res)=>{
  try{res.json(await futuresChartCandles.get(req.params.pair,String(req.query.interval??'15m'),Number(req.query.limit??520)));}
  catch(error){res.status(error instanceof RangeError?400:503).json({error:'Candles unavailable'});}
});
app.use('/api/v1',async(req,res)=>{
  if(req.path==='/me')return res.json({id:'local-ui-review',displayName:'LOCAL UI REVIEW',email:'local@example.invalid',createdAt:'2020-01-01',isAdmin:false,kycStatus:'NOT_STARTED'});
  const allowed = req.path.startsWith('/market/') || /^\/futures\/(mark-price|funding-rate)\/[^/]+$/.test(req.path) || /^\/cfd\/candles\/[^/]+$/.test(req.path) || ['/analytics/overview','/pairs','/cfd/tickers','/cfd/config','/futures/config','/futures/markets'].includes(req.path);
  if(!allowed)return res.status(503).json({error:'Account data unavailable in local read-only review'});
  try {
    const upstream=await fetch('https://api.voltextech.net/api/v1'+req.url,{signal:AbortSignal.timeout(req.path==='/market/live'?300000:15000)});
    res.status(upstream.status===401?503:upstream.status);res.setHeader('Content-Type',upstream.headers.get('content-type')||'application/json');
    if(req.path==='/market/live') { req.on('close',()=>{}); for await(const chunk of upstream.body){if(res.destroyed)break;res.write(chunk);}res.end(); }
    else res.send(await upstream.text());
  }catch{if(!res.headersSent)res.status(503).json({error:'Public reference data unavailable'});else res.end();}
});
const dist=path.resolve(__dirname,'../frontend/dist');app.use(express.static(dist));app.get('*',(_req,res)=>res.sendFile(path.join(dist,'index.html')));
app.listen(port,'127.0.0.1',()=>console.log(`LOCAL READ-ONLY REVIEW http://127.0.0.1:${port}/__qa/start`));
