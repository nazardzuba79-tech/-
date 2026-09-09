process.env.JWT_SECRET = 'test-secret-at-least-this-long';
import request from 'supertest';
import express from 'express';
import jwt from 'jsonwebtoken';
import { depositsRouter, KNOWN_CHAINS } from '../deposits';
import { adminDepositsRouter } from '../adminDeposits';
import { MIN_DEPOSIT_USD, REFERRAL_REWARD_PERCENT } from '../../../config/limits';

const TREASURY = 'T9yD14Nj9j7xAB4dbGeiX9h8unkKHxuWwb'; // public zero-address fixture
const CONTRACT = 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t';
const USER = '11111111-1111-4111-8111-111111111111';
const HASH = 'ab'.repeat(32);
const originalEnv = process.env;
const originalFetch = global.fetch;
let rawAmount: string;
let confirmations: number;
let eventOverrides: Record<string, unknown>;
let recipient: string;
beforeEach(() => {
  process.env = { ...originalEnv, TRON_NATIVE_ASSET: 'TRX', TRON_TOKENS: `USDT:${CONTRACT}:6` };
  for (const chain of KNOWN_CHAINS) delete process.env[`${chain.toUpperCase()}_TREASURY_ADDRESS`];
  rawAmount = '300000000'; confirmations = 19; eventOverrides = {}; recipient = '0x' + '0'.repeat(40);
  global.fetch = jest.fn(async (input: any) => ({ ok: true, status: 200, json: async () => String(input).includes('/events')
    ? { success: true, data: [{ event_name: 'Transfer', contract_address: CONTRACT, block_number: 100,
      result: { from: 'sender', to: recipient, value: rawAmount }, ...eventOverrides }] }
    : String(input).includes('/getnowblock') ? { block_header: { raw_data: { number: 99 + confirmations } } }
    : { data: [{ transaction_id: HASH, to: TREASURY, value: rawAmount, block_timestamp: 1700000000000 }] },
  } as Response));
});
afterAll(() => { process.env = originalEnv; global.fetch = originalFetch; });

function setup(configured = true) {
  const rows = new Map<string, any>();
  const balanceUpdate = jest.fn(); const reward = jest.fn(); const audit = jest.fn();
  const db: any = {
    treasuryWallet: { findUnique: jest.fn(async ({ where }) => configured && where.chain === 'tron' ? { address: TREASURY } : null) },
    user: { findUnique: jest.fn(async () => ({ id: USER, role: 'ADMIN', referredById: 'referrer' })) },
    deposit: { findUnique: jest.fn(async ({ where }) => rows.get(where.chain_txHash.chain + ':' + where.chain_txHash.txHash) ?? null),
      findMany: jest.fn(async () => [...rows.values()]) },
    ignoredIncomingTransfer: { findMany: jest.fn(async () => []) },
  };
  db.$transaction = jest.fn(async (fn: any) => fn({
    deposit: { create: jest.fn(async ({ data }) => {
      const key = data.chain + ':' + data.txHash;
      if (rows.has(key)) throw Object.assign(new Error('duplicate transaction'), { code: 'P2002' });
      const row = { ...data, id: 'deposit' }; rows.set(key, row); return row;
    }) },
    balance: { upsert: jest.fn(async () => ({ available: '0', locked: '0' })), update: balanceUpdate },
    user: db.user, referralReward: { create: reward }, auditLog: { create: audit },
  }));
  const price = { getTicker: jest.fn(async () => null) };
  const app = express(); app.use(express.json());
  app.use('/api/v1', depositsRouter(db, price)); app.use('/api/v1', adminDepositsRouter(db, price));
  const auth = `Bearer ${jwt.sign({ sub: USER }, process.env.JWT_SECRET!)}`;
  const claim = (admin = false, asset = 'USDT', hash = HASH, chain = 'tron') => request(app)
    .post(admin ? '/api/v1/admin/deposits/manual-credit' : `/api/v1/deposits/claim/${chain}`)
    .set('Authorization', auth).send({ userId: USER, chain, asset, txHash: hash });
  return { app, auth, claim, balanceUpdate, reward, audit, db, price, rows };
}

