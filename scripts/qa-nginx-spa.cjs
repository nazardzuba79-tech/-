// Real nginx HTTP regression, not a JavaScript simulation of try_files.
// Usage: node scripts/qa-nginx-spa.cjs <nginx-executable> <mime.types> [baseline-ref]
// Uses only temporary routing fixtures and an existing public avatar; no API,
// account data or production requests. Does not claim full React/browser QA.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const net = require('node:net');
const { once } = require('node:events');
const { spawn, spawnSync, execFileSync } = require('node:child_process');

const repo = path.resolve(__dirname, '..');
const executable = path.resolve(process.argv[2] || 'nginx');
const mimeTypes = path.resolve(process.argv[3] || '/etc/nginx/mime.types');
const baselineRef = process.argv[4] || 'origin/main';
const baseline = execFileSync('git', ['show', `${baselineRef}:frontend/nginx.conf`], { cwd: repo, encoding: 'utf8', windowsHide: true });
const candidate = fs.readFileSync(path.join(repo, 'frontend/nginx.conf'), 'utf8');
assert.match(baseline, /try_files \$uri \$uri\/ \/index\.html;/);
assert.match(candidate, /try_files \$uri \/index\.html;/);
assert.doesNotMatch(candidate, /try_files \$uri \$uri\//);
const cache = path.join(repo, 'node_modules/.cache/nginx-qa');
fs.mkdirSync(cache, { recursive: true });
const run = fs.mkdtempSync(path.join(cache, 'http-'));
const html = path.join(run, 'html');
fs.mkdirSync(path.join(html, 'copy-trading/avatars'), { recursive: true });
fs.mkdirSync(path.join(html, 'assets'), { recursive: true });
const index = '<!doctype html><title>SPA routing regression fixture</title><div id="root"></div>';
const js = '/* routing fixture: immutable Vite-style hashed asset */';
const css = '/* routing fixture */ :root { color-scheme: dark; }';
const avatar = fs.readFileSync(path.join(repo, 'frontend/public/copy-trading/avatars/moon-rabbit.webp'));
fs.writeFileSync(path.join(html, 'index.html'), index);
fs.writeFileSync(path.join(html, 'assets/index-qa123.js'), js);
fs.writeFileSync(path.join(html, 'assets/index-qa123.css'), css);
fs.writeFileSync(path.join(html, 'copy-trading/avatars/moon-rabbit.webp'), avatar);
const unix = value => value.replace(/\\/g, '/');
const results = [];

async function freePort() {
  const server = net.createServer();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const port = server.address().port;
  await new Promise(resolve => server.close(resolve));
  return port;
}

async function check(label, source) {
  const port = await freePort();
  const prefix = path.join(run, label);
  fs.mkdirSync(path.join(prefix, 'logs'), { recursive: true });
  fs.mkdirSync(path.join(prefix, 'temp'), { recursive: true });
  const serverBlock = source.replace('listen 80;', `listen 127.0.0.1:${port};`)
    .replace('root /usr/share/nginx/html;', `root "${unix(html)}";`);
  // Production server block is unchanged except loopback port/test document root.
  const config = `daemon off;\nmaster_process off;\npid logs/nginx.pid;\nerror_log logs/error.log;\nevents { worker_connections 128; }\nhttp { include "${unix(mimeTypes)}";\n${serverBlock}\n}`;
  fs.writeFileSync(path.join(prefix, 'test.conf'), config);
  const args = ['-p', unix(prefix) + '/', '-c', 'test.conf'];
  const syntax = spawnSync(executable, [...args, '-t'], { cwd: prefix, encoding: 'utf8', windowsHide: true });
  assert.equal(syntax.status, 0, syntax.error?.message || syntax.stderr);
  const child = spawn(executable, args, { cwd: prefix, windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] });
  let failure;
  child.on('error', error => { failure = error; });
  child.stderr.resume();
  const origin = `http://127.0.0.1:${port}`;
  const request = route => fetch(origin + route, { signal: AbortSignal.timeout(5000) });
  try {
    let ready = false;
    for (let attempt = 0; attempt < 50; attempt += 1) {
      if (failure) throw failure;
      try { ready = (await request('/')).ok; } catch {}
      if (ready) break;
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    assert.ok(ready, 'nginx starts on loopback');
    const rows = [];
    for (const route of ['/', '/copy-trading', '/copy-trading/', '/copy-trading?period=ALL',
      '/copy-trading/profile-id', '/trade', '/futures', '/markets', '/wallet', '/card']) {
      const expected = label === 'before' && /^\/copy-trading(?:\/?|\?period=ALL)$/.test(route) ? 403 : 200;
      for (const pass of ['direct', 'refresh']) {
        const response = await request(route);
        assert.equal(response.status, expected, `${label} ${pass} ${route}`);
        const text = await response.text();
        if (expected === 200) {
          assert.equal(text, index, `${route} serves index, not a directory listing`);
          assert.match(response.headers.get('content-type'), /text\/html/);
          assert.equal(response.headers.get('cache-control'), 'no-cache');
        }
        rows.push({ route, pass, status: response.status });
      }
      if (expected === 200) {
        const response = await fetch(origin + route, { method: 'HEAD', signal: AbortSignal.timeout(5000) });
        assert.equal(response.status, 200);
        assert.equal(await response.text(), '');
      }
    }
    const image = await request('/copy-trading/avatars/moon-rabbit.webp');
    assert.equal(image.status, 200);
    assert.equal(image.headers.get('content-type'), 'image/webp');
    assert.deepEqual(Buffer.from(await image.arrayBuffer()), avatar);
    for (const [url, body, type] of [['/assets/index-qa123.js', js, 'javascript'], ['/assets/index-qa123.css', css, 'text/css']]) {
      const response = await request(url);
      assert.equal(response.status, 200);
      assert.equal(await response.text(), body);
      assert.ok(response.headers.get('content-type').includes(type));
      assert.equal(response.headers.get('cache-control'), 'public, max-age=31536000, immutable');
    }
    assert.equal((await request('/assets/missing.js')).status, 404);
    assert.equal((await request('/assets/')).status, 403); // No directory listing.
    results.push({ label, syntax: 'PASS', rows, realAvatarExact: true, immutableAssets: true, missingAsset: 404, directoryListing: false });
    console.log(`${label}: actual nginx route/refresh/HEAD/static/cache assertions PASS`);
  } finally {
    if (child.pid && child.exitCode === null) {
      const exited = once(child, 'exit');
      const stop = spawnSync(executable, [...args, '-s', 'quit'], { cwd: prefix, windowsHide: true, encoding: 'utf8' });
      if (stop.status !== 0) child.kill();
      let timer;
      await Promise.race([exited, new Promise(resolve => { timer = setTimeout(() => { child.kill(); resolve(); }, 3000); })]);
      clearTimeout(timer);
    }
  }
}

(async () => {
  try {
    await check('before', baseline);
    await check('after', candidate);
    console.log('PASS: reproduced baseline403; candidate SPA routes200; real avatar bytes/caching preserved. No production requests.');
  } finally {
    fs.writeFileSync(path.join(run, 'result.json'), JSON.stringify({ baselineRef, results }, null, 2));
    console.log(`Evidence: ${path.join(run, 'result.json')}`);
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
