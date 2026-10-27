import { test } from 'node:test';
import assert from 'node:assert/strict';
import { clientRateIp } from './src/clientIp.js';
import { handle } from './src/core.js';
const env = { RU_GATEWAY_PEER_IP: '138.199.227.130' };
const req = (peer, ip) => new Request('https://kyc.example.invalid/v1/submit', { headers: {
  'cf-connecting-ip': peer, 'x-voltex-ru-client-ip': ip, 'x-forwarded-for': '203.0.113.99',
} });
test('untrusted visitor cannot choose an IP using any client header', () => {
  assert.equal(clientRateIp(req('203.0.113.1', '198.51.100.10'), env), '203.0.113.1');
  assert.equal(clientRateIp(req('138.199.227.130', '198.51.100.10'), {}), '138.199.227.130');
});
test('trusted egress separates clients and canonicalizes IPv6', () => {
  assert.equal(clientRateIp(req(env.RU_GATEWAY_PEER_IP, '198.51.100.10'), env), 'ru:198.51.100.10');
  assert.equal(clientRateIp(req(env.RU_GATEWAY_PEER_IP, '198.51.100.11'), env), 'ru:198.51.100.11');
  assert.equal(clientRateIp(req(env.RU_GATEWAY_PEER_IP, '2001:0db8::1'), env), 'ru:2001:db8::1');
});
test('malformed, duplicate, port, zone and ambiguous IPs fall back to peer quota', () => {
  for (const ip of ['999.1.1.1', '01.2.3.4', '198.51.100.1,198.51.100.2', '1.2.3.4:99', '::1%eth0', 'foo', '']) {
    assert.equal(clientRateIp(req(env.RU_GATEWAY_PEER_IP, ip), env), env.RU_GATEWAY_PEER_IP);
  }
});
test('submit, materials and receipt-confirm keep binding limits on separate trusted clients', async () => {
  const keys=[];
  const config={...env,ALLOWED_ORIGINS:'https://voltextech.net',KYC_RATE_LIMIT:{limit:async({key})=>{keys.push(key);return {success:false};}}};
  for(const route of ['submit','materials','confirm'])for(const client of ['198.51.100.31','198.51.100.32']){
    const request=new Request('https://kyc.example.invalid/v1/'+route,{method:'POST',headers:{
      Origin:'https://voltextech.net','cf-connecting-ip':env.RU_GATEWAY_PEER_IP,
      'x-voltex-ru-client-ip':client,Authorization:'Bearer synthetic-session-token-with-valid-shape',
      'content-length':'1','content-type':'multipart/form-data; boundary=synthetic',
    },body:'x'});
    const response=await handle(request,config,{}, {now:()=>Date.now()});
    assert.equal(response.status,429);assert.equal(response.headers.get('cache-control'),'no-store');
    assert.equal(keys.at(-1),`${route}:ru:${client}`);
  }
  assert.equal(keys.length,6);
});

// Exercise the actual rateAllowed path, not just string-key comparisons.
// The in-memory binding below models the unchanged 5/min production policy;
// no network, real account, document or notification is used.
function quotaHarness() {
  const counts = new Map();
  return { ...env, ALLOWED_ORIGINS: 'https://voltextech.net', KYC_RATE_LIMIT: {
    limit: async ({ key }) => {
      const count = (counts.get(key) || 0) + 1;
      counts.set(key, count);
      return { success: count <= 5 };
    },
  } };
}
async function quotaRequest(config, peer, claim) {
  const request = new Request('https://kyc.example.invalid/v1/confirm', {
    method: 'POST', headers: {
      origin: 'https://voltextech.net', 'cf-connecting-ip': peer,
      'x-voltex-ru-client-ip': claim, 'x-forwarded-for': claim,
      'x-real-ip': claim, 'content-type': 'application/json', 'content-length': '2',
    }, body: '{}',
  });
  // No signing key intentionally: accepted quota checks then stop at503,
  // before receipt processing or any API/email call.
  return handle(request, config, {}, { now: () => 2_000_000_000_000 });
}
test('exhausting client A does not consume client B quota behind the same egress', async () => {
  const config = quotaHarness();
  for (let i = 0; i < 5; i++) {
    assert.equal((await quotaRequest(config, env.RU_GATEWAY_PEER_IP, '192.0.2.41')).status, 503);
  }
  assert.equal((await quotaRequest(config, env.RU_GATEWAY_PEER_IP, '192.0.2.41')).status, 429);
  assert.equal((await quotaRequest(config, env.RU_GATEWAY_PEER_IP, '192.0.2.42')).status, 503);
});
test('untrusted caller cannot evade its quota by rotating forged IP headers', async () => {
  const config = quotaHarness();
  for (let i = 1; i <= 5; i++) {
    assert.equal((await quotaRequest(config, '192.0.2.51', `198.51.100.${i}`)).status, 503);
  }
  assert.equal((await quotaRequest(config, '192.0.2.51', '198.51.100.99')).status, 429);
});
