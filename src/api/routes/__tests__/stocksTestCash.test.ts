process.env.JWT_SECRET='synthetic-stocks-api-unit-secret-long-enough';
import express from 'express';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { stocksTestCashRouter } from '../stocksTestCash';
import { contactEmailHash } from '../../../services/ContactEmailPolicy';
const issuer='synthetic-api-unit',key='synthetic-api-internal-key-000000000000';
const principals=[{issuer,subject:'synthetic-a'},{issuer,subject:'synthetic-b'}];
function fixture(enabled=true,verificationSecret=process.env.JWT_SECRET!,routerFactory=stocksTestCashRouter,catalogueEnabled=false,orderExecutionEnabled:boolean|null=true){
  const prisma:any={user:{findUnique:jest.fn(async({where}:any)=>({id:where.id}))},session:{findUnique:jest.fn(async({where}:any)=>({id:where.id,userId:where.id.replace('session-',''),revokedAt:null,lastSeenAt:new Date(),remembered:false,user:{email:'synthetic@example.invalid'}})),update:jest.fn()},auditLog:{findFirst:jest.fn(async()=>null)}};
  // requireAuth singleSessionRead: the one-query session read, from the rows above.
  prisma.$queryRaw=jest.fn(async(_sql:unknown,...values:any[])=>{const s=await prisma.session.findUnique({where:{id:values[values.length-1]}});if(!s)return[];const event=await prisma.auditLog.findFirst({});return[{...s,createdAt:null,email:s.user.email,role:null,emailHash:contactEmailHash(s.user.email),contactAction:event?.action??null}];});
  const authority={execute:jest.fn(async(actor:any,type:string)=>{if(!principals.some(p=>p.subject===actor.subject))throw Object.assign(Error('AUTH_REQUIRED'),{code:'AUTH_REQUIRED'});return type==='readView'?{wallets:{USDT:{cash:'731.25000000',reserved:'0.00000000',available:'731.25000000'}}}:{id:'synthetic-result'};}),metrics:()=>({unitFixture:true})};
  const config={enabled,catalogueEnabled,orderExecutionEnabled:orderExecutionEnabled??undefined,issuer,principals,gatewayKey:key,secret:verificationSecret};
  const app=express();app.use(express.json());app.use('/api/v1',routerFactory(prisma,config,authority));
  const token=(subject='synthetic-a',sid=true)=>jwt.sign({sub:subject,...(sid?{sid:'session-'+subject}:{})},process.env.JWT_SECRET!,{expiresIn:'1h'});
  return{app,authority,prisma,token,config};
}
test('Stocks authority API is absent by default/disabled and performs no account lookup',async()=>{const f=fixture(false);expect((await request(f.app).get('/api/v1/stocks-test-cash/wallet')).status).toBe(404);expect(f.prisma.session.findUnique).not.toHaveBeenCalled();});

test('release default-OFF uses actual environment defaults and registers no surfaces',async()=>{
 const keys=['STOCKS_TEST_CASH_ENABLED','STOCKS_CATALOGUE_ENABLED'] as const;
 const previous=keys.map(k=>process.env[k]);
 try{
  for(const value of [undefined,'false','TRUE','1']){
   for(const k of keys)if(value===undefined)delete process.env[k];else process.env[k]=value;
   const f=fixture(false),router=stocksTestCashRouter(f.prisma,{principals:[]});
   expect(router.stack).toHaveLength(0);
   const app=express();app.use('/api/v1',router);
   for(const route of ['identity','identities','readiness','wallet','command'])
    for(const method of ['get','post'] as const)
     expect((await request(app)[method]('/api/v1/stocks-test-cash/'+route)).status).toBe(404);
   expect(f.prisma.user.findUnique).not.toHaveBeenCalled();
   expect(f.prisma.session.findUnique).not.toHaveBeenCalled();
  }
 }finally{keys.forEach((k,i)=>{if(previous[i]===undefined)delete process.env[k];else process.env[k]=previous[i];});}
});

