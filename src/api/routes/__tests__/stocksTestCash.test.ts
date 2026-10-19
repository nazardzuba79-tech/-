process.env.JWT_SECRET='synthetic-stocks-api-unit-secret-long-enough';
import express from 'express';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { stocksTestCashRouter } from '../stocksTestCash';
const issuer='synthetic-api-unit',key='synthetic-api-internal-key-000000000000';
const principals=[{issuer,subject:'synthetic-a'},{issuer,subject:'synthetic-b'}];
function fixture(enabled=true,verificationSecret=process.env.JWT_SECRET!,routerFactory=stocksTestCashRouter){
  const prisma:any={user:{findUnique:jest.fn(async({where}:any)=>({id:where.id}))},session:{findUnique:jest.fn(async({where}:any)=>({id:where.id,userId:where.id.replace('session-',''),revokedAt:null,lastSeenAt:new Date(),remembered:false,user:{email:'synthetic@example.invalid'}})),update:jest.fn()},auditLog:{findFirst:jest.fn(async()=>null)}};
  const authority={execute:jest.fn(async(actor:any,type:string)=>{if(!principals.some(p=>p.subject===actor.subject))throw Object.assign(Error('AUTH_REQUIRED'),{code:'AUTH_REQUIRED'});return type==='readView'?{wallets:{USDT:{cash:'731.25000000',reserved:'0.00000000',available:'731.25000000'}}}:{id:'synthetic-result'};}),metrics:()=>({unitFixture:true})};
  const config={enabled,issuer,principals,gatewayKey:key,secret:verificationSecret};
  const app=express();app.use(express.json());app.use('/api/v1',routerFactory(prisma,config,authority));
  const token=(subject='synthetic-a',sid=true)=>jwt.sign({sub:subject,...(sid?{sid:'session-'+subject}:{})},process.env.JWT_SECRET!,{expiresIn:'1h'});
  return{app,authority,prisma,token,config};
}
test('Stocks authority API is absent by default/disabled and performs no account lookup',async()=>{const f=fixture(false);expect((await request(f.app).get('/api/v1/stocks-test-cash/wallet')).status).toBe(404);expect(f.prisma.session.findUnique).not.toHaveBeenCalled();});
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
