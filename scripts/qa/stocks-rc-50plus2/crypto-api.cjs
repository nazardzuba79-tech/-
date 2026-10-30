'use strict';
// Separated topology only: the crypto API process of the separated release layout. The same synthetic rows,
// tokens and crypto routes as fixture() in services/stocks-global/testing/disposable-postgres.cjs (a protected
// review file, left byte-identical), without the Stocks router or gateway: those run in their own processes
// (stocks-worker.cjs) and reach these rows through PostgreSQL only. Returns the subset api-worker.cjs uses.
const path=require('node:path'),crypto=require('node:crypto'),{pathToFileURL}=require('node:url');
async function cryptoApi(root,after){
 const {prepareDisposableDatabase}=require(path.join(root,'services/stocks-global/testing/disposable-postgres.cjs'));
 const target=await prepareDisposableDatabase();
 process.env.JWT_SECRET='synthetic-stocks-pg-'+crypto.randomBytes(32).toString('hex');
 global.__stocksPgFixtureSecret??=process.env.JWT_SECRET;process.env.JWT_SECRET=global.__stocksPgFixtureSecret;
 require(require.resolve('ts-node/register/transpile-only',{paths:[root]}));
 const {PrismaClient}=require('@prisma/client'),express=require(require.resolve('express',{paths:[root]})),jwt=require(require.resolve('jsonwebtoken',{paths:[root]}));
 const {DemoTradingService}=require(path.join(root,'src/services/DemoTradingService.ts'));
 const {MatchingEngine}=require(path.join(root,'src/matching-engine/MatchingEngine.ts'));
 const {openPostgresAuthority}=await import(pathToFileURL(path.join(root,'services/stocks-global/postgres-authority.mjs')).href);
 const db=new PrismaClient({datasources:{db:{url:target.raw}}});
 const suffix=crypto.randomUUID(),issuer='disposable-pg-fixture',users=['a','b'].map(name=>'synthetic-stock-'+name+'-'+suffix),principals=users.map(subject=>({issuer,subject}));
 let apiServer,gatewayPort;
 after(async()=>{if(apiServer){apiServer.closeAllConnections();await new Promise(resolve=>apiServer.close(resolve));}await db.$disconnect();});
 const sessions=[],tokens=[];
 for(let i=0;i<2;i++){
  await db.user.create({data:{id:users[i],email:`${users[i]}@example.invalid`,passwordHash:'synthetic-no-password-login',referralCode:crypto.randomBytes(10).toString('hex'),role:i===0?'ADMIN':'USER'}});
  const session=await db.session.create({data:{userId:users[i]}});sessions.push(session.id);
  tokens.push(jwt.sign({sub:users[i],sid:session.id},process.env.JWT_SECRET,{expiresIn:'1h'}));
  await db.demoBalance.create({data:{userId:users[i],asset:'USDT',available:i===0?'731.25':'129.875',locked:'0'}});
 }
 // Explicit setup links the existing fixture cash, as fixture() does; this setup-only instance serves no request.
 const authority=openPostgresAuthority(db,{issuer,tradePrincipals:principals,now:Date.now});
 for(let i=0;i<2;i++)await authority.bindExisting({issuer,subject:users[i],userId:users[i],sessionId:sessions[i],expiresAt:jwt.decode(tokens[i]).exp*1000});
 const demo=new DemoTradingService(db,new MatchingEngine()),gatewayKey=crypto.randomBytes(32).toString('hex'),api=express();
 api.use(express.json({limit:'16kb'}));
 const {requireAuth}=require(path.join(root,'src/api/middleware/auth.ts'));
 api.get('/api/v1/me',requireAuth(db),async(req,res)=>{const user=await db.user.findUnique({where:{id:req.userId},select:{id:true,email:true,role:true}});res.json({...user,isAdmin:user.role==='ADMIN',displayName:user.id.startsWith('synthetic-stock-a')?'Synthetic Alpha':user.id.startsWith('synthetic-stock-b')?'Synthetic Beta':'Synthetic Viewer'});});
 api.use('/api/v1',require(path.join(root,'src/api/routes/demoTrading.ts')).demoTradingRouter(db,demo));
 apiServer=await new Promise(resolve=>{const server=api.listen(0,'127.0.0.1',()=>resolve(server));});
 const request=async(route,{index=0,token,body,view}={})=>{const response=await fetch(`http://127.0.0.1:${gatewayPort}/__stocks_global/`+route,{method:body===undefined?'GET':'POST',headers:{authorization:'Bearer '+(token??tokens[index]),...(view?{'x-stocks-view':view}:{}),...(body===undefined?{}:{'content-type':'application/json','x-stocks-token':body.gatewayToken??''})},body:body===undefined?undefined:JSON.stringify((({gatewayToken,...rest})=>rest)(body))});return{status:response.status,data:await response.json()};};
 const rows=async()=>({cash:await db.demoBalance.findMany({where:{userId:{in:users}},orderBy:{userId:'asc'}}),accounts:await db.$queryRawUnsafe('SELECT * FROM "StocksTestAccount" WHERE "userId" IN($1,$2) ORDER BY "userId"',...users),receipts:await db.$queryRawUnsafe('SELECT r.* FROM "StocksTestReceipt" r JOIN "StocksTestAccount" a ON a."principalHash"=r."principalHash" WHERE a."userId" IN($1,$2) ORDER BY r."intentId"',...users),audit:await db.$queryRawUnsafe('SELECT * FROM "StocksTestAudit" WHERE "userId" IN($1,$2) ORDER BY "intentId"',...users)});
 const newViewer=async index=>{const id='synthetic-viewer-'+index+'-'+suffix;await db.user.create({data:{id,email:id+'@example.invalid',passwordHash:'synthetic-no-password-login',referralCode:crypto.randomBytes(10).toString('hex'),role:'USER'}});const session=await db.session.create({data:{userId:id}});return{id,token:jwt.sign({sub:id,sid:session.id},process.env.JWT_SECRET,{expiresIn:'1h'})};};
 return{target,db,issuer,principals,gatewayKey,users,sessions,tokens,request,rows,newViewer,ID:'BYBIT:AAPLXUSDT',apiOrigin:`http://127.0.0.1:${apiServer.address().port}`,
  stocksProcess:{secret:process.env.JWT_SECRET,issuer,principals,gatewayKey},attachGateway:port=>{if(gatewayPort!==undefined)throw Error('GATEWAY_ALREADY_ATTACHED');gatewayPort=port;}};
}
module.exports={cryptoApi};
