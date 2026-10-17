// Loopback protocol fixture, never imported by the application entry point.
import http from 'node:http';
import { WebSocketServer } from 'ws';
import { CATALOG } from '../catalog.mjs';
import { nativeHistoryFixture } from '../../stocks/realistic-provider-fixture.mjs';
export async function syntheticPublicMarket(){
  const starts=[],controls=[],sockets=new Set();let sequence=0,emission=true;
  const ticker=i=>({symbol:i.sourceSymbol,lastPrice:'100',price24hPcnt:'0.0125',priceChangePercent:'1.25',volume24h:'20',volume:'20',closeTime:Date.now()});
  const server=http.createServer(async(req,res)=>{try{
    const u=new URL(new URL(req.url,'http://127.0.0.1').searchParams.get('target')),provider=u.hostname==='api.bybit.com'?'bybit':'binance',symbol=u.searchParams.get('symbol'),i=CATALOG.find(i=>i.sourceSymbol===symbol&&i.provider===provider),now=Date.now();let kind,body;
    if(u.pathname==='/v5/market/instruments-info'){kind='metadata';body={retCode:0,result:{list:CATALOG.filter(i=>i.provider==='bybit').map(i=>({symbol:i.sourceSymbol,status:'Trading',xstockMultiplier:'1.01'}))}};}
    else if(u.pathname==='/api/v3/exchangeInfo'){kind='metadata';body={symbols:CATALOG.filter(i=>i.provider==='binance').map(i=>({symbol:i.sourceSymbol,status:'TRADING'}))};}
    else if(u.hostname==='iss.moex.com'){kind='metadata';body={securities:{columns:['SECID','STATUS'],data:[]}};}
    else if(u.pathname==='/v5/market/tickers'||u.pathname==='/api/v3/ticker/24hr'){kind=symbol?'single-ticker':'batch-ticker';const rows=CATALOG.filter(i=>i.provider===provider&&(!symbol||symbol===i.sourceSymbol)).map(ticker);body=provider==='bybit'?{retCode:0,time:now,result:{list:rows}}:symbol?ticker(i):rows;}
    else if(u.pathname==='/v5/market/orderbook'&&i){kind='native';body={retCode:0,result:{s:symbol,ts:now,cts:now,u:++sequence,b:[['100','2']],a:[['100','2']]}};}
    else if(u.pathname==='/api/v3/trades'&&(i||symbol==='USDCUSDT')){kind=i?'native':'fx';body=[{id:++sequence,time:now,price:i?'100':'0.9982'}];}
    else if(i&&['/v5/market/kline','/api/v3/klines'].includes(u.pathname)){kind='history';body=nativeHistoryFixture(u,now);}
    else throw Error('SYNTHETIC_TRANSPORT_DENIED');
    starts.push({at:now,host:u.hostname,kind,symbol});res.setHeader('Content-Type','application/json');res.end(JSON.stringify(body));
  }catch(error){res.writeHead(400);res.end(JSON.stringify({error:String(error)}));}});
  const ws=new WebSocketServer({server,path:'/stream',maxPayload:65536});
  ws.on('connection',socket=>{sockets.add(socket);socket.symbols=new Set();socket.on('close',()=>sockets.delete(socket));socket.on('message',bytes=>{const row=JSON.parse(bytes);if(!['SUBSCRIBE','UNSUBSCRIBE'].includes(row.method)||!Array.isArray(row.params)||row.params.length>13){socket.terminate();return;}controls.push({at:Date.now(),method:row.method,count:row.params.length});for(const stream of row.params){if(!/^[a-z0-9]+@trade$/.test(stream)){socket.terminate();return;}if(row.method==='SUBSCRIBE')socket.symbols.add(stream);else socket.symbols.delete(stream);}socket.send(JSON.stringify({result:null,id:row.id}));});});
  const tick=setInterval(()=>{if(!emission)return;const now=Date.now();for(const socket of sockets)if(socket.readyState===1)for(const stream of socket.symbols){socket.send(JSON.stringify({stream,data:{e:'trade',E:now,s:stream.split('@')[0].toUpperCase(),t:++sequence,p:'100',q:'1',T:now,m:false,M:true}}));}},100);
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const origin='http://127.0.0.1:'+server.address().port;
  return{origin,wsUrl:origin.replace('http:','ws:')+'/stream',starts,controls,setEmission:value=>emission=value,disconnect:()=>{for(const s of sockets)s.terminate();},broadcast:(symbol,id,time=Date.now())=>{sequence=Math.max(sequence,id);for(const s of sockets)if(s.readyState===1)s.send(JSON.stringify({stream:symbol.toLowerCase()+'@trade',data:{e:'trade',E:time,s:symbol,t:id,p:'100',q:'1',T:time,m:false,M:true}}));},snapshot:()=>({starts:[...starts],controls:[...controls],connections:sockets.size}),async close(){clearInterval(tick);for(const socket of sockets)socket.terminate();await new Promise(r=>ws.close(r));server.closeAllConnections();await new Promise(r=>server.close(r));}};
}
export function loopbackFetch(origin){const u=new URL(origin);if(u.protocol!=='http:'||u.hostname!=='127.0.0.1')throw Error('LOOPBACK_ONLY');return(address,options)=>fetch(origin+'/?target='+encodeURIComponent(address),options);}
