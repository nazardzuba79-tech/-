import assert from "node:assert/strict";
import worker from "./src/index.js";

const makeBook=()=>Array.from({length:50},(_,i)=>[String(100-i/100),String(i+1)]);
const makeAsks=()=>Array.from({length:50},(_,i)=>[String(101+i/100),String(i+1)]);
const jsonResponse=body=>new Response(JSON.stringify(body),{status:200,headers:{"content-type":"application/json"}});

async function run(){
  const originalFetch=globalThis.fetch, originalCaches=globalThis.caches, originalWebSocket=globalThis.WebSocket;
  delete globalThis.caches;
  try{
    const seen=[];
    globalThis.fetch=async(url,options={})=>{
      seen.push(String(url));
      assert.equal(options.headers?.authorization,undefined);
      assert.equal(options.headers?.cookie,undefined);
      const u=new URL(url);
      if(u.hostname==="api.bybit.com"||u.hostname==="api.bytick.com"){
        if(u.pathname.includes("orderbook"))return jsonResponse({retCode:0,time:1790150000000,result:{s:"BTCUSDT",u:12345,b:makeBook(),a:makeAsks()}});
        if(u.pathname.includes("recent-trade"))return jsonResponse({retCode:0,result:{category:"linear",list:[{symbol:"BTCUSDT",execId:"t1",price:"100.5",size:"0.25",time:"1790150000123",side:"Buy"}]}});
        if(u.pathname.includes("tickers"))return jsonResponse({retCode:0,time:1790150000200,result:{category:"linear",list:[{symbol:"BTCUSDT",lastPrice:"100.5",bid1Price:"100.4",ask1Price:"100.6",price24hPcnt:"0.0123"}]}});
        if(u.pathname.includes("kline"))return jsonResponse({retCode:0,time:1790150000300,result:{category:"linear",symbol:"BTCUSDT",list:[["1790146800000","100","102","99","101","1234"]]}});
      }
      throw new Error("unexpected provider request");
    };

    const health=await worker.fetch(new Request("https://market.voltextech.net/health"));
    assert.deepEqual(await health.json(),{ok:true,service:"voltex-market-edge",version:"public-display-edge-v9"});

    const book=await worker.fetch(new Request("https://market.voltextech.net/market/display/futures-book/BTCUSDT",{headers:{authorization:"Bearer must-not-forward",cookie:"session=must-not-forward"}}));
    const bookBody=await book.json();assert.equal(book.status,200);assert.equal(bookBody.source,"bybit");assert.equal(bookBody.bids.length,25);assert.equal(bookBody.asks.length,25);
    assert.equal((await (await worker.fetch(new Request("https://market.voltextech.net/market/display/futures-trades/BTCUSDT"))).json()).source,"bybit");
    assert.equal((await (await worker.fetch(new Request("https://market.voltextech.net/market/display/futures-tickers"))).json()).source,"bybit");
    assert.equal((await (await worker.fetch(new Request("https://market.voltextech.net/market/display/futures-candles/BTCUSDT?interval=60&limit=320"))).json()).source,"bybit");
    assert.ok(seen.every(url=>!url.includes("voltextech.net")&&!url.includes("onrender.com")));

    const fallbackSeen=[];
    globalThis.fetch=async(url,options={})=>{
      fallbackSeen.push(String(url));
      assert.equal(options.headers?.authorization,undefined);assert.equal(options.headers?.cookie,undefined);
      const u=new URL(url);
      if(u.hostname==="api.bybit.com"||u.hostname==="api.bytick.com")return new Response("blocked",{status:403});
      assert.equal(u.hostname,"www.okx.com");
      if(u.pathname.endsWith("/market/books"))return jsonResponse({code:"0",data:[{ts:"1790150000400",bids:makeBook().slice(0,25),asks:makeAsks().slice(0,25)}]});
      if(u.pathname.endsWith("/market/trades"))return jsonResponse({code:"0",data:[{instId:"BTC-USDT-SWAP",tradeId:"77",px:"100.7",sz:"0.3",side:"buy",ts:"1790150000500"}]});
      if(u.pathname.endsWith("/market/tickers"))return jsonResponse({code:"0",data:[{instType:"SWAP",instId:"BTC-USDT-SWAP",last:"100.8",bidPx:"100.7",askPx:"100.9",open24h:"99",high24h:"102",low24h:"98",ts:"1790150000600"}]});
      if(u.pathname.endsWith("/market/candles"))return jsonResponse({code:"0",data:[["1790146800000","100","102","99","101","1234","0","0","1"]]});
      throw new Error("unexpected OKX fallback request");
    };
    const fb=await (await worker.fetch(new Request("https://market.voltextech.net/market/display/futures-book/BTCUSDT?fallback=okx"))).json();
    assert.equal(fb.source,"okx");assert.equal(fb.updateId,1790150000400);
    assert.equal((await (await worker.fetch(new Request("https://market.voltextech.net/market/display/futures-trades/BTCUSDT?fallback=okx"))).json()).source,"okx");
    assert.equal((await (await worker.fetch(new Request("https://market.voltextech.net/market/display/futures-tickers?fallback=okx"))).json()).source,"okx");
    assert.equal((await (await worker.fetch(new Request("https://market.voltextech.net/market/display/futures-candles/BTCUSDT?interval=60&limit=320&fallback=okx"))).json()).source,"okx");
    assert.ok(fallbackSeen.every(url=>!url.includes("api.voltextech.net")&&!url.includes("onrender.com")));

    const wsSeen=[];
    class FakeWebSocket{
      constructor(url){this.url=url;this.readyState=0;this.listeners={};wsSeen.push(String(url));queueMicrotask(()=>{this.readyState=1;this.emit("open",{});});}
      addEventListener(type,listener){(this.listeners[type]??=[]).push(listener);}
      emit(type,event){for(const listener of this.listeners[type]??[])listener(event);}
      send(text){
        const request=JSON.parse(text),supported=new Set(["frxXAGUSD","frxXPTUSD","frxUSDJPY","frxAUDUSD"]);
        if(!supported.has(request.ticks))return;
        queueMicrotask(()=>this.emit("message",{data:JSON.stringify({msg_type:"tick",tick:{symbol:request.ticks,quote:request.ticks==="frxXAGUSD"?64.5:request.ticks==="frxXPTUSD"?1800:request.ticks==="frxUSDJPY"?150.1:0.66,epoch:Math.floor(Date.now()/1000)}})}));
      }
      close(){if(this.readyState>=2)return;this.readyState=3;queueMicrotask(()=>this.emit("close",{}));}
    }
    globalThis.WebSocket=FakeWebSocket;

    const publicSeen=[];
    globalThis.fetch=async(url,options={})=>{
      publicSeen.push(String(url));
      assert.equal(options.headers?.authorization,undefined);assert.equal(options.headers?.cookie,undefined);
      const u=new URL(url);
      if(u.hostname==="api.kraken.com"&&u.pathname.endsWith("/Depth")){
        return jsonResponse({error:[],result:{XBTUSDT:{bids:[["100","1","1790150000.1"]],asks:[["101","2","1790150000.2"]]}}});
      }
      if(u.hostname==="api.kraken.com"&&u.pathname.endsWith("/OHLC")){
        return jsonResponse({error:[],result:{XBTUSDT:[[1790146800,"100","102","99","101","100.5","1234",12],[1790150400,"101","103","100","102","102","1500",14]],last:1790150400}});
      }
      if(u.hostname==="api.bybit.com"||u.hostname==="api.bytick.com"){
        const category=u.searchParams.get("category");
        if(u.pathname.includes("tickers")&&category==="spot")return jsonResponse({retCode:0,time:1790150000700,result:{category:"spot",list:[{symbol:"BTCUSDT",lastPrice:"100.5",bid1Price:"100.4",ask1Price:"100.6",highPrice24h:"103",lowPrice24h:"98",volume24h:"1000",turnover24h:"100500",price24hPcnt:"0.01"}]}});
        if(u.pathname.includes("tickers")&&category==="linear")return jsonResponse({retCode:0,time:1790150000700,result:{category:"linear",list:[{symbol:"BTCUSDT",lastPrice:"100.5",bid1Price:"100.4",ask1Price:"100.6",price24hPcnt:"0.01"}]}});
        if(u.pathname.includes("recent-trade")&&category==="spot")return jsonResponse({retCode:0,result:{category:"spot",list:[{symbol:"BTCUSDT",execId:"spot-t1",price:"100.5",size:"0.2",time:"1790150000800",side:"Buy"}]}});
      }
      if(u.hostname==="biquote.io"&&u.pathname==="/api/latest"){
        const payload={},available=new Set(["XAUUSD","XPDUSD","EURUSD","GBPUSD","USDCAD"]);
        for(const symbol of u.searchParams.getAll("symbols"))if(available.has(symbol))payload[symbol]={symbol,mid:symbol==="XAUUSD"?"4305.20":"100.25",timestamp:new Date().toISOString(),dayDiffPercent:1.25,marketState:"open",stale:false};
        return jsonResponse(payload);
      }
      if(u.hostname==="www.eia.gov"&&u.pathname.includes("/dnav/pet/hist/")){
        const wti=u.pathname.endsWith("RWTCD.htm"),title=wti?"Cushing, OK WTI Spot Price FOB":"Europe Brent Spot Price FOB";
        const values=wti?["90.10","90.20","90.30","90.40","90.50"]:["95.10","95.20","95.30","95.40","95.50"];
        return new Response(`<html><h1>${title}</h1><p>Dollars per Barrel</p><table><tr><td>2026 Sep-21 to Sep-25</td>${values.map(v=>`<td>${v}</td>`).join("")}</tr></table></html>`,{status:200,headers:{"content-type":"text/html"}});
      }
      if(u.hostname==="api.frankfurter.dev"&&u.pathname==="/v2/rates"){
        return jsonResponse([
          {date:"2026-09-24",base:"USD",quote:"CHF",rate:0.8},
          {date:"2026-09-24",base:"USD",quote:"NZD",rate:1.7}
        ]);
      }
      if(u.hostname==="biquote.io"&&u.pathname.endsWith("/ohlc")){
        const provider=decodeURIComponent(u.pathname.split("/")[2]);
        const interval=u.searchParams.get("interval");
        return jsonResponse({symbol:provider,interval,bars:[
          {openTime:"2026-09-23T12:00:00Z",open:"100",high:"102",low:"99",close:"101",volume:"10"},
          {openTime:"2026-09-23T13:00:00Z",open:"101",high:"103",low:"100",close:"102",volume:"11"}
        ]});
      }
      throw new Error(`unexpected public route provider ${u.hostname}${u.pathname}`);
    };

    const spotBook=await (await worker.fetch(new Request("https://market.voltextech.net/market/display/spot-book/BTC-USDT?case=spot"))).json();
    assert.equal(spotBook.source,"kraken");assert.equal(spotBook.pair,"BTC/USDT");assert.equal(spotBook.bids[0].price,"100");
    const spotCandles=await (await worker.fetch(new Request("https://market.voltextech.net/market/display/spot-candles/BTC-USDT?interval=15m&limit=48&case=spot"))).json();
    assert.equal(spotCandles.source,"kraken");assert.equal(spotCandles.candles.length,2);
    const spotTrades=await (await worker.fetch(new Request("https://market.voltextech.net/market/display/spot-trades/BTC-USDT?case=spot"))).json();
    assert.equal(spotTrades.source,"bybit");assert.equal(spotTrades.trades[0].id,"spot-t1");
    const spotTickers=await (await worker.fetch(new Request("https://market.voltextech.net/market/display/spot-tickers?case=spot"))).json();
    assert.equal(spotTickers.tickers[0].pair,"BTC/USDT");
    const marketResponse=await worker.fetch(new Request("https://market.voltextech.net/market/display?case=home"));
    assert.match(marketResponse.headers.get("cache-control")||"",/max-age=21600/);
    const market=await marketResponse.json();
    assert.equal(market.type,"snapshot");assert.ok(market.rows.some(row=>row.marketType==="spot"));assert.ok(market.rows.some(row=>row.marketType==="linear_perpetual"));
    const cfdResponse=await worker.fetch(new Request("https://market.voltextech.net/cfd/display/tickers?case=cfd"));
    assert.match(cfdResponse.headers.get("cache-control")||"",/max-age=21600/);
    const cfd=await cfdResponse.json();
    assert.equal(cfd.configured,true);assert.equal(cfd.source,"cloudflare-cfd-multisource");assert.equal(cfd.tickers.length,13);
    assert.ok(cfd.tickers.every(row=>row.displayOnly===true&&row.executionAllowed===false));
    assert.ok(cfd.tickers.every(row=>row.price!==null));
    assert.deepEqual(new Set(cfd.sources),new Set(["biquote","deriv","eia","frankfurter"]));
    assert.equal(cfd.tickers.find(row=>row.symbol==="XAUUSD").provider,"biquote");
    assert.equal(cfd.tickers.find(row=>row.symbol==="XAGUSD").provider,"deriv");
    assert.equal(cfd.tickers.find(row=>row.symbol==="WTIUSD").provider,"eia");
    assert.equal(cfd.tickers.find(row=>row.symbol==="USDCHF").provider,"frankfurter");
    assert.ok(wsSeen.some(url=>url==="wss://api.derivws.com/trading/v1/options/ws/public"));
    assert.equal(cfd._display?.mode,"snapshot");assert.equal(cfd._display?.refreshMs,6*60*60*1000);assert.ok(Number.isFinite(cfd._display?.capturedAt));
    const cfdBarsResponse=await worker.fetch(new Request("https://market.voltextech.net/cfd/display/candles/XAUUSD?interval=1h&limit=50&case=cfd"));
    assert.match(cfdBarsResponse.headers.get("cache-control")||"",/max-age=21600/);
    const cfdBars=await cfdBarsResponse.json();
    assert.equal(cfdBars.symbol,"XAUUSD");assert.equal(cfdBars.bars.length,2);
    assert.equal(cfdBars._display?.mode,"snapshot");assert.equal(cfdBars._display?.refreshMs,6*60*60*1000);assert.ok(Number.isFinite(cfdBars._display?.capturedAt));
    assert.ok(publicSeen.every(url=>!url.includes("api.voltextech.net")&&!url.includes("onrender.com")));
    assert.ok(publicSeen.some(url=>url.includes("api.kraken.com")));
    assert.ok(publicSeen.some(url=>url.includes("biquote.io")));
    assert.ok(publicSeen.some(url=>url.includes("www.eia.gov")));
    assert.ok(publicSeen.some(url=>url.includes("api.frankfurter.dev")));

    assert.equal((await worker.fetch(new Request("https://market.voltextech.net/health",{method:"POST"}))).status,405);
    assert.equal((await worker.fetch(new Request("https://market.voltextech.net/private/orders"))).status,404);
    console.log("market-edge worker tests passed");
  }finally{
    globalThis.fetch=originalFetch;if(originalCaches!==undefined)globalThis.caches=originalCaches;
    if(originalWebSocket===undefined)delete globalThis.WebSocket;else globalThis.WebSocket=originalWebSocket;
  }
}
run().catch(error=>{console.error(error);process.exit(1);});
