// CF-Connecting-IP is set by Cloudflare, not by the browser. Only the
// separately trusted Hetzner egress may supply the overwritten relay header.
// No X-Forwarded-For, cookies, JWT decoding or per-request identity guessing.
function canonicalIp(raw) {
  if (typeof raw !== 'string' || raw.length > 45) return null;
  if (/^(?:0|[1-9]\d{0,2})(?:\.(?:0|[1-9]\d{0,2})){3}$/.test(raw)) {
    return raw.split('.').every(n => Number(n) <= 255) ? raw : null;
  }
  if (!raw.includes(':') || !/^[0-9a-f:.]+$/i.test(raw)) return null;
  try { return new URL(`http://[${raw}]/`).hostname.slice(1, -1); } catch { return null; }
}

export function clientRateIp(request, env) {
  const peer = request.headers.get('cf-connecting-ip') || 'unknown';
  const trusted = canonicalIp(env.RU_GATEWAY_PEER_IP);
  if (trusted && canonicalIp(peer) === trusted) {
    const client = canonicalIp(request.headers.get('x-voltex-ru-client-ip'));
    if (client) return `ru:${client}`;
  }
  return peer;
}
