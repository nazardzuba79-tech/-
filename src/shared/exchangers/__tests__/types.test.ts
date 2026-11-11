import { isOfferMark, OFFER_MARKS } from '../types';
import type { OffersOkResponse, DirectoryOkResponse, OffersResponse } from '../types';

test('OFFER_MARKS is the 17 documented BestChange marks', () => {
  expect([...OFFER_MARKS].sort()).toEqual(
    ['atm', 'card2card', 'cardverify', 'delay', 'delivery', 'floating', 'language', 'manual', 'more', 'official', 'otherin', 'otherout', 'percent', 'purse', 'reg', 'unstable', 'verifying'],
  );
  expect(new Set(OFFER_MARKS).size).toBe(17);
  expect(isOfferMark('manual')).toBe(true);
  expect(isOfferMark('MANUAL')).toBe(false);
  expect(isOfferMark('toString')).toBe(false);
  expect(isOfferMark(1)).toBe(false);
});

test('contract shapes type-check (compile-time)', () => {
  const dir: DirectoryOkResponse = {
    status: 'ok',
    asOf: null,
    methods: [{ id: 'sbp', label: 'СБП', kind: 'payment_system', available: true }],
    assets: [{ assetId: 'USDT', networkId: 'tron', available: true }],
  };
  const offers: OffersOkResponse = {
    status: 'ok',
    asOf: null,
    stale: false,
    query: { method: 'sbp', asset: 'USDT', network: 'tron', amount: 10000 },
    directionLink: null,
    offers: [],
  };
  const errors: OffersResponse[] = [
    { status: 'not_configured' },
    { status: 'unavailable', retryAfter: 30 },
    { status: 'invalid' },
    { status: 'rate_limited', retryAfter: 60 },
  ];
  expect(dir.status).toBe('ok');
  expect(offers.offers).toEqual([]);
  expect(errors).toHaveLength(4);
});