test('catalogue-only gate authenticates normal sessions but cannot invoke any financial authority operation',async()=>{
 const f=fixture(false,process.env.JWT_SECRET!,stocksTestCashRouter,true);
 expect((await request(f.app).get('/api/v1/stocks-test-cash/identity')).status).toBe(401);
 for(const route of ['wallet','command']){
  expect((await request(f.app).post('/api/v1/stocks-test-cash/'+route).set('x-stocks-authority-key',key).send({type:'ensure'})).status).toBe(401);
 }
 for(const subject of ['synthetic-a','synthetic-b','viewer']){
   const token=f.token(subject);
   expect((await request(f.app).get('/api/v1/stocks-test-cash/identity').set('Authorization','Bearer '+token)).status).toBe(200);
   const wallet=await request(f.app).get('/api/v1/stocks-test-cash/wallet').set('Authorization','Bearer '+token);
   expect(wallet.status).toBe(403);expect(wallet.body.error).toBe('STOCKS_TRADING_DISABLED');
   const result=await request(f.app).post('/api/v1/stocks-test-cash/command').set('Authorization','Bearer '+token).set('x-stocks-authority-key',key).send({type:'ensure'});
   expect(result.status).toBe(403);expect(result.body.error).toBe('STOCKS_TRADING_DISABLED');
 }
 expect(f.authority.execute).not.toHaveBeenCalled();
 f.prisma.session.findUnique.mockResolvedValue(null);
 expect((await request(f.app).get('/api/v1/stocks-test-cash/identity').set('Authorization','Bearer '+f.token())).status).toBe(401);
});
test('explicit finance opt-in still rejects forged viewer commands and selector escalation',async()=>{
 const f=fixture();
 const forged=jwt.sign({sub:'viewer',sid:'session-viewer',role:'admin',isOwner:true},process.env.JWT_SECRET!,{expiresIn:'1h'});
 const result=await request(f.app).post('/api/v1/stocks-test-cash/command')
  .set('Authorization','Bearer '+forged).set('x-stocks-authority-key',key).send({type:'ensure'});
 expect(result.status).toBe(401);expect(result.body.error).toBe('AUTH_REQUIRED');
 expect(f.authority.execute).toHaveBeenCalledWith(expect.objectContaining({subject:'viewer'}),'ensure',undefined);
 f.authority.execute.mockClear();
 const selector=await request(f.app).post('/api/v1/stocks-test-cash/command')
  .set('Authorization','Bearer '+forged).set('x-stocks-authority-key',key).send({type:'ensure',userId:'synthetic-a'});
 expect(selector.status).toBe(422);expect(f.authority.execute).not.toHaveBeenCalled();
});
test('browser bearer alone cannot inject quote/order commands into the cash authority',async()=>{const f=fixture();const res=await request(f.app).post('/api/v1/stocks-test-cash/command').set('Authorization','Bearer '+f.token()).send({type:'observe',input:{ask:'1'}});expect(res.status).toBe(403);expect(f.authority.execute).not.toHaveBeenCalled();});
test('fixed authority capability and valid Xenia-analogue session reach only the authenticated actor',async()=>{const f=fixture();const res=await request(f.app).post('/api/v1/stocks-test-cash/command').set('Authorization','Bearer '+f.token('synthetic-b')).set('x-stocks-authority-key',key).send({type:'ensure'});expect(res.status).toBe(200);expect(f.authority.execute).toHaveBeenCalledWith(expect.objectContaining({subject:'synthetic-b',userId:'synthetic-b',sessionId:'session-synthetic-b'}),'ensure',undefined);});
test('client account selector is rejected rather than used as identity',async()=>{const f=fixture();const res=await request(f.app).post('/api/v1/stocks-test-cash/command').set('Authorization','Bearer '+f.token()).set('x-stocks-authority-key',key).send({type:'ensure',userId:'synthetic-b'});expect(res.status).toBe(422);expect(f.authority.execute).not.toHaveBeenCalled();});
test('viewer cash read and legacy sid-less token fail closed without funding',async()=>{const f=fixture();expect((await request(f.app).get('/api/v1/stocks-test-cash/wallet').set('Authorization','Bearer '+f.token('viewer'))).status).toBe(401);f.authority.execute.mockClear();expect((await request(f.app).get('/api/v1/stocks-test-cash/wallet').set('Authorization','Bearer '+f.token('synthetic-a',false))).status).toBe(401);expect(f.authority.execute).not.toHaveBeenCalled();});

