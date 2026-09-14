import { createHmac } from 'crypto';
import { BybitTestnetClient, BybitTestnetError } from '../BybitTestnetClient';

const ok=(result:any)=>Promise.resolve({ok:true,json:async()=>({retCode:0,retMsg:'OK',result,time:1700000000000})} as Response);

describe('BybitTestnetClient',()=>{
  test('is disabled without server-side credentials and never calls upstream',async()=>{
    const fetcher=jest.fn();const client=new BybitTestnetClient({},fetcher as any,()=>1700000000000);
    expect(client.status()).toEqual(expect.objectContaining({configured:false,source:'BYBIT_TESTNET',executionHost:'api-testnet.bybit.com'}));
    await expect(client.state()).rejects.toMatchObject({code:'testnet_not_configured',status:503});
    expect(fetcher).not.toHaveBeenCalled();
  });

  test('uses the documented V5 HMAC payload and fixed Testnet origin',async()=>{
    const fetcher=jest.fn((_url:any,_options:any)=>ok({}));
    const client=new BybitTestnetClient({apiKey:'test-key',apiSecret:'test-secret'},fetcher as any,()=>1700000000123);
    await client.setLeverage('BTCUSDT','7');
    expect(fetcher).toHaveBeenCalledTimes(1);
    const [url,options]=fetcher.mock.calls[0];
    expect(url).toBe('https://api-testnet.bybit.com/v5/position/set-leverage');
    const body='{"buyLeverage":"7","category":"linear","sellLeverage":"7","symbol":"BTCUSDT"}';
    expect(options.body).toBe(body);
    const plaintext=`1700000000123test-key5000${body}`;
    const expected=createHmac('sha256','test-secret').update(plaintext).digest('hex');
    expect(options.headers).toEqual(expect.objectContaining({
      'X-BAPI-API-KEY':'test-key','X-BAPI-TIMESTAMP':'1700000000123','X-BAPI-RECV-WINDOW':'5000','X-BAPI-SIGN':expected,
    }));
    expect(String(url)).not.toContain('test-secret');
  });

  test('treats Bybit 110043 unchanged leverage as idempotent success',async()=>{
    const fetcher=jest.fn(async()=>({ok:true,json:async()=>({retCode:110043,retMsg:'Set leverage has not been modified.',result:{}})} as Response));
    const client=new BybitTestnetClient({apiKey:'key',apiSecret:'secret'},fetcher as any,()=>1700000000000);
    await expect(client.setLeverage('BTCUSDT','10')).resolves.toEqual({symbol:'BTCUSDT',leverage:'10'});
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  test('normalizes wallet, live positions, orders and real zeroes without inventing values',async()=>{
    const fetcher=jest.fn((url:string)=>{
      if(url.includes('/wallet-balance'))return ok({list:[{accountType:'UNIFIED',totalEquity:'10000',totalWalletBalance:'9990',totalMarginBalance:'10002',totalAvailableBalance:'9000',totalPerpUPL:'12',coin:[{coin:'USDT',equity:'10000',walletBalance:'9990',usdValue:'10000',unrealisedPnl:'12',locked:'0'}]}]});
      if(url.includes('/position/list'))return ok({list:[{symbol:'BTCUSDT',side:'Buy',size:'0.1',avgPrice:'70000',markPrice:'71000',liqPrice:'64000',leverage:'10',unrealisedPnl:'100',cumRealisedPnl:'0',positionValue:'7100',positionIM:'710',positionMM:'35',positionIdx:0,updatedTime:'1700000000000'},{symbol:'ETHUSDT',side:'Sell',size:'0',avgPrice:'0'}]});
      if(url.includes('/order/realtime'))return ok({list:[{orderId:'open-1',orderLinkId:'vx1',symbol:'BTCUSDT',side:'Buy',orderType:'Limit',price:'69000',qty:'0.1',avgPrice:'',orderStatus:'New',leavesQty:'0.1',cumExecQty:'0',reduceOnly:false,createdTime:'1',updatedTime:'2'}]});
      if(url.includes('/order/history'))return ok({list:[{orderId:'hist-1',orderLinkId:'vx2',symbol:'BTCUSDT',side:'Sell',orderType:'Market',price:'0',qty:'0.1',avgPrice:'70500',orderStatus:'Filled',leavesQty:'0',cumExecQty:'0.1',reduceOnly:true,createdTime:'3',updatedTime:'4'}]});
      if(url.includes('/closed-pnl'))return ok({list:[{symbol:'BTCUSDT',orderId:'close-1',side:'Sell',qty:'0.1',avgEntryPrice:'70000',avgExitPrice:'70500',closedPnl:'50',openFee:'3',closeFee:'3',createdTime:'5',updatedTime:'6'}]});
      throw new Error('unexpected');
    });
    const client=new BybitTestnetClient({apiKey:'key',apiSecret:'secret'},fetcher as any,()=>1700000000999);
    const state=await client.state();
    expect(state.source).toBe('BYBIT_TESTNET');expect(state.fetchedAt).toBe(1700000000999);
    expect(state.wallet?.coins[0].locked).toBe('0');
    expect(state.positions).toHaveLength(1);expect(state.positions[0]).toEqual(expect.objectContaining({symbol:'BTCUSDT',side:'Buy',leverage:'10',cumRealisedPnl:'0'}));
    expect(state.openOrders[0].orderStatus).toBe('New');expect(state.orderHistory[0].avgPrice).toBe('70500');expect(state.closedPnl[0].closedPnl).toBe('50');
  });

  test('order flow sets leverage first and sends only validated linear Testnet requests',async()=>{
    const calls:{url:string;body:string}[]=[];
    const fetcher=jest.fn((url:string,options:any)=>{calls.push({url,body:String(options.body??'')});return ok(url.includes('/order/create')?{orderId:'order-1',orderLinkId:'vx-returned'}:{});});
    const client=new BybitTestnetClient({apiKey:'key',apiSecret:'secret'},fetcher as any,()=>1700000000000);
    const placed=await client.createOrder({symbol:'BTC/USDT',side:'Buy',orderType:'Limit',qty:'0.01',price:'70000',leverage:'5',takeProfit:'75000',stopLoss:'68000'});
    expect(placed.orderId).toBe('order-1');expect(calls).toHaveLength(2);
    expect(calls[0].url).toBe('https://api-testnet.bybit.com/v5/position/set-leverage');
    expect(calls[1].url).toBe('https://api-testnet.bybit.com/v5/order/create');
    expect(JSON.parse(calls[1].body)).toEqual(expect.objectContaining({category:'linear',symbol:'BTCUSDT',side:'Buy',orderType:'Limit',qty:'0.01',price:'70000',positionIdx:0,takeProfit:'75000',stopLoss:'68000'}));
  });

  test('network failures are sanitized and do not echo credentials',async()=>{
    const client=new BybitTestnetClient({apiKey:'sensitive-key',apiSecret:'sensitive-secret'},jest.fn(async()=>{throw new Error('sensitive-secret');}) as any);
    let error:unknown;try{await client.setLeverage('BTCUSDT','5');}catch(e){error=e;}
    expect(error).toBeInstanceOf(BybitTestnetError);
    expect(String((error as Error).message)).toBe('Bybit Testnet временно недоступен');
    expect(String((error as Error).message)).not.toContain('sensitive');
  });
});
