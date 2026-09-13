'use strict';
/**
 * Isolated deployed review server for VOLTEX free CFD display resilience.
 * It has no database, no accounts, no balances and no financial endpoints.
 * Public BiQuote + public Deriv may keep display rows available; every output
 * is forced displayOnly/executionAllowed=false. This is not the exchange API.
 */
const express=require('express');
const {BiquoteCfdQuoteSource}=require('../dist/services/marketData/cfd/BiquoteCfdQuoteSource');
const {DerivPublicStreamQuoteSource}=require('../dist/services/marketData/cfd/DerivPublicStreamQuoteSource');
const {CfdDisplayQuoteRouter}=require('../dist/services/marketData/cfd/CfdDisplayQuoteRouter');
const {CFD_REFERENCE_CATALOG}=require('../dist/services/marketData/cfd/catalog');
const PORT=Number(process.env.PORT||3000);
const deriv=new DerivPublicStreamQuoteSource({shadow:true,maxQuoteAgeMs:5000});
const biquote=new BiquoteCfdQuoteSource({maxQuoteAgeMs:5000,cacheMs:1000,timeoutMs:1200});
const router=new CfdDisplayQuoteRouter([
  {id:'biquote',priority:10,source:biquote},
  {id:'deriv',priority:20,source:deriv},
],{providerWaitMs:1300,freshAgeMs:120000});
deriv.start();
const app=express();
app.disable('x-powered-by');
app.use((_req,res,next)=>{res.setHeader('Cache-Control','no-store');next();});
app.get('/health',(_req,res)=>res.json({status:'ok',service:'voltex-cfd-free-display-review'}));
app.get('/api/v1/cfd/tickers',async(_req,res)=>{
  const quotes=await router.getQuotes();
  const tickers=quotes.map(q=>({
    symbol:q.symbol,
    name:CFD_REFERENCE_CATALOG.find(i=>i.symbol===q.symbol)?.name??q.symbol,
    provider:q.provider,
    providerSymbol:q.providerSymbol,
    price:q.last===null?null:q.lastDecimal??String(q.last),
    bid:q.bid,ask:q.ask,mid:q.mid,
    providerTimestamp:q.providerTimestamp,fetchedAt:q.fetchedAt,
    status:q.status,referenceStatus:q.referenceStatus,stale:q.stale,
    entitlementVerified:false,executionAllowed:false,displayOnly:true,
  }));
  res.json({source:'free-public-display-review',configured:true,executionAllowed:false,tickers});
});
app.get('/diagnostics',async(_req,res)=>res.json({executionAllowed:false,router:await router.diagnostics(),biquote:biquote.diagnostics(),deriv:deriv.diagnostics()}));
app.all('/api/v1/cfd/positions*',(_req,res)=>res.status(405).json({error:'financial_operations_not_available_on_review_service'}));
const server=app.listen(PORT,'0.0.0.0',()=>console.log(`CFD free display review listening on :${PORT}`));
async function shutdown(){deriv.stop();server.close(()=>process.exit(0));setTimeout(()=>process.exit(0),2000).unref();}
process.on('SIGTERM',shutdown);process.on('SIGINT',shutdown);
