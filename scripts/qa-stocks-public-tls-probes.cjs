// Same owned Chromium, normal TLS validation; all listeners are disposable loopback fixtures.
'use strict';
const assert=require('node:assert/strict');
const {certificates,createIngress,HOST,PREFIX}=require('./qa-stocks-tls-ingress.cjs');
const BAD_SNI='bad-sni.stocks-review.invalid';
async function bounded(promise,ms,label){let t;try{return await Promise.race([promise,new Promise((_,reject)=>{t=setTimeout(()=>reject(Error(label)),ms);})]);}finally{clearTimeout(t);}}
async function withProbePage(context,run){
  const page=await context.newPage();let failure;
  try{return await run(page);}catch(e){failure=e;throw e;}
  finally{try{await bounded(page.close(),5000,'TLS_PROBE_PAGE_CLOSE_TIMEOUT');}catch(e){if(failure)e.probeFailure={message:failure.message,stack:failure.stack};throw e;}}
}
async function browserTlsProbes({browser,credentials,python,upstreamOrigin,fixture,check}){
  const listeners=[],proof={status:'RUNNING',cases:[],externalBlocked:[],webSocketsBlocked:[],normalTls:true};let context;
  try{
    const foreign=certificates(python);assert.notEqual(foreign.proof.caFingerprint,credentials.proof.caFingerprint);
    const staticHandler=(_req,res)=>{res.writeHead(200,{'content-type':'text/html','cache-control':'no-store'});res.end('<!doctype html><title>Private TLS fixture</title><p>Private TLS fixture</p>');};
    for(const pair of [['trusted',credentials],['untrusted',foreign],['wrong-san',credentials.wrongSan],['cross-origin-target',credentials]]){
      const ingress=await createIngress({credentials:pair[1],upstreamOrigin,allowSameOriginRead:true,staticHandler});listeners.push({name:pair[0],ingress});
    }
    const get=name=>listeners.find(x=>x.name===name).ingress;
    context=await browser.newContext({serviceWorkers:'block',ignoreHTTPSErrors:false});
    const allowed=new Set(listeners.map(x=>x.ingress.origin));allowed.add(get('trusted').origin.replace(HOST,BAD_SNI));
    await context.route('**/*',route=>{const u=new URL(route.request().url());if(!allowed.has(u.origin)){proof.externalBlocked.push({origin:u.origin,path:u.pathname});return route.abort('blockedbyclient');}return route.continue();});
    await context.routeWebSocket('**/*',socket=>{proof.webSocketsBlocked.push(socket.url().split('?')[0]);socket.close();});
    const before=await fixture.command('audit');
    await withProbePage(context,async page=>{
      const positive=await page.goto(get('trusted').origin+'/',{waitUntil:'load',timeout:10000});check(positive.status()===200,'normal Chromium validates private fixture CA positive control');
      proof.cases.push({name:'trusted',status:200,pass:true});
    });
    for(const [name,url,expected]of [
      ['untrusted',get('untrusted').origin+'/',/net::ERR_CERT_AUTHORITY_INVALID/],
      ['wrong-san',get('wrong-san').origin+'/',/net::ERR_CERT_COMMON_NAME_INVALID/],
      ['wrong-sni',get('trusted').origin.replace(HOST,BAD_SNI)+'/',/net::ERR_(SSL_PROTOCOL_ERROR|CONNECTION_CLOSED|CONNECTION_RESET|SSL_VERSION_OR_CIPHER_MISMATCH)/],
    ]){
      await withProbePage(context,async page=>{
        let error=null;try{await page.goto(url,{waitUntil:'load',timeout:10000});}catch(e){error=e.message;}
        check(typeof error==='string'&&expected.test(error),'normal Chromium rejects '+name+' without TLS bypass');proof.cases.push({name,error,pass:true});
      });
    }
    check(get('trusted').audit.sniDenied>0,'wrong SNI rejected before HTTP by fixture listener');
    await withProbePage(context,async page=>{
      await page.goto(get('trusted').origin+'/',{waitUntil:'load',timeout:10000});
      const target=get('cross-origin-target'),statuses=[];page.on('response',r=>{if(r.url()===target.origin+PREFIX+'orders')statuses.push(r.status());});
      const crossOrigin=await page.evaluate(async url=>{try{const r=await fetch(url,{method:'POST',body:'{}'});return {status:r.status};}catch(e){return {error:e.message};}},target.origin+PREFIX+'orders');
      check(target.audit.requests===1&&target.audit.denied===1&&target.audit.forwarded===0,'actual cross-origin browser POST is denied before backend admission');
      // CORS may hide the response from browser JS/CDP; retain observed statuses and the actual listener response code.
      check(target.audit.lastDenial?.status===403&&target.audit.lastDenial?.error==='ORIGIN_DENIED','actual browser cross-origin POST receives listener HTTP403 ORIGIN_DENIED');
      proof.cases.push({name:'cross-origin-post',browserObservedStatuses:statuses,listenerResponse:target.audit.lastDenial,result:crossOrigin,pass:true});
    });
    const after=await fixture.command('audit');
    proof.backendDelta={identityRequests:after.identityRequests-before.identityRequests,forwarded:after.forwarded-before.forwarded,quotes:after.quotes-before.quotes};
    check(Object.values(proof.backendDelta).every(n=>n===0),'all browser TLS/Origin negatives perform zero authority/backend/quote admission');
    check(listeners.every(x=>x.ingress.audit.forwarded===0),'all TLS probe listeners retain zero forwarding');
    check(proof.externalBlocked.length===0&&proof.webSocketsBlocked.length===0,'TLS probes have no outside destination or WebSocket attempts');
    proof.untrustedCaFingerprint=foreign.proof.caFingerprint;proof.wrongSanFingerprint=credentials.proof.wrongSanFingerprint;proof.status='PASS';
  }catch(e){proof.status='FAIL';proof.failure={message:e.message,stack:e.stack,...(e.probeFailure?{probeFailure:e.probeFailure}:{})};throw Object.assign(e,{tlsProbeProof:proof});}
  finally{
    proof.listeners=listeners.map(x=>({name:x.name,audit:{...x.ingress.audit}}));
    const errors=[];if(context)try{await bounded(context.close(),5000,'TLS_PROBE_CONTEXT_CLOSE_TIMEOUT');}catch(e){errors.push(e.message);}
    for(const {ingress}of listeners)try{await bounded(ingress.close(),5000,'TLS_PROBE_CLOSE_TIMEOUT');}catch(e){errors.push(e.message);}
    if(errors.length){proof.status='FAIL';proof.cleanupErrors=errors;throw Object.assign(Error('TLS_PROBE_CLEANUP_FAILED'),{tlsProbeProof:proof});}
  }
  return proof;
}
module.exports={browserTlsProbes,BAD_SNI};