test('prepared Stocks verification key preserves token rejection and per-request session revocation',async()=>{
 const f=fixture(),good=f.token();
 expect((await request(f.app).get('/api/v1/stocks-test-cash/wallet').set('Authorization','Bearer '+good)).status).toBe(200);
 const invalid=[
  jwt.sign({sub:'synthetic-a',sid:'session-synthetic-a',exp:1},process.env.JWT_SECRET!),
  jwt.sign({sub:'synthetic-a',sid:'session-synthetic-a',nbf:Math.floor(Date.now()/1000)+3600},process.env.JWT_SECRET!),
  jwt.sign({sub:'synthetic-a',sid:'session-synthetic-a'},'different-synthetic-key',{expiresIn:'1h'}),
  jwt.sign({sub:'synthetic-a',sid:'session-synthetic-a'},process.env.JWT_SECRET!),
  jwt.sign({sub:'synthetic-a',sid:'session-synthetic-b'},process.env.JWT_SECRET!,{expiresIn:'1h'}),
 ];
 for(const token of invalid)expect((await request(f.app).get('/api/v1/stocks-test-cash/wallet').set('Authorization','Bearer '+token)).status).toBe(401);
 f.prisma.session.findUnique.mockImplementation(async({where}:any)=>({id:where.id,userId:'synthetic-a',revokedAt:new Date(),lastSeenAt:new Date(),remembered:false,user:{email:'synthetic@example.invalid'}}));
 expect((await request(f.app).get('/api/v1/stocks-test-cash/wallet').set('Authorization','Bearer '+good)).status).toBe(401);
 expect(f.authority.execute).toHaveBeenCalledTimes(1);
});

test('router key is an immutable construction snapshot and a new router still rejects a mismatched key',async()=>{
 const f=fixture(),token=f.token();
 f.config.secret='replacement-synthetic-secret';
 expect((await request(f.app).get('/api/v1/stocks-test-cash/wallet').set('Authorization','Bearer '+token)).status).toBe(200);
 const next=fixture(true,'replacement-synthetic-secret');
 const denied=await request(next.app).get('/api/v1/stocks-test-cash/wallet').set('Authorization','Bearer '+token);
 expect(denied.status).toBe(503);
 expect(denied.body.error).toBe('ACCOUNT_OUTCOME_UNKNOWN');
 expect(next.authority.execute).not.toHaveBeenCalled();
});
test('enabled router rejects missing key configuration before accepting requests',()=>{
 expect(()=>fixture(true,'')).toThrow('STOCKS_AUTHORITY_CONFIG_INVALID');
});

test('reloading auth/router with a rotated key rejects the old token and accepts the new key concurrently',async()=>{
 const previous=process.env.JWT_SECRET!,rotated='synthetic-rotated-process-secret-long-enough';
 let reloaded:typeof stocksTestCashRouter;
 try{process.env.JWT_SECRET=rotated;jest.isolateModules(()=>{reloaded=require('../stocksTestCash').stocksTestCashRouter;});}finally{process.env.JWT_SECRET=previous;}
 const f=fixture(true,rotated,reloaded!),old=f.token();
 expect((await request(f.app).get('/api/v1/stocks-test-cash/wallet').set('Authorization','Bearer '+old)).status).toBe(401);
 const token=jwt.sign({sub:'synthetic-a',sid:'session-synthetic-a'},rotated,{expiresIn:'1h'});
 const responses=await Promise.all(Array.from({length:4},()=>request(f.app).get('/api/v1/stocks-test-cash/wallet').set('Authorization','Bearer '+token)));
 expect(responses.map(r=>r.status)).toEqual([200,200,200,200]);
 expect(f.prisma.session.findUnique).toHaveBeenCalledTimes(4);
 expect(f.authority.execute).toHaveBeenCalledTimes(4);
});
test('contact block decisions are re-read after a successful request with the same JWT',async()=>{
 const f=fixture(),token=f.token();
 expect((await request(f.app).get('/api/v1/stocks-test-cash/wallet').set('Authorization','Bearer '+token)).status).toBe(200);
 f.prisma.auditLog.findFirst.mockResolvedValue({action:'CONTACT_EMAIL_BLOCKED'});
 expect((await request(f.app).get('/api/v1/stocks-test-cash/wallet').set('Authorization','Bearer '+token)).status).toBe(403);
 expect(f.authority.execute).toHaveBeenCalledTimes(1);
 expect(f.prisma.auditLog.findFirst).toHaveBeenCalledTimes(2);
});

