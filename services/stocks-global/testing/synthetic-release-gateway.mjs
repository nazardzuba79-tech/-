// Test launcher only: release-entrypoint.mjs with a synthetic in-memory market instead of the live
// market clients, so a disposable-PostgreSQL test can exercise the two-trader path (both server gates
// asserted by the authority's readiness) without any outbound request. Same release authority
// (openReleaseAuthority: readiness, issuer, principals digest) and the same gateway createServer.
import { openReleaseAuthority } from '../release-authority.mjs';
import { CATALOG, instrument } from '../catalog.mjs';

try {
  const { config, authority } = await openReleaseAuthority();
  const { createServer } = await import('../server.mjs');
  const hub = {
    metrics: { syntheticSourceStarts: 0 },
    catalogue: async () => CATALOG.map(row => ({ ...row, online: row.provider !== 'moex', exists: true })),
    history: async (id, interval = '15m') => {
      const item = instrument(id), step = { '1m': 60, '5m': 300, '15m': 900, '1h': 3600, '4h': 14400, '1d': 86400 }[interval] ?? 900;
      const end = Math.floor(Date.now() / 1000 / step) * step;
      return { instrumentId: id, interval, currency: item.currency, provider: item.provider, delaySeconds: item.delaySeconds, receivedAt: Date.now(), fixture: true,
        candles: Array.from({ length: 120 }, (_, index) => ({ time: end - (119 - index) * step, open: 100, high: 100.4, low: 99.6, close: 100, volume: 1000 })) };
    },
    quote: async id => {
      const item = instrument(id), at = Date.now(); hub.metrics.syntheticSourceStarts++;
      return { instrumentId: id, provider: item.provider, nativeCurrency: item.currency, bid: '100', ask: '100', timestamp: at, receivedAt: at, verified: true, marketOpen: true,
        eventId: 'synthetic-release-' + id + '-' + at, capacity: '1.00000000', prices: { USDT: { buy: '100', sell: '100' }, USDC: { buy: '100', sell: '100' } },
        fx: item.currency === 'USDT' ? {} : { USDT: { rate: '1', timestamp: at, maxAgeMs: 180000 } } };
    },
  };
  const app = await createServer({ port: config.port, financialEnabled: config.tradingEnabled, accountAuthority: authority, tradePrincipals: config.tradePrincipals, hub });
  console.log('STOCKS_RELEASE_LISTENING ' + app.port);
  const stop = () => app.close();
  process.on('SIGINT', stop); process.on('SIGTERM', stop);
} catch (error) {
  console.error(/^STOCKS_RELEASE_[A-Z_]+$/.test(error?.code) ? error.code : 'STOCKS_RELEASE_START_FAILED');
  process.exitCode = 1;
}
