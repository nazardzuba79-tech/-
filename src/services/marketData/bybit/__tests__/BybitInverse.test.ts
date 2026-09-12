import { EventEmitter } from 'events';
import WebSocket from 'ws';
import { BybitMarketDataService } from '../BybitMarketDataService';
import { BybitTickerBook } from '../BybitTickerBook';
import { BybitLiveTickerCollector, planSubscriptions } from '../BybitLiveTickerCollector';
import { isExecutablePerpetualCandidate } from '../MarketUniverse';
import { parseLiveFrame } from '../../live/validation';

const rows=[{symbol:'BTCUSD',contractType:'InversePerpetual',baseCoin:'BTC',quoteCoin:'USD',settleCoin:'BTC',status:'Trading',deliveryTime:'0'},
  {symbol:'BTCUSDZ26',contractType:'InverseFutures',baseCoin:'BTC',quoteCoin:'USD',settleCoin:'BTC',status:'Trading',deliveryTime:'1798185600000'}];
function fixture() {
  let now=1000000, fail=false;
  const fetchFn=jest.fn(async(input:any)=>{
    if(fail)throw Error('unavailable');const u=new URL(String(input)),cat=u.searchParams.get('category');
    let list:any[]=[],nextPageCursor='';
    if(cat==='inverse') {
      if(u.pathname.endsWith('instruments-info')){list=u.searchParams.has('cursor')?rows.slice(1):rows.slice(0,1);nextPageCursor=u.searchParams.has('cursor')?'':'next';}
      else list=rows.map(r=>({symbol:r.symbol,lastPrice:'70000',bid1Price:'69999',ask1Price:'70001',fundingRate:'',volume24h:'0'}));
    } else if(u.pathname.endsWith('instruments-info'))list=[{symbol:'ETHUSDT',baseCoin:'ETH',quoteCoin:'USDT',settleCoin:'USDT',status:'Trading',contractType:'LinearPerpetual'}];
    else list=[{symbol:'ETHUSDT',lastPrice:'2000'}];
    return {ok:true,status:200,json:async()=>({retCode:0,time:now,result:{list,nextPageCursor}})} as Response;
  });
  return {rest:new BybitMarketDataService({fetchFn,now:()=>now,sleep:async()=>{}}),fetchFn,now:()=>now,advance:(n:number)=>now+=n,fail:()=>fail=true};
}
test('inverse paginator, contract identity, dates and explicit non-executability',async()=>{
  const f=fixture(),all=await f.rest.listInverseInstruments();expect(all.value).toHaveLength(2);
  expect(all.value.map(i=>i.marketType)).toEqual(['inverse_perpetual','inverse_futures']);
  expect(all.value[0].deliveryTime).toBeNull();expect(all.value[1].deliveryTime).toBe(1798185600000);
  expect(all.value.every(i=>!isExecutablePerpetualCandidate(i))).toBe(true);
  expect(f.fetchFn).toHaveBeenCalledTimes(2);
  for(const [url] of f.fetchFn.mock.calls){expect(url).toContain('category=inverse&limit=1000');expect(url).not.toContain('baseCoin');}
  const tickers=await f.rest.getTickers('inverse');expect(tickers.value.map(t=>t.marketType)).toEqual(['inverse_perpetual','inverse_futures']);
  expect(f.fetchFn).toHaveBeenCalledTimes(3);expect(f.fetchFn.mock.calls[2][0]).not.toContain('symbol=');
});
test('REST bootstrap and WS delta preserve nulls, zero, separate contracts and rollback high water',async()=>{
  const f=fixture(),book=new BybitTickerBook(f.now);book.setUniverse((await f.rest.listInverseInstruments()).value);
  const snapshot=await f.rest.getTickers('inverse');book.bootstrap('inverse',snapshot);
  const id='inverse_perpetual:BTCUSD';
  expect(book.rows.get(id)).toMatchObject({lastPrice:70000,fundingRate:null,volume24h:0,baseAsset:'BTC',quoteAsset:'USD',settleAsset:'BTC'});
  const apply=(ts:number,cs:number,data:any)=>book.apply('inverse',{topic:'tickers.BTCUSD',type:'delta',ts,cs,data});
  expect(apply(1000001,100,{lastPrice:'70002',fundingRate:'0'})).toBe(true);
  expect(book.rows.get(id)).toMatchObject({bidPrice:69999,askPrice:70001,fundingRate:0});
  expect(apply(1000000,101,{lastPrice:'1'})).toBe(false);expect(apply(1000002,99,{lastPrice:'1'})).toBe(false);
  book.bootstrap('inverse',{...snapshot,value:snapshot.value.map(t=>({...t,providerEventAt:1000001}))});
  expect(book.rows.get(id)).toMatchObject({lastPrice:70002,sequence:100});
  expect(book.rows.get('inverse_futures:BTCUSDZ26')?.lastPrice).toBe(70000);
  f.advance(31000);book.stale();expect(book.rows.get(id)).toMatchObject({stale:true,lastPrice:70002});
  expect(parseLiveFrame({version:1,type:'snapshot',epoch:'fixture',revision:1,sentAt:f.now(),status:'stale',rows:[...book.rows.values()]}).rows).toHaveLength(2);
});
test('inverse universe failed refresh retains complete stale-last-good',async()=>{
  const f=fixture();await f.rest.listInverseInstruments();f.advance(900001);f.fail();
  const held=await f.rest.listInverseInstruments();expect(held.stale).toBe(true);expect(held.value).toHaveLength(2);
});
class Socket extends EventEmitter {
  readyState:number=WebSocket.OPEN;frames:any[]=[];
  send(raw:string){this.frames.push(JSON.parse(raw));}
  terminate(){this.readyState=WebSocket.CLOSED;this.emit('close');}
  open(){this.emit('open');for(const f of this.frames.filter(f=>f.op==='subscribe'))this.emit('message',Buffer.from(JSON.stringify({op:'subscribe',success:true,req_id:f.req_id})));}
}
test('inverse public connection reconnects, snapshots and resubscribes without client fan-out',async()=>{
  jest.useFakeTimers();const f=fixture(),sockets:{url:string;s:Socket}[]=[];
  const c=new BybitLiveTickerCollector(f.rest,{now:f.now,random:()=>0,socket:url=>{const s=new Socket();sockets.push({url,s});return s as any;}});
  try {
    c.start();await jest.advanceTimersByTimeAsync(0);sockets.forEach(({s})=>s.open());
    const inverse=sockets.find(i=>i.url.endsWith('/inverse'))!;expect(inverse.s.frames.find(f=>f.op==='subscribe').args).toEqual(expect.arrayContaining(['tickers.BTCUSD','tickers.BTCUSDZ26']));
    expect(c.diagnostics()).toMatchObject({inversePerpetuals:1,inverseFutures:1});
    inverse.s.terminate();expect(c.book.rows.get('inverse_perpetual:BTCUSD')?.stale).toBe(true);
    f.advance(6000);await jest.advanceTimersByTimeAsync(800);sockets.at(-1)!.s.open();
    expect(sockets.at(-1)!.url).toContain('/inverse');expect(sockets.filter(i=>i.s.readyState===WebSocket.OPEN)).toHaveLength(3);
    expect(c.book.rows.get('inverse_perpetual:BTCUSD')).toMatchObject({stale:false,lastPrice:70000});
    const unsub=Array.from({length:100},()=>c.feed.subscribe(()=>{}));expect(sockets).toHaveLength(4);unsub.forEach(fn=>fn());
  } finally {c.stop();expect(jest.getTimerCount()).toBe(0);jest.useRealTimers();}
});
test('inverse packing honors encoded 21000-character connection budget',()=>{
  const plans=planSubscriptions('inverse',Array.from({length:2000},(_,i)=>`ASSET${i}USDZ26`));
  expect(plans.flatMap(p=>p.topics)).toHaveLength(2000);expect(plans.every(p=>JSON.stringify(p.topics).length<=21000)).toBe(true);
});
