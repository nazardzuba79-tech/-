process.env.JWT_SECRET = 'test-secret-at-least-this-long';

import request from 'supertest';
import express from 'express';
import jwt from 'jsonwebtoken';
import { adminListingsRouter } from '../adminListings';
import { ListingStoreError, CloudflareListingStore, type ListingStore } from '../../../services/listings/store';
import type { ListingConfig } from '../../../services/listings/listingConfig';
import { listingSimulationConfig } from '../../../services/listings/listingConfig';
import { testMarketCandles } from '../../../services/testMarkets/testMarketService';

const auth = (userId: string) => `Bearer ${jwt.sign({ sub: userId }, process.env.JWT_SECRET!)}`;
const prismaFor = (role: 'ADMIN' | 'USER') => ({ user: { findUnique: jest.fn().mockResolvedValue({ role }) } });
const form = (extra: Record<string, unknown> = {}) => ({
  symbol: 'qax', name: 'QA Example', logo: null, initialPrice: '0.25', listingAt: '2026-10-01T12:00:00Z',
  displayTimeZone: 'Europe/Kyiv', ownerAllocation: '1000', seedMode: 'auto', tradable: true, ...extra,
});

function fakeStore(): ListingStore & { drafts: Map<string, { draft: ListingConfig; draftRevision: number }>; calls: string[] } {
  const drafts = new Map<string, { draft: ListingConfig; draftRevision: number }>();
  const calls: string[] = [];
  return {
    drafts, calls,
    async list() {
      calls.push('list');
      return { revision: '0', serverTime: Date.now(), listings: [...drafts].map(([id, d]) => ({
        id, symbol: d.draft.symbol, draft: d.draft, draftRevision: d.draftRevision, draftUpdatedAt: '', draftUpdatedBy: 'a',
        activeVersion: null, active: null, versions: [] })) };
    },
    async published() { calls.push('published'); return { revision: '0', listings: [] }; },
    async saveDraft(id, config, ifMatch, actor) {
      calls.push(`save:${id}:${ifMatch}:${actor}`);
      const current = drafts.get(id);
      if ((current?.draftRevision ?? 0) !== ifMatch) throw new ListingStoreError(409, 'revision_conflict', 'conflict', { draftRevision: current?.draftRevision ?? 0 });
      const draft = config.seedMode === 'auto' && current ? { ...config, seed: current.draft.seed } : config;
      drafts.set(id, { draft, draftRevision: ifMatch + 1 });
      return { id, draftRevision: ifMatch + 1, draft };
    },
    async publish(id, draftRevision, publishKey, actor) {
      calls.push(`publish:${id}:${draftRevision}:${publishKey}:${actor}`);
      return { id, version: 1, replayed: false, publishedAt: new Date().toISOString() };
    },
  };
}

function app(role: 'ADMIN' | 'USER' = 'ADMIN', store = fakeStore(), venue = { hasSpotPair: (pair: string) => pair === 'SOLX/USDT' }) {
  const registry = { invalidate: jest.fn(), ensureFresh: jest.fn() };
  const server = express();
  server.use(express.json({ limit: '200kb' }));
  server.use('/api/v1', adminListingsRouter(prismaFor(role) as any, store, venue, registry as any, () => Date.parse('2026-10-01T10:00:00Z')));
  return { server, store, registry };
}

