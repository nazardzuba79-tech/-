import test from 'node:test';
import assert from 'node:assert/strict';

const origin = 'https://gateway.example.test';
const homepage = '<!doctype html><script type="module" src="/assets/main.js"></script><link rel="stylesheet" href="/assets/main.css"><script src="https://elsewhere.example/skip.js"></script>';
const seen = [];
let sequence = 0;

function defaultResponse(url) {
  const p = new URL(url).pathname;
  if (p === '/') return new Response(homepage, { headers: { 'content-type': 'text/html' } });
  if (p === '/login' || p === '/trade' || p === '/futures')
    return new Response('<!doctype html>', { headers: { 'content-type': 'text/html' } });
  if (p === '/api/v1/pairs' || p === '/market/listings')
    return new Response('[]', { headers: { 'content-type': 'application/json' } });
  if (p === '/assets/main.js')
    return new Response('const streams = ["ws.kraken.com", "api.voltextech.net"]', { headers: { 'content-type': 'application/javascript' } });
  if (p === '/assets/main.css')
    return new Response('body { margin: 0; }', { headers: { 'content-type': 'text/css' } });
  throw Error(\`Unexpected GET \${url}\`);
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
    await import(\`./qa-beget-ru-preflight.mjs?offline-test=\${++sequence}\`);
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
  assert.equal(report.checks.length, 8);
  assert.ok(report.checks.every(check => check.status === 'PASS'));
  assert.deepEqual(paths, ['/', '/login', '/trade?pair=BTC%2FUSDT', '/futures', '/api/v1/pairs', '/market/listings', '/assets/main.js', '/assets/main.css']);
  assert.deepEqual(report.bundleDirectDependencyHints.sort(), ['api.voltextech.net', 'ws.kraken.com']);
  assert.match(report.networkProof, /NOT ESTABLISHED/);
  assert.ok(report.limitations.some(x => x.includes('no login, trading or WebSocket tests')));
});

test('a redirected API is an explicit failure, not a successful proxy', async () => {
  const { report, exitCode } = await run(url => new URL(url).pathname === '/api/v1/pairs'
    ? new Response('', { status: 302, headers: { location: 'https://untrusted.example/' } })
    : defaultResponse(url));
  assert.equal(exitCode, 1);
  assert.deepEqual(report.checks.filter(x => x.status === 'FAIL').map(x => [x.name, x.error]), [['api-pairs', 'http_302']]);
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
  assert.equal(report.checks.length, 6);
  assert.ok(report.checks.every(x => x.status === 'PASS'));
});

test('invalid API JSON is a failure even with HTTP 200 and JSON content type', async () => {
  const { report, exitCode } = await run(url => new URL(url).pathname === '/market/listings'
    ? new Response('{', { headers: { 'content-type': 'application/json' } })
    : defaultResponse(url));
  assert.equal(exitCode, 1);
  assert.ok(report.checks.some(x => x.name === 'market-listings' && x.status === 'FAIL'));
});
