#!/usr/bin/env node
/** Local Trading Tools review only. Static files and a synthetic /me response.
 * Never proxies, connects to production, accepts mutations or reads secrets.
 * Build the frontend, then run this script. /__qa/module mounts only the actual
 * calculator workspace (StrictMode), with every business transport refused.
 */
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');
const ROOT = path.resolve(__dirname, '..');
const frontendRequire = createRequire(path.join(ROOT, 'frontend/package.json'));
const DIST = path.join(ROOT, 'frontend/dist');
const PORT = Number(process.env.TRADING_TOOLS_REVIEW_PORT || 4274);
const mime = { '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.webp': 'image/webp', '.png': 'image/png', '.woff2': 'font/woff2', '.ico': 'image/x-icon' };

function probeSource(moduleOnly) {
  return `(${function installProbe(moduleOnly) {
    const attempts = [], timers = [], copies = [], blockedResources = [];
    const trace = () => String(new Error().stack || '').split('\n').slice(2, 6).join('\n');
    const safePath = value => { try { const u = new URL(String(value), location.href); return u.origin + u.pathname; } catch { return '<invalid-url>'; } };
    const record = (kind, url, method = 'GET') => attempts.push({ kind, method, path: safePath(url), page:location.pathname, initiator: trace() });
    const actualFetch = window.fetch.bind(window);
    window.fetch = (input, init) => {
      const url = typeof input === 'string' || input instanceof URL ? String(input) : input.url;
      const method = init?.method || (typeof input === 'object' && input.method) || 'GET';
      record('fetch', url, method);
      const parsed = new URL(url, location.href);
      if (!moduleOnly && parsed.origin === location.origin && parsed.pathname === '/api/v1/me' && method === 'GET') return actualFetch(input, init);
      return Promise.reject(new Error('Fixture denied unexpected transport'));
    };
    const xhrOpen = XMLHttpRequest.prototype.open;
    XMLHttpRequest.prototype.open = function(method, url, ...rest) { this.__qaRequest = { method, url }; return xhrOpen.call(this, method, url, ...rest); };
    XMLHttpRequest.prototype.send = function() { const x = this.__qaRequest || {}; record('xhr', x.url, x.method); throw new Error('Fixture denied XHR'); };
    window.WebSocket = class { constructor(url) { record('WebSocket', url); throw new Error('Fixture denied WebSocket'); } };
    window.EventSource = class { constructor(url) { record('EventSource', url); throw new Error('Fixture denied EventSource'); } };
    Object.defineProperty(navigator, 'sendBeacon', { configurable: true, value: (url) => { record('sendBeacon', url, 'POST'); return false; } });
    for (const name of ['setTimeout', 'setInterval', 'requestAnimationFrame']) {
      const original = window[name].bind(window);
      window[name] = (callback, delay, ...args) => { timers.push({ kind: name, delay: Number(delay) || 0, page:location.pathname, initiator: trace() }); return original(callback, delay, ...args); };
    }
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async (value) => { copies.push(String(value)); } } });
    document.addEventListener('securitypolicyviolation', event => blockedResources.push({ path:safePath(event.blockedURI), directive:event.effectiveDirective, source:event.sourceFile.split('?')[0], line:event.lineNumber }));
    window.__toolsProbe = { attempts, timers, copies, blockedResources };
  }.toString()})(${moduleOnly});`;
}

