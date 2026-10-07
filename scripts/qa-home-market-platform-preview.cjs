#!/usr/bin/env node
/** Persistent local review preview. Real built UI, deterministic read-only
 * fixtures, no account/backend, and CSP blocks all nonlocal browser egress.
 * node scripts/qa-home-market-platform-preview.cjs [frontend/dist] [4198]
 */
const http=require('node:http');
const fs=require('node:fs');
const path=require('node:path');
const cp=require('node:child_process');
const {createFixture}=require('./qa-mobile-trade-fixture.cjs');
const root=path.resolve(__dirname,'..');
const dist=path.resolve(root,process.argv[2]||'frontend/dist');
const port=Number(process.argv[3]||4198), internalPort=port+1;
const oldFixture=cp.spawn(process.execPath,[path.join(__dirname,'qa-perf-harness.cjs'),'--port',String(internalPort),'--dist',dist],{cwd:root,stdio:['ignore','ignore','inherit'],windowsHide:true});
// These substitutions exist only in this offline preview transport. The built
// application on disk is unchanged; the hero's own logos are already local.
const localImages=`<script>(function(){const map=value=>typeof value==='string'&&/^https?:/.test(value)?'/__hero-fixture-image?source='+encodeURIComponent(value):value;const set=Element.prototype.setAttribute;Element.prototype.setAttribute=function(name,value){return set.call(this,name,this.tagName==='IMG'&&name.toLowerCase()==='src'?map(value):value)};const original=Object.getOwnPropertyDescriptor(HTMLImageElement.prototype,'src');Object.defineProperty(HTMLImageElement.prototype,'src',{...original,set(value){original.set.call(this,map(value))}})})();</script>`;
let modernServer,server;
async function main(){
  modernServer=await new Promise(resolve=>{const s=createFixture({dist,positions:'none'}).app.listen(0,'127.0.0.1',()=>resolve(s));});
  const modernOrigin=`http://127.0.0.1:${modernServer.address().port}`,internalOrigin=`http://127.0.0.1:${internalPort}`;
  for(let i=0;i<50;i++){try{if((await fetch(internalOrigin+'/__qa/hits')).ok)break;}catch{}await new Promise(r=>setTimeout(r,100));}
  server=http.createServer(async(req,res)=>{
    if(!['GET','HEAD'].includes(req.method)){res.writeHead(405,{'content-type':'application/json'});res.end('{"error":"Read-only fixture preview"}');return;}
    const url=new URL(req.url,'http://127.0.0.1');
    if(url.pathname==='/__hero-preview'){res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify({fixtureOnly:true,productionAccess:false,writesAllowed:false,dist}));return;}
    if(url.pathname==='/__hero-fixture-image'){
      const symbol=(url.searchParams.get('source')||'').match(/\/([a-z]+)\.(?:png|svg)(?:\?|$)/)?.[1];
      const icon=symbol&&path.join(dist,'hero','instruments',`${symbol}.svg`);
      res.writeHead(200,{'content-type':'image/svg+xml'});
      res.end(icon&&fs.existsSync(icon)?fs.readFileSync(icon):'<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><circle cx="16" cy="16" r="15" fill="#343744"/></svg>');return;
    }
    try{
      let reply;
      if(url.pathname==='/api/v1/cfd/display/tickers')reply=await fetch(internalOrigin+'/api/v1/cfd/tickers');
      else if(url.pathname.startsWith('/api/v1/cfd/display/candles/'))reply=await fetch(modernOrigin+'/api/v1/market/external/candles/'+url.pathname.split('/').at(-1)+url.search);
      else reply=await fetch(internalOrigin+url.pathname+url.search);
      if(reply.status===404&&/^\/api\/v1\/(?:market\/(?:display|futures\/candles|derivatives|universe|pairs|test-assets)|private-trading\/access)(?:\/|$)/.test(url.pathname))reply=await fetch(modernOrigin+url.pathname+url.search);
      res.writeHead(reply.status,{'content-type':reply.headers.get('content-type')||'application/octet-stream','cache-control':'no-store','content-security-policy':"default-src 'self' data: blob:; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self'; frame-src 'self'; media-src 'self' blob:; object-src 'none'; form-action 'none'"});
      let body=Buffer.from(await reply.arrayBuffer());
      if(reply.ok&&/^\/api\/v1\/market\/external\/(candles|trades)\//.test(url.pathname))body=Buffer.from(JSON.stringify({...JSON.parse(body.toString()),pair:decodeURIComponent(url.pathname.split('/').at(-1)).replace('-','/'),interval:url.searchParams.get('interval')||'15m'}));
      if(reply.headers.get('content-type')?.includes('text/html'))body=Buffer.from(body.toString().replace('<head>','<head>'+localImages).replace(/<link[^>]+href=["']https?:\/\/[^>]+>/g,''));
      if(reply.headers.get('content-type')?.includes('text/css'))body=Buffer.from(body.toString().replace(/@import\s+(?:url\()?['"]?https?:\/\/[^;]+;/g,''));
      res.end(body);
    }catch{res.writeHead(503,{'content-type':'application/json'});res.end('{"error":"Fixture unavailable"}');}
  }).listen(port,'127.0.0.1',()=>console.log(`Read-only VOLTEX hero preview: http://127.0.0.1:${port}; all external network and writes blocked`));
}
const close=()=>{server?.close();modernServer?.close();oldFixture.kill();process.exit();};
process.on('SIGINT',close);process.on('SIGTERM',close);
main().catch(error=>{console.error(error);close();});
