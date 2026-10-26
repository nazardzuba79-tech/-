// Isolated storage only. Real VOLTEX auth + balance/deposit HTTP handlers.
process.env.JWT_SECRET = 'synthetic-rf-transport-only';
process.env.API_KEY_ENCRYPTION_SECRET = '0'.repeat(64);
process.env.ETHEREUM_NATIVE_ASSET = 'ETH';
process.env.ETHEREUM_RPC_URL = 'http://127.0.0.1:9';
process.env.ETHEREUM_TREASURY_ADDRESS = '0x1111111111111111111111111111111111111111';
require('ts-node/register/transpile-only');
const express = require('express');
const jwt = require('jsonwebtoken');
const { balancesRouter } = require('../../src/api/routes/balances');
const { depositsRouter } = require('../../src/api/routes/deposits');
const balances = { 'synthetic-A': '123.45', 'synthetic-B': '678.90' };
const original = JSON.stringify(balances);
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
};
const app = express(); app.use(express.json());
app.use('/api/v1', balancesRouter(prisma), depositsRouter(prisma, {getPrice:async()=>{throw Error('No price fetch')}}));
// Fixture control is loopback only; never part of the deployed route map.
app.post('/fixture/revoke-A', (_req,res) => {sessions.get('synthetic-A').revokedAt=new Date(); res.json({ok:true});});
app.get('/fixture/invariants', (_req,res) => res.json({writes, unchanged:original===JSON.stringify(balances)}));
const server = app.listen(0,'127.0.0.1',()=>console.log(JSON.stringify({port:server.address().port,
  tokens:Object.fromEntries([...sessions.keys()].map(id=>[id,jwt.sign({sub:id,sid:id},process.env.JWT_SECRET,{expiresIn:'5m'})]))})));
process.on('SIGTERM',()=>server.close(()=>process.exit(0)));
