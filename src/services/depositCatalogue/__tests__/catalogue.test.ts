import express from 'express';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { DepositCatalogue } from '../service';
import { AddressEntry, CatalogueDocument, CatalogueError, CatalogueStore, CloudflareCatalogueStore, UnconfiguredCatalogueStore, entrySchema } from '../store';
import { CoinRanking } from '../../CoinGeckoService';
import { depositCatalogueRouter } from '../../../api/routes/depositCatalogue';
import { readFileSync } from 'fs';
import { execFileSync } from 'child_process';

const address = '0x' + '1'.repeat(40);
const entry = (assetId: string, networkId: string, value = address): AddressEntry => ({ assetId, networkId, address: value, enabled: true, memo: '', memoLabel: '' });
const baseline = [entry('bitcoin', 'bitcoin', 'bc1q' + 'a'.repeat(38)), entry('ethereum', 'ethereum'), entry('tether', 'ethereum'), entry('tether', 'tron', 'T' + 'A'.repeat(33))];
const rank = (id: string, symbol: string, n: number): CoinRanking => ({ id, symbol, name: symbol, rank: n } as CoinRanking);
const rankings = [rank('bitcoin', 'BTC', 1), rank('ethereum', 'ETH', 2), rank('tether', 'USDT', 3), rank('solana', 'SOL', 4), rank('ripple', 'XRP', 5), rank('usd-coin', 'USDC', 6)];
class MemoryStore implements CatalogueStore {
  revision = 1;
  document: CatalogueDocument = { schemaVersion: 1, baseline, overrides: [] };
  reads = 0; writes = 0;
  async read() { this.reads++; return structuredClone({ revision: String(this.revision), document: this.document }); }
  async replace(document: CatalogueDocument, expected: string) {
    if (expected !== String(this.revision)) throw new CatalogueError(409, 'Conflict');
    this.writes++; this.revision++; this.document = structuredClone(document);
    return structuredClone({ revision: String(this.revision), document: this.document });
  }
}
const token = (id: string) => `Bearer ${jwt.sign({ sub: id }, process.env.JWT_SECRET!)}`;
function setup(store = new MemoryStore()) {
  const ranking = jest.fn().mockResolvedValue(rankings);
  const service = new DepositCatalogue(store, ranking);
  const forbidden = jest.fn(() => { throw new Error('Financial/treasury DB access forbidden'); });
  const prisma = { user: { findUnique: jest.fn(async ({ where }: any) => ({ id: where.id, role: where.id === 'admin' ? 'ADMIN' : 'USER' })) },
    balance: { upsert: forbidden, update: forbidden }, deposit: { create: forbidden }, treasuryWallet: { findMany: forbidden },
    futuresBalance: { update: forbidden }, order: { create: forbidden }, auditLog: { create: forbidden } };
  const app = express().use(express.json()).use('/api/v1', depositCatalogueRouter(prisma as any, service));
  return { store, service, ranking, prisma, forbidden, app };
}
const publicPath = '/api/v1/deposit-catalogue', adminPath = '/api/v1/admin/deposit-catalogue';

