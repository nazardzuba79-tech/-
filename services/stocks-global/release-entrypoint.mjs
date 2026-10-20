// Release-only launcher. Configuration and PostgreSQL readiness precede imports
// of the gateway, market clients and any possible local ledger implementation.
import { releaseConfig, verifyReleaseAuthority } from './release-config.mjs';

try {
  const config = releaseConfig(process.env);
  await verifyReleaseAuthority(config);
  const { createAuthorityAdapter } = await import('./authority-adapter.mjs');
  const { createServer } = await import('./server.mjs');
  const { createStocksRuntimeMarket } = await import('./runtime-market.mjs');
  const app = await createServer({
    port: config.port,
    accountAuthority: createAuthorityAdapter(config),
    tradePrincipals: config.tradePrincipals,
    hub: createStocksRuntimeMarket({
      enabled: process.env.STOCKS_BINANCE_WS_ENABLED ?? 'false', authorityMode: true,
    }),
    ...(process.env.STOCKS_GLOBAL_DIST ? { dist: process.env.STOCKS_GLOBAL_DIST } : {}),
  });
  console.log('STOCKS_RELEASE_LISTENING ' + app.port);
  let stopping = false;
  const stop = async () => { if (stopping) return; stopping = true; await app.close(); };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
} catch (error) {
  // Never print configuration, URLs, keys, identities or underlying fetch errors.
  console.error(/^STOCKS_RELEASE_[A-Z_]+$/.test(error?.code) ? error.code : 'STOCKS_RELEASE_START_FAILED');
  process.exitCode = 1;
}
