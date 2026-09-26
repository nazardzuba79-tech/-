// One-off deployment setup, NOT a production loop. No private secret, token,
// user, or database access. A bounded wait accommodates Render auto-deployment.
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

let key;
for (let attempt = 0; attempt < 60; attempt++) {
  try {
    const response = await fetch('https://api.voltextech.net/notifications/public-key', { signal: AbortSignal.timeout(5_000), redirect: 'error' });
    const data = await response.json();
    if (response.ok && data.alg === 'Ed25519' && data.key?.kty === 'OKP' && data.key?.crv === 'Ed25519'
      && /^[A-Za-z0-9_-]{43}$/.test(data.key.x) && !data.key.d) { key = data.key.x; break; }
  } catch { /* no exception/body/URL logging */ }
  console.log(`waiting_for_render_public_key attempt=${attempt + 1}`);
  await new Promise(resolve => setTimeout(resolve, 10_000));
}
if (!key) { console.error('PUBLIC_KEY_UNAVAILABLE: notification deposit authentication not configured'); process.exit(1); }
const cli = fileURLToPath(new URL('../workers/notification-edge/node_modules/wrangler/bin/wrangler.js', import.meta.url));
const config = fileURLToPath(new URL('../workers/notification-edge/wrangler.toml', import.meta.url));
const result = spawnSync(process.execPath, [cli, 'secret', 'put', 'DEPOSIT_SIGNING_PUBLIC_KEY', '--config', config], {
  input: key, encoding: 'utf8', windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'],
});
if (result.status !== 0) { console.error('PUBLIC_KEY_PIN_FAILED: check Cloudflare deployment permissions'); process.exit(1); }
console.log('deposit_public_key=pinned (no private key transferred)');
