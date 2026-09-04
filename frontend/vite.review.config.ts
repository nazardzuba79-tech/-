import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
import { createInitialState, toResponse } from '../src/services/copyTrading/SyntheticCopyTradingEngine';

// Loaded ONLY for the isolated review build/preview, never by frontend Docker.
export default defineConfig({
  define: { 'import.meta.env.VITE_API_URL': JSON.stringify('/api/v1') },
  build: { rollupOptions: { input: fileURLToPath(new URL('./review.html', import.meta.url)) } },
  plugins: [react(), {
    name: 'isolated-voltex-review',
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: 'review-build.json', source: JSON.stringify({
        kind: 'isolated-visual-review', commit: process.env.RENDER_GIT_COMMIT ?? 'local',
        productionApi: false, builtAt: new Date().toISOString(),
      }) });
      // Explicitly labelled synthetic sample, produced by the unchanged engine.
      // No user record, account, token, balance fixture, database or API proxy.
      this.emitFile({ type: 'asset', fileName: 'review-synthetic.json', source: JSON.stringify(toResponse(createInitialState(new Date()))) });
    },
    configurePreviewServer(server) {
      server.middlewares.use((req, res, next) => {
        res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; font-src 'self' data:; connect-src 'self' wss://ws.kraken.com https://api.kraken.com; form-action 'none'; frame-ancestors 'none'; base-uri 'self'");
        res.setHeader('Cache-Control', 'no-store');
        res.setHeader('X-Robots-Tag', 'noindex, nofollow');
        if (!['GET', 'HEAD'].includes(req.method ?? '') || req.url?.startsWith('/api/')) {
          res.statusCode = 403;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ error: 'Isolated visual review: account APIs and all writes are disabled.' }));
          return;
        }
        if ((req.headers.accept ?? '').includes('text/html') && !req.url?.includes('.')) req.url = '/review.html';
        next();
      });
    },
  }],
  preview: { allowedHosts: ['voltex-review.onrender.com'] },
});
