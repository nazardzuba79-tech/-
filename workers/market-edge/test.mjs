import assert from "node:assert/strict";
import worker from "./src/index.js";

const bids=()=>Array.from({length:50},(_,i)=>[String(100-i/100),String(i+1)]);
const asks=()=>Array.from({length:50},(_,i)=>[String(101+i/100),String(i+1)]);

async function run(){
  const oldFetch=globalThis.fetch,oldCaches=globalThis.caches;delete globalThis.caches;
  const urls=[];
  try{
    globalThis.fetch=async(url,options={})=>{
      urls.push(String(url));assert.equal(options.headers?.authorization,undefined);assert.equal(options.headers?.cookie,undefined);
      const u=new URL(url);
      if(u.hostname==="biquote.io"){
        if(u.pathname==="/api/latest"){
          const row={bid:100,ask:101,mid:100.5,timestamp:"2026-09-23T12:00:00Z",marketState:"open",stale:false,dayDiffPercent:1.2};
          return new Response(JSON.stringify({XAUUSD:{...row,symbol:"XAUUSD"},XAGUSD:{...row,symbol:"XAGUSD"},XPTUSD:{...row,symbol:"XPTUSD"},XPDUSD:{...row,symbol:"XPDUSD"},USOIL:{...row,symbol:"USOIL"},UKOIL:{...row,symbol:"UKOIL"},EURUSD:{...row,symbol:"EURUSD"},GBPUSD:{...row,symbol:"GBPUSD"},USDJPY:{...row,symbol:"USDJPY"},AUDUSD:{...row,symbol:"AUDUSD"},USDCAD:{...row,symbol:"USDCAD"},USDCHF:{...row,symbol:"USDCHF"},NZDUSD:{...row,symbol:"NZDUSD"}}),{status:200});
        }
        if(u.pathname.includes("/ohlc"))return new Response(JSON.stringify({symbol:"XAUUSD",interval:"1h",bars:[
          {openTime:"2026-09-23T10:00:00Z",open:100,high:102,low:99,close:101,volume:10,isOpen:false},
          {openTime:"2026-09-23T11:00:00Z",open:101,high:103,low:100,close:102,volume:11,isOpen:true}
        ]}),{status:200});
      }
      assert.ok(["api.bybit.com","api.bytick.com"].includes(u.hostname));
      const category=u.searchParams.get("category");
      if(u.pathname.includes("orderbook"))return new Response(JSON.stringify({retCode:0,time:1790150000000,result:{s:"BTCUSDT",u:12345,b:bids(),a:asks()}}),{status:200});
      if(u.pathname.includes("recent-trade"))return new Response(JSON.stringify({retCode:0,result:{category,list:[{symbol:"BTCUSDT",execId:"t1",price:"100.5",size:"0.25",time:"1790150000123",side:"Buy"}]}}),{status:200});
      if(u.pathname.includes("tickers"))return new Response(JSON.stringify({retCode:0,time:1790150000200,result:{category,list:[{symbol:"BTCUSDT",lastPrice:"100.5",bid1Price:"100.4",ask1Price:"100.6",highPrice24h:"102",lowPrice24h:"99",volume24h:"123",turnover24h:"12345",price24hPcnt:"0.0123",indexPrice:"100.5",markPrice:"100.5",fundingRate:"0.0001",openInterest:"10",openInterestValue:"1000"}]}}),{status:200});
      if(u.pathname.includes("kline"))return new Response(JSON.stringify({retCode:0,time:1790150000300,result:{category,symbol:"BTCUSDT",list:[["1790146800000","100","102","99","101","1234"]]}}),{status:200});
      throw new Error("unexpected provider request");
    };

    const health=await worker.fetch(new Request("https://market.voltextech.net/health"));assert.equal(health.status,200);

    const futuresBook=await worker.fetch(new Request("https://market.voltextech.net/market/display/futures-book/BTCUSDT"));assert.equal(futuresBook.status,200);
    assert.equal((await futuresBook.json()).bids.length,25);

    const market=await worker.fetch(new Request("https://market.voltextech.net/market/display"));const marketBody=await market.json();
    assert.equal(market.status,200);assert.ok(marketBody.rows.some(r=>r.id==="spot:BTCUSDT"));assert.ok(marketBody.rows.some(r=>r.id==="linear_perpetual:BTCUSDT"));

    const spotBook=await worker.fetch(new Request("https://market.voltextech.net/market/display/spot-book/BTC-USDT"));assert.equal(spotBook.status,200);
    assert.equal((await spotBook.json()).pair,"BTC/USDT");

    const spotCandles=await worker.fetch(new Request("https://market.voltextech.net/market/display/spot-candles/BTC-USDT?interval=1h&limit=50"));assert.equal(spotCandles.status,200);
    assert.equal((await spotCandles.json()).candles.length,1);

    const spotTrades=await worker.fetch(new Request("https://market.voltextech.net/market/display/spot-trades/BTC-USDT"));assert.equal(spotTrades.status,200);
    assert.equal((await spotTrades.json()).trades[0].id,"t1");

    const homeTickers=await worker.fetch(new Request("https://market.voltextech.net/market/display/spot-tickers"));assert.equal(homeTickers.status,200);
    assert.equal((await homeTickers.json()).source,"bybit-edge");

    const cfd=await worker.fetch(new Request("https://market.voltextech.net/cfd/display/tickers"));assert.equal(cfd.status,200);
    assert.ok((await cfd.json()).tickers.some(r=>r.symbol==="XAUUSD"&&r.price==="100.5"));

    const cfdBars=await worker.fetch(new Request("https://market.voltextech.net/cfd/display/candles/XAUUSD?interval=1h&limit=20"));assert.equal(cfdBars.status,200);
    assert.equal((await cfdBars.json()).symbol,"XAUUSD");

    assert.ok(urls.every(url=>!url.includes("api.voltextech.net")&&!url.includes("onrender.com")));
    assert.equal((await worker.fetch(new Request("https://market.voltextech.net/private/orders"))).status,404);
    console.log("market-edge worker tests passed");
  }finally{globalThis.fetch=oldFetch;if(oldCaches!==undefined)globalThis.caches=oldCaches;}
}
run().catch(e=>{console.error(e);process.exit(1);});