test('Stocks key preparation cannot replace the module auth key with a different router key',async()=>{
 const replacement='replacement-synthetic-router-key',f=fixture(true,replacement);
 const token=jwt.sign({sub:'synthetic-a',sid:'session-synthetic-a'},replacement,{expiresIn:'1h'});
 expect((await request(f.app).get('/api/v1/stocks-test-cash/wallet').set('Authorization','Bearer '+token)).status).toBe(401);
 expect(f.prisma.session.findUnique).not.toHaveBeenCalled();
 expect(f.authority.execute).not.toHaveBeenCalled();
});
// Stored 50+2 spans (1d02aea3, mixed arm): every identity/command hop verified the same bearer twice
// (1260/1260 hops). Old and new code must admit and refuse exactly the same requests; only the number of
// signature verifications may differ. `during` runs inside requireAuth's session read, after its
// jwt.verify and before the route's actor: a clock step or a replaced Authorization header lands there.
const T0=1_800_000_000,SECOND_KEY='replacement-synthetic-secret';
let clock=T0*1000;
const bearer=(claims:object,secret=process.env.JWT_SECRET!)=>jwt.sign({sub:'synthetic-a',sid:'session-synthetic-a',iat:T0,...claims},secret);
const at=(ms:number)=>()=>{clock=ms;};
const replace=(claims:object,secret?:string)=>(req:any)=>{req.headers.authorization='Bearer '+bearer(claims,secret);};
type Case={name:string;token:()=>string;routerKey?:string;during?:(req:any)=>void;expected:number|string;verifies:number};
const atUseCases:Case[]=[
 {name:'valid',token:()=>bearer({exp:T0+60}),expected:(T0+60)*1000,verifies:1},
 {name:'expires during the session read',token:()=>bearer({exp:T0+60}),during:at((T0+60)*1000),expected:'503 ACCOUNT_OUTCOME_UNKNOWN',verifies:1},
 {name:'1 ms before expiry at use',token:()=>bearer({exp:T0+60}),during:at((T0+60)*1000-1),expected:(T0+60)*1000,verifies:1},
 {name:'clock steps back before not-before during the read',token:()=>bearer({nbf:T0,exp:T0+60}),during:at(T0*1000-1),expected:'503 ACCOUNT_OUTCOME_UNKNOWN',verifies:1},
 {name:'no exp',token:()=>bearer({}),expected:'401 AUTH_REQUIRED',verifies:1},
 {name:'bearer replaced by a later token of the same session',token:()=>bearer({exp:T0+60}),during:replace({exp:T0+120}),expected:(T0+120)*1000,verifies:2},
 {name:'bearer replaced by another session\'s token',token:()=>bearer({exp:T0+60}),during:replace({sub:'synthetic-b',sid:'session-synthetic-b',exp:T0+60}),expected:'401 AUTH_REQUIRED',verifies:2},
 {name:'bearer replaced by a token under another key',token:()=>bearer({exp:T0+60}),during:replace({exp:T0+60},'different-synthetic-key'),expected:'503 ACCOUNT_OUTCOME_UNKNOWN',verifies:2},
 {name:'bearer replaced by an expired token',token:()=>bearer({exp:T0+60}),during:replace({exp:T0}),expected:'503 ACCOUNT_OUTCOME_UNKNOWN',verifies:2},
 {name:'bearer removed',token:()=>bearer({exp:T0+60}),during:req=>{delete req.headers.authorization;},expected:'503 ACCOUNT_OUTCOME_UNKNOWN',verifies:1},
 {name:'router with its own key',token:()=>bearer({exp:T0+60}),routerKey:SECOND_KEY,expected:'503 ACCOUNT_OUTCOME_UNKNOWN',verifies:2},
 {name:'router with its own key, token under that key',token:()=>bearer({exp:T0+60},SECOND_KEY),routerKey:SECOND_KEY,expected:'401 Invalid or expired token',verifies:1},
];
async function hop(route:string,c:Case){
 clock=T0*1000;
 const f=fixture(true,c.routerKey??process.env.JWT_SECRET!);let current:any;
 f.prisma.session.findUnique.mockImplementation(async({where}:any)=>({id:where.id,userId:where.id.replace('session-',''),revokedAt:null,lastSeenAt:new Date(Date.now()),remembered:false,user:{email:'synthetic@example.invalid'}}));
 const read=f.prisma.$queryRaw.getMockImplementation();
 f.prisma.$queryRaw.mockImplementation(async(...args:any[])=>{const rows=await read(...args);c.during?.(current);return rows;});
 const app=express();app.use(express.json());app.use((req,_res,next)=>{current=req;next();});app.use('/api/v1',stocksTestCashRouter(f.prisma,f.config,f.authority));
 const token=c.token(),verify=jest.spyOn(jwt,'verify');
 try{
  const call=route==='command'?request(app).post('/api/v1/stocks-test-cash/command').set('x-stocks-authority-key',key).send({type:'readView'}):request(app).get('/api/v1/stocks-test-cash/'+route);
  const res=await call.set('Authorization','Bearer '+token);
  const actors=f.authority.execute.mock.calls.map(([actor,type]:any)=>({...actor,type}));
  // Admitted: identity answers the subject; wallet/command hand the authority an actor whose expiry is observable.
  const outcome=res.status!==200?`${res.status} ${res.body.error}`:route==='identity'?`200 ${res.body.subject}`:actors[0]?.expiresAt;
  return{outcome,actors,verifies:verify.mock.calls.length};
 }finally{verify.mockRestore();}
}
test('expiry, not-before and token binding are judged at use: the same admit/refuse as verifying the bearer twice (fa92cc66)',async()=>{
 const now=jest.spyOn(Date,'now').mockImplementation(()=>clock);
 try{
  for(const c of atUseCases)for(const route of ['identity','wallet','command']){
   const {outcome,actors}=await hop(route,c),admitted=typeof c.expected==='number';
   expect([c.name,route,outcome]).toEqual([c.name,route,admitted&&route==='identity'?'200 synthetic-a':c.expected]);
   if(admitted&&route!=='identity')expect(actors).toEqual([{issuer,subject:'synthetic-a',userId:'synthetic-a',sessionId:'session-synthetic-a',expiresAt:c.expected,type:'readView'}]);
   else expect(actors).toEqual([]);
  }
 }finally{now.mockRestore();}
});
test('the bearer signature is verified once per hop only for the same token text and the auth key; no reuse across requests',async()=>{
 const now=jest.spyOn(Date,'now').mockImplementation(()=>clock);
 try{
  for(const c of atUseCases)for(const route of ['identity','wallet','command'])
   expect([c.name,route,(await hop(route,c)).verifies]).toEqual([c.name,route,c.verifies]);
  // Admitted, then expired between two requests with the same bearer: the next request verifies afresh.
  const f=fixture(),token=bearer({exp:T0+60}),verify=jest.spyOn(jwt,'verify');
  f.prisma.session.findUnique.mockImplementation(async({where}:any)=>({id:where.id,userId:'synthetic-a',revokedAt:null,lastSeenAt:new Date(Date.now()),remembered:false,user:{email:'synthetic@example.invalid'}}));
  try{
   clock=T0*1000;
   expect((await request(f.app).get('/api/v1/stocks-test-cash/wallet').set('Authorization','Bearer '+token)).status).toBe(200);
   clock=(T0+60)*1000;
   const expired=await request(f.app).get('/api/v1/stocks-test-cash/wallet').set('Authorization','Bearer '+token);
   expect([expired.status,expired.body.error]).toEqual([401,'Invalid or expired token']);
   expect(verify).toHaveBeenCalledTimes(2);
   expect(f.authority.execute).toHaveBeenCalledTimes(1);
  }finally{verify.mockRestore();}
 }finally{now.mockRestore();clock=T0*1000;}
});
test('default auth keeps its original string-key verification path',async()=>{
 const {requireAuth}=require('../../middleware/auth'),f=fixture(),app=express();
 app.get('/default-auth',requireAuth(f.prisma),(req:any,res)=>res.json({subject:req.userId}));
 const token=f.token(),verify=jest.spyOn(jwt,'verify');
 try{
  const response=await request(app).get('/default-auth').set('Authorization','Bearer '+token);
  expect(response.status).toBe(200);
  expect(verify).toHaveBeenCalledTimes(1);
  expect(verify.mock.calls[0][1]).toBe(process.env.JWT_SECRET);
 }finally{verify.mockRestore();}
});

