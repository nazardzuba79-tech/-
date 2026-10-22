import test from 'node:test';
import assert from 'node:assert/strict';
import { MarketHub } from './market.mjs';
import { BinanceStreamMarketHub } from './binance-stream-market.mjs';
import { createStocksRuntimeMarket } from './runtime-market.mjs';

test('CLI default and explicit false retain the original REST MarketHub', () => {
  for (const config of [{}, { enabled: 'false' }, { enabled: 'false', authorityMode: true }]) {
    const hub = createStocksRuntimeMarket(config);
    assert.ok(hub instanceof MarketHub);
    assert.equal(hub instanceof BinanceStreamMarketHub, false);
    assert.equal(hub.feed, undefined);
  }
});

test('unknown feature values and missing independent cash authority fail closed', () => {
  for (const enabled of ['1', 'TRUE', 'yes', '', null, true]) {
    assert.throws(() => createStocksRuntimeMarket({ enabled, authorityMode: true }), /AUTH_CONFIG_INVALID/);
  }
  assert.throws(() => createStocksRuntimeMarket({ enabled: 'true' }), /AUTH_CONFIG_INVALID/);
  assert.throws(() => createStocksRuntimeMarket({ enabled: 'true', authorityMode: false }), /AUTH_CONFIG_INVALID/);
});

test('explicit authority-backed WS mode constructs one demand-lazy Stocks feed', () => {
  const hub = createStocksRuntimeMarket({ enabled: 'true', authorityMode: true });
  try {
    assert.ok(hub instanceof BinanceStreamMarketHub);
    assert.equal(hub.feed?.snapshot().connections, 0);
    assert.equal(hub.feed?.snapshot().symbols, 0);
    assert.equal(hub.feed?.socket, null);
    assert.equal(hub.feed?.timer, null);
  } finally {
    hub.close();
  }
});

test('loopback synthetic socket options never start a provider connection until demand', () => {
  const hub = createStocksRuntimeMarket({
    enabled: 'true', authorityMode: true,
    feedOptions: { url: 'ws://127.0.0.1:44379/stream', synthetic: true },
  });
  try {
    assert.equal(hub.feed.snapshot().connections, 0);
    assert.equal(hub.feed.snapshot().connected, false);
  } finally {
    hub.close();
  }
});
