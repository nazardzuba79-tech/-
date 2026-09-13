import { FuturesDepthBook, subscribeFuturesDepth } from '../futuresDepth';

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
  test('switching contracts reuses the live socket instead of reconnecting and ignores old-topic frames',()=>{
    const btc=jest.fn();const stopBtc=subscribeFuturesDepth('BTC/USDT',btc);const ws=sockets[0];ws.onopen();
    const oldHandler=ws.onmessage;
    stopBtc();
    const eth=jest.fn();const stopEth=subscribeFuturesDepth('ETH/USDT',eth);
    expect(sockets).toHaveLength(1);
    expect(ws.send).toHaveBeenCalledWith(JSON.stringify({op:'unsubscribe',args:['orderbook.200.BTCUSDT']}));
    expect(ws.send).toHaveBeenCalledWith(JSON.stringify({op:'subscribe',args:['orderbook.200.ETHUSDT']}));
    oldHandler({data:JSON.stringify(frame())});jest.advanceTimersByTime(300);
    expect(btc).toHaveBeenCalledTimes(1);expect(eth).toHaveBeenCalledTimes(1);
    ws.onmessage({data:JSON.stringify(frame({s:'ETHUSDT',b:[['200','1']],a:[['201','2']]},'snapshot',{topic:'orderbook.200.ETHUSDT'}))});
    jest.advanceTimersByTime(300);
    expect(eth).toHaveBeenCalledTimes(2);expect(eth.mock.calls[1][0]).toEqual({bids:[{price:'200',quantity:'1'}],asks:[{price:'201',quantity:'2'}]});
    stopEth();jest.advanceTimersByTime(1000);expect(ws.close).toHaveBeenCalled();
  });
  test('stale connection clears rows and reconnects; hidden tab stops transport until visible',()=>{
    const listener=jest.fn();const stop=subscribeFuturesDepth('BTC/USDT',listener);
    sockets[0].onmessage({data:JSON.stringify(frame())});jest.advanceTimersByTime(32000);
    expect(listener).toHaveBeenLastCalledWith({bids:[],asks:[]});expect(sockets).toHaveLength(2);
    hidden=true;handlers.get('visibilitychange')!();jest.advanceTimersByTime(60000);expect(sockets).toHaveLength(2);
    hidden=false;handlers.get('visibilitychange')!();expect(sockets).toHaveLength(3);stop();jest.advanceTimersByTime(1000);
  });
});