// PR #593: the second server gate (`null` here = no explicit config, so the environment decides). Unset (the production default) refuses every command for both bound traders
// before the authority runs; only the exact value 'true' opens it.
test('second gate: with STOCKS_ORDER_EXECUTION_ENABLED unset both bound traders are refused before the authority',async()=>{
  const previous=process.env.STOCKS_ORDER_EXECUTION_ENABLED;
  try{
    for(const value of [undefined,'false','TRUE','1']){
      if(value===undefined)delete process.env.STOCKS_ORDER_EXECUTION_ENABLED;else process.env.STOCKS_ORDER_EXECUTION_ENABLED=value;
      for(const user of ['synthetic-a','synthetic-b']){
        const f=fixture(true,undefined,undefined,false,null);
        const res=await request(f.app).post('/api/v1/stocks-test-cash/command').set('Authorization','Bearer '+f.token(user)).set('x-stocks-authority-key',key).send({type:'ensure'});
        expect(res.status).toBe(403);expect(res.body.error).toBe('ACCOUNT_TRADING_DISABLED');expect(f.authority.execute).not.toHaveBeenCalled();
      }
    }
    process.env.STOCKS_ORDER_EXECUTION_ENABLED='true';
    const f=fixture(true,undefined,undefined,false,null);
    expect((await request(f.app).post('/api/v1/stocks-test-cash/command').set('Authorization','Bearer '+f.token('synthetic-b')).set('x-stocks-authority-key',key).send({type:'ensure'})).status).toBe(200);
  }finally{if(previous===undefined)delete process.env.STOCKS_ORDER_EXECUTION_ENABLED;else process.env.STOCKS_ORDER_EXECUTION_ENABLED=previous;}
});

