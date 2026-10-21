'use strict';
// No capability or DB credentials in this outsider's environment or mounts.
const net = require('node:net');
const assert = require('node:assert/strict');
async function denied(options) {
  const error = await new Promise((resolve, reject) => {
    const socket = net.connect(options);
    socket.once('connect', () => { socket.destroy(); reject(Error('PRIVATE_LISTENER_REACHABLE')); });
    socket.once('error', resolve);
    socket.setTimeout(2000, () => socket.destroy(Object.assign(Error('timeout'), { code: 'ETIMEDOUT' })));
  });
  assert.ok(['ECONNREFUSED','EACCES','EPERM'].includes(error.code), 'Expected explicit refusal, not a timeout/DNS failure');
  return error.code;
}
async function main() {
  const publicHealth = await fetch('http://api-production:3000/health'); assert.equal(publicHealth.status, 200);
  for (const port of [3001,4437,4438]) console.log(JSON.stringify({ check: 'outsider-private-port-denied', port, code: await denied({ host: 'api-production', port }) }));
  assert.ok(['EACCES','EPERM'].includes(await denied({ path: '/run/stocks-ingress/ingress.sock' })));
  console.log('OUTSIDER_SOCKET_AND_PORTS_DENIED');
}
module.exports = { denied };
if (require.main === module) main().catch(e => { console.error(e.message); process.exitCode = 1; });
