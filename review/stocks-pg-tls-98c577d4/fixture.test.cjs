'use strict';
// New harness-only tests. No app suites, network, Docker or database execution.
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const { EventEmitter } = require('node:events');
function load() {
  const servers = new Map();
  let requestOptions;
  const https = {
    createServer: (_tls, handler) => ({ listen: port => { servers.set(port, handler); } }),
    request: (options, receive) => {
      requestOptions = options;
      const req = new EventEmitter();
      req.end = () => {
        const res = new EventEmitter();
        res.statusCode = 200; res.socket = { authorized: true, getProtocol: () => 'TLSv1.3' };
        receive(res);
        res.emit('data', Buffer.from('{"ok":true}'));
        res.socket = null; // Node may detach the socket before the end event.
        res.emit('end');
      };
      return req;
    },
  };
  const fakeFs = { readFileSync: name => name.endsWith('config.json') ? '{}' : Buffer.from('ephemeral-fixture') };
  const sandbox = { require: name => name === 'node:fs' ? fakeFs :
    name === 'node:https' ? https : require(name), URL, Buffer, setTimeout, console: { log() {}, error() {} },
    process, module: { exports: {} } };
  const source = fs.readFileSync(path.join(__dirname, 'fixture.cjs'), 'utf8');
  const split = source.indexOf('const mode = process.argv[2];');
  assert.ok(split > 0);
  vm.runInNewContext(source.slice(0, split) + '\nmodule.exports={transport,request};', sandbox);
  sandbox.module.exports.transport();
  function call(port, host, url) {
    let status, body;
    servers.get(port)({ headers: { host }, url }, {
      writeHead: value => { status = value; }, end: value => { body = JSON.parse(value); },
    });
    return { status, body };
  }
  return { ...sandbox.module.exports, call, options: () => requestOptions };
}
test('provider transport admits only explicit fixture paths; MOEX stays unavailable', () => {
  const f = load();
  const catalogue = f.call(443, 'api.bybit.com', '/v5/market/instruments-info?category=spot');
  assert.equal(catalogue.status, 200);
  assert.equal(catalogue.body.result.list[0].symbol, 'AAPLXUSDT');
  const book = f.call(443, 'api.bybit.com', '/v5/market/orderbook?category=spot&symbol=AAPLXUSDT');
  assert.equal(book.status, 200); assert.equal(book.body.result.b[0][0], '100');
  const history = f.call(443, 'api.bybit.com', '/v5/market/kline?interval=15');
  assert.equal(history.body.result.list.length, 600);
  assert.equal(Number(history.body.result.list[0][0]) - Number(history.body.result.list[1][0]), 900000);
  assert.equal(f.call(443, 'iss.moex.com', '/iss/anything').status, 503);
  assert.equal(f.call(443, 'unknown.fixture.invalid', '/').status, 503);
});
test('TLS proxy refuses incorrect host and private authority route', () => {
  const f = load();
  assert.equal(f.call(4443, 'wrong.fixture.invalid', '/__smoke/ready').status, 403);
  assert.equal(f.call(4443, 'stocks.fixture.invalid:4443', '/__smoke/ready').status, 200);
  assert.equal(f.call(4443, 'stocks.fixture.invalid:4443', '/api/v1/stocks-test-cash/command').status, 404);
});
test('client verifies TLS and handles both Node22 lookup callback shapes and detached socket', async () => {
  const f = load();
  const response = await f.request('/health');
  assert.equal(response.tls.authorized, true); assert.equal(response.tls.protocol, 'TLSv1.3');
  const options = f.options();
  assert.equal(options.rejectUnauthorized, true);
  options.lookup('stocks.fixture.invalid', { all: true }, (err, records) => {
    assert.equal(err, null); assert.equal(records[0].address, '127.0.0.1'); assert.equal(records[0].family, 4);
  });
  options.lookup('stocks.fixture.invalid', {}, (err, address, family) => {
    assert.equal(err, null); assert.equal(address, '127.0.0.1'); assert.equal(family, 4);
  });
});
