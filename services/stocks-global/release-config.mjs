import { createHash } from 'node:crypto';

const fail = code => { throw Object.assign(new Error(code), { code }); };
export function releasePrincipals(issuer, value) {
  if (typeof issuer !== 'string' || !issuer.trim() || issuer.length > 512 ||
      !Array.isArray(value) || value.length !== 2 ||
      value.some(p => !p || p.issuer !== issuer || typeof p.subject !== 'string' ||
        !/^[A-Za-z0-9_-]{1,128}$/.test(p.subject)) ||
      value[0].subject === value[1].subject) fail('STOCKS_RELEASE_PRINCIPALS_INVALID');
  return value.map(p => ({ issuer, subject: p.subject }));
}
export function principalsDigest(principals) {
  return createHash('sha256').update(JSON.stringify([...principals].sort((a,b) =>
    a.subject < b.subject ? -1 : a.subject > b.subject ? 1 : 0))).digest('hex');
}
export function releaseConfig(env, version = process.versions.node) {
  if (version !== '22.23.3') fail('STOCKS_RELEASE_NODE_VERSION');
  // Presence is forbidden, including empty values and "false".
  for (const key of ['STOCKS_ACCOUNTS_DATA', 'STOCKS_GLOBAL_DATA',
    'STOCKS_LEGACY_SINGLE_OWNER_REVIEW', 'STOCKS_IDENTITY_ENDPOINT']) {
    if (Object.hasOwn(env, key)) fail('STOCKS_RELEASE_LEGACY_FORBIDDEN');
  }
  let endpoint;
  try { endpoint = new URL(env.STOCKS_TEST_CASH_AUTHORITY_URL); }
  catch { fail('STOCKS_RELEASE_AUTHORITY_REQUIRED'); }
  if (!(endpoint.protocol === 'https:' ||
      endpoint.protocol === 'http:' && endpoint.hostname === '127.0.0.1') ||
      endpoint.username || endpoint.password || endpoint.search || endpoint.hash ||
      !endpoint.pathname.endsWith('/api/v1/stocks-test-cash')) fail('STOCKS_RELEASE_AUTHORITY_INVALID');
  const issuer = env.STOCKS_IDENTITY_ISSUER, gatewayKey = env.STOCKS_TEST_CASH_GATEWAY_KEY;
  if (typeof gatewayKey !== 'string' || gatewayKey.length < 32 || gatewayKey.length > 4096 ||
      /[\r\n]/.test(gatewayKey)) fail('STOCKS_RELEASE_KEY_INVALID');
  let parsed;
  try { parsed = JSON.parse(env.STOCKS_TRADE_PRINCIPALS); }
  catch { fail('STOCKS_RELEASE_PRINCIPALS_INVALID'); }
  const tradePrincipals = releasePrincipals(issuer, parsed);
  const port = Number(env.STOCKS_GLOBAL_PORT ?? 4437);
  if (!Number.isInteger(port) || port < 1 || port > 65535) fail('STOCKS_RELEASE_PORT_INVALID');
  return { endpoint: endpoint.href, issuer, gatewayKey, tradePrincipals, port };
}
export async function verifyReleaseAuthority(config, fetchImpl = fetch) {
  try {
    const response = await fetchImpl(config.endpoint + '/readiness', {
      headers: { 'x-stocks-authority-key': config.gatewayKey },
      redirect: 'error', signal: AbortSignal.timeout(3000),
    });
    if (!response.ok) fail('STOCKS_RELEASE_AUTHORITY_UNREADY');
    const text = await response.text();
    if (text.length > 4096) fail('STOCKS_RELEASE_AUTHORITY_UNREADY');
    const data = JSON.parse(text);
    if (data.version !== 1 || data.authority !== 'postgres' || data.issuer !== config.issuer ||
        data.principalsDigest !== principalsDigest(config.tradePrincipals)) fail('STOCKS_RELEASE_AUTHORITY_UNREADY');
  } catch { fail('STOCKS_RELEASE_AUTHORITY_UNREADY'); }
}
