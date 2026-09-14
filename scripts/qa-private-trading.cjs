/** Owner-only loopback preview on the explicitly isolated Neon test branch.
 * No production financial router/scheduler is loaded. Public market GETs only
 * may be forwarded; all private state writes stay in the allowlisted test DB.
 */
require('dotenv').config();
const {randomBytes}=require('node:crypto');
const fs=require('node:fs'),path=require('node:path');
const express=require('express'),jwt=require('jsonwebtoken');
const {PrismaClient}=require('@prisma/client');
const expected='ep-damp-sky-axh52ggd-pooler.c-4.us-east-2.aws.neon.tech';
if(new URL(process.env.DATABASE_URL||'http://invalid').hostname!==expected)throw Error('Private QA requires the isolated codex-private-trading-replay-20260914 database');
if(process.env.PRIVATE_TRADING_ENABLED!=='true'||!process.env.PRIVATE_TRADING_OWNER_ID)throw Error('Private QA owner/flag required');
const runtimeFile=path.resolve(__dirname,'../node_modules/.private-qa-session.json');
const runtime=fs.existsSync(runtimeFile)?JSON.parse(fs.readFileSync(runtimeFile,'utf8')):{secret:randomBytes(48).toString('hex')};
process.env.JWT_SECRET=runtime.secret;
const {PrivateTradingStore}=require('../dist/private-trading/store');
const {PrivateTradingService}=require('../dist/private-trading/service');
const {PrivateTradingMarketData}=require('../dist/private-trading/marketData');
const {privateTradingRouter}=require('../dist/api/routes/privateTrading');
const {requireAuth}=require('../dist/api/middleware/auth');
const {collectorServer}=require('../dist/services/marketData/live/collectorServer');
const {FuturesChartCandles}=require('../dist/services/FuturesChartCandles');
const db=new PrismaClient(),app=express(),port=Number(process.env.PRIVATE_QA_PORT||4220);
let service,collector,server;
async function main(){
  const owner=await db.user.findUniqueOrThrow({where:{id:process.env.PRIVATE_TRADING_OWNER_ID},select:{id:true,email:true,displayName:true,role:true,blockedAt:true,kycStatus:true,createdAt:true}});
  if(owner.role!=='ADMIN'||owner.blockedAt)throw Error('Test owner does not qualify');
  let session=runtime.sessionId?await db.session.findUnique({where:{id:runtime.sessionId}}):null;
  if(!session||session.revokedAt||session.userId!==owner.id){session=await db.session.create({data:{userId:owner.id,ip:'127.0.0.1',userAgent:'Private trading isolated QA preview'}});runtime.sessionId=session.id;}
  fs.writeFileSync(runtimeFile,JSON.stringify(runtime),{mode:0o600});
  const collectorToken=randomBytes(32).toString('hex');
  // Use the real collector routes with the real public Bybit source. The stub
  // satisfies unrelated collector snapshot routes; those are never forwarded.
  const source={snapshot:()=>({status:'unavailable'}),subscribe:()=>()=>{}};
  const collectorBundle=collectorServer(source,collectorToken,()=>({privateQa:true}));
  collector=collectorBundle.server;
  await new Promise(resolve=>collector.listen(0,'127.0.0.1',resolve));
  const collectorPort=collector.address().port;
  service=new PrivateTradingService(new PrivateTradingStore(db),new PrivateTradingMarketData({collector:{url:`http://127.0.0.1:${collectorPort}`,token:collectorToken}}));
  app.disable('x-powered-by');
  app.use((req,res,next)=>{
    if(req.headers.host!==`127.0.0.1:${port}`||!['127.0.0.1','::ffff:127.0.0.1'].includes(req.socket.remoteAddress))return res.sendStatus(403);
    if(req.headers.origin&&req.headers.origin!==`http://127.0.0.1:${port}`)return res.sendStatus(403);
    res.setHeader('Cache-Control','private, no-store');next();
  });
  app.use(express.json({limit:'128kb'}));
  app.get('/__qa/start',(_req,res)=>{
    const token=jwt.sign({sub:owner.id,sid:session.id},runtime.secret,{expiresIn:'12h'});
    res.type('html').send(`<script>localStorage.setItem('exchange_token',${JSON.stringify(token)});location.replace('/futures?privateTrading=1');</script>`);
  });
  app.get('/__qa/logout',(_req,res)=>res.type('html').send("<script>localStorage.removeItem('exchange_token');location.replace('/futures?privateTrading=1');</script>"));
  app.get('/api/v1/me',requireAuth(db),(_req,res)=>res.json({...owner,isAdmin:true}));
  app.use('/api/v1',privateTradingRouter(db,service));
  const candles=new FuturesChartCandles();
  app.get('/api/v1/market/futures/candles/:pair',async(req,res)=>{try{res.json(await candles.get(req.params.pair,String(req.query.interval||'1h'),Number(req.query.limit||520)));}catch{res.status(503).json({error:'Candles unavailable'});}});
  app.use('/api/v1',async(req,res)=>{
    const allowed=req.method==='GET'&&(req.path.startsWith('/market/')||/^\/futures\/(mark-price|funding-rate)\/[^/]+$/.test(req.path)||['/pairs','/futures/config','/futures/markets'].includes(req.path));
    if(!allowed)return res.status(403).json({error:'This test preview enables private simulation operations only'});
    const controller=new AbortController();res.on('close',()=>controller.abort());
    try{const upstream=await fetch('https://api.voltextech.net/api/v1'+req.url,{signal:AbortSignal.any([controller.signal,AbortSignal.timeout(req.path==='/market/live'?300000:15000)])});
      res.status(upstream.status);res.setHeader('Content-Type',upstream.headers.get('content-type')||'application/json');
      for await(const chunk of upstream.body){if(res.destroyed)break;res.write(chunk);}res.end();
    }catch{if(!res.headersSent)res.status(503).json({error:'Public market data unavailable'});else res.end();}
  });
  const dist=path.resolve(__dirname,'../frontend/dist');app.use(express.static(dist));app.get('*',(_req,res)=>res.sendFile(path.join(dist,'index.html')));
  server=app.listen(port,'127.0.0.1',()=>console.log(`Private test preview: http://127.0.0.1:${port}/__qa/start`));service.start();
}
async function stop(){service?.stop();server?.close();collector?.close();await db.$disconnect();process.exit(0);}
process.on('SIGINT',stop);process.on('SIGTERM',stop);
main().catch(error=>{console.error(error.message);process.exit(1);});
