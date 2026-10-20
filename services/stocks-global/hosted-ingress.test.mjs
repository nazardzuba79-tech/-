import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createHostedIngress, publicOrigin, validateHostedRequest } from './hosted-ingress.mjs';
import { createReleaseMarket } from './release-market.mjs';

const origin=publicOrigin('https://stocks-pilot.example');
const request=(changes={})=>({method:'GET',url:'/__stocks_global/catalogue',headers:{host:origin.host},socket:{remoteAddress:'127.0.0.1'},...changes});
test('hosted boundary rejects foreign peer/host/origin, forwarded spoofing and non-allowlisted routes',()=>{
  assert.equal(validateHostedRequest(request(),origin),'/__stocks_global/catalogue');
  for(const change of [
    {socket:{remoteAddress:'192.0.2.1'}},{headers:{host:'evil.example'}},
    {headers:{host:origin.host,origin:'https://evil.example'}},
    {headers:{host:origin.host,'x-forwarded-host':origin.host}},
    {headers:{host:origin.host,'sec-fetch-site':'cross-site'}},
    {method:'POST',url:'/__stocks_global/orders'},
    {url:'/__stocks_global/../api/v1/me'},{url:'/__stocks_global/%63atalogue'},
    {url:'/__stocks_global/balances',method:'POST'},{url:'/__stocks_global/health'},
  ])assert.throws(()=>validateHostedRequest(request(change),origin));
  for(const value of ['http://example.com','https://u:p@example.com','https://example.com/extra','https://example.com/','https://example.com?x=1'])
    assert.throws(()=>publicOrigin(value));
});
test('actual loopback proxy forwards normal bearer and CSRF but strips authority/forwarded credentials',async t=>{
  let received;
  const backend=http.createServer((req,res)=>{received={headers:req.headers,path:req.url};res.end('{"ok":true}');});
  await new Promise(resolve=>backend.listen(0,'127.0.0.1',resolve));
  t.after(()=>new Promise(resolve=>backend.close(resolve)));
  const ingress=await createHostedIngress({origin:origin.origin,gatewayPort:backend.address().port,port:0});
  t.after(()=>ingress.close());
  const result=await new Promise((resolve,reject)=>{
    const r=http.request({host:'127.0.0.1',port:ingress.port,path:'/__stocks_global/orders',method:'POST',
      headers:{host:origin.host,origin:origin.origin,authorization:'Bearer test-session','x-stocks-token':'csrf','x-stocks-authority-key':'forged',cookie:'secret=bad','content-type':'application/json'}},
    res=>{res.resume();res.on('end',()=>resolve(res.statusCode));});r.on('error',reject);r.end('{}');
  });
  assert.equal(result,200);assert.equal(received.headers.authorization,'Bearer test-session');
  assert.equal(received.headers['x-stocks-token'],'csrf');
  assert.equal(received.headers.host,'127.0.0.1:'+backend.address().port);
  assert.equal(received.headers.origin,'http://127.0.0.1:'+backend.address().port);
  assert.equal(received.headers['x-stocks-authority-key'],undefined);assert.equal(received.headers.cookie,undefined);
  assert.equal(ingress.server.address().address,'127.0.0.1');assert.equal(ingress.server.keepAliveTimeout,5000);
});
test('default release market returns unavailable catalogue and never fabricated quotes or candles',async()=>{
  const market=createReleaseMarket({});
  const rows=await market.catalogue();
  assert.ok(rows.length>0);assert.ok(rows.every(row=>!row.online&&row.display===null));
  await assert.rejects(market.quote('BYBIT:AAPLXUSDT'),/SOURCE_UNAVAILABLE/);
  await assert.rejects(market.history('BYBIT:AAPLXUSDT'),/SOURCE_UNAVAILABLE/);
  assert.equal(market.quoteValid({timestamp:Date.now()}),false);
  assert.throws(()=>createReleaseMarket({STOCKS_BINANCE_WS_ENABLED:'true'}),/CONFIG_INVALID/);
});
