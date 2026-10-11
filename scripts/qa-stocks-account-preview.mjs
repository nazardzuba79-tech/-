// LOCAL QA ONLY. This is a disposable identity authority, never production auth.
// It serves no balances/orders and is not imported by either production entrypoint.
import http from 'node:http';
import { randomBytes } from 'node:crypto';
import { resolve } from 'node:path';
import { createServer } from '../services/stocks-global/server.mjs';
import { identityResolver } from '../services/stocks-global/identity.mjs';
const port=Number(process.env.STOCKS_QA_PORT||4441),identityPort=Number(process.env.STOCKS_QA_IDENTITY_PORT||4442);
if(process.env.STOCKS_QA_IDENTITY!=='fixture-only'||!process.env.STOCKS_ACCOUNTS_DATA?.endsWith('.sqlite'))throw Error('Explicit fixture-only mode and isolated SQLite path required');
const origin=`http://127.0.0.1:${port}`,sessions=new Map();
const authority=http.createServer(async(req,res)=>{try{
  const send=(status,body)=>{res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(body));};
  if(req.headers.host!==`127.0.0.1:${identityPort}`||(req.headers.origin&&req.headers.origin!==origin))return send(403,{});
  if(req.headers.origin){res.setHeader('Access-Control-Allow-Origin',origin);res.setHeader('Vary','Origin');res.setHeader('Access-Control-Allow-Headers','authorization,content-type');res.setHeader('Access-Control-Allow-Methods','GET,POST,OPTIONS');}
  if(req.method==='OPTIONS'){res.writeHead(204);res.end();return;}
  const token=req.headers.authorization?.replace(/^Bearer /,''),session=sessions.get(token);
  if(req.method==='POST'&&req.url==='/api/v1/auth/login'){
    const chunks=[];let length=0;for await(const chunk of req){length+=chunk.length;if(length>1024)return send(413,{});chunks.push(chunk);}
    const input=JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if(!['alice@stocks.test','bob@stocks.test'].includes(input.email)||input.password!=='Stocks-QA-only-2026')return send(401,{error:'Fixture credentials only'});
    const token=randomBytes(32).toString('hex');sessions.set(token,{id:input.email.split('@')[0],email:input.email,expires:Date.now()+3600000});return send(200,{token});
  }
  if(req.method==='GET'&&req.url==='/api/v1/me'){if(!session||session.expires<Date.now())return send(401,{});return send(200,{id:session.id,email:session.email,kycStatus:'NONE',isAdmin:false,fixtureOnly:true});}
  if(req.method==='POST'&&req.url==='/api/v1/auth/logout'){sessions.delete(token);return send(200,{status:'ok'});}
  send(404,{error:'Fixture authority: route unavailable'});
}catch{res.writeHead(400);res.end('{}');}});
await new Promise((ok,fail)=>{authority.once('error',fail);authority.listen(identityPort,'127.0.0.1',ok);});
const app=await createServer({port,accountsPath:resolve(process.env.STOCKS_ACCOUNTS_DATA),dist:resolve('frontend/dist-stocks-accounts'),authenticate:identityResolver({endpoint:`http://127.0.0.1:${identityPort}/api/v1/me`,issuer:'voltex-stocks-local-fixture-v1'})});
console.log(`LOCAL FIXTURE identity + per-user paper preview: ${origin}/stocks/BYBIT%3AAAPLXUSDT`);
let closing=false;const stop=async()=>{if(closing)return;closing=true;await app.close();await new Promise(r=>authority.close(r));process.exit(0);};process.on('SIGINT',stop);process.on('SIGTERM',stop);
