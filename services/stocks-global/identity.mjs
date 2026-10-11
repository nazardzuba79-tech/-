import { check, SimError } from './engine.mjs';
import { accountId } from './accounts.mjs';

// Existing VOLTEX /api/v1/me contract. No JWT secret, token decoding or auth DB access.
// The URL/issuer are operator configuration, not client input. Review uses a loopback fixture.
export function identityResolver({ endpoint, issuer, fetchImpl = fetch }) {
  const url = new URL(endpoint);
  check((url.protocol === 'https:' || (url.protocol === 'http:' && url.hostname === '127.0.0.1')) && !url.username && !url.password && !url.search && !url.hash && url.pathname.endsWith('/api/v1/me'), 'AUTH_CONFIG_INVALID');
  check(typeof issuer === 'string' && issuer.length > 0 && issuer.length <= 512, 'AUTH_CONFIG_INVALID');
  return async req => {
    const authorization = req.headers.authorization;
    check(typeof authorization === 'string' && /^Bearer [A-Za-z0-9._~-]{16,4096}$/.test(authorization), 'AUTH_REQUIRED');
    try {
      // No identity caching: revocation/expiry is checked on EVERY request, including reads.
      const response = await fetchImpl(url.href, { method: 'GET', headers: { Authorization: authorization, Accept: 'application/json' }, redirect: 'error', signal: AbortSignal.timeout(3000) });
      if ([401,403,404].includes(response.status)) { await response.body?.cancel(); throw new SimError('AUTH_REQUIRED'); }
      check(response.ok, 'AUTH_UNAVAILABLE');
      const reader = response.body.getReader(), chunks = []; let size = 0;
      try { while (true) { const { done, value } = await reader.read(); if (done) break; size += value.length; check(size <= 16384, 'AUTH_UNAVAILABLE'); chunks.push(value); } }
      finally { await reader.cancel().catch(() => {}); }
      const user = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      check(!user.blocked && !user.isBlocked && !user.deletedAt, 'AUTH_REQUIRED');
      const principal = { issuer, subject: user.id }; accountId(principal); return principal;
    } catch (error) { throw error instanceof SimError ? error : new SimError('AUTH_UNAVAILABLE'); }
  };
}
