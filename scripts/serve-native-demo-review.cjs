/** Isolated interactive REVIEW: the real Futures React page + real native demo engine.
 * Synthetic demo capital, per-browser account, public mainnet prices only.
 * No production credentials, production database, real account, exchange matching or wallet endpoints.
 */
const express=require('express'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const{randomBytes,createHash}=require('node:crypto');
const{NativeDemoService}=require('../dist/private-trading/native/service');
const{nativeDemoRoutes}=require('../dist/private-trading/native/routes');
const{emptyDemoState}=require('../dist/private-trading/native/engine');
const{commandHash}=require('../dist/private-trading/native/store');
const{PrivateTradingMarketData,CollectorPrivateTradingSource}=require('../dist/private-trading/marketData');
const root=path.resolve(__dirname,'..'),dist=path.join(root,'frontend/dist');
const fixture=process.env.NATIVE_PREVIEW_FIXTURE==='1';
const dataDir=path.join(os.tmpdir(),'voltex-native-demo-review');fs.mkdirSync(dataDir,{recursive:true});
const app=express();app.disable('x-powered-by');app.use(express.json({limit:'50kb'}));
app.use((_req,res,next)=>{res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','same-origin');next();});
const source=new CollectorPrivateTradingSource();
const now=()=>Date.now(),started=now(),symbols=['BTCUSDT','ETHUSDT','SOLUSDT'];
function fixtureCandle(t,interval=60000){const x=Math.sin(t/3600000)*.02,y=Math.sin((t+interval)/3600000)*.02;const o=50000*(1+x),c=50000*(1+y);return{timestamp:t,open:o.toFixed(1),high:(Math.max(o,c)+150).toFixed(1),low:(Math.min(o,c)-150).toFixed(1),close:c.toFixed(1),volume:'125'};}
const sizes={'1m':60000,'5m':300000,'15m':900000,'1h':3600000,'4h':14400000,'1d':86400000,'1w':604800000};
function fixtureInstrument(symbol){return{provider:'bybit',symbol,baseAsset:symbol.replace(/USDT$/,''),quoteAsset:'USDT',settleAsset:'USDT',contractType:'LinearPerpetual',status:'Trading',launchTime:1577836800000,fetchedAt:now(),fundingIntervalMinutes:480,filters:{tickSize:'0.1',minPrice:'0.1',maxPrice:'10000000',qtyStep:'0.001',minOrderQty:'0.001',maxOrderQty:'1000',maxMarketOrderQty:'1000',minNotionalValue:'5'},leverage:{min:'1',max:'100',step:'1'},riskTiers:[{riskLimitValue:'1000000000',maintenanceMarginRate:'0.005',initialMarginRate:'0.01',maintenanceDeduction:'0',maxLeverage:'100'}],parameterModel:'CURRENT_INSTRUMENT_PARAMETERS',parameterVersion:'QA_ONLY_NOT_MARKET'};}
async function transport(url,options={}){
  const u=new URL(url),m=/^\/internal\/v1\/private-trading\/([^/]+)\/([A-Z0-9]+)$/.exec(u.pathname);if(!m)throw new Error('Path denied');
  const[kind,symbol]=m.slice(1),q=u.searchParams;let result;
  if(fixture){
    if(kind==='instruments')result=fixtureInstrument(symbol);
    else if(kind==='quote'){const price=Number(fixtureCandle(Math.floor(now()/60000)*60000).close);result={provider:'bybit',symbol,bids:[{price:(price-.1).toFixed(1),quantity:'10'}],asks:[{price:(price+.1).toFixed(1),quantity:'10'}],markPrice:price.toFixed(1),lastPrice:price.toFixed(1),fundingRate:'0.0001',nextFundingTime:(Math.floor(now()/28800000)+1)*28800000,providerTimestamp:now(),bookGeneratedAt:now(),markProviderTimestamp:now(),fetchedAt:now()};}
    else if(kind==='chart-candles'){const step=sizes[q.get('interval')],end=Number(q.get('endTime')||now()),limit=Number(q.get('limit')||520);const last=Math.floor(end/step)*step;result={source:'BYBIT_LINEAR',symbol,interval:q.get('interval'),candles:Array.from({length:limit},(_,i)=>fixtureCandle(last-(limit-i-1)*step,step)),fetchedAt:now(),providerTimestamp:now()};}
    else if(kind==='candles'){const start=Number(q.get('startTime')),end=Number(q.get('endTime')),step=Number(q.get('intervalMinutes'))*60000;result={symbol,candles:Array.from({length:Math.floor((end-start)/step)+1},(_,i)=>fixtureCandle(start+i*step,step)),fetchedAt:now()};}
    else result={symbol,events:[],fetchedAt:now()};
  }else if(kind==='instruments')result=await source.instrument(symbol,options.signal);
  else if(kind==='quote')result=await source.freshQuote(symbol,options.signal);
  else if(kind==='chart-candles')result=await source.chartCandles({symbol,interval:q.get('interval'),limit:Number(q.get('limit')||520),...(q.has('endTime')?{endTime:Number(q.get('endTime'))}:{}),signal:options.signal});
  else if(kind==='candles')result=await source.candles(symbol,q.get('kind'),Number(q.get('intervalMinutes')),Number(q.get('startTime')),Number(q.get('endTime')),options.signal);
  else result=await source.funding(symbol,Number(q.get('startTime')),Number(q.get('endTime')),options.signal);
  return new Response(JSON.stringify(result),{status:200,headers:{'Content-Type':'application/json'}});
}
const market=new PrivateTradingMarketData({collector:{url:'http://127.0.0.1',token:'preview-local-public-market-only'},request:transport});
const sessions=new Map();
function session(token){if(!/^[a-f0-9]{48}$/.test(token??''))return null;let s=sessions.get(token);if(s)return s;const file=path.join(dataDir,token+'.json');if(fs.existsSync(file)){try{s=JSON.parse(fs.readFileSync(file,'utf8'));sessions.set(token,s);return s;}catch{}}return null;}
function save(token,s){sessions.set(token,s);const file=path.join(dataDir,token+'.json'),tmp=file+'.tmp';fs.writeFileSync(tmp,JSON.stringify(s));fs.renameSync(tmp,file);}
class ReviewRepository{
  account(actor){const s=session(actor.sessionId);if(!s||s.userId!==actor.userId)throw new Error('Denied');return s;}
  async read(actor){return structuredClone(this.account(actor).row);}
  async available(actor){return this.account(actor).row?'0':'10000000';}
  async revision(actor,revision){return structuredClone(this.account(actor).revisions[revision]??null);}
  async prior(actor,key,hash){const entry=this.account(actor).commands[key];if(!entry)return null;if(entry.hash!==hash)throw new Error('IDEMPOTENCY_CONFLICT');return structuredClone(entry.row);}
  async initialize(actor,key){const s=this.account(actor);if(s.row)return structuredClone(s.row);const t=now(),row={revision:1,deposit:'10000000',commands:[],snapshot:emptyDemoState('10000000',t),createdAt:t,source:'PREVIEW_FIXTURE'};s.row=row;s.revisions[1]=row;s.commands[key]={hash:commandHash({kind:'INITIALIZE'}),row};save(actor.sessionId,s);return structuredClone(row);}
  async commit(actor,expected,next,key,hash){const s=this.account(actor),prior=await this.prior(actor,key,hash);if(prior)return prior;if(s.row?.revision!==expected)throw new Error('ACCOUNT_CHANGED');const row=structuredClone({...next,revision:expected+1});s.row=row;s.revisions[row.revision]=row;s.commands[key]={hash,row};save(actor.sessionId,s);return structuredClone(row);}
}
const service=new NativeDemoService(new ReviewRepository(),market);
const asyncRoute=fn=>(req,res,next)=>Promise.resolve(fn(req,res)).catch(next);
app.get('/health',(_req,res)=>res.json({status:'ok',kind:'isolated-native-demo-preview',fixtureMarket:fixture,commit:process.env.RENDER_GIT_COMMIT??null}));
app.use('/api/v1/private-trading',(req,res,next)=>{const token=req.headers.authorization?.replace(/^Bearer /,''),s=session(token);if(!s)return res.status(401).json({error:'Preview session required'});res.locals.actor={userId:s.userId,sessionId:token,expiresAt:now()+3600000};next();});
app.get('/api/v1/private-trading/access',(_req,res)=>res.json({allowed:true,nativeAvailable:true,mode:'PREVIEW_FIXTURE'}));
app.use('/api/v1/private-trading/native',nativeDemoRoutes(service,res=>res.locals.actor));
app.get('/api/v1/private-trading/candles',asyncRoute(async(req,res)=>res.json(await market.chartCandles({symbol:String(req.query.symbol).replace('/',''),interval:req.query.interval,limit:Number(req.query.limit||520),...(req.query.endTime?{endTime:Number(req.query.endTime)}:{})}))));
let tickCache=null;
async function tickers(){if(tickCache&&now()-tickCache.at<5000)return tickCache.rows;let list,time=now();
  if(fixture)list=symbols.map(symbol=>({symbol,lastPrice:fixtureCandle(Math.floor(now()/60000)*60000).close,bid1Price:'50000',ask1Price:'50001',highPrice24h:'51000',lowPrice24h:'49000',volume24h:'1000',turnover24h:'50000000',price24hPcnt:'0.01',markPrice:fixtureCandle(Math.floor(now()/60000)*60000).close,indexPrice:'50000',fundingRate:'0.0001',openInterest:'10000',openInterestValue:'500000000'}));
  else{const r=await fetch('https://api.bybit.com/v5/market/tickers?category=linear',{signal:AbortSignal.timeout(8000)});const j=await r.json();if(!r.ok||j.retCode!==0)throw new Error('Public tickers unavailable');list=j.result.list;time=Number(j.time);}
  const number=x=>x===undefined||x===null||x===''?null:Number.isFinite(Number(x))?Number(x):null;
  const rows=list.filter(x=>symbols.includes(x.symbol)).map(x=>{const base=x.symbol.replace(/USDT$/,''),pair=base+'/USDT';return{id:'linear_perpetual:'+x.symbol,pair,symbol:pair,providerSymbol:x.symbol,provider:'bybit',marketType:'linear_perpetual',baseAsset:base,quoteAsset:'USDT',settleAsset:'USDT',lastPrice:number(x.lastPrice),bidPrice:number(x.bid1Price),askPrice:number(x.ask1Price),high24h:number(x.highPrice24h),low24h:number(x.lowPrice24h),volume24h:number(x.volume24h),quoteVolume24h:number(x.turnover24h),changePercent24h:number(x.price24hPcnt)===null?null:number(x.price24hPcnt)*100,indexPrice:number(x.indexPrice),markPrice:number(x.markPrice),fundingRate:number(x.fundingRate),fundingIntervalMinutes:null,openInterest:number(x.openInterest),openInterestValue:number(x.openInterestValue),providerEventAt:time,sequence:null,receivedAt:now(),fetchedAt:time,stale:now()-time>10000};});tickCache={at:now(),rows};return rows;}
app.get('/api/v1/market/live',asyncRoute(async(req,res)=>{res.setHeader('Content-Type','text/event-stream');res.setHeader('Connection','keep-alive');res.flushHeaders();let rev=0,closed=false;const send=async()=>{try{const rows=await tickers();if(!closed)res.write(`event: snapshot\ndata: ${JSON.stringify({version:1,type:'snapshot',status:rows.some(r=>r.stale)?'stale':'live',rows,revision:rev++,epoch:String(started)})}\n\n`);}catch{if(!closed)res.write(`event: state\ndata: ${JSON.stringify({version:1,type:'state',status:'stale',rows:[],revision:rev++,epoch:String(started)})}\n\n`);}};await send();const timer=setInterval(send,5000);req.on('close',()=>{closed=true;clearInterval(timer);});}));
app.get('/api/v1/market/universe',asyncRoute(async(_req,res)=>{const instruments=[];for(const symbol of symbols){const i=await market.instrument(symbol);instruments.push({symbol:i.baseAsset+'/USDT',marketType:'linear_perpetual',quoteAsset:i.quoteAsset,settleAsset:i.settleAsset,status:i.status});}res.json({available:true,value:{instruments}});}));
app.get('/api/v1/futures/config',asyncRoute(async(_req,res)=>{const i=await market.instrument('BTCUSDT');res.json({symbols:symbols.map(s=>s.replace(/USDT$/,'/USDT')),minLeverage:Number(i.leverage.min),maxLeverage:Number(i.leverage.max),fundingIntervalHours:null,highLeverageWarningThreshold:null,leverageTiers:[]});}));
app.get('/api/v1/futures/mark-price/:pair',asyncRoute(async(req,res)=>{const symbol=req.params.pair.replace('-',''),q=await market.freshQuote(symbol);res.json({symbol,markPrice:q.markPrice,indexPrice:null});}));
app.get('/api/v1/market/external/tickers',asyncRoute(async(_req,res)=>res.json(await tickers())));
app.get('/api/v1/me',(_req,res)=>res.json({id:'preview-only',email:'preview.invalid',displayName:'Demo Preview',phone:null,country:null,avatarUrl:null,isAdmin:true,kycStatus:'NOT_STARTED',twoFactorEnabled:false,createdAt:new Date(started).toISOString()}));
// The preview cannot reach any real account writes, including the Real switch in the native shell.
app.use('/api',(_req,res)=>res.status(403).json({error:'Endpoint unavailable in isolated preview'}));
app.use(express.static(dist,{index:false,maxAge:0}));
app.get('*',(req,res)=>{let token=/(?:^|;\s*)native_review=([a-f0-9]{48})(?:;|$)/.exec(req.headers.cookie||'')?.[1];let s=session(token);
  if(!s){token=randomBytes(24).toString('hex');s={userId:'preview-'+createHash('sha256').update(token).digest('hex').slice(0,16),row:null,revisions:{},commands:{}};save(token,s);res.cookie('native_review',token,{httpOnly:true,sameSite:'lax',secure:req.headers['x-forwarded-proto']==='https',maxAge:86400000});}
  const html=fs.readFileSync(path.join(dist,'index.html'),'utf8').replace('<head>','<head><script>localStorage.setItem("exchange_token",'+JSON.stringify(token)+');localStorage.setItem("exchange_lang","ru");if(location.pathname==="/")history.replaceState(null,"","/futures?demo=1");</script>');res.type('html').send(html);});
app.use((e,_req,res,_next)=>{const safe=e?.name==='ZodError'?'Проверьте параметры запроса':e?.code&&/^[a-zA-Z0-9_]+$/.test(e.code)?e.code:e?.message&&/^[A-Z0-9_]+$/.test(e.message)?e.message:'Данные или расчёт временно недоступны';res.status(e?.status||503).json({error:safe});});
app.listen(Number(process.env.PORT||4178),'0.0.0.0',()=>console.log('Native demo review ready (isolated preview only)'));
