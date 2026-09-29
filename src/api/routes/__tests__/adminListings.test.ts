import express from 'express';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { adminListingsRouter } from '../adminListings';
import { ListingsStore, assertNotManagedExecution } from '../../../services/managedListings/store';
import { OrderService } from '../../../services/OrderService';
import { DemoTradingService } from '../../../services/DemoTradingService';
import { MatchingEngine } from '../../../matching-engine/MatchingEngine';
import BigNumber from 'bignumber.js';

const token=(sub='admin',extra={})=>`Bearer ${jwt.sign({sub,...extra},process.env.JWT_SECRET!)}`;
const input={name:'QA Coin',ticker:'QACOIN',logo:'data:image/png;base64,iVBORw0KGgo=',initialPrice:'1.20',listingAt:'2027-01-01T00:00:00Z',ownerAllocation:'200'};
describe('Managed Listings admin boundary',()=>{
  const call=jest.fn(),transaction=jest.fn();
  const db:any={user:{findUnique:jest.fn(async({where}:any)=>({id:where.id,role:where.id==='admin'?'ADMIN':'USER'}))},
    session:{findUnique:jest.fn(async()=>({revokedAt:new Date(),userId:'admin'}))},$transaction:transaction};
  const app=express();app.use(express.json());app.use('/api/v1',adminListingsRouter(db,async()=>[{pair:'BTC/USDT'},{pair:'EXIST/USDT'}],()=>({call} as unknown as ListingsStore)));
  beforeEach(()=>{jest.clearAllMocks();delete process.env.MANAGED_LISTINGS_ALLOCATION_ENABLED;call.mockResolvedValue({id:'abcdefghijklmnop',ticker:'QACOIN',status:'draft',revision:1});});
  test.each(['GET','POST','PUT'])('%s: public/user cannot read or mutate drafts',async method=>{
    const path='/api/v1/admin/listings'+(method==='PUT'?'/abcdefghijklmnop':'');
    for(const header of ['',token('user'),token('admin',{sid:'revoked'}),token('admin',{purpose:'2fa'})]){
      const r=await (request(app) as any)[method.toLowerCase()](path).set('Authorization',header).send(input);
      expect([401,403]).toContain(r.status);
    }expect(call).not.toHaveBeenCalled();expect(transaction).not.toHaveBeenCalled();
  });
  test('create/preview/publish transport is admin-only and never calls accounting',async()=>{
    expect((await request(app).post('/api/v1/admin/listings').set('Authorization',token()).set('Idempotency-Key','abcdefghijklmnop').send(input)).status).toBe(200);
    expect(call).toHaveBeenCalledWith('/admin/listings','POST',input,undefined,'abcdefghijklmnop','admin');
    expect((await request(app).get('/api/v1/admin/listings/abcdefghijklmnop/preview').set('Authorization',token())).status).toBe(200);
    expect((await request(app).post('/api/v1/admin/listings/abcdefghijklmnop/publish').set('Authorization',token()).set('If-Match','1').set('Idempotency-Key','publish-abcdefghijklmnop')).status).toBe(200);
    expect(transaction).not.toHaveBeenCalled();
  });
  test('existing asset/pair collisions fail before Cloudflare mutation',async()=>{
    expect((await request(app).post('/api/v1/admin/listings').set('Authorization',token()).send({...input,ticker:'EXIST'})).status).toBe(409);expect(call).not.toHaveBeenCalled();
  });
  test('allocation default-off even for admin, no config read or financial write',async()=>{
    expect((await request(app).post('/api/v1/admin/listings/abcdefghijklmnop/allocation').set('Authorization',token()).send({confirm:true})).status).toBe(403);
    expect(call).not.toHaveBeenCalled();expect(transaction).not.toHaveBeenCalled();
  });
  test('storage config never permits redirect/user-controlled endpoint or credentials in response',async()=>{
    expect(()=>new ListingsStore('http://evil/','secret')).toThrow();expect(()=>new ListingsStore('https://user:pass@host/','secret')).toThrow();
    const transport=jest.fn(async()=>Response.json({error:'upstream secret values here'},{status:500})) as any;
    await expect(new ListingsStore('https://edge.invalid/','secret',transport).call('/admin/listings')).rejects.toThrow('listings_unavailable');
    expect(transport.mock.calls[0][1].redirect).toBe('error');
  });
});
describe('Managed display market cannot enter Spot or demo matching',()=>{
  const env={...process.env};
  beforeEach(()=>{process.env.LISTINGS_STORE_URL='https://listings.invalid';process.env.LISTINGS_STORE_TOKEN='x'.repeat(40);});
  afterEach(()=>{process.env={...env};jest.restoreAllMocks();});
  test('direct LIMIT/MARKET/OCO and generic demo attempts have zero writes',async()=>{
    jest.spyOn(global,'fetch').mockResolvedValue(Response.json({managed:true}));
    const db:any={$transaction:jest.fn()},engine=new MatchingEngine(),source={getTicker:jest.fn()};
    const service=new OrderService(db,engine,source);
    for(const type of ['LIMIT','MARKET'] as const)await expect(service.placeOrder({userId:'user',pair:'QACOIN/USDT',side:'BUY',type,quantity:new BigNumber(1),price:new BigNumber(1)})).rejects.toThrow();
    await expect(service.placeOcoOrder({userId:'user',pair:'QACOIN/USDT',side:'SELL',quantity:new BigNumber(1),takeProfitPrice:new BigNumber(2),stopTriggerPrice:new BigNumber(1),stopLimitPrice:new BigNumber(1)})).rejects.toThrow();
    const demo=new DemoTradingService(db,engine);
    await expect(demo.placeOrder({userId:'user',pair:'QACOIN/USDT',side:'SELL',type:'LIMIT',quantity:new BigNumber(1),price:new BigNumber(1)})).rejects.toThrow();
    expect(db.$transaction).not.toHaveBeenCalled();
  });
  test('outage fails closed; disabled feature performs zero IO',async()=>{
    const fetch=jest.spyOn(global,'fetch').mockRejectedValue(new Error('timeout'));
    await expect(assertNotManagedExecution('QACOIN/USDT')).rejects.toThrow();
    delete process.env.LISTINGS_STORE_URL;fetch.mockClear();await assertNotManagedExecution('BTC/USDT');expect(fetch).not.toHaveBeenCalled();
  });
});
