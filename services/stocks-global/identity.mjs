import { check, SimError } from './engine.mjs';
import { accountId } from './accounts.mjs';

// /me includes the original avatar data URL. The API accepts a 1 MiB upload
// envelope (not only canonical base64 for a 512 KiB decoded image); retain the
// prior 16 KiB allowance for the rest of the identity response. This is a BYTE
// bound on the decoded HTTP body, even when Content-Length is absent/compressed.
export const IDENTITY_RESPONSE_MAX_BYTES = 1024 * 1024 + 16 * 1024;
const IDENTITY_TIMEOUT_MS = 3000;

function bounded(work, signal) {
  return new Promise((resolve, reject) => {
    const abort = () => { signal.removeEventListener('abort', abort); reject(new SimError('AUTH_UNAVAILABLE')); };
    signal.addEventListener('abort', abort, { once: true });
    Promise.resolve(work).then(value => {
      signal.removeEventListener('abort', abort); resolve(value);
    }, error => { signal.removeEventListener('abort', abort); reject(error); });
    if (signal.aborted) abort();
  });
}

// Cancellation must not extend the authentication deadline if an upstream body
// is stalled. Abort also closes the native fetch transport; late responses from
// a test/custom fetch implementation are cancelled when they arrive.
function cancel(body) {
  try { void Promise.resolve(body?.cancel()).catch(() => {}); } catch {}
}

// Existing VOLTEX /api/v1/me contract. No JWT secret, token decoding or auth DB access.
// The URL/issuer are operator configuration, not client input. Review uses a loopback fixture.
export function identityResolver({ endpoint, issuer, fetchImpl = fetch }) {
  const url = new URL(endpoint);
  check((url.protocol === 'https:' || (url.protocol === 'http:' && url.hostname === '127.0.0.1')) && !url.username && !url.password && !url.search && !url.hash && url.pathname.endsWith('/api/v1/me'), 'AUTH_CONFIG_INVALID');
  check(typeof issuer === 'string' && issuer.length > 0 && issuer.length <= 512, 'AUTH_CONFIG_INVALID');
  return async req => {
    const authorization = req.headers.authorization;
    check(typeof authorization === 'string' && /^Bearer [A-Za-z0-9._~-]{16,4096}$/.test(authorization), 'AUTH_REQUIRED');
    const controller = new AbortController(), deadline = performance.now() + IDENTITY_TIMEOUT_MS;
    const timer = setTimeout(() => controller.abort(), IDENTITY_TIMEOUT_MS);
    const inTime = () => check(!controller.signal.aborted && performance.now() < deadline, 'AUTH_UNAVAILABLE');
    let response, reader;
    try {
      // No identity caching: revocation/expiry is checked on EVERY request, including reads.
      response = await bounded(Promise.resolve().then(() => fetchImpl(url.href, { method: 'GET', headers: { Authorization: authorization, Accept: 'application/json' }, redirect: 'error', signal: controller.signal })).then(value => {
        response = value;
        if (controller.signal.aborted) cancel(value.body);
        return value;
      }), controller.signal);
      inTime();
      if ([401,403,404].includes(response.status)) throw new SimError('AUTH_REQUIRED');
      check(response.ok, 'AUTH_UNAVAILABLE');
      const length = response.headers.get('content-length');
      if (length !== null) check(/^\d+$/.test(length) && Number.isSafeInteger(Number(length)) && Number(length) <= IDENTITY_RESPONSE_MAX_BYTES, 'AUTH_UNAVAILABLE');
      reader = response.body.getReader();
      // Grow one bounded buffer instead of retaining an attacker-sized array of
      // tiny chunks. Only initialized bytes are decoded below.
      let body = Buffer.allocUnsafe(16384), size = 0;
      while (true) {
        inTime();
        const { done, value } = await bounded(reader.read(), controller.signal);
        inTime();
        if (done) break;
        check(value instanceof Uint8Array, 'AUTH_UNAVAILABLE');
        const next = size + value.byteLength;
        check(next <= IDENTITY_RESPONSE_MAX_BYTES, 'AUTH_UNAVAILABLE');
        if (next > body.length) {
          const grown = Buffer.allocUnsafe(Math.min(IDENTITY_RESPONSE_MAX_BYTES, Math.max(next, body.length * 2)));
          body.copy(grown, 0, 0, size); body = grown;
        }
        body.set(value, size); size = next;
      }
      const user = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(body.subarray(0, size)));
      inTime();
      check(!user.blocked && !user.isBlocked && !user.deletedAt, 'AUTH_REQUIRED');
      const principal = { issuer, subject: user.id }; accountId(principal); return principal;
    } catch (error) { throw error instanceof SimError ? error : new SimError('AUTH_UNAVAILABLE'); }
    finally {
      clearTimeout(timer); controller.abort(); cancel(reader || response?.body);
      try { reader?.releaseLock(); } catch {}
    }
  };
}
