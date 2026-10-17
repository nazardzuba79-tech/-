process.env.JWT_SECRET='synthetic-stocks-api-unit-secret-long-enough';
import express from 'express';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { stocksTestCashRouter } from '../stocksTestCash';
const issuer='synthetic-api-unit',key='synthetic-api-internal-key-000000000000';
const principals=[{issuer,subject:'synthetic-a'},{issuer,subject:'synthetic-b'}];
function fixture(enabled=true){
  const prisma:any={user:{findUnique:jest.fn(async({where}:any)=>({id:where.id}))},session:{findUnique:jest.fn(async({where}:any)=>({id:where.id,userId:where.id.replace('session-',''),revokedAt:null,lastSeenAt:new Date(),remembered:false,user:{email:'synthetic@example.invalid'}})),update:jest.fn()},auditLog:{findFirst:jest.fn(async()=>null)}};
  const authority={execute:jest.fn(async(actor:any,type:string)=>{if(!principals.some(p=>p.subject===actor.subject))throw Object.assign(Error('AUTH_REQUIRED'),{code:'AUTH_REQUIRED'});return type==='readView'?{wallets:{USDT:{cash:'731.25000000',reserved:'0.00000000',available:'731.25000000'}}}:{id:'synthetic-result'};}),metrics:()=>({unitFixture:true})};
  const app=express();app.use(express.json());app.use('/api/v1',stocksTestCashRouter(prisma,{enabled,issuer,principals,gatewayKey:key,secret:process.env.JWT_SECRET},authority));
  const token=(subject='synthetic-a',sid=true)=>jwt.sign({sub:subject,...(sid?{sid:'session-'+subject}:{})},process.env.JWT_SECRET!,{expiresIn:'1h'});
  return{app,authority,prisma,token};
}
test('Stocks authority API is absent by default/disabled and performs no account lookup',async()=>{const f=fixture(false);expect((await request(f.app).get('/api/v1/stocks-test-cash/wallet')).status).toBe(404);expect(f.prisma.session.findUnique).not.toHaveBeenCalled();});
test('browser bearer alone cannot inject quote/order commands into the cash authority',async()=>{const f=fixture();const res=await request(f.app).post('/api/v1/stocks-test-cash/command').set('Authorization','Bearer '+f.token()).send({type:'observe',input:{ask:'1'}});expect(res.status).toBe(403);expect(f.authority.execute).not.toHaveBeenCalled();});
test('fixed authority capability and valid Xenia-analogue session reach only the authenticated actor',async()=>{const f=fixture();const res=await request(f.app).post('/api/v1/stocks-test-cash/command').set('Authorization','Bearer '+f.token('synthetic-b')).set('x-stocks-authority-key',key).send({type:'ensure'});expect(res.status).toBe(200);expect(f.authority.execute).toHaveBeenCalledWith(expect.objectContaining({subject:'synthetic-b',userId:'synthetic-b',sessionId:'session-synthetic-b'}),'ensure',undefined);});
test('client account selector is rejected rather than used as identity',async()=>{const f=fixture();const res=await request(f.app).post('/api/v1/stocks-test-cash/command').set('Authorization','Bearer '+f.token()).set('x-stocks-authority-key',key).send({type:'ensure',userId:'synthetic-b'});expect(res.status).toBe(422);expect(f.authority.execute).not.toHaveBeenCalled();});
test('viewer cash read and legacy sid-less token fail closed without funding',async()=>{const f=fixture();expect((await request(f.app).get('/api/v1/stocks-test-cash/wallet').set('Authorization','Bearer '+f.token('viewer'))).status).toBe(401);f.authority.execute.mockClear();expect((await request(f.app).get('/api/v1/stocks-test-cash/wallet').set('Authorization','Bearer '+f.token('synthetic-a',false))).status).toBe(401);expect(f.authority.execute).not.toHaveBeenCalled();});