test('config envelope owns the minimum/peg policy and exposes only verifiable Tron assets', async () => {
  const { app, auth } = setup();
  const res = await request(app).get('/api/v1/deposit-chains?includeConfig=true').set('Authorization', auth);
  expect(res.status).toBe(200); expect(res.headers['cache-control']).toBe('no-store');
  expect(res.body).toEqual({ minDepositUsd: MIN_DEPOSIT_USD, usdPeggedAssets: ['USDT','USDC','USD','DAI'],
    chains: [{ chain:'tron',nativeAsset:'TRX',tokens:['USDT'],supportedAssets:['USDT'] }] });
  expect(MIN_DEPOSIT_USD).toBe(300);
  const legacy = await request(app).get('/api/v1/deposit-chains').set('Authorization', auth);
  expect(legacy.body).toEqual([{ chain:'tron',nativeAsset:'TRX',tokens:['USDT'] }]);
  expect((await request(app).get('/api/v1/deposit-chains?includeConfig=true')).status).toBe(401);
});
test('no configured treasury means no Tron chain and no address', async () => {
  const { app, auth } = setup(false);
  expect((await request(app).get('/api/v1/deposit-chains?includeConfig=true').set('Authorization', auth)).body.chains).toEqual([]);
  expect((await request(app).get('/api/v1/deposit-address/tron').set('Authorization', auth)).status).toBe(404);
});
test('Tron address uses the configured admin treasury and never advertises TRX', async () => {
  const { app, auth } = setup();
  const res = await request(app).get('/api/v1/deposit-address/tron').set('Authorization', auth);
  expect(res.status).toBe(200); expect(res.body.address === TREASURY).toBe(true);
  expect(res.body.supportedAssets).toEqual(['USDT']);
});
describe.each([false,true])('real Tron verifier through admin=%s credit route', admin => {
  test.each([['299990000','BELOW_MINIMUM'],['300000000','CREDITED'],['300010000','CREDITED'],['500000000','CREDITED']])('%s base units => %s', async (amount,status) => {
    rawAmount = amount; const s = setup(); const res = await s.claim(admin);
    expect(res.status).toBe(200); expect(res.body.status).toBe(status); expect(res.body.confirmations).toBe(19);
    expect(s.price.getTicker).not.toHaveBeenCalled();
    expect(s.balanceUpdate).toHaveBeenCalledTimes(status === 'CREDITED' ? 2 : 0);
    expect(s.reward).toHaveBeenCalledTimes(status === 'CREDITED' ? 1 : 0);
    if (status === 'BELOW_MINIMUM') expect(res.body.minDepositUsd).toBe(300);
    else {
      expect(REFERRAL_REWARD_PERCENT).toBe(5);
      expect(s.reward.mock.calls[0][0].data.amount).toBe(String(Number(amount)/1e6*0.05));
      if (admin) expect(s.audit.mock.calls[0][0].data.metadata.performedByAdminId).toBe(USER);
    }
  });
  test('lowercase usdt cannot bypass stablecoin minimum when prices are unavailable', async () => {
    rawAmount = '299990000'; const s = setup(); const res = await s.claim(admin,'usdt');
    expect(res.body.status).toBe('BELOW_MINIMUM'); expect(s.price.getTicker).not.toHaveBeenCalled(); expect(s.balanceUpdate).not.toHaveBeenCalled();
  });
  test('insufficient confirmations remain PENDING without referral/balance credits', async () => {
    confirmations=18; const s=setup(); const res=await s.claim(admin);
    expect(res.body.status).toBe('PENDING'); expect(s.balanceUpdate).not.toHaveBeenCalled(); expect(s.reward).not.toHaveBeenCalled();
  });
});
test.each(['wrong-contract','wrong-recipient','wrong-event','TRX'])('%s is rejected before a deposit or balance write', async failure => {
  if(failure==='wrong-contract')eventOverrides.contract_address=TREASURY;
  if(failure==='wrong-recipient')recipient=CONTRACT;
  if(failure==='wrong-event')eventOverrides.event_name='Approval';
  const s=setup(); const res=await s.claim(false,failure==='TRX'?'TRX':'USDT');
  expect(res.status).toBe(400); expect(s.db.$transaction).not.toHaveBeenCalled();
});
test('same hex transaction cannot credit twice via hash/chain/symbol case variants or admin route', async () => {
  const s=setup(); expect((await s.claim(false,'usdt',HASH.toUpperCase(),'TrOn')).body.status).toBe('CREDITED');
  expect((await s.claim(true,'USDT',HASH)).body.status).toBe('CREDITED');
  expect((await s.claim(false,'USDT',HASH)).body.status).toBe('CREDITED');
  expect(s.rows.size).toBe(1); expect(s.db.$transaction).toHaveBeenCalledTimes(1);
  expect(s.balanceUpdate).toHaveBeenCalledTimes(2); expect(s.reward).toHaveBeenCalledTimes(1);
  expect(global.fetch).toHaveBeenCalledTimes(2);
});
test('admin incoming feed uses the same USDT contract/decimals and final credit re-verifies', async () => {
  const s=setup(); const incoming=await request(s.app).get('/api/v1/admin/deposits/incoming').set('Authorization',s.auth);
  expect(incoming.body).toEqual([expect.objectContaining({chain:'tron',asset:'USDT',amount:'300',txHash:HASH})]);
  expect((global.fetch as jest.Mock).mock.calls[0][0].includes(`contract_address=${CONTRACT}`)).toBe(true);
  confirmations=18;
  expect((await s.claim(true)).body.status).toBe('PENDING'); expect(s.balanceUpdate).not.toHaveBeenCalled();
});
