import { FuturesDepthBook, subscribeFuturesDepth, parseFuturesTrades } from '../futuresDepth';

const now=1_800_000_000_000;
const frame=(data:any={},type='snapshot',extra:any={})=>({topic:'orderbook.200.BTCUSDT',type,ts:now,
  data:{s:'BTCUSDT',b:[['100','2']],a:[['101','3']],u:2,seq:2,...data},...extra});
test('snapshot, delta update/delete/insert, and provider restart replace depth deterministically',()=>{
  const book=new FuturesDepthBook('BTCUSDT');book.apply(frame(),now);
  book.apply(frame({u:7,seq:8,b:[['100.0','0'],['99','4']],a:[['101','5']]},'delta'),now);
  expect(book.snapshot()).toEqual({bids:[{price:'99',quantity:'4'}],asks:[{price:'101',quantity:'5'}]});
  book.apply(frame({u:1,seq:1,b:[['98','1']],a:[['102','2']]},'delta'),now);
  expect(book.snapshot()).toEqual({bids:[{price:'98',quantity:'1'}],asks:[{price:'102',quantity:'2'}]});
});
test('delta before snapshot is rejected and duplicate deltas cannot roll depth back',()=>{
  const book=new FuturesDepthBook('BTCUSDT');expect(()=>book.apply(frame({},'delta'),now)).toThrow();
  book.apply(frame(),now);expect(book.apply(frame({b:[['100','999']]},'delta'),now)).toBe(false);
  expect(book.snapshot().bids[0].quantity).toBe('2');
});
test.each([{s:'ETHUSDT'},{u:0},{seq:NaN},{b:[['0','1']]},{a:[['101','-1']]},{b:[['102','4']]},{a:[['101',null]]}])(
  'malformed or wrong-identity frame is atomic: %j',data=>{
    const book=new FuturesDepthBook('BTCUSDT');book.apply(frame(),now);const before=book.snapshot();
    expect(()=>book.apply(frame({...data,u:data.u??3},'delta'),now)).toThrow();expect(book.snapshot()).toEqual(before);
  });
test('stale and future timestamps are rejected; unrelated topic ignored',()=>{
  const book=new FuturesDepthBook('BTCUSDT');
  expect(()=>book.apply(frame(),now+30001)).toThrow();
  expect(()=>book.apply(frame(),now-1001)).toThrow();
  expect(book.apply(frame({},'snapshot',{topic:'orderbook.200.ETHUSDT'}),now)).toBe(false);
});