async function buildModule() {
  const esbuild = frontendRequire('esbuild');
  const result = await esbuild.build({
    stdin: { contents: `import React,{useState} from 'react';
      import {createRoot} from 'react-dom/client';
      import {LanguageProvider} from './src/lib/i18n';
      import {TradingToolsWorkspace} from './src/pages/trading-tools/TradingToolsWorkspace';
      function Fixture(){const [mode,setMode]=useState('pnl');const [mounted,setMounted]=useState(true);
        window.__toolsFixture={unmount:()=>setMounted(false),remount:()=>setMounted(true)};
        return <LanguageProvider><div className="trading-tools-page">{mounted&&<TradingToolsWorkspace mode={mode} onModeChange={setMode}/>}</div></LanguageProvider>;}
      createRoot(document.getElementById('root')).render(<React.StrictMode><Fixture/></React.StrictMode>);`,
      resolveDir: path.join(ROOT, 'frontend'), sourcefile: 'trading-tools-isolated-fixture.tsx', loader: 'tsx' },
    outfile: 'module.js', bundle: true, write: false, platform: 'browser', format: 'esm', external:['/fonts/*'],
    // Development React deliberately replays StrictMode effects in this
    // isolated fixture; the integrated /tools route uses the production build.
    define: { 'process.env.NODE_ENV': '"development"' }, logLevel: 'silent',
  });
  return new Map(result.outputFiles.map(file => [path.basename(file.path), file.contents]));
}

async function createReviewServer(port = PORT) {
  const moduleFiles = await buildModule();
  const hits = [];
  const bootstrap = `<script>localStorage.setItem('exchange_token',localStorage.getItem('exchange_token')||'tools-fixture-user-a');localStorage.setItem('exchange_lang','ru');${probeSource(false)}</script>`;
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'");
    if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405); return res.end('Read-only fixture'); }
    if (url.pathname === '/__qa/hits') { res.setHeader('Content-Type', 'application/json'); return res.end(JSON.stringify(hits)); }
    if (url.pathname === '/__qa/module') {
      res.setHeader('Content-Type', 'text/html');
      return res.end(`<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><style>body{margin:0;background:#101014}</style><script>localStorage.setItem('exchange_lang','ru');${probeSource(true)}</script><link rel="stylesheet" href="/__qa/module.css"></head><body><div id="root"></div><script type="module" src="/__qa/module.js"></script></body></html>`);
    }
    if (url.pathname.startsWith('/__qa/module.')) {
      const name = path.basename(url.pathname), bytes = moduleFiles.get(name);
      if (!bytes) { res.writeHead(404); return res.end(); }
      res.setHeader('Content-Type', mime[path.extname(name)]); return res.end(bytes);
    }
    if (url.pathname.startsWith('/api/')) {
      hits.push({ method: req.method, path: url.pathname, at: new Date().toISOString() });
      res.setHeader('Content-Type', 'application/json');
      if (url.pathname === '/api/v1/me') {
        const fixtureUser=req.headers.authorization==='Bearer tools-fixture-user-b'?'b':'a';
        return res.end(JSON.stringify({ id: `tools-fixture-${fixtureUser}`, email: `review-${fixtureUser}@example.invalid`, displayName: 'Review', isAdmin: false, role: 'USER', avatarUrl: null, emailVerified: true, kycStatus: 'NONE' }));
      }
      res.writeHead(403); return res.end(JSON.stringify({ error: 'No fixture or upstream for this endpoint' }));
    }
    let name;
    try { name = path.resolve(DIST, '.' + decodeURIComponent(url.pathname)); } catch { res.writeHead(400); return res.end(); }
    if (name !== DIST && !name.startsWith(DIST + path.sep)) { res.writeHead(403); return res.end(); }
    if (name !== DIST && fs.existsSync(name) && fs.statSync(name).isFile()) {
      res.setHeader('Content-Type', mime[path.extname(name)] || 'application/octet-stream'); return res.end(fs.readFileSync(name));
    }
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.end(fs.readFileSync(path.join(DIST, 'index.html'), 'utf8').replace('<head>', '<head>' + bootstrap));
  });
  await new Promise(resolve => server.listen(port, '127.0.0.1', resolve));
  return { server, hits, port: server.address().port };
}

module.exports = { createReviewServer, probeSource };
if (require.main === module) createReviewServer().then(({ port }) => console.log(`Trading Tools local review: http://127.0.0.1:${port}/tools`)).catch(error => { console.error(error); process.exitCode = 1; });
