import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as wait } from 'node:timers/promises';
import { createServer } from './server.mjs';
import { CATALOG } from './catalog.mjs';
import { SimError } from './engine.mjs';

// Three sequential health reads, no users, quotes, financial requests or load generator.
test('Stocks gateway reuses a connection with Node native fetch between sequential reads', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'stocks-http-reuse-'));
  const app = await createServer({ port: 0, dataPath: join(directory, 'ledger.json'), autoPoll: false,
    hub: { metrics: {}, catalogue: async () => CATALOG, close() {} } });
  let connections = 0;
  app.server.on('connection', () => connections++);
  try {
    for (let i = 0; i < 3; i++) {
      const response = await fetch(`http://127.0.0.1:${app.port}/__stocks_global/health`);
      assert.equal(response.status, 200);
      assert.equal((await response.json()).ok, true);
      // Let the consumed response return its connection to the native dispatcher.
      await wait(30);
    }
    assert.equal(connections, 1, 'three sequential reads must share one TCP connection');
    assert.equal(app.server.maxConnections, 128);
    assert.equal(app.server.requestTimeout, 15000);
    assert.equal(app.server.headersTimeout, 10000);
  } finally {
    app.server.closeAllConnections(); await app.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test('a reused TCP connection does not reuse a previous viewer authorization decision', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'stocks-http-auth-'));
  let valid = true, checks = 0, connections = 0;
  const app = await createServer({ port: 0, accountsPath: join(directory, 'paper.sqlite'), autoPoll: false,
    tradePrincipals: [{ issuer: 'http-reuse-fixture', subject: 'alice' }, { issuer: 'http-reuse-fixture', subject: 'bob' }],
    authenticate: async () => { checks++; if (!valid) throw new SimError('AUTH_REQUIRED');
      return { issuer: 'http-reuse-fixture', subject: 'viewer' }; },
    hub: { metrics: {}, catalogue: async () => CATALOG, close() {} } });
  app.server.on('connection', () => connections++);
  try {
    const url = `http://127.0.0.1:${app.port}/__stocks_global/state`;
    const first = await fetch(url); await first.text(); assert.equal(first.status, 200);
    const before = checks; valid = false; await wait(30);
    const second = await fetch(url); assert.equal(second.status, 401);
    assert.equal((await second.json()).error, 'AUTH_REQUIRED');
    assert.ok(checks > before, 'identity must be checked again on the reused socket');
    assert.equal(connections, 1);
  } finally { app.server.closeAllConnections(); await app.close(); await rm(directory, { recursive: true, force: true }); }
});
