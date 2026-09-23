import { publicDisplayCache, DISPLAY_REFRESH_MS, SLOW_DISPLAY_REFRESH_MS } from '../middleware/publicDisplayCache';
import { Router } from 'express';
import { z } from 'zod';
import BigNumber from 'bignumber.js';
import { PrismaClient } from '@prisma/client';
import { CfdMarketDataService } from '../../services/CfdMarketDataService';
import { CFD_REFERENCE_CATALOG } from '../../services/marketData/cfd/catalog';
import { assertCfdFreshQuote, CfdQuoteUnavailable, type CfdQuote } from '../../services/marketData/cfd/CfdQuote';
import { CfdDisplayQuoteRouter } from '../../services/marketData/cfd/CfdDisplayQuoteRouter';
import { BiquoteCfdQuoteSource } from '../../services/marketData/cfd/BiquoteCfdQuoteSource';
import { BiquoteCfdOhlcSource, CFD_OHLC_INTERVALS, type CfdOhlcInterval } from '../../services/marketData/cfd/BiquoteCfdOhlcSource';
import { DerivPublicStreamQuoteSource } from '../../services/marketData/cfd/DerivPublicStreamQuoteSource';
import { EiaOilDisplaySource } from '../../services/marketData/cfd/EiaOilDisplaySource';
import { CollectorCfdDisplaySource } from '../../services/marketData/cfd/CollectorCfdDisplaySource';
import { CfdPositionService } from '../../cfd/CfdPositionService';
import { computeUnrealizedPnl, computeROE, PositionSide } from '../../futures/marginMath';
import { MIN_LEVERAGE, MAX_LEVERAGE, HIGH_LEVERAGE_WARNING_THRESHOLD, LEVERAGE_TIERS } from '../../config/futuresConfig';
import { NEW_ACCOUNT_MAX_LEVERAGE, NEW_ACCOUNT_PERIOD_DAYS } from '../../config/cfdConfig';
import { requireAuthOrApiKey, requireTradePermission, ApiAuthedRequest } from '../middleware/apiKeyAuth';
import { requireAuth } from '../middleware/auth';
import { requireAdmin } from '../middleware/admin';

const CFD_SYMBOLS = CFD_REFERENCE_CATALOG.map((i) => i.symbol) as [string, ...string[]];
const biquoteDisplay = new BiquoteCfdQuoteSource({ cacheMs: Number(process.env.CFD_DISPLAY_CACHE_MS ?? 5000), timeoutMs: 3_000 });
const biquoteOhlc = new BiquoteCfdOhlcSource('https://biquote.io');
// Deriv's adapter implements the strict financial quote contract, whose age
// ceiling is 10s. The display router above it can keep its own looser 120s
// presentation freshness, but the adapter itself must remain within the
// shared safety invariant.
const derivDisplay = new DerivPublicStreamQuoteSource({ shadow:true, maxQuoteAgeMs:10_000 });
const eiaOilDisplay = new EiaOilDisplaySource();
let collectorDisplay:CollectorCfdDisplaySource|null=null;
try {
  const collectorUrl=process.env.MARKET_DATA_COLLECTOR_URL?.trim();
  const collectorToken=process.env.MARKET_DATA_COLLECTOR_TOKEN?.trim();
  if(collectorUrl&&collectorToken) collectorDisplay=new CollectorCfdDisplaySource(collectorUrl,collectorToken);
} catch { console.warn('[cfd] Collector CFD display configuration invalid; using direct public fallbacks'); }
const defaultDisplaySource = new CfdDisplayQuoteRouter([
  ...(collectorDisplay?[{id:'collector',priority:5,source:collectorDisplay}]:[]),
  {id:'biquote',priority:10,source:biquoteDisplay},
  {id:'deriv',priority:20,source:derivDisplay},
  {id:'eia-oil',priority:30,source:eiaOilDisplay},
], {providerWaitMs:3_200,freshAgeMs:120_000});
let displayStarted=false;
function ensureDisplayFeeds(){if(displayStarted)return;displayStarted=true;derivDisplay.start();}

const openSchema = z.object({
  symbol: z.enum(CFD_SYMBOLS), side: z.enum(['BUY', 'SELL']),
  quantity: z.string().refine((v) => new BigNumber(v).isGreaterThan(0), 'quantity must be > 0'),
  leverage: z.number().int().min(MIN_LEVERAGE).max(MAX_LEVERAGE),
});

