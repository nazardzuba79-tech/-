import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
import { toResponse } from '../src/services/copyTrading/SyntheticCopyTradingEngine';
import { REVIEW_SYNTHETIC_STATE_ID } from '../src/services/copyTrading/reviewSyntheticHistory';
import { createReviewCalendarClock } from '../src/services/copyTrading/reviewCalendarClock';
import { createNazarPresentationState, NAZAR_PRESENTATION_REVISION } from '../src/services/copyTrading/nazarPresentation';
import { createKseniaReviewState, advanceKseniaReview, kseniaReviewResponse } from '../src/services/copyTrading/kseniaReview';
import { KrakenMarketDataService } from '../src/services/KrakenMarketDataService';
import { SpotPeriodReferenceService, parseSpotReferencePairs } from '../src/services/marketData/SpotPeriodReferenceService';

// Loaded ONLY for the isolated review build/preview, never by frontend Docker.
export default defineConfig({
  define: { 'import.meta.env.VITE_API_URL': JSON.stringify('/api/v1') },
  build: { rollupOptions: { input: fileURLToPath(new URL('./review.html', import.meta.url)) } },
  plugins: [react(), {
    name: 'isolated-voltex-review',
    generateBundle() {
      const synthetic = createNazarPresentationState(new Date());
      this.emitFile({ type: 'asset', fileName: 'review-build.json', source: JSON.stringify({
        kind: 'isolated-visual-review', commit: process.env.RENDER_GIT_COMMIT ?? 'local',
        productionApi: false, builtAt: new Date().toISOString(),
        synthetic: { stateId: REVIEW_SYNTHETIC_STATE_ID, version: synthetic.version, presentationRevision: NAZAR_PRESENTATION_REVISION,
          inception: synthetic.initialEquityDate, simulatedAt: synthetic.simulatedAt },
      }) });
      // Explicitly versioned presentation reset on this revision, then append
      // elapsed days on future builds. The middleware disables stale caching.
      // No user record, account, token, balance fixture, database or API proxy.
      this.emitFile({ type: 'asset', fileName: 'review-synthetic.json', source: JSON.stringify(toResponse(synthetic)) });
    },
    configurePreviewServer(server) {
      // Existing review GET route now follows calendar time at runtime. The
      // emitted JSON remains a build artifact/fallback, never the live clock.
      const calendar = createReviewCalendarClock(undefined, createNazarPresentationState);
      let localKsenia: ReturnType<typeof createKseniaReviewState> | undefined;
      // Local preview calls the same real read-only history service directly;
      // Render uses the existing isolated backend proxy below, never this path.
      const localSpotHistory = !process.env.RENDER
        ? new SpotPeriodReferenceService(new KrakenMarketDataService(undefined, undefined, {}, true)) : null;
      server.middlewares.use(async (req, res, next) => {
        res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; font-src 'self' data:; connect-src 'self' wss://ws.kraken.com https://api.kraken.com; form-action 'none'; frame-ancestors 'none'; base-uri 'self'");
        res.setHeader('Cache-Control', 'no-store');
        res.setHeader('X-Robots-Tag', 'noindex, nofollow');
        const reviewPath = req.url?.split('?')[0];
        const isSpotReferenceRead = reviewPath === '/review-api/market/external/period-references';
        if (['GET', 'HEAD'].includes(req.method ?? '') && (isSpotReferenceRead || ['/review-api/copy-trading/ksenia', '/review-api/copy-trading/identities'].includes(reviewPath ?? ''))) {
          res.setHeader('Content-Type', 'application/json; charset=utf-8');
          try {
            if (isSpotReferenceRead && localSpotHistory) {
              const query = new URL(req.url!, 'http://localhost').searchParams;
              const pairs = parseSpotReferencePairs(Object.fromEntries([...new Set(query.keys())].map(key => [key, query.getAll(key).length === 1 ? query.get(key) : query.getAll(key)])));
              if (!pairs) { res.statusCode = 400; res.end(JSON.stringify({ error: 'Invalid market history pairs' })); return; }
              res.end(req.method === 'HEAD' ? undefined : JSON.stringify(await localSpotHistory.references(pairs))); return;
            }
            if (!isSpotReferenceRead && process.env.REVIEW_LOCAL_KSENIA === 'true' && !process.env.RENDER) {
              // Explicit LOCAL mathematical/visual QA; never a deployed fallback
              // for a failing backend and never creates customer/account data.
              if (reviewPath?.endsWith('/identities')) {
                res.end(JSON.stringify({ identities: [
                  { traderId: 'VX-001', displayName: 'Nazar', avatarUrl: null, avatarVersion: null, verified: false, premium: true },
                  { traderId: 'VX-KSENIA', displayName: 'Ksenia', avatarUrl: null, avatarVersion: null, verified: false, premium: true },
                ] })); return;
              }
              localKsenia ??= createKseniaReviewState();
              let missing = Math.max(0, Math.round((Date.parse(new Date().toISOString().slice(0, 10)) - Date.parse(localKsenia.simulatedAt.slice(0, 10))) / 86400000));
              while (missing > 0) { localKsenia = advanceKseniaReview(localKsenia, Math.min(missing, 365)); missing -= 365; }
              res.end(JSON.stringify(kseniaReviewResponse(localKsenia))); return;
            }
            const origin = process.env.REVIEW_BACKEND_ORIGIN;
            if (origin !== 'https://exchange-api-review.onrender.com') throw new Error('Review backend is not configured');
            const upstreamPath = isSpotReferenceRead ? req.url! : reviewPath!;
            const upstream = await fetch(origin + '/api/v1' + upstreamPath.slice('/review-api'.length), { signal: AbortSignal.timeout(60000), redirect: 'error', credentials: 'omit' });
            if (!upstream.ok) throw new Error('Review backend unavailable');
            res.end(req.method === 'HEAD' ? undefined : JSON.stringify(await upstream.json()));
          } catch { res.statusCode = 503; res.end(JSON.stringify({ error: 'Isolated review backend temporarily unavailable' })); }
          return;
        }
        if (!['GET', 'HEAD'].includes(req.method ?? '') || req.url?.startsWith('/api/')) {
          res.statusCode = 403;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ error: 'Isolated visual review: account APIs and all writes are disabled.' }));
          return;
        }
        if (req.url?.split('?')[0] === '/review-synthetic.json') {
          try {
            const snapshot = calendar.snapshot();
            res.setHeader('Content-Type', 'application/json; charset=utf-8');
            res.end(req.method === 'HEAD' ? undefined : snapshot);
          } catch {
            res.statusCode = 503;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ error: 'Review strategy history is temporarily unavailable.' }));
          }
          return;
        }
        if ((req.headers.accept ?? '').includes('text/html') && !req.url?.includes('.')) req.url = '/review.html';
        next();
      });
    },
  }],
  preview: { allowedHosts: ['voltex-review.onrender.com'] },
});
