// The thresholds under test, read from the rules themselves. See bookFreshness.
import { BOOK_STALE_AFTER_MS, BOOK_UNAVAILABLE_AFTER_MS } from '../bookFreshness';
import {
  FuturesDepthBook, subscribeFuturesDepth, parseFuturesTrades,
  setFuturesDepthFallbackBase, closeFuturesDepth, DepthFrameError, DepthDesyncError,
  FLUSH_MS,
} from '../futuresDepth';

/**
 * These tests are about COALESCING — one repaint per window, however long
 * the window is — so they advance by the window the module actually uses
 * rather than by a number copied out of it. The literal 300 was here until
 * the window moved to 400 to match Binance's measured 425ms cadence, and
 * every one of these went red for a reason that had nothing to do with what
 * they check.
 */
const FLUSH = FLUSH_MS;

const now=1_800_000_000_000;
const frame=(data:any={},type='snapshot',extra:any={})=>({topic:'orderbook.50.BTCUSDT',type,ts:now,
  data:{s:'BTCUSDT',b:[['100','2']],a:[['101','3']],u:2,seq:2,...data},...extra});

test('snapshot, delta update/delete/insert, and provider restart replace depth deterministically',()=>{
  const book=new FuturesDepthBook('BTCUSDT');book.apply(frame(),now);
  book.apply(frame({u:7,seq:8,b:[['100.0','0'],['99','4']],a:[['101','5']]},'delta'),now);
  expect(book.levels()).toEqual({bids:[{price:'99',quantity:'4'}],asks:[{price:'101',quantity:'5'}]});
  book.apply(frame({u:1,seq:1,b:[['98','1']],a:[['102','2']]},'delta'),now);
  expect(book.levels()).toEqual({bids:[{price:'98',quantity:'1'}],asks:[{price:'102',quantity:'2'}]});
});

test('delta before snapshot is a desync and duplicate deltas cannot roll depth back',()=>{
  const book=new FuturesDepthBook('BTCUSDT');
  expect(()=>book.apply(frame({},'delta'),now)).toThrow(DepthDesyncError);
  book.apply(frame(),now);expect(book.apply(frame({b:[['100','999']]},'delta'),now)).toBe(false);
  expect(book.levels().bids[0].quantity).toBe('2');
});

test.each([{s:'ETHUSDT'},{u:0},{seq:NaN},{b:[['0','1']]},{a:[['101','-1']]},{a:[['101',null]]}])(
  'a frame we cannot read is dropped without touching the book: %j',data=>{
    const book=new FuturesDepthBook('BTCUSDT');book.apply(frame(),now);const before=book.levels();
    expect(()=>book.apply(frame({...data,u:data.u??3},'delta'),now)).toThrow(DepthFrameError);
    expect(book.levels()).toEqual(before);
  });

test('a crossed book is a desync, not a bad frame, and leaves the last good depth intact',()=>{
  const book=new FuturesDepthBook('BTCUSDT');book.apply(frame(),now);const before=book.levels();
  expect(()=>book.apply(frame({b:[['102','4']],a:[],u:3,seq:3},'delta'),now)).toThrow(DepthDesyncError);
  expect(book.levels()).toEqual(before);
});

/**
 * The regression this whole rewrite exists for.
 *
 * `frame.ts` is the venue's clock and `now` is the visitor's. Comparing
 * them rejected every frame on any machine whose time was off by more than
 * a second — a permanently empty book, on a laptop that had merely woken
 * from sleep. Ordering comes from `u`/`seq`; the clock is not consulted.
 */
test.each([
  ['three seconds slow', -3_000],
  ['a minute slow', -60_000],
  ['thirty-one seconds fast', 31_000],
  ['an hour fast', 3_600_000],
])('a visitor clock %s still builds a book',(_label,skew)=>{
  const book=new FuturesDepthBook('BTCUSDT');
  const visitor=now+skew;
  expect(book.apply(frame(),visitor)).toBe(true);
  expect(book.apply(frame({u:3,seq:3,b:[['99','7']],a:[]},'delta'),visitor+100)).toBe(true);
  expect(book.levels().bids).toEqual([{price:'100',quantity:'2'},{price:'99',quantity:'7'}]);
});