describe('selected-contract depth lifecycle',()=>{
  let sockets:any[], hidden:boolean, handlers:Map<string,()=>void>, oldWs:any, oldDocument:any;
  beforeEach(()=>{
    jest.useFakeTimers().setSystemTime(now);sockets=[];hidden=false;handlers=new Map();
    oldWs=globalThis.WebSocket;oldDocument=globalThis.document;
    Object.assign(globalThis,{document:{get hidden(){return hidden;},addEventListener:(n:string,fn:()=>void)=>handlers.set(n,fn),removeEventListener:(n:string)=>handlers.delete(n)},
      WebSocket:class {readyState=1;onopen:any;onmessage:any;onclose:any;onerror:any;send=jest.fn();close=jest.fn();constructor(public url:string){sockets.push(this);}}});
  });
  afterEach(()=>{Object.assign(globalThis,{WebSocket:oldWs,document:oldDocument});jest.useRealTimers();});
  test('subscribes only to selected contract, coalesces updates, and ignores events after unsubscribe',()=>{
    const listener=jest.fn();const stop=subscribeFuturesDepth('BTC/USDT',listener);const ws=sockets[0];ws.onopen();
    expect(ws.send).toHaveBeenCalledWith(JSON.stringify({op:'subscribe',args:['orderbook.200.BTCUSDT']}));
    ws.onmessage({data:JSON.stringify(frame())});ws.onmessage({data:JSON.stringify(frame({u:3,seq:3,b:[['100','4']],a:[]},'delta'))});
    expect(listener).toHaveBeenCalledTimes(1);jest.advanceTimersByTime(300);expect(listener).toHaveBeenCalledTimes(2);
    expect(listener.mock.calls[1][0].bids[0].quantity).toBe('4');
    const late=ws.onmessage;stop();late({data:JSON.stringify(frame())});jest.advanceTimersByTime(60000);
    expect(listener).toHaveBeenCalledTimes(2);expect(ws.close).toHaveBeenCalled();expect(sockets).toHaveLength(1);
  });
  test('trade updates share the exact-contract socket, batch and clear on disconnect; late events are ignored',()=>{
    const depth=jest.fn(), trades=jest.fn();const stop=subscribeFuturesDepth('BTC/USDT',depth,trades);const ws=sockets[0];ws.onopen();
    expect(JSON.parse(ws.send.mock.calls[0][0]).args).toEqual(['orderbook.200.BTCUSDT','publicTrade.BTCUSDT']);
    const execution=(i:string,s='BTCUSDT')=>({topic:'publicTrade.BTCUSDT',data:[{s,i,S:'Buy',p:'100',v:'0.001',T:Date.now()}]});
    ws.onmessage({data:JSON.stringify(execution('wrong','ETHUSDT'))});
    ws.onmessage({data:JSON.stringify(execution('one'))});ws.onmessage({data:JSON.stringify(execution('two'))});
    expect(trades).not.toHaveBeenCalled();jest.advanceTimersByTime(300);
    expect(trades).toHaveBeenCalledTimes(1);expect(trades.mock.calls[0][0].map((t:any)=>t.id).sort()).toEqual(['one','two']);
    const late=ws.onmessage;ws.onmessage({data:JSON.stringify(execution('pending'))});ws.onclose();
    expect(trades).toHaveBeenLastCalledWith([]);jest.advanceTimersByTime(300);expect(trades).toHaveBeenCalledTimes(2);
    late({data:JSON.stringify(execution('late'))});jest.advanceTimersByTime(1000);expect(trades).toHaveBeenCalledTimes(2);
    hidden=true;handlers.get('visibilitychange')!();expect(trades).toHaveBeenLastCalledWith([]);
    stop();const count=trades.mock.calls.length;late({data:JSON.stringify(execution('stopped'))});jest.advanceTimersByTime(60000);expect(trades).toHaveBeenCalledTimes(count);
  });
  test('stale connection clears rows and reconnects; hidden tab stops transport until visible',()=>{
    const listener=jest.fn();const stop=subscribeFuturesDepth('BTC/USDT',listener);
    sockets[0].onmessage({data:JSON.stringify(frame())});jest.advanceTimersByTime(32000);
    expect(listener).toHaveBeenLastCalledWith({bids:[],asks:[]});expect(sockets).toHaveLength(2);
    hidden=true;handlers.get('visibilitychange')!();jest.advanceTimersByTime(60000);expect(sockets).toHaveLength(2);
    hidden=false;handlers.get('visibilitychange')!();expect(sockets).toHaveLength(3);stop();
  });
});

test('trade frames require exact contract, recent timestamps and positive real quantities',()=>{
 const good={s:'BTCUSDT',i:'execution-1',S:'Buy',p:'100.1',v:'0.001',T:now};
 const input=(r:any)=>({topic:'publicTrade.BTCUSDT',data:[r]});
 expect(parseFuturesTrades(input(good),'BTCUSDT',now)).toEqual([{id:'execution-1',side:'BUY',price:'100.1',quantity:'0.001',time:now}]);
 for(const bad of [{s:'ETHUSDT'},{T:now-30001},{T:now+1001},{p:'0'},{v:null},{S:'Other'},{i:''}])expect(parseFuturesTrades(input({...good,...bad}),'BTCUSDT',now)).toEqual([]);
 expect(parseFuturesTrades({topic:'publicTrade.BTCUSDT',data:[null,0,{}]},'BTCUSDT',now)).toEqual([]);
 expect(parseFuturesTrades({...input(good),topic:'publicTrade.ETHUSDT'},'BTCUSDT',now)).toEqual([]);
});
