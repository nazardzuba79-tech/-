#!/usr/bin/env node
/**
 * Read-only, credential-free QA of VOLTEX Russian gateway's auth routing.
 * The API's requireAuth responds 401 application/json with Missing bearer token.
 * An nginx 403 HTML on these paths strongly suggests a proxy-route deny.
 * This NEVER proves authenticated behavior, ISP reachability, or TLS integrity.
 */
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

export const RU_ORIGIN = 'https://ru.voltextech.net';
export const EXPECTED = Object.freeze([
  { name: 'auth-me', path: '/api/v1/me', kind: 'auth' },
  { name: 'wallet-overview', path: '/api/v1/wallet/overview', kind: 'auth' },
  { name: 'banking-state', path: '/api/v1/banking/state', kind: 'auth' },
  { name: 'kyc-me', path: '/api/v1/kyc/me', kind: 'auth' },
  { name: 'copy-marketplace', path: '/api/v1/copy-trading/marketplace', kind: 'auth' },
  { name: 'copy-identities', path: '/api/v1/copy-trading/identities', kind: 'public' },
]);
const PER_RESPONSE_BYTES = 256_000;
const TOTAL_BYTES = 900_000;
const MAX_CHECKS = EXPECTED.length;

async function limitedText(response, remaining) {
  const reader = response.body?.getReader();
  if (!reader) return { text: '', byteLength: 0 };
  const chunks=[];
  let bytes=0;
  try {
    for(;;) {
      const {done,value}=await reader.read();
      if(done)break;
      bytes+=value.byteLength;
      if(bytes>PER_RESPONSE_BYTES || bytes>remaining) throw Error('BODY_BUDGET_EXCEEDED');
      chunks.push(value);
    }
  } finally {await reader.cancel().catch(()=>{});reader.releaseLock();}
  const out=new Uint8Array(bytes);let off=0;
  for(const chunk of chunks){out.set(chunk,off);off+=chunk.byteLength;}
  return {text:new TextDecoder().decode(out),byteLength:bytes};
}

export async function auditRuAuthRouting({ fetchImpl=fetch, clock=()=>new Date().toISOString() }={}) {
  const checks=[];
  let totalBytes=0;
  for(const {name,path,kind} of EXPECTED) {
    if(checks.length>=MAX_CHECKS || totalBytes>=TOTAL_BYTES)break;
    const url=new URL(path,RU_ORIGIN);
    if(url.origin!==RU_ORIGIN)throw Error('UNEXPECTED_ORIGIN');
    try {
      const response=await fetchImpl(url,{method:'GET',credentials:'omit',cache:'no-store',redirect:'manual',
        signal:AbortSignal.timeout(10000),headers:{Accept:'application/json'}});
      const ct=response.headers.get('content-type')||'';
      const {text,byteLength}=await limitedText(response,TOTAL_BYTES-totalBytes);
      totalBytes+=byteLength;
      let json;
      try { json=JSON.parse(text); } catch { /* Never print a response body. */ }
      const hasJson=ct.toLowerCase().includes('application/json') && json && typeof json==='object' && !Array.isArray(json);
      let status='FAIL', reason='UNEXPECTED_RESPONSE';
      if(kind==='auth' && response.status===401 && hasJson && json.error==='Missing bearer token') {
        status='PASS';reason='AUTH_LAYER_REACHED';
      } else if(kind==='public' && response.status===200 && hasJson && Array.isArray(json.identities)
        && json.identities.length===2 && json.identities.map(v=>v?.traderId).join(',')==='VX-001,VX-KSENIA') {
        status='PASS';reason='PUBLIC_IDENTITIES_OK';
      } else if(response.status===403 && !hasJson && /nginx|403 Forbidden/i.test(text)) {
        reason='LIKELY_NGINX_ROUTE_DENY';
      } else if(response.status>=300 && response.status<400) {
        reason='REDIRECT_REFUSED';
      } else if(response.status===401 && !hasJson) {
        reason='NON_JSON_AUTH_REPLY';
      } else if(response.status===429 || response.status===503) {
        reason='RATE_LIMIT_OR_UNAVAILABLE';
      } else if(response.status===200 && !hasJson) {
        reason='HTML_OR_INVALID_JSON_200';
      }
      checks.push({name,path,httpStatus:response.status,contentKind:hasJson?'json':'other',status,reason});
    } catch(e) {
      const reason=String(e?.message||'ERROR')==='BODY_BUDGET_EXCEEDED'?'BODY_BUDGET_EXCEEDED':
        String(e?.name||'')==='TimeoutError'?'TIMEOUT':'NETWORK_OR_TRANSPORT_ERROR';
      checks.push({name,path,status:'FAIL',reason});
    }
  }
  return {origin:RU_ORIGIN,checkedAt:clock(),checks,bytesRead:totalBytes,
    overall:checks.length===EXPECTED.length && checks.every(c=>c.status==='PASS')?'PUBLIC_AUTH_BOUNDARY_PASS':'ROUTING_BLOCKER_OR_UNVERIFIED',
    limits:{requests:MAX_CHECKS,perResponseBytes:PER_RESPONSE_BYTES,totalBytes:TOTAL_BYTES},
    caveats:[
      'GET requests contain no Authorization, JWT, cookies, passwords, account IDs or body.',
      'Expected 401 proves route reaches auth middleware, NOT that an authorized customer can use it.',
      'This run is from the caller network; Russian ISP/no-VPN access is NOT proven.',
      'nginx HTML 403 indicates a likely route deny, not the exact nginx rule without nginx -T.',
      'TLS-terminating Beget may tamper with frontend and deposit-address display; no sensitive routes should be opened without reviewing TLS passthrough.'
    ]};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  const result=await auditRuAuthRouting();
  process.stdout.write(JSON.stringify(result,null,2)+'\n');
  if(result.overall!=='PUBLIC_AUTH_BOUNDARY_PASS')process.exitCode=1;
}