test('an unrelated topic is ignored rather than treated as an error',()=>{
  const book=new FuturesDepthBook('BTCUSDT');
  expect(book.apply(frame({},'snapshot',{topic:'orderbook.50.ETHUSDT'}),now)).toBe(false);
});

describe('selected-contract depth lifecycle',()=>{
  let sockets:any[], hidden:boolean, handlers:Map<string,()=>void>, oldWs:any, oldDocument:any, oldFetch:any;
  beforeEach(()=>{
    jest.useFakeTimers().setSystemTime(now);sockets=[];hidden=false;handlers=new Map();
    oldWs=globalThis.WebSocket;oldDocument=globalThis.document;oldFetch=(globalThis as any).fetch;
    (globalThis as any).fetch=undefined; // the fallback stays off unless a test wires it
    Object.assign(globalThis,{document:{get hidden(){return hidden;},addEventListener:(n:string,fn:()=>void)=>handlers.set(n,fn),removeEventListener:(n:string)=>handlers.delete(n)},
      WebSocket:class {readyState=1;onopen:any;onmessage:any;onclose:any;onerror:any;send=jest.fn();close=jest.fn();constructor(public url:string){sockets.push(this);}}});
  });
  // The transport is a module singleton by design — one socket for the tab.
  // Each test therefore starts from a released one rather than inheriting
  // the previous test's connection.
  afterEach(()=>{closeFuturesDepth();Object.assign(globalThis,{WebSocket:oldWs,document:oldDocument,fetch:oldFetch});jest.useRealTimers();});

  test('subscribes only to selected contract, coalesces updates, and ignores events after unsubscribe',()=>{
    const listener=jest.fn();const stop=subscribeFuturesDepth('BTC/USDT',listener);const ws=sockets[0];ws.onopen();
    expect(ws.send).toHaveBeenCalledWith(JSON.stringify({op:'subscribe',args:['orderbook.50.BTCUSDT','publicTrade.BTCUSDT']}));
    expect(listener.mock.calls[0][0]).toEqual({bids:[],asks:[],status:'connecting',asOf:null,source:null});
    ws.onmessage({data:JSON.stringify(frame())});ws.onmessage({data:JSON.stringify(frame({u:3,seq:3,b:[['100','4']],a:[]},'delta'))});
    expect(listener).toHaveBeenCalledTimes(1);jest.advanceTimersByTime(FLUSH);expect(listener).toHaveBeenCalledTimes(2);
    expect(listener.mock.calls[1][0].bids[0].quantity).toBe('4');
    expect(listener.mock.calls[1][0].status).toBe('live');
    expect(listener.mock.calls[1][0].source).toBe('socket');
    const late=ws.onmessage;stop();late({data:JSON.stringify(frame())});jest.advanceTimersByTime(60000);
    expect(listener).toHaveBeenCalledTimes(2);expect(ws.close).toHaveBeenCalled();expect(sockets).toHaveLength(1);
  });

  test('a second subscriber to a live contract is handed the book, never an empty one',()=>{
    const first=jest.fn();const stopFirst=subscribeFuturesDepth('BTC/USDT',first);
    sockets[0].onopen();sockets[0].onmessage({data:JSON.stringify(frame())});jest.advanceTimersByTime(FLUSH);
    const second=jest.fn();const stopSecond=subscribeFuturesDepth('BTC/USDT',second);
    // This is the flash that React's own remount used to cause.
    expect(second.mock.calls[0][0].bids).toEqual([{price:'100',quantity:'2'}]);
    expect(second.mock.calls[0][0].status).toBe('live');
    expect(sockets).toHaveLength(1);
    stopFirst();stopSecond();jest.advanceTimersByTime(1000);
  });

  test('a bad frame is skipped; a desync resubscribes that topic and keeps the last good book',()=>{
    const listener=jest.fn();const stop=subscribeFuturesDepth('BTC/USDT',listener);const ws=sockets[0];ws.onopen();
    ws.onmessage({data:JSON.stringify(frame())});jest.advanceTimersByTime(FLUSH);
    const good=listener.mock.calls[listener.mock.calls.length-1][0];
    expect(good.bids).toEqual([{price:'100',quantity:'2'}]);

    // Unreadable level: dropped, no reconnect, no repaint.
    const calls=listener.mock.calls.length;
    ws.onmessage({data:JSON.stringify(frame({u:5,seq:5,b:[['nope','1']],a:[]},'delta'))});
    jest.advanceTimersByTime(FLUSH);
    expect(listener).toHaveBeenCalledTimes(calls);
    expect(sockets).toHaveLength(1);

    // Crossed book: our copy is wrong, so ask this topic for a new snapshot.
    ws.send.mockClear();
    ws.onmessage({data:JSON.stringify(frame({u:6,seq:6,b:[['102','1']],a:[]},'delta'))});
    jest.advanceTimersByTime(FLUSH);
    expect(ws.send).toHaveBeenCalledWith(JSON.stringify({op:'unsubscribe',args:['orderbook.50.BTCUSDT','publicTrade.BTCUSDT']}));
    expect(ws.send).toHaveBeenCalledWith(JSON.stringify({op:'subscribe',args:['orderbook.50.BTCUSDT','publicTrade.BTCUSDT']}));
    expect(sockets).toHaveLength(1); // the transport was never torn down
    const after=listener.mock.calls[listener.mock.calls.length-1][0];
    expect(after.bids).toEqual([{price:'100',quantity:'2'}]); // last good, still drawn
    expect(after.status).toBe('stale');
    stop();jest.advanceTimersByTime(1000);
  });

  test('trade updates share the exact-contract socket, batch and clear on disconnect; late events are ignored',()=>{
    const depth=jest.fn(), trades=jest.fn();const stop=subscribeFuturesDepth('BTC/USDT',depth,trades);const ws=sockets[0];ws.onopen();
    expect(JSON.parse(ws.send.mock.calls[0][0]).args).toEqual(['orderbook.50.BTCUSDT','publicTrade.BTCUSDT']);
    const execution=(i:string,s='BTCUSDT')=>({topic:'publicTrade.BTCUSDT',data:[{s,i,S:'Buy',p:'100',v:'0.001',T:Date.now()}]});
    ws.onmessage({data:JSON.stringify(execution('wrong','ETHUSDT'))});
    ws.onmessage({data:JSON.stringify(execution('one'))});ws.onmessage({data:JSON.stringify(execution('two'))});
    expect(trades).not.toHaveBeenCalled();jest.advanceTimersByTime(FLUSH);
    expect(trades).toHaveBeenCalledTimes(1);expect(trades.mock.calls[0][0].map((t:any)=>t.id).sort()).toEqual(['one','two']);
    const late=ws.onmessage;ws.onclose();
    late({data:JSON.stringify(execution('late'))});jest.advanceTimersByTime(1000);expect(trades).toHaveBeenCalledTimes(1);
    stop();jest.advanceTimersByTime(60000);
  });

  test('switching contracts reuses the live socket instead of reconnecting and ignores old-topic frames',()=>{
    const btc=jest.fn(), btcTrades=jest.fn(), ethTrades=jest.fn();const stopBtc=subscribeFuturesDepth('BTC/USDT',btc,btcTrades);const ws=sockets[0];ws.onopen();
    ws.onmessage({data:JSON.stringify({topic:'publicTrade.BTCUSDT',data:[{s:'BTCUSDT',i:'pending-btc',S:'Buy',p:'100',v:'1',T:now}]})});
    const oldHandler=ws.onmessage;
    stopBtc();
    const eth=jest.fn();const stopEth=subscribeFuturesDepth('ETH/USDT',eth,ethTrades);
    expect(sockets).toHaveLength(1);
    expect(ws.send).toHaveBeenCalledWith(JSON.stringify({op:'unsubscribe',args:['orderbook.50.BTCUSDT','publicTrade.BTCUSDT']}));
    expect(ws.send).toHaveBeenCalledWith(JSON.stringify({op:'subscribe',args:['orderbook.50.ETHUSDT','publicTrade.ETHUSDT']}));
    oldHandler({data:JSON.stringify(frame())});jest.advanceTimersByTime(FLUSH);
    expect(btc).toHaveBeenCalledTimes(1);expect(eth).toHaveBeenCalledTimes(1);
    expect(btcTrades).not.toHaveBeenCalled();expect(ethTrades).not.toHaveBeenCalled();
    ws.onmessage({data:JSON.stringify({topic:'publicTrade.ETHUSDT',data:[{s:'ETHUSDT',i:'eth-execution',S:'Sell',p:'200',v:'2',T:now}]})});
    ws.onmessage({data:JSON.stringify(frame({s:'ETHUSDT',b:[['200','1']],a:[['201','2']]},'snapshot',{topic:'orderbook.50.ETHUSDT'}))});
    jest.advanceTimersByTime(FLUSH);
    expect(eth).toHaveBeenCalledTimes(2);
    expect(eth.mock.calls[1][0].bids).toEqual([{price:'200',quantity:'1'}]);
    expect(eth.mock.calls[1][0].asks).toEqual([{price:'201',quantity:'2'}]);
    expect(ethTrades).toHaveBeenCalledTimes(1);expect(ethTrades.mock.calls[0][0][0].id).toBe('eth-execution');
    stopEth();jest.advanceTimersByTime(1000);expect(ws.close).toHaveBeenCalled();
  });

  /**
   * The `valid book -> [] -> valid book -> []` flicker, asserted away.
   */
  test('a silent feed labels the book, reconnects, and only drops the levels once they are no longer a price',()=>{
    const listener=jest.fn();const stop=subscribeFuturesDepth('BTC/USDT',listener);
    sockets[0].onopen();sockets[0].onmessage({data:JSON.stringify(frame())});jest.advanceTimersByTime(FLUSH);
    expect(listener.mock.calls[1][0].status).toBe('live');

    // Silence past the stale threshold: same levels, labelled, and a
    // reconnect. The threshold is read from the shared freshness rules
    // rather than retyped, because its whole job is to stay longer than the
    // refresh interval — a literal here would let the two drift apart.
    jest.advanceTimersByTime(BOOK_STALE_AFTER_MS + 2_000);
    const stale=listener.mock.calls[listener.mock.calls.length-1][0];
    expect(stale.status).toBe('stale');
    expect(stale.bids).toEqual([{price:'100',quantity:'2'}]);
    expect(sockets.length).toBeGreaterThan(1);

    // Long enough that the levels are no longer a price: now it is unknown,
    // and says so. Empty means "we do not know", never zero depth.
    jest.advanceTimersByTime(BOOK_UNAVAILABLE_AFTER_MS);
    const gone=listener.mock.calls[listener.mock.calls.length-1][0];
    expect(gone.status).toBe('unavailable');
    expect(gone.bids).toEqual([]);expect(gone.asks).toEqual([]);
    stop();jest.advanceTimersByTime(1000);
  });

  test('a hidden tab stops the transport but keeps the book, and resumes on return',()=>{
    const listener=jest.fn();const stop=subscribeFuturesDepth('BTC/USDT',listener);
    sockets[0].onopen();sockets[0].onmessage({data:JSON.stringify(frame())});jest.advanceTimersByTime(FLUSH);
    const opened=sockets.length;

    hidden=true;handlers.get('visibilitychange')!();
    const hiddenView=listener.mock.calls[listener.mock.calls.length-1][0];
    expect(hiddenView.bids).toEqual([{price:'100',quantity:'2'}]); // kept, not cleared
    // THIS LINE USED TO REQUIRE `stale`, AND THAT WAS THE BUG.
    // Labelling the book on the way out is invisible while the tab is
    // hidden; the cost lands on the way back, where the status is still
    // `stale` until the new socket's first frame and the panel announces a
    // lost connection through an ordinary handshake. Closing a socket we
    // chose to close is not news, so nothing is emitted and nothing is
    // relabelled — see futuresDepthReconnectGrace.test.ts for the journey.
    expect(hiddenView.status).not.toBe('stale');
    jest.advanceTimersByTime(60_000);
    expect(sockets).toHaveLength(opened); // nothing reconnects behind a hidden tab

    hidden=false;handlers.get('visibilitychange')!();
    expect(sockets).toHaveLength(opened+1);
    // And returning does not put the warning up either: the book is held
    // over for the grace window while the handshake completes.
    expect(listener.mock.calls[listener.mock.calls.length-1][0].status).not.toBe('stale');
    stop();jest.advanceTimersByTime(1000);
  });

  test('the backend fallback only runs while the socket has nothing, and stops the moment it does',async()=>{
    setFuturesDepthFallbackBase('/api/v1');
    const respond=jest.fn().mockResolvedValue({ok:true,json:async()=>({available:true,updateId:9,
      bids:[['100','2']].map(([price,quantity])=>({price,quantity})),
      asks:[['101','3']].map(([price,quantity])=>({price,quantity}))})});
    (globalThis as any).fetch=respond;
    const listener=jest.fn();const stop=subscribeFuturesDepth('BTC/USDT',listener);
    sockets[0].onopen();

    // A healthy socket is given six seconds before anything else is asked.
    jest.advanceTimersByTime(5_000);
    expect(respond).not.toHaveBeenCalled();

    jest.advanceTimersByTime(1_100);
    await Promise.resolve();await Promise.resolve();await Promise.resolve();
    expect(respond).toHaveBeenCalledTimes(1);
    expect(respond.mock.calls[0][0]).toBe('/api/v1/market/display/futures-book/BTCUSDT');
    jest.advanceTimersByTime(FLUSH);
    const filled=listener.mock.calls[listener.mock.calls.length-1][0];
    expect(filled.bids).toEqual([{price:'100',quantity:'2'}]);
    expect(filled.source).toBe('rest');

    // The socket comes back. The poller is not "slowed down" — it stops.
    sockets[0].onmessage({data:JSON.stringify(frame({u:20,seq:20}))});
    const afterSocket=respond.mock.calls.length;
    jest.advanceTimersByTime(5_000);
    await Promise.resolve();await Promise.resolve();
    expect(respond).toHaveBeenCalledTimes(afterSocket);
    stop();jest.advanceTimersByTime(1000);
  });

  test('an unavailable backend leaves the book alone rather than emptying it',async()=>{
    setFuturesDepthFallbackBase('/api/v1');
    (globalThis as any).fetch=jest.fn().mockResolvedValue({ok:true,json:async()=>({available:false,reason:'provider_unavailable'})});
    const listener=jest.fn();const stop=subscribeFuturesDepth('BTC/USDT',listener);
    sockets[0].onopen();sockets[0].onmessage({data:JSON.stringify(frame())});jest.advanceTimersByTime(FLUSH);
    const good=listener.mock.calls[listener.mock.calls.length-1][0];
    expect(good.bids).toEqual([{price:'100',quantity:'2'}]);
    sockets[0].onclose();
    jest.advanceTimersByTime(8_000);
    await Promise.resolve();await Promise.resolve();await Promise.resolve();
    const after=listener.mock.calls[listener.mock.calls.length-1][0];
    expect(after.bids).toEqual([{price:'100',quantity:'2'}]); // untouched
    stop();jest.advanceTimersByTime(1000);
  });

  /**
   * The reconnect that never happened.
   *
   * The heartbeat decided whether the socket was dead purely from how long
   * it had been since the last accepted frame. Once a book was stale that
   * clock stayed past the threshold no matter how young the socket was, so
   * the one-second tick closed every fresh socket one second after opening
   * it — before a handshake, a subscribe and a first snapshot could land.
   * Anyone whose round trip to the venue took longer than that second was
   * left with a permanent "not updating - reconnecting" label and a
   * reconnect that was being cancelled a second at a time.
   *
   * A new socket is now judged on its own age, so a slow one still gets to
   * finish connecting and the panel goes back to live.
   */
  test('a reconnect is given time to finish connecting instead of being torn down every second',()=>{
    const listener=jest.fn();const stop=subscribeFuturesDepth('BTC/USDT',listener);
    sockets[0].onopen();sockets[0].onmessage({data:JSON.stringify(frame())});jest.advanceTimersByTime(FLUSH);
    expect(listener.mock.calls[1][0].status).toBe('live');

    // Silence long enough for the heartbeat to give up on this socket, then
    // wait for the backoff to open the replacement.
    jest.advanceTimersByTime(BOOK_STALE_AFTER_MS + 8_000);
    expect(listener.mock.calls[listener.mock.calls.length-1][0].status).toBe('stale');
    let opened=sockets.length;
    expect(opened).toBeGreaterThan(1);
    while(sockets.length===opened) jest.advanceTimersByTime(1_000);
    opened=sockets.length;

    // That replacement is a live handle, not a corpse. Three seconds after
    // it was opened it is still the transport's socket — under the old rule
    // it was closed one second in, every time, forever.
    const fresh=sockets[sockets.length-1];
    expect(fresh.close).not.toHaveBeenCalled();
    jest.advanceTimersByTime(3_000);
    expect(fresh.close).not.toHaveBeenCalled();
    expect(sockets).toHaveLength(opened); // nothing was thrown away and reopened

    // A handshake that takes three seconds still completes, and the book
    // comes back rather than staying labelled forever.
    fresh.onopen();
    fresh.onmessage({data:JSON.stringify(frame({u:40,seq:40,b:[['103','5']],a:[['104','6']]}))});
    jest.advanceTimersByTime(FLUSH);
    const back=listener.mock.calls[listener.mock.calls.length-1][0];
    expect(back.status).toBe('live');
    expect(back.bids).toEqual([{price:'103',quantity:'5'}]);
    stop();jest.advanceTimersByTime(1000);
  });

  /** A socket that really is mute is still dropped — just not instantly. */
  test('a socket that stays mute past its grace is still replaced',()=>{
    const listener=jest.fn();const stop=subscribeFuturesDepth('BTC/USDT',listener);
    sockets[0].onopen();sockets[0].onmessage({data:JSON.stringify(frame())});jest.advanceTimersByTime(FLUSH);
    jest.advanceTimersByTime(BOOK_STALE_AFTER_MS + 8_000);
    const opened=sockets.length;
    const mute=sockets[sockets.length-1];
    mute.onopen(); // connects, then says nothing at all
    jest.advanceTimersByTime(30_000);
    expect(mute.close).toHaveBeenCalled();
    expect(sockets.length).toBeGreaterThan(opened);
    stop();jest.advanceTimersByTime(1000);
  });
});

test('trade frames require exact contract and positive real quantities',()=>{
 const good={s:'BTCUSDT',i:'execution-1',S:'Buy',p:'100.1',v:'0.001',T:now};
 const input=(r:any)=>({topic:'publicTrade.BTCUSDT',data:[r]});
 expect(parseFuturesTrades(input(good),'BTCUSDT',now)).toEqual([{id:'execution-1',side:'BUY',price:'100.1',quantity:'0.001',time:now}]);
 for(const bad of [{s:'ETHUSDT'},{p:'0'},{v:null},{S:'Other'},{i:''},{T:'nope'}])expect(parseFuturesTrades(input({...good,...bad}),'BTCUSDT',now)).toEqual([]);
 expect(parseFuturesTrades({topic:'publicTrade.BTCUSDT',data:[null,0,{}]},'BTCUSDT',now)).toEqual([]);
 expect(parseFuturesTrades({...input(good),topic:'publicTrade.ETHUSDT'},'BTCUSDT',now)).toEqual([]);
 // A trade stamped by the venue's clock is not discarded because the
 // visitor's clock disagrees — the same skew bug the book had.
 expect(parseFuturesTrades(input({...good,T:now-3_600_000}),'BTCUSDT',now)).toHaveLength(1);
});
