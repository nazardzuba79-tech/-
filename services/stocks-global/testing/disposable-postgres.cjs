// Acceptance support ONLY. Never reads DATABASE_URL/.env or a remote database.
const fs=require('node:fs'),path=require('node:path'),cp=require('node:child_process'),crypto=require('node:crypto');
function disposableUrl(){
  const raw=process.env.STOCKS_DISPOSABLE_PG_URL;if(!raw)return null;
  const url=new URL(raw),name=decodeURIComponent(url.pathname.slice(1));
  if(!['postgres:','postgresql:'].includes(url.protocol)||!['127.0.0.1','localhost','[::1]'].includes(url.hostname)||!/^stocks_disposable_[a-z0-9_]+$/.test(name)||process.env.STOCKS_PG_DISPOSABLE_CONFIRM!==name)throw Error('DISPOSABLE_LOCAL_PG_REQUIRED');
  return{raw,name,host:url.hostname,port:url.port||'5432'};
}
let setup;
async function prepareDisposableDatabase(){
  if(setup)return setup;
  setup=(async()=>{
    const target=disposableUrl();if(!target)throw Error('POSTGRES_NOT_AVAILABLE');
    const {PrismaClient}=require('@prisma/client'),db=new PrismaClient({datasources:{db:{url:target.raw}}});
    const found=await db.$queryRawUnsafe('SELECT current_database() AS name');if(found[0].name!==target.name)throw Error('DISPOSABLE_LOCAL_PG_REQUIRED');
    const root=path.resolve(__dirname,'../../..'),migration=fs.readFileSync(path.join(root,'prisma/migrations/20261016000000_stocks_test_cash_authority/migration.sql'),'utf8'),migrationSha256=crypto.createHash('sha256').update(migration).digest('hex');
    const tables=await db.$queryRawUnsafe("SELECT tablename FROM pg_tables WHERE schemaname='public'");
    if(tables.length){
      if(!tables.some(row=>row.tablename==='StocksFixtureSchemaProof'))throw Error('DISPOSABLE_DATABASE_MUST_BE_EMPTY');
      const marker=await db.$queryRawUnsafe('SELECT "baseSha","migrationSha256" FROM "StocksFixtureSchemaProof"');
      if(marker.length!==1||marker[0].baseSha!=='58540f49aed5d47a4458ab11270e0cb3aa7d26ce'||marker[0].migrationSha256!==migrationSha256)throw Error('DISPOSABLE_SCHEMA_PROOF_MISMATCH');
      await db.$disconnect();return{...target,migrationSha256,reusedOwnFixtureSchema:true};
    }
    await db.$disconnect();
    const out=path.join(root,'output','stocks-disposable-pg');fs.mkdirSync(out,{recursive:true});
    const schema=path.join(out,'base-schema.prisma');fs.writeFileSync(schema,cp.execFileSync('git',['-C',root,'show','58540f49aed5d47a4458ab11270e0cb3aa7d26ce:prisma/schema.prisma']));
    try{cp.execFileSync(process.execPath,[path.join(root,'node_modules/prisma/build/index.js'),'db','push','--skip-generate','--schema',schema],{env:{...process.env,DATABASE_URL:target.raw,DIRECT_URL:target.raw},stdio:'pipe'});}catch(error){throw Error('Disposable base schema setup failed: '+String(error.stderr??error.message).split(target.raw).join('[disposable-local-pg]'));}
    const client=new PrismaClient({datasources:{db:{url:target.raw}}});
    try{for(const statement of migration.split(';').map(x=>x.trim()).filter(Boolean))await client.$executeRawUnsafe(statement);await client.$executeRawUnsafe('CREATE TABLE "StocksFixtureSchemaProof" ("baseSha" TEXT NOT NULL,"migrationSha256" TEXT NOT NULL)');await client.$executeRawUnsafe('INSERT INTO "StocksFixtureSchemaProof" VALUES($1,$2)','58540f49aed5d47a4458ab11270e0cb3aa7d26ce',migrationSha256);}finally{await client.$disconnect();}
    return{...target,migrationSha256};
  })();return setup;
}
async function fixture(t,options={}){
  const target=await prepareDisposableDatabase();
  process.env.JWT_SECRET='synthetic-stocks-pg-'+crypto.randomBytes(32).toString('hex');
  // Set this once before the API middleware is loaded; every session below is
  // an explicit synthetic user, never a real identity/configuration lookup.
  global.__stocksPgFixtureSecret??=process.env.JWT_SECRET;process.env.JWT_SECRET=global.__stocksPgFixtureSecret;
  require('ts-node/register/transpile-only');
  const {PrismaClient}=require('@prisma/client'),express=require('express'),jwt=require('jsonwebtoken');
  const {stocksTestCashRouter}=require('../../../src/api/routes/stocksTestCash.ts');
  const {DemoTradingService}=require('../../../src/services/DemoTradingService.ts');
  const {MatchingEngine}=require('../../../src/matching-engine/MatchingEngine.ts');
  const {openPostgresAuthority}=await import('../postgres-authority.mjs'),{createAuthorityAdapter}=await import('../authority-adapter.mjs'),{createServer}=await import('../server.mjs');
  const db=new PrismaClient({datasources:{db:{url:target.raw}}}),other=new PrismaClient({datasources:{db:{url:target.raw}}});
  const suffix=crypto.randomUUID(),issuer='disposable-pg-fixture',users=['a','b'].map(name=>'synthetic-stock-'+name+'-'+suffix),principals=users.map(subject=>({issuer,subject}));
  let time=Date.now(),hook=async()=>{},after=async()=>{},apiServer,gateway;const now=()=>options.wallClock?Date.now():time;
  t.after(async()=>{hook=async()=>{};after=async()=>{};if(gateway)await gateway.close();if(apiServer){apiServer.closeAllConnections();await new Promise(resolve=>apiServer.close(resolve));}await db.$disconnect();await other.$disconnect();});
  const sessions=[],tokens=[];
  for(let i=0;i<2;i++){
    await db.user.create({data:{id:users[i],email:`${users[i]}@example.invalid`,passwordHash:'synthetic-no-password-login',referralCode:crypto.randomBytes(10).toString('hex'),role:i===0?'ADMIN':'USER'}});
    const session=await db.session.create({data:{userId:users[i]}});sessions.push(session.id);
    tokens.push(jwt.sign({sub:users[i],sid:session.id},process.env.JWT_SECRET,{expiresIn:'1h'}));
    await db.demoBalance.create({data:{userId:users[i],asset:'USDT',available:i===0?'731.25':'129.875',locked:'0'}});
  }
  const actors=users.map((userId,i)=>({issuer,subject:userId,userId,sessionId:sessions[i],expiresAt:jwt.decode(tokens[i]).exp*1000}));
  const boundedHook=async args=>{let timer;try{return await Promise.race([hook(args),new Promise((_,reject)=>timer=setTimeout(()=>reject(Error('synthetic PG barrier timed out')),5000))]);}finally{clearTimeout(timer);}};
  const authority=openPostgresAuthority(db,{issuer,tradePrincipals:principals,now,beforeCommit:boundedHook,afterCommit:args=>after(args)});
  // Explicit setup links existing fixture cash. No login/read/command seeding.
  for(const actor of actors)await authority.bindExisting(actor);
  const demo=new DemoTradingService(db,new MatchingEngine());
  // The two-trader execution acceptance opts into the second server gate explicitly (production default OFF);
  // `orderExecutionEnabled:false` exercises that default against the same real PostgreSQL authority.
  const gatewayKey=crypto.randomBytes(32).toString('hex'),api=express();api.use((req,res,next)=>{if(options.gatewayPort){res.set('Access-Control-Allow-Origin','http://127.0.0.1:'+options.gatewayPort);res.set('Access-Control-Allow-Headers','Authorization, Content-Type');res.set('Access-Control-Allow-Methods','GET, POST, OPTIONS');if(req.method==='OPTIONS')return res.sendStatus(204);}next();});api.use(express.json({limit:'16kb'}));api.use('/api/v1',stocksTestCashRouter(db,{enabled:true,orderExecutionEnabled:options.orderExecutionEnabled??true,issuer,principals,gatewayKey,secret:process.env.JWT_SECRET},authority));
  const {requireAuth}=require('../../../src/api/middleware/auth.ts');
  api.get('/api/v1/me',requireAuth(db),async(req,res)=>{const user=await db.user.findUnique({where:{id:req.userId},select:{id:true,email:true,role:true}});res.json({...user,isAdmin:user.role==='ADMIN',displayName:user.id.startsWith('synthetic-stock-a')?'Synthetic Alpha':user.id.startsWith('synthetic-stock-b')?'Synthetic Beta':'Synthetic Viewer'});});
  api.use('/api/v1',require('../../../src/api/routes/demoTrading.ts').demoTradingRouter(db,demo));
  apiServer=await new Promise(resolve=>{const server=api.listen(options.apiPort??0,'127.0.0.1',()=>resolve(server));});
  const adapter=createAuthorityAdapter({endpoint:`http://127.0.0.1:${apiServer.address().port}/api/v1/stocks-test-cash`,issuer,gatewayKey});
  const {CATALOG,instrument}=await import('../catalog.mjs');const ID='BYBIT:AAPLXUSDT';let price='100',quoteOffset=0;const sourceStarts=[];
  const hub=options.hub??{metrics:{syntheticSourceStarts:0},catalogue:async()=>CATALOG.map(row=>({...row,online:row.provider!=='moex',exists:true})),history:async(id,interval='15m',before=null)=>{const item=instrument(id),step=({'1m':60,'5m':300,'15m':900,'1h':3600,'4h':14400,'1d':86400}[interval]??900),end=Math.floor((before?Number(before)-1:now())/1000/step)*step;return{instrumentId:id,interval,currency:item.currency,provider:item.provider,delaySeconds:item.delaySeconds,receivedAt:now(),fixture:true,candles:Array.from({length:120},(_,index)=>{const close=100+Math.sin(index/8)*2,open=100+Math.sin((index-1)/8)*2;return{time:end-(119-index)*step,open,high:Math.max(open,close)+.4,low:Math.min(open,close)-.4,close,volume:1000+index};})};},quote:async id=>{const item=instrument(id);if(options.wallClock){const recent=sourceStarts.filter(row=>row.provider===item.provider&&now()-row.at<60000);if(recent.length>=100){const{SimError}=await import('../engine.mjs');throw new SimError('RATE_LIMIT');}}sourceStarts.push({at:now(),provider:item.provider});hub.metrics.syntheticSourceStarts++;if(options.sourceDelayMs)await new Promise(resolve=>setTimeout(resolve,options.sourceDelayMs));const at=now();return{instrumentId:id,provider:item.provider,nativeCurrency:item.currency,bid:price,ask:price,timestamp:at+quoteOffset,receivedAt:at,verified:true,marketOpen:true,eventId:'synthetic-pg-'+id+'-'+at,capacity:'1.00000000',prices:{USDT:{buy:price,sell:price},USDC:{buy:price,sell:price}},fx:item.currency==='USDT'?{}:{USDT:{rate:'1',timestamp:at,maxAgeMs:180000}}};}};
  gateway=await createServer({port:options.gatewayPort??0,dist:options.dist,accountAuthority:adapter,tradePrincipals:principals,hub,now});
  const request=async(route,{index=0,token,body,view}={})=>{const response=await fetch(`http://127.0.0.1:${gateway.port}/__stocks_global/`+route,{method:body===undefined?'GET':'POST',headers:{authorization:'Bearer '+(token??tokens[index]),...(view?{'x-stocks-view':view}:{}),...(body===undefined?{}:{'content-type':'application/json','x-stocks-token':body.gatewayToken??''})},body:body===undefined?undefined:JSON.stringify((({gatewayToken,...rest})=>rest)(body))});return{status:response.status,data:await response.json()};};
  const ready=async(index=0,token)=>{await request('state?id='+encodeURIComponent(ID),{index,token});if(options.wallClock)await new Promise(resolve=>setTimeout(resolve,2100));else time+=3000;return(await request('state?id='+encodeURIComponent(ID),{index,token})).data.token;};
  const rows=async()=>({cash:await db.demoBalance.findMany({where:{userId:{in:users}},orderBy:{userId:'asc'}}),accounts:await db.$queryRawUnsafe('SELECT * FROM "StocksTestAccount" WHERE "userId" IN($1,$2) ORDER BY "userId"',...users),receipts:await db.$queryRawUnsafe('SELECT r.* FROM "StocksTestReceipt" r JOIN "StocksTestAccount" a ON a."principalHash"=r."principalHash" WHERE a."userId" IN($1,$2) ORDER BY r."intentId"',...users),audit:await db.$queryRawUnsafe('SELECT * FROM "StocksTestAudit" WHERE "userId" IN($1,$2) ORDER BY "intentId"',...users)});
  return{target,db,other,authority,actors,users,sessions,tokens,gateway,demo,request,ready,rows,ID,apiOrigin:`http://127.0.0.1:${apiServer.address().port}`,hub,sourceStarts,now,advance:(ms,value=price)=>{time+=ms;price=value;},setSourceOffset:value=>quoteOffset=value,setBefore:fn=>hook=fn,setAfter:fn=>after=fn,newViewer:async index=>{const id='synthetic-viewer-'+index+'-'+suffix;await db.user.create({data:{id,email:id+'@example.invalid',passwordHash:'synthetic-no-password-login',referralCode:crypto.randomBytes(10).toString('hex'),role:'USER'}});const session=await db.session.create({data:{userId:id}});return{id,token:jwt.sign({sub:id,sid:session.id},process.env.JWT_SECRET,{expiresIn:'1h'})};},newSession:async(index=0)=>{const session=await db.session.create({data:{userId:users[index]}});const token=jwt.sign({sub:users[index],sid:session.id},process.env.JWT_SECRET,{expiresIn:'1h'});return{sessionId:session.id,token};}};
}
module.exports={disposableUrl,prepareDisposableDatabase,fixture};
