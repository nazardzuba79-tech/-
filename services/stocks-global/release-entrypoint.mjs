// Release-only launcher. Configuration and PostgreSQL readiness precede imports
// of the gateway, market clients and any possible local ledger implementation.
import { openReleaseAuthority } from './release-authority.mjs';
import { createHostedIngress, publicOrigin } from './hosted-ingress.mjs';

try {
  const origin=process.env.STOCKS_PUBLIC_ORIGIN;
  if(origin)publicOrigin(origin);
  const { config, authority } = await openReleaseAuthority();
  const { createServer } = await import('./server.mjs');
  const { createReleaseMarket } = await import('./release-market.mjs');
  const app = await createServer({
    port: config.port,
    financialEnabled: config.tradingEnabled && process.env.STOCKS_MARKET_DATA_ENABLED === 'true',
    accountAuthority: authority,
    tradePrincipals: config.tradePrincipals,
    hub: createReleaseMarket(),
    ...(process.env.STOCKS_GLOBAL_DIST ? { dist: process.env.STOCKS_GLOBAL_DIST } : {}),
  });
  let ingress;
  try {
    if(origin)ingress=await createHostedIngress({origin,gatewayPort:app.port,port:Number(process.env.STOCKS_INGRESS_PORT??4438)});
  } catch(error) { await app.close(); throw error; }
  console.log('STOCKS_RELEASE_LISTENING ' + app.port);
  let stopping = false;
  const stop = async () => { if (stopping) return; stopping = true; await ingress?.close(); await app.close(); };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
} catch (error) {
  // Never print configuration, URLs, keys, identities or underlying fetch errors.
  console.error(/^STOCKS_RELEASE_[A-Z_]+$/.test(error?.code) ? error.code : 'STOCKS_RELEASE_START_FAILED');
  process.exitCode = 1;
}
