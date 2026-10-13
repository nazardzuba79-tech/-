'use strict';
// Actual existing services behind a disposable HTTP operation adapter. This is NOT
// production Express/auth middleware or its endpoint contract. No external transport.
if (process.env.CX23_DISPOSABLE !== 'true') throw Error('DISPOSABLE_FIXTURE_REQUIRED');
const http = require('node:http');
require('./network-guard.cjs').installLoopbackDbGuard();
const assert = require('node:assert/strict'), Big = require('bignumber.js');
const { PrismaClient } = require('@prisma/client');
const { MatchingEngine } = require('../../../dist/matching-engine/MatchingEngine');
const { OrderService } = require('../../../dist/services/OrderService');
const { FuturesPositionService } = require('../../../dist/futures/FuturesPositionService');
const { FuturesProtectionService } = require('../../../dist/futures/FuturesProtectionService');
const URL = 'postgresql://model_fixture@127.0.0.1:15432/cx23_disposable?connection_limit=8';
const db = new PrismaClient({ datasources: { db: { url: URL } } });
const qty = new Big('.01'), price = new Big('50000'); let fixtureMark = 50000, so, fo, pos;
const spot = new OrderService(db, new MatchingEngine(), { getTicker: async () => ({ lastPrice: '50000' }) });
const mark = { getMarkPrice: async () => new Big(fixtureMark), recordFuturesTrade: () => {} };
const futures = new FuturesPositionService(db, new MatchingEngine(), mark);
const protection = new FuturesProtectionService(db, futures, mark);
const ft = (userId, side, type = 'LIMIT', reduceOnly = false) => ({ userId, symbol: 'BTC/USDT', side, type, price, quantity: qty, leverage: 10, marginType: 'ISOLATED', reduceOnly });
const operations = {
  spotCreate: async () => { fixtureMark = 50000; so = await spot.placeOrder({ userId: 'taker', pair: 'BTC/USDT', side: 'BUY', type: 'LIMIT', price: new Big(40000), quantity: qty }); },
  spotCancel: () => spot.cancelOrder('taker', so.order.id),
  spotMaker: () => spot.placeOrder({ userId: 'maker', pair: 'BTC/USDT', side: 'SELL', type: 'LIMIT', price, quantity: qty }),
  spotFill: () => spot.placeOrder({ userId: 'taker', pair: 'BTC/USDT', side: 'BUY', type: 'MARKET', quantity: qty }),
  futuresCreate: async () => { fo = await futures.placeOrder({ ...ft('taker', 'BUY'), price: new Big(40000) }); },
  futuresCancel: () => futures.cancelOrder('taker', fo.order.id),
  futuresMaker: () => futures.placeOrder(ft('maker', 'SELL')),
  futuresOpen: async () => { await futures.placeOrder(ft('taker', 'BUY', 'MARKET')); pos = await db.futuresPosition.findFirstOrThrow({ where: { userId: 'taker', status: 'OPEN' } }); },
  tpslSet: () => protection.setProtection('taker', pos.id, { takeProfit: new Big(51000), stopLoss: new Big(49000) }),
  tpslState: () => protection.getProtection('taker', pos.id),
  tpslSweep: () => protection.checkAndTrigger(),
  futuresCloseMaker: () => futures.placeOrder(ft('taker', 'SELL', 'LIMIT', true)),
  futuresClose: () => futures.placeOrder(ft('maker', 'BUY', 'MARKET', true)),
  stateRead: async () => {
    const [b, p, o] = await Promise.all([db.balance.findMany({ where: { userId: 'taker' } }), db.futuresPosition.findMany({ where: { userId: 'taker', status: 'OPEN' } }), db.order.findMany({ where: { userId: 'taker' }, take: 20, orderBy: { createdAt: 'desc' } })]);
    assert.equal(p.length, 0); assert(b.length > 0 && o.length > 0);
  },
};
let calls = 0, busy = false, failures = 0;
(async () => {
  for (const id of ['maker', 'taker']) {
    await db.user.create({ data: { id, email: `${id}@cx23.invalid`, passwordHash: 'fixture-never-login', referralCode: `CX23-${id}` } });
    for (const asset of ['BTC', 'USDT']) await db.balance.create({ data: { userId: id, asset, available: asset === 'BTC' ? '100' : '10000000' } });
    await db.futuresBalance.create({ data: { userId: id, asset: 'USDT', available: '10000000' } });
  }
  const server = http.createServer(async (req, res) => {
    res.setHeader('Content-Type', 'application/json');
    if (req.method === 'GET' && req.url === '/fixture/health') return res.end('{"ok":true,"fixture":true}');
    const op = req.method === 'POST' && operations[req.url?.slice('/fixture/step/'.length)];
    if (!req.url?.startsWith('/fixture/step/') || !op) { res.statusCode = 404; return res.end('{"error":"FIXTURE_ROUTE"}'); }
    if (busy) { res.statusCode = 409; return res.end('{"error":"FIXTURE_SEQUENCE_BUSY"}'); }
    busy = true; calls++;
    try { await op(); res.end('{"ok":true}'); }
    catch (e) { failures++; res.statusCode = 500; res.end(JSON.stringify({ error: 'CRYPTO_FIXTURE_OPERATION_FAILED', operation: req.url, name: e.name, message: e.message })); }
    finally { busy = false; }
  });
  await new Promise(ok => server.listen(18094, '127.0.0.1', ok));
  process.on('message', m => { if (m?.type === 'metrics') process.send?.({ id: m.id, value: { pid: process.pid, cpu: process.cpuUsage(), memory: process.memoryUsage(), calls, failures, externalApiCalls: 0 } }); });
  process.send?.({ ready: true, kind: 'crypto', pid: process.pid });
  process.on('SIGTERM', async () => { await new Promise(ok => server.close(ok)); await db.$disconnect(); process.exit(); });
})().catch(error => { console.error(error); process.exitCode = 1; });
