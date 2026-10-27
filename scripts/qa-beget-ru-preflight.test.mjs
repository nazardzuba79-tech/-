import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
const script = resolve(dirname(fileURLToPath(import.meta.url)), 'qa-beget-ru-preflight.mjs');
function cli(mode = 'ok', origin = 'https://ru.example') {
  const dir = mkdtempSync(join(tmpdir(), 'voltex-beget-preflight-'));
  try {
    const preload = join(dir, 'fixture.mjs');
    writeFileSync(preload, `globalThis.fetch = async (url, options) => {
      if ((options?.method ?? 'GET') !== 'GET' || options?.headers?.Authorization || options?.credentials === 'include') throw Error('UNSAFE_REQUEST');
      const u = new URL(url), mode = ${JSON.stringify(mode)};
      if (u.origin !== 'https://ru.example') throw Error('OUTBOUND_REFUSED');
      if (mode === 'network') throw Object.assign(new TypeError('fetch failed'), {cause:{code:'UND_ERR_CONNECT_TIMEOUT'}});
      if (mode === 'redirect') return new Response('',{status:302,headers:{location:'https://other.example'}});
      if (u.pathname.startsWith('/api/')) return Response.json(mode === 'error-json' ? {error:'wrong_route'} :
        u.pathname.includes('/symbols') ? {source:'kraken',symbols:[{pair:'BTC/USDT'}]} :
        u.pathname.includes('/candles') ? {pair:'BTC/USDT',interval:'1h',candles:[{time:1700000000,open:100,high:102,low:99,close:101,volume:1}]} :
        {ticker:{pair:'BTC/USDT',lastPrice:'100',bidPrice:'99',askPrice:'101'}});
      if (u.pathname === '/market/listings') return Response.json({serverTime:1700000000000,revision:'1',assets:[]});
      if (u.pathname.endsWith('.js')) return new Response(mode === 'large' ? 'x'.repeat(9*1024*1024) : 'export default {};',{headers:{'content-type':'application/javascript'}});
      return new Response('<!doctype html><div id="root"></div>' + (mode === 'no-assets' ? '' : '<script type="module" src="/assets/app.js"></script>'),{headers:{'content-type':'text/html'}});
    };`);
    const env = {...process.env}; for (const k of Object.keys(env)) if (/^(HTTP|HTTPS|ALL)_PROXY$/i.test(k)) delete env[k];
    const x = spawnSync(process.execPath,['--import',pathToFileURL(preload).href,script,origin],{env,encoding:'utf8',timeout:15000,maxBuffer:1000000,windowsHide:true});
    return {code:x.status,report:x.stdout.trim()?JSON.parse(x.stdout):null,stderr:x.stderr};
  } finally { if (dirname(dir) !== tmpdir() || !dir.includes('voltex-beget-preflight-')) throw Error('UNOWNED_TMP'); rmSync(dir,{recursive:true,force:true}); }
}
test('an HTTP200 JSON error is never accepted as a working API route', () => {
  const x=cli('error-json'); assert.ok(x.report,x.stderr); const check=x.report.checks.find(c=>c.name==='api-symbols'||c.name==='api-pairs');
  assert.equal(check.status,'FAIL'); assert.equal(x.code,1);
});

test('actual route shapes pass; the retired /pairs path is not probed', () => {
  const x=cli(); assert.equal(x.code,0,x.stderr);
  assert.ok(x.report.checks.every(c=>c.status==='PASS'));
  assert.ok(x.report.checks.some(c=>c.path==='/api/v1/market/external/symbols'));
  assert.ok(!x.report.checks.some(c=>c.path==='/api/v1/pairs'));
  assert.equal(x.report.measured.requests,11);
  assert.match(x.report.networkProof,/NOT ESTABLISHED/);
});

test('origin connection failure retains its cause and prevents repeated requests to the unreachable host', () => {
  const x=cli('network'); assert.equal(x.code,1);
  assert.equal(x.report.checks[0].causeCode,'UND_ERR_CONNECT_TIMEOUT');
  assert.ok(x.report.checks.slice(1).every(c=>c.status==='NOT_RUN'));
  assert.equal(x.report.measured.requests,1);
});

test('redirects are refused, not followed to another origin', () => {
  const x=cli('redirect'); assert.equal(x.code,1);
  const probes=x.report.checks.filter(c=>c.name!=='initial-assets');
  assert.equal(probes.length,10);
  assert.ok(probes.every(c=>c.status==='FAIL'&&c.error==='http_302'));
  assert.ok(x.report.checks.some(c=>c.name==='initial-assets'&&c.status==='FAIL'));
});

test('oversized assets fail within the decoded response budget', () => {
  const x=cli('large'); assert.equal(x.code,1);
  assert.ok(x.report.checks.some(c=>c.name==='html-asset'&&c.error==='RESPONSE_BUDGET_EXCEEDED'));
});

test('a shell without any JS/CSS has an explicit failed check', () => {
  const x=cli('no-assets'); assert.equal(x.code,1);
  assert.ok(x.report.checks.some(c=>c.name==='initial-assets'&&c.status==='FAIL'));
});

test('HTTP, credential-bearing and path-bearing origins are rejected without echoing credentials', () => {
  for (const origin of ['http://ru.example','https://owner:private-password@ru.example','https://ru.example/admin']) {
    const x=cli('ok',origin); assert.equal(x.code,2); assert.equal(x.report,null);
    assert.ok(!x.stderr.includes('private-password'));
  }
});