// #613 P1: the gateway sends the live identity checks of concurrent browser requests together.
// Multiplexing, not caching: each bearer runs the same requireAuth + actor as GET identity.
const identities=(app:any,tokens:unknown,capability:string|null=key)=>{const r=request(app).post('/api/v1/stocks-test-cash/identities');return(capability===null?r:r.set('x-stocks-authority-key',capability)).send(tokens===undefined?{}:{tokens});};
test('identity batch needs the gateway capability and a well-formed list before any session read',async()=>{
 const f=fixture(false,process.env.JWT_SECRET!,stocksTestCashRouter,true),good=f.token();
 for(const capability of [null,'',key.slice(1),key+'x','forged-capability-of-the-same-length-000'])
  expect([capability,(await identities(f.app,[good],capability)).status]).toEqual([capability,403]);
 const invalid:unknown[]=[undefined,[],'not-a-list',[good,good],[good,42],['short'],['contains space and more than sixteen'],['x'.repeat(4097)],
  Array.from({length:33},(_,n)=>f.token('viewer-'+n))];
 for(const tokens of invalid){const res=await identities(f.app,tokens);expect(res.status).toBe(422);expect(res.body.error).toBe('IDENTITY_BATCH_INVALID');}
 expect((await request(f.app).post('/api/v1/stocks-test-cash/identities').set('x-stocks-authority-key',key).send({tokens:[good],extra:true})).status).toBe(422);
 expect((await request(f.app).get('/api/v1/stocks-test-cash/identities').set('x-stocks-authority-key',key)).status).toBe(404);
 expect(f.prisma.$queryRaw).not.toHaveBeenCalled();expect(f.prisma.user.findUnique).not.toHaveBeenCalled();
 const max=Array.from({length:32},(_,n)=>f.token('viewer-'+n)),res=await identities(f.app,max);
 expect(res.status).toBe(200);expect(res.headers['cache-control']).toBe('no-store');
 expect(res.body.results).toEqual(max.map((_,n)=>({issuer,subject:'viewer-'+n})));
 expect(f.prisma.$queryRaw).toHaveBeenCalledTimes(32);expect(f.authority.execute).not.toHaveBeenCalled();
});
test('identity batch answers each bearer by position with its own live session, block and binding decision',async()=>{
 const f=fixture(false,process.env.JWT_SECRET!,stocksTestCashRouter,true);
 const live=f.prisma.session.findUnique.getMockImplementation();
 f.prisma.session.findUnique.mockImplementation(async(args:any)=>{const s=await live(args);return args.where.id==='session-revoked'?{...s,revokedAt:new Date()}:args.where.id==='session-gone'?null:s;});
 const read=f.prisma.$queryRaw.getMockImplementation();
 f.prisma.$queryRaw.mockImplementation(async(...args:any[])=>{if(args[args.length-1]==='session-broken')throw Error('synthetic database outage');const rows=await read(...args);return args[args.length-1]==='session-blocked'?rows.map((row:any)=>({...row,contactAction:'CONTACT_EMAIL_BLOCKED'})):rows;});
 const tokens=[f.token('synthetic-a'),f.token('revoked'),f.token('synthetic-b'),f.token('blocked'),f.token('gone'),f.token('synthetic-a',false),
  jwt.sign({sub:'synthetic-a',sid:'session-synthetic-a',purpose:'2fa'},process.env.JWT_SECRET!,{expiresIn:'1h'}),
  jwt.sign({sub:'synthetic-a',sid:'session-synthetic-a'},process.env.JWT_SECRET!),
  jwt.sign({sub:'synthetic-a',sid:'session-synthetic-a'},'different-synthetic-key',{expiresIn:'1h'}),
  jwt.sign({sub:'synthetic-b',sid:'session-synthetic-a'},process.env.JWT_SECRET!,{expiresIn:'1h'}),
  f.token('broken'),f.token('viewer')];
 const res=await identities(f.app,tokens);
 expect(res.status).toBe(200);
 expect(res.body.results).toEqual([{issuer,subject:'synthetic-a'},{error:'AUTH_REQUIRED'},{issuer,subject:'synthetic-b'},{error:'AUTH_REQUIRED'},{error:'AUTH_REQUIRED'},
  {error:'AUTH_REQUIRED'},{error:'AUTH_REQUIRED'},{error:'AUTH_REQUIRED'},{error:'AUTH_REQUIRED'},{error:'AUTH_REQUIRED'},{error:'AUTH_UNAVAILABLE'},{issuer,subject:'viewer'}]);
 // Nothing outlives the batch: the very next batch re-reads, and a sign-out in between is refused.
 const again=f.token('synthetic-b');
 expect((await identities(f.app,[again])).body.results).toEqual([{issuer,subject:'synthetic-b'}]);
 f.prisma.session.findUnique.mockImplementation(async(args:any)=>({...(await live(args)),revokedAt:new Date()}));
 expect((await identities(f.app,[again])).body.results).toEqual([{error:'AUTH_REQUIRED'}]);
 expect(f.authority.execute).not.toHaveBeenCalled();
});
test('identity batch admits and refuses exactly what GET identity does, judged at use',async()=>{
 const now=jest.spyOn(Date,'now').mockImplementation(()=>clock);
 try{
  // Header replacement cases cannot apply: a batch carries no user Authorization header.
  for(const c of atUseCases.filter(c=>!/^bearer (replaced|removed)/.test(c.name))){
   clock=T0*1000;
   const f=fixture(true,c.routerKey??process.env.JWT_SECRET!);
   f.prisma.session.findUnique.mockImplementation(async({where}:any)=>({id:where.id,userId:where.id.replace('session-',''),revokedAt:null,lastSeenAt:new Date(Date.now()),remembered:false,user:{email:'synthetic@example.invalid'}}));
   const read=f.prisma.$queryRaw.getMockImplementation();
   f.prisma.$queryRaw.mockImplementation(async(...args:any[])=>{const rows=await read(...args);c.during?.({headers:{}});return rows;});
   const single=(await hop('identity',c)).outcome;
   clock=T0*1000;
   const res=await identities(f.app,[c.token()]);
   expect([c.name,res.status]).toEqual([c.name,200]);
   expect([c.name,res.body.results[0].subject??res.body.results[0].error,String(single).startsWith('200')]).toEqual([c.name,typeof c.expected==='number'?'synthetic-a':'AUTH_REQUIRED',typeof c.expected==='number']);
  }
 }finally{now.mockRestore();clock=T0*1000;}
});
test('identity batch: a driver fault while reading a session answers that bearer AUTH_UNAVAILABLE, never a subject',async()=>{
 const f=fixture(false,process.env.JWT_SECRET!,stocksTestCashRouter,true);
 const read=f.prisma.$queryRaw.getMockImplementation();
 f.prisma.$queryRaw.mockImplementation(async(...args:any[])=>{const rows=await read(...args);return args[args.length-1]==='session-synthetic-a'?[new Proxy(rows[0],{get(target,key){if(key==='lastSeenAt')throw Error('synthetic driver fault');return target[key];}})]:rows;});
 const res=await identities(f.app,[f.token('synthetic-a'),f.token('synthetic-b')]);
 expect([res.status,res.body]).toEqual([200,{results:[{error:'AUTH_UNAVAILABLE'},{issuer,subject:'synthetic-b'}]}]);
});
