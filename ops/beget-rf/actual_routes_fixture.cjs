// Isolated storage only. Real VOLTEX auth + balance/deposit HTTP handlers.
process.env.JWT_SECRET = 'synthetic-rf-transport-only';
process.env.API_KEY_ENCRYPTION_SECRET = '0'.repeat(64);
process.env.ETHEREUM_NATIVE_ASSET = 'ETH';
process.env.ETHEREUM_RPC_URL = 'http://127.0.0.1:9';
process.env.ETHEREUM_TREASURY_ADDRESS = '0x1111111111111111111111111111111111111111';
require('ts-node/register/transpile-only');
// Only generated enum metadata is stubbed; no DB/Prisma engine is started.
// OrderService and its ownership/transaction orchestration remain actual code.
const Module = require('module');
const load = Module._load;
Module._load = function(name, ...rest) {
  if (name === '@prisma/client') return {Prisma:{TransactionIsolationLevel:{ReadCommitted:'ReadCommitted',Serializable:'Serializable'}}};
  return load.call(this,name,...rest);
};
const express = require('express');
const jwt = require('jsonwebtoken');
const { balancesRouter } = require('../../src/api/routes/balances');
const { depositsRouter } = require('../../src/api/routes/deposits');
const { ordersRouter } = require('../../src/api/routes/orders');
const { MatchingEngine } = require('../../src/matching-engine/MatchingEngine');
const balances = { 'synthetic-A': '123.45', 'synthetic-B': '678.90' };
const original = JSON.stringify(balances);
const orders = {'synthetic-A-order':{id:'synthetic-A-order',userId:'synthetic-A',status:'OPEN'},
  'synthetic-B-order':{id:'synthetic-B-order',userId:'synthetic-B',status:'OPEN'}};
const originalOrders = JSON.stringify(orders);
const sessions = new Map(Object.keys(balances).map(id => [id, { id, userId: id, revokedAt: null,
  lastSeenAt: new Date(), remembered: false, user: { email: id + '@example.invalid' } }]));
let writes = 0;
const noWrite = () => { writes++; throw Error('Unexpected storage write'); };
const prisma = {
  session: { findUnique: async ({where}) => sessions.get(where.id), update: noWrite },
  auditLog: { findFirst: async () => null },
  balance: { findMany: async ({where}) => balances[where.userId] ?
    [{asset:'USDT', available:balances[where.userId], locked:'0'}] : [], update:noWrite, upsert:noWrite },
  treasuryWallet: { findUnique:async () => null },
  deposit: { findMany:async ({where}) => [{ id:where.userId + '-deposit', asset:'USDT', chain:'ethereum',
    txHash:'synthetic-not-onchain', amount:'10', confirmations:100, status:'CREDITED',
    createdAt:new Date('2026-01-01T00:00:00Z'), creditedAt:null }] },
  $transaction:async work=>work({
    order:{findUnique:async ({where})=>orders[where.id],update:noWrite},
    balance:{update:noWrite,upsert:noWrite},
    $queryRaw:async ()=>[{id:'synthetic-transaction'}],
  }),
  $queryRaw:async ()=>[{status:'committed'}],
};
const app = express(); app.use(express.json());
app.use('/api/v1', balancesRouter(prisma), depositsRouter(prisma, {getPrice:async()=>{throw Error('No price fetch')}}),
  ordersRouter(prisma,new MatchingEngine(),{getPrice:async()=>{throw Error('No price fetch')}}));
// Fixture control is loopback only; never part of the deployed route map.
app.post('/fixture/revoke-A', (_req,res) => {sessions.get('synthetic-A').revokedAt=new Date(); res.json({ok:true});});
app.get('/fixture/invariants', (_req,res) => res.json({writes, unchanged:original===JSON.stringify(balances)
  && originalOrders===JSON.stringify(orders)}));
const server = app.listen(0,'127.0.0.1',()=>console.log(JSON.stringify({port:server.address().port,
  tokens:Object.fromEntries([...sessions.keys()].map(id=>[id,jwt.sign({sub:id,sid:id},process.env.JWT_SECRET,{expiresIn:'5m'})]))})));
process.on('SIGTERM',()=>server.close(()=>process.exit(0)));
