/* Local visual QA: real native routes/repository and a disposable PostgreSQL
 * account. Public market fixtures are reused from the existing layout harness. */
const fs=require('node:fs'),path=require('node:path'),{randomBytes}=require('node:crypto');
const express=require('express'),jwt=require('jsonwebtoken'),{PrismaClient}=require('@prisma/client');
const url=process.env.NATIVE_EGRESS_TEST_DATABASE_URL;
if(!url||new URL(url).hostname!=='127.0.0.1'||new URL(url).pathname!=='/voltex_native_egress_test')throw Error('disposable local database required');
process.env.JWT_SECRET=randomBytes(32).toString('hex');
const {requireAuth}=require('../dist/api/middleware/auth');
const {nativeDemoRoutes}=require('../dist/private-trading/native/routes');
const {PrismaNativeRepository}=require('../dist/private-trading/native/store');
const {NativeDemoService}=require('../dist/private-trading/native/service');
const {NativeLimitPass}=require('../dist/private-trading/native/limitPass');
const {Clock,FakeMarket}=require('../dist/private-trading/native/testing/liveFixture');

async function main(){
  const db=new PrismaClient({datasources:{db:{url}}});
  const seed=await db.nativeDemoRevision.findFirst({where:{requestKey:'fixture-seed',requestHash:'fixture'},orderBy:{createdAt:'desc'},select:{userId:true}});
  const row=seed&&await db.nativeDemoAccount.findUnique({where:{userId:seed.userId}});if(!row)throw Error('run measurement fixture first');
  const session=await db.session.findFirst({where:{userId:row.userId},select:{id:true}});if(!session)throw Error('fixture session missing');
  const actor={userId:row.userId,sessionId:session.id,expiresAt:Date.now()+2*3600_000};
  const token=jwt.sign({sub:actor.userId,sid:actor.sessionId},process.env.JWT_SECRET,{expiresIn:'2h'});
  const clock=new Clock(row.payload.snapshot.time+5001),market=new FakeMarket(clock);
  const repo=new PrismaNativeRepository(db,()=>({enabled:true,ownerId:actor.userId}));
  const service=new NativeDemoService(repo,market,clock.now);
  const worker=new NativeLimitPass(service,async()=>[actor],clock.now);
  const observations=[];
  const layout=fs.readFileSync(path.join(__dirname,'qa-futures-layout.cjs'),'utf8');
  const prefix=layout.slice(0,layout.indexOf("app.get('/api/v1/*'"));
  const app=new Function('require','__dirname','process',prefix+';return app;')(require,__dirname,process);
  const auth=requireAuth(db);
  app.use((req,res,next)=>{const entry={method:req.method,path:req.path,status:0};if(req.path.includes('private-trading')){observations.push(entry);res.on('finish',()=>entry.status=res.statusCode);}next();});
  app.get('/__qa/status',(_req,res)=>res.json({fixture:true,requests:observations}));
  app.get('/api/v1/private-trading/access',auth,(_req,res)=>res.json({allowed:true,nativeAvailable:true,simulationOnly:true}));
  app.use('/api/v1/private-trading/native',auth,nativeDemoRoutes(service,()=>actor));
  app.get('/api/v1/private-trading/candles',auth,(req,res)=>res.json({source:'BYBIT_LINEAR',symbol:req.query.symbol,interval:req.query.interval,candles:Array.from({length:100},(_,i)=>({time:Math.floor(clock.t/60_000)*60-60*(100-i),open:50000,high:50010,low:49990,close:50000,volume:1}))}));
  app.use((err,_req,res,_next)=>res.status(err.status||500).json({code:err.code||'qa_error',error:err.message}));
  app.get('/api/v1/*',(_req,res)=>res.json([]));
  const dist=path.resolve('frontend/dist');app.use(express.static(dist,{index:false}));
  app.get('*',(_req,res)=>res.type('html').send(fs.readFileSync(path.join(dist,'index.html'),'utf8').replace('<head>',`<head><script>localStorage.setItem('exchange_token',${JSON.stringify(token)});localStorage.setItem('exchange_lang','en');window.WebSocket=function(){this.readyState=3;this.close=function(){};this.send=function(){};};</script>`)));
  setInterval(()=>{clock.t+=1000;},1000).unref();worker.start();
  app.listen(4397,'127.0.0.1',()=>console.log('Native egress QA: http://127.0.0.1:4397/futures (LOCAL SYNTHETIC ACCOUNT)'));
}
main().catch(e=>{console.error(e.message);process.exitCode=1;});
