// Preload before Jest. Any unmocked network I/O is a test failure.
for (const key of ['DATABASE_URL', 'DIRECT_URL', 'NATIVE_EGRESS_TEST_DATABASE_URL']) {
  if (!process.env[key]) continue;
  const value = new URL(process.env[key]);
  if (!['127.0.0.1', 'localhost', '[::1]'].includes(value.hostname) || !value.pathname.includes('test')) throw new Error(`${key} must name a disposable loopback test database`);
}
const denied = () => { throw new Error('Network disabled by mobile review test boundary'); };
for (const protocol of ['node:http','node:https']) {
  const module = require(protocol); module.request = denied; module.get = denied;
}
const net = require('node:net'); net.connect = denied; net.createConnection = denied;
net.Socket.prototype.connect = denied;
require('node:tls').connect = denied;
global.fetch = async () => denied();
