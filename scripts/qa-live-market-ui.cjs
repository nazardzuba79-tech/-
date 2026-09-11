// Local production-bundle UI verification only. Deterministic fixtures,
// native browser EventSource, no production credentials or financial writes.
const express=require('express'),fs=require('node:fs'),path=require('node:path');
const {LiveFeed}=require('../dist/services/marketData/live/contract');
const {marketLiveRouter}=require('../dist/api/routes/marketLive');
const {BybitTickerBook}=require('../dist/services/marketData/bybit/BybitTickerBook');
const book=new BybitTickerBook(),feed=new LiveFeed('browser-qa');
const instruments=Array.from({length:650},(_,i)=>({symbol:`ASSET${i}/USDT`,providerSymbol:`ASSET${i}USDT`,marketType:'spot',baseAsset:`ASSET${i}`,quoteAsset:'USDT',settleAsset:null,status:'Trading',fundingIntervalMinutes:null}));
book.setUniverse(instruments);
book.bootstrap('spot',{fetchedAt:Date.now(),stale:false,value:instruments.map(i=>({...i,lastPrice:12.5,bidPrice:12,askPrice:13,high24h:15,low24h:10,volume24h:0,quoteVolume24h:0,changePercent24h:0,indexPrice:null,markPrice:null,fundingRate:null,openInterest:null}))});
feed.status='live';feed.publish('snapshot',[...book.rows.values()]);
const assets=Array.from({length:600},(_,i)=>({id:`cg:fixture-${i}`,symbol:`ASSET${i}`,name:`Fixture Asset ${i}`,logoUrl:null,providers:{coingecko:`fixture-${i}`},tradingPairs:[],tradable:false,metadataSource:'coingecko',rank:i+1,ambiguous:i===0,collidingIds:i===0?['cg:collision']:[],market:{priceUsd:8,changePercent24h:3,marketCapUsd:10000000-i,volume24hUsd:1000,circulatingSupply:100000}}));
assets.push({...assets[0],id:'cg:collision',name:'Different Identity'});
const app=express();app.use(express.json());let report=null,requests={};
app.use((req,res,next)=>{requests[req.path]=(requests[req.path]||0)+1;next();});
app.post('/__qa/report',(req,res)=>{report=req.body;res.sendStatus(204);});
app.get('/__qa/report',(_req,res)=>res.json({browser:report,requests,listeners:feed.subscriberCount}));
app.get('/api/v1/market/assets',(_req,res)=>res.json({available:true,source:'coingecko',fetchedAt:Date.now(),stale:false,value:{assets,catalogueTotal:assets.length,tradableCount:0,collisions:['ASSET0'],metadataComplete:true}}));
app.get('/api/v1/market/assets/icons',(_req,res)=>res.json({assets:{}}));
app.get('/api/v1/market/snapshot',(_req,res)=>res.json({tickers:{available:false,reason:'fixture'},overview:{available:false,reason:'fixture'},sentiment:{available:false,reason:'fixture'}}));
app.get('/api/v1/me',(_req,res)=>res.json({id:'qa',displayName:'Local QA',email:'qa@example.invalid',kycStatus:'NOT_STARTED',isAdmin:false}));
app.get('/api/v1/futures/config',(_req,res)=>res.json({symbols:[]}));
app.get('/api/v1/market/external/rankings',(_req,res)=>res.json({rankings:[]}));
app.use('/api/v1',marketLiveRouter(feed));
app.get('/api/v1/*',(_req,res)=>res.json([]));
const dist=path.join(__dirname,'../frontend/dist');app.use(express.static(dist,{index:false}));
app.get('*',(_req,res)=>res.type('html').send(fs.readFileSync(path.join(dist,'index.html'),'utf8').replace('<head>',`<head><script>
localStorage.setItem('exchange_token','local-qa');localStorage.setItem('exchange_lang','en');
const original=window.EventSource;const stats={connections:0,latencies:[],snapshots:0,deltas:0,errors:[]};
window.EventSource=class extends original {constructor(...args){super(...args);stats.connections++;for(const kind of ['snapshot','delta'])this.addEventListener(kind,event=>{const f=JSON.parse(event.data);stats[kind==='snapshot'?'snapshots':'deltas']++;if(kind==='delta')stats.latencies.push(Date.now()-f.sentAt);});}};
window.addEventListener('error',e=>stats.errors.push(e.message));
setInterval(()=>{fetch('/__qa/report',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...stats,width:innerWidth,rows:document.querySelectorAll('.vx-cat-table tbody tr').length,overflow:document.documentElement.scrollWidth>innerWidth})});},3000);
</script>`)));
let sequence=0;const timer=setInterval(()=>{const row=feed.rows.get('spot:ASSET1USDT');feed.publish('delta',[{...row,lastPrice:12.5+(sequence++%10)/100,receivedAt:Date.now(),fetchedAt:Date.now()}]);},250);
const server=app.listen(4205,'127.0.0.1',()=>console.log('UI QA http://127.0.0.1:4205/markets'));
for(const sig of ['SIGTERM','SIGINT'])process.on(sig,()=>{clearInterval(timer);server.closeAllConnections();server.close();});
