import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { reviewDeployment } from './src/mobile-review/deployment';

// Separate entry/public directory: regular `vite build` cannot ship these clients.
export default defineConfig(() => {
  // Fail the build if a developer accidentally supplies production endpoints.
  reviewDeployment(process.env);
  const fonts = ['cyrillic-ext', 'cyrillic', 'latin-ext', 'latin'].map(name => `fonts/inter/${name}.woff2`);
  const localOnly: Plugin = {
    name: 'mobile-review-local-only',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const host = req.headers.host || '';
        if (!/^(?:localhost|127\.0\.0\.1|\[::1\])(?::[0-9]+)?$/i.test(host)) {
          res.statusCode = 403; res.end('Local review only'); return;
        }
        if (fonts.includes((req.url || '').slice(1))) {
          res.setHeader('Content-Type', 'font/woff2'); res.end(readFileSync(resolve(__dirname, 'public', req.url!.slice(1)))); return;
        }
        if (/^\/(pwa|telegram)\/?(?:\?|$)/.test(req.url || '')) req.url = '/mobile-review.html';
        next();
      });
    },
    generateBundle(_, bundle) {
      // Exact build-time allowlist. No runtime response ever enters CacheStorage.
      for (const font of fonts) this.emitFile({ type: 'asset', fileName: font, source: readFileSync(resolve(__dirname, 'public', font)) });
      const files = [...new Set([...Object.keys(bundle), ...fonts])].map(name => `/${name}`);
      const hash = createHash('sha256').update(JSON.stringify(files));
      for (const font of fonts) hash.update(readFileSync(resolve(__dirname, 'public', font)));
      for (const asset of ['offline.html', 'manifest.webmanifest', 'brand.svg', 'icon-180.png', 'icon-192.png', 'icon-512.png', 'icon-maskable-512.png']) {
        hash.update(readFileSync(resolve(__dirname, 'mobile-review/public/mobile', asset)));
      }
      const version = hash.digest('hex').slice(0, 12);
      let worker = readFileSync(resolve(__dirname, 'mobile-review/sw.template.js'), 'utf8');
      worker = worker.replace('__BUILD_VERSION__', version).replace('__STATIC_ASSETS__', JSON.stringify(files.filter(f => f !== '/mobile-review.html')));
      this.emitFile({ type: 'asset', fileName: 'mobile/sw.js', source: worker });
    },
  };
  return {
    plugins: [react(), localOnly],
    publicDir: 'mobile-review/public',
    // No .env.production or inherited application configuration is read.
    envDir: 'mobile-review/no-env',
    define: { 'import.meta.env.VITE_API_URL': JSON.stringify('/__disabled_review_api__') },
    server: { host: '127.0.0.1', port: 4178, strictPort: true },
    build: { outDir: 'dist-mobile-review', rollupOptions: { input: resolve(__dirname, 'mobile-review.html') } },
    // Built preview's server adds a strict CSP; dev needs Vite's local HMR socket.
    base: '/',
  };
});
