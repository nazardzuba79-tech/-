jest.mock('../../../../frontend/src/lib/api', () => ({ API_BASE: '/api/v1' }));

import express from 'express';
import request from 'supertest';
import { exchangersRouter } from '../exchangers';
import { BestChangeService, type ExchangersService } from '../../../services/exchangers/BestChangeService';
import fixture from '../../../services/exchangers/__tests__/fixtures/bestchange-openapi.json';
import { offersPath } from '../../../../frontend/src/lib/exchangersApi';
import { validateDirectoryBody, validateOffersBody } from '../../../../frontend/src/pages/exchangers/model';
import type { OffersQuery } from '../../../shared/exchangers/types';

/**
 * «Обменники» (#694) end-to-end contract: the bodies the real router + service
 * send (fixture upstream, fake key) must pass the page's validators unchanged —
 * no field renamed, no row dropped, every status/HTTP code mapped to the page's
 * own state. Fixture values only; no real offers.
 */

// Obviously fake: never a real key.
const KEY = 'TESTONLYfakeKey000000000000000004';

function upstreamFetch(mode: 'ok' | 'down' = 'ok') {
  return (async (input: RequestInfo | URL) => {
    if (mode === 'down') throw new TypeError('fetch failed');
    const kind = new URL(String(input)).pathname.split('/')[3] as keyof typeof fixture;
    return new Response(JSON.stringify(fixture[kind]), { status: 200, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;
}

function appWith(service: ExchangersService, perClientLimit = 1000) {
  const app = express();
  app.use('/api/v1', exchangersRouter(service, { perClientLimit }));
  return app;
}

beforeEach(() => {
  for (const level of ['log', 'info', 'warn', 'error', 'debug'] as const) jest.spyOn(console, level).mockImplementation(() => undefined);
});
afterEach(() => jest.restoreAllMocks());

test('directory and offers bodies pass the page validators without losing a field or a row', async () => {
  const app = appWith(new BestChangeService({ apiKey: KEY, fetchFn: upstreamFetch(), partnerId: '12345' }));

  const dirRes = await request(app).get('/api/v1/exchangers/directory');
  expect(dirRes.status).toBe(200);
  const directory = validateDirectoryBody(dirRes.body);
  if (directory.kind !== 'ok') throw new Error(`directory not ok: ${directory.kind}`);
  expect(directory.data).toEqual({ asOf: dirRes.body.asOf, methods: dirRes.body.methods, assets: dirRes.body.assets });
  expect(directory.data.methods.length).toBeGreaterThan(0);
  expect(directory.data.assets.length).toBeGreaterThan(0);

  let offersSeen = 0;
  let directionLinksSeen = 0;
  for (const method of directory.data.methods) {
    for (const asset of directory.data.assets) {
      for (const amount of [1, 1234.56, 10000, 100_000_000]) {
        const query: OffersQuery = { method: method.id, asset: asset.assetId, network: asset.networkId, amount };
        const res = await request(app).get(`/api/v1${offersPath(query)}`);
        expect(res.status).toBe(200);
        expect(res.body.status).toBe('ok');
        const result = validateOffersBody(res.body, query);
        if (result.kind !== 'ok') throw new Error(`offers not ok for ${JSON.stringify(query)}: ${result.kind}`);
        expect(result.data.query).toEqual(res.body.query);
        expect(result.data.delayed).toBe(res.body.stale);
        expect(result.data.directionUrl).toBe(res.body.directionLink ? res.body.directionLink.url : null);
        expect(result.data.offers).toEqual(res.body.offers);
        offersSeen += result.data.offers.length;
        if (result.data.directionUrl) directionLinksSeen += 1;
      }
    }
  }
  expect(offersSeen).toBeGreaterThan(0);
  expect(directionLinksSeen).toBeGreaterThan(0);
});

test('every non-OK answer maps to its own page state with the documented HTTP code', async () => {
  const query: OffersQuery = { method: 'sbp', asset: 'USDT', network: 'tron', amount: 10000 };

  const notConfigured = appWith(new BestChangeService({ apiKey: '' }));
  for (const path of ['/api/v1/exchangers/directory', `/api/v1${offersPath(query)}`]) {
    const res = await request(notConfigured).get(path);
    expect(res.status).toBe(200);
    expect(validateDirectoryBody(res.body)).toEqual({ kind: 'not_configured' });
    expect(validateOffersBody(res.body, query)).toEqual({ kind: 'not_configured' });
  }

  const down = appWith(new BestChangeService({ apiKey: KEY, fetchFn: upstreamFetch('down') }));
  const unavailable = await request(down).get('/api/v1/exchangers/directory');
  expect(unavailable.status).toBe(503);
  const mapped = validateDirectoryBody(unavailable.body);
  expect(mapped.kind).toBe('unavailable');
  expect(mapped).toEqual({ kind: 'unavailable', retryAfter: unavailable.body.retryAfter });

  const ok = appWith(new BestChangeService({ apiKey: KEY, fetchFn: upstreamFetch() }));
  const unknownMethod: OffersQuery = { ...query, method: 'bc-not-in-directory' };
  const invalid = await request(ok).get(`/api/v1${offersPath(unknownMethod)}`);
  expect(invalid.status).toBe(400);
  expect(validateOffersBody(invalid.body, unknownMethod)).toEqual({ kind: 'invalid' });

  const limited = appWith(new BestChangeService({ apiKey: '' }), 1);
  await request(limited).get('/api/v1/exchangers/directory');
  const tooMany = await request(limited).get('/api/v1/exchangers/directory');
  expect(tooMany.status).toBe(429);
  const mappedLimit = validateDirectoryBody(tooMany.body);
  expect(mappedLimit.kind).toBe('rate_limited');
  expect(mappedLimit).toEqual({ kind: 'rate_limited', retryAfter: tooMany.body.retryAfter });
});