describe('manual receiving-address catalogue', () => {
  test('preserves all four legacy baseline rails; no TreasuryWallet or finance access', async () => {
    const s = setup(); const res = await request(s.app).get(publicPath);
    expect(res.status).toBe(200); expect(res.body.entries).toHaveLength(4);
    expect(res.body.entries.map((e: any) => e.address)).toEqual([baseline[0].address, address, address, baseline[3].address]);
    expect(s.prisma.user.findUnique).not.toHaveBeenCalled(); expect(s.forbidden).not.toHaveBeenCalled();
  });
  test('ADMIN adds, reload persists, edits, disables and clears without baseline resurrection', async () => {
    const s = setup();
    for (const [revision, patch] of [['1', entry('solana', 'solana', 'A'.repeat(44))], ['2', entry('solana', 'solana', 'B'.repeat(44))],
      ['3', { ...entry('solana', 'solana', 'B'.repeat(44)), enabled: false }], ['4', { ...entry('tether', 'ethereum'), address: '', enabled: false }]] as const) {
      const result = await request(s.app).put(adminPath).set('Authorization', token('admin')).set('If-Match', revision).send(patch);
      expect(result.status).toBe(200);
      const reloaded = new DepositCatalogue(s.store, async () => rankings);
      const admin = await reloaded.adminCatalogue();
      expect(admin.entries.find(e => e.assetId === patch.assetId && e.networkId === patch.networkId)).toMatchObject(patch);
      const published = await s.service.publicCatalogue();
      expect(published.entries.some(e => e.assetId === patch.assetId && e.networkId === patch.networkId)).toBe(patch.enabled);
    }
    expect(s.forbidden).not.toHaveBeenCalled();
  });
  test.each(['customer', 'non-admin'])('%s cannot read admin or write; no storage accesses', async id => {
    const s = setup();
    expect((await request(s.app).put(adminPath).set('Authorization', token(id)).set('If-Match', '1').send(entry('ethereum', 'ethereum'))).status).toBe(403);
    expect((await request(s.app).get(adminPath).set('Authorization', token(id))).status).toBe(403);
    expect(s.store.reads).toBe(0); expect(s.store.writes).toBe(0);
  });
  test('missing or expired authorization is rejected', async () => {
    const s = setup(); expect((await request(s.app).put(adminPath).send({})).status).toBe(401);
    expect((await request(s.app).put(adminPath).set('Authorization', 'Bearer invalid').send({})).status).toBe(401);
    expect(s.store.writes).toBe(0);
  });
  test('revoked session cannot write', async () => {
    const s = setup(); (s.prisma as any).session = { findUnique: jest.fn().mockResolvedValue({ userId: 'admin', revokedAt: new Date() }) };
    const auth = `Bearer ${jwt.sign({ sub: 'admin', sid: 'revoked' }, process.env.JWT_SECRET!)}`;
    expect((await request(s.app).put(adminPath).set('Authorization', auth).set('If-Match', '1').send(entry('ethereum', 'ethereum'))).status).toBe(401);
    expect(s.store.writes).toBe(0);
  });
  test('USDC multi-network destinations remain distinct; XRP memo survives', async () => {
    const s = setup(); await s.service.save(entry('usd-coin', 'ethereum'), '1');
    await s.service.save(entry('usd-coin', 'solana', 'C'.repeat(44)), '2');
    await s.service.save({ ...entry('ripple', 'xrp', 'r' + 'A'.repeat(30)), memo: '123456', memoLabel: 'Destination tag' }, '3');
    const entries = (await s.service.publicCatalogue()).entries;
    expect(entries.filter(e => e.asset === 'USDC').map(e => e.networkId)).toEqual(['ethereum', 'solana']);
    expect(entries.find(e => e.asset === 'XRP')).toMatchObject({ memo: '123456', memoLabel: 'Destination tag' });
  });
  test('rank changes retain configured asset and introduce unconfigured top asset', async () => {
    const s = setup(); s.ranking.mockResolvedValue([rank('sui', 'SUI', 1), rank('future-coin', 'NEW', 2), rank('voltora', 'VTA', 3)]);
    const result = await s.service.adminCatalogue();
    expect(result.assets.find(a => a.asset === 'BTC')).toMatchObject({ top: false });
    expect(result.assets.find(a => a.asset === 'SUI')).toMatchObject({ top: true });
    expect(result.entries.find(e => e.asset === 'SUI')?.status).toBe('unconfigured');
    expect(result.assets.some(a => a.asset === 'NEW')).toBe(true);
    expect(result.assets.some(a => a.asset === 'VTA')).toBe(false);
    expect((await s.service.publicCatalogue()).entries.some(e => e.asset === 'SUI')).toBe(false);
  });
  test('rankings use stable identity, not colliding/wrapped symbols', async () => {
    const s = setup(); s.ranking.mockResolvedValue([rank('wrapped-solana', 'SOL', 1)]);
    const result = await s.service.adminCatalogue();
    expect(result.entries.filter(e => e.assetId === result.assets[0].assetId)).toHaveLength(0);
    expect((await s.service.publicCatalogue()).entries).toHaveLength(4);
  });
  test('ranking failure preserves saved configuration and does not invent ranks', async () => {
    const s = setup(); s.ranking.mockRejectedValue(new Error('Offline'));
    const result = await s.service.adminCatalogue(); expect(result.rankingAvailable).toBe(false);
    expect(result.assets.every(a => a.rank === 0)).toBe(true); expect((await s.service.publicCatalogue()).entries).toHaveLength(4);
  });
  test('one store fetch per cold catalogue, shared concurrent loads, TTL, ETag and save invalidation', async () => {
    const s = setup(); let now = 0; const service = new DepositCatalogue(s.store, s.ranking, () => now);
    const [first] = await Promise.all([service.publicCatalogue(), service.adminCatalogue(), service.publicCatalogue()]);
    expect(s.store.reads).toBe(1); now = 29_999; await service.publicCatalogue(); expect(s.store.reads).toBe(1);
    now = 30_001; await service.publicCatalogue(); expect(s.store.reads).toBe(2);
    await service.save({ ...entry('ethereum', 'ethereum'), enabled: false }, '1');
    expect((await service.publicCatalogue()).version).not.toBe(first.version);
    const response = await request(s.app).get(publicPath); const unchanged = await request(s.app).get(publicPath).set('If-None-Match', response.headers.etag);
    expect(unchanged.status).toBe(304);
  });
  test('atomic CAS prevents lost updates across service instances', async () => {
    const store = new MemoryStore(); const one = setup(store), two = setup(store);
    const results = await Promise.allSettled([one.service.save(entry('solana', 'solana', 'A'.repeat(44)), '1'), two.service.save(entry('usd-coin', 'ethereum'), '1')]);
    expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(1); expect(store.writes).toBe(1);
  });
  test('revision required; stale save refused', async () => {
    const s = setup(); expect((await request(s.app).put(adminPath).set('Authorization', token('admin')).send(entry('ethereum', 'ethereum'))).status).toBe(428);
    expect((await request(s.app).put(adminPath).set('Authorization', token('admin')).set('If-Match', 'old').send(entry('ethereum', 'ethereum'))).status).toBe(409);
    expect(s.store.writes).toBe(0);
  });
  test.each([
    { assetId: 'voltora' }, { networkId: 'imaginary' }, { address: '<script>alert(1)</script>' }, { address: 'x'.repeat(257) },
    { address: 'not an address' }, { memo: 'x'.repeat(129) }, { memoLabel: '<img>' }, { memo: 'not-supported' }, { address: '' },
    { txHash: 'fake' }, { sender: 'fake' }, { amount: 42 },
  ])('invalid configuration rejected without write: %j', async patch => {
    const s = setup(); expect((await request(s.app).put(adminPath).set('Authorization', token('admin')).set('If-Match', '1').send({ ...entry('ethereum', 'ethereum'), ...patch })).status).toBe(400);
    expect(s.store.writes).toBe(0);
  });
  test('XRP tag bounds enforced', () => {
    expect(entrySchema.safeParse({ ...entry('ripple', 'xrp', 'r' + 'A'.repeat(30)), memo: '4294967296' }).success).toBe(false);
  });
  test('no storage means fail closed, no temporary memory or filesystem persistence', async () => {
    const service = new DepositCatalogue(new UnconfiguredCatalogueStore(), async () => rankings);
    await expect(service.publicCatalogue()).rejects.toMatchObject({ status: 503 });
    await expect(service.save(entry('ethereum', 'ethereum'), '1')).rejects.toMatchObject({ status: 503 });
  });
  test('no stale public destinations after storage outage/TTL', async () => {
    const store = new MemoryStore(); let now = 0; const s = new DepositCatalogue(store, async () => rankings, () => now);
    await s.publicCatalogue(); now = 31_000; store.read = async () => { throw new Error('offline'); };
    await expect(s.publicCatalogue()).rejects.toThrow('offline');
  });
  test('Cloudflare adapter uses one document and CAS, never exposes storage token', async () => {
    const store = new MemoryStore(); const transport = jest.fn().mockResolvedValue({ ok: true, json: () => store.read() });
    const adapter = new CloudflareCatalogueStore('https://config.example.test/catalogue', 'synthetic-secret', transport);
    await adapter.read(); await adapter.replace(store.document, '1');
    expect(transport).toHaveBeenCalledTimes(2); expect(transport.mock.calls[1][1]).toMatchObject({ method: 'PUT', redirect: 'error', headers: { 'If-Match': '1' } });
    transport.mockResolvedValue({ ok: false, status: 412 }); await expect(adapter.replace(store.document, '1')).rejects.toMatchObject({ status: 409 });
  });
  test('public endpoint accepts no transfer submission and performs zero mutations', async () => {
    const s = setup(); expect((await request(s.app).post(publicPath).send({ txHash: 'fake', amount: '100' })).status).toBe(404);
    await request(s.app).get(publicPath); expect(s.store.writes).toBe(0); expect(s.forbidden).not.toHaveBeenCalled();
  });
  test('new catalogue has no financial dependencies, polling, jobs or migrations', () => {
    for (const file of ['registry.ts', 'schema.ts', 'service.ts', 'store.ts']) {
      const source = readFileSync(`src/services/depositCatalogue/${file}`, 'utf8');
      expect(source).not.toMatch(/from ['"].*(?:prisma|DepositService|Watch|WalletService)|setInterval|setTimeout\(/);
    }
    const changes = execFileSync('git', ['diff', '--name-only', 'origin/main'], { encoding: 'utf8' }).split('\n');
    // This follow-up explicitly adds a standalone catalogue Worker only.
    expect(changes.filter(f => /^(prisma\/|workers\/|.*(?:Scheduler|Watcher)\.ts$)/.test(f)
      && !f.startsWith('workers/deposit-catalogue/'))).toEqual([]);
  });
});