function blankQuote(symbol:string):CfdQuote{const row=CFD_REFERENCE_CATALOG.find(i=>i.symbol===symbol)!;return{provider:'display-router',symbol,providerSymbol:row.providerSymbol,bid:null,ask:null,mid:null,last:null,providerTimestamp:null,fetchedAt:null,stale:false,status:'unavailable',referenceStatus:'unavailable',entitlementVerified:false,executionAllowed:false};}
async function bounded<T>(work:Promise<T>,fallback:T,maxWaitMs=3200):Promise<T>{let timer:NodeJS.Timeout|undefined;try{return await Promise.race([work.catch(()=>fallback),new Promise<T>(resolve=>{timer=setTimeout(()=>resolve(fallback),maxWaitMs);})]);}finally{if(timer)clearTimeout(timer);}}
function displayStatus(q:CfdQuote):'live'|'market_closed'|'stale'|'unavailable'{if(q.last===null||!Number.isFinite(q.last)||q.last<=0)return'unavailable';if(q.referenceStatus==='market_closed'||q.status==='market_closed')return'market_closed';if(q.stale||q.referenceStatus==='stale'||q.status==='stale')return'stale';return'live';}

/** `/cfd/tickers` is presentation-only market data. The free display sources
 * cannot enter position, PnL, balance or liquidation code. */
