// Source-only adapter for a same-host TLS reverse proxy. Never a public listener.
import http from 'node:http';
import { check } from './engine.mjs';

const routes = new Map([
  ['catalogue',['GET']], ['state',['GET']], ['portfolio',['GET']],
  ['history',['GET']], ['lease',['DELETE']], ['orders',['POST']],
  ['cancel',['POST']], ['refresh',['POST']],
]);
export function publicOrigin(value) {
  let url; try { url = new URL(value); } catch { check(false,'HOSTED_ORIGIN_INVALID'); }
  check(url.protocol === 'https:' && !url.username && !url.password &&
    url.pathname === '/' && !url.search && !url.hash && value === url.origin,
  'HOSTED_ORIGIN_INVALID');
  return url;
}
export function validateHostedRequest(req, origin) {
  check(['127.0.0.1','::ffff:127.0.0.1','::1'].includes(req.socket.remoteAddress),'HOST_FORBIDDEN');
  check(req.headers.host === origin.host,'HOST_FORBIDDEN');
  check(req.url.length <= 8192 && req.url.startsWith('/__stocks_global/') &&
    !req.url.includes('\\') && !req.url.includes('#'),'ROUTE_NOT_FOUND');
  const url = new URL(req.url,origin);
  check(url.pathname===req.url.split('?')[0],'ROUTE_NOT_FOUND');
  const route = url.pathname.slice('/__stocks_global/'.length);
  check(routes.get(route)?.includes(req.method),'ROUTE_NOT_FOUND');
  check(!req.headers.origin || req.headers.origin === origin.origin,'ORIGIN_FORBIDDEN');
  check(!req.headers['sec-fetch-site'] || ['same-origin','none'].includes(req.headers['sec-fetch-site']),'ORIGIN_FORBIDDEN');
  if (req.method !== 'GET') check(req.headers.origin === origin.origin,'ORIGIN_FORBIDDEN');
  check(!Object.keys(req.headers).some(key=>key.startsWith('x-forwarded-') || key==='forwarded'),'HOST_FORBIDDEN');
  return url.pathname + url.search;
}
export async function createHostedIngress({ origin, gatewayPort, port = 4438, transport }) {
  const publicUrl = publicOrigin(origin);
  check(Number.isInteger(gatewayPort)&&gatewayPort>0&&gatewayPort<=65535,'HOSTED_PORT_INVALID');
  check(Number.isInteger(port)&&port>=0&&port<=65535&&port!==gatewayPort,'HOSTED_PORT_INVALID');
  check(transport===undefined||typeof transport==='function','HOSTED_ORIGIN_INVALID');
  const agent = new http.Agent({keepAlive:true,maxSockets:80,maxFreeSockets:8});
  let inflight=0;
  const server = http.createServer(async(req,res)=>{
    // Preserve the existing 80-request ceiling; do not queue indefinitely
    // inside Agent before the gateway gets a chance to apply admission.
    if(inflight>=80){
      res.writeHead(503,{'content-type':'application/json','cache-control':'no-store','retry-after':'1'});
      res.end('{"error":"ACCOUNT_BUSY","retryAfterMs":1000}');return;
    }
    inflight++;res.once('close',()=>inflight--);
    let upstream;
    try {
      // The optional signed Pages transport authenticates the API-host hop,
      // not the user. Direct same-host review keeps the existing early checks.
      check(['127.0.0.1','::ffff:127.0.0.1','::1'].includes(req.socket.remoteAddress),'HOST_FORBIDDEN');
      let path=transport?undefined:validateHostedRequest(req,publicUrl);const chunks=[];let size=0;
      for await(const chunk of req){size+=chunk.length;check(size<=16384,'REQUEST_TOO_LARGE');chunks.push(chunk);}
      const body=Buffer.concat(chunks);
      if(transport){await transport(req,body);path=validateHostedRequest(req,publicUrl);}
      // Only the browser's normal JWT and the existing per-view/CSRF fences
      // cross this boundary. Never accept authority credentials from a browser.
      const headers={host:'127.0.0.1:'+gatewayPort,origin:'http://127.0.0.1:'+gatewayPort};
      for(const key of ['authorization','content-type','x-stocks-token','x-stocks-view'])
        if(typeof req.headers[key]==='string')headers[key]=req.headers[key];
      headers['content-length']=String(body.length);
      upstream=http.request({host:'127.0.0.1',port:gatewayPort,path,method:req.method,headers,agent},response=>{
        res.writeHead(response.statusCode,{'content-type':'application/json','cache-control':'no-store','x-content-type-options':'nosniff'});
        response.on('error',()=>res.destroy());response.pipe(res);
      });
      upstream.setTimeout(15000,()=>upstream.destroy(Error('GATEWAY_TIMEOUT')));
      upstream.on('error',()=>{if(!res.headersSent)res.writeHead(503,{'content-type':'application/json','cache-control':'no-store'}).end('{"error":"STOCKS_UNAVAILABLE"}');else res.destroy();});
      res.on('close',()=>{if(!res.writableFinished)upstream.destroy();});
      upstream.end(body);
    }catch(error){
      upstream?.destroy();
      const busy=error.code==='ACCOUNT_BUSY';
      res.writeHead(busy?503:error.code==='ROUTE_NOT_FOUND'?404:403,{'content-type':'application/json','cache-control':'no-store',...(busy?{'retry-after':'1'}:{})});
      res.end(JSON.stringify({error:['HOST_FORBIDDEN','ORIGIN_FORBIDDEN','ROUTE_NOT_FOUND','REQUEST_TOO_LARGE','ACCOUNT_BUSY'].includes(error.code)?error.code:'REQUEST_REJECTED',...(busy?{retryAfterMs:1000}:{})}));
    }
  });
  server.keepAliveTimeout=5000;server.requestTimeout=15000;server.headersTimeout=10000;
  await new Promise((ok,fail)=>{server.once('error',fail);server.listen(port,'127.0.0.1',ok);});
  return {server,port:server.address().port,async close(){server.closeIdleConnections();agent.destroy();await new Promise(resolve=>server.close(resolve));}};
}
