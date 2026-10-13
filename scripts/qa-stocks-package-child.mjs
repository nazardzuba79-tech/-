// QA-only driver; excluded from the runtime closure artifact. No package deps.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import net from 'node:net';
import {once} from 'node:events';
import {createHash} from 'node:crypto';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {createRequire} from 'node:module';
const root=path.dirname(fileURLToPath(import.meta.url)),sha=x=>createHash('sha256').update(x).digest('hex');
assert.equal(process.env.STOCKS_PACKAGE_FIXTURE,'true');assert.ok(process.send);
for(const name of ['NODE_PATH','NODE_OPTIONS','DATABASE_URL','JWT_SECRET'])assert.equal(process.env[name],undefined,name);
assert.deepEqual(process.execArgv,['--no-global-search-paths']);assert.equal(process.cwd(),root);
const manifest=JSON.parse(fs.readFileSync(path.join(root,'runtime-manifest.json'),'utf8'));
assert.equal(manifest.node.version,process.version);assert.equal(manifest.node.executableSha256,sha(fs.readFileSync(process.execPath)));
for(const file of manifest.files){const target=path.resolve(root,file.path);assert.ok(target.startsWith(root+path.sep));assert.equal(sha(fs.readFileSync(target)),file.sha256,file.path);}
const require=createRequire(import.meta.url);for(const name of ['express','typescript','jsonwebtoken'])assert.throws(()=>require.resolve(name),{code:'MODULE_NOT_FOUND'});
const audit={networkDenied:0,quotes:0,histories:0,forwarded:0,droppedAcknowledgements:0};let app,gateway,enabled=false,dropNext=false,gatewayOrigin,currentPath,authenticate,modules,authority;
const admittedPorts=new Set(),connect=net.Socket.prototype.connect;
net.Socket.prototype.connect=function(...args){const a=Array.isArray(args[0])?args[0]:args,o=typeof a[0]==='object'?a[0]:{port:a[0],host:a[1]};if(o.path||(o.host||o.hostname)!=='127.0.0.1'||!admittedPorts.has(Number(o.port))){audit.networkDenied++;throw Error('PACKAGE_FIXTURE_NETWORK_DENIED');}return connect.apply(this,args);};
const nativeFetch=globalThis.fetch;
globalThis.fetch=(input,options)=>{const u=new URL(String(input));if(u.origin!==authority||u.pathname!=='/api/v1/me'||u.search){audit.networkDenied++;return Promise.reject(Error('PACKAGE_FIXTURE_NETWORK_DENIED'));}return nativeFetch(input,options);};
let sequence=0;const ID='BYBIT:AAPLXUSDT';
const hub={metrics:{},catalogue:async()=>{const instrument=modules.CATALOG.find(i=>i.id===ID);assert.ok(instrument,'Exact fixture instrument must exist');assert.equal(instrument.provider,'bybit');assert.equal(instrument.currency,'USDT');assert.equal(instrument.name,'Apple Inc.');return [{...instrument,online:true,exists:true}];},quote:async id=>{assert.equal(id,ID);audit.quotes++;const now=Date.now();return {instrumentId:ID,provider:'bybit',nativeCurrency:'USDT',bid:'100',ask:'100',last:'100',verified:true,marketOpen:true,eventId:'package-fixture-'+(++sequence),timestamp:now,receivedAt:now,capacity:'1.00000000',prices:{USDT:{buy:'100',sell:'100'}},fx:{}};},history:async()=>{audit.histories++;throw Error('UNUSED_FIXTURE_HISTORY');}};
async function stopApp(){if(!app)return;const old=app;app=null;await old.close();admittedPorts.delete(old.port);}
async function boot(){app=await modules.createServer({port:0,accountsPath:currentPath,authenticate,ownerOnlyMode:true,tradeOwnerSubject:'alice',hub,autoPoll:false,accountDiagnostics:true,dist:path.join(root,'no-static')});admittedPorts.add(app.port);}
async function command(name,input){
  if(name==='init'){
    assert.equal(modules,undefined);assert.match(input.authority,/^http:\/\/127\.0\.0\.1:[1-9]\d{0,4}$/);authority=input.authority;admittedPorts.add(Number(new URL(authority).port));
    const get=relative=>import(pathToFileURL(path.join(root,relative)).href);
    const server=await get('services/stocks-global/server.mjs'),identity=await get('services/stocks-global/identity.mjs'),proxy=await get('services/stocks-global/local-proxy.mjs'),catalog=await get('services/stocks-global/catalog.mjs');
    modules={...server,...identity,...proxy,...catalog};authenticate=modules.identityResolver({endpoint:authority+'/api/v1/me',issuer:input.issuer});
    currentPath=path.join(root,'data','primary.sqlite');assert.ok(!fs.existsSync(currentPath));fs.mkdirSync(path.dirname(currentPath),{mode:0o700});await boot();enabled=true;
    const handler=modules.createLocalStocksProxy({origin:()=>gatewayOrigin,stocksOrigin:()=>enabled&&app?'http://127.0.0.1:'+app.port:null});
    gateway=http.createServer((req,res)=>{
      if(enabled&&app)audit.forwarded++;
      if(dropNext&&enabled&&req.method==='POST'&&req.url==='/__stocks_global/orders'){
        dropNext=false;let status=0,bytes=0;const chunks=[];
        res.writeHead=code=>{status=code;return res;};res.write=(chunk,encoding,callback)=>{const data=Buffer.isBuffer(chunk)?chunk:Buffer.from(chunk,typeof encoding==='string'?encoding:undefined);bytes+=data.length;assert.ok(bytes<=1024*1024);chunks.push(data);if(typeof encoding==='function')encoding();else callback?.();return true;};
        res.end=chunk=>{if(chunk)res.write(chunk);const body=JSON.parse(Buffer.concat(chunks).toString());assert.equal(status,200);assert.ok(body.result?.id);audit.droppedAcknowledgements++;audit.droppedOrderId=body.result.id;res.destroy();return res;};
      }
      handler(req,res);
    });gateway.listen(0,'127.0.0.1');await once(gateway,'listening');admittedPorts.add(gateway.address().port);gatewayOrigin='http://127.0.0.1:'+gateway.address().port;
    return {gatewayOrigin,path:currentPath,node:process.version,execArgv:process.execArgv,NODE_PATH:'ABSENT',externalDependencies:'UNRESOLVABLE',cwd:process.cwd()};
  }
  assert.ok(modules);
  if(name==='audit')return structuredClone(audit);
  if(name==='enabled'){enabled=input.value===true;return true;}
  if(name==='dropAck'){dropNext=true;return true;}
  if(name==='networkProbe'){await assert.rejects(fetch('https://example.invalid/'),/PACKAGE_FIXTURE_NETWORK_DENIED/);return true;}
  if(name==='quiesce'){enabled=false;const metrics=app?.accountMetrics();await stopApp();return {closed:true,path:currentPath,metrics};}
  if(name==='restart'){await stopApp();await boot();enabled=true;return true;}
  if(name==='restore'){assert.equal(input.path,path.join(root,'data','restored.sqlite'));assert.ok(fs.existsSync(input.path));await stopApp();currentPath=input.path;await boot();enabled=true;return true;}
  if(name==='stop'){enabled=false;await stopApp();gateway.closeAllConnections();await new Promise(r=>gateway.close(r));return structuredClone(audit);}
  throw Error('COMMAND_DENIED');
}
let serial=Promise.resolve();process.on('message',message=>{serial=serial.then(async()=>{try{const result=await command(message.command,message.input||{});process.send({id:message.id,result});if(message.command==='stop')process.disconnect();}catch(e){process.send({id:message.id,error:{message:e.message,stack:e.stack}});}});});