export function cfdRouter(prisma:PrismaClient,cfdDataService:CfdMarketDataService,positionService:CfdPositionService,
  displaySource:CfdDisplayQuoteRouter|null=(process.env.NODE_ENV==='test'?null:defaultDisplaySource)):Router{
  const router=Router();
  router.get('/admin/cfd/diagnostics',requireAuth(prisma),requireAdmin(prisma),async(_req,res)=>{res.setHeader('Cache-Control','no-store');try{if(displaySource===defaultDisplaySource)ensureDisplayFeeds();res.json({financial:await cfdDataService.diagnostics(),display:displaySource?await displaySource.diagnostics():null});}catch{res.status(503).json({error:'cfd_diagnostics_unavailable'});}});
  router.get('/cfd/config',(_req,res)=>res.json({symbols:CFD_SYMBOLS,catalog:cfdDataService.catalog(),maxQuoteAgeMs:cfdDataService.maxQuoteAgeMs,minLeverage:MIN_LEVERAGE,maxLeverage:MAX_LEVERAGE,newAccountMaxLeverage:NEW_ACCOUNT_MAX_LEVERAGE,newAccountPeriodDays:NEW_ACCOUNT_PERIOD_DAYS,highLeverageWarningThreshold:HIGH_LEVERAGE_WARNING_THRESHOLD,leverageTiers:LEVERAGE_TIERS}));
  router.get('/cfd/catalog',(_req,res)=>res.json({instruments:cfdDataService.catalog()}));
  // Presentation aliases have their own bounded six-hour cache. Originals and
  // all financial routes below remain unchanged and never read these entries.
  router.get('/cfd/display/tickers', publicDisplayCache(SLOW_DISPLAY_REFRESH_MS,
    body => Array.isArray(body?.tickers) && body.tickers.some((row:any) => row.price !== null && Number(row.price) > 0)),
    (req,_res,next) => { req.url=req.url.replace('/cfd/display/tickers','/cfd/tickers'); next(); });
  router.get('/cfd/display/candles/:symbol', publicDisplayCache(SLOW_DISPLAY_REFRESH_MS,
    body => Array.isArray(body?.bars) && body.bars.length > 0),
    (req,_res,next) => { req.url=req.url.replace('/cfd/display/candles/','/cfd/candles/'); next(); });
  router.get('/cfd/tickers',async(_req,res)=>{
    try{
      if(displaySource===defaultDisplaySource)ensureDisplayFeeds();
      const [primaryRows,displayRows]=await Promise.all([bounded(cfdDataService.getQuotes(),[] as CfdQuote[]),displaySource?displaySource.getQuotes():Promise.resolve([] as CfdQuote[])]);
      const primary=new Map(primaryRows.map(q=>[q.symbol,q])),alternatives=new Map(displayRows.map(q=>[q.symbol,q])),catalog=cfdDataService.catalog();
      const tickers=CFD_REFERENCE_CATALOG.map(base=>{const financial=primary.get(base.symbol)??blankQuote(base.symbol);const q=displaySource?displaySource.choose(financial,alternatives.get(base.symbol)):financial;const status=displayStatus(q),asOf=q.providerTimestamp??q.fetchedAt;return{symbol:q.symbol,name:catalog.find(i=>i.symbol===q.symbol)?.name??base.name,price:q.last===null?null:q.lastDecimal??String(q.last),changePercent24h:q.changePercent24h,status,stale:status==='stale',marketClosed:status==='market_closed',displayOnly:Boolean(displaySource),executionAllowed:displaySource?false:q.executionAllowed,entitlementVerified:displaySource?false:q.entitlementVerified,provider:q.provider,providerSymbol:q.providerSymbol,providerTimestamp:q.providerTimestamp,fetchedAt:q.fetchedAt,asOf:typeof asOf==='number'&&Number.isFinite(asOf)?asOf:null,maxQuoteAgeMs:displaySource?.freshAgeMs??cfdDataService.maxQuoteAgeMs};});
      res.setHeader('Cache-Control','no-store');res.json({source:displaySource?'voltex-multi-source-display':'twelvedata',configured:cfdDataService.isConfigured()||Boolean(displaySource),tickers});
    }catch(err){console.error(err);res.status(500).json({error:'Internal server error'});}
  });
  router.get('/cfd/candles/:symbol',async(req,res)=>{
    const symbol=req.params.symbol.toUpperCase(),intervalRaw=typeof req.query.interval==='string'?req.query.interval:'15m',limit=Math.max(20,Math.min(500,Number(req.query.limit)||240));
    if(!CFD_SYMBOLS.includes(symbol as any)||!CFD_OHLC_INTERVALS.includes(intervalRaw as CfdOhlcInterval))return res.status(400).json({error:'invalid_cfd_candle_request'});
    const interval=intervalRaw as CfdOhlcInterval;
    try{
      let snapshot=null;
      if(collectorDisplay){try{snapshot=await collectorDisplay.getOhlc(symbol,interval,limit);}catch{}}
      if(!snapshot)snapshot=await biquoteOhlc.getOhlc(symbol,interval,limit);
      res.setHeader('Cache-Control','public, max-age=10, stale-while-revalidate=30');
      res.json(snapshot);
    }catch{res.status(503).json({error:'cfd_chart_temporarily_unavailable'});}
  });

  // Existing financial endpoints stay unchanged and continue to use the
  // original CfdMarketDataService. The visible practice UI never calls them.
  router.post('/cfd/positions',requireAuthOrApiKey(prisma),requireTradePermission,async(req:ApiAuthedRequest,res)=>{const parsed=openSchema.safeParse(req.body);if(!parsed.success)return res.status(400).json({error:parsed.error.issues[0]?.message??'Invalid request'});try{const position=await positionService.open({userId:req.userId!,symbol:parsed.data.symbol,side:parsed.data.side,quantity:new BigNumber(parsed.data.quantity),leverage:parsed.data.leverage});res.json({position:serializePosition(position)});}catch(err:any){if(err instanceof CfdQuoteUnavailable)return res.status(503).json({error:err.message,code:err.code});res.status(400).json({error:err.message});}});
  router.get('/cfd/positions',requireAuthOrApiKey(prisma),async(req:ApiAuthedRequest,res)=>{const positions=await positionService.listOpen(req.userId!);let tickers:{symbol:string;price:string}[]=[];try{const quotes=await cfdDataService.getQuotes();tickers=quotes.flatMap(q=>{try{return[{symbol:q.symbol,price:String(assertCfdFreshQuote(q,q.symbol,cfdDataService.maxQuoteAgeMs))}];}catch{return[];}});}catch{}const priceBySymbol=new Map(tickers.map(t=>[t.symbol,new BigNumber(t.price)]));res.json(positions.map(p=>{const markPrice=priceBySymbol.get(p.symbol)??null,size=new BigNumber(p.size.toString()),entryPrice=new BigNumber(p.entryPrice.toString()),initialMargin=new BigNumber(p.initialMargin.toString()),unrealizedPnl=markPrice?computeUnrealizedPnl(p.side as PositionSide,size,entryPrice,markPrice):null,roe=unrealizedPnl?computeROE(unrealizedPnl,initialMargin):null;return{...serializePosition(p),markPrice:markPrice?.toString()??null,unrealizedPnl:unrealizedPnl?.toString()??null,roe:roe?roe.times(100).toString():null};}));});
  router.get('/cfd/positions/history',requireAuthOrApiKey(prisma),async(req:ApiAuthedRequest,res)=>res.json((await positionService.listHistory(req.userId!)).map(serializePosition)));
  router.post('/cfd/positions/:positionId/close',requireAuthOrApiKey(prisma),requireTradePermission,async(req:ApiAuthedRequest,res)=>{try{res.json({position:serializePosition(await positionService.close({userId:req.userId!,positionId:req.params.positionId}))});}catch(err:any){if(err instanceof CfdQuoteUnavailable)return res.status(503).json({error:err.message,code:err.code});res.status(400).json({error:err.message});}});
  return router;
}
function serializePosition(p:any){return{id:p.id,symbol:p.symbol,side:p.side,size:p.size.toString(),entryPrice:p.entryPrice.toString(),leverage:p.leverage,initialMargin:p.initialMargin.toString(),liquidationPrice:p.liquidationPrice.toString(),status:p.status,realizedPnl:p.realizedPnl.toString(),openedAt:p.openedAt,closedAt:p.closedAt};}