describe('Admin → Listings routes', () => {
  test('no session → 401; a customer → 403; nothing reaches the store', async () => {
    const { server, store } = app('USER');
    expect((await request(server).get('/api/v1/admin/listings')).status).toBe(401);
    expect((await request(server).get('/api/v1/admin/listings').set('Authorization', auth('u1'))).status).toBe(403);
    expect((await request(server).post('/api/v1/admin/listings').set('Authorization', auth('u1')).send({ config: form() })).status).toBe(403);
    expect(store.calls).toEqual([]);
  });

  test('create: server fills an automatic seed, the admin id is the actor, If-Match 0', async () => {
    const { server, store } = app();
    const res = await request(server).post('/api/v1/admin/listings').set('Authorization', auth('admin-1')).send({ config: form() });
    expect(res.status).toBe(201);
    expect(res.body.draft.symbol).toBe('QAX');
    expect(res.body.draft.seed).toMatch(/^qax-20261001-[a-f0-9]{10}$/);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(store.calls[0]).toMatch(/^save:qax-[a-f0-9]{8}:0:admin-1$/);
  });

  test.each([
    [{ symbol: 'VTA' }, 'RESERVED_TICKER'], [{ symbol: 'SOLX' }, 'TICKER_ON_MARKET'], [{ initialPrice: 'abc' }, 'INVALID_CONFIG'],
    [{ seedMode: 'manual', seed: 'x' }, 'INVALID_CONFIG'],
  ])('create refuses %j with %s (422), store untouched', async (change, code) => {
    const { server, store } = app();
    const res = await request(server).post('/api/v1/admin/listings').set('Authorization', auth('admin-1')).send({ config: form(change) });
    expect(res.status).toBe(422);
    expect(res.body.error).toBe(code);
    expect(store.calls).toEqual([]);
  });

  test('edit needs If-Match; a stale revision is a 409 with the current revision; the auto seed stays', async () => {
    const { server, store } = app();
    const created = (await request(server).post('/api/v1/admin/listings').set('Authorization', auth('admin-1')).send({ config: form() })).body;
    expect((await request(server).put(`/api/v1/admin/listings/${created.id}/draft`).set('Authorization', auth('admin-1')).send({ config: form() })).status).toBe(428);
    const ok = await request(server).put(`/api/v1/admin/listings/${created.id}/draft`).set('Authorization', auth('admin-1')).set('If-Match', '1')
      .send({ config: form({ name: 'Renamed', listingAt: '2026-10-05T12:00:00Z' }) });
    expect(ok.status).toBe(200);
    expect(ok.body.draft.seed).toBe(created.draft.seed);
    const stale = await request(server).put(`/api/v1/admin/listings/${created.id}/draft`).set('Authorization', auth('admin-1')).set('If-Match', '1').send({ config: form() });
    expect(stale.status).toBe(409);
    expect(stale.body.draftRevision).toBe(2);
    expect(store.calls.filter((c) => c === 'list')).toEqual([]);
  });

  test('private Preview: the draft market at a chosen time equals what the public edge will compute', async () => {
    const { server } = app();
    const created = (await request(server).post('/api/v1/admin/listings').set('Authorization', auth('admin-1')).send({ config: form() })).body;
    const at = '2026-10-01T15:00:00Z';
    const preview = (await request(server).get(`/api/v1/admin/listings/${created.id}/preview?at=${at}&interval=1h`).set('Authorization', auth('admin-1'))).body;
    expect(preview.asset.state.phase).toBe('live');
    expect(preview.candles).toEqual(testMarketCandles(listingSimulationConfig(created.draft), '1h', Date.parse(at), 200));
    expect(preview.book.bids).toHaveLength(25);
    expect(preview.trades.length).toBeGreaterThan(0);
    const before = (await request(server).get(`/api/v1/admin/listings/${created.id}/preview?at=2026-10-01T11:00:00Z`).set('Authorization', auth('admin-1'))).body;
    expect(before.asset.state.phase).toBe('pre-listing');
    expect(before.candles).toEqual([]);
  });

  test('publish needs a key and a draft revision; success invalidates the trading registry', async () => {
    const { server, store, registry } = app();
    const created = (await request(server).post('/api/v1/admin/listings').set('Authorization', auth('admin-1')).send({ config: form() })).body;
    expect((await request(server).post(`/api/v1/admin/listings/${created.id}/publish`).set('Authorization', auth('admin-1')).send({ draftRevision: 1 })).status).toBe(400);
    const res = await request(server).post(`/api/v1/admin/listings/${created.id}/publish`).set('Authorization', auth('admin-1'))
      .send({ draftRevision: 1, publishKey: 'publish-key-00000001' });
    expect(res.status).toBe(200);
    expect(store.calls).toContain(`publish:${created.id}:1:publish-key-00000001:admin-1`);
    expect(registry.invalidate).toHaveBeenCalledTimes(1);
  });

  test('store failures map to clear statuses; an outage is 503, never a success', async () => {
    const store = fakeStore();
    store.list = async () => { throw new ListingStoreError(503, 'STORE_UNAVAILABLE', 'x'); };
    const { server } = app('ADMIN', store);
    expect((await request(server).get('/api/v1/admin/listings').set('Authorization', auth('admin-1'))).status).toBe(503);
  });
});

describe('Cloudflare store client', () => {
  test('https only (loopback http only outside production); token length enforced', () => {
    expect(() => new CloudflareListingStore('http://example.com', 'x'.repeat(40), fetch, false)).toThrow();
    expect(() => new CloudflareListingStore('http://127.0.0.1:8787', 'x'.repeat(40), fetch, true)).toThrow();
    expect(() => new CloudflareListingStore('http://127.0.0.1:8787', 'x'.repeat(40), fetch, false)).not.toThrow();
    expect(() => new CloudflareListingStore('https://market.voltextech.net', 'short', fetch, true)).toThrow();
  });
  test('sends the Bearer secret, If-Match and actor; never follows redirects; maps 409/422 and hides 5xx', async () => {
    const seen: RequestInit[] = [];
    const transport = jest.fn(async (_url: any, init: any) => { seen.push(init); return new Response(JSON.stringify({ error: 'DUPLICATE_TICKER', message: 'dup' }), { status: 409 }); });
    const store = new CloudflareListingStore('https://market.voltextech.net', 's'.repeat(40), transport as any, true);
    await expect(store.saveDraft('qax-1', { schemaVersion: 1 } as any, 3, 'admin-1')).rejects.toMatchObject({ status: 409, code: 'DUPLICATE_TICKER' });
    expect(transport.mock.calls[0][0]).toBe('https://market.voltextech.net/internal/listings/qax-1/draft');
    expect((seen[0].headers as any).Authorization).toBe(`Bearer ${'s'.repeat(40)}`);
    expect((seen[0].headers as any)['If-Match']).toBe('3');
    expect((seen[0].headers as any)['X-Voltex-Admin-Id']).toBe('admin-1');
    expect(seen[0].redirect).toBe('error');
    transport.mockImplementation(async () => new Response('boom', { status: 500 }));
    await expect(store.list()).rejects.toMatchObject({ status: 503, code: 'STORE_UNAVAILABLE' });
  });
});
