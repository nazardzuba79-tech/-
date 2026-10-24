import { createHmac, createHash, timingSafeEqual } from 'node:crypto';
import { PROOF, origin, keyBytes, canonical, route, reject } from './protocol.mjs';

// One private ingress process, ephemeral bounded nonce cache. No distributed
// replay claim: multiple replicas need a separately reviewed shared nonce fence.
export function createPagesTransport({ publicOrigin, apiOrigin, key, now = Date.now, maxNonces = 2048 }) {
  const app = origin(publicOrigin), api = origin(apiOrigin), secret = keyBytes(key), nonces = new Map();
  if (app.origin === api.origin || !Number.isInteger(maxNonces) || maxNonces < 1) reject('STOCKS_EDGE_CONFIG_INVALID', 503);
  return (req, body) => {
    if (!['127.0.0.1', '::ffff:127.0.0.1', '::1'].includes(req.socket.remoteAddress) || req.headers.host !== api.host) reject('HOST_FORBIDDEN');
    const headers = req.headers, seen = new Set();
    for (let i = 0; i < req.rawHeaders.length; i += 2) {
      const name = req.rawHeaders[i].toLowerCase();
      if (seen.has(name)) reject('REQUEST_REJECTED'); seen.add(name);
    }
    if (Object.keys(headers).some(name => name === 'forwarded' || name.startsWith('x-forwarded-')) || headers.origin !== app.origin) reject('ORIGIN_FORBIDDEN');
    route(req.url, req.method);
    if (body.length) reject('REQUEST_REJECTED');
    const time = headers[PROOF + 'time'], nonce = headers[PROOF + 'nonce'], signature = headers[PROOF + 'signature'], digest = headers[PROOF + 'digest'];
    const at = now();
    if (!/^\d{13}$/.test(time || '') || Math.abs(at - Number(time)) > 10000 || !/^[a-f0-9-]{36}$/.test(nonce || '') || !/^[a-f0-9]{64}$/.test(signature || '') || digest !== createHash('sha256').update(body).digest('hex')) reject('EDGE_PROOF_INVALID');
    const message = canonical({ time, nonce, publicOrigin: app.origin, apiOrigin: api.origin, method: req.method, path: req.url,
      authorization: headers.authorization || '', csrf: headers['x-stocks-token'] || '', view: headers['x-stocks-view'] || '', digest });
    const expected = createHmac('sha256', secret).update(message).digest();
    if (!timingSafeEqual(expected, Buffer.from(signature, 'hex'))) reject('EDGE_PROOF_INVALID');
    for (const [value, until] of nonces) if (until < at) nonces.delete(value);
    if (nonces.has(nonce)) reject('EDGE_PROOF_REPLAY');
    if (nonces.size >= maxNonces) reject('ACCOUNT_BUSY', 503);
    // A future timestamp is valid until timestamp+10s. Never evict it early.
    nonces.set(nonce, Number(time) + 10000);
    // Only AFTER verification translate the separate API vhost into the exact
    // existing app-origin contract; validateHostedRequest still runs afterwards.
    req.headers.host = app.host; req.headers.origin = app.origin;
    for (const name of Object.keys(req.headers)) if (name.startsWith(PROOF)) delete req.headers[name];
  };
}
