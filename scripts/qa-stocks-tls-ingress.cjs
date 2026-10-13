// Disposable QA ingress only. This is not production gateway wiring.
'use strict';
const assert = require('node:assert/strict');
const https = require('node:https');
const http = require('node:http');
const tls = require('node:tls');
const { spawnSync } = require('node:child_process');
const { X509Certificate } = require('node:crypto');
const HOST = 'stocks-review.invalid', PREFIX = '/__stocks_global/';
const ROUTES = new Map(Object.entries({ state:'GET', portfolio:'GET', history:'GET', catalogue:'GET', health:'GET', orders:'POST', cancel:'POST', refresh:'POST', balances:'POST', lease:'DELETE' }));
const FORWARDED = ['authorization','content-type','x-stocks-token','x-stocks-view'];
const ALLOWED = new Set(['host','origin','sec-fetch-site','content-length','transfer-encoding','connection',...FORWARDED]);
const BROWSER_METADATA = new Set(['accept','accept-encoding','accept-language','user-agent','sec-ch-ua','sec-ch-ua-mobile','sec-ch-ua-platform','sec-fetch-dest','sec-fetch-mode','priority','referer','cache-control','pragma']);
const MAX_BODY = 65536, MAX_RESPONSE = 2 * 1024 * 1024;
function cleanEnv() {
  const env={}; for(const name of ['SystemRoot','WINDIR'])if(process.env[name])env[name]=process.env[name];
  return env;
}
function certificates(python) {
  assert.ok(require('node:path').isAbsolute(python));
  const source = `import json, datetime, cryptography
from cryptography import x509
from cryptography.x509.oid import NameOID, ExtendedKeyUsageOID
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import rsa
now=datetime.datetime.now(datetime.timezone.utc)
ca_key=rsa.generate_private_key(public_exponent=65537,key_size=2048)
key=rsa.generate_private_key(public_exponent=65537,key_size=2048)
wrong_key=rsa.generate_private_key(public_exponent=65537,key_size=2048)
ca_name=x509.Name([x509.NameAttribute(NameOID.COMMON_NAME,'Disposable Stocks fixture CA')])
name=x509.Name([x509.NameAttribute(NameOID.COMMON_NAME,'stocks-review.invalid')])
def base(subject, issuer, pub):
 return x509.CertificateBuilder().subject_name(subject).issuer_name(issuer).public_key(pub).serial_number(x509.random_serial_number()).not_valid_before(now-datetime.timedelta(minutes=5)).not_valid_after(now+datetime.timedelta(days=1))
ca=base(ca_name,ca_name,ca_key.public_key()).add_extension(x509.BasicConstraints(ca=True,path_length=0),critical=True).add_extension(x509.KeyUsage(False,False,False,False,False,True,True,False,False),critical=True).sign(ca_key,hashes.SHA256())
leaf=base(name,ca_name,key.public_key()).add_extension(x509.BasicConstraints(ca=False,path_length=None),critical=True).add_extension(x509.SubjectAlternativeName([x509.DNSName('stocks-review.invalid')]),critical=False).add_extension(x509.ExtendedKeyUsage([ExtendedKeyUsageOID.SERVER_AUTH]),critical=False).add_extension(x509.KeyUsage(True,False,True,False,False,False,False,False,False),critical=True).sign(ca_key,hashes.SHA256())
pem=lambda c:c.public_bytes(serialization.Encoding.PEM).decode('ascii')
wrong=base(x509.Name([x509.NameAttribute(NameOID.COMMON_NAME,'wrong-san.stocks-review.invalid')]),ca_name,wrong_key.public_key()).add_extension(x509.BasicConstraints(ca=False,path_length=None),critical=True).add_extension(x509.SubjectAlternativeName([x509.DNSName('wrong-san.stocks-review.invalid')]),critical=False).add_extension(x509.ExtendedKeyUsage([ExtendedKeyUsageOID.SERVER_AUTH]),critical=False).sign(ca_key,hashes.SHA256())
private=lambda k:k.private_bytes(serialization.Encoding.PEM,serialization.PrivateFormat.PKCS8,serialization.NoEncryption()).decode('ascii')
print(json.dumps({'ca':pem(ca),'cert':pem(leaf),'key':private(key),'wrongSan':{'ca':pem(ca),'cert':pem(wrong),'key':private(wrong_key)},'library':'cryptography '+cryptography.__version__}))`;
  const child=spawnSync(python,['-I','-c',source],{env:cleanEnv(),windowsHide:true,encoding:'utf8',timeout:15000,maxBuffer:65536});
  assert.equal(child.status,0,'fixture certificate generation failed: '+(child.error?.message||child.stderr||''));
  const result=JSON.parse(child.stdout), ca=new X509Certificate(result.ca), leaf=new X509Certificate(result.cert);
  assert.equal(ca.ca,true); assert.equal(leaf.ca,false); assert.equal(leaf.checkHost(HOST),HOST);
  assert.equal(leaf.verify(ca.publicKey),true); assert.equal(leaf.checkIssued(ca),true);
  const wrong=new X509Certificate(result.wrongSan.cert);assert.equal(wrong.verify(ca.publicKey),true);assert.equal(wrong.checkIssued(ca),true);
  assert.equal(wrong.checkHost(HOST),undefined);assert.equal(wrong.checkHost('wrong-san.stocks-review.invalid'),'wrong-san.stocks-review.invalid');
  return {...result,proof:{library:result.library,caFingerprint:ca.fingerprint256,leafFingerprint:leaf.fingerprint256,wrongSanFingerprint:wrong.fingerprint256,validFrom:leaf.validFrom,validTo:leaf.validTo,subjectAltName:leaf.subjectAltName}};
}
async function createIngress({ credentials, upstreamOrigin, enabled=()=>true, timeoutMs=3000, allowSameOriginRead=false, staticHandler }) {
  assert.match(upstreamOrigin,/^http:\/\/127\.0\.0\.1:[1-9]\d{0,4}$/);
  const upstream=new URL(upstreamOrigin); assert.ok(+upstream.port<=65535);
  assert.ok(Number.isInteger(timeoutMs)&&timeoutMs>=25&&timeoutMs<=3000);
  assert.equal(typeof allowSameOriginRead,'boolean');
  assert.ok(staticHandler===undefined||typeof staticHandler==='function');
  const audit={requests:0,forwarded:0,denied:0,active:0,disconnected:0,upstreamErrors:0,tlsErrors:0,sniDenied:0,lastDenial:null};
  const sockets=new Set(), context=tls.createSecureContext({key:credentials.key,cert:credentials.cert}); let origin,authority;
  const server=https.createServer({key:credentials.key,cert:credentials.cert,minVersion:'TLSv1.2',maxHeaderSize:16384,
    SNICallback:(name,done)=>{if(name===HOST)return done(null,context);audit.sniDenied++;done(Error('FIXTURE_SNI_DENIED'));}},(req,res)=>{
    if(staticHandler&&!req.url?.startsWith(PREFIX)){
      if(req.socket.servername!==HOST||req.headers.host!==authority){res.writeHead(400,{'content-type':'application/json','cache-control':'no-store'});res.end('{"error":"STATIC_AUTHORITY_DENIED"}');return;}
      Promise.resolve().then(()=>staticHandler(req,res,{origin,authority})).catch(()=>{if(!res.destroyed){if(!res.headersSent)res.writeHead(500);res.end();}});return;
    }
    audit.requests++; const started=performance.now();let settled=false,outbound,response; const chunks=[];let bytes=0;
    const finish=()=>{if(settled)return;settled=true;clearTimeout(timer);audit.active--;};audit.active++;
    const reply=(status,error)=>{if(settled)return;audit.denied++;audit.lastDenial={status,error};finish();outbound?.destroy();response?.destroy();if(!res.destroyed){res.writeHead(status,{'content-type':'application/json','cache-control':'no-store'});res.end(JSON.stringify({error}));}};
    const disconnected=()=>{if(settled)return;audit.disconnected++;finish();outbound?.destroy();response?.destroy();};
    const timer=setTimeout(()=>reply(504,'FIXTURE_INGRESS_DEADLINE'),timeoutMs);
    req.once('aborted',disconnected);res.once('close',disconnected);
    if(!enabled())return reply(503,'FIXTURE_STOCKS_DISABLED');
    if(req.socket.servername!==HOST)return reply(400,'FIXTURE_SNI_DENIED');
    const seen=new Set();for(let i=0;i<req.rawHeaders.length;i+=2){const n=req.rawHeaders[i].toLowerCase();if(seen.has(n))return reply(400,'DUPLICATE_HEADER');seen.add(n);if(!ALLOWED.has(n)&&!(allowSameOriginRead&&BROWSER_METADATA.has(n)))return reply(400,'HEADER_NOT_ALLOWED');}
    if(req.headers.host!==authority)return reply(400,'INVALID_HOST');
    const safeAbsentOrigin=allowSameOriginRead&&req.method==='GET'&&req.headers.origin===undefined&&req.headers['sec-fetch-site']==='same-origin';
    if(req.headers.origin!==origin&&!safeAbsentOrigin)return reply(403,'ORIGIN_DENIED');
    if(req.headers['sec-fetch-site']!==undefined&&req.headers['sec-fetch-site']!=='same-origin')return reply(403,'ORIGIN_DENIED');
    const target=req.url||'',route=target.split('?')[0].slice(PREFIX.length);
    if(!target.startsWith(PREFIX)||target.length>8192||/[\\#\r\n]/.test(target)||!ROUTES.has(route))return reply(404,'ROUTE_NOT_ALLOWED');
    if(req.method!==ROUTES.get(route))return reply(405,'METHOD_NOT_ALLOWED');
    if(req.method!=='POST'&&(req.headers['transfer-encoding']!==undefined||Number(req.headers['content-length']||0)!==0))return reply(400,'BODY_NOT_ALLOWED');
    if(req.method==='POST'&&!/^application\/json(?:;\s*charset=utf-8)?$/i.test(req.headers['content-type']||''))return reply(400,'CONTENT_TYPE_DENIED');
    if(Number(req.headers['content-length']||0)>MAX_BODY)return reply(413,'BODY_TOO_LARGE');
    req.on('error',disconnected);
    req.on('data',chunk=>{if(settled)return;bytes+=chunk.length;if(bytes>MAX_BODY)return reply(413,'BODY_TOO_LARGE');chunks.push(chunk);});
    req.on('end',()=>{
      if(settled)return;
      if(performance.now()-started>=timeoutMs)return reply(504,'FIXTURE_INGRESS_DEADLINE');
      // Admission can be withdrawn while the bounded body is still arriving.
      // This does not revoke an HTTP request already forwarded to the ledger.
      if(!enabled())return reply(503,'FIXTURE_STOCKS_DISABLED');
      const headers={host:upstream.host,origin:upstream.origin,'sec-fetch-site':'same-origin','content-length':bytes};
      for(const name of FORWARDED)if(req.headers[name]!==undefined)headers[name]=req.headers[name];
      audit.forwarded++;
      outbound=http.request({hostname:'127.0.0.1',port:+upstream.port,path:target,method:req.method,headers,agent:false},incoming=>{
        response=incoming;let size=0;const body=[];
        incoming.on('data',chunk=>{if(settled)return;size+=chunk.length;if(size>MAX_RESPONSE)return reply(502,'RESPONSE_TOO_LARGE');body.push(chunk);});
        incoming.on('error',()=>{if(settled)return;audit.upstreamErrors++;reply(502,'UPSTREAM_UNAVAILABLE');});
        incoming.on('aborted',()=>{if(settled)return;audit.upstreamErrors++;reply(502,'UPSTREAM_UNAVAILABLE');});
        incoming.on('end',()=>{if(settled)return;if(performance.now()-started>=timeoutMs)return reply(504,'FIXTURE_INGRESS_DEADLINE');finish();res.writeHead(incoming.statusCode,{'content-type':'application/json','cache-control':'no-store','x-content-type-options':'nosniff'});res.end(Buffer.concat(body));});
      });
      outbound.once('error',()=>{if(settled)return;audit.upstreamErrors++;reply(502,'UPSTREAM_UNAVAILABLE');});
      outbound.end(Buffer.concat(chunks));
    });
  });
  server.on('tlsClientError',()=>audit.tlsErrors++);
  server.on('connection',socket=>{sockets.add(socket);socket.once('close',()=>sockets.delete(socket));});
  server.requestTimeout=4000;server.headersTimeout=4000;server.keepAliveTimeout=1;
  await new Promise((ok,fail)=>{server.once('error',fail);server.listen(0,'127.0.0.1',ok);});
  authority=HOST+':'+server.address().port;origin='https://'+authority;
  return {origin,authority,port:server.address().port,audit,async close(){for(const socket of sockets)socket.destroy();await new Promise(ok=>server.close(ok));}};
}
function request(ingress, credentials, options={}) {
  return new Promise(resolve=>{
    const started=performance.now();let settled=false,req;
    const finish=value=>{if(settled)return;settled=true;clearTimeout(timer);resolve({...value,ms:performance.now()-started});};
    const timer=setTimeout(()=>req?.destroy(Error('FIXTURE_CLIENT_DEADLINE')),4500);
    const headers={host:ingress.authority,origin:ingress.origin,'sec-fetch-site':'same-origin',...(options.body!==undefined?{'content-type':'application/json'}:{}),...options.headers};
    for(const name of Object.keys(headers))if(headers[name]===undefined)delete headers[name];
    req=https.request({hostname:HOST,port:ingress.port,servername:options.servername===undefined?HOST:options.servername,
      lookup:(_host,lookupOptions,done)=>lookupOptions.all?done(null,[{address:'127.0.0.1',family:4}]):done(null,'127.0.0.1',4),ca:options.untrusted?undefined:credentials.ca,rejectUnauthorized:true,
      method:options.method||'GET',path:options.path||PREFIX+'state',agent:false,headers},res=>{
        let size=0;const chunks=[];res.on('data',b=>{size+=b.length;if(size>MAX_RESPONSE)req.destroy(Error('CLIENT_RESPONSE_TOO_LARGE'));else chunks.push(b);});
        res.on('error',e=>finish({error:e.code||e.message}));res.on('end',()=>{try{finish({status:res.statusCode,headers:res.headers,body:JSON.parse(Buffer.concat(chunks).toString())});}catch{finish({error:'INVALID_JSON'});}});
    });
    req.once('error',e=>finish({error:e.code||e.message}));req.end(options.body===undefined?undefined:JSON.stringify(options.body));
  });
}
module.exports={certificates,createIngress,request,HOST,PREFIX,cleanEnv,MAX_BODY};
