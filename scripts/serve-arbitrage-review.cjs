#!/usr/bin/env node
/** Local, read-only fixture host for the production frontend build.
 * No proxy, secrets, upstream calls, database or transaction handlers.
 * Build first with VITE_API_URL=/api/v1; run `node scripts/serve-arbitrage-review.cjs`.
 * /__qa/hits reports shell requests independently of static assets.
 */
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '../frontend/dist');
const port = Number(process.env.ARBITRAGE_REVIEW_PORT || 4271);
const hits = [];
const mime = { '.js':'text/javascript', '.css':'text/css', '.svg':'image/svg+xml', '.webp':'image/webp', '.png':'image/png', '.woff2':'font/woff2', '.ico':'image/x-icon', '.json':'application/json' };
const fixture = { id:'arbitrage-review', email:'review@example.invalid', isAdmin:false, role:'USER', emailVerified:true, avatarUrl:null, kycStatus:'NONE' };
const bootstrap = `<script>localStorage.setItem('exchange_token','local-fixture-no-production-access');localStorage.setItem('exchange_lang','ru');</script>`;
http.createServer((req,res) => {
  const url = new URL(req.url, 'http://127.0.0.1');
  res.setHeader('Cache-Control','no-store');
  // Defense in depth: the review cannot contact Render/Neon/CDNs, even if a
  // regression accidentally adds a new network dependency to this page.
  res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'");
  if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405); return res.end('Read-only local review'); }
  if (url.pathname === '/__qa/hits') { res.setHeader('Content-Type','application/json'); return res.end(JSON.stringify(hits,null,2)); }
  if (url.pathname.startsWith('/api/')) {
    hits.push({ path:url.pathname+url.search, at:new Date().toISOString() });
    res.setHeader('Content-Type','application/json');
    if(url.pathname === '/api/v1/me') return res.end(JSON.stringify(fixture));
    res.writeHead(404); return res.end(JSON.stringify({ error:'No fixture for this endpoint' }));
  }
  const name = path.resolve(root, '.' + decodeURIComponent(url.pathname));
  if(!name.startsWith(root + path.sep) && name !== root) { res.writeHead(403); return res.end(); }
  if (name !== root && fs.existsSync(name) && fs.statSync(name).isFile()) {
    res.setHeader('Content-Type', mime[path.extname(name)] || 'application/octet-stream');
    return res.end(fs.readFileSync(name));
  }
  res.setHeader('Content-Type','text/html; charset=utf-8');
  res.end(fs.readFileSync(path.join(root,'index.html'),'utf8').replace('<head>','<head>'+bootstrap));
}).listen(port,'127.0.0.1',() => console.log(`Local arbitrage review: http://127.0.0.1:${port}/arbitrage`));
