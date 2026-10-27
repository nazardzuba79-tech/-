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


// Concurrent #622 tests retained, updated to the source-defined route contracts.

const origin = 'https://gateway.example.test';
const homepage = '<!doctype html><div id="root"></div><script type="module" src="/assets/main.js"></script><link rel="stylesheet" href="/assets/main.css"><script src="https://elsewhere.example/skip.js"></script>';
const seen = [];
let sequence = 0;

function defaultResponse(url) {
  const p = new URL(url).pathname;
  if (p === '/') return new Response(homepage, { headers: { 'content-type': 'text/html' } });
  if (['/login','/register','/trade','/futures','/wallet'].includes(p))
    return new Response('<!doctype html><div id="root"></div>', { headers: { 'content-type': 'text/html' } });
  if (p === '/api/v1/market/external/symbols') return Response.json({symbols:[{pair:'BTC/USDT'}]});
  if (p === '/api/v1/market/external/tickers/BTC-USDT') return Response.json({ticker:{pair:'BTC/USDT',lastPrice:'100'}});
  if (p === '/api/v1/market/external/candles/BTC-USDT') return Response.json({pair:'BTC/USDT',interval:'1h',candles:[{time:1700000000,open:100,high:102,low:99,close:101,volume:1}]});
  if (p === '/market/listings') return Response.json({assets:[]});
  if (p === '/assets/main.js')
    return new Response('const streams = ["ws.kraken.com", "api.voltextech.net"]', { headers: { 'content-type': 'application/javascript' } });
  if (p === '/assets/main.css')
    return new Response('body { margin: 0; }', { headers: { 'content-type': 'text/css' } });
  throw Error(`Unexpected GET ${url}`);
}

// Use the real CLI module without network, credentials, source changes or a second server.
async function run(respond = defaultResponse) {
  const oldArgv = process.argv;
  const oldFetch = globalThis.fetch;
  const oldLog = console.log;
  const oldExitCode = process.exitCode;
  const lines = [];
  seen.length = 0;
  process.argv = [process.execPath, 'scripts/qa-beget-ru-preflight.mjs', origin];
  process.exitCode = 0;
  console.log = (...args) => lines.push(args.join(' '));
  globalThis.fetch = async (url, init) => {
    const href = String(url);
    assert.equal(new URL(href).origin, origin, 'Never follow external URLs in the fixture');
    assert.equal(init.redirect, 'manual', 'Do not silently follow redirects');
    assert.deepEqual(Object.keys(init.headers), ['Accept'], 'Never send credentials in preflight');
    assert.equal(init.method ?? 'GET', 'GET', 'Only safe GET requests');
    seen.push(new URL(href).pathname + new URL(href).search);
    return respond(href);
  };
  try {
    await import(`./qa-beget-ru-preflight.mjs?offline-test=${++sequence}`);
    assert.equal(lines.length, 1, 'One JSON report is emitted');
    return { report: JSON.parse(lines[0]), exitCode: process.exitCode, paths: [...seen] };
  } finally {
    globalThis.fetch = oldFetch;
    console.log = oldLog;
    process.argv = oldArgv;
    process.exitCode = oldExitCode;
  }
}

test('a clean gateway reports limited GET-only success without claiming RF reachability', async () => {
  const { report, exitCode, paths } = await run();
  assert.equal(exitCode, 0);
  assert.equal(report.origin, origin);
  assert.equal(report.checks.length, 12);
  assert.ok(report.checks.every(check => check.status === 'PASS'));
  assert.deepEqual(paths, ['/', '/login', '/register', '/trade?pair=BTC%2FUSDT', '/futures', '/wallet', '/api/v1/market/external/symbols', '/api/v1/market/external/tickers/BTC-USDT', '/api/v1/market/external/candles/BTC-USDT?interval=1h&limit=2', '/market/listings', '/assets/main.js', '/assets/main.css']);
  assert.deepEqual(report.bundleDirectDependencyHints.sort(), ['api.voltextech.net', 'ws.kraken.com']);
  assert.match(report.networkProof, /NOT ESTABLISHED/);
  assert.ok(report.limitations.some(x => x.includes('no login, trading or WebSocket tests')));
});

test('a redirected API is an explicit failure, not a successful proxy', async () => {
  const { report, exitCode } = await run(url => new URL(url).pathname === '/api/v1/market/external/symbols'
    ? new Response('', { status: 302, headers: { location: 'https://untrusted.example/' } })
    : defaultResponse(url));
  assert.equal(exitCode, 1);
  assert.deepEqual(report.checks.filter(x => x.status === 'FAIL').map(x => [x.name, x.error]), [['api-symbols', 'http_302']]);
});

test('a wrong JS MIME type fails, even when the page itself is HTTP 200', async () => {
  const { report, exitCode } = await run(url => new URL(url).pathname === '/assets/main.js'
    ? new Response('<html>login required</html>', { headers: { 'content-type': 'text/html' } })
    : defaultResponse(url));
  assert.equal(exitCode, 1);
  assert.ok(report.checks.some(x => x.name === 'html-asset' && x.error?.startsWith('not_js_or_css:')));
});

test('HTML without discoverable JS/CSS is not declared healthy', async () => {
  const { report, exitCode } = await run(url => new URL(url).pathname === '/'
    ? new Response('<html>no assets</html>', { headers: { 'content-type': 'text/html' } })
    : defaultResponse(url));
  assert.equal(exitCode, 1);
  assert.equal(report.checks.length, 11);
  assert.deepEqual(report.checks.filter(x => x.status === 'FAIL').map(x => x.name), ['homepage', 'initial-assets']);
  assert.ok(report.checks.filter(x => !['homepage', 'initial-assets'].includes(x.name)).every(x => x.status === 'PASS'));
});

test('invalid API JSON is a failure even with HTTP 200 and JSON content type', async () => {
  const { report, exitCode } = await run(url => new URL(url).pathname === '/market/listings'
    ? new Response('{', { headers: { 'content-type': 'application/json' } })
    : defaultResponse(url));
  assert.equal(exitCode, 1);
  assert.ok(report.checks.some(x => x.name === 'market-listings' && x.status === 'FAIL'));
});
