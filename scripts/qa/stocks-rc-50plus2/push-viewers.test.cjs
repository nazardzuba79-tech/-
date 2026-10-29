'use strict';
const {test}=require('node:test'), assert=require('node:assert/strict'), http=require('node:http');
const {openPushViewers}=require('./push-viewers.cjs');
const instrument='BYBIT:AAPLXUSDT';
const info=origin=>({stocksOrigin:origin,viewerTokens:Array.from({length:50},(_,i)=>'test-only-'+i),instruments:[instrument]});
async function fake(t,{event='quote',invalid=false,refuse=false}={}){
 const seen=[],live=new Set(),server=http.createServer((req,res)=>{
   const u=new URL(req.url,'http://localhost');
   seen.push({path:u.pathname,search:u.search,token:req.headers.authorization});
   if(refuse){res.writeHead(503,{'content-type':'application/json'});res.end('{"error":"SOURCE_BUSY"}');return;}
   res.writeHead(200,{'content-type':'text/event-stream','cache-control':'no-store'});
   let n=0;
   const send=()=>{
     if(res.destroyed)return;
     const at=Date.now(),id=invalid?'SPOOFED:ANOTHER':instrument;
     const body=event==='quote'?{instrumentId:id,seq:++n,serverTime:at,
       quote:{instrumentId:id,timestamp:at,receivedAt:at,prices:{USDT:{buy:'10',sell:'10'}},status:{USDT:'READY'},
         ...(invalid?{account:{balance:'999'}}:{})}}:{seq:++n,retryAfterMs:1200};
     res.write('event: '+event+'\ndata: '+JSON.stringify(body)+'\n\n');
   };
   send();const timer=setInterval(send,30);
   live.add(res);res.once('close',()=>{clearInterval(timer);live.delete(res);});
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 t.after(()=>{server.closeAllConnections();server.close();});
 return {origin:'http://127.0.0.1:'+server.address().port,seen,live};
}
test('50 header-only public push connections, one stream per viewer, no polling, bounded cleanup',async t=>{
 const server=await fake(t),viewers=await openPushViewers(info(server.origin),{timeoutMs:2500});
 const s=viewers.snapshot();
 assert.equal(s.opened,50);assert.equal(s.viewers,50);assert.ok(s.quotes>=50);assert.equal(s.errors.length,0);
 assert.equal(s.staleViewers,0);assert.ok(s.quoteAgeP95Ms>=0);
 assert.equal(server.seen.length,50);assert.ok(server.seen.every((x,i)=>x.path==='/__stocks_global/stream'&&x.search==='?id='+encodeURIComponent(instrument)&&x.token.startsWith('Bearer test-only-')));
 assert.ok(server.seen.every(x=>!x.search.includes('test-only')&&!x.search.includes('Bearer')));
 await viewers.close();
 assert.equal(server.live.size,0);
});
test('incorrect public quote identity fails closed before a usable stream',async t=>{
 const server=await fake(t,{invalid:true});
 await assert.rejects(openPushViewers(info(server.origin),{timeoutMs:1500}),/PUSH_QUOTE_IDENTITY_INVALID/);
});
test('rate-limited stream cannot be called a fully delivered push fixture',async t=>{
 const server=await fake(t,{refuse:true});
 await assert.rejects(openPushViewers(info(server.origin),{timeoutMs:1500}),/PUSH_HTTP_503/);
});
test('wait-only stream without any real price cannot be credited as a viewer quote',async t=>{
 const server=await fake(t,{event:'wait'});
 await assert.rejects(openPushViewers(info(server.origin),{timeoutMs:150}),/PUSH_FIRST_QUOTE_TIMEOUT/);
});
