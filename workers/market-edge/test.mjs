import assert from "node:assert/strict";
import worker from "./src/index.js";

const makeBook = () => Array.from({length:50},(_,i)=>[String(100-i/100),String(i+1)]);
const makeAsks = () => Array.from({length:50},(_,i)=>[String(101+i/100),String(i+1)]);

async function run(){
  const originalFetch=globalThis.fetch;
  const originalCaches=globalThis.caches;
  delete globalThis.caches;
  try{
    const seen=[];
    globalThis.fetch=async(url,options={})=>{
      seen.push(String(url));
      assert.equal(options.headers?.authorization,undefined);
      assert.equal(options.headers?.cookie,undefined);
      const u=new URL(url);
      if(u.hostname==="api.bybit.com"||u.hostname==="api.bytick.com"){
        if(u.pathname.includes("orderbook"))return new Response(JSON.stringify({
          retCode:0,time:1790150000000,result:{s:"BTCUSDT",u:12345,b:makeBook(),a:makeAsks()}
        }),{status:200,headers:{"content-type":"application/json"}});
        if(u.pathname.includes("recent-trade"))return new Response(JSON.stringify({
          retCode:0,result:{category:"linear",list:[{symbol:"BTCUSDT",execId:"t1",price:"100.5",size:"0.25",time:"1790150000123",side:"Buy"}]}
        }),{status:200,headers:{"content-type":"application/json"}});
        if(u.pathname.includes("tickers"))return new Response(JSON.stringify({
          retCode:0,time:1790150000200,result:{category:"linear",list:[{symbol:"BTCUSDT",lastPrice:"100.5",bid1Price:"100.4",ask1Price:"100.6",price24hPcnt:"0.0123"}]}
        }),{status:200,headers:{"content-type":"application/json"}});
        if(u.pathname.includes("kline"))return new Response(JSON.stringify({
          retCode:0,time:1790150000300,result:{category:"linear",symbol:"BTCUSDT",list:[["1790146800000","100","102","99","101","1234"]]}
        }),{status:200,headers:{"content-type":"application/json"}});
      }
      throw new Error("unexpected provider request");
    };

    const health=await worker.fetch(new Request("https://market.voltextech.net/health"));
    assert.deepEqual(await health.json(),{ok:true,service:"voltex-market-edge",version:"futures-edge-direct-v6"});

    const book=await worker.fetch(new Request("https://market.voltextech.net/market/display/futures-book/BTCUSDT",{
      headers:{authorization:"Bearer must-not-forward",cookie:"session=must-not-forward"}
    }));
    const bookBody=await book.json();
    assert.equal(book.status,200);assert.equal(bookBody.source,"bybit");assert.equal(bookBody.bids.length,25);assert.equal(bookBody.asks.length,25);

    const trades=await worker.fetch(new Request("https://market.voltextech.net/market/display/futures-trades/BTCUSDT"));
    assert.equal((await trades.json()).source,"bybit");

    const tickers=await worker.fetch(new Request("https://market.voltextech.net/market/display/futures-tickers"));
    assert.equal((await tickers.json()).source,"bybit");

    const candles=await worker.fetch(new Request("https://market.voltextech.net/market/display/futures-candles/BTCUSDT?interval=60&limit=320"));
    assert.equal((await candles.json()).source,"bybit");
    assert.ok(seen.every(url=>!url.includes("voltextech.net")&&!url.includes("onrender.com")));

    // Both Bybit public hosts fail: fallback must be independent OKX public market data,
    // never Render/Neon and never private/authenticated traffic.
    const fallbackSeen=[];
    globalThis.fetch=async(url,options={})=>{
      fallbackSeen.push(String(url));
      assert.equal(options.headers?.authorization,undefined);
      assert.equal(options.headers?.cookie,undefined);
      const u=new URL(url);
      if(u.hostname==="api.bybit.com"||u.hostname==="api.bytick.com")return new Response("blocked",{status:403});
      assert.equal(u.hostname,"www.okx.com");
      if(u.pathname.endsWith("/market/books"))return new Response(JSON.stringify({
        code:"0",data:[{ts:"1790150000400",bids:makeBook().slice(0,25),asks:makeAsks().slice(0,25)}]
      }),{status:200,headers:{"content-type":"application/json"}});
      if(u.pathname.endsWith("/market/trades"))return new Response(JSON.stringify({
        code:"0",data:[{instId:"BTC-USDT-SWAP",tradeId:"77",px:"100.7",sz:"0.3",side:"buy",ts:"1790150000500"}]
      }),{status:200,headers:{"content-type":"application/json"}});
      if(u.pathname.endsWith("/market/tickers"))return new Response(JSON.stringify({
        code:"0",data:[{instType:"SWAP",instId:"BTC-USDT-SWAP",last:"100.8",bidPx:"100.7",askPx:"100.9",open24h:"99",high24h:"102",low24h:"98",ts:"1790150000600"}]
      }),{status:200,headers:{"content-type":"application/json"}});
      if(u.pathname.endsWith("/market/candles"))return new Response(JSON.stringify({
        code:"0",data:[["1790146800000","100","102","99","101","1234","0","0","1"]]
      }),{status:200,headers:{"content-type":"application/json"}});
      throw new Error("unexpected OKX fallback request");
    };

    const fallbackBook=await worker.fetch(new Request("https://market.voltextech.net/market/display/futures-book/BTCUSDT?fallback=okx"));
    const fallbackBookBody=await fallbackBook.json();
    assert.equal(fallbackBook.status,200);assert.equal(fallbackBookBody.source,"okx");assert.equal(fallbackBookBody.updateId,1790150000400);

    const fallbackTrades=await worker.fetch(new Request("https://market.voltextech.net/market/display/futures-trades/BTCUSDT?fallback=okx"));
    const fallbackTradesBody=await fallbackTrades.json();
    assert.equal(fallbackTrades.status,200);assert.equal(fallbackTradesBody.source,"okx");assert.equal(fallbackTradesBody.trades[0].id,"okx:77");

    const fallbackTickers=await worker.fetch(new Request("https://market.voltextech.net/market/display/futures-tickers?fallback=okx"));
    const fallbackTickerBody=await fallbackTickers.json();
    assert.equal(fallbackTickers.status,200);assert.equal(fallbackTickerBody.source,"okx");assert.equal(fallbackTickerBody.result.list[0].symbol,"BTCUSDT");

    const fallbackCandles=await worker.fetch(new Request("https://market.voltextech.net/market/display/futures-candles/BTCUSDT?interval=60&limit=320&fallback=okx"));
    const fallbackCandleBody=await fallbackCandles.json();
    assert.equal(fallbackCandles.status,200);assert.equal(fallbackCandleBody.source,"okx");assert.equal(fallbackCandleBody.result.symbol,"BTCUSDT");

    assert.ok(fallbackSeen.some(url=>url.includes("www.okx.com")));
    assert.ok(fallbackSeen.every(url=>!url.includes("api.voltextech.net")&&!url.includes("onrender.com")));

    const badMethod=await worker.fetch(new Request("https://market.voltextech.net/health",{method:"POST"}));
    assert.equal(badMethod.status,405);
    const badPath=await worker.fetch(new Request("https://market.voltextech.net/private/orders"));
    assert.equal(badPath.status,404);

    console.log("market-edge worker tests passed");
  }finally{
    globalThis.fetch=originalFetch;
    if(originalCaches!==undefined)globalThis.caches=originalCaches;
  }
}
run().catch(error=>{console.error(error);process.exit(1);});
