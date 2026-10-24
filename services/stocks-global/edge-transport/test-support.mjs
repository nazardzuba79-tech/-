import { createRequire } from 'node:module';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import { spawn, execFileSync } from 'node:child_process';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';

export const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
export const APP = 'https://app.example.invalid', API = 'https://api.example.invalid', KEY = 'ab'.repeat(32);
export const ENV = { STOCKS_PAGES_PROXY_ENABLED: 'true', STOCKS_PUBLIC_ORIGIN: APP, STOCKS_API_INGRESS_ORIGIN: API, STOCKS_EDGE_TRANSPORT_KEY: KEY };
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
export async function ephemeralPort() {
  const server = net.createServer(); await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port; await new Promise(resolve => server.close(resolve)); return port;
}
export async function pagesWorker(t, { bindings = ENV, outbound }) {
  const edgeRequire = createRequire(resolve(ROOT, 'workers/market-edge/package.json'));
  const { Miniflare, convertV4MiniflareOptions } = edgeRequire('miniflare');
  // This Miniflare version preserves request.url but replaces Host with its
  // loopback listener even for dispatchFetch/getWorker. Reconstitute ONLY that
  // platform header in the test harness; the actual Pages router/handler and
  // all Host checks remain unmodified. Unit tests also test a forged Host.
  const {build}=edgeRequire('esbuild');
  const bundle=await build({stdin:{contents:`import router from './output/pages-worker/index.js'; export default {fetch(request,env,ctx){const headers=new Headers(request.headers);headers.set('host',new URL(request.url).host);return router.fetch(new Request(request,{headers}),env,ctx);}}`,resolveDir:ROOT},bundle:true,format:'esm',external:['node:*'],write:false});
  const mf = new Miniflare(convertV4MiniflareOptions({ workers: [{ name: 'stocks-pages-fixture', modules: true,
    script: bundle.outputFiles[0].text, compatibilityDate: '2026-09-09', bindings,
    serviceBindings: { ASSETS: () => new Response('unchanged static fixture') }, outboundService: outbound }] }));
  t.after(() => mf.dispose()); await mf.ready; return mf;
}

// Explicit isolated DNS mapping only. With STOCKS_EDGE_NGINX_TEST=true this
// talks through a real Nginx TLS vhost, checks its synthetic CA and SNI name.
// Never opens a public port or fetches any production/provider hostname.
export async function originProxy(t, ingressPort, { apiOrigin } = {}) {
  const requests = []; const realNginx = process.env.STOCKS_EDGE_NGINX_TEST === 'true';
  let server, child, dir, port, ca;
  if (realNginx) {
    dir = await mkdtemp(join(tmpdir(), 'voltex-stocks-edge-')); port = await ephemeralPort();
    execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', join(dir, 'key.pem'), '-out', join(dir, 'cert.pem'), '-days', '1', '-subj', '/CN=api.example.invalid', '-addext', 'subjectAltName=DNS:api.example.invalid'], { stdio: 'ignore' });
    const snippet = (await readFile(resolve(ROOT, 'deploy/stocks-pages-ingress.location.conf.example'), 'utf8')).replace('127.0.0.1:4438', '127.0.0.1:' + ingressPort);
    const ordinaryApi=apiOrigin?`proxy_pass ${apiOrigin}; proxy_set_header Host $host;`:'return 404;';
    const config = `pid ${dir}/nginx.pid; error_log ${dir}/error.log; events { worker_connections 64; } http { access_log off; server { listen 127.0.0.1:${port} ssl; server_name api.example.invalid; ssl_certificate ${dir}/cert.pem; ssl_certificate_key ${dir}/key.pem; ${snippet}\n location / { ${ordinaryApi} } } }`;
    await writeFile(join(dir, 'nginx.conf'), config); ca = await readFile(join(dir, 'cert.pem'));
    execFileSync('nginx', ['-t', '-p', dir, '-c', join(dir, 'nginx.conf')], { stdio: 'ignore' });
    child = spawn('nginx', ['-p', dir, '-c', join(dir, 'nginx.conf'), '-g', 'daemon off;'], { stdio: 'ignore' });
    t.after(async () => { if (child.exitCode === null) { const exited = new Promise(resolve => child.once('exit', resolve)); child.kill('SIGTERM'); await exited; } assert.ok(resolve(dir).startsWith(resolve(tmpdir(), 'voltex-stocks-edge-'))); await rm(dir, { recursive: true, force: true }); });
    for (let i = 0; i < 60; i++) { if (child.exitCode !== null) throw Error('synthetic Nginx failed'); try { await new Promise((resolve, reject) => { const s = net.connect(port, '127.0.0.1', () => { s.destroy(); resolve(); }); s.on('error', reject); }); break; } catch { if (i === 59) throw Error('synthetic Nginx unavailable'); await delay(50); } }
  } else {
    // Local Windows fallback proves HTTP/header contracts only, NOT Nginx/TLS.
    server = http.createServer((req, res) => {
      const headers = {}; for (const key of ['host', 'origin', 'authorization', 'x-stocks-token', 'x-stocks-view', 'x-voltex-stocks-edge-time', 'x-voltex-stocks-edge-nonce', 'x-voltex-stocks-edge-digest', 'x-voltex-stocks-edge-signature']) if (req.headers[key]) headers[key] = req.headers[key];
      const up = http.request({ host: '127.0.0.1', port: ingressPort, path: req.url, method: req.method, headers }, response => { res.writeHead(response.statusCode, response.headers); response.pipe(res); }); up.on('error', () => res.writeHead(503).end()); req.pipe(up);
    }); await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); port = server.address().port;
    t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); });
  }
  const localFetch = async (request, allowApi=false) => {
    const url = new URL(request.url); assert.equal(url.origin, API, 'no external network/provider access');
    assert.ok(url.pathname.startsWith('/__stocks_global/') || allowApi && url.pathname.startsWith('/api/v1/'));
    const headers = Object.fromEntries(request.headers); headers.host = url.host;
    requests.push({ method: request.method, path: url.pathname, auth: Boolean(headers.authorization) });
    const body=request.body===null?undefined:Buffer.from(await request.arrayBuffer());
    return new Promise((resolve, reject) => {
      const client = realNginx ? https : http;
      const req = client.request({ host: '127.0.0.1', port, path: url.pathname + url.search, method: request.method, headers,
        ...(realNginx ? { servername: url.hostname, ca, rejectUnauthorized: true } : {}) }, response => {
        const chunks = []; response.on('data', c => chunks.push(c)); response.on('end', () => resolve(new Response(Buffer.concat(chunks), { status: response.statusCode, headers: response.headers })));
      }); req.on('error', reject); req.end(body);
    });
  };
  return { outbound:request=>localFetch(request), tlsFetch:request=>localFetch(request,true), requests, mode: realNginx ? 'real Nginx TLS + pinned synthetic CA/SNI' : 'HTTP local stand-in (Nginx/TLS NOT_RUN)' };
}
