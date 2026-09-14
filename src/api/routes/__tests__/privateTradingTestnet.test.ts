import express from 'express';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { privateTradingRouter } from '../privateTrading';
import { assertOwner } from '../../../private-trading/access';

function fixture(){
  const config={enabled:true,ownerId:'owner'};
  const users:Record<string,any>={owner:{role:'ADMIN',blockedAt:null},admin2:{role:'ADMIN',blockedAt:null}};
  const sessions:Record<string,any>=Object.fromEntries(Object.keys(users).map(id=>[`session-${id}`,{id:`session-${id}`,userId:id,revokedAt:null,lastSeenAt:new Date()}]));
  const prisma:any={
    user:{findUnique:jest.fn(async({where}:any)=>users[where.id])},
    session:{findUnique:jest.fn(async({where}:any)=>sessions[where.id]),update:jest.fn(async()=>({}))},
  };
  const service:any={store:{authorized:(actor:any)=>assertOwner(prisma,actor,()=>config)}};
  for(const method of ['state','getMarket','getChartCandles','preview','getPreview','cancelPreview','confirm','cancelOrder','close','edit','advance','closeOnChart','card','getCard'])service[method]=jest.fn(async()=>({ok:true}));
  service.store.allocate=jest.fn(async()=>({available:'10'}));
  const testnet:any={
    status:jest.fn(()=>({configured:true,source:'BYBIT_TESTNET',accountType:'UNIFIED',executionHost:'api-testnet.bybit.com'})),
    state:jest.fn(async()=>({source:'BYBIT_TESTNET',fetchedAt:1,wallet:null,positions:[],openOrders:[],orderHistory:[],closedPnl:[]})),
    createOrder:jest.fn(async()=>({orderId:'order-1',orderLinkId:'vx1'})),
    cancelOrder:jest.fn(async()=>({orderId:'order-1',orderLinkId:'vx1'})),
    setLeverage:jest.fn(async()=>({symbol:'BTCUSDT',leverage:'7'})),
    closePosition:jest.fn(async()=>({orderId:'close-1',orderLinkId:'vx2'})),
  };
  const app=express();app.use(express.json());app.use('/api/v1',privateTradingRouter(prisma,service,testnet));
  const token=(id='owner')=>jwt.sign({sub:id,sid:`session-${id}`},process.env.JWT_SECRET!,{expiresIn:'1h'});
  return{app,testnet,token};
}

describe('owner Bybit Testnet API isolation',()=>{
  test.each([
    ['get','/testnet/status',undefined],
    ['get','/testnet/state',undefined],
    ['post','/testnet/orders',{symbol:'BTCUSDT',side:'Buy',orderType:'Market',qty:'0.01',leverage:'7'}],
    ['post','/testnet/orders/order-1/cancel',{symbol:'BTCUSDT'}],
    ['post','/testnet/leverage',{symbol:'BTCUSDT',leverage:'7'}],
    ['post','/testnet/positions/BTCUSDT/close',{}],
  ])('another admin cannot reach %s %s',async(method,path,body)=>{
    const f=fixture();
    const call=(request(f.app) as any)[method](`/api/v1/private-trading${path}`).auth(f.token('admin2'),{type:'bearer'});
    const response=body===undefined?await call:await call.send(body);
    expect(response.status).toBe(403);expect(response.headers['cache-control']).toBe('private, no-store');
    expect(f.testnet.status).not.toHaveBeenCalled();expect(f.testnet.state).not.toHaveBeenCalled();
    expect(f.testnet.createOrder).not.toHaveBeenCalled();expect(f.testnet.cancelOrder).not.toHaveBeenCalled();
    expect(f.testnet.setLeverage).not.toHaveBeenCalled();expect(f.testnet.closePosition).not.toHaveBeenCalled();
  });

  test('owner reads real Testnet account state through server boundary',async()=>{
    const f=fixture();
    const status=await request(f.app).get('/api/v1/private-trading/testnet/status').auth(f.token(),{type:'bearer'});
    const state=await request(f.app).get('/api/v1/private-trading/testnet/state').auth(f.token(),{type:'bearer'});
    expect(status.status).toBe(200);expect(status.body).toMatchObject({configured:true,source:'BYBIT_TESTNET'});
    expect(state.status).toBe(200);expect(state.body.source).toBe('BYBIT_TESTNET');expect(f.testnet.state).toHaveBeenCalledTimes(1);
  });

  test('owner order, leverage, cancel and close inputs are normalized before Testnet client',async()=>{
    const f=fixture(),token=f.token();
    const order=await request(f.app).post('/api/v1/private-trading/testnet/orders').auth(token,{type:'bearer'}).send({symbol:'btc/usdt',side:'Buy',orderType:'Limit',qty:'0.010',price:'70000',leverage:'7'});
    expect(order.status).toBe(200);expect(f.testnet.createOrder).toHaveBeenCalledWith(expect.objectContaining({symbol:'BTCUSDT',qty:'0.010',price:'70000',leverage:'7'}));
    expect((await request(f.app).post('/api/v1/private-trading/testnet/leverage').auth(token,{type:'bearer'}).send({symbol:'btc-usdt',leverage:'7'})).status).toBe(200);
    expect(f.testnet.setLeverage).toHaveBeenCalledWith('BTCUSDT','7');
    expect((await request(f.app).post('/api/v1/private-trading/testnet/orders/order-1/cancel').auth(token,{type:'bearer'}).send({symbol:'BTCUSDT'})).status).toBe(200);
    expect(f.testnet.cancelOrder).toHaveBeenCalledWith('BTCUSDT','order-1');
    expect((await request(f.app).post('/api/v1/private-trading/testnet/positions/btcusdt/close').auth(token,{type:'bearer'}).send({quantity:'0.005'})).status).toBe(200);
    expect(f.testnet.closePosition).toHaveBeenCalledWith('BTCUSDT','0.005');
  });

  test('malformed order is rejected before any Testnet write',async()=>{
    const f=fixture();
    const response=await request(f.app).post('/api/v1/private-trading/testnet/orders').auth(f.token(),{type:'bearer'}).send({symbol:'BTCUSDT',side:'Buy',orderType:'Limit',qty:'0',price:'70000'});
    expect(response.status).toBe(400);expect(f.testnet.createOrder).not.toHaveBeenCalled();
  });
});
