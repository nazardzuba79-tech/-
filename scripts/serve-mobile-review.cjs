/* Local static fixture preview. No proxy, database, backend or deployment hooks. */
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '../frontend/dist-mobile-review');
const types = { '.html':'text/html; charset=utf-8', '.js':'text/javascript', '.css':'text/css', '.svg':'image/svg+xml', '.png':'image/png', '.webmanifest':'application/manifest+json' };
function createReviewServer({ workerRevision = () => '' } = {}) {
  return http.createServer((req, res) => {
    const host = req.headers.host || '';
    if (!/^(?:localhost|127\.0\.0\.1|\[::1\])(?::[0-9]+)?$/i.test(host)) { res.writeHead(403); return res.end('Local review only'); }
    if (!['GET','HEAD'].includes(req.method)) { res.writeHead(405); return res.end('Review is read only'); }
    const url = new URL(req.url, 'http://localhost');
    const requested = ['/pwa','/pwa/','/telegram','/telegram/'].includes(url.pathname) ? '/mobile-review.html' : url.pathname;
    let file;
    try { file = path.resolve(root, '.' + decodeURIComponent(requested)); } catch { res.writeHead(400); return res.end(); }
    if (!file.startsWith(root + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) { res.writeHead(404); return res.end('Not found'); }
    const ext = path.extname(file);
    res.setHeader('Content-Type', types[ext] || 'application/octet-stream');
    res.setHeader('Cache-Control', requested.startsWith('/assets/') ? 'public, max-age=31536000, immutable' : 'no-store');
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'none'; worker-src 'self'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'");
    res.setHeader('X-Content-Type-Options','nosniff');
    if (requested === '/mobile/sw.js') {
      res.setHeader('Service-Worker-Allowed','/');
      res.setHeader('Content-Security-Policy', "default-src 'none'; script-src 'self'; connect-src 'self'");
      if (workerRevision()) return res.end(fs.readFileSync(file, 'utf8').replace("const VERSION = '", `const VERSION = '${workerRevision()}-`));
    }
    if (req.method === 'HEAD') return res.end();
    fs.createReadStream(file).pipe(res);
  });
}
module.exports = { createReviewServer };
if (require.main === module) {
  const port = Number(process.env.MOBILE_REVIEW_PORT || 4178);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('MOBILE_REVIEW_PORT must be an integer between 1 and 65535');
  createReviewServer().listen(port, '127.0.0.1', () => console.log(`Local review: http://127.0.0.1:${port}/pwa and http://127.0.0.1:${port}/telegram?mock=1`));
}
